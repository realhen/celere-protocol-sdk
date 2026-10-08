import { createProtocolSdk } from "./core/sdk.js";
import { meteoraDammV1Adapter } from "./protocols/meteora/damm-v1.js";
import { meteoraDammV2Adapter } from "./protocols/meteora/damm-v2.js";
import { meteoraDlmmAdapter } from "./protocols/meteora/dlmm.js";
import { moonshotAdapter } from "./protocols/moonshot/curve.js";
import { orcaWhirlpoolAdapter } from "./protocols/orca/whirlpool.js";
import { pumpAmmAdapter } from "./protocols/pump/amm.js";
import { pumpAdapter } from "./protocols/pump/bonding-curve.js";
import { raydiumAmmV4Adapter } from "./protocols/raydium/amm-v4.js";
import { raydiumClmmAdapter } from "./protocols/raydium/clmm.js";
import { raydiumCpmmAdapter } from "./protocols/raydium/cpmm.js";
import { raydiumLaunchlabAdapter } from "./protocols/raydium/launchlab.js";
import { vertigoAdapter } from "./protocols/vertigo/amm.js";

const sdk = createProtocolSdk([
  pumpAdapter,
  pumpAmmAdapter,
  raydiumAmmV4Adapter,
  raydiumCpmmAdapter,
  raydiumClmmAdapter,
  meteoraDammV1Adapter,
  meteoraDammV2Adapter,
  meteoraDlmmAdapter,
  moonshotAdapter,
  orcaWhirlpoolAdapter,
  raydiumLaunchlabAdapter,
  vertigoAdapter,
]);

/** Discover required account observations without performing network requests. */
export const getSwapRequirements = sdk.getSwapRequirements;
/** Build native swap instructions from caller-owned immutable account snapshots. */
export const buildSwapInstructions = sdk.buildSwapInstructions;
export * from "./core/index.js";
export * from "./transactions/index.js";
export { PROTOCOL_COVERAGE } from "./protocols/coverage.js";
