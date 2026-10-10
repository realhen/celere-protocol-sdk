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
import { compileTransaction } from "../transactions/index.js";
import {
  NonceRequiredError,
  SenderCompilationError,
  SenderRequestError,
  SenderSigningError,
  TipTooLowError,
} from "./errors/index.js";
import type { ConfiguredRoute } from "./providers/configuration.js";
import { SenderProvider } from "./types.js";
import type { PrepareRequest, PreparedVariant, SenderRoute } from "./types.js";

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
