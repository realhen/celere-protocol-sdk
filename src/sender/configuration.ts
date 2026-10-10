import { U64_MAX } from "../core/amounts.js";
import { isValidAddress } from "../core/addresses.js";
import { SenderConfigurationError } from "./errors/index.js";
import { isConfiguredProvider, validateTimeout } from "./providers/configuration.js";
import { RpcSender } from "./providers/rpc.js";
import { SenderProvider } from "./types.js";
import type { SenderRoute, SenderClientOptions } from "./types.js";
import type { ValidationResult } from "./validation.js";

/** Immutable provider metadata and the client-assigned observation identity. */
export interface ConfiguredRoute {
  readonly id: string;
  readonly config: SenderRoute;
}

/** Built-ins are already validated and immutable. Snapshot metadata for custom implementations. */
function configureRoute(route: SenderRoute): ValidationResult<SenderRoute> {
  if (isConfiguredProvider(route)) return { ok: true, value: route };
  if (
    !route ||
    !Object.values(SenderProvider).includes(route.provider) ||
    route.provider === SenderProvider.Rpc
  )
    return {
      ok: false,
      error: new SenderConfigurationError(
        "Use a provider route; defaultRpc supplies the RPC lane",
      ),
    };
  if (route.name !== undefined && (typeof route.name !== "string" || !route.name.trim()))
    return { ok: false, error: new SenderConfigurationError("Invalid route name") };
  const amounts = [route.minimumTipLamports, route.minimumPriorityFeeLamports];
  if (
    amounts.some((value) => typeof value !== "bigint" || value < 0n || value > U64_MAX) ||
    route.minimumTipLamports === 0n ||
    !Array.isArray(route.tipAccounts) ||
    !route.tipAccounts.length ||
    route.tipAccounts.some((value) => !isValidAddress(value)) ||
    typeof route.createRequest !== "function"
  )
    return {
      ok: false,
      error: new SenderConfigurationError(
        "Invalid provider requirements or request encoder",
      ),
    };
  const timeout = validateTimeout(route.timeoutMs);
  if (!timeout.ok) return timeout;
  return {
    ok: true,
    value: Object.freeze({
      provider: route.provider,
      ...(route.name === undefined ? {} : { name: route.name }),
      timeoutMs: timeout.value,
      minimumTipLamports: route.minimumTipLamports,
      minimumPriorityFeeLamports: route.minimumPriorityFeeLamports,
      tipAccounts: Object.freeze([...route.tipAccounts]),
      createRequest: route.createRequest.bind(route),
    }),
  };
}

/** Configure once, add the default RPC, and assign stable IDs. No network work is performed. */
export function configureSenderRoutes(
  options: SenderClientOptions,
): readonly ConfiguredRoute[] {
  if (!options?.defaultRpc) throw new SenderConfigurationError("defaultRpc is required");
  if (options.routes !== undefined && !Array.isArray(options.routes))
    throw new SenderConfigurationError("routes must be an array of providers");
  if (options.fetch !== undefined && typeof options.fetch !== "function")
    throw new SenderConfigurationError("fetch must be an HTTP transport function");
  const routes: SenderRoute[] = [];
  const names = new Set<string>();
  for (const route of options.routes ?? []) {
    const result = configureRoute(route);
    if (!result.ok) throw result.error;
    if (result.value.name !== undefined) {
      if (names.has(result.value.name))
        throw new SenderConfigurationError("Explicit route names must be unique");
      names.add(result.value.name);
    }
    routes.push(result.value);
  }
  return [
    { id: "rpc:0", config: new RpcSender(options.defaultRpc) },
    ...routes.map((config, index) => ({ id: `${config.provider}:${index + 1}`, config })),
  ];
}
