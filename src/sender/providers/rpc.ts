import { SenderProvider } from "./route";
import type { SenderRoute } from "./route";
import type { SenderTransactionPayload } from "../transaction";
import type { SenderHttpRequest } from "../transport";
import { validateEndpoint, validateTimeout } from "./configuration";

/** Default RPC route, always submitted alongside the configured provider routes. */
export interface RpcRouteOptions {
  /** Full RPC URL. This endpoint receives the untipped variant. */
  readonly url: string;
  /** HTTP deadline in milliseconds, including reading the body. Integer 1–60,000; default 3,000. */
  readonly timeoutMs?: number;
}

/** Common Solana JSON-RPC encoding used by RPC, 0slot, and Helius. */
export function createRpcRequest(
  url: string,
  payload: SenderTransactionPayload,
): SenderHttpRequest {
  return {
    url,
    init: {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "sendTransaction",
        params: [
          payload.base64,
          { encoding: "base64", skipPreflight: true, maxRetries: 0 },
        ],
      }),
    },
  };
}

/** Mandatory untipped RPC lane; constructed internally by SenderClient. */
export class RpcSender implements SenderRoute {
  readonly provider = SenderProvider.Rpc;
  readonly minimumTipLamports = 0n;
  readonly minimumPriorityFeeLamports = 0n;
  readonly tipAccounts = Object.freeze([]);
  readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: RpcRouteOptions) {
    const endpoint = validateEndpoint(options.url);
    const timeout = validateTimeout(options.timeoutMs);
    this.url = endpoint.toString();
    this.timeoutMs = timeout;
    Object.freeze(this);
  }

  createRequest(payload: SenderTransactionPayload): SenderHttpRequest {
    return createRpcRequest(this.url, payload);
  }
}
