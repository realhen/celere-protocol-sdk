import { liquidAfAmmAdapter } from "celere-protocol-sdk/protocols/liquid-af-amm";
import { riseRichAdapter } from "celere-protocol-sdk/protocols/rise-rich";
import { liquidAfAdapter } from "celere-protocol-sdk/protocols/liquid-af";
import { boopAdapter } from "celere-protocol-sdk/protocols/boop";
import { heavenAdapter } from "celere-protocol-sdk/protocols/heaven";
import { metadaoAdapter } from "celere-protocol-sdk/protocols/metadao";
import { meteoraDbcAdapter } from "celere-protocol-sdk/protocols/meteora-dbc";
import type {
  ProtocolError,
  ProtocolErrorCode,
  ValidationErrorCode,
  TransactionErrorCode,
} from "celere-protocol-sdk";
import {
  address,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
  fetchSwapInstructions,
  getPumpBondingCurveAddress,
  InvalidRequestError,
  MissingAccountsError,
  TransactionTooLargeError,
  type SwapRequest,
} from "celere-protocol-sdk";
import { createProtocolSdk } from "celere-protocol-sdk/protocols";
import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";
import { createSolanaRpc } from "@solana/kit";
import { getPumpBondingCurveAddress as getCurveFromPump } from "celere-protocol-sdk/protocols/pump";
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
try {
  const result = await buildSwapInstructions(request);
  const quote = result.quote;
  if (quote.kind === "exactOut") {
    const limit: bigint = quote.maximumAmountIn;
    void limit;
  }
  const tx = compileTransaction({
    feePayer: address("11111111111111111111111111111111"),
    lifetime: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n },
    instructions: result.instructions,
  });
  const bytes: Uint8Array = tx.wireBytes;
  void bytes;
} catch (error) {
  if (error instanceof MissingAccountsError) {
    const role: string | undefined = error.accounts[0]?.role;
    const code: ProtocolErrorCode.MissingAccounts = error.code;
    void [role, code];
  } else if (error instanceof TransactionTooLargeError) {
    const size: number = error.size;
    const limit: number = error.limit;
    const code: TransactionErrorCode.TransactionTooLarge = error.code;
    void [size, limit, code];
  } else {
    throw error;
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

import { createRouteSdk, type RouteRequest } from "celere-protocol-sdk/protocols";
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
const amount: bigint | undefined = route.hops[0]?.quote.expectedAmountOut;
compiler({
  feePayer: routeRequest.payer,
  instructions: route.instructions,
  lifetime: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n },
});
void amount;
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

// Root convenience imports and focused imports must share nominal class types.
import {
  SenderClient as RootSenderClient,
  SenderConfigurationError as RootSenderConfigurationError,
  type SendRequest as RootSendRequest,
} from "celere-protocol-sdk";
import type { SendRequest } from "celere-protocol-sdk/sender";
const rootClient: RootSenderClient = sender;
const focusedClient: SenderClient = new RootSenderClient({
  defaultRpc: { url: "https://rpc.example" },
});
const sharedError: SenderError = new RootSenderConfigurationError("example");
declare const rootRequest: RootSendRequest;
const focusedRequest: SendRequest = rootRequest;
void [rootClient, focusedClient, sharedError, focusedRequest];

// RPC convenience returns the build directly and preserves typed failure details.
const { snapshot: unusedSnapshot, ...intent } = request;
const fetched = await fetchSwapInstructions(
  createSolanaRpc("http://localhost:8899"),
  intent,
  {
    commitment: "confirmed",
    abortSignal: new AbortController().signal,
  },
);
const pool = await getPumpBondingCurveAddress(request.outputMint);
const samePool = await getCurveFromPump(request.outputMint);
void [unusedSnapshot, fetched.instructions, pool, samePool];
try {
  await fetchSwapInstructions(createSolanaRpc("http://localhost:8899"), intent);
} catch (error) {
  if (error instanceof InvalidRequestError) {
    const field: string = error.field;
    void field;
  } else {
    throw error;
  }
}

// Error constructors retain identity and direct metadata across focused imports.
import type { InvalidRequestError as ProtocolInvalidRequestError } from "celere-protocol-sdk/protocols";
import { MissingAccountsError as FocusedMissingAccountsError } from "celere-protocol-sdk/protocols";
import {
  TransactionTooLargeError as FocusedTransactionTooLargeError,
  InvalidRequestError as TransactionInvalidRequestError,
} from "celere-protocol-sdk/transactions";
const protocolError: ProtocolError = new FocusedMissingAccountsError({
  message: "Missing pool",
  accounts: [],
});
const rootMissing: MissingAccountsError = new FocusedMissingAccountsError({
  message: "Missing pool",
  accounts: [],
});
const transactionError: TransactionTooLargeError = new FocusedTransactionTooLargeError({
  message: "Too large",
  size: 1233,
  limit: 1232,
});
const invalidRequest: ProtocolInvalidRequestError = new TransactionInvalidRequestError({
  field: "amount",
  message: "Invalid amount",
});
const validationCode: ValidationErrorCode.InvalidRequest = invalidRequest.code;
void [protocolError, rootMissing, transactionError, validationCode];
