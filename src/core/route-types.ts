import type { Address } from "@solana/kit";
import type {
  AccountRequirement,
  ProtocolId,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapBuild,
  SwapQuote,
  SwapRequest,
} from "./types.js";

/** One caller-selected venue and its direction. Route selection remains caller-owned. */
export interface RouteHop {
  readonly pool: Address;
  readonly inputMint: Address;
  readonly outputMint: Address;
}

/**
 * Explicit ordered route using one native atomic route instruction.
 * @remarks Intermediate token accounts are not required. Endpoint accounts follow the
 * adapter's contract. All account data and chain context are supplied by the caller.
 */
export interface RouteRequest extends Omit<SwapRequest, "pool"> {
  readonly hops: readonly RouteHop[];
}

/** Account discovery can require several rounds as supplied hop state reveals its dependencies. */
export interface RouteRequirements {
  readonly protocol: ProtocolId | null;
  readonly accounts: readonly AccountRequirement[];
  readonly missing: readonly AccountRequirement[];
  readonly complete: boolean;
}

/**
 * A hop quote retains its mint denomination; intermediate amounts are not wallet debits.
 * @remarks Only the route quote has an enforced slippage limit. Hop limits describe local
 * pricing and are not separately checked by the native route instruction.
 */
export interface RouteHopQuote extends RouteHop {
  readonly protocol: ProtocolId;
  readonly quote: SwapQuote;
}

/** Portable atomic route, with endpoint totals and independently inspectable per-hop quotes. */
export interface RouteBuild extends Omit<SwapBuild, "pool"> {
  readonly hops: readonly RouteHopQuote[];
}

/** Protocol-owned output before shared endpoint account setup and signer extraction. */
export interface ProtocolRoute extends ProtocolSwap {
  readonly hops: readonly RouteHopQuote[];
  readonly assets: SwapBuild["assets"];
}

/** A stateless native router; registration does not authorize route selection or account fetching. */
export interface RouteAdapter {
  readonly id: ProtocolId;
  readonly programAddresses: readonly Address[];
  requirements(request: RouteRequest): Promise<readonly AccountRequirement[]>;
  build(request: RouteRequest, accounts: ResolvedTokenAccounts): Promise<ProtocolRoute>;
}
