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
