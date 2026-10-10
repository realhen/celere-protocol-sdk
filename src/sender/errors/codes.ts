/** Stable error codes for preparation/configuration/signing failures, before any dispatch. */
export enum SenderErrorCode {
  /** Invalid client, route, endpoint, or provider options. */
  InvalidConfiguration = "INVALID_CONFIGURATION",
  /** Malformed preparation inputs or a plan not owned by this client. */
  InvalidRequest = "INVALID_REQUEST",
  /** Distinct transaction variants were requested without a shared durable nonce. */
  NonceRequired = "NONCE_REQUIRED",
  /** The per-send tip is below a configured provider's minimum. */
  TipTooLow = "TIP_TOO_LOW",
  /** The total priority fee is below a configured provider's minimum. */
  PriorityFeeTooLow = "PRIORITY_FEE_TOO_LOW",
  /** The offline compiler rejected the transaction, for example because it exceeds packet size. */
  CompilationFailed = "COMPILATION_FAILED",
  /** A signer failed, a message changed, or required signatures were missing or invalid. */
  SigningFailed = "SIGNING_FAILED",
  /** Cancellation was observed before HTTP dispatch. */
  Aborted = "ABORTED",
}
