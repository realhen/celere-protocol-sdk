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
  getRaydiumCpmmSwapBaseInputInstruction,
  getRaydiumCpmmSwapBaseOutputInstruction,
  type RaydiumCpmmSwapBaseInputAccounts,
  type RaydiumCpmmSwapBaseInputArgs,
} from "celere-protocol-sdk/instructions/raydium-cpmm";

declare const nativeAccounts: RaydiumCpmmSwapBaseInputAccounts;
const nativeInstructions = [
  getRaydiumCpmmSwapBaseInputInstruction(nativeAccounts, {
    amountIn: 1_000_000n,
    minimumAmountOut: 900_000n,
  }),
  getRaydiumCpmmSwapBaseOutputInstruction(nativeAccounts, {
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
