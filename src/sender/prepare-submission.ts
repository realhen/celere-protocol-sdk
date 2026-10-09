import { createNoopSigner } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { compileTransaction } from "../transactions/index.js";
import { U64_MAX } from "../core/amounts.js";
import {
  HeliusSenderMode,
  SenderError,
  SenderErrorCode,
  SenderProvider,
} from "./types.js";
import type { PrepareRequest, PreparedVariant, SenderRoute } from "./types.js";
import type { ConfiguredRoute } from "./configuration.js";
import type { PreparedTransaction } from "./transaction.js";

const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;
const HELIUS_MAX_MINIMUM_PRIORITY_FEE = 5_000n;

/** A variant's route list is assembled before the client exposes a readonly copy. */
interface PendingVariant {
  readonly transaction: PreparedTransaction;
  readonly routeIds: string[];
}

function assertFeeAmount(value: unknown): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    throw new SenderError(
      SenderErrorCode.InvalidRequest,
      "Fee amounts must be non-negative u64 bigint values",
    );
  }
}

/** Validate fee units and provider policies before compiling or asking a wallet to sign. */
function assertPreparationRequest(
  request: PrepareRequest,
  routes: readonly ConfiguredRoute[],
): void {
  if (!request || !request.fees || !Array.isArray(request.instructions)) {
    throw new SenderError(
      SenderErrorCode.InvalidRequest,
      "Instructions and fees are required",
    );
  }
  if (Boolean(request.nonce) === Boolean(request.lifetime)) {
    throw new SenderError(
      SenderErrorCode.InvalidRequest,
      "Supply exactly one nonce or blockhash lifetime",
    );
  }
  const fees = request.fees;
  assertFeeAmount(fees.tipLamports);
  assertFeeAmount(fees.computeUnitPriceMicroLamports);
  if (
    !Number.isInteger(fees.computeUnitLimit) ||
    fees.computeUnitLimit <= 0 ||
    fees.computeUnitLimit > MAX_COMPUTE_UNIT_LIMIT
  ) {
    throw new SenderError(
      SenderErrorCode.InvalidRequest,
      "Compute unit limit must be an integer from 1 through 1400000",
    );
  }

  // Solana rounds the total priority fee up to whole lamports, not the per-CU price.
  const priorityFeeLamports =
    (BigInt(fees.computeUnitLimit) * fees.computeUnitPriceMicroLamports +
      MICRO_LAMPORTS_PER_LAMPORT -
      1n) /
    MICRO_LAMPORTS_PER_LAMPORT;
  const hasHeliusMaxRoute = routes.some(
    ({ config }) =>
      config.provider === SenderProvider.Helius && config.mode === HeliusSenderMode.Max,
  );
  if (hasHeliusMaxRoute && priorityFeeLamports < HELIUS_MAX_MINIMUM_PRIORITY_FEE) {
    throw new SenderError(
      SenderErrorCode.PriorityFeeTooLow,
      "Helius Sender Max requires at least 5000 lamports of priority fee",
    );
  }
  for (const [provider, tipLamports] of Object.entries(fees.tipOverrides ?? {})) {
    const isConfiguredProvider =
      Object.values(SenderProvider).includes(provider as SenderProvider) &&
      provider !== SenderProvider.Rpc &&
      routes.some((route) => route.config.provider === provider);
    if (!isConfiguredProvider) {
      throw new SenderError(
        SenderErrorCode.InvalidRequest,
        "Tip override refers to an unconfigured provider",
      );
    }
    assertFeeAmount(tipLamports);
  }
}

/** Reuse one recipient across compatible regional lanes so their transaction bytes match. */
function selectTipRecipient(
  route: SenderRoute,
  recipients: Map<SenderProvider, Address>,
): Address | undefined {
  if (route.provider === SenderProvider.Rpc) return undefined;
  const existingRecipient = recipients.get(route.provider);
  if (existingRecipient && route.tipAccounts.includes(existingRecipient))
    return existingRecipient;

  const recipientIndex = Math.floor(Math.random() * route.tipAccounts.length);
  const recipient = route.tipAccounts[recipientIndex]!;
  recipients.set(route.provider, recipient);
  return recipient;
}

/** Build a portable tip instruction; the actual payer signature is supplied later by the caller. */
function createTipInstruction(
  payer: Address,
  recipient: Address,
  tipLamports: bigint,
): Instruction {
  const instruction = getTransferSolInstruction({
    source: createNoopSigner(payer),
    destination: recipient,
    amount: tipLamports,
  });
  // The official System Program builder attaches signer metadata. Keep only account roles
  // in the instruction so the unsigned plan does not retain a signing implementation.
  return {
    programAddress: instruction.programAddress,
    data: instruction.data,
    accounts: instruction.accounts.map(({ address, role }) => ({ address, role })),
  };
}

/** Compile one transaction per distinct tip, sharing that transaction between compatible lanes. */
export function prepareTransactionVariants(
  request: PrepareRequest,
  routes: readonly ConfiguredRoute[],
): readonly PreparedVariant[] {
  assertPreparationRequest(request, routes);
  const variants: PendingVariant[] = [];
  const variantsByTip = new Map<string, PendingVariant>();
  const tipRecipients = new Map<SenderProvider, Address>();

  for (const route of routes) {
    const { config } = route;
    const tipLamports =
      config.provider === SenderProvider.Rpc
        ? 0n
        : (request.fees.tipOverrides?.[config.provider] ?? request.fees.tipLamports);
    if (tipLamports < config.minimumTipLamports) {
      throw new SenderError(
        SenderErrorCode.TipTooLow,
        `Tip below minimum for ${route.id}`,
      );
    }
    const recipient = selectTipRecipient(config, tipRecipients);
    if (
      recipient &&
      (recipient === request.feePayer ||
        recipient === request.nonce?.account ||
        recipient === request.nonce?.authority)
    ) {
      throw new SenderError(
        SenderErrorCode.InvalidRequest,
        "Tip recipient conflicts with payer or nonce",
      );
    }

    // Everything except the tip is common to this send. The recipient and amount
    // therefore identify which lanes can reuse one compiled message and signature.
    const variantKey = `${recipient ?? "rpc"}:${tipLamports}`;
    const existingVariant = variantsByTip.get(variantKey);
    if (existingVariant) {
      existingVariant.routeIds.push(route.id);
      continue;
    }
    const instructions = [...request.instructions];
    if (recipient)
      instructions.push(createTipInstruction(request.feePayer, recipient, tipLamports));
    const compiled = compileTransaction({
      instructions,
      feePayer: request.feePayer,
      lifetime: request.nonce ?? request.lifetime!,
      computeBudget: {
        units: request.fees.computeUnitLimit,
        microLamports: request.fees.computeUnitPriceMicroLamports,
      },
      ...(request.lookupTables === undefined
        ? {}
        : { lookupTables: request.lookupTables }),
    });
    if (!compiled.ok) {
      throw new SenderError(SenderErrorCode.CompilationFailed, compiled.error.message);
    }
    const variant = { transaction: compiled.value.transaction, routeIds: [route.id] };
    variantsByTip.set(variantKey, variant);
    variants.push(variant);
  }

  // A recent blockhash alone would allow different tipped variants to execute independently.
  if (variants.length > 1 && !request.nonce) {
    throw new SenderError(
      SenderErrorCode.NonceRequired,
      "Distinct variants, including the RPC variant, require a shared durable nonce",
    );
  }
  return variants;
}
