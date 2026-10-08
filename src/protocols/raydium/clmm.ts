/**
 * Raydium CLMM layouts and native swap contract adapted from the Apache-2.0
 * raydium-io/raydium-clmm Rust program, ed1eb41519d5355755f7df52b43fa9610938b60b.
 * See NOTICE.md. Runtime operations use caller-owned snapshots exclusively.
 */
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { readMint, readTokenAccount } from "../../accounts/tokens.js";
import { maximumInput, minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SnapshotAccount,
  SwapQuote,
  SwapRequest,
} from "../../core/types.js";
import {
  CLMM_MAX_SQRT_PRICE,
  CLMM_MAX_TICK,
  CLMM_MIN_SQRT_PRICE,
  CLMM_MIN_TICK,
  clmmSqrtPriceAtTick,
  clmmSwapStep,
} from "./clmm-math.js";
import { getRaydiumClmmSwapInstruction } from "./instructions/clmm/index.js";
import { RAYDIUM_CLMM_PROGRAM } from "./constants.js";
export { RAYDIUM_CLMM_PROGRAM } from "./constants.js";
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();
const textEncoder = new TextEncoder();
const U128_MAX = (1n << 128n) - 1n;
const POOL_DISCRIMINATOR = [247, 237, 227, 245, 215, 195, 222, 70];
const CONFIG_DISCRIMINATOR = [218, 244, 33, 104, 203, 203, 43, 111];
const TICK_ARRAY_DISCRIMINATOR = [192, 155, 85, 205, 49, 249, 129, 42];
const BITMAP_DISCRIMINATOR = [60, 150, 36, 219, 97, 128, 139, 153];
const OBSERVATION_DISCRIMINATOR = [122, 174, 197, 53, 129, 9, 165, 132];

interface Pool {
  readonly account: SnapshotAccount;
  readonly config: Address;
  readonly mint0: Address;
  readonly mint1: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly observation: Address;
  readonly spacing: number;
  readonly liquidity: bigint;
  readonly sqrtPrice: bigint;
  readonly tick: number;
  readonly zeroForOne: boolean;
}
interface Tick {
  readonly index: number;
  readonly net: bigint;
}
interface Traversal {
  readonly requirements: readonly AccountRequirement[];
  readonly tickArrays: readonly Address[];
  readonly input: bigint;
  readonly output: bigint;
  readonly fee: bigint;
  readonly complete: boolean;
}

function invalid(address: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address, message });
}
function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "raydium-clmm",
    feature,
    message: `Raydium CLMM feature is not qualified: ${feature}`,
  });
}
function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "raydium-clmm", message });
}
function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
function readAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}
function u128(data: Uint8Array, offset: number): bigint {
  const bytes = view(data);
  return bytes.getBigUint64(offset, true) + (bytes.getBigUint64(offset + 8, true) << 64n);
}
function layout(
  account: SnapshotAccount,
  length: number,
  discriminator: readonly number[],
): void {
  if (
    account.data.length !== length ||
    !discriminator.every((byte, i) => account.data[i] === byte)
  )
    invalid(account.address, "Unsupported Raydium CLMM account layout or discriminator");
}
async function pda(
  seed: string,
  ...seeds: readonly ReadonlyUint8Array[]
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: RAYDIUM_CLMM_PROGRAM,
    seeds: [textEncoder.encode(seed), ...seeds],
  });
}
async function decodePool(request: SwapRequest): Promise<Pool> {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "pool",
    RAYDIUM_CLMM_PROGRAM,
  );
  layout(account, 1544, POOL_DISCRIMINATOR);
  const data = account.data;
  const bytes = view(data);
  if (data[390] !== 0) unsupported("fees charged on a fixed token");
  if (data[391] !== 0 || data[392] !== 0) unsupported("permissioned pool PDA");
  if (data.subarray(1096, 1176).some((byte) => byte !== 0)) unsupported("dynamic fees");
  if (
    data.subarray(393, 397).some((byte) => byte !== 0) ||
    data.subarray(1176).some((byte) => byte !== 0)
  )
    unsupported("unknown pool version or reserved fields");
  if (data[389]! > 63) invalid(request.pool, "Invalid pool status flags");
  if ((data[389]! & 16) !== 0) unsupported("swaps disabled");
  if (bytes.getBigUint64(1080, true) >= request.snapshot.unixTimestamp)
    unsupported("pool not open at the supplied chain timestamp");
  const pool: Pool = {
    account,
    config: readAddress(data, 9),
    mint0: readAddress(data, 73),
    mint1: readAddress(data, 105),
    vault0: readAddress(data, 137),
    vault1: readAddress(data, 169),
    observation: readAddress(data, 201),
    spacing: bytes.getUint16(235, true),
    liquidity: u128(data, 237),
    sqrtPrice: u128(data, 253),
    tick: bytes.getInt32(269, true),
    zeroForOne: request.inputMint === readAddress(data, 73),
  };
  const mint0Bytes = addressEncoder.encode(pool.mint0);
  const mint1Bytes = addressEncoder.encode(pool.mint1);
  const comparison = mint0Bytes.findIndex((byte, i) => byte !== mint1Bytes[i]);
  if (
    comparison === -1 ||
    mint0Bytes[comparison]! > mint1Bytes[comparison]! ||
    pool.vault0 === pool.vault1
  )
    invalid(request.pool, "Invalid CLMM mint ordering or duplicate vaults");
  if (!(
    (request.inputMint === pool.mint0 && request.outputMint === pool.mint1) ||
    (request.inputMint === pool.mint1 && request.outputMint === pool.mint0)
  ))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mints do not match the CLMM pool",
    });
  if (
    pool.spacing < 1 ||
    pool.spacing > 1000 ||
    pool.tick < CLMM_MIN_TICK ||
    pool.tick >= CLMM_MAX_TICK ||
    pool.sqrtPrice <= CLMM_MIN_SQRT_PRICE ||
    pool.sqrtPrice >= CLMM_MAX_SQRT_PRICE
  )
    invalid(request.pool, "Invalid CLMM tick spacing, tick, or sqrt price");
  if (
    pool.sqrtPrice < clmmSqrtPriceAtTick(pool.tick) ||
    pool.sqrtPrice > clmmSqrtPriceAtTick(pool.tick + 1)
  )
    invalid(request.pool, "CLMM sqrt price is inconsistent with its current tick");
  const [expected, bump] = await pda(
    "pool",
    addressEncoder.encode(pool.config),
    mint0Bytes,
    mint1Bytes,
  );
  if (request.pool !== expected || data[8] !== bump)
    invalid(request.pool, "Invalid CLMM pool PDA or bump");
  for (const [actual, mint] of [
    [pool.vault0, pool.mint0],
    [pool.vault1, pool.mint1],
  ] as const) {
    const [expectedVault] = await pda(
      "pool_vault",
      addressEncoder.encode(request.pool),
      addressEncoder.encode(mint),
    );
    if (actual !== expectedVault) invalid(actual, "Invalid CLMM vault PDA");
  }
  const [expectedObservation] = await pda(
    "observation",
    addressEncoder.encode(request.pool),
  );
  if (pool.observation !== expectedObservation)
    invalid(pool.observation, "Invalid CLMM observation PDA");
  return pool;
}

async function feeRate(request: SwapRequest, pool: Pool): Promise<bigint> {
  const account = requireAccount(
    request.snapshot,
    pool.config,
    "AMM configuration",
    RAYDIUM_CLMM_PROGRAM,
  );
  layout(account, 117, CONFIG_DISCRIMINATOR);
  const data = account.data;
  const bytes = view(data);
  const [expected, bump] = await pda("amm_config", Uint8Array.of(data[10]!, data[9]!));
  if (
    expected !== pool.config ||
    data[8] !== bump ||
    bytes.getUint16(51, true) !== pool.spacing
  )
    invalid(pool.config, "Invalid CLMM config PDA, bump, or tick spacing");
  const rate = bytes.getUint32(47, true);
  if (
    rate >= 1_000_000 ||
    bytes.getUint32(43, true) + bytes.getUint32(53, true) > 1_000_000
  )
    invalid(pool.config, "Invalid CLMM fee rates");
  if (
    data.subarray(57, 61).some((byte) => byte !== 0) ||
    data.subarray(93).some((byte) => byte !== 0)
  )
    unsupported("unknown AMM configuration fields");
  return BigInt(rate);
}

function initializedArrays(
  request: SwapRequest,
  pool: Pool,
  bitmap: SnapshotAccount,
): number[] {
  layout(bitmap, 1832, BITMAP_DISCRIMINATOR);
  if (readAddress(bitmap.data, 8) !== request.pool)
    invalid(bitmap.address, "CLMM bitmap belongs to another pool");
  const starts: number[] = [];
  const width = pool.spacing * 60;
  function collect(
    data: Uint8Array,
    offset: number,
    count: number,
    firstIndex: number,
  ): void {
    for (let bit = 0; bit < count; bit++) {
      if ((data[offset + Math.floor(bit / 8)]! & (1 << (bit % 8))) === 0) continue;
      const start = (firstIndex + bit) * width;
      if (start < Math.floor(CLMM_MIN_TICK / width) * width || start > CLMM_MAX_TICK)
        invalid(bitmap.address, "Initialized CLMM bitmap bit is outside the tick domain");
      starts.push(start);
    }
  }
  collect(pool.account.data, 904, 1024, -512);
  for (let page = 0; page < 14; page++) {
    collect(bitmap.data, 40 + page * 64, 512, (page + 1) * 512);
    collect(bitmap.data, 936 + page * 64, 512, -(page + 2) * 512);
  }
  const current = Math.floor(pool.tick / width) * width;
  return starts
    .filter((start) => (pool.zeroForOne ? start <= current : start >= current))
    .sort((a, b) => (pool.zeroForOne ? b - a : a - b));
}

async function tickArrayAddress(pool: Address, start: number): Promise<Address> {
  const bytes = new Uint8Array(4);
  view(bytes).setInt32(0, start, false);
  return (await pda("tick_array", addressEncoder.encode(pool), bytes))[0];
}
function decodeTicks(
  request: SwapRequest,
  pool: Pool,
  account: SnapshotAccount,
  start: number,
): Tick[] {
  layout(account, 10240, TICK_ARRAY_DISCRIMINATOR);
  if (
    readAddress(account.data, 8) !== request.pool ||
    view(account.data).getInt32(40, true) !== start
  )
    invalid(account.address, "CLMM tick array pool or start index mismatch");
  const ticks: Tick[] = [];
  for (let i = 0; i < 60; i++) {
    const offset = 44 + i * 168;
    const index = view(account.data).getInt32(offset, true);
    const gross = u128(account.data, offset + 20);
    const unsigned = u128(account.data, offset + 4);
    const net = BigInt.asIntN(128, unsigned);
    if (account.data.subarray(offset + 116, offset + 168).some((byte) => byte !== 0))
      unsupported("limit orders or unknown tick fields");
    if (gross === 0n) {
      if (net !== 0n) invalid(account.address, "Uninitialized tick has net liquidity");
      continue;
    }
    if (
      index !== start + i * pool.spacing ||
      index < CLMM_MIN_TICK ||
      index > CLMM_MAX_TICK ||
      (net < 0n ? -net : net) > gross
    )
      invalid(account.address, "Invalid initialized CLMM tick index or liquidity");
    ticks.push({ index, net });
  }
  if (ticks.length !== account.data[10124] || ticks.length === 0)
    invalid(account.address, "CLMM initialized tick count disagrees with its bitmap");
  return pool.zeroForOne ? ticks.reverse() : ticks;
}

async function traverse(
  request: SwapRequest,
  pool: Pool,
  rate: bigint,
  bitmapAddress: Address,
): Promise<Traversal> {
  const bitmap = requireAccount(
    request.snapshot,
    bitmapAddress,
    "tick array bitmap extension",
    RAYDIUM_CLMM_PROGRAM,
  );
  const starts = initializedArrays(request, pool, bitmap);
  const exactIn = request.amount.kind === "exactIn";
  let remaining =
    request.amount.kind === "exactIn"
      ? request.amount.amountIn
      : request.amount.amountOut;
  let sqrtPrice = pool.sqrtPrice;
  let liquidity = pool.liquidity;
  let input = 0n;
  let output = 0n;
  let fee = 0n;
  const requirements: AccountRequirement[] = [];
  const tickArrays: Address[] = [];
  for (const start of starts) {
    const address = await tickArrayAddress(request.pool, start);
    requirements.push({ address, role: `tick array starting at ${start}` });
    tickArrays.push(address);
    if (request.snapshot.accounts[address] === undefined)
      return { requirements, tickArrays, input, output, fee, complete: false };
    const account = requireAccount(
      request.snapshot,
      address,
      "tick array",
      RAYDIUM_CLMM_PROGRAM,
    );
    const ticks = decodeTicks(request, pool, account, start);
    for (const tick of ticks) {
      if (pool.zeroForOne ? tick.index > pool.tick : tick.index <= pool.tick) continue;
      const tickPrice = clmmSqrtPriceAtTick(tick.index);
      const target = pool.zeroForOne
        ? tickPrice < CLMM_MIN_SQRT_PRICE + 1n
          ? CLMM_MIN_SQRT_PRICE + 1n
          : tickPrice
        : tickPrice > CLMM_MAX_SQRT_PRICE - 1n
          ? CLMM_MAX_SQRT_PRICE - 1n
          : tickPrice;
      if (liquidity === 0n) {
        sqrtPrice = target;
      } else {
        const step = clmmSwapStep(
          sqrtPrice,
          target,
          liquidity,
          remaining,
          rate,
          exactIn,
          pool.zeroForOne,
        );
        input += step.input + step.fee;
        output += step.output;
        fee += step.fee;
        remaining -= exactIn ? step.input + step.fee : step.output;
        sqrtPrice = step.price;
      }
      if (sqrtPrice === tickPrice) {
        liquidity += pool.zeroForOne ? -tick.net : tick.net;
        if (liquidity < 0n || liquidity > U128_MAX)
          invalid(account.address, "Tick crossing overflows CLMM liquidity");
      }
      if (remaining === 0n) {
        if (input <= 0n || output <= 0n || input > U64_MAX || output > U64_MAX)
          insufficient("CLMM swap does not produce nonzero u64 token amounts");
        return { requirements, tickArrays, input, output, fee, complete: true };
      }
      if (sqrtPrice !== tickPrice)
        insufficient("CLMM swap reaches its global price limit before a full fill");
    }
  }
  insufficient("Initialized CLMM tick ranges cannot fill the requested amount");
}

function validateMints(request: SwapRequest, pool: Pool): void {
  for (const [mint, decimals] of [
    [pool.mint0, pool.account.data[233]],
    [pool.mint1, pool.account.data[234]],
  ] as const) {
    const state = readMint(request.snapshot, mint);
    if (state.tokenProgram !== TOKEN_PROGRAM_ADDRESS) unsupported("Token-2022 mints");
    if (state.decimals !== decimals) invalid(mint, "CLMM pool and mint decimals differ");
  }
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = await decodePool(request);
  const [bitmap] = await pda(
    "pool_tick_array_bitmap_extension",
    addressEncoder.encode(request.pool),
  );
  const base = [
    { address: request.pool, role: "pool" },
    { address: pool.config, role: "AMM configuration" },
    { address: pool.mint0, role: "token 0 mint" },
    { address: pool.mint1, role: "token 1 mint" },
    { address: pool.vault0, role: "token 0 vault" },
    { address: pool.vault1, role: "token 1 vault" },
    { address: pool.observation, role: "observation state" },
    { address: bitmap, role: "tick array bitmap extension" },
  ];
  if (base.some((item) => request.snapshot.accounts[item.address] === undefined))
    return base;
  validateMints(request, pool);
  const rate = await feeRate(request, pool);
  const traversal = await traverse(request, pool, rate, bitmap);
  return [...base, ...traversal.requirements];
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = await decodePool(request);
  const rate = await feeRate(request, pool);
  const [bitmap] = await pda(
    "pool_tick_array_bitmap_extension",
    addressEncoder.encode(request.pool),
  );
  validateMints(request, pool);
  const vault0 = readTokenAccount(
    request.snapshot,
    pool.vault0,
    pool.mint0,
    TOKEN_PROGRAM_ADDRESS,
    request.pool,
  );
  const vault1 = readTokenAccount(
    request.snapshot,
    pool.vault1,
    pool.mint1,
    TOKEN_PROGRAM_ADDRESS,
    request.pool,
  );
  const observation = requireAccount(
    request.snapshot,
    pool.observation,
    "observation state",
    RAYDIUM_CLMM_PROGRAM,
  );
  layout(observation, 4483, OBSERVATION_DISCRIMINATOR);
  if (
    observation.data[8]! > 1 ||
    view(observation.data).getUint16(17, true) >= 100 ||
    readAddress(observation.data, 19) !== request.pool
  )
    invalid(pool.observation, "Invalid CLMM observation state");
  const result = await traverse(request, pool, rate, bitmap);
  if (!result.complete)
    fail({
      code: "MISSING_ACCOUNTS",
      accounts: result.requirements.filter(
        (item) => request.snapshot.accounts[item.address] === undefined,
      ),
      message: "Supply the next CLMM tick array",
    });
  if ((pool.zeroForOne ? vault0.amount : vault1.amount) + result.input > U64_MAX)
    insufficient("CLMM input exceeds the token vault settlement capacity");
  if ((pool.zeroForOne ? vault1.amount : vault0.amount) < result.output)
    insufficient("CLMM output exceeds the token vault balance");
  const common = {
    expectedAmountIn: result.input,
    expectedAmountOut: result.output,
    fees: [{ kind: "trade" as const, mint: request.inputMint, amount: result.fee }],
  };
  const quote: SwapQuote =
    request.amount.kind === "exactIn"
      ? {
          ...common,
          kind: "exactIn",
          amountIn: request.amount.amountIn,
          minimumAmountOut: minimumOutput(result.output, request.slippageBps),
        }
      : {
          ...common,
          kind: "exactOut",
          amountOut: request.amount.amountOut,
          maximumAmountIn: maximumInput(result.input, request.slippageBps),
        };
  const instructionAccounts = {
    owner: request.owner,
    config: pool.config,
    pool: request.pool,
    userInput: accounts.input,
    userOutput: accounts.output,
    inputVault: pool.zeroForOne ? pool.vault0 : pool.vault1,
    outputVault: pool.zeroForOne ? pool.vault1 : pool.vault0,
    observation: pool.observation,
    tickArrays: result.tickArrays,
    tickArrayBitmap: bitmap,
  };
  const instructionArgs =
    quote.kind === "exactIn"
      ? {
          amount: quote.amountIn,
          otherAmountThreshold: quote.minimumAmountOut,
          sqrtPriceLimitX64: 0n,
          isBaseInput: true,
        }
      : {
          amount: quote.amountOut,
          otherAmountThreshold: quote.maximumAmountIn,
          sqrtPriceLimitX64: 0n,
          isBaseInput: false,
        };
  return {
    quote,
    mayPartiallyFill: false,
    instructions: [getRaydiumClmmSwapInstruction(instructionAccounts, instructionArgs)],
  };
}

/**
 * Offline legacy Raydium CLMM adapter for classic SPL tokens and static input fees.
 * @remarks Tick arrays are discovered incrementally from validated on-chain bitmap state.
 * Both modes encode a zero price limit, requiring native atomic full fills. Dynamic fees,
 * permissioned pools, Token-2022, fixed-token fees, and limit-order ticks are rejected.
 */
export const raydiumClmmAdapter: ProtocolAdapter = {
  id: "raydium-clmm",
  programAddresses: [RAYDIUM_CLMM_PROGRAM],
  requirements,
  build,
};
