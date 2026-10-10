import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when the client observes cancellation before signing or before HTTP dispatch.
 *
 * @remarks
 * Cancellation during an HTTP attempt is represented by route results instead. It cannot
 * retract a transaction already submitted or establish that a nonce is reusable.
 * @see SenderError for common error handling and stable code access.
 */
export class SenderAbortedError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.Aborted, message);
  }
}
