/** Modified offline adaptation of raydium-io/raydium-amm (Apache-2.0); see NOTICE.md. */
import { getAddressDecoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { TOKEN_PROGRAM, readMint, readTokenAccount } from "../../accounts/tokens.js";
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
import {
  getRaydiumAmmV4SwapBaseInV2Instruction,
  getRaydiumAmmV4SwapBaseOutV2Instruction,
} from "./instructions/amm-v4/index.js";
import { RAYDIUM_AMM_V4_PROGRAM } from "./constants.js";
export { RAYDIUM_AMM_V4_PROGRAM } from "./constants.js";

const decoder = getAddressDecoder();
const U128_MAX = (1n << 128n) - 1n;

interface PoolState {
  readonly status: bigint;
  readonly nonce: bigint;
  readonly decimals0: bigint;
  readonly decimals1: bigint;
  readonly feeNumerator: bigint;
  readonly feeDenominator: bigint;
  readonly pendingPnl0: bigint;
  readonly pendingPnl1: bigint;
  readonly openTime: bigint;
  readonly vault0: Address;
  readonly vault1: Address;
  readonly mint0: Address;
  readonly mint1: Address;
}

function invalid(account: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account, message });
}

function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "raydium-amm-v4", message });
}

function readPool(request: SwapRequest): PoolState {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "AMM v4 pool",
    RAYDIUM_AMM_V4_PROGRAM,
  );
  if (account.data.length !== 752)
    invalid(request.pool, "Unsupported Raydium AMM v4 pool layout");
  const data = account.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pool: PoolState = {
    status: view.getBigUint64(0, true),
    nonce: view.getBigUint64(8, true),
    decimals0: view.getBigUint64(32, true),
    decimals1: view.getBigUint64(40, true),
    feeNumerator: view.getBigUint64(176, true),
    feeDenominator: view.getBigUint64(184, true),
    pendingPnl0: view.getBigUint64(192, true),
    pendingPnl1: view.getBigUint64(200, true),
    openTime: view.getBigUint64(224, true),
    vault0: decoder.decode(data.subarray(336, 368)),
    vault1: decoder.decode(data.subarray(368, 400)),
    mint0: decoder.decode(data.subarray(400, 432)),
    mint1: decoder.decode(data.subarray(432, 464)),
  };
  if (pool.status === 1n || pool.status === 5n)
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "raydium-amm-v4",
      feature: "orderbook-active-status",
      message: "Only vault-backed SwapOnly and opened WaitingTrade pools are qualified",
    });
  if (pool.status !== 6n && pool.status !== 7n)
    invalid(request.pool, "Raydium AMM v4 swaps are disabled or the status is invalid");
  if (pool.status === 7n && request.snapshot.unixTimestamp < pool.openTime)
    invalid(request.pool, "Raydium AMM v4 pool has not opened");
  if (
    pool.nonce > 255n ||
    pool.decimals0 > 255n ||
    pool.decimals1 > 255n ||
    pool.feeDenominator === 0n ||
    pool.feeNumerator >= pool.feeDenominator ||
    pool.mint0 === pool.mint1 ||
    pool.vault0 === pool.vault1
  )
    invalid(request.pool, "Invalid Raydium AMM v4 pool parameters");
  if (!(
    (request.inputMint === pool.mint0 && request.outputMint === pool.mint1) ||
    (request.inputMint === pool.mint1 && request.outputMint === pool.mint0)
  ))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested token pair does not match the AMM v4 pool",
    });
  return pool;
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  return [
    { address: request.pool, role: "AMM v4 pool" },
    { address: pool.vault0, role: "token 0 vault" },
    { address: pool.vault1, role: "token 1 vault" },
    { address: pool.mint0, role: "token 0 mint" },
    { address: pool.mint1, role: "token 1 mint" },
  ];
}

/**
 * The native V2 curve uses vault balances less pending PnL, with a ceiling input fee.
 * @remarks Adapted from raydium-io/raydium-amm, Apache-2.0, revision
 * d26944bfb76fb5fa8f91e5d440c2050ed358ef81. Exact output rounds curve input up,
 * then rounds its fee gross-up up; no inverse exact-input approximation is used.
 */
function quoteCurve(
  request: SwapRequest,
  pool: PoolState,
  inputReserve: bigint,
  outputReserve: bigint,
): SwapQuote {
  if (inputReserve === 0n || outputReserve === 0n)
    insufficient("Pool reserves are empty after pending PnL");
  let input: bigint;
  let output: bigint;
  let fee: bigint;
  if (request.amount.kind === "exactIn") {
    input = request.amount.amountIn;
    fee = ceilDiv(input * pool.feeNumerator, pool.feeDenominator);
    const curveInput = input - fee;
    if (curveInput <= 0n) insufficient("Input is consumed by the rounded swap fee");
    output = (curveInput * outputReserve) / (inputReserve + curveInput);
  } else {
    output = request.amount.amountOut;
    if (output >= outputReserve)
      insufficient("Requested output exhausts the pool reserve");
    const curveInput = ceilDiv(inputReserve * output, outputReserve - output);
    if (curveInput * pool.feeDenominator > U128_MAX)
      insufficient("Exact-output fee calculation exceeds the native arithmetic range");
    input = ceilDiv(
      curveInput * pool.feeDenominator,
      pool.feeDenominator - pool.feeNumerator,
    );
    fee = input - curveInput;
  }
  if (input <= 0n || output <= 0n || input > U64_MAX || output > U64_MAX)
    insufficient("Swap cannot produce nonzero u64 token amounts");
  const fees = [{ kind: "trade" as const, mint: request.inputMint, amount: fee }];
  return request.amount.kind === "exactIn"
    ? {
        kind: "exactIn",
        amountIn: input,
        minimumAmountOut: minimumOutput(output, request.slippageBps),
        expectedAmountIn: input,
        expectedAmountOut: output,
        fees,
      }
    : {
        kind: "exactOut",
        amountOut: output,
        maximumAmountIn: maximumInput(input, request.slippageBps),
        expectedAmountIn: input,
        expectedAmountOut: output,
        fees,
      };
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const [authority, nonce] = await getProgramDerivedAddress({
    programAddress: RAYDIUM_AMM_V4_PROGRAM,
    seeds: [new TextEncoder().encode("amm authority")],
  });
  if (pool.nonce !== BigInt(nonce))
    invalid(request.pool, "Invalid AMM v4 authority nonce");
  for (const [mint, decimals] of [
    [pool.mint0, pool.decimals0],
    [pool.mint1, pool.decimals1],
  ] as const) {
    const info = readMint(request.snapshot, mint);
    if (info.tokenProgram !== TOKEN_PROGRAM)
      fail({
        code: "UNSUPPORTED_POOL_FEATURE",
        protocol: "raydium-amm-v4",
        feature: "token-2022",
        message: "Raydium AMM v4 native swaps require classic SPL Token mints",
      });
    if (BigInt(info.decimals) !== decimals)
      invalid(mint, "Mint decimals do not match the AMM v4 pool");
  }
  const vault0 = readTokenAccount(
    request.snapshot,
    pool.vault0,
    pool.mint0,
    TOKEN_PROGRAM,
    authority,
  );
  const vault1 = readTokenAccount(
    request.snapshot,
    pool.vault1,
    pool.mint1,
    TOKEN_PROGRAM,
    authority,
  );
  if (pool.pendingPnl0 > vault0.amount || pool.pendingPnl1 > vault1.amount)
    invalid(request.pool, "Pending PnL exceeds an AMM v4 vault balance");
  if (
    [pool.vault0, pool.vault1].some(
      (vault) => vault === tokenAccounts.input || vault === tokenAccounts.output,
    )
  )
    invalid(request.pool, "User token accounts must differ from pool vaults");
  const zeroForOne = request.inputMint === pool.mint0;
  const reserve0 = vault0.amount - pool.pendingPnl0;
  const reserve1 = vault1.amount - pool.pendingPnl1;
  const quote = quoteCurve(
    request,
    pool,
    zeroForOne ? reserve0 : reserve1,
    zeroForOne ? reserve1 : reserve0,
  );
  if ((zeroForOne ? vault0.amount : vault1.amount) + quote.expectedAmountIn > U64_MAX)
    insufficient("Swap would overflow the input token vault");
  const instructionAccounts = {
    pool: request.pool,
    authority,
    vault0: pool.vault0,
    vault1: pool.vault1,
    userInput: tokenAccounts.input,
    userOutput: tokenAccounts.output,
    owner: request.owner,
  };
  const instruction =
    quote.kind === "exactIn"
      ? getRaydiumAmmV4SwapBaseInV2Instruction(instructionAccounts, {
          amountIn: quote.amountIn,
          minimumAmountOut: quote.minimumAmountOut,
        })
      : getRaydiumAmmV4SwapBaseOutV2Instruction(instructionAccounts, {
          maximumAmountIn: quote.maximumAmountIn,
          amountOut: quote.amountOut,
        });
  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/**
 * Offline Raydium AMM v4 native V2 exact-input and exact-output swaps.
 * @remarks Qualified for classic SPL Token and SwapOnly or opened WaitingTrade
 * pools. Native tags 16/17 use vault balances less pending PnL; legacy OpenBook
 * balances and market accounts are not inputs. Orderbook-active statuses are
 * rejected. Callers supply all observations and their chain clock; this adapter
 * neither authenticates snapshots nor discovers a deployed program revision.
 */
export const raydiumAmmV4Adapter: ProtocolAdapter = {
  id: "raydium-amm-v4",
  programAddresses: [RAYDIUM_AMM_V4_PROGRAM],
  requirements,
  build,
};
