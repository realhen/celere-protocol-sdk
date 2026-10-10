import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when a per-send provider tip is below that lane’s configured minimum.
 *
 * @remarks
 * Choose the actual tip explicitly in SenderFees or select an eligible provider plan. The SDK
 * never silently increases a fee. No variant is dispatched.
 * @see SenderError for common error handling and stable code access.
 */
export class TipTooLowError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.TipTooLow, message);
  }
}
