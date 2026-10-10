import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when send inputs are malformed or signed transactions do not match a preparation
 * record owned by the client.
 *
 * @remarks
 * Check fee units, required inputs, variant count, and the identity of the prepared object.
 * This failure occurs before dispatch.
 * @see SenderError for common error handling and stable code access.
 */
export class SenderRequestError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.InvalidRequest, message);
  }
}
