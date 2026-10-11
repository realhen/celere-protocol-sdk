/** Expected failures specific to transaction compilation. */
export enum TransactionErrorCode {
  TransactionTooLarge = "TRANSACTION_TOO_LARGE",
}

/** Compiled wire bytes exceed Solana's packet limit. */
export class TransactionTooLargeError extends Error {
  readonly code = TransactionErrorCode.TransactionTooLarge;
  /** Actual encoded transaction length, including signature slots, in bytes. */
  readonly size: number;
  /** Maximum accepted wire length in bytes. */
  readonly limit: number;

  /** @param options - Actual size, packet limit, and a human-readable explanation. */
  constructor(options: {
    readonly size: number;
    readonly limit: number;
    readonly message: string;
  }) {
    super(options.message);
    this.name = "TransactionTooLargeError";
    this.size = options.size;
    this.limit = options.limit;
  }
}
