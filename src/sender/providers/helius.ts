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
} as const satisfies Record<HeliusRegion, string>;

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

/** Locations supported by {@link HeliusSender}; unsupported combinations fail at configuration time. */
export type HeliusRegion =
  | Region.Global
  | Region.Frankfurt
  | Region.Amsterdam
  | Region.NewYork
  | Region.London
  | Region.Tokyo
  | Region.Singapore
  | Region.SaltLakeCity;

/** Options for one {@link HeliusSender} lane. Construction performs no network work. */
export interface HeliusSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Global}. */
  readonly region?: HeliusRegion;
  /**
   * Submission product; defaults to {@link HeliusSenderMode.Max}.
   * Max requires a 1,000,000-lamport tip and 5,000-lamport total priority fee.
   * SWQoS-only requires a 5,000-lamport tip and adds `swqos_only=true` to requests.
   */
  readonly mode?: HeliusSenderMode;
}

/**
 * Helius Max requires a 1,000,000-lamport tip and 5,000-lamport total priority fee. SWQoS-only
 * requires a 5,000-lamport tip.
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
   * Configure one Helius lane without performing I/O.
   *
   * @param options - API key and optional region, complete submission URL, label, and deadline.
   * Provider-specific fee options select an eligible plan; they do not purchase or upgrade it.
   * @throws {@link SenderConfigurationError} synchronously for empty/invalid credentials,
   * an unsupported region or plan, an invalid custom HTTP(S) URL, or a deadline outside
   * 1–60,000 milliseconds. Remote authentication failures surface only after submission.
   * @see HeliusSenderOptions
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
