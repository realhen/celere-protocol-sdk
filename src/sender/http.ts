import { HeliusSenderMode, SenderProvider, SubmissionStatus } from "./types.js";
import type { RouteResult, SenderRoute } from "./types.js";

export interface DispatchRoute {
  readonly id: string;
  readonly config: SenderRoute;
}
export interface Payload {
  readonly signature: string;
  readonly bytes: Uint8Array;
  readonly base64: string;
}

function request(
  route: SenderRoute,
  payload: Payload,
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
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function responseStatus(value: unknown, signature: string): SubmissionStatus {
  if (
    object(value) &&
    (value.error != null || value.reason != null || value.success === false)
  )
    return SubmissionStatus.Rejected;
  const returned =
    typeof value === "string"
      ? value
      : object(value)
        ? (value.signature ?? value.result)
        : undefined;
  if (returned === signature) return SubmissionStatus.Accepted;
  if (object(returned) && returned.signature === signature)
    return SubmissionStatus.Accepted;
  // A missing/mismatched signature cannot establish acceptance or safe failure.
  return SubmissionStatus.Unknown;
}
/** One bounded attempt. Never retries or exposes raw provider bodies/URLs in observations. */
export async function dispatch(
  route: DispatchRoute,
  payload: Payload,
  fetcher: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const started = performance.now();
  const base = {
    routeId: route.id,
    provider: route.config.provider,
    signature: payload.signature,
    ...(route.config.name === undefined ? {} : { routeName: route.config.name }),
  };
  if (signal?.aborted)
    return { ...base, status: SubmissionStatus.NotSubmitted, elapsedMs: 0 };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let httpStatus: number | undefined;
  try {
    const interruption = new Promise<never>((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error("Submission interrupted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, route.config.timeoutMs);
    });
    const operation = (async () => {
      const { url, init } = request(route.config, payload);
      const response = await fetcher(url, { ...init, signal: controller.signal });
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
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
      return responseStatus(value, payload.signature);
    })();
    const status = await Promise.race([operation, interruption]);
    return {
      ...base,
      status,
      elapsedMs: performance.now() - started,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
  } catch {
    return {
      ...base,
      status: SubmissionStatus.Unknown,
      elapsedMs: performance.now() - started,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
