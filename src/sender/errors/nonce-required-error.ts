import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when preparation would produce multiple distinct transaction variants without a
 * shared durable nonce.
 *
 * @remarks
 * Supply a current nonce snapshot exclusively selected for this logical trade. A recent
 * blockhash alone cannot arbitrate different tipped messages.
 * @see SenderError for common error handling and stable code access.
 */
export class NonceRequiredError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.NonceRequired, message);
  }
}
