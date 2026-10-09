import type { Address } from "@solana/kit";
import { swap_v2 } from "./instructions/swap_v2.js";
import type { TickArrayFacade } from "@orca-so/whirlpools-core";
import {
  WHIRLPOOL_PROGRAM,
  decodePool,
  decodeFixedArray,
  poolAddress,
  tickArrayAddress,
  oracleAddress,
  type Pool,
} from "./layout.js";
import { readMint, readTokenAccount } from "../../accounts/tokens.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapQuote,
  SwapRequest,
} from "../../core/types.js";
import { orcaCore } from "./core.js";

const TICK_ARRAY_SIZE = 88;
const MIN_TICK = -443636;
const MAX_TICK = 443636;
/** Inclusive Q64.64 bounds at the pinned Orca core's minimum and maximum ticks. */
const MIN_SQRT_PRICE = 4295048016n;
const MAX_SQRT_PRICE = 79226673515401279992447579055n;

function invalidAccount(account: Address, message: string): never {
  return fail({ code: "INVALID_ACCOUNT", address: account, message });
}

async function readPool(request: SwapRequest): Promise<Pool> {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "Whirlpool",
    WHIRLPOOL_PROGRAM,
  );
  const pool = decodePool(account);
  if (
    pool.tickSpacing === 0 ||
    pool.tickCurrentIndex < MIN_TICK ||
    pool.tickCurrentIndex > MAX_TICK ||
    pool.tokenMintA === pool.tokenMintB
  ) {
    invalidAccount(
      request.pool,
      "Invalid Whirlpool tick spacing, current tick, or token pair",
    );
  }
  if (pool.sqrtPrice < MIN_SQRT_PRICE || pool.sqrtPrice > MAX_SQRT_PRICE) {
    invalidAccount(
      request.pool,
      "Whirlpool square-root price is outside protocol bounds",
    );
  }
  if (pool.protocolFeeRate > 10_000) {
    invalidAccount(request.pool, "Whirlpool protocol fee exceeds 10000 basis points");
  }
  if (!(
    (request.inputMint === pool.tokenMintA && request.outputMint === pool.tokenMintB) ||
    (request.inputMint === pool.tokenMintB && request.outputMint === pool.tokenMintA)
  )) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mint pair does not match the Whirlpool",
    });
  }
  if (pool.feeTierIndex !== pool.tickSpacing)
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "orca-whirlpool",
      feature: "adaptiveFees",
      message: "Adaptive-fee Whirlpools are not qualified in this release",
    });
  const [expectedPool, bump] = await poolAddress(pool);
  if (expectedPool !== request.pool || pool.bump !== bump) {
    invalidAccount(
      request.pool,
      "Whirlpool address does not match its mint pair, configuration, and fee tier",
    );
  }
  if (pool.rewardLastUpdatedTimestamp > request.snapshot.unixTimestamp) {
    fail({
      code: "INVALID_SNAPSHOT_CONTEXT",
      message: "Whirlpool state is newer than supplied chain time",
    });
  }
  return pool;
}

async function discoverArrays(
  poolAddress: Address,
  pool: Pool,
): Promise<readonly { address: Address; startTickIndex: number }[]> {
  const span = TICK_ARRAY_SIZE * pool.tickSpacing;
  const currentStart = Math.floor(pool.tickCurrentIndex / span) * span;
  const minimumStart = Math.floor(MIN_TICK / span) * span;
  const starts = [
    currentStart,
    currentStart + span,
    currentStart + span * 2,
    currentStart - span,
    currentStart - span * 2,
  ].filter((start) => start >= minimumStart && start <= MAX_TICK);
  return Promise.all(
    starts.map(async (startTickIndex) => ({
      address: (await tickArrayAddress(poolAddress, startTickIndex))[0],
      startTickIndex,
    })),
  );
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = await readPool(request);
  const arrays = await discoverArrays(request.pool, pool);
  const [oracle] = await oracleAddress(request.pool);
  return [
    { address: request.pool, role: "Whirlpool" },
    { address: pool.tokenMintA, role: "Whirlpool token A mint" },
    { address: pool.tokenMintB, role: "Whirlpool token B mint" },
    { address: pool.tokenVaultA, role: "Whirlpool token A vault" },
    { address: pool.tokenVaultB, role: "Whirlpool token B vault" },
    ...arrays.map((array) => ({
      address: array.address,
      role: `Whirlpool tick array ${array.startTickIndex}`,
      optional: true,
    })),
    { address: oracle, role: "Whirlpool oracle", optional: true },
  ];
}

function emptyArray(startTickIndex: number): TickArrayFacade {
  return {
    startTickIndex,
    ticks: Array.from({ length: TICK_ARRAY_SIZE }, () => ({
      initialized: false,
      liquidityNet: 0n,
      liquidityGross: 0n,
      feeGrowthOutsideA: 0n,
      feeGrowthOutsideB: 0n,
      rewardGrowthsOutside: [0n, 0n, 0n],
    })),
  };
}

function readArray(
  request: SwapRequest,
  entry: { address: Address; startTickIndex: number },
): TickArrayFacade {
  if (request.snapshot.accounts[entry.address] === null)
    return emptyArray(entry.startTickIndex);
  const account = requireAccount(
    request.snapshot,
    entry.address,
    "Whirlpool tick array",
    WHIRLPOOL_PROGRAM,
  );
  return decodeFixedArray(account, request.pool, entry.startTickIndex);
}

function quoteSwap(
  request: SwapRequest,
  pool: Pool,
  arrays: TickArrayFacade[],
): SwapQuote {
  if (
    pool.liquidity === 0n &&
    arrays.every((array) => array.ticks.every((tick) => !tick.initialized))
  ) {
    fail({
      code: "INSUFFICIENT_LIQUIDITY",
      protocol: "orca-whirlpool",
      message:
        "No active or initialized liquidity is present in the supplied tick arrays",
    });
  }
  const core = orcaCore();
  try {
    if (request.amount.kind === "exactIn") {
      const quote = core.swapQuoteByInputToken(
        request.amount.amountIn,
        request.inputMint === pool.tokenMintA,
        request.slippageBps,
        pool,
        arrays,
      );
      if (quote.tokenEstOut === 0n)
        fail({
          code: "INSUFFICIENT_LIQUIDITY",
          protocol: "orca-whirlpool",
          message: "Swap produces no output",
        });
      return {
        kind: "exactIn",
        amountIn: request.amount.amountIn,
        minimumAmountOut: quote.tokenMinOut,
        expectedAmountIn: quote.tokenIn,
        expectedAmountOut: quote.tokenEstOut,
        fees: [{ kind: "trade", mint: request.inputMint, amount: quote.tradeFee }],
      };
    }
    const quote = core.swapQuoteByOutputToken(
      request.amount.amountOut,
      request.outputMint === pool.tokenMintA,
      request.slippageBps,
      pool,
      arrays,
    );
    if (quote.tokenOut !== request.amount.amountOut)
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "orca-whirlpool",
        message: "Supplied Whirlpool liquidity cannot fill the requested output",
      });
    return {
      kind: "exactOut",
      amountOut: request.amount.amountOut,
      maximumAmountIn: quote.tokenMaxIn,
      expectedAmountIn: quote.tokenEstIn,
      expectedAmountOut: quote.tokenOut,
      fees: [{ kind: "trade", mint: request.inputMint, amount: quote.tradeFee }],
    };
  } catch (error) {
    if (
      error === core._TICK_INDEX_OUT_OF_BOUNDS() ||
      error === core._TICK_INDEX_NOT_IN_ARRAY() ||
      error === core._ZERO_TRADABLE_AMOUNT()
    ) {
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "orca-whirlpool",
        message: "Supplied tick-array coverage or liquidity is insufficient for the swap",
      });
    }
    if (error === core._AMOUNT_EXCEEDS_MAX_U64())
      fail({
        code: "INVALID_REQUEST",
        field: "amount",
        message: "Whirlpool quote exceeds a u64 token amount",
      });
    throw error;
  }
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  if (request.amount.kind === "exactIn" && request.fillPolicy !== "allowPartial") {
    fail({
      code: "UNSUPPORTED_FILL_POLICY",
      protocol: "orca-whirlpool",
      message:
        "Whirlpool exact-input execution may partially fill; choose allowPartial explicitly",
    });
  }
  const pool = await readPool(request);
  const tokenA = readMint(request.snapshot, pool.tokenMintA);
  const tokenB = readMint(request.snapshot, pool.tokenMintB);
  readTokenAccount(
    request.snapshot,
    pool.tokenVaultA,
    pool.tokenMintA,
    tokenA.tokenProgram,
    request.pool,
  );
  readTokenAccount(
    request.snapshot,
    pool.tokenVaultB,
    pool.tokenMintB,
    tokenB.tokenProgram,
    request.pool,
  );
  const arrays = await discoverArrays(request.pool, pool);
  const [oracle] = await oracleAddress(request.pool);
  const quote = quoteSwap(
    request,
    pool,
    arrays.map((entry) => readArray(request, entry)),
  );
  const aToB = request.inputMint === pool.tokenMintA;
  const paddedArrays = [...arrays];
  while (paddedArrays.length < 3) paddedArrays.push(paddedArrays[0]!);
  const supplementalArrays = paddedArrays.slice(3);
  const instruction = swap_v2(
    {
      tokenProgramA: tokenA.tokenProgram,
      tokenProgramB: tokenB.tokenProgram,
      tokenAuthority: request.owner,
      whirlpool: request.pool,
      tokenMintA: pool.tokenMintA,
      tokenMintB: pool.tokenMintB,
      tokenOwnerAccountA: aToB ? accounts.input : accounts.output,
      tokenVaultA: pool.tokenVaultA,
      tokenOwnerAccountB: aToB ? accounts.output : accounts.input,
      tokenVaultB: pool.tokenVaultB,
      tickArray0: paddedArrays[0]!.address,
      tickArray1: paddedArrays[1]!.address,
      tickArray2: paddedArrays[2]!.address,
      oracle,
      supplementalTickArrays: supplementalArrays.map((array) => array.address),
    },
    {
      amount: quote.kind === "exactIn" ? quote.amountIn : quote.amountOut,
      otherAmountThreshold:
        quote.kind === "exactIn" ? quote.minimumAmountOut : quote.maximumAmountIn,
      sqrtPriceLimit: 0n,
      amountSpecifiedIsInput: quote.kind === "exactIn",
      aToB,
    },
  );
  return {
    instructions: [instruction],
    quote,
    mayPartiallyFill: quote.kind === "exactIn",
  };
}

/**
 * Offline Whirlpool swap-v2 adapter using the Apache-licensed Orca quote core.
 * @remarks Supports native exact input and exact output, fixed tick arrays, and
 * static fees. Adaptive fees and dynamic tick arrays are rejected. Token extensions
 * remain subject to the shared token validator. Exact output uses a zero price
 * limit, which makes the program reject partial fills.
 */
export const orcaWhirlpoolAdapter: ProtocolAdapter = {
  id: "orca-whirlpool",
  programAddresses: [WHIRLPOOL_PROGRAM],
  requirements,
  build,
};
