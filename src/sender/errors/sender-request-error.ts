import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** Malformed send inputs or a preparation record belonging to another client. */
export class SenderRequestError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.InvalidRequest, message);
  }
}
