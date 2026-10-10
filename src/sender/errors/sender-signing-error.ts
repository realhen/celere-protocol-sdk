import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** Required signatures are missing, invalid, or attached to altered messages. */
export class SenderSigningError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.SigningFailed, message);
  }
}
