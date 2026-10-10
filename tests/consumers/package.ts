import { liquidAfAmmAdapter } from "celere-protocol-sdk/protocols/liquid-af-amm";
import { riseRichAdapter } from "celere-protocol-sdk/protocols/rise-rich";
import { liquidAfAdapter } from "celere-protocol-sdk/protocols/liquid-af";
import { boopAdapter } from "celere-protocol-sdk/protocols/boop";
import { heavenAdapter } from "celere-protocol-sdk/protocols/heaven";
import { metadaoAdapter } from "celere-protocol-sdk/protocols/metadao";
import { meteoraDbcAdapter } from "celere-protocol-sdk/protocols/meteora-dbc";
import {
  address,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
  type SwapRequest,
  type BuildError,
} from "celere-protocol-sdk";
import { createProtocolSdk } from "celere-protocol-sdk/core";
import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";
import { pumpAdapter } from "celere-protocol-sdk/protocols/pump";
import { orcaWhirlpoolAdapter } from "celere-protocol-sdk/protocols/orca";
import { pumpAmmAdapter } from "celere-protocol-sdk/protocols/pump-amm";
import { raydiumLaunchlabAdapter } from "celere-protocol-sdk/protocols/raydium-launchlab";
import { meteoraDammV2Adapter } from "celere-protocol-sdk/protocols/meteora-damm-v2";
import { raydiumAmmV4Adapter } from "celere-protocol-sdk/protocols/raydium-amm-v4";
import { raydiumClmmAdapter } from "celere-protocol-sdk/protocols/raydium-clmm";
import { meteoraDlmmAdapter } from "celere-protocol-sdk/protocols/meteora-dlmm";
import { meteoraDammV1Adapter } from "celere-protocol-sdk/protocols/meteora-damm-v1";
import { moonshotAdapter } from "celere-protocol-sdk/protocols/moonshot";
import { vertigoAdapter } from "celere-protocol-sdk/protocols/vertigo";
import { compileTransaction as compiler } from "celere-protocol-sdk/transactions";
declare const request: SwapRequest;
const subset = createProtocolSdk([
  liquidAfAmmAdapter,
  riseRichAdapter,
  liquidAfAdapter,
  boopAdapter,
  heavenAdapter,
  metadaoAdapter,
  meteoraDbcAdapter,
  meteoraDammV1Adapter,
  moonshotAdapter,
  vertigoAdapter,
  raydiumCpmmAdapter,
  pumpAdapter,
  orcaWhirlpoolAdapter,
  pumpAmmAdapter,
  raydiumLaunchlabAdapter,
  meteoraDammV2Adapter,
  raydiumAmmV4Adapter,
  raydiumClmmAdapter,
  meteoraDlmmAdapter,
]);
const requirements = await getSwapRequirements(request);
const result = await buildSwapInstructions(request);
if (result.ok) {
  const quote = result.value.quote;
  if (quote.kind === "exactOut") {
    const limit: bigint = quote.maximumAmountIn;
    void limit;
  }
  const tx = compileTransaction({
    feePayer: address("11111111111111111111111111111111"),
    lifetime: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n },
    instructions: result.value.instructions,
  });
  if (tx.ok) {
    const bytes: Uint8Array = tx.value.wireBytes;
    void bytes;
  }
} else {
  const error: BuildError = result.error;
  if (error.code === "MISSING_ACCOUNTS") {
    const role: string | undefined = error.accounts[0]?.role;
    void role;
  }
}
// @ts-expect-error Atomic quantities must never accept floating-point numbers.
const wrong: SwapRequest["amount"] = { kind: "exactIn", amountIn: 0.5 };
void [subset, requirements, compiler, wrong];

import {
  swap_base_input,
  swap_base_output,
  type RaydiumCpmmSwapBaseInputAccounts,
  type RaydiumCpmmSwapBaseInputArgs,
} from "celere-protocol-sdk/instructions/raydium-cpmm";

declare const nativeAccounts: RaydiumCpmmSwapBaseInputAccounts;
const nativeInstructions = [
  swap_base_input(nativeAccounts, {
    amountIn: 1_000_000n,
    minimumAmountOut: 900_000n,
  }),
  swap_base_output(nativeAccounts, {
    maximumAmountIn: 1_100_000n,
    amountOut: 1_000_000n,
  }),
];
compiler({
  feePayer: nativeAccounts.owner,
  lifetime: {
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 1n,
  },
  instructions: nativeInstructions,
});
const invalidNativeArgs: RaydiumCpmmSwapBaseInputArgs = {
  // @ts-expect-error Native instruction quantities also require bigint atomic units.
  amountIn: 0.5,
  minimumAmountOut: 1n,
};
void invalidNativeArgs;

import { createRouteSdk, type RouteRequest } from "celere-protocol-sdk/core";
import { pumpRouteAdapter } from "celere-protocol-sdk/protocols/pump-routes";
import { buildRouteInstructions, getRouteRequirements } from "celere-protocol-sdk";
import {
  buy_v3,
  sweep_creator_fee,
  type PumpSweepCreatorFeeAccounts,
} from "celere-protocol-sdk/instructions/pump";
import {
  multi_hop_swap,
  sweep_protocol_fee,
  type PumpAmmSweepProtocolFeeAccounts,
} from "celere-protocol-sdk/instructions/pump-amm";
declare const routeRequest: RouteRequest;
const routeSubset = createRouteSdk([pumpRouteAdapter]);
const routeRequirements = await getRouteRequirements(routeRequest);
const route = await buildRouteInstructions(routeRequest);
if (route.ok) {
  const amount: bigint | undefined = route.value.hops[0]?.quote.expectedAmountOut;
  compiler({
    feePayer: routeRequest.payer,
    instructions: route.value.instructions,
    lifetime: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n },
  });
  void amount;
}
declare const curveSweepAccounts: PumpSweepCreatorFeeAccounts;
declare const poolSweepAccounts: PumpAmmSweepProtocolFeeAccounts;
void [
  routeSubset,
  routeRequirements,
  buy_v3,
  multi_hop_swap,
  sweep_creator_fee(curveSweepAccounts),
  sweep_protocol_fee(poolSweepAccounts),
];

// Provider options retain their region constraints through the published declarations.
import {
  SenderClient,
  ZeroSlotSender,
  AstralaneSender,
  Region,
  SenderConfigurationError,
  type SenderError,
} from "celere-protocol-sdk/sender";
const sender = new SenderClient({
  defaultRpc: { url: "https://rpc.example" },
  routes: [new ZeroSlotSender({ apiKey: "example", region: Region.Frankfurt })],
});
// @ts-expect-error 0slot does not publish a London endpoint.
new ZeroSlotSender({ apiKey: "example", region: Region.London });
// @ts-expect-error Binary Iris has no built-in Dublin lane.
new AstralaneSender({ apiKey: "example", region: Region.Dublin });
const senderError: SenderError = new SenderConfigurationError("Invalid endpoint");
void [sender, senderError];
