import { raydiumAmmV4Adapter } from "../raydium/amm-v4.js";
import { raydiumClmmAdapter } from "../raydium/clmm.js";

/**
 * Canonical adapters for the qualified Raydium routes behind Axiom's Stable Swap label.
 * @remarks Stable Swap is a routing label, not an on-chain program identity.
 * Register this subset once. Discovery returns `raydium-amm-v4` or `raydium-clmm`.
 * WSOL/USDC and WSOL/USD1 map to the same native builders and validation as other
 * supported pairs. Active CLMM limit orders are rejected; exhausted phase counters
 * are accepted only with zero remaining order fields. Poseidon is not included.
 */
export const stableSwapAdapters = [raydiumAmmV4Adapter, raydiumClmmAdapter] as const;
