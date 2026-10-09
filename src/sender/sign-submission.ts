import {
  assertIsTransactionWithinSizeLimit,
  getBase64Decoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  verifySignature,
} from "@solana/kit";
import type { Address, Transaction, TransactionPartialSigner } from "@solana/kit";
import { SenderError, SenderErrorCode } from "./types.js";
import type { PreparedVariant } from "./types.js";
import { copyTransaction, haveEqualBytes } from "./transaction.js";
import type { PreparedTransaction } from "./transaction.js";

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
    throw new SenderError(
      SenderErrorCode.InvalidRequest,
      "Supply transaction partial signers",
    );
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
    throw new SenderError(
      SenderErrorCode.SigningFailed,
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
    throw new SenderError(
      SenderErrorCode.SigningFailed,
      "Signer failed to return the required signatures",
    );
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
    throw new SenderError(
      SenderErrorCode.SigningFailed,
      "Signed variants must preserve the prepared messages and contain valid signatures",
    );
  }
  return payloads;
}
