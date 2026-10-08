/** Offline bigint adaptation of the ISC Meteora DLMM TypeScript SDK; see NOTICE.md. */
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { readMint, readTokenAccount, TOKEN_PROGRAM } from "../../accounts/tokens.js";
import { ceilDiv, maximumInput, minimumOutput, U64_MAX } from "../../core/amounts.js";
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

import { METEORA_DLMM_PROGRAM } from "./constants.js";
import { getMeteoraDlmmSwap2Instruction } from "./instructions/dlmm/swap2.js";
import { getMeteoraDlmmSwapExactOut2Instruction } from "./instructions/dlmm/swap-exact-out2.js";
export { METEORA_DLMM_PROGRAM } from "./constants.js";
const Q64 = 1n << 64n;
const FEE_PRECISION = 1_000_000_000n;
const encodeAddress = getAddressEncoder();
const decodeAddress = getAddressDecoder();
const textEncoder = new TextEncoder();
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
function invalid(accountAddress: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: accountAddress, message });
}
function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "meteora-dlmm",
    feature,
    message: `Meteora DLMM ${feature} is not qualified for this release`,
  });
}
function insufficient(): never {
  fail({
    code: "INSUFFICIENT_LIQUIDITY",
    protocol: "meteora-dlmm",
    message: "Requested swap exceeds the supplied DLMM liquidity",
  });
}
function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
function readAddress(data: Uint8Array, offset: number): Address {
  return decodeAddress.decode(data.subarray(offset, offset + 32));
}
function u128(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true) + (view.getBigUint64(offset + 8, true) << 64n);
}
function discriminator(data: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => data[index] === byte);
}
async function pda(
  seeds: Parameters<typeof getProgramDerivedAddress>[0]["seeds"],
): Promise<Address> {
  return (
    await getProgramDerivedAddress({ programAddress: METEORA_DLMM_PROGRAM, seeds })
  )[0];
}
function decodePool(request: SwapRequest): Pool {
  const { data } = requireAccount(
    request.snapshot,
    request.pool,
    "DLMM pool",
    METEORA_DLMM_PROGRAM,
  );
  if (data.length !== 904 || !discriminator(data, POOL_DISCRIMINATOR))
    invalid(request.pool, "Unsupported DLMM pool layout or discriminator");
  const view = viewOf(data);
  if (data[75] !== 0) unsupported("permissioned, customizable or v2 pool addressing");
  if (data[82] !== 0) invalid(request.pool, "DLMM pool is disabled");
  if (data[83]! > 1 || data[86]! > 1 || data[882]! > 1 || data[35]! > 2)
    invalid(request.pool, "Unknown DLMM pool version or flags");
  if (data[36] !== 0) unsupported("output-side fee collection");
  if (data[880] !== 0 || data[881] !== 0) unsupported("Token-2022 pools");
  if (data[35] === 2) unsupported("limit-order pools");
  if (data.subarray(883).some((byte) => byte !== 0))
    unsupported("reserved pool features");
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
  )
    invalid(request.pool, "Invalid DLMM bin range or fee parameters");
  if (lastUpdate > request.snapshot.unixTimestamp || lastUpdate < 0n)
    fail({
      code: "INVALID_SNAPSHOT_CONTEXT",
      message: "DLMM volatility state is newer than the caller's chain timestamp",
    });
  const maxVolatility = BigInt(view.getUint32(20, true));
  const volatilityAccumulator = BigInt(view.getUint32(40, true));
  let volatilityReference = BigInt(view.getUint32(44, true));
  let indexReference = view.getInt32(48, true);
  if (volatilityAccumulator > maxVolatility || volatilityReference > maxVolatility)
    invalid(request.pool, "Invalid DLMM volatility state");
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
  )
    invalid(request.pool, "Invalid DLMM fee or token pair");
  if (!(
    (request.inputMint === pool.mintX && request.outputMint === pool.mintY) ||
    (request.inputMint === pool.mintY && request.outputMint === pool.mintX)
  ))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested token pair does not match the DLMM pool",
    });
  return pool;
}

async function validateAddresses(request: SwapRequest, pool: Pool): Promise<void> {
  const seeds = [
    encodeAddress.encode(pool.mintX),
    encodeAddress.encode(pool.mintY),
    pool.data.subarray(73, 75),
  ];
  if (pool.data[83] === 1) seeds.push(pool.data.subarray(84, 86));
  const [expectedPool, bump] = await getProgramDerivedAddress({
    programAddress: METEORA_DLMM_PROGRAM,
    seeds,
  });
  if (
    expectedPool !== request.pool ||
    bump !== pool.data[72] ||
    pool.view.getUint16(73, true) !== pool.binStep
  )
    invalid(request.pool, "Invalid DLMM pool PDA or seeds");
  for (const [mint, reserve] of [
    [pool.mintX, pool.reserveX],
    [pool.mintY, pool.reserveY],
  ] as const) {
    if (
      reserve !==
      (await pda([encodeAddress.encode(request.pool), encodeAddress.encode(mint)]))
    )
      invalid(reserve, "Invalid DLMM reserve PDA");
  }
  if (
    pool.oracle !==
    (await pda([textEncoder.encode("oracle"), encodeAddress.encode(request.pool)]))
  )
    invalid(pool.oracle, "Invalid DLMM oracle PDA");
}

async function bitmapState(
  request: SwapRequest,
): Promise<{ address: Address; data: Uint8Array | null }> {
  const bitmap = await pda([
    textEncoder.encode("bitmap"),
    encodeAddress.encode(request.pool),
  ]);
  if (request.snapshot.accounts[bitmap] === null) return { address: bitmap, data: null };
  const { data } = requireAccount(
    request.snapshot,
    bitmap,
    "DLMM bitmap extension (supply null if absent)",
    METEORA_DLMM_PROGRAM,
  );
  if (
    data.length !== 1576 ||
    !discriminator(data, BITMAP_DISCRIMINATOR) ||
    readAddress(data, 8) !== request.pool
  )
    invalid(bitmap, "Invalid DLMM bitmap extension");
  return { address: bitmap, data };
}
function initialized(pool: Pool, bitmap: Uint8Array | null, index: number): boolean {
  if (index >= -512 && index <= 511) {
    const bit = index + 512;
    return (pool.data[584 + Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0;
  }
  if (!bitmap || index < -6656 || index > 6655) return false;
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
    while (
      index >= minimumIndex &&
      index <= maximumIndex &&
      !initialized(pool, bitmap, index)
    )
      index += step;
    if (index < minimumIndex || index > maximumIndex) insufficient();
    if (arrays.length >= 8) unsupported("swaps requiring more than eight bin arrays");
    const indexBytes = new Uint8Array(8);
    viewOf(indexBytes).setBigInt64(0, BigInt(index), true);
    const arrayAddress = await pda([
      textEncoder.encode("bin_array"),
      encodeAddress.encode(request.pool),
      indexBytes,
    ]);
    requirements?.push({ address: arrayAddress, role: "DLMM bin array" });
    if (requirements && request.snapshot.accounts[arrayAddress] === undefined)
      return null;
    const { data } = requireAccount(
      request.snapshot,
      arrayAddress,
      "DLMM bin array",
      METEORA_DLMM_PROGRAM,
    );
    const view = viewOf(data);
    if (
      data.length !== 10136 ||
      !discriminator(data, ARRAY_DISCRIMINATOR) ||
      view.getBigInt64(8, true) !== BigInt(index) ||
      readAddress(data, 24) !== request.pool ||
      data[16]! > 1
    )
      invalid(arrayAddress, "Invalid DLMM bin array layout, index or identity");
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
      )
        unsupported("bins containing limit orders");
      const available = view.getBigUint64(offset + (swapForY ? 8 : 0), true);
      if (available > 0n) {
        const price = u128(view, offset + 16);
        if (price === 0n || u128(view, offset + 32) === 0n)
          invalid(arrayAddress, "DLMM liquid bin has zero price or liquidity supply");
        const rate = feeRate(pool, binId);
        const amountInFor = (amountOut: bigint): bigint =>
          swapForY ? ceilDiv(amountOut * Q64, price) : ceilDiv(amountOut * price, Q64);
        let binInput: bigint;
        let binOutput: bigint;
        let binFee: bigint;
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
  if (input <= 0n || output <= 0n || input > U64_MAX || output > U64_MAX) insufficient();
  return { arrays, input, output, fee };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = decodePool(request);
  await validateAddresses(request, pool);
  const bitmapAddress = await pda([
    textEncoder.encode("bitmap"),
    encodeAddress.encode(request.pool),
  ]);
  const result: AccountRequirement[] = [
    { address: request.pool, role: "DLMM pool" },
    { address: pool.mintX, role: "token X mint" },
    { address: pool.mintY, role: "token Y mint" },
    { address: pool.reserveX, role: "token X reserve" },
    { address: pool.reserveY, role: "token Y reserve" },
    { address: pool.oracle, role: "DLMM oracle" },
    { address: bitmapAddress, role: "DLMM bitmap extension", optional: true },
  ];
  if (request.snapshot.accounts[bitmapAddress] === undefined) return result;
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
    if (readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM)
      invalid(mint, "DLMM pool token program flag does not match mint");
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
  if (reserveX < protocolX || reserveY < protocolY)
    invalid(request.pool, "DLMM protocol fees exceed reserve balances");
  const oracle = requireAccount(
    request.snapshot,
    pool.oracle,
    "DLMM oracle",
    METEORA_DLMM_PROGRAM,
  ).data;
  const oracleView = viewOf(oracle);
  if (
    oracle.length < 64 ||
    !discriminator(oracle, ORACLE_DISCRIMINATOR) ||
    BigInt(oracle.length - 32) !== oracleView.getBigUint64(24, true) * 32n ||
    oracleView.getBigUint64(8, true) >= oracleView.getBigUint64(24, true) ||
    oracleView.getBigUint64(16, true) > oracleView.getBigUint64(24, true)
  )
    invalid(pool.oracle, "Invalid DLMM oracle layout");
  const curve = (await walk(request, pool, bitmap.data))!;
  const swapForY = request.inputMint === pool.mintX;
  if (
    curve.output > (swapForY ? reserveY - protocolY : reserveX - protocolX) ||
    (swapForY ? reserveX : reserveY) + curve.input > U64_MAX
  )
    insufficient();
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
    eventAuthority: await pda([textEncoder.encode("__event_authority")]),
    binArrays: curve.arrays,
  };
  const instruction =
    quote.kind === "exactIn"
      ? getMeteoraDlmmSwap2Instruction(instructionAccounts, {
          amountIn: quote.amountIn,
          minimumAmountOut: quote.minimumAmountOut,
        })
      : getMeteoraDlmmSwapExactOut2Instruction(instructionAccounts, {
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
