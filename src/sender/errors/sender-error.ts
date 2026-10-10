import type { SenderErrorCode } from "./codes.js";

/** Base class for sender failures before dispatch. Never contains credentials or remote bodies. */
export class SenderError extends Error {
  /**
   * @param code - Stable category.
   * @param message - Credential-free explanation.
   */
  constructor(
    readonly code: SenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
