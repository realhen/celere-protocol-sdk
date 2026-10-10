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
} as const satisfies Record<AstralaneRegion, string>;

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

/** Locations supported by {@link AstralaneSender}; unsupported combinations fail at configuration time. */
export type AstralaneRegion =
  | Region.Global
  | Region.Frankfurt
  | Region.Amsterdam
  | Region.NewYork
  | Region.Tokyo
  | Region.Singapore
  | Region.LosAngeles;

/** Options for one {@link AstralaneSender} lane. Construction performs no network work. */
export interface AstralaneSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Global}. */
  readonly region?: AstralaneRegion;
  /**
   * Current provider tier; defaults to {@link AstralaneTier.Free} (1,000,000 lamports).
   * VIP 1/2 permit 100,000 and VIP 3 permits 10,000. Eligibility and later tier changes
   * are caller-owned. This selects validation policy; actual tips remain per-send values.
   */
  readonly tier?: AstralaneTier;
}

/**
 * Binary Iris lane. Free requires 1,000,000 lamports; VIP 1/2 require 100,000; VIP 3 requires
 * 10,000. Only select your eligible tier.
 *
 * @remarks
 * Creates an immutable configuration for one regional lane. Defaults to `Region.Global`
 * and a 3,000 ms HTTP deadline. Construction opens no connections, performs no API-key
 * verification, and does not warm a connection pool. Reuse the instance between sends.
 *
 * Pass this instance in `SenderClientOptions.routes`. The client chooses a tip recipient,
 * compiles and signs the variant, then dispatches it alongside the default RPC. Compatible
 * regional lanes share the recipient and signed bytes. Set actual transaction tips in
 * `SenderFees`; the provider's minimum is a validation floor, never an automatic fee increase.
 *
 * Credentials are retained by this instance. Its TypeScript-private fields are not a
 * runtime secret vault; do not log provider objects or requests returned by `createRequest`.
 * Browser callers must choose an HTTPS endpoint with suitable CORS support.
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
   * Configure one Astralane lane without performing I/O.
   *
   * @param options - API key and optional region, complete submission URL, label, and deadline.
   * Provider-specific fee options select an eligible plan; they do not purchase or upgrade it.
   * @throws {@link SenderConfigurationError} synchronously for empty/invalid credentials,
   * an unsupported region or plan, an invalid custom HTTP(S) URL, or a deadline outside
   * 1–60,000 milliseconds. Remote authentication failures surface only after submission.
   * @see AstralaneSenderOptions
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
   * Encode one signed transaction for this provider's HTTP API.
   *
   * @param payload - Matching wire bytes, base64 encoding, and fee-payer signature. The
   * sender supplies these after verifying all required signatures.
   * @returns A new credential-bearing POST request. No HTTP request has been launched.
   * @remarks This is the provider integration boundary, normally called by SenderClient.
   * It does not validate signatures, check tips, retry, or confirm execution. Applications
   * should call `SenderClient.send` or `submitSigned` instead of dispatching this request.
   * The supplied payload is left unchanged; each call allocates its own request body.
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
