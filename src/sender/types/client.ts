import type { SenderRoute } from "./providers.js";
import type { SenderHttpTransport } from "./transport.js";

/** Default RPC route, always submitted alongside the configured provider routes. */
export interface RpcRouteOptions {
  /** Full RPC URL. This endpoint receives the untipped variant. */
  readonly url: string;
  /** HTTP deadline in milliseconds, including reading the body. Integer 1–60,000; default 3,000. */
  readonly timeoutMs?: number;
}

/** Configuration for the reusable sender client. */
export interface SenderClientOptions {
  /** Mandatory RPC route; provider lanes supplement it rather than replace it. */
  readonly defaultRpc: RpcRouteOptions;
  /**
   * Optional HTTP implementation. Defaults to the runtime's standard `fetch` in Node,
   * browsers, and workers. The sender does not open connections during construction.
   * Lifecycle of an injected connection pool belongs to the application.
   */
  readonly fetch?: SenderHttpTransport;
  /** Initial provider lanes. Multiple regions of the same provider are supported. */
  readonly routes?: readonly SenderRoute[];
}
