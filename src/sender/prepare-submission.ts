import {
  SenderRequestError,
  NonceRequiredError,
  TipTooLowError,
  SenderCompilationError,
} from "./errors/index.js";
import { createNoopSigner } from "@solana/kit";
import type { Address, Instruction } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { compileTransaction } from "../transactions/index.js";
import { SenderProvider } from "./types.js";
import type { PrepareRequest, PreparedVariant, SenderRoute } from "./types.js";
import type { ConfiguredRoute } from "./configuration.js";
import type { PreparedTransaction } from "./transaction.js";

import { validatePreparationRequest } from "./validate-preparation.js";

/** A variant's route list is assembled before exposing a readonly copy. */
interface PendingVariant {
  readonly transaction: PreparedTransaction;
  readonly routeIds: string[];
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
  const validation = validatePreparationRequest(request, routes);
  if (!validation.ok) throw validation.error;
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
      throw new TipTooLowError(`Tip below minimum for ${route.id}`);
    }
    const recipient = selectTipRecipient(config, tipRecipients);
    if (
      recipient &&
      (recipient === request.feePayer ||
        recipient === request.nonce?.account ||
        recipient === request.nonce?.authority)
    ) {
      throw new SenderRequestError("Tip recipient conflicts with payer or nonce");
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
      throw new SenderCompilationError(compiled.error.message);
    }
    const variant = { transaction: compiled.value.transaction, routeIds: [route.id] };
    variantsByTip.set(variantKey, variant);
    variants.push(variant);
  }

  // A recent blockhash alone would allow different tipped variants to execute independently.
  if (variants.length > 1 && !request.nonce) {
    throw new NonceRequiredError(
      "Distinct variants, including the RPC variant, require a shared durable nonce",
    );
  }
  return variants;
}
