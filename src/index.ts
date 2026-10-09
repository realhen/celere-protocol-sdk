import { createRouteSdk } from "./core/routes.js";
import { pumpRouteAdapter } from "./protocols/pump/route.js";
import { createProtocolSdk } from "./core/sdk.js";
import { boopAdapter } from "./protocols/boop/adapter.js";
import { heavenAdapter } from "./protocols/heaven/amm.js";
import { liquidAfAmmAdapter } from "./protocols/liquid-af-amm/amm.js";
import { liquidAfAdapter } from "./protocols/liquid-af/curve.js";
import { metadaoAdapter } from "./protocols/metadao/amm.js";
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
import { riseRichAdapter } from "./protocols/rise-rich/curve.js";
import { vertigoAdapter } from "./protocols/vertigo/amm.js";
import { virtualCurveAdapter } from "./protocols/virtual-curve/adapter.js";

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
  virtualCurveAdapter,
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
export * from "./core/index.js";
export * from "./transactions/index.js";
export { PROTOCOL_COVERAGE, type ProtocolCoverage } from "./protocols/coverage.js";
