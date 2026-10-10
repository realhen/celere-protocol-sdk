import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** Cancellation was observed before HTTP dispatch. */
export class SenderAbortedError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.Aborted, message);
  }
}
