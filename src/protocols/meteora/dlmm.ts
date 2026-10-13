/** Offline bigint adaptation of the ISC Meteora DLMM TypeScript SDK; see NOTICE.md. */
import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import {
  UnsupportedPoolFeatureError,
  InsufficientLiquidityError,
  InvalidSnapshotContextError,
} from "../errors";
import type { Address } from "@solana/kit";
import {
  accountDataView,
  readAddress,
  readU128,
  matchesDiscriminator,
} from "../accounts/bytes";
import { readMint, readTokenAccount, TOKEN_PROGRAM } from "../accounts/tokens";
import { ceilDiv, maximumInput, minimumOutput } from "../amounts";

import { requireAccount } from "../accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  SwapQuote,
  SwapRequest,
} from "../types";
import type { ResolvedTokenAccounts } from "../accounts/plan";

import { METEORA_DLMM_PROGRAM } from "./constants";

import {
  findMeteoraDlmmPoolPda,
  getMeteoraDlmmReserveAddress,
  getMeteoraDlmmOracleAddress,
  getMeteoraDlmmBitmapExtensionAddress,
  getMeteoraDlmmBinArrayAddress,
  getMeteoraDlmmEventAuthorityAddress,
} from "./dlmm-pda";
import { swap2 } from "./instructions/dlmm/swap2";
import { swap_exact_out2 } from "./instructions/dlmm/swap_exact_out2";

export * from "./dlmm-pda";
export { METEORA_DLMM_PROGRAM } from "./constants";

const Q64 = 1n << 64n;
const FEE_PRECISION = 1_000_000_000n;
const POOL_DISCRIMINATOR = [33, 11, 49, 98, 181, 101, 177, 13];
const ARRAY_DISCRIMINATOR = [92, 142, 92, 220, 5, 148, 70, 181];
const BITMAP_DISCRIMINATOR = [80, 111, 124, 113, 55, 237, 18, 5];
const ORACLE_DISCRIMINATOR = [139, 194, 131, 179, 140, 179, 229, 244];

interface Pool {
  readonly data: Uint8Array;
  readonly view: DataView;
  readonly mintX: Address;
  readonly mintY: Address;
  readonly reserveX: Address;
  readonly reserveY: Address;
  readonly oracle: Address;
  readonly activeId: number;
  readonly binStep: number;
  readonly minBinId: number;
  readonly maxBinId: number;
  readonly baseFee: bigint;
  readonly variableFeeControl: bigint;
  readonly maxVolatility: bigint;
  readonly volatilityReference: bigint;
  readonly indexReference: number;
}

interface Walk {
  readonly arrays: readonly Address[];
  readonly input: bigint;
  readonly output: bigint;
  readonly fee: bigint;
}

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "meteora-dlmm",
    feature,
    message: `Meteora DLMM ${feature} is not qualified for this release`,
  });
}

function insufficient(): never {
  throw new InsufficientLiquidityError({
    protocol: "meteora-dlmm",
    message: "Requested swap exceeds the supplied DLMM liquidity",
  });
}

function decodePool(request: SwapRequest): Pool {
  const { data } = requireAccount(
    request.snapshot,
    request.pool,
    "DLMM pool",
    METEORA_DLMM_PROGRAM,
  );
  if (data.length !== 904 || !matchesDiscriminator(data, POOL_DISCRIMINATOR)) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Unsupported DLMM pool layout or discriminator",
    });
  }

  const view = accountDataView(data);
  if (data[75] !== 0) {
    unsupported("permissioned, customizable or v2 pool addressing");
  }
  if (data[82] !== 0) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "DLMM pool is disabled",
    });
  }
  if (data[83]! > 1 || data[86]! > 1 || data[882]! > 1 || data[35]! > 2) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Unknown DLMM pool version or flags",
    });
  }
  if (data[36] !== 0) {
    unsupported("output-side fee collection");
  }
  if (data[880] !== 0 || data[881] !== 0) {
    unsupported("Token-2022 pools");
  }
  if (data[35] === 2) {
    unsupported("limit-order pools");
  }
  if (data.subarray(883).some((byte) => byte !== 0)) {
    unsupported("reserved pool features");
  }

  const binStep = view.getUint16(80, true);
  const activeId = view.getInt32(76, true);
  const minBinId = view.getInt32(24, true);
  const maxBinId = view.getInt32(28, true);
  const basePower = data[34]!;
  const filterPeriod = BigInt(view.getUint16(10, true));
  const decayPeriod = BigInt(view.getUint16(12, true));
  const reduction = BigInt(view.getUint16(14, true));
  const lastUpdate = view.getBigInt64(56, true);
  if (
    binStep === 0 ||
    basePower > 9 ||
    minBinId < -443636 ||
    maxBinId > 443636 ||
    minBinId >= maxBinId ||
    activeId < minBinId ||
    activeId > maxBinId ||
    filterPeriod > decayPeriod ||
    reduction > 10_000n ||
    view.getUint16(32, true) > 10_000
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid DLMM bin range or fee parameters",
    });
  }
  if (lastUpdate > request.snapshot.unixTimestamp || lastUpdate < 0n) {
    throw new InvalidSnapshotContextError({
      message: "DLMM volatility state is newer than the caller's chain timestamp",
    });
  }

  const maxVolatility = BigInt(view.getUint32(20, true));
  const volatilityAccumulator = BigInt(view.getUint32(40, true));
  let volatilityReference = BigInt(view.getUint32(44, true));
  let indexReference = view.getInt32(48, true);
  if (volatilityAccumulator > maxVolatility || volatilityReference > maxVolatility) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid DLMM volatility state",
    });
  }

  // Reset the volatility reference only after the native filter period has elapsed.
  const elapsed = request.snapshot.unixTimestamp - lastUpdate;
  if (elapsed >= filterPeriod) {
    indexReference = activeId;
    volatilityReference =
      elapsed < decayPeriod ? (volatilityAccumulator * reduction) / 10_000n : 0n;
  }

  const pool: Pool = {
    data,
    view,
    mintX: readAddress(data, 88),
    mintY: readAddress(data, 120),
    reserveX: readAddress(data, 152),
    reserveY: readAddress(data, 184),
    oracle: readAddress(data, 552),
    activeId,
    binStep,
    minBinId,
    maxBinId,
    baseFee:
      BigInt(view.getUint16(8, true)) * BigInt(binStep) * 10n * 10n ** BigInt(basePower),
    variableFeeControl: BigInt(view.getUint32(16, true)),
    maxVolatility,
    volatilityReference,
    indexReference,
  };
  if (
    pool.baseFee > 100_000_000n ||
    pool.mintX === pool.mintY ||
    pool.reserveX === pool.reserveY
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid DLMM fee or token pair",
    });
  }
  if (!(
    (request.inputMint === pool.mintX && request.outputMint === pool.mintY) ||
    (request.inputMint === pool.mintY && request.outputMint === pool.mintX)
  )) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Requested token pair does not match the DLMM pool",
    });
  }

  return pool;
}

async function validateAddresses(request: SwapRequest, pool: Pool): Promise<void> {
  const [expectedPool, bump] = await findMeteoraDlmmPoolPda({
    mintX: pool.mintX,
    mintY: pool.mintY,
    binStep: pool.view.getUint16(73, true),
    ...(pool.data[83] === 1 ? { baseFactor: pool.view.getUint16(84, true) } : {}),
  });
  if (
    expectedPool !== request.pool ||
    bump !== pool.data[72] ||
    pool.view.getUint16(73, true) !== pool.binStep
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid DLMM pool PDA or seeds",
    });
  }

  for (const [mint, reserve] of [
    [pool.mintX, pool.reserveX],
    [pool.mintY, pool.reserveY],
  ] as const) {
    if (reserve !== (await getMeteoraDlmmReserveAddress(request.pool, mint))) {
      throw new InvalidAccountError({
        address: reserve,
        message: "Invalid DLMM reserve PDA",
      });
    }
  }
  if (pool.oracle !== (await getMeteoraDlmmOracleAddress(request.pool))) {
    throw new InvalidAccountError({
      address: pool.oracle,
      message: "Invalid DLMM oracle PDA",
    });
  }
}

async function bitmapState(
  request: SwapRequest,
): Promise<{ address: Address; data: Uint8Array | null }> {
  const bitmap = await getMeteoraDlmmBitmapExtensionAddress(request.pool);
  if (request.snapshot.accounts[bitmap] === null) {
    return { address: bitmap, data: null };
  }

  const { data } = requireAccount(
    request.snapshot,
    bitmap,
    "DLMM bitmap extension (supply null if absent)",
    METEORA_DLMM_PROGRAM,
  );
  if (
    data.length !== 1576 ||
    !matchesDiscriminator(data, BITMAP_DISCRIMINATOR) ||
    readAddress(data, 8) !== request.pool
  ) {
    throw new InvalidAccountError({
      address: bitmap,
      message: "Invalid DLMM bitmap extension",
    });
  }

  return { address: bitmap, data };
}

function initialized(pool: Pool, bitmap: Uint8Array | null, index: number): boolean {
  if (index >= -512 && index <= 511) {
    const bit = index + 512;

    return (pool.data[584 + Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0;
  }
  if (!bitmap || index < -6656 || index > 6655) {
    return false;
  }

  const bit = index >= 512 ? index - 512 : -index - 513;
  const start = index >= 512 ? 40 : 808;

  return (bitmap[start + Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0;
}

function feeRate(pool: Pool, binId: number): bigint {
  const reference =
    pool.volatilityReference + BigInt(Math.abs(pool.indexReference - binId)) * 10_000n;
  const volatility = reference < pool.maxVolatility ? reference : pool.maxVolatility;
  const scaled = volatility * BigInt(pool.binStep);
  const rate =
    pool.baseFee + ceilDiv(pool.variableFeeControl * scaled * scaled, 100_000_000_000n);

  return rate < 100_000_000n ? rate : 100_000_000n;
}

/** Integer bin traversal uses only observed liquidity and the explicit chain clock. */
async function walk(
  request: SwapRequest,
  pool: Pool,
  bitmap: Uint8Array | null,
  requirements?: AccountRequirement[],
): Promise<Walk | null> {
  const swapForY = request.inputMint === pool.mintX;
  const step = swapForY ? -1 : 1;
  const minimumIndex = Math.floor(pool.minBinId / 70);
  const maximumIndex = Math.floor(pool.maxBinId / 70);
  let binId = pool.activeId;
  let index = Math.floor(binId / 70);
  let left =
    request.amount.kind === "exactIn"
      ? request.amount.amountIn
      : request.amount.amountOut;
  let input = 0n;
  let output = 0n;
  let fee = 0n;
  const arrays: Address[] = [];

  while (left > 0n) {
    // Skip uninitialized arrays before requesting the next observed liquidity account.
    while (
      index >= minimumIndex &&
      index <= maximumIndex &&
      !initialized(pool, bitmap, index)
    ) {
      index += step;
    }
    if (index < minimumIndex || index > maximumIndex) {
      insufficient();
    }
    if (arrays.length >= 8) {
      unsupported("swaps requiring more than eight bin arrays");
    }

    const arrayAddress = await getMeteoraDlmmBinArrayAddress(request.pool, BigInt(index));
    requirements?.push({ address: arrayAddress, role: "DLMM bin array" });
    // Discovery stops at missing data so the caller can supply it in the next round.
    if (requirements && request.snapshot.accounts[arrayAddress] === undefined) {
      return null;
    }

    const { data } = requireAccount(
      request.snapshot,
      arrayAddress,
      "DLMM bin array",
      METEORA_DLMM_PROGRAM,
    );
    const view = accountDataView(data);
    if (
      data.length !== 10136 ||
      !matchesDiscriminator(data, ARRAY_DISCRIMINATOR) ||
      view.getBigInt64(8, true) !== BigInt(index) ||
      readAddress(data, 24) !== request.pool ||
      data[16]! > 1
    ) {
      throw new InvalidAccountError({
        address: arrayAddress,
        message: "Invalid DLMM bin array layout, index or identity",
      });
    }

    arrays.push(arrayAddress);
    binId = Math.max(index * 70, Math.min(index * 70 + 69, binId));

    while (
      binId >= index * 70 &&
      binId < (index + 1) * 70 &&
      binId >= pool.minBinId &&
      binId <= pool.maxBinId &&
      left > 0n
    ) {
      const offset = 56 + (binId - index * 70) * 144;
      if (
        view.getBigUint64(offset + 112, true) !== 0n ||
        view.getBigUint64(offset + 120, true) !== 0n ||
        view.getBigUint64(offset + 128, true) !== 0n
      ) {
        unsupported("bins containing limit orders");
      }

      const available = view.getBigUint64(offset + (swapForY ? 8 : 0), true);
      if (available > 0n) {
        const price = readU128(view, offset + 16);
        if (price === 0n || readU128(view, offset + 32) === 0n) {
          throw new InvalidAccountError({
            address: arrayAddress,
            message: "DLMM liquid bin has zero price or liquidity supply",
          });
        }

        const rate = feeRate(pool, binId);
        const amountInFor = (amountOut: bigint): bigint =>
          swapForY ? ceilDiv(amountOut * Q64, price) : ceilDiv(amountOut * price, Q64);

        let binInput: bigint;
        let binOutput: bigint;
        let binFee: bigint;

        // Fees are rounded per bin, including the final partially consumed bin.
        if (request.amount.kind === "exactIn") {
          const offeredFee = ceilDiv(left * rate, FEE_PRECISION);
          const offered = left - offeredFee;
          const maximumInput = amountInFor(available);
          if (offered >= maximumInput) {
            binFee = ceilDiv(maximumInput * rate, FEE_PRECISION - rate);
            binInput = maximumInput + binFee;
            binOutput = available;
          } else {
            binInput = left;
            binFee = offeredFee;
            binOutput = swapForY ? (offered * price) / Q64 : (offered * Q64) / price;
          }

          left -= binInput;
        } else {
          binOutput = left < available ? left : available;
          const excludedInput = amountInFor(binOutput);
          binFee = ceilDiv(excludedInput * rate, FEE_PRECISION - rate);
          binInput = excludedInput + binFee;
          left -= binOutput;
        }

        input += binInput;
        output += binOutput;
        fee += binFee;
      }

      binId += step;
    }

    index += step;
  }
  if (input <= 0n || output <= 0n || input > U64_MAX || output > U64_MAX) {
    insufficient();
  }

  return { arrays, input, output, fee };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = decodePool(request);
  await validateAddresses(request, pool);
  const bitmapAddress = await getMeteoraDlmmBitmapExtensionAddress(request.pool);
  const result: AccountRequirement[] = [
    { address: request.pool, role: "DLMM pool" },
    { address: pool.mintX, role: "token X mint" },
    { address: pool.mintY, role: "token Y mint" },
    { address: pool.reserveX, role: "token X reserve" },
    { address: pool.reserveY, role: "token Y reserve" },
    { address: pool.oracle, role: "DLMM oracle" },
    { address: bitmapAddress, role: "DLMM bitmap extension", optional: true },
  ];
  if (request.snapshot.accounts[bitmapAddress] === undefined) {
    return result;
  }

  const bitmap = await bitmapState(request);
  await walk(request, pool, bitmap.data, result);

  return result;
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = decodePool(request);
  await validateAddresses(request, pool);
  const bitmap = await bitmapState(request);

  for (const mint of [pool.mintX, pool.mintY]) {
    if (readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM) {
      throw new InvalidAccountError({
        address: mint,
        message: "DLMM pool token program flag does not match mint",
      });
    }
  }

  const reserveX = readTokenAccount(
    request.snapshot,
    pool.reserveX,
    pool.mintX,
    TOKEN_PROGRAM,
    request.pool,
  ).amount;
  const reserveY = readTokenAccount(
    request.snapshot,
    pool.reserveY,
    pool.mintY,
    TOKEN_PROGRAM,
    request.pool,
  ).amount;
  const protocolX = pool.view.getBigUint64(216, true);
  const protocolY = pool.view.getBigUint64(224, true);
  if (reserveX < protocolX || reserveY < protocolY) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "DLMM protocol fees exceed reserve balances",
    });
  }

  const oracle = requireAccount(
    request.snapshot,
    pool.oracle,
    "DLMM oracle",
    METEORA_DLMM_PROGRAM,
  ).data;
  const oracleView = accountDataView(oracle);
  if (
    oracle.length < 64 ||
    !matchesDiscriminator(oracle, ORACLE_DISCRIMINATOR) ||
    BigInt(oracle.length - 32) !== oracleView.getBigUint64(24, true) * 32n ||
    oracleView.getBigUint64(8, true) >= oracleView.getBigUint64(24, true) ||
    oracleView.getBigUint64(16, true) > oracleView.getBigUint64(24, true)
  ) {
    throw new InvalidAccountError({
      address: pool.oracle,
      message: "Invalid DLMM oracle layout",
    });
  }

  const curve = (await walk(request, pool, bitmap.data))!;
  const swapForY = request.inputMint === pool.mintX;
  if (
    curve.output > (swapForY ? reserveY - protocolY : reserveX - protocolX) ||
    (swapForY ? reserveX : reserveY) + curve.input > U64_MAX
  ) {
    insufficient();
  }

  const fees = [{ kind: "trade" as const, mint: request.inputMint, amount: curve.fee }];
  const quote: SwapQuote =
    request.amount.kind === "exactIn"
      ? {
          kind: "exactIn",
          amountIn: curve.input,
          minimumAmountOut: minimumOutput(curve.output, request.slippageBps),
          expectedAmountIn: curve.input,
          expectedAmountOut: curve.output,
          fees,
        }
      : {
          kind: "exactOut",
          amountOut: curve.output,
          maximumAmountIn: maximumInput(curve.input, request.slippageBps),
          expectedAmountIn: curve.input,
          expectedAmountOut: curve.output,
          fees,
        };

  const instructionAccounts = {
    pool: request.pool,
    bitmapExtension: bitmap.data ? bitmap.address : null,
    reserveX: pool.reserveX,
    reserveY: pool.reserveY,
    userTokenIn: tokenAccounts.input,
    userTokenOut: tokenAccounts.output,
    tokenMintX: pool.mintX,
    tokenMintY: pool.mintY,
    oracle: pool.oracle,
    sender: request.owner,
    tokenProgramX: TOKEN_PROGRAM,
    tokenProgramY: TOKEN_PROGRAM,
    eventAuthority: await getMeteoraDlmmEventAuthorityAddress(),
    binArrays: curve.arrays,
  };
  const instruction =
    quote.kind === "exactIn"
      ? swap2(instructionAccounts, {
          amountIn: quote.amountIn,
          minimumAmountOut: quote.minimumAmountOut,
        })
      : swap_exact_out2(instructionAccounts, {
          maximumAmountIn: quote.maximumAmountIn,
          amountOut: quote.amountOut,
        });

  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/**
 * Offline native DLMM exact-input/output swaps across observed market-maker bins.
 * @remarks Supports classic SPL permissionless pools, input fees and timestamp-based
 * dynamic fee updates. Caller observations must include the optional bitmap as data
 * or explicit null. Discovery reveals bin arrays in successive rounds. Limit orders,
 * other pool address schemes, Token-2022 and output fees fail explicitly. No clock,
 * network, account cache, wallet, wrapping or transaction submission is owned here.
 */
export const meteoraDlmmAdapter: ProtocolAdapter = {
  id: "meteora-dlmm",
  programAddresses: [METEORA_DLMM_PROGRAM],
  requirements,
  build,
};
