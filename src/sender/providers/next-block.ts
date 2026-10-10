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
} as const;

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

/** Options for one {@link NextBlockSender} lane. Construction performs no network work. */
export interface NextBlockSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: keyof typeof ENDPOINTS;
}

/**
 * HTTP v2 lane with a 100,000-lamport floor. Requests skip preflight and disable retries and
 * front-running protection.
 *
 * Credentials are retained by this instance; do not log provider objects or encoded requests.
 * Regional instances with compatible tip requirements share signed bytes in SenderClient.
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
   * @param options - Credentials, supported region, and optional endpoint/deadline overrides.
   * @throws {@link SenderConfigurationError} for invalid caller configuration.
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
