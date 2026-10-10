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
} as const;

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

/** Options for one {@link ZeroSlotSender} lane. Construction performs no network work. */
export interface ZeroSlotSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: keyof typeof ENDPOINTS;
  /** Plan floor: 1,000,000 lamports by default; 100,000 requires an advanced plan. */
  readonly minimumTipLamports?: 100_000n | 1_000_000n;
}

/**
 * 0slot HTTP lane. Defaults to the 1,000,000-lamport plan floor; eligible advanced accounts
 * may select 100,000.
 *
 * Credentials are retained by this instance; do not log provider objects or encoded requests.
 * Regional instances with compatible tip requirements share signed bytes in SenderClient.
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
   * @param options - Credentials, supported region, and optional endpoint/deadline overrides.
   * @throws {@link SenderConfigurationError} for invalid caller configuration.
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
   * Encode a verified transaction without performing I/O.
   * @param payload - Signed bytes and their base64 representation.
   * @returns A credential-bearing POST request for the shared HTTP transport.
   */
  createRequest(payload: SenderTransactionPayload): SenderHttpRequest {
    return createRpcRequest(this.url, payload);
  }
}
