import { SubmissionStatus } from "./submission";
import type { RouteResult } from "./submission";
import type { ConfiguredRoute } from "./providers/configuration";
import type { SignedPayload } from "./transaction";

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
      const { url, init } = route.config.createRequest(payload);
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
