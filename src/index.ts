import { createProtocolSdk } from "./core/sdk.js";
import { pumpAdapter } from "./protocols/pump/bonding-curve.js";
import { raydiumCpmmAdapter } from "./protocols/raydium/cpmm.js";
import { orcaWhirlpoolAdapter } from "./protocols/orca/whirlpool.js";

const sdk = createProtocolSdk([pumpAdapter, raydiumCpmmAdapter, orcaWhirlpoolAdapter]);

/** Discover required account observations without performing network requests. */
export const getSwapRequirements = sdk.getSwapRequirements;
/** Build native swap instructions from caller-owned immutable account snapshots. */
export const buildSwapInstructions = sdk.buildSwapInstructions;
export * from "./core/index.js";
export * from "./transactions/index.js";
export { PROTOCOL_COVERAGE } from "./protocols/coverage.js";
