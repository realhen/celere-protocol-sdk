import { address } from "@solana/kit";
import { Region, SenderProvider } from "../types.js";
import type {
  RouteOptions,
  SenderRoute,
  SenderTransactionPayload,
  SenderHttpRequest,
} from "../types.js";
import { configureProvider, registerProvider } from "./configuration.js";

/** Supported binary/HTTP locations. See README for alternate datacenters and coverage limits. */
const ENDPOINTS = {
  [Region.Frankfurt]: "https://frankfurt.nextblock.io/api/v2/submit",
  [Region.Amsterdam]: "https://amsterdam.nextblock.io/api/v2/submit",
  [Region.NewYork]: "https://ny.nextblock.io/api/v2/submit",
  [Region.London]: "https://london.nextblock.io/api/v2/submit",
  [Region.Singapore]: "https://singapore.nextblock.io/api/v2/submit",
  [Region.Tokyo]: "https://tokyo.nextblock.io/api/v2/submit",
  [Region.SaltLakeCity]: "https://slc.nextblock.io/api/v2/submit",
  [Region.Dublin]: "https://dublin.nextblock.io/api/v2/submit",
  [Region.Vilnius]: "https://vilnius.nextblock.io/api/v2/submit",
} as const satisfies Record<NextBlockRegion, string>;

/** Public recipients audited 2026-10-09. @see https://docs.nextblock.io/getting-started/quickstart */
const TIP_ACCOUNTS = Object.freeze(
  [
    "NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE",
    "NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2",
    "NeXTBLoCKs9F1y5PJS9CKrFNNLU1keHW71rfh7KgA1X",
    "NexTBLockJYZ7QD7p2byrUa6df8ndV2WSd8GkbWqfbb",
    "neXtBLock1LeC67jYd1QdAa32kbVeubsfPNTJC1V5At",
    "nEXTBLockYgngeRmRrjDV31mGSekVPqZoMGhQEZtPVG",
    "NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid",
    "nextBLoCkPMgmG8ZgJtABeScP35qLa2AMCNKntAP7Xc",
  ].map((value) => address(value)),
);

/** Locations supported by {@link NextBlockSender}; unsupported combinations fail at configuration time. */
export type NextBlockRegion =
  | Region.Frankfurt
  | Region.Amsterdam
  | Region.NewYork
  | Region.London
  | Region.Singapore
  | Region.Tokyo
  | Region.SaltLakeCity
  | Region.Dublin
  | Region.Vilnius;

/** Options for one {@link NextBlockSender} lane. Construction performs no network work. */
export interface NextBlockSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: NextBlockRegion;
}

/**
 * HTTP v2 lane with a 100,000-lamport floor. Requests skip preflight and disable retries and
 * front-running protection.
 *
 * @remarks
 * Creates an immutable configuration for one regional lane. Defaults to `Region.Frankfurt`
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
 * import { NextBlockSender, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = new NextBlockSender({ apiKey, region: Region.Frankfurt });
 * ```
 */
export class NextBlockSender implements SenderRoute {
  /** Provider identity used in results and tip overrides. */
  readonly provider = SenderProvider.NextBlock;
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
  private readonly apiKey: string;

  /**
   * Configure one NextBlock lane without performing I/O.
   *
   * @param options - API key and optional region, complete submission URL, label, and deadline.
   * Provider-specific fee options select an eligible plan; they do not purchase or upgrade it.
   * @throws {@link SenderConfigurationError} synchronously for empty/invalid credentials,
   * an unsupported region or plan, an invalid custom HTTP(S) URL, or a deadline outside
   * 1–60,000 milliseconds. Remote authentication failures surface only after submission.
   * @see NextBlockSenderOptions
   */
  constructor(options: NextBlockSenderOptions) {
    const configuration = configureProvider(options, ENDPOINTS, Region.Frankfurt);
    if (!configuration.ok) throw configuration.error;
    const { url, name, timeoutMs } = configuration.value;
    if (name !== undefined) this.name = name;
    this.timeoutMs = timeoutMs;
    this.minimumTipLamports = 100_000n;
    this.minimumPriorityFeeLamports = 0n;

    this.url = url.toString();
    this.apiKey = options.apiKey;
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
        headers: { "Content-Type": "application/json", Authorization: this.apiKey },
        body: JSON.stringify({
          transaction: { content: payload.base64 },
          skipPreFlight: true,
          frontRunningProtection: false,
          disableRetries: true,
        }),
      },
    };
  }
}
