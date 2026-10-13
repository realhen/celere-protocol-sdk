import type { ResolvedTokenAccounts, TokenAccountKinds } from "./accounts/plan";
import type { SwapAmount } from "./amounts";
import type { AccountSnapshot, AccountRequirement } from "./accounts/snapshot";
export type {
  AccountSnapshot,
  SnapshotAccount,
  AccountRequirement,
} from "./accounts/snapshot";
import type { Address, Instruction } from "@solana/kit";

/** Protocol identities are stable API values; registration does not imply implementation. */
export type ProtocolId =
  | "pump"
  | "pump-amm"
  | "raydium-amm-v4"
  | "raydium-cpmm"
  | "raydium-clmm"
  | "meteora-damm-v1"
  | "meteora-damm-v2"
  | "meteora-dlmm"
  | "boop"
  | "moonshot"
  | "orca-whirlpool"
  | "launchlab"
  | "meteora-dbc"
  | "vertigo"
  | "heaven"
  | "sugar"
  | "liquid-af"
  | "liquid-af-amm"
  | "rise-rich"
  | "metadao";

/** Protocol-neutral swap intent. Payer funds account creation; owner authorizes token debit. */
export interface SwapRequest {
  readonly pool: Address;
  readonly owner: Address;
  readonly payer: Address;
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly amount: SwapAmount;
  readonly slippageBps: number;
  readonly snapshot: AccountSnapshot;
  readonly tokenAccounts?: { readonly input: Address; readonly output: Address };
  readonly fillPolicy?: "allowPartial" | "requireFull";
  /** Reject observations older than this many slots relative to snapshot.slot. */
  readonly maxAccountAgeSlots?: bigint;
}

/** Fee amounts use the indicated mint's atomic units; components must not be double counted. */
export interface SwapFee {
  /** Native fee category; creator fees can accrue to a sharing or holder-reward vault. */
  readonly kind: "trade" | "creator" | "transfer";
  readonly mint: Address;
  readonly amount: bigint;
}

/** Amounts describe token-account debit/credit, excluding rent and transaction fees. */
export type SwapQuote = {
  readonly expectedAmountIn: bigint;
  readonly expectedAmountOut: bigint;
  readonly fees: readonly SwapFee[];
} & (
  | {
      readonly kind: "exactIn";
      readonly amountIn: bigint;
      readonly minimumAmountOut: bigint;
    }
  | {
      readonly kind: "exactOut";
      readonly amountOut: bigint;
      readonly maximumAmountIn: bigint;
    }
);

/** Ordered atomic execution plan. Signing and sending remain caller-owned. */
export interface SwapBuild {
  readonly protocol: ProtocolId;
  readonly pool: Address;
  readonly inputMint: Address;
  readonly outputMint: Address;
  readonly quote: SwapQuote;
  readonly instructions: readonly Instruction[];
  readonly setupInstructions: readonly Instruction[];
  readonly swapInstructions: readonly Instruction[];
  readonly cleanupInstructions: readonly Instruction[];
  readonly requiredSigners: readonly Address[];
  readonly context: {
    readonly slot: bigint;
    readonly epoch: bigint;
    readonly unixTimestamp: bigint;
  };
  readonly execution: { readonly mayPartiallyFill: boolean };
  readonly assets: TokenAccountKinds;
}

/** Internal adapter output uses only portable Solana data, never SDK clients or keypairs. */
export interface ProtocolSwap {
  /** Idempotent setup for protocol-owned dependencies observed absent in the snapshot. */
  readonly setupInstructions?: readonly Instruction[];
  readonly instructions: readonly Instruction[];
  readonly quote: SwapQuote;
  readonly mayPartiallyFill: boolean;
}

/** Stateless protocol implementation. Async permits local PDA/cryptographic operations only. */
export interface ProtocolAdapter {
  readonly id: ProtocolId;
  readonly programAddresses: readonly Address[];
  tokenAccountKinds?(request: SwapRequest): TokenAccountKinds;
  requirements(request: SwapRequest): Promise<readonly AccountRequirement[]>;
  build(request: SwapRequest, accounts: ResolvedTokenAccounts): Promise<ProtocolSwap>;
}
