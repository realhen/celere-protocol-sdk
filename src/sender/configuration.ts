import { U64_MAX } from "../core/amounts.js";
import { isValidAddress } from "../core/addresses.js";
import { validateEndpoint, validateTimeout } from "./providers.js";
import {
  HeliusSenderMode,
  SenderError,
  SenderErrorCode,
  SenderProvider,
} from "./types.js";
import type { SenderRoute, SenderClientOptions } from "./types.js";

/** A validated provider configuration paired with its client-assigned result ID. */
export interface ConfiguredRoute {
  readonly id: string;
  readonly config: SenderRoute;
}

/** Validate and copy caller-owned route configuration before retaining it in a client. */
export function copySenderRoute(route: SenderRoute): SenderRoute {
  if (
    !Object.values(SenderProvider).includes(route.provider) ||
    route.provider === SenderProvider.Rpc
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Use defaultRpc for RPC submission",
    );
  if (!route.apiKey || /[\r\n]/.test(route.apiKey))
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid API key");
  if (route.name !== undefined && (typeof route.name !== "string" || !route.name.trim()))
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid route name");
  if (
    typeof route.minimumTipLamports !== "bigint" ||
    route.minimumTipLamports <= 0n ||
    route.minimumTipLamports > U64_MAX ||
    !route.tipAccounts?.length ||
    route.tipAccounts.some((tipAccount) => !isValidAddress(tipAccount))
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Invalid route tip requirements",
    );
  if (
    route.provider === SenderProvider.Helius &&
    !Object.values(HeliusSenderMode).includes(route.mode!)
  )
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid Helius tier");
  return Object.freeze({
    ...route,
    endpoint: validateEndpoint(route.endpoint),
    timeoutMs: validateTimeout(route.timeoutMs),
    tipAccounts: Object.freeze([...route.tipAccounts]),
  });
}

/** Add the mandatory untipped RPC lane and assign stable IDs within this client. */
export function configureSenderRoutes(
  options: SenderClientOptions,
): readonly ConfiguredRoute[] {
  if (!options?.defaultRpc)
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "defaultRpc is required");
  const routes = (options.routes ?? []).map(copySenderRoute);
  const names = routes.flatMap((route) => (route.name === undefined ? [] : [route.name]));
  if (new Set(names).size !== names.length)
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Explicit route names must be unique",
    );
  return [
    {
      id: "rpc:0",
      config: {
        provider: SenderProvider.Rpc,
        endpoint: validateEndpoint(options.defaultRpc.url),
        apiKey: "",
        timeoutMs: validateTimeout(options.defaultRpc.timeoutMs),
        minimumTipLamports: 0n,
        tipAccounts: [],
      },
    },
    ...routes.map((config, index) => ({ id: `${config.provider}:${index + 1}`, config })),
  ];
}
