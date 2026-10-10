import { SenderConfigurationError } from "../errors/index.js";
import type { Region, RouteOptions, SenderRoute } from "../types.js";
import type { ValidationResult } from "../validation.js";

/** Built-in providers validate their inputs once, before the client receives them. */
const configuredProviders = new WeakSet<SenderRoute>();

/** Mark a fully initialized, frozen built-in provider so clients need not validate it again. */
export function registerProvider(provider: SenderRoute): void {
  configuredProviders.add(provider);
}

/** Custom implementations are checked at the client boundary instead. */
export function isConfiguredProvider(provider: SenderRoute): boolean {
  return configuredProviders.has(provider);
}

/** Parse caller-controlled URLs without returning credentials in error messages. */
export function validateEndpoint(endpoint: string): ValidationResult<URL> {
  try {
    const url = new URL(endpoint);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return {
        ok: false,
        error: new SenderConfigurationError(
          "Expected an HTTP(S) endpoint without userinfo or fragment",
        ),
      };
    }
    return { ok: true, value: url };
  } catch {
    return {
      ok: false,
      error: new SenderConfigurationError(
        "Expected an HTTP(S) endpoint without userinfo or fragment",
      ),
    };
  }
}

/** Validate caller deadlines; defaults are applied only during configuration. */
export function validateTimeout(timeoutMs = 3000): ValidationResult<number> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    return {
      ok: false,
      error: new SenderConfigurationError(
        "timeoutMs must be an integer from 1 through 60000",
      ),
    };
  return { ok: true, value: timeoutMs };
}

/** Normalized options retained by a provider constructor; contains credentials in the URL. */
interface ProviderConfiguration {
  readonly url: URL;
  readonly name: string | undefined;
  readonly timeoutMs: number;
}

/** Check user input once. Built-in endpoint literals bypass custom-URL policy checks. */
export function configureProvider(
  options: RouteOptions,
  endpoints: Partial<Record<Region, string>>,
  defaultRegion: Region,
): ValidationResult<ProviderConfiguration> {
  if (
    !options ||
    typeof options.apiKey !== "string" ||
    !options.apiKey.trim() ||
    /[\r\n]/.test(options.apiKey)
  )
    return {
      ok: false,
      error: new SenderConfigurationError("A nonempty provider API key is required"),
    };
  if (
    options.name !== undefined &&
    (typeof options.name !== "string" || !options.name.trim())
  )
    return {
      ok: false,
      error: new SenderConfigurationError("Route name must be nonempty"),
    };
  const region = options.region ?? defaultRegion;
  if (!Object.hasOwn(endpoints, region))
    return {
      ok: false,
      error: new SenderConfigurationError("Unsupported provider region"),
    };
  const endpoint =
    options.endpoint === undefined
      ? { ok: true as const, value: new URL(endpoints[region]!) }
      : validateEndpoint(options.endpoint);
  if (!endpoint.ok) return endpoint;
  const timeout = validateTimeout(options.timeoutMs);
  if (!timeout.ok) return timeout;
  return {
    ok: true,
    value: { url: endpoint.value, name: options.name, timeoutMs: timeout.value },
  };
}
