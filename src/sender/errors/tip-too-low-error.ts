import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** A per-send tip is below the configured provider floor. */
export class TipTooLowError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.TipTooLow, message);
  }
}
