import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** The offline transaction compiler rejected the instructions or message. */
export class SenderCompilationError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.CompilationFailed, message);
  }
}
