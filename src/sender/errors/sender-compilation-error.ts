import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised when the offline compiler cannot build a transaction variant, including oversized
 * messages or invalid instructions.
 *
 * @remarks
 * Inspect instructions, account roles, lookup tables, and lifetime inputs. No signing or HTTP
 * dispatch occurs for a compilation failure.
 * @see SenderError for common error handling and stable code access.
 */
export class SenderCompilationError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.CompilationFailed, message);
  }
}
