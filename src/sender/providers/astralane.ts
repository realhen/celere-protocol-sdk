import { address } from "@solana/kit";
import { Region, SenderProvider, AstralaneTier } from "../types.js";
import type {
  RouteOptions,
  SenderRoute,
  SenderTransactionPayload,
  SenderHttpRequest,
} from "../types.js";
import { configureProvider, registerProvider } from "./configuration.js";
import { SenderConfigurationError } from "../errors/index.js";

/** Supported binary/HTTP locations. See README for alternate datacenters and coverage limits. */
const ENDPOINTS = {
  [Region.Global]: "https://edge.astralane.io/irisb",
  [Region.Frankfurt]: "http://fr.gateway.astralane.io/irisb",
  [Region.Amsterdam]: "http://ams.gateway.astralane.io/irisb",
  [Region.NewYork]: "http://ny.gateway.astralane.io/irisb",
  [Region.Tokyo]: "http://jp.gateway.astralane.io/irisb",
  [Region.Singapore]: "http://sg.gateway.astralane.io/irisb",
  [Region.LosAngeles]: "http://la.gateway.astralane.io/irisb",
} as const;

/** Public recipients audited 2026-10-09. @see https://astralane.gitbook.io/docs/low-latency/endpoints-and-configs */
const TIP_ACCOUNTS = Object.freeze(
  [
    "astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF",
    "astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm",
    "astra9xWY93QyfG6yM8zwsKsRodscjQ2uU2HKNL5prk",
    "astraRVUuTHjpwEVvNBeQEgwYx9w9CFyfxjYoobCZhL",
    "astraEJ2fEj8Xmy6KLG7B3VfbKfsHXhHrNdCQx7iGJK",
    "astraubkDw81n4LuutzSQ8uzHCv4BhPVhfvTcYv8SKC",
    "astraZW5GLFefxNPAatceHhYjfA1ciq9gvfEg2S47xk",
    "astrawVNP4xDBKT7rAdxrLYiTSTdqtUr63fSMduivXK",
    "AstrA1ejL4UeXC2SBP4cpeEmtcFPZVLxx3XGKXyCW6to",
    "AsTra79FET4aCKWspPqeSFvjJNyp96SvAnrmyAxqg5b7",
    "AstrABAu8CBTyuPXpV4eSCJ5fePEPnxN8NqBaPKQ9fHR",
    "AsTRADtvb6tTmrsqULQ9Wji9PigDMjhfEMza6zkynEvV",
    "AsTRAEoyMofR3vUPpf9k68Gsfb6ymTZttEtsAbv8Bk4d",
    "AStrAJv2RN2hKCHxwUMtqmSxgdcNZbihCwc1mCSnG83W",
    "Astran35aiQUF57XZsmkWMtNCtXGLzs8upfiqXxth2bz",
    "AStRAnpi6kFrKypragExgeRoJ1QnKH7pbSjLAKQVWUum",
    "ASTRaoF93eYt73TYvwtsv6fMWHWbGmMUZfVZPo3CRU9C",
  ].map((value) => address(value)),
);

/** Options for one {@link AstralaneSender} lane. Construction performs no network work. */
export interface AstralaneSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Global}. */
  readonly region?: keyof typeof ENDPOINTS;
  /** Provisioned tier; Free by default. Actual tips remain per-send values. */
  readonly tier?: AstralaneTier;
}

/**
 * Binary Iris lane. Free requires 1,000,000 lamports; VIP 1/2 require 100,000; VIP 3 requires
 * 10,000. Only select your eligible tier.
 *
 * Credentials are retained by this instance; do not log provider objects or encoded requests.
 * Regional instances with compatible tip requirements share signed bytes in SenderClient.
 *
 * @example
 * ```ts
 * import { AstralaneSender, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = new AstralaneSender({ apiKey, region: Region.Frankfurt });
 * ```
 */
export class AstralaneSender implements SenderRoute {
  /** Provider identity used in results and tip overrides. */
  readonly provider = SenderProvider.Astralane;
  /** Audited public recipients, shared by all instances of this provider. */
  readonly tipAccounts = TIP_ACCOUNTS;
  /** Minimum per-send tip in lamports for this configured lane. */
  readonly minimumTipLamports: bigint;
  /** Minimum total priority fee in lamports for this lane. */
  readonly minimumPriorityFeeLamports: bigint;
  /** Optional application label echoed in route results. */
  readonly name?: string;
  /** HTTP deadline in milliseconds, including response-body reading. */
  readonly timeoutMs: number;
  private readonly url: string;

  /**
   * @param options - Credentials, supported region, and optional endpoint/deadline overrides.
   * @throws {@link SenderConfigurationError} for invalid caller configuration.
   */
  constructor(options: AstralaneSenderOptions) {
    const configuration = configureProvider(options, ENDPOINTS, Region.Global);
    if (!configuration.ok) throw configuration.error;
    const tier = options.tier ?? AstralaneTier.Free;
    const floors = {
      [AstralaneTier.Free]: 1_000_000n,
      [AstralaneTier.Vip1]: 100_000n,
      [AstralaneTier.Vip2]: 100_000n,
      [AstralaneTier.Vip3]: 10_000n,
    };
    if (!Object.values(AstralaneTier).includes(tier))
      throw new SenderConfigurationError("Unsupported Astralane fee tier");
    const { url, name, timeoutMs } = configuration.value;
    if (name !== undefined) this.name = name;
    this.timeoutMs = timeoutMs;
    this.minimumTipLamports = floors[tier];
    this.minimumPriorityFeeLamports = 0n;
    url.searchParams.set("api-key", options.apiKey);
    url.searchParams.set("method", "sendTransaction");
    this.url = url.toString();
    Object.freeze(this);
    registerProvider(this);
  }

  /**
   * Encode a verified transaction without performing I/O.
   * @param payload - Signed bytes and their base64 representation.
   * @returns A credential-bearing POST request for the shared HTTP transport.
   */
  createRequest(payload: SenderTransactionPayload): SenderHttpRequest {
    return {
      url: this.url,
      init: {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/octet-stream" },
        body: Uint8Array.from(payload.bytes),
      },
    };
  }
}
