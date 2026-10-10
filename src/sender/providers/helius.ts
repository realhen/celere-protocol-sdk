import { address } from "@solana/kit";
import { Region, SenderProvider, HeliusSenderMode } from "../types.js";
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
  [Region.Global]: "https://sender.helius-rpc.com/fast",
  [Region.Frankfurt]: "http://fra-sender.helius-rpc.com/fast",
  [Region.Amsterdam]: "http://ams-sender.helius-rpc.com/fast",
  [Region.NewYork]: "http://ewr-sender.helius-rpc.com/fast",
  [Region.London]: "http://lon-sender.helius-rpc.com/fast",
  [Region.Tokyo]: "http://tyo-sender.helius-rpc.com/fast",
  [Region.Singapore]: "http://sg-sender.helius-rpc.com/fast",
  [Region.SaltLakeCity]: "http://slc-sender.helius-rpc.com/fast",
} as const;

/** Public recipients audited 2026-10-09. @see https://www.helius.dev/docs/sending-transactions/sender-max */
const TIP_ACCOUNTS = Object.freeze(
  [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
    "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
    "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
    "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
    "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
    "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
  ].map((value) => address(value)),
);

/** Options for one {@link HeliusSender} lane. Construction performs no network work. */
export interface HeliusSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Global}. */
  readonly region?: keyof typeof ENDPOINTS;
  /** Max by default; SWQoS-only has a lower tip floor and no additional priority-fee floor. */
  readonly mode?: HeliusSenderMode;
}

/**
 * Helius Max requires a 1,000,000-lamport tip and 5,000-lamport total priority fee. SWQoS-only
 * requires a 5,000-lamport tip.
 *
 * Credentials are retained by this instance; do not log provider objects or encoded requests.
 * Regional instances with compatible tip requirements share signed bytes in SenderClient.
 *
 * @example
 * ```ts
 * import { HeliusSender, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = new HeliusSender({ apiKey, region: Region.Frankfurt });
 * ```
 */
export class HeliusSender implements SenderRoute {
  /** Provider identity used in results and tip overrides. */
  readonly provider = SenderProvider.Helius;
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
  constructor(options: HeliusSenderOptions) {
    const configuration = configureProvider(options, ENDPOINTS, Region.Global);
    if (!configuration.ok) throw configuration.error;
    const mode = options.mode ?? HeliusSenderMode.Max;
    if (!Object.values(HeliusSenderMode).includes(mode))
      throw new SenderConfigurationError("Unsupported Helius mode");
    const { url, name, timeoutMs } = configuration.value;
    if (name !== undefined) this.name = name;
    this.timeoutMs = timeoutMs;
    this.minimumTipLamports = mode === HeliusSenderMode.Max ? 1_000_000n : 5_000n;
    this.minimumPriorityFeeLamports = mode === HeliusSenderMode.Max ? 5_000n : 0n;
    url.searchParams.set("api-key", options.apiKey);
    if (mode === HeliusSenderMode.SwqosOnly) url.searchParams.set("swqos_only", "true");
    else url.searchParams.delete("swqos_only");
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
