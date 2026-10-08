/** Bigint adaptation of Meteora's MIT damm-v2-sdk; see NOTICE.md. */
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  readMint,
  readTokenAccount,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../accounts/tokens.js";
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

/** Meteora DAMM v2 deployment on Solana mainnet. */
export const METEORA_DAMM_V2_PROGRAM = address(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
);
const POOL_AUTHORITY = address("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
const SWAP_DISCRIMINATOR = [65, 75, 63, 76, 235, 91, 91, 136];
const FEE_DENOMINATOR = 1_000_000_000n;
const Q128 = 1n << 128n;
const MIN_SQRT_PRICE = 4_295_048_016n;
const MAX_SQRT_PRICE = 79_226_673_521_066_979_257_578_248_091n;
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

interface PoolState {
  readonly mintA: Address;
  readonly mintB: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
  readonly tokenProgramA: Address;
  readonly tokenProgramB: Address;
  readonly liquidity: bigint;
  readonly sqrtMinPrice: bigint;
  readonly sqrtMaxPrice: bigint;
  readonly sqrtPrice: bigint;
  readonly protocolFeeA: bigint;
  readonly protocolFeeB: bigint;
  readonly reserveA: bigint | null;
  readonly reserveB: bigint | null;
  readonly collectFeeMode: number;
  readonly feeNumerator: bigint;
}

function invalid(accountAddress: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: accountAddress, message });
}

function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "meteora-damm-v2",
    feature,
    message: `Meteora DAMM v2 ${feature} is not qualified for this release`,
  });
}

function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "meteora-damm-v2", message });
}

function readU128(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true) + (view.getBigUint64(offset + 8, true) << 64n);
}

function decodePool(request: SwapRequest): PoolState {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "pool",
    METEORA_DAMM_V2_PROGRAM,
  );
  const data = account.data;
  if (
    data.length !== 1112 ||
    !POOL_DISCRIMINATOR.every((byte, index) => data[index] === byte)
  ) {
    invalid(request.pool, "Unsupported Meteora DAMM v2 pool layout or discriminator");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    data[480]! > 1 ||
    data[481]! > 1 ||
    data[482]! > 1 ||
    data[483]! > 1 ||
    data[485]! > 1 ||
    data[486]! > 1 ||
    data[696]! > 1
  ) {
    invalid(request.pool, "Unknown Meteora DAMM v2 pool flags or version");
  }
  if (data[484] !== 0 && data[484] !== 1)
    unsupported("compounding or unknown fee collection mode");
  if (data[56] !== 0) unsupported("dynamic fees");
  if (data[16] !== 0 && data[16] !== 1)
    unsupported("rate limiter or market-cap fee scheduler");
  const currentPoint =
    data[480] === 0 ? request.snapshot.slot : request.snapshot.unixTimestamp;
  const activationPoint = view.getBigUint64(472, true);
  if (data[481] !== 0 || currentPoint < activationPoint) {
    invalid(request.pool, "Meteora DAMM v2 swaps are disabled or not activated");
  }
  const cliffFee = view.getBigUint64(8, true);
  const periodCount = BigInt(view.getUint16(22, true));
  const periodFrequency = view.getBigUint64(24, true);
  const reduction = view.getBigUint64(32, true);
  const staticFee = periodCount === 0n && periodFrequency === 0n && reduction === 0n;
  if (!staticFee && (periodCount === 0n || periodFrequency === 0n || reduction === 0n)) {
    invalid(request.pool, "Malformed Meteora DAMM v2 fee scheduler");
  }
  if (data[16] === 1 && !staticFee) unsupported("exponential fee scheduler");
  const maxFee = data[486] === 0 ? 500_000_000n : 990_000_000n;
  if (
    cliffFee > maxFee ||
    cliffFee - periodCount * reduction < 100_000n ||
    data[48]! > 100 ||
    data[50]! > 100 ||
    view.getUint16(54, true) !== 0
  ) {
    invalid(request.pool, "Invalid Meteora DAMM v2 fee configuration");
  }
  const elapsedPeriods = staticFee
    ? 0n
    : (currentPoint - activationPoint) / periodFrequency;
  const appliedPeriods = elapsedPeriods < periodCount ? elapsedPeriods : periodCount;
  const readAddress = (offset: number): Address =>
    addressDecoder.decode(data.subarray(offset, offset + 32));
  const pool: PoolState = {
    mintA: readAddress(168),
    mintB: readAddress(200),
    vaultA: readAddress(232),
    vaultB: readAddress(264),
    tokenProgramA: data[482] === 0 ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM,
    tokenProgramB: data[483] === 0 ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM,
    liquidity: readU128(view, 360),
    sqrtMinPrice: readU128(view, 424),
    sqrtMaxPrice: readU128(view, 440),
    sqrtPrice: readU128(view, 456),
    protocolFeeA: view.getBigUint64(392, true),
    protocolFeeB: view.getBigUint64(400, true),
    reserveA: data[696] === 1 ? view.getBigUint64(680, true) : null,
    reserveB: data[696] === 1 ? view.getBigUint64(688, true) : null,
    collectFeeMode: data[484]!,
    feeNumerator: cliffFee - appliedPeriods * reduction,
  };
  if (pool.mintA === pool.mintB || pool.vaultA === pool.vaultB) {
    invalid(request.pool, "Pool token mints and vaults must be distinct");
  }
  if (
    pool.sqrtMinPrice < MIN_SQRT_PRICE ||
    pool.sqrtMaxPrice > MAX_SQRT_PRICE ||
    pool.sqrtMinPrice >= pool.sqrtMaxPrice ||
    pool.sqrtPrice < pool.sqrtMinPrice ||
    pool.sqrtPrice > pool.sqrtMaxPrice
  ) {
    invalid(request.pool, "Invalid Meteora DAMM v2 sqrt price range");
  }
  if (!(
    (request.inputMint === pool.mintA && request.outputMint === pool.mintB) ||
    (request.inputMint === pool.mintB && request.outputMint === pool.mintA)
  )) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested token pair does not match the pool",
    });
  }
  return pool;
}

function checkPriceRange(pool: PoolState, nextPrice: bigint): void {
  if (nextPrice < pool.sqrtMinPrice || nextPrice > pool.sqrtMaxPrice) {
    insufficient("Requested swap exceeds the pool's liquidity range");
  }
}

/**
 * Concentrated full-range integer formulas from the MIT SDK at revision
 * 79ebbfe59a225e641a2f37cd03404f26de1b0c8e. Sqrt prices use Q64.64 and
 * raw u128 liquidity produces token B deltas with a 2^128 divisor.
 * Payments round up and credits round down.
 */
function quoteCurve(
  request: SwapRequest,
  pool: PoolState,
): {
  readonly input: bigint;
  readonly output: bigint;
  readonly fee: bigint;
  readonly feeOnInput: boolean;
  readonly curveOutput: bigint;
} {
  if (pool.liquidity === 0n) insufficient("Meteora DAMM v2 pool has no liquidity");
  const aToB = request.inputMint === pool.mintA;
  const feeOnInput = pool.collectFeeMode === 1 && !aToB;
  const price = pool.sqrtPrice;
  const liquidity = pool.liquidity;
  const excludedFee = (amount: bigint): bigint =>
    amount - ceilDiv(amount * pool.feeNumerator, FEE_DENOMINATOR);
  const includedFee = (amount: bigint): bigint =>
    ceilDiv(amount * FEE_DENOMINATOR, FEE_DENOMINATOR - pool.feeNumerator);
  let input: bigint;
  let output: bigint;
  let fee: bigint;
  let curveOutput: bigint;
  if (request.amount.kind === "exactIn") {
    input = request.amount.amountIn;
    const curveInput = feeOnInput ? excludedFee(input) : input;
    if (curveInput === 0n) insufficient("Input is consumed by rounded protocol fees");
    const nextPrice = aToB
      ? ceilDiv(liquidity * price, liquidity + curveInput * price)
      : price + (curveInput * Q128) / liquidity;
    checkPriceRange(pool, nextPrice);
    curveOutput = aToB
      ? (liquidity * (price - nextPrice)) / Q128
      : (liquidity * (nextPrice - price)) / (price * nextPrice);
    output = feeOnInput ? curveOutput : excludedFee(curveOutput);
    fee = feeOnInput ? input - curveInput : curveOutput - output;
  } else {
    output = request.amount.amountOut;
    curveOutput = feeOnInput ? output : includedFee(output);
    if (!aToB && liquidity <= curveOutput * price) {
      insufficient("Requested output exhausts available token A liquidity");
    }
    const nextPrice = aToB
      ? price - ceilDiv(curveOutput * Q128, liquidity)
      : ceilDiv(liquidity * price, liquidity - curveOutput * price);
    checkPriceRange(pool, nextPrice);
    const curveInput = aToB
      ? ceilDiv(liquidity * (price - nextPrice), price * nextPrice)
      : ceilDiv(liquidity * (nextPrice - price), Q128);
    input = feeOnInput ? includedFee(curveInput) : curveInput;
    fee = feeOnInput ? input - curveInput : curveOutput - output;
  }
  if (input <= 0n || output <= 0n || input > U64_MAX || curveOutput > U64_MAX) {
    insufficient("Requested swap cannot produce nonzero u64 token amounts");
  }
  return { input, output, fee, feeOnInput, curveOutput };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = decodePool(request);
  return [
    { address: request.pool, role: "pool" },
    { address: pool.mintA, role: "token A mint" },
    { address: pool.mintB, role: "token B mint" },
    { address: pool.vaultA, role: "token A vault" },
    { address: pool.vaultB, role: "token B vault" },
  ];
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = decodePool(request);
  for (const [mint, vault, program] of [
    [pool.mintA, pool.vaultA, pool.tokenProgramA],
    [pool.mintB, pool.vaultB, pool.tokenProgramB],
  ] as const) {
    const [expectedVault] = await getProgramDerivedAddress({
      programAddress: METEORA_DAMM_V2_PROGRAM,
      seeds: [
        new TextEncoder().encode("token_vault"),
        addressEncoder.encode(mint),
        addressEncoder.encode(request.pool),
      ],
    });
    if (vault !== expectedVault) invalid(vault, "Invalid Meteora DAMM v2 vault address");
    if (readMint(request.snapshot, mint).tokenProgram !== program) {
      invalid(request.pool, "Pool token program flag does not match its mint");
    }
  }
  const vaultA = readTokenAccount(
    request.snapshot,
    pool.vaultA,
    pool.mintA,
    pool.tokenProgramA,
    POOL_AUTHORITY,
  );
  const vaultB = readTokenAccount(
    request.snapshot,
    pool.vaultB,
    pool.mintB,
    pool.tokenProgramB,
    POOL_AUTHORITY,
  );
  if (vaultA.amount < pool.protocolFeeA || vaultB.amount < pool.protocolFeeB) {
    invalid(request.pool, "Accrued protocol fees exceed pool vault balances");
  }
  if (
    (pool.reserveA !== null && pool.reserveA > vaultA.amount - pool.protocolFeeA) ||
    (pool.reserveB !== null && pool.reserveB > vaultB.amount - pool.protocolFeeB)
  ) {
    invalid(request.pool, "Recorded pool reserves exceed available vault balances");
  }
  const aToB = request.inputMint === pool.mintA;
  const curve = quoteCurve(request, pool);
  const outputAvailable = aToB
    ? vaultB.amount - pool.protocolFeeB
    : vaultA.amount - pool.protocolFeeA;
  const outputReserve = aToB ? pool.reserveB : pool.reserveA;
  if (
    curve.curveOutput > outputAvailable ||
    (outputReserve !== null && curve.curveOutput > outputReserve) ||
    (aToB ? vaultA.amount : vaultB.amount) + curve.input > U64_MAX
  ) {
    insufficient("Pool vault balances cannot settle the requested swap");
  }
  const fees = [
    {
      kind: "trade" as const,
      mint: curve.feeOnInput ? request.inputMint : request.outputMint,
      amount: curve.fee,
    },
  ];
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
  const data = new Uint8Array(25);
  data.set(SWAP_DISCRIMINATOR);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, quote.kind === "exactIn" ? quote.amountIn : quote.amountOut, true);
  view.setBigUint64(
    16,
    quote.kind === "exactIn" ? quote.minimumAmountOut : quote.maximumAmountIn,
    true,
  );
  data[24] = quote.kind === "exactIn" ? 0 : 2;
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: METEORA_DAMM_V2_PROGRAM,
    seeds: [new TextEncoder().encode("__event_authority")],
  });
  const instruction: Instruction = {
    programAddress: METEORA_DAMM_V2_PROGRAM,
    accounts: [
      { address: POOL_AUTHORITY, role: AccountRole.READONLY },
      { address: request.pool, role: AccountRole.WRITABLE },
      { address: tokenAccounts.input, role: AccountRole.WRITABLE },
      { address: tokenAccounts.output, role: AccountRole.WRITABLE },
      { address: pool.vaultA, role: AccountRole.WRITABLE },
      { address: pool.vaultB, role: AccountRole.WRITABLE },
      { address: pool.mintA, role: AccountRole.READONLY },
      { address: pool.mintB, role: AccountRole.READONLY },
      { address: request.owner, role: AccountRole.READONLY_SIGNER },
      { address: pool.tokenProgramA, role: AccountRole.READONLY },
      { address: pool.tokenProgramB, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
      { address: eventAuthority, role: AccountRole.READONLY },
      { address: METEORA_DAMM_V2_PROGRAM, role: AccountRole.READONLY },
    ],
    data,
  };
  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/**
 * Offline Meteora DAMM v2 swaps using native full-fill exact-input/output modes.
 * @remarks Supports noncompounding pools with static or linear time fees and either
 * fee-collection direction. Dynamic, rate-limited, market-cap and nonstatic
 * exponential fees fail explicitly. Caller-owned SPL balances include wrapped SOL;
 * no wallet, network, clock, wrapping or signing operation is performed.
 */
export const meteoraDammV2Adapter: ProtocolAdapter = {
  id: "meteora-damm-v2",
  programAddresses: [METEORA_DAMM_V2_PROGRAM],
  requirements,
  build,
};
