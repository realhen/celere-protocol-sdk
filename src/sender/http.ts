import { HeliusSenderMode, SenderProvider, SubmissionStatus } from "./types.js";
import type { RouteResult, SenderRoute, SenderHttpTransport } from "./types.js";

import type { ConfiguredRoute } from "./configuration.js";
import type { SignedPayload } from "./sign-submission.js";

/** Use the runtime's standard HTTP implementation unless the caller supplies a transport. */
export function sendHttpRequest(url: string, options: RequestInit): Promise<Response> {
  return fetch(url, options);
}

/** Translate one already-signed transaction into the provider's HTTP request format. */
function getSubmissionRequest(
  route: SenderRoute,
  payload: SignedPayload,
): { url: string; init: RequestInit } {
  const url = new URL(route.endpoint);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: string | Uint8Array<ArrayBuffer>;
  const rpc = {
    jsonrpc: "2.0",
    id: "1",
    method: "sendTransaction",
    params: [payload.base64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
  };
  switch (route.provider) {
    case SenderProvider.Astralane:
      url.searchParams.set("api-key", route.apiKey);
      url.searchParams.set("method", "sendTransaction");
      headers["Content-Type"] = "application/octet-stream";
      body = Uint8Array.from(payload.bytes);
      break;
    case SenderProvider.BlockRazor:
      headers.apikey = route.apiKey;
      body = JSON.stringify({
        transaction: payload.base64,
        mode: "fast",
        revertProtection: false,
      });
      break;
    case SenderProvider.NextBlock:
      headers.Authorization = route.apiKey;
      body = JSON.stringify({
        transaction: { content: payload.base64 },
        skipPreFlight: true,
        frontRunningProtection: false,
        disableRetries: true,
      });
      break;
    case SenderProvider.Helius:
      url.searchParams.set("api-key", route.apiKey);
      if (route.mode === HeliusSenderMode.SwqosOnly)
        url.searchParams.set("swqos_only", "true");
      else url.searchParams.delete("swqos_only");
      body = JSON.stringify(rpc);
      break;
    case SenderProvider.ZeroSlot:
      url.searchParams.set("api-key", route.apiKey);
      body = JSON.stringify(rpc);
      break;
    case SenderProvider.Rpc:
      body = JSON.stringify(rpc);
      break;
  }
  return {
    url: url.toString(),
    init: { method: "POST", headers, body, redirect: "error" },
  };
}
function isResponseObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Accept only an acknowledgment of our exact signature; unrecognized bodies stay ambiguous. */
function getSubmissionStatus(value: unknown, signature: string): SubmissionStatus {
  if (
    isResponseObject(value) &&
    (value.error != null || value.reason != null || value.success === false)
  )
    return SubmissionStatus.Rejected;
  let returnedSignature: unknown = value;
  if (isResponseObject(value)) {
    returnedSignature = value.signature ?? value.result;
  }
  if (isResponseObject(returnedSignature)) {
    returnedSignature = returnedSignature.signature;
  }
  if (returnedSignature === signature) return SubmissionStatus.Accepted;
  // A missing/mismatched signature cannot establish acceptance or safe failure.
  return SubmissionStatus.Unknown;
}
/** One bounded attempt. Never retries or exposes raw provider bodies/URLs in observations. */
export async function sendRouteTransaction(
  route: ConfiguredRoute,
  payload: SignedPayload,
  transport: SenderHttpTransport,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const startedAt = performance.now();
  const routeIdentity = {
    routeId: route.id,
    provider: route.config.provider,
    signature: payload.signature,
    ...(route.config.name === undefined ? {} : { routeName: route.config.name }),
  };
  if (signal?.aborted)
    return { ...routeIdentity, status: SubmissionStatus.NotSubmitted, elapsedMs: 0 };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let httpStatus: number | undefined;
  try {
    // Race the complete request (including body reading) against cancellation. This
    // bounds our wait even when an injected transport ignores its abort signal.
    const interruption = new Promise<never>((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error("Submission interrupted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, route.config.timeoutMs);
    });
    const operation = (async () => {
      const { url, init } = getSubmissionRequest(route.config, payload);
      const response = await transport(url, { ...init, signal: controller.signal });
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        // Explicit client/rate-limit rejections differ from server failures, which
        // might happen after forwarding the transaction.
        return [400, 401, 403, 404, 413, 419, 422, 429].includes(response.status)
          ? SubmissionStatus.Rejected
          : SubmissionStatus.Unknown;
      }
      const raw = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw.trim();
      }
      return getSubmissionStatus(value, payload.signature);
    })();
    const status = await Promise.race([operation, interruption]);
    return {
      ...routeIdentity,
      status,
      elapsedMs: performance.now() - startedAt,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
  } catch {
    return {
      ...routeIdentity,
      status: SubmissionStatus.Unknown,
      elapsedMs: performance.now() - startedAt,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
