import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** Distinct transaction variants need one shared durable nonce. */
export class NonceRequiredError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.NonceRequired, message);
  }
}
