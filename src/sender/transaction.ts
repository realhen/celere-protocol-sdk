import type {
  Transaction,
  TransactionWithLifetime,
  ReadonlyUint8Array,
} from "@solana/kit";
import type { PreparedVariant } from "./types.js";

/** An unsigned or partially signed transaction with its caller-supplied lifetime. */
export type PreparedTransaction = Transaction & TransactionWithLifetime;

/** Copy mutable byte arrays so wallets and public results cannot rewrite a prepared plan. */
export function copyTransaction(transaction: PreparedTransaction): PreparedTransaction {
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
export function haveEqualBytes(
  left: ReadonlyUint8Array,
  right: ReadonlyUint8Array,
): boolean {
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
