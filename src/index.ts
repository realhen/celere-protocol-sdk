import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";
import {
  fetchSwapWithSdk,
  type FetchSwapRequest,
  type FetchSwapConfig,
} from "./fetch-swap";
import type { SwapBuild } from "./core/types";
import { createRouteSdk } from "./core/routes";
import { pumpRouteAdapter } from "./protocols/pump/route";
import { createProtocolSdk } from "./core/sdk";
import { boopAdapter } from "./protocols/boop/adapter";
import { heavenAdapter } from "./protocols/heaven/amm";
import { liquidAfAmmAdapter } from "./protocols/liquid-af-amm/amm";
import { liquidAfAdapter } from "./protocols/liquid-af/curve";
import { metadaoAdapter } from "./protocols/metadao/amm";
import { meteoraDammV1Adapter } from "./protocols/meteora/damm-v1";
import { meteoraDammV2Adapter } from "./protocols/meteora/damm-v2";
import { meteoraDlmmAdapter } from "./protocols/meteora/dlmm";
import { moonshotAdapter } from "./protocols/moonshot/curve";
import { orcaWhirlpoolAdapter } from "./protocols/orca/whirlpool";
import { pumpAmmAdapter } from "./protocols/pump/amm";
import { pumpAdapter } from "./protocols/pump/bonding-curve";
import { raydiumAmmV4Adapter } from "./protocols/raydium/amm-v4";
import { raydiumClmmAdapter } from "./protocols/raydium/clmm";
import { raydiumCpmmAdapter } from "./protocols/raydium/cpmm";
import { raydiumLaunchlabAdapter } from "./protocols/raydium/launchlab";
import { riseRichAdapter } from "./protocols/rise-rich/curve";
import { vertigoAdapter } from "./protocols/vertigo/amm";
import { meteoraDbcAdapter } from "./protocols/meteora-dbc/adapter";

const sdk = createProtocolSdk([
  pumpAdapter,
  pumpAmmAdapter,
  raydiumAmmV4Adapter,
  raydiumCpmmAdapter,
  raydiumClmmAdapter,
  meteoraDammV1Adapter,
  meteoraDammV2Adapter,
  meteoraDlmmAdapter,
  boopAdapter,
  moonshotAdapter,
  orcaWhirlpoolAdapter,
  raydiumLaunchlabAdapter,
  meteoraDbcAdapter,
  vertigoAdapter,
  heavenAdapter,
  liquidAfAdapter,
  liquidAfAmmAdapter,
  riseRichAdapter,
  metadaoAdapter,
]);

const routeSdk = createRouteSdk([pumpRouteAdapter]);

/** Discover account observations for a caller-selected native route without I/O. */
export const getRouteRequirements = routeSdk.getRouteRequirements;
/** Build one native multi-hop instruction from immutable caller-owned snapshots. */
export const buildRouteInstructions = routeSdk.buildRouteInstructions;

/** Discover required account observations without performing network requests. */
export const getSwapRequirements = sdk.getSwapRequirements;
/** Build native swap instructions from caller-owned immutable account snapshots. */
export const buildSwapInstructions = sdk.buildSwapInstructions;
export * from "./core/index";
export * from "./transactions/index";
export { PROTOCOL_COVERAGE, type ProtocolCoverage } from "./protocols/coverage";

export * from "./sender/index";

export * from "./protocols/pump/pda";
export type { FetchSwapRequest, FetchSwapConfig } from "./fetch-swap";

/**
 * Fetch the accounts needed for a swap, quote it, and return unsigned instructions.
 *
 * @param rpc - Caller-owned Kit RPC used only for account reads.
 * @param request - Swap intent; pool ownership selects the protocol automatically.
 * @param config - Optional commitment and cancellation signal.
 * @returns The quote and ordered instructions, including required token-account setup.
 * @throws {@link SwapBuildError} for expected protocol or request failures, preserving
 * the offline builder's structured error in `detail`. RPC and cancellation failures
 * propagate unchanged. Invalid RPC batches and discovery limits raise `Error`.
 * @remarks Each discovery round refetches all known accounts and Clock together at
 * one bank context, up to 99 swap accounts and 20 RPC rounds. No accounts are cached.
 * For an application-maintained cache or feed, use `buildSwapInstructions` with your
 * own snapshot instead. This function does not wrap SOL, sign, send, or confirm.
 * @example
 * ```ts
 * const buy = await fetchSwapInstructions(rpc, {
 *   pool: await getPumpBondingCurveAddress(outputMint),
 *   owner, payer: owner, inputMint, outputMint,
 *   amount: { kind: "exactIn", amountIn: 10_000_000n },
 *   slippageBps: 100, fillPolicy: "requireFull",
 * });
 * // Supply buy.instructions to SenderClient.send with your signer, nonce and fees.
 * ```
 */
export function fetchSwapInstructions(
  rpc: Rpc<GetMultipleAccountsApi>,
  request: FetchSwapRequest,
  config?: FetchSwapConfig,
): Promise<SwapBuild> {
  return fetchSwapWithSdk(sdk, rpc, request, config);
}

export * from "./protocols/pump/amm-pda";
export * from "./protocols/sugar/pda";

export * from "./protocols/raydium/pda";
export * from "./protocols/meteora/damm-v1-pda";
export * from "./protocols/meteora/damm-v2-pda";
export * from "./protocols/meteora/dlmm-pda";
export * from "./protocols/meteora-dbc/pda";
export * from "./protocols/orca/pda";
export { METEORA_DAMM_V2_POOL_AUTHORITY } from "./protocols/meteora/constants";
export { METEORA_DBC_AUTHORITY } from "./protocols/meteora-dbc/constants";
export * from "./protocols/boop/pda";
export * from "./protocols/moonshot/pda";
export * from "./protocols/heaven/pda";
export * from "./protocols/metadao/pda";
export * from "./protocols/vertigo/pda";
export * from "./protocols/rise-rich/pda";
export * from "./protocols/liquid-af/pda";
export * from "./protocols/liquid-af-amm/pda";
export * from "./protocols/heaven/constants";
export * from "./protocols/liquid-af/constants";
export * from "./protocols/liquid-af-amm/constants";
