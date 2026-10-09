import { address } from "@solana/kit";
import {
  HeliusSenderMode,
  Region,
  SenderError,
  SenderErrorCode,
  SenderProvider,
} from "./types.js";
import type { RouteOptions, SenderRoute } from "./types.js";

const endpoints: Record<
  Exclude<SenderProvider, SenderProvider.Rpc>,
  Partial<Record<Region, string>>
> = {
  [SenderProvider.Astralane]: {
    [Region.Global]: "https://edge.astralane.io/irisb",
    [Region.Frankfurt]: "http://fr.gateway.astralane.io/irisb",
    [Region.Amsterdam]: "http://ams.gateway.astralane.io/irisb",
    [Region.NewYork]: "http://ny.gateway.astralane.io/irisb",
    [Region.Tokyo]: "http://jp.gateway.astralane.io/irisb",
    [Region.Singapore]: "http://sg.gateway.astralane.io/irisb",
    [Region.LosAngeles]: "http://la.gateway.astralane.io/irisb",
  },
  [SenderProvider.BlockRazor]: {
    [Region.Frankfurt]: "https://frankfurt.solana.blockrazor.io/sendTransaction",
    [Region.NewYork]: "https://newyork.solana.blockrazor.io/sendTransaction",
    [Region.Tokyo]: "https://tokyo.solana.blockrazor.io/sendTransaction",
    [Region.Amsterdam]: "http://amsterdam.solana.blockrazor.xyz:443/sendTransaction",
    [Region.London]: "http://london.solana.blockrazor.xyz:443/sendTransaction",
    [Region.Singapore]: "http://singapore.solana.blockrazor.xyz:443/sendTransaction",
    [Region.LosAngeles]: "http://losangeles.solana.blockrazor.xyz:443/sendTransaction",
    [Region.Toronto]: "http://toronto.solana.blockrazor.xyz:443/sendTransaction",
  },
  [SenderProvider.ZeroSlot]: {
    [Region.Frankfurt]: "https://de.0slot.trade",
    [Region.Amsterdam]: "https://ams.0slot.trade",
    [Region.NewYork]: "https://ny.0slot.trade",
    [Region.Tokyo]: "https://jp.0slot.trade",
    [Region.LosAngeles]: "https://la.0slot.trade",
  },
  [SenderProvider.NextBlock]: {
    [Region.Frankfurt]: "https://frankfurt.nextblock.io/api/v2/submit",
    [Region.Amsterdam]: "https://amsterdam.nextblock.io/api/v2/submit",
    [Region.NewYork]: "https://ny.nextblock.io/api/v2/submit",
    [Region.London]: "https://london.nextblock.io/api/v2/submit",
    [Region.Singapore]: "https://singapore.nextblock.io/api/v2/submit",
    [Region.Tokyo]: "https://tokyo.nextblock.io/api/v2/submit",
    [Region.SaltLakeCity]: "https://slc.nextblock.io/api/v2/submit",
    [Region.Dublin]: "https://dublin.nextblock.io/api/v2/submit",
    [Region.Vilnius]: "https://vilnius.nextblock.io/api/v2/submit",
  },
  [SenderProvider.Helius]: {
    [Region.Global]: "https://sender.helius-rpc.com/fast",
    [Region.Frankfurt]: "http://fra-sender.helius-rpc.com/fast",
    [Region.Amsterdam]: "http://ams-sender.helius-rpc.com/fast",
    [Region.NewYork]: "http://ewr-sender.helius-rpc.com/fast",
    [Region.London]: "http://lon-sender.helius-rpc.com/fast",
    [Region.Tokyo]: "http://tyo-sender.helius-rpc.com/fast",
    [Region.Singapore]: "http://sg-sender.helius-rpc.com/fast",
    [Region.SaltLakeCity]: "http://slc-sender.helius-rpc.com/fast",
  },
};
// Provider-published recipients; provenance and validation status are documented in README.
const tips = {
  [SenderProvider.Astralane]: [
    "astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF",
    "astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm",
  ],
  [SenderProvider.BlockRazor]: [
    "FjmZZrFvhnqqb9ThCuMVnENaM3JGVuGWNyCAxRJcFpg9",
    "6No2i3aawzHsjtThw81iq1EXPJN6rh8eSJCLaYZfKDTG",
  ],
  [SenderProvider.ZeroSlot]: [
    "6fQaVhYZA4w3MBSXjJ81Vf6W1EDYeUPXpgVQ6UQyU1Av",
    "4HiwLEP2Bzqj3hM2ENxJuzhcPCdsafwiet3oGkMkuQY4",
  ],
  [SenderProvider.NextBlock]: [
    "NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE",
    "NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2",
  ],
  [SenderProvider.Helius]: [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  ],
};
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
function route(
  provider: Exclude<SenderProvider, SenderProvider.Rpc>,
  options: RouteOptions,
  minimum: bigint,
  mode?: HeliusSenderMode,
): SenderRoute {
  const region =
    options.region ??
    (provider === SenderProvider.Helius || provider === SenderProvider.Astralane
      ? Region.Global
      : Region.Frankfurt);
  if (!(region in endpoints[provider]))
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
    endpoint: validateEndpoint(options.endpoint ?? endpoints[provider][region]!),
    apiKey: options.apiKey,
    timeoutMs: validateTimeout(options.timeoutMs),
    minimumTipLamports: minimum,
    tipAccounts: Object.freeze(tips[provider].map((value) => address(value))),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(mode === undefined ? {} : { mode }),
  });
}
/** Astralane binary Iris lane. Regions share the same per-send tip variant. */
export function astralane(options: RouteOptions): SenderRoute {
  return route(SenderProvider.Astralane, options, 10_000n);
}
/** BlockRazor fast mode. Sandwich mitigation is intentionally excluded from nonce fan-out. */
export function blockRazor(options: RouteOptions): SenderRoute {
  return route(SenderProvider.BlockRazor, options, 100_000n);
}
/** 0slot defaults to the documented entry-tier minimum. Advanced plans can explicitly select their documented floor. */
export function zeroSlot(
  options: RouteOptions & { readonly minimumTipLamports?: 100_000n | 1_000_000n },
): SenderRoute {
  const minimum = options.minimumTipLamports ?? 1_000_000n;
  if (minimum !== 100_000n && minimum !== 1_000_000n)
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Unsupported 0slot plan minimum",
    );
  return route(SenderProvider.ZeroSlot, options, minimum);
}
/** NextBlock HTTP v2 submission; no retries or front-running protection requested. */
export function nextBlock(options: RouteOptions): SenderRoute {
  return route(SenderProvider.NextBlock, options, 100_000n);
}
/** Helius Sender Max or explicitly selected SWQoS-only tier. */
export function heliusSender(
  options: RouteOptions & { readonly mode?: HeliusSenderMode },
): SenderRoute {
  const mode = options.mode ?? HeliusSenderMode.Max;
  if (!Object.values(HeliusSenderMode).includes(mode))
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Unsupported Helius mode",
    );
  return route(
    SenderProvider.Helius,
    options,
    mode === HeliusSenderMode.Max ? 1_000_000n : 5_000n,
    mode,
  );
}
