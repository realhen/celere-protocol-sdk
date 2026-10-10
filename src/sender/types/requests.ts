import type { Address, Instruction, TransactionPartialSigner } from "@solana/kit";
import type {
  BlockhashLifetime,
  DurableNonce,
  LookupTable,
} from "../../transactions/index.js";
import type { SenderProvider } from "./providers.js";
import type { RouteResult } from "./results.js";

/** Per-send amounts. All monetary values are atomic bigint values. No automatic fee sampling. */
export interface SenderFees {
  /**
   * Requested compute units for the entire transaction, including setup, nonce, and tip
   * instructions. Integer 1–1,400,000. The sender does not simulate or estimate this value.
   */
  readonly computeUnitLimit: number;
  /**
   * Micro-lamports per requested compute unit, as a u64 bigint. Priority fee in lamports
   * is ceil(limit × price / 1,000,000). For example, 200,000 CUs at 50,000n costs 10,000 lamports.
   */
  readonly computeUnitPriceMicroLamports: bigint;
  /**
   * Tip in lamports for each provider variant, as a u64 bigint; 1,000,000n is 0.001 SOL.
   * The default RPC variant has no provider tip. Each route's minimum is checked before signing.
   */
  readonly tipLamports: bigint;
  /** Per-provider tip amounts in lamports, replacing tipLamports for all that provider's lanes. */
  readonly tipOverrides?: Readonly<
    Partial<Record<Exclude<SenderProvider, SenderProvider.Rpc>, bigint>>
  >;
}

/**
 * Inputs for local transaction compilation. Supply exactly one nonce or blockhash lifetime.
 *
 * The sender adds compute-budget instructions and provider tips; do not add a second
 * compute budget or nonce advance instruction. A blockhash lifetime is sufficient only
 * when there is a single variant. Distinct provider/RPC variants require a shared nonce.
 * The client neither fetches a lifetime nor falls back to RPC-only sending when a nonce is missing.
 */
export type PrepareRequest = {
  /** Ordered instructions from any protocol or other Kit-compatible source. At least one is required. */
  readonly instructions: readonly Instruction[];
  /** Address paying transaction fees and provider tips; its signature is required. */
  readonly feePayer: Address;
  /** Caller-observed address lookup contents. The nonce account always remains a static account. */
  readonly lookupTables?: readonly LookupTable[];
  /** Explicit per-send fees, including the complete transaction's compute-unit limit. */
  readonly fees: SenderFees;
} & (
  | {
      /** Current nonce snapshot exclusively selected by the application for this logical trade. */
      readonly nonce: DurableNonce;
      readonly lifetime?: never;
    }
  | {
      /** Recent blockhash and expiration height for a single-variant send. */
      readonly lifetime: BlockhashLifetime;
      readonly nonce?: never;
    }
);

/** Optional controls shared by {@link SenderClient.send} and {@link SenderClient.submitSigned}. */
export interface SubmitSignedOptions {
  /**
   * Cancel signing/submission work. Cancellation before dispatch rejects the send;
   * cancellation during HTTP submission yields route observations. It cannot undo a transaction.
   */
  readonly signal?: AbortSignal;
  /**
   * Observe each route as its HTTP attempt settles. The callback receives the same result
   * included in {@link Submission.results}; it performs no on-chain tracking.
   * The sender does not await callback work and isolates thrown/rejected callback errors.
   */
  readonly onRouteResult?: (result: RouteResult) => void | Promise<void>;
}

/** Inputs for preparing and signing a send with caller-owned Kit partial signers. */
export type SendRequest = PrepareRequest &
  SubmitSignedOptions & {
    /**
     * Exactly one partial signer for every required address: fee payer, nonce authority,
     * and any instruction signers. Each signs the full variant batch without modifying messages.
     * Supply a shared payer/authority signer only once. No private keys are accepted directly.
     */
    readonly signers: readonly TransactionPartialSigner[];
  };
