import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when the total priority fee is below a configured lane’s required minimum.
 *
 * @remarks
 * The fee is ceil(computeUnitLimit × computeUnitPriceMicroLamports / 1,000,000) lamports.
 * Adjust the per-send price or limit deliberately; this is not a provider tip.
 * @see SenderError for common error handling and stable code access.
 */
export class PriorityFeeTooLowError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.PriorityFeeTooLow, message);
  }
}
