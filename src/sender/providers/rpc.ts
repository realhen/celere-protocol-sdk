import { SenderProvider } from "../types.js";
import type {
  RpcRouteOptions,
  SenderRoute,
  SenderTransactionPayload,
  SenderHttpRequest,
} from "../types.js";
import { validateEndpoint, validateTimeout } from "./configuration.js";

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
    if (!endpoint.ok) throw endpoint.error;
    const timeout = validateTimeout(options.timeoutMs);
    if (!timeout.ok) throw timeout.error;
    this.url = endpoint.value.toString();
    this.timeoutMs = timeout.value;
    Object.freeze(this);
  }

  createRequest(payload: SenderTransactionPayload): SenderHttpRequest {
    return createRpcRequest(this.url, payload);
  }
}
