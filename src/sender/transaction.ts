import {
  assertIsTransactionWithinSizeLimit,
  createNoopSigner,
  getBase64Decoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  verifySignature,
} from "@solana/kit";
import type {
  Address,
  Instruction,
  ReadonlyUint8Array,
  Transaction,
  TransactionPartialSigner,
  TransactionWithLifetime,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { compileTransaction } from "../transactions/index";
import {
  NonceRequiredError,
  SenderCompilationError,
  SenderRequestError,
  SenderSigningError,
  TipTooLowError,
} from "./errors/index";
import type { ConfiguredRoute } from "./providers/configuration";
import { SenderProvider } from "./providers/route";
import type { SenderRoute } from "./providers/route";
import type { BlockhashLifetime, DurableNonce, LookupTable } from "../transactions/index";

/** Per-send amounts. All monetary values are atomic bigint values. No automatic fee sampling. */
export interface SenderFees {
  /**
   * Requested compute units for the entire transaction, including setup, nonce, and tip
   * instructions. Integer 1–1,400,000. The sender does not simulate or estimate this value.
   */
  readonly computeUnitLimit: number;
  /**
   * Micro-lamports per requested compute unit, as a u64 bigint. Priority fee in lamports
   * is ceil(limit × price / 1,000,000). For example, 200,000 CUs at 50,000n costs 10,000 lamports.
   */
  readonly computeUnitPriceMicroLamports: bigint;
  /**
   * Tip in lamports for each provider variant, as a u64 bigint; 1,000,000n is 0.001 SOL.
   * The default RPC variant has no provider tip. Each route's minimum is checked before signing.
   */
  readonly tipLamports: bigint;
  /** Per-provider tip amounts in lamports, replacing tipLamports for all that provider's lanes. */
  readonly tipOverrides?: Readonly<
    Partial<Record<Exclude<SenderProvider, SenderProvider.Rpc>, bigint>>
  >;
}

/**
 * Inputs for local transaction compilation. Supply exactly one nonce or blockhash lifetime.
 *
 * The sender adds compute-budget instructions and provider tips; do not add a second
 * compute budget or nonce advance instruction. A blockhash lifetime is sufficient only
 * when there is a single variant. Distinct provider/RPC variants require a shared nonce.
 * The client neither fetches a lifetime nor falls back to RPC-only sending when a nonce is missing.
 */
export type PrepareRequest = {
  /** Ordered instructions from any protocol or other Kit-compatible source. At least one is required. */
  readonly instructions: readonly Instruction[];
  /** Address paying transaction fees and provider tips; its signature is required. */
  readonly feePayer: Address;
  /** Caller-observed address lookup contents. The nonce account always remains a static account. */
  readonly lookupTables?: readonly LookupTable[];
  /** Explicit per-send fees, including the complete transaction's compute-unit limit. */
  readonly fees: SenderFees;
} & (
  | {
      /** Current nonce snapshot exclusively selected by the application for this logical trade. */
      readonly nonce: DurableNonce;
      readonly lifetime?: never;
    }
  | {
      /** Recent blockhash and expiration height for a single-variant send. */
      readonly lifetime: BlockhashLifetime;
      readonly nonce?: never;
    }
);

/** Transaction and assigned route IDs; regional lanes can share one variant. */
export interface PreparedVariant {
  /** Unsigned transaction with required signature slots and explicit lifetime metadata. */
  readonly transaction: Transaction & TransactionWithLifetime;
  /** Client-assigned IDs of all lanes sharing this exact transaction. */
  readonly routeIds: readonly string[];
}

/** Prepared plans belong to the client that created them. Retain for external signing. */
export interface PreparedSubmission {
  /** Distinct unsigned variants in the order expected by external signing and submission. */
  readonly variants: readonly PreparedVariant[];
}

/** Serialized, verified transaction supplied to a provider's request encoder. */
export interface SenderTransactionPayload {
  /** Signed wire bytes; treat as readonly. */
  readonly bytes: Uint8Array;
  /** Base64 representation of the same signed bytes. */
  readonly base64: string;
  /** Locally verified fee-payer signature. */
  readonly signature: string;
}

/** An unsigned or partially signed transaction with its caller-supplied lifetime. */
export type PreparedTransaction = Transaction & TransactionWithLifetime;

/** Copy mutable byte arrays so wallets and public results cannot rewrite a prepared plan. */
function copyTransaction(transaction: PreparedTransaction): PreparedTransaction {
  return {
    ...transaction,
    // Copying bytes preserves Kit's brand for a compiled transaction message.
    messageBytes: Uint8Array.from(
      transaction.messageBytes,
    ) as unknown as typeof transaction.messageBytes,
    lifetimeConstraint: { ...transaction.lifetimeConstraint },
    signatures: Object.fromEntries(
      Object.entries(transaction.signatures).map(([signerAddress, signature]) => [
        signerAddress,
        signature ? Uint8Array.from(signature) : null,
      ]),
    ) as typeof transaction.signatures,
  };
}
/** Compare signed message bytes with the original unsigned message. */
function haveEqualBytes(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, index) => byte === right[index])
  );
}

/** Copy both the transaction buffers and route assignments at a public API boundary. */
export function copyPreparedVariants(
  variants: readonly PreparedVariant[],
): readonly PreparedVariant[] {
  return Object.freeze(
    variants.map((variant) =>
      Object.freeze({
        transaction: copyTransaction(variant.transaction),
        routeIds: Object.freeze([...variant.routeIds]),
      }),
    ),
  );
}

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

/** A verified transaction serialized once for reuse by all of its regional lanes. */
export interface SignedPayload {
  readonly signature: string;
  readonly bytes: Uint8Array;
  readonly base64: string;
}

/** Ask each partial signer to sign the complete batch, then merge the returned signatures. */
export async function signPreparedTransactions(
  variants: readonly PreparedVariant[],
  signersInput: readonly TransactionPartialSigner[],
  signal?: AbortSignal,
): Promise<readonly PreparedTransaction[]> {
  if (!Array.isArray(signersInput))
    throw new SenderRequestError("Supply transaction partial signers");
  const signers: TransactionPartialSigner[] = [...signersInput];
  // Provider tips add no new signers, so every variant has the same required addresses.
  const requiredAddresses = Object.keys(variants[0]!.transaction.signatures);
  if (
    new Set(signers.map((signer) => signer.address)).size !== signers.length ||
    requiredAddresses.some(
      (requiredAddress) => !signers.some((signer) => signer.address === requiredAddress),
    ) ||
    signers.some(
      (signer) =>
        !requiredAddresses.includes(signer.address) ||
        typeof signer.signTransactions !== "function",
    )
  )
    throw new SenderSigningError(
      "Supply exactly the required transaction partial signers",
    );
  const signedTransactions = variants.map((variant) =>
    copyTransaction(variant.transaction),
  );
  try {
    await Promise.all(
      signers.map(async (signer) => {
        // Each wallet gets its own buffers; one signer cannot mutate another signer's input.
        const transactionsToSign = variants.map((variant) => {
          const transaction = copyTransaction(variant.transaction);
          assertIsTransactionWithinSizeLimit(transaction);
          return transaction;
        });
        const signatureDictionaries = await signer.signTransactions(
          transactionsToSign,
          signal ? { abortSignal: signal } : undefined,
        );
        if (signatureDictionaries.length !== signedTransactions.length) {
          throw new Error(
            "Signer returned a different number of signature dictionaries than transactions",
          );
        }
        signatureDictionaries.forEach((signatures, index) => {
          const signature = signatures[signer.address];
          if (
            !signature ||
            signature.length !== 64 ||
            Object.keys(signatures).some((key) => key !== signer.address)
          )
            throw new Error(
              "Transaction or signatures do not match the prepared variant",
            );
          signedTransactions[index] = {
            ...signedTransactions[index]!,
            signatures: {
              ...signedTransactions[index]!.signatures,
              [signer.address]: Uint8Array.from(signature) as typeof signature,
            },
          };
        });
      }),
    );
  } catch {
    throw new SenderSigningError("Signer failed to return the required signatures");
  }
  return signedTransactions;
}

/** Verify message integrity and signatures before serializing any variant for submission. */
export async function serializeSignedTransactions(
  variants: readonly PreparedVariant[],
  transactions: readonly Transaction[],
): Promise<readonly SignedPayload[]> {
  const payloads: SignedPayload[] = [];
  try {
    const publicKeysByAddress = new Map<Address, Promise<CryptoKey>>();
    await Promise.all(
      variants.map(async (variant, index) => {
        const transaction = transactions[index]!;
        if (
          !haveEqualBytes(transaction.messageBytes, variant.transaction.messageBytes) ||
          Object.keys(transaction.signatures).length !==
            Object.keys(variant.transaction.signatures).length
        )
          throw new Error("Transaction or signatures do not match the prepared variant");
        // Snapshot before any await so the caller cannot change the bytes after verification.
        const snapshot = copyTransaction({
          ...transaction,
          // Wire signatures must follow message signer order, never object insertion order
          // supplied by an external wallet.
          signatures: Object.fromEntries(
            Object.keys(variant.transaction.signatures).map((key) => [
              key,
              transaction.signatures[key as Address] ?? null,
            ]),
          ),
          lifetimeConstraint: variant.transaction.lifetimeConstraint,
        });
        await Promise.all(
          Object.keys(variant.transaction.signatures).map(async (key) => {
            const signer = key as Address;
            const signature = snapshot.signatures[signer];
            if (!signature || signature.length !== 64)
              throw new Error(
                "Transaction or signatures do not match the prepared variant",
              );
            let publicKey = publicKeysByAddress.get(signer);
            if (!publicKey) {
              publicKey = getPublicKeyFromAddress(signer);
              publicKeysByAddress.set(signer, publicKey);
            }
            if (
              !(await verifySignature(await publicKey, signature, snapshot.messageBytes))
            )
              throw new Error(
                "Transaction or signatures do not match the prepared variant",
              );
          }),
        );
        const bytes = Uint8Array.from(getTransactionEncoder().encode(snapshot));
        payloads[index] = {
          bytes,
          base64: getBase64Decoder().decode(bytes),
          signature: getSignatureFromTransaction(snapshot),
        };
      }),
    );
  } catch {
    throw new SenderSigningError(
      "Signed variants must preserve the prepared messages and contain valid signatures",
    );
  }
  return payloads;
}
