import { U64_MAX } from "../core/amounts.js";
import { SenderRequestError, PriorityFeeTooLowError } from "./errors/index.js";
import { SenderProvider } from "./types.js";
import type { PrepareRequest } from "./types.js";
import type { ConfiguredRoute } from "./configuration.js";
import type { ValidationResult } from "./validation.js";

/** A fee is an atomic, non-negative u64 amount. No coercion or implicit fee adjustment. */
function isFeeAmount(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= U64_MAX;
}

/** Return expected input failures as values; the public preparation boundary decides how to surface them. */
export function validatePreparationRequest(
  request: PrepareRequest,
  routes: readonly ConfiguredRoute[],
): ValidationResult<PrepareRequest> {
  if (
    !request ||
    !request.fees ||
    !Array.isArray(request.instructions) ||
    request.instructions.length === 0
  )
    return {
      ok: false,
      error: new SenderRequestError("At least one instruction and fees are required"),
    };
  if (Boolean(request.nonce) === Boolean(request.lifetime))
    return {
      ok: false,
      error: new SenderRequestError("Supply exactly one nonce or blockhash lifetime"),
    };
  const fees = request.fees;
  if (!isFeeAmount(fees.tipLamports) || !isFeeAmount(fees.computeUnitPriceMicroLamports))
    return {
      ok: false,
      error: new SenderRequestError("Fee amounts must be non-negative u64 bigint values"),
    };
  if (
    !Number.isInteger(fees.computeUnitLimit) ||
    fees.computeUnitLimit <= 0 ||
    fees.computeUnitLimit > 1_400_000
  )
    return {
      ok: false,
      error: new SenderRequestError(
        "Compute unit limit must be an integer from 1 through 1400000",
      ),
    };
  // Solana rounds the total priority fee up to whole lamports, not the per-CU price.
  const priorityFeeLamports =
    (BigInt(fees.computeUnitLimit) * fees.computeUnitPriceMicroLamports + 999_999n) /
    1_000_000n;
  for (const route of routes) {
    if (priorityFeeLamports < route.config.minimumPriorityFeeLamports)
      return {
        ok: false,
        error: new PriorityFeeTooLowError(`Priority fee below minimum for ${route.id}`),
      };
  }
  for (const [provider, amount] of Object.entries(fees.tipOverrides ?? {})) {
    if (
      provider === SenderProvider.Rpc ||
      !routes.some((route) => route.config.provider === provider)
    )
      return {
        ok: false,
        error: new SenderRequestError("Tip override refers to an unconfigured provider"),
      };
    if (!isFeeAmount(amount))
      return {
        ok: false,
        error: new SenderRequestError(
          "Tip overrides must be non-negative u64 bigint values",
        ),
      };
  }
  return { ok: true, value: request };
}
