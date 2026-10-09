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

/** Immutable caller-observed account data. Slots record observations, not authenticity. */
export interface SnapshotAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly data: Uint8Array;
  readonly lamports: bigint;
  readonly executable: boolean;
  readonly slot: bigint;
}

/** No clock or RPC is consulted. Null means observed absent; a missing key is unknown. */
export interface AccountSnapshot {
  readonly slot: bigint;
  readonly epoch: bigint;
  readonly unixTimestamp: bigint;
  readonly accounts: Readonly<Record<string, SnapshotAccount | null>>;
}

/** Atomic token units. Exact output is available only through a native output-specified instruction. */
export type SwapAmount =
  | { readonly kind: "exactIn"; readonly amountIn: bigint }
  | { readonly kind: "exactOut"; readonly amountOut: bigint };

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

/** A protocol-owned address discovery result, fulfilled by the consumer's data layer. */
export interface AccountRequirement {
  readonly address: Address;
  readonly role: string;
  readonly optional?: boolean;
}

/** Discovery can need multiple rounds as newly supplied state reveals dependencies. */
export interface SwapRequirements {
  readonly protocol: ProtocolId | null;
  readonly accounts: readonly AccountRequirement[];
  readonly missing: readonly AccountRequirement[];
  readonly complete: boolean;
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
  readonly assets: {
    readonly input: "nativeSol" | "spl";
    readonly output: "nativeSol" | "spl";
  };
}

/** Internal adapter output uses only portable Solana data, never SDK clients or keypairs. */
export interface ProtocolSwap {
  /** Idempotent setup for protocol-owned dependencies observed absent in the snapshot. */
  readonly setupInstructions?: readonly Instruction[];
  readonly instructions: readonly Instruction[];
  readonly quote: SwapQuote;
  readonly mayPartiallyFill: boolean;
}

/** Resolved token-account addresses; setup instructions are owned by the shared planner. */
export interface ResolvedTokenAccounts {
  readonly input: Address;
  readonly output: Address;
}

/** Stateless protocol implementation. Async permits local PDA/cryptographic operations only. */
export interface ProtocolAdapter {
  readonly id: ProtocolId;
  readonly programAddresses: readonly Address[];
  tokenAccountKinds?(request: SwapRequest): {
    readonly input: "nativeSol" | "spl";
    readonly output: "nativeSol" | "spl";
  };
  requirements(request: SwapRequest): Promise<readonly AccountRequirement[]>;
  build(request: SwapRequest, accounts: ResolvedTokenAccounts): Promise<ProtocolSwap>;
}
