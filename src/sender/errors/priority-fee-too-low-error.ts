import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** The total priority fee is below a provider floor. */
export class PriorityFeeTooLowError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.PriorityFeeTooLow, message);
  }
}
