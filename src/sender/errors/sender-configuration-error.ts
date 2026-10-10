import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/** Invalid client or provider configuration. */
export class SenderConfigurationError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.InvalidConfiguration, message);
  }
}
