/** Serialized, verified transaction supplied to a provider's request encoder. */
export interface SenderTransactionPayload {
  /** Signed wire bytes; treat as readonly. */
  readonly bytes: Uint8Array;
  /** Base64 representation of the same signed bytes. */
  readonly base64: string;
  /** Locally verified fee-payer signature. */
  readonly signature: string;
}

/** A provider-encoded HTTP submission. URLs and headers may contain credentials. */
export interface SenderHttpRequest {
  /** Complete submission URL with authentication parameters, if required. */
  readonly url: string;
  /** POST body, headers and redirect policy; the shared transport adds cancellation. */
  readonly init: RequestInit;
}

/**
 * HTTP implementation used for each submission, compatible with the standard Fetch API.
 *
 * A custom transport can supply an application-managed connection pool or proxy. It should
 * honor the request's abort signal. The client bounds its own wait even if a custom transport
 * ignores cancellation; the application remains responsible for that transport's resources.
 *
 * @param url - Complete provider URL, including authentication query parameters when required.
 * @param options - POST body, headers, abort signal, and redirect policy supplied by the sender.
 * @returns The HTTP response, including its status and body. Do not log credentials in URLs or headers.
 */
export type SenderHttpTransport = (
  url: string,
  options: RequestInit,
) => Promise<Response>;
