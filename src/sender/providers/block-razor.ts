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
  [Region.Frankfurt]: "https://frankfurt.solana.blockrazor.io/sendTransaction",
  [Region.NewYork]: "https://newyork.solana.blockrazor.io/sendTransaction",
  [Region.Tokyo]: "https://tokyo.solana.blockrazor.io/sendTransaction",
  [Region.Amsterdam]: "http://amsterdam.solana.blockrazor.xyz:443/sendTransaction",
  [Region.London]: "http://london.solana.blockrazor.xyz:443/sendTransaction",
  [Region.Singapore]: "http://singapore.solana.blockrazor.xyz:443/sendTransaction",
  [Region.LosAngeles]: "http://losangeles.solana.blockrazor.xyz:443/sendTransaction",
  [Region.Toronto]: "http://toronto.solana.blockrazor.xyz:443/sendTransaction",
} as const satisfies Record<BlockRazorRegion, string>;

/** Public recipients audited 2026-10-09. @see https://docs.blockrazor.io/transaction-submission/transaction-sending/solana/send-transaction/request-example/js */
const TIP_ACCOUNTS = Object.freeze(
  [
    "FjmZZrFvhnqqb9ThCuMVnENaM3JGVuGWNyCAxRJcFpg9",
    "6No2i3aawzHsjtThw81iq1EXPJN6rh8eSJCLaYZfKDTG",
    "A9cWowVAiHe9pJfKAj3TJiN9VpbzMUq6E4kEvf5mUT22",
    "Gywj98ophM7GmkDdaWs4isqZnDdFCW7B46TXmKfvyqSm",
    "68Pwb4jS7eZATjDfhmTXgRJjCiZmw1L7Huy4HNpnxJ3o",
    "4ABhJh5rZPjv63RBJBuyWzBK3g9gWMUQdTZP2kiW31V9",
    "B2M4NG5eyZp5SBQrSdtemzk5TqVuaWGQnowGaCBt8GyM",
    "5jA59cXMKQqZAVdtopv8q3yyw9SYfiE3vUCbt7p8MfVf",
    "5YktoWygr1Bp9wiS1xtMtUki1PeYuuzuCF98tqwYxf61",
    "295Avbam4qGShBYK7E9H5Ldew4B3WyJGmgmXfiWdeeyV",
    "EDi4rSy2LZgKJX74mbLTFk4mxoTgT6F7HxxzG2HBAFyK",
    "BnGKHAC386n4Qmv9xtpBVbRaUTKixjBe3oagkPFKtoy6",
    "Dd7K2Fp7AtoN8xCghKDRmyqr5U169t48Tw5fEd3wT9mq",
    "AP6qExwrbRgBAVaehg4b5xHENX815sMabtBzUzVB4v8S",
  ].map((value) => address(value)),
);

/** Locations supported by {@link BlockRazorSender}; unsupported combinations fail at configuration time. */
export type BlockRazorRegion =
  | Region.Frankfurt
  | Region.NewYork
  | Region.Tokyo
  | Region.Amsterdam
  | Region.London
  | Region.Singapore
  | Region.LosAngeles
  | Region.Toronto;

/** Options for one {@link BlockRazorSender} lane. Construction performs no network work. */
export interface BlockRazorSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: BlockRazorRegion;
}

/**
 * Fast-mode HTTP lane with a 100,000-lamport floor. Sandwich mitigation is excluded because it
 * is incompatible with durable nonces.
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
 * import { BlockRazorSender, Region } from "celere-protocol-sdk/sender";
 * declare const apiKey: string;
 * const route = new BlockRazorSender({ apiKey, region: Region.Frankfurt });
 * ```
 */
export class BlockRazorSender implements SenderRoute {
  /** Provider identity used in results and tip overrides. */
  readonly provider = SenderProvider.BlockRazor;
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
   * Configure one BlockRazor lane without performing I/O.
   *
   * @param options - API key and optional region, complete submission URL, label, and deadline.
   * Provider-specific fee options select an eligible plan; they do not purchase or upgrade it.
   * @throws {@link SenderConfigurationError} synchronously for empty/invalid credentials,
   * an unsupported region or plan, an invalid custom HTTP(S) URL, or a deadline outside
   * 1–60,000 milliseconds. Remote authentication failures surface only after submission.
   * @see BlockRazorSenderOptions
   */
  constructor(options: BlockRazorSenderOptions) {
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
        headers: { "Content-Type": "application/json", apikey: this.apiKey },
        body: JSON.stringify({
          transaction: payload.base64,
          mode: "fast",
          revertProtection: false,
        }),
      },
    };
  }
}
