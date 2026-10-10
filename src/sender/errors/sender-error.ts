import type { SenderErrorCode } from "./codes.js";

/**
 * Common base for preparation, configuration, and signing failures before HTTP dispatch.
 *
 * @remarks
 * Constructors and `SenderClient.prepare` throw synchronously; `send` and `submitSigned`
 * reject their promises. Catch a subclass for a specific category or inspect `code` when
 * errors cross a serialization boundary where `instanceof` no longer works. SDK-generated
 * messages exclude provider credentials and raw remote response bodies.
 *
 * Once requests have been dispatched, provider failures are `RouteResult` values in
 * `submission.results`. They do not become SenderError exceptions or cancel other routes.
 *
 * @example
 * ```ts
 * import { SenderError, SenderSigningError, type SenderClient, type SendRequest } from "celere-protocol-sdk/sender";
 * declare const sender: SenderClient;
 * declare const request: SendRequest;
 * try {
 *   const submission = await sender.send(request);
 *   const signatures = submission.variants.map(variant => variant.signature);
 * } catch (error) {
 *   if (error instanceof SenderSigningError) {
 *     // No dispatch occurred; inspect the application's wallet/signing integration.
 *   } else if (error instanceof SenderError) {
 *     const category = error.code;
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
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
