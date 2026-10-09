import { SenderClient } from "./client.js";
import { copySenderRoute } from "./configuration.js";
import type { SenderClientOptions, SenderRoute } from "./types.js";
import { SenderError, SenderErrorCode } from "./types.js";

// Builder configuration also contains API keys. Retain it outside enumerable instance fields.
const builderOptions = new WeakMap<SenderClientBuilder, SenderClientOptions>();

function getBuilderOptions(builder: SenderClientBuilder): SenderClientOptions {
  const options = builderOptions.get(builder);
  if (!options)
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Builder methods require their original instance",
    );
  return options;
}

/**
 * Accumulates sender routes without opening connections or signing transactions.
 *
 * Each configuration method returns a new builder. Retain its result when adding lanes;
 * clients and builders created earlier keep their original configuration.
 *
 * @see {@link createSenderClient} for a complete configuration example.
 */
export class SenderClientBuilder {
  /** @param options - Initial default RPC, provider lanes, and optional HTTP transport. */
  constructor(options: SenderClientOptions) {
    builderOptions.set(this, {
      ...options,
      defaultRpc: { ...options.defaultRpc },
      routes: (options.routes ?? []).map(copySenderRoute),
    });
  }

  /**
   * Append one provider lane, including another region of an existing provider.
   *
   * @param route - Configuration returned by a provider factory such as {@link astralane}.
   * @returns A new builder containing the additional lane.
   * @throws {@link SenderError} synchronously if the route is invalid.
   */
  addRoute(route: SenderRoute): SenderClientBuilder {
    return this.addRoutes([route]);
  }

  /**
   * Append several provider lanes in the supplied order.
   *
   * @param routes - Provider configurations to copy into the new builder.
   * @returns A new builder; does not modify the supplied array or existing configuration.
   * @throws {@link SenderError} synchronously if any route is invalid.
   */
  addRoutes(routes: readonly SenderRoute[]): SenderClientBuilder {
    const options = getBuilderOptions(this);
    return new SenderClientBuilder({
      ...options,
      routes: [...(options.routes ?? []), ...routes],
    });
  }

  /**
   * Validate the completed configuration and create a reusable sender.
   *
   * @returns A client with its own copied route configuration and preparation records.
   * @throws {@link SenderError} synchronously if configuration is invalid, including
   * duplicate explicit route names. No network requests are made.
   */
  build(): SenderClient {
    return new SenderClient(getBuilderOptions(this));
  }
}

/**
 * Start fluent configuration of a sender with a mandatory default RPC route.
 *
 * @param options - Default RPC, optional initial provider lanes, and optional HTTP transport.
 * @returns An immutable builder. Call {@link SenderClientBuilder.build | build} to obtain a client.
 * @throws {@link SenderError} synchronously if an initial provider route is invalid.
 *
 * @example
 * ```ts
 * import { createSenderClient, astralane, heliusSender, Region } from "celere-protocol-sdk/sender";
 *
 * declare const rpcUrl: string;
 * declare const astralaneKey: string;
 * declare const heliusKey: string;
 *
 * const sender = createSenderClient({ defaultRpc: { url: rpcUrl } })
 *   .addRoute(astralane({ apiKey: astralaneKey, region: Region.Frankfurt }))
 *   .addRoute(astralane({ apiKey: astralaneKey, region: Region.NewYork }))
 *   .addRoute(heliusSender({ apiKey: heliusKey }))
 *   .build();
 * ```
 */
export function createSenderClient(options: SenderClientOptions): SenderClientBuilder {
  return new SenderClientBuilder(options);
}
