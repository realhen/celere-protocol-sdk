/** Adapted from raydium-io/raydium-cp-swap (Apache-2.0); see NOTICE.md. */
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { readMint, readTokenAccount } from "../../accounts/tokens.js";
import { ceilDiv, maximumInput, minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SnapshotAccount,
  SwapFee,
  SwapQuote,
  SwapRequest,
} from "../../core/types.js";
import {
  getRaydiumCpmmSwapBaseInputInstruction,
  getRaydiumCpmmSwapBaseOutputInstruction,
} from "./instructions/cpmm/index.js";
import { RAYDIUM_CPMM_PROGRAM } from "./constants.js";
export { RAYDIUM_CPMM_PROGRAM } from "./constants.js";

const FEE_DENOMINATOR = 1_000_000n;
const POOL_DISCRIMINATOR = [247, 237, 227, 245, 215, 195, 222, 70];
const CONFIG_DISCRIMINATOR = [218, 244, 33, 104, 203, 203, 43, 111];
const OBSERVATION_DISCRIMINATOR = [122, 174, 197, 53, 129, 9, 165, 132];
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();

interface PoolState {
  readonly config: Address;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly mint0: Address;
  readonly mint1: Address;
  readonly tokenProgram0: Address;
  readonly tokenProgram1: Address;
  readonly observation: Address;
  readonly authorityBump: number;
  readonly status: number;
  readonly decimals0: number;
  readonly decimals1: number;
  readonly fees0: bigint;
  readonly fees1: bigint;
  readonly openTime: bigint;
  readonly creatorFeeOn: number;
  readonly creatorFeeEnabled: boolean;
}

interface FeeRates {
  readonly trade: bigint;
  readonly creator: bigint;
}

interface CurveQuote {
  readonly input: bigint;
  readonly output: bigint;
  readonly tradeFee: bigint;
  readonly creatorFee: bigint;
}

function invalidAccount(account: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", message, address: account });
}

function validateLayout(
  account: SnapshotAccount,
  length: number,
  discriminator: readonly number[],
): void {
  if (
    account.data.length !== length ||
    !discriminator.every((byte, index) => account.data[index] === byte)
  ) {
    invalidAccount(
      account.address,
      "Unsupported Raydium CPMM account layout or discriminator",
    );
  }
}

function readAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
    offset,
    true,
  );
}

function decodePool(request: SwapRequest): PoolState {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "pool",
    RAYDIUM_CPMM_PROGRAM,
  );
  validateLayout(account, 637, POOL_DISCRIMINATOR);
  const data = account.data;
  const creatorFeeOn = data[389]!;
  if (creatorFeeOn > 2 || data[390]! > 1 || data[329]! > 7) {
    invalidAccount(request.pool, "Unsupported Raydium CPMM pool flags");
  }
  const pool: PoolState = {
    config: readAddress(data, 8),
    vault0: readAddress(data, 72),
    vault1: readAddress(data, 104),
    mint0: readAddress(data, 168),
    mint1: readAddress(data, 200),
    tokenProgram0: readAddress(data, 232),
    tokenProgram1: readAddress(data, 264),
    observation: readAddress(data, 296),
    authorityBump: data[328]!,
    status: data[329]!,
    decimals0: data[331]!,
    decimals1: data[332]!,
    fees0: readU64(data, 341) + readU64(data, 357) + readU64(data, 397),
    fees1: readU64(data, 349) + readU64(data, 365) + readU64(data, 405),
    openTime: readU64(data, 373),
    creatorFeeOn,
    creatorFeeEnabled: data[390] === 1,
  };
  if (pool.mint0 === pool.mint1 || pool.vault0 === pool.vault1) {
    invalidAccount(request.pool, "Pool token mints and vaults must be distinct");
  }
  if (!(
    (request.inputMint === pool.mint0 && request.outputMint === pool.mint1) ||
    (request.inputMint === pool.mint1 && request.outputMint === pool.mint0)
  )) {
    fail({
      code: "INVALID_REQUEST",
      message: "Requested token pair does not match the pool",
      field: "inputMint",
    });
  }
  return pool;
}

async function readFees(request: SwapRequest, pool: PoolState): Promise<FeeRates> {
  const account = requireAccount(
    request.snapshot,
    pool.config,
    "AMM configuration",
    RAYDIUM_CPMM_PROGRAM,
  );
  validateLayout(account, 236, CONFIG_DISCRIMINATOR);
  const data = account.data;
  const [expectedConfig, bump] = await getProgramDerivedAddress({
    programAddress: RAYDIUM_CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("amm_config"), Uint8Array.of(data[11]!, data[10]!)],
  });
  if (pool.config !== expectedConfig || data[8] !== bump || data[9]! > 1) {
    invalidAccount(pool.config, "Invalid Raydium CPMM configuration address or flags");
  }
  const trade = readU64(data, 12);
  const creator = pool.creatorFeeEnabled ? readU64(data, 108) : 0n;
  const protocol = readU64(data, 20);
  const fund = readU64(data, 28);
  if (
    trade + creator >= FEE_DENOMINATOR ||
    trade + creator === 0n ||
    protocol + fund > FEE_DENOMINATOR
  ) {
    invalidAccount(pool.config, "Invalid Raydium CPMM fee rates");
  }
  return { trade, creator };
}

function insufficientLiquidity(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", message, protocol: "raydium-cpmm" });
}

function fee(amount: bigint, rate: bigint): bigint {
  return ceilDiv(amount * rate, FEE_DENOMINATOR);
}

function beforeFee(amount: bigint, rate: bigint): bigint {
  return ceilDiv(amount * FEE_DENOMINATOR, FEE_DENOMINATOR - rate);
}

/**
 * Integer arithmetic follows Raydium cp-swap's native curve and fee contracts.
 * @remarks Adapted from raydium-io/raydium-cp-swap, Apache-2.0, revision
 * b3187ae53a1b95a201f855a59024a12ca8f5b51a. Creator and trade fees on input
 * round once together, then split; protocol/fund shares are included in trade fees.
 */
function quoteCurve(
  request: SwapRequest,
  inputReserve: bigint,
  outputReserve: bigint,
  rates: FeeRates,
  creatorOnInput: boolean,
): CurveQuote {
  let input: bigint;
  let output: bigint;
  let tradeFee: bigint;
  let creatorFee: bigint;
  if (request.amount.kind === "exactIn") {
    input = request.amount.amountIn;
    const totalFee = fee(input, rates.trade + (creatorOnInput ? rates.creator : 0n));
    creatorFee = creatorOnInput
      ? (totalFee * rates.creator) / (rates.trade + rates.creator)
      : 0n;
    tradeFee = totalFee - creatorFee;
    const curveInput = input - totalFee;
    if (curveInput <= 0n)
      insufficientLiquidity("Input amount is consumed by rounded protocol fees");
    const curveOutput = (curveInput * outputReserve) / (inputReserve + curveInput);
    if (!creatorOnInput) creatorFee = fee(curveOutput, rates.creator);
    output = curveOutput - (creatorOnInput ? 0n : creatorFee);
  } else {
    output = request.amount.amountOut;
    const curveOutput = creatorOnInput ? output : beforeFee(output, rates.creator);
    if (curveOutput >= outputReserve)
      insufficientLiquidity("Requested output exhausts the pool reserve");
    creatorFee = creatorOnInput ? 0n : curveOutput - output;
    const curveInput = ceilDiv(inputReserve * curveOutput, outputReserve - curveOutput);
    input = beforeFee(curveInput, rates.trade + (creatorOnInput ? rates.creator : 0n));
    const totalFee = input - curveInput;
    if (creatorOnInput)
      creatorFee = (totalFee * rates.creator) / (rates.trade + rates.creator);
    tradeFee = totalFee - (creatorOnInput ? creatorFee : 0n);
  }
  if (output <= 0n || input <= 0n || input > U64_MAX || output > U64_MAX) {
    insufficientLiquidity("Requested swap cannot produce nonzero u64 token amounts");
  }
  return { input, output, tradeFee, creatorFee };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = decodePool(request);
  return [
    { address: request.pool, role: "pool" },
    { address: pool.config, role: "AMM configuration" },
    { address: pool.vault0, role: "token 0 vault" },
    { address: pool.vault1, role: "token 1 vault" },
    { address: pool.mint0, role: "token 0 mint" },
    { address: pool.mint1, role: "token 1 mint" },
    { address: pool.observation, role: "observation state" },
  ];
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = decodePool(request);
  if ((pool.status & 4) !== 0 || request.snapshot.unixTimestamp < pool.openTime) {
    invalidAccount(
      request.pool,
      "Raydium CPMM swaps are disabled or the pool has not opened",
    );
  }
  const [authority, authorityBump] = await getProgramDerivedAddress({
    programAddress: RAYDIUM_CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("vault_and_lp_mint_auth_seed")],
  });
  if (pool.authorityBump !== authorityBump)
    invalidAccount(request.pool, "Invalid pool authority bump");
  const [observationAddress] = await getProgramDerivedAddress({
    programAddress: RAYDIUM_CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("observation"), addressEncoder.encode(request.pool)],
  });
  if (pool.observation !== observationAddress)
    invalidAccount(pool.observation, "Invalid observation address");
  const observation = requireAccount(
    request.snapshot,
    pool.observation,
    "observation state",
    RAYDIUM_CPMM_PROGRAM,
  );
  validateLayout(observation, 4075, OBSERVATION_DISCRIMINATOR);
  const observationIndex = new DataView(
    observation.data.buffer,
    observation.data.byteOffset,
    observation.data.byteLength,
  ).getUint16(9, true);
  if (
    readAddress(observation.data, 11) !== request.pool ||
    observation.data[8]! > 1 ||
    observationIndex >= 100
  ) {
    invalidAccount(pool.observation, "Invalid observation state pool link or index");
  }
  const mint0 = readMint(request.snapshot, pool.mint0);
  const mint1 = readMint(request.snapshot, pool.mint1);
  if (
    mint0.tokenProgram !== pool.tokenProgram0 ||
    mint1.tokenProgram !== pool.tokenProgram1 ||
    mint0.decimals !== pool.decimals0 ||
    mint1.decimals !== pool.decimals1
  ) {
    invalidAccount(request.pool, "Pool token program or decimals do not match its mints");
  }
  const vault0 = readTokenAccount(
    request.snapshot,
    pool.vault0,
    pool.mint0,
    pool.tokenProgram0,
    authority,
  );
  const vault1 = readTokenAccount(
    request.snapshot,
    pool.vault1,
    pool.mint1,
    pool.tokenProgram1,
    authority,
  );
  if (pool.fees0 > vault0.amount || pool.fees1 > vault1.amount)
    invalidAccount(request.pool, "Accrued pool fees exceed vault balances");
  const reserve0 = vault0.amount - pool.fees0;
  const reserve1 = vault1.amount - pool.fees1;
  if (reserve0 === 0n || reserve1 === 0n)
    insufficientLiquidity("Pool reserves are empty after accrued fees");
  const zeroForOne = request.inputMint === pool.mint0;
  const creatorOnInput =
    pool.creatorFeeOn === 0 || pool.creatorFeeOn === (zeroForOne ? 1 : 2);
  const curve = quoteCurve(
    request,
    zeroForOne ? reserve0 : reserve1,
    zeroForOne ? reserve1 : reserve0,
    await readFees(request, pool),
    creatorOnInput,
  );
  if ((zeroForOne ? vault0.amount : vault1.amount) + curve.input > U64_MAX)
    insufficientLiquidity("Swap would overflow the input token vault");
  const fees: SwapFee[] = [
    { kind: "trade", mint: request.inputMint, amount: curve.tradeFee },
  ];
  if (curve.creatorFee > 0n)
    fees.push({
      kind: "creator",
      mint: creatorOnInput ? request.inputMint : request.outputMint,
      amount: curve.creatorFee,
    });
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
    owner: request.owner,
    authority,
    ammConfig: pool.config,
    pool: request.pool,
    inputTokenAccount: tokenAccounts.input,
    outputTokenAccount: tokenAccounts.output,
    inputVault: zeroForOne ? pool.vault0 : pool.vault1,
    outputVault: zeroForOne ? pool.vault1 : pool.vault0,
    inputTokenProgram: zeroForOne ? pool.tokenProgram0 : pool.tokenProgram1,
    outputTokenProgram: zeroForOne ? pool.tokenProgram1 : pool.tokenProgram0,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    observationState: pool.observation,
  };
  const instruction =
    quote.kind === "exactIn"
      ? getRaydiumCpmmSwapBaseInputInstruction(instructionAccounts, {
          amountIn: quote.amountIn,
          minimumAmountOut: quote.minimumAmountOut,
        })
      : getRaydiumCpmmSwapBaseOutputInstruction(instructionAccounts, {
          maximumAmountIn: quote.maximumAmountIn,
          amountOut: quote.amountOut,
        });
  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/**
 * Offline native Raydium CPMM swaps, including native exact output and creator fees.
 * @remarks Token extensions unsupported by the shared token decoder fail before quoting.
 * Caller state is validated structurally; no account authenticity or freshness is fetched.
 */
export const raydiumCpmmAdapter: ProtocolAdapter = {
  id: "raydium-cpmm",
  programAddresses: [RAYDIUM_CPMM_PROGRAM],
  requirements,
  build,
};
