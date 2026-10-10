import { SenderErrorCode } from "./codes.js";
import { SenderError } from "./sender-error.js";

/**
 * Raised while constructing a client or provider when caller-controlled configuration is
 * invalid.
 *
 * @remarks
 * Check the endpoint, credentials, region, deadline, or duplicate route names. No network
 * request is made during construction.
 * @see SenderError for common error handling and stable code access.
 */
export class SenderConfigurationError extends SenderError {
  /** @param message - Explanation safe to expose without provider credentials. */
  constructor(message: string) {
    super(SenderErrorCode.InvalidConfiguration, message);
  }
}
