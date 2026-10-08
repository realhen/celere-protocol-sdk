import { createProtocolSdk } from "./core/sdk.js";
import { pumpAmmAdapter } from "./protocols/pump/amm.js";
import { pumpAdapter } from "./protocols/pump/bonding-curve.js";
import { raydiumClmmAdapter } from "./protocols/raydium/clmm.js";
import { meteoraDlmmAdapter } from "./protocols/meteora/dlmm.js";
import { raydiumAmmV4Adapter } from "./protocols/raydium/amm-v4.js";
import { raydiumCpmmAdapter } from "./protocols/raydium/cpmm.js";
import { raydiumLaunchlabAdapter } from "./protocols/raydium/launchlab.js";
import { meteoraDammV2Adapter } from "./protocols/meteora/damm-v2.js";
import { orcaWhirlpoolAdapter } from "./protocols/orca/whirlpool.js";

const sdk = createProtocolSdk([
  pumpAdapter,
  pumpAmmAdapter,
  raydiumCpmmAdapter,
  raydiumAmmV4Adapter,
  raydiumClmmAdapter,
  meteoraDlmmAdapter,
  raydiumLaunchlabAdapter,
  meteoraDammV2Adapter,
  orcaWhirlpoolAdapter,
]);

/** Discover required account observations without performing network requests. */
export const getSwapRequirements = sdk.getSwapRequirements;
/** Build native swap instructions from caller-owned immutable account snapshots. */
export const buildSwapInstructions = sdk.buildSwapInstructions;
export * from "./core/index.js";
export * from "./transactions/index.js";
export { PROTOCOL_COVERAGE } from "./protocols/coverage.js";
