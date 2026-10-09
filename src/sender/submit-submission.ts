import { sendRouteTransaction } from "./http.js";
import type { ConfiguredRoute } from "./configuration.js";
import type { SignedPayload } from "./sign-submission.js";
import type {
  PreparedVariant,
  SenderHttpTransport,
  Submission,
  SubmitSignedOptions,
} from "./types.js";

/** Launch every route before returning; only the results promise waits for HTTP responses. */
export function submitTransactionVariants(
  routes: readonly ConfiguredRoute[],
  variants: readonly PreparedVariant[],
  payloads: readonly SignedPayload[],
  transport: SenderHttpTransport,
  options: SubmitSignedOptions,
): Submission {
  const results = routes.map((route) => {
    const index = variants.findIndex((variant) => variant.routeIds.includes(route.id));
    return sendRouteTransaction(route, payloads[index]!, transport, options.signal).then(
      (result) => {
        const onRouteResult = options.onRouteResult;
        if (onRouteResult) {
          // Observation is application work: neither slow callbacks nor callback failures
          // should delay the transport results or affect another route's submission.
          void Promise.resolve()
            .then(() => onRouteResult(result))
            .catch(() => {});
        }
        return result;
      },
    );
  });
  return {
    variants: payloads.map((payload, index) => ({
      signature: payload.signature,
      routeIds: [...variants[index]!.routeIds],
      wireBytes: Uint8Array.from(payload.bytes),
    })),
    results: Promise.all(results),
  };
}
