import { address } from "@solana/kit";
import {
  AstralaneTier,
  HeliusSenderMode,
  Region,
  SenderError,
  SenderErrorCode,
  SenderProvider,
} from "./types.js";
import type {
  AstralaneRouteOptions,
  RouteOptions,
  SenderRoute,
  ZeroSlotRouteOptions,
  HeliusRouteOptions,
} from "./types.js";

import { PROVIDER_ENDPOINTS, PROVIDER_TIP_ACCOUNTS } from "./provider-registry.js";

/** Validate a URL without including its credentials in any error. */
export function validateEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Expected an HTTP(S) endpoint without userinfo or fragment",
    );
  }
}
/** Bound per-route resource lifetime; no timeout means no safe aggregate completion. */
export function validateTimeout(value = 3000): number {
  if (!Number.isInteger(value) || value < 1 || value > 60_000)
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "timeoutMs must be an integer from 1 through 60000",
    );
  return value;
}
/** Resolve provider defaults and copy the route without starting network work. */
function createProviderRoute(
  provider: Exclude<SenderProvider, SenderProvider.Rpc>,
  options: RouteOptions,
  minimumTipLamports: bigint,
  mode?: HeliusSenderMode,
): SenderRoute {
  const region =
    options.region ??
    (provider === SenderProvider.Helius || provider === SenderProvider.Astralane
      ? Region.Global
      : Region.Frankfurt);
  if (!(region in PROVIDER_ENDPOINTS[provider]))
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      `Unsupported region for ${provider}`,
    );
  if (
    typeof options.apiKey !== "string" ||
    !options.apiKey.trim() ||
    /[\r\n]/.test(options.apiKey)
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "A nonempty provider API key is required",
    );
  if (
    options.name !== undefined &&
    (typeof options.name !== "string" || !options.name.trim())
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Route name must be nonempty",
    );
  return Object.freeze({
    provider,
    endpoint: validateEndpoint(options.endpoint ?? PROVIDER_ENDPOINTS[provider][region]!),
    apiKey: options.apiKey,
    timeoutMs: validateTimeout(options.timeoutMs),
    minimumTipLamports,
    tipAccounts: Object.freeze(
      PROVIDER_TIP_ACCOUNTS[provider].map((value) => address(value)),
    ),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(mode === undefined ? {} : { mode }),
  });
}
/**
 * Configure an Astralane binary Iris submission lane.
 *
 * @param options - Provider credentials, fee tier, and optional region, URL, name, and deadline.
 * @returns An immutable route using `/irisb`, with a 1,000,000-lamport Free-tier minimum tip.
 * @throws {@link SenderError} synchronously for invalid options or an unsupported region.
 * @remarks Defaults to the global endpoint. Compatible regional lanes reuse one signed
 * variant. VIP 1/2 allow 100,000 lamports; VIP 3 allows 10,000. Select only a tier your key
 * is eligible for. Constructing a route does not contact the provider or validate the API key remotely.
 *
 * @example
 * ```ts
 * import { astralane, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = astralane({ apiKey, region: Region.Frankfurt });
 * ```
 */
export function astralane(options: AstralaneRouteOptions): SenderRoute {
  const tier = options.tier ?? AstralaneTier.Free;
  const minimums: Record<AstralaneTier, bigint> = {
    [AstralaneTier.Free]: 1_000_000n,
    [AstralaneTier.Vip1]: 100_000n,
    [AstralaneTier.Vip2]: 100_000n,
    [AstralaneTier.Vip3]: 10_000n,
  };
  if (!Object.values(AstralaneTier).includes(tier))
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Unsupported Astralane fee tier",
    );
  return createProviderRoute(SenderProvider.Astralane, options, minimums[tier]);
}
/**
 * Configure a BlockRazor HTTP lane in fast mode.
 *
 * @param options - Provider credentials and optional region, URL, name, and HTTP deadline.
 * @returns An immutable route with a 100,000-lamport minimum tip; Frankfurt by default.
 * @throws {@link SenderError} synchronously for invalid options or an unsupported region.
 * @remarks Sandwich mitigation is excluded because it is incompatible with nonce fan-out.
 * Configuration performs no network requests.
 *
 * @example
 * ```ts
 * import { blockRazor, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = blockRazor({ apiKey, region: Region.NewYork });
 * ```
 */
export function blockRazor(options: RouteOptions): SenderRoute {
  return createProviderRoute(SenderProvider.BlockRazor, options, 100_000n);
}
/**
 * Configure a 0slot HTTP submission lane for the caller's provisioned plan.
 *
 * @param options - Provider configuration and optional advanced-plan tip floor.
 * @returns An immutable route with a 1,000,000-lamport default tip floor; Frankfurt by default.
 * @throws {@link SenderError} synchronously for invalid options, plan floor, or region.
 * @remarks Selecting the 100,000-lamport floor requires an eligible provider plan. Actual
 * transaction tips are supplied per send; this option only selects validation policy.
 * Configuration performs no network requests.
 *
 * @example
 * ```ts
 * import { zeroSlot, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = zeroSlot({ apiKey, region: Region.Frankfurt });
 * ```
 */
export function zeroSlot(options: ZeroSlotRouteOptions): SenderRoute {
  const minimum = options.minimumTipLamports ?? 1_000_000n;
  if (minimum !== 100_000n && minimum !== 1_000_000n)
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Unsupported 0slot plan minimum",
    );
  return createProviderRoute(SenderProvider.ZeroSlot, options, minimum);
}
/**
 * Configure a NextBlock HTTP v2 submission lane.
 *
 * @param options - Provider credentials and optional region, URL, name, and HTTP deadline.
 * @returns An immutable route with a 100,000-lamport minimum tip; Frankfurt by default.
 * @throws {@link SenderError} synchronously for invalid options or an unsupported region.
 * @remarks Requests skip preflight and disable provider retries and front-running protection.
 * Configuration performs no network requests.
 *
 * @example
 * ```ts
 * import { nextBlock, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = nextBlock({ apiKey, region: Region.Amsterdam });
 * ```
 */
export function nextBlock(options: RouteOptions): SenderRoute {
  return createProviderRoute(SenderProvider.NextBlock, options, 100_000n);
}
/**
 * Configure a Helius Sender Max or SWQoS-only HTTP submission lane.
 *
 * @param options - Provider configuration and optional Helius tier; Max by default.
 * @returns An immutable route, using the global endpoint unless a region is supplied.
 * @throws {@link SenderError} synchronously for invalid options, tier, or region.
 * @remarks Max requires a 1,000,000-lamport tip and a 5,000-lamport total priority fee.
 * SWQoS-only requires a 5,000-lamport tip. The sender validates these amounts before signing.
 * Configuration performs no network requests.
 *
 * @example
 * ```ts
 * import { heliusSender, HeliusSenderMode } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = heliusSender({ apiKey, mode: HeliusSenderMode.Max });
 * ```
 */
export function heliusSender(options: HeliusRouteOptions): SenderRoute {
  const mode = options.mode ?? HeliusSenderMode.Max;
  if (!Object.values(HeliusSenderMode).includes(mode))
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Unsupported Helius mode",
    );
  return createProviderRoute(
    SenderProvider.Helius,
    options,
    mode === HeliusSenderMode.Max ? 1_000_000n : 5_000n,
    mode,
  );
}
