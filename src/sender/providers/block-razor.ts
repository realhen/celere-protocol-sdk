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
} as const;

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

/** Options for one {@link BlockRazorSender} lane. Construction performs no network work. */
export interface BlockRazorSenderOptions extends Omit<RouteOptions, "region"> {
  /** Supported location; defaults to {@link Region.Frankfurt}. */
  readonly region?: keyof typeof ENDPOINTS;
}

/**
 * Fast-mode HTTP lane with a 100,000-lamport floor. Sandwich mitigation is excluded because it
 * is incompatible with durable nonces.
 *
 * Credentials are retained by this instance; do not log provider objects or encoded requests.
 * Regional instances with compatible tip requirements share signed bytes in SenderClient.
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
   * @param options - Credentials, supported region, and optional endpoint/deadline overrides.
   * @throws {@link SenderConfigurationError} for invalid caller configuration.
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
