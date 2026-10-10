import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when signing fails, required signatures are missing or invalid, or signed messages
 * differ from the prepared messages.
 *
 * @remarks
 * Provide all required partial signers and preserve each message byte. Signer exceptions,
 * including cancellation reported by a signer, are normalized to this error. No routes have
 * been dispatched.
 * @see SenderError for common error handling and stable code access.
 */
export class SenderSigningError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.SigningFailed, message);
  }
}
