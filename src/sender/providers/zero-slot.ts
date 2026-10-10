import { address } from "@solana/kit";
import { Region, SenderProvider } from "../types.js";
import type {
  RouteOptions,
  SenderRoute,
  SenderTransactionPayload,
  SenderHttpRequest,
} from "../types.js";
import { configureProvider, registerProvider } from "./configuration.js";
import { SenderConfigurationError } from "../errors/index.js";
import { createRpcRequest } from "./rpc.js";

/** Supported binary/HTTP locations. See README for alternate datacenters and coverage limits. */
const ENDPOINTS = {
  [Region.Frankfurt]: "https://de.0slot.trade",
  [Region.Amsterdam]: "https://ams.0slot.trade",
  [Region.NewYork]: "https://ny.0slot.trade",
  [Region.Tokyo]: "https://jp.0slot.trade",
  [Region.LosAngeles]: "https://la.0slot.trade",
} as const satisfies Record<ZeroSlotRegion, string>;

/** Public recipients audited 2026-10-09. @see https://0slot.trade/docs.php */
const TIP_ACCOUNTS = Object.freeze(
  [
    "6fQaVhYZA4w3MBSXjJ81Vf6W1EDYeUPXpgVQ6UQyU1Av",
    "4HiwLEP2Bzqj3hM2ENxJuzhcPCdsafwiet3oGkMkuQY4",
    "7toBU3inhmrARGngC7z6SjyP85HgGMmCTEwGNRAcYnEK",
    "8mR3wB1nh4D6J9RUCugxUpc6ya8w38LPxZ3ZjcBhgzws",
    "6SiVU5WEwqfFapRuYCndomztEwDjvS5xgtEof3PLEGm9",
    "TpdxgNJBWZRL8UXF5mrEsyWxDWx9HQexA9P1eTWQ42p",
    "D8f3WkQu6dCF33cZxuAsrKHrGsqGP2yvAHf8mX6RXnwf",
    "GQPFicsy3P3NXxB5piJohoxACqTvWE9fKpLgdsMduoHE",
    "Ey2JEr8hDkgN8qKJGrLf2yFjRhW7rab99HVxwi5rcvJE",
    "4iUgjMT8q2hNZnLuhpqZ1QtiV8deFPy2ajvvjEpKKgsS",
    "3Rz8uD83QsU8wKvZbgWAPvCNDU6Fy8TSZTMcPm3RB6zt",
    "DiTmWENJsHQdawVUUKnUXkconcpW4Jv52TnMWhkncF6t",
    "HRyRhQ86t3H4aAtgvHVpUJmw64BDrb61gRiKcdKUXs5c",
    "7y4whZmw388w1ggjToDLSBLv47drw5SUXcLk6jtmwixd",
    "J9BMEWFbCBEjtQ1fG5Lo9kouX1HfrKQxeUxetwXrifBw",
    "8U1JPQh3mVQ4F5jwRdFTBzvNRQaYFQppHQYoH38DJGSQ",
    "Eb2KpSC8uMt9GmzyAEm5Eb1AAAgTjRaXWFjKyFXHZxF3",
    "FCjUJZ1qozm1e8romw216qyfQMaaWKxWsuySnumVCCNe",
    "ENxTEjSQ1YabmUpXAdCgevnHQ9MHdLv8tzFiuiYJqa13",
    "6rYLG55Q9RpsPGvqdPNJs4z5WTxJVatMB8zV3WJhs5EK",
    "Cix2bHfqPcKcM233mzxbLk14kSggUUiz2A87fJtGivXr",
  ].map((value) => address(value)),
);

/** Locations supported by {@link ZeroSlotSender}; unsupported combinations fail at configuration time. */
export type ZeroSlotRegion =
  Region.Frankfurt | Region.Amsterdam | Region.NewYork | Region.Tokyo | Region.LosAngeles;

/** Options for one {@link ZeroSlotSender} lane. Construction performs no network work. */
export interface ZeroSlotSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: ZeroSlotRegion;
  /**
   * Minimum permitted tip in lamports for the caller's provisioned account.
   * Defaults to 1,000,000n (0.001 SOL); 100,000n requires an eligible advanced plan.
   * This changes local validation only. Supply the actual amount on each send via SenderFees.
   */
  readonly minimumTipLamports?: 100_000n | 1_000_000n;
}

/**
 * 0slot HTTP lane. Defaults to the 1,000,000-lamport plan floor; eligible advanced accounts
 * may select 100,000.
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
 * import { ZeroSlotSender, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = new ZeroSlotSender({ apiKey, region: Region.Frankfurt });
 * ```
 */
export class ZeroSlotSender implements SenderRoute {
  /** Provider identity used in results and tip overrides. */
  readonly provider = SenderProvider.ZeroSlot;
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
   * Configure one ZeroSlot lane without performing I/O.
   *
   * @param options - API key and optional region, complete submission URL, label, and deadline.
   * Provider-specific fee options select an eligible plan; they do not purchase or upgrade it.
   * @throws {@link SenderConfigurationError} synchronously for empty/invalid credentials,
   * an unsupported region or plan, an invalid custom HTTP(S) URL, or a deadline outside
   * 1–60,000 milliseconds. Remote authentication failures surface only after submission.
   * @see ZeroSlotSenderOptions
   */
  constructor(options: ZeroSlotSenderOptions) {
    const configuration = configureProvider(options, ENDPOINTS, Region.Frankfurt);
    if (!configuration.ok) throw configuration.error;
    const minimum = options.minimumTipLamports ?? 1_000_000n;
    if (minimum !== 100_000n && minimum !== 1_000_000n)
      throw new SenderConfigurationError("Unsupported 0slot plan minimum");
    const { url, name, timeoutMs } = configuration.value;
    if (name !== undefined) this.name = name;
    this.timeoutMs = timeoutMs;
    this.minimumTipLamports = minimum;
    this.minimumPriorityFeeLamports = 0n;
    url.searchParams.set("api-key", options.apiKey);
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
    return createRpcRequest(this.url, payload);
  }
}
