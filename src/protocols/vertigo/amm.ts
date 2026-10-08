/** Uses the official Vertigo SDK's MIT-declared account and instruction schema; see NOTICE.md. */
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { TOKEN_PROGRAM, readMint, readTokenAccount } from "../../accounts/tokens.js";
import { minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import {
  getVertigoBuyInstruction,
  getVertigoSellInstruction,
} from "./instructions/index.js";
import { VERTIGO_PROGRAM } from "./constants.js";
export { VERTIGO_PROGRAM } from "./constants.js";
const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
const U128_MAX = (1n << 128n) - 1n;
const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];

interface Pool {
  readonly owner: Address;
  readonly mintA: Address;
  readonly mintB: Address;
  readonly reserveA: bigint;
  readonly reserveB: bigint;
  readonly shift: bigint;
  readonly royalties: bigint;
  readonly protocolFees: bigint;
  readonly royaltyBps: bigint;
  readonly bump: number;
}
function invalid(account: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account, message });
}
function unsupported(feature: string, message: string): never {
  fail({ code: "UNSUPPORTED_POOL_FEATURE", protocol: "vertigo", feature, message });
}
function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "vertigo", message });
}
function readPool(request: SwapRequest): Pool {
  const { data } = requireAccount(
    request.snapshot,
    request.pool,
    "Vertigo pool",
    VERTIGO_PROGRAM,
  );
  if (
    data.length !== 229 ||
    POOL_DISCRIMINATOR.some((byte, index) => data[index] !== byte)
  )
    invalid(request.pool, "Unsupported Vertigo pool layout or discriminator");
  if (data[8] !== 1)
    invalid(request.pool, "Vertigo pool is disabled or has an invalid enable flag");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u128 = (offset: number) =>
    view.getBigUint64(offset, true) + (view.getBigUint64(offset + 8, true) << 64n);
  const pool: Pool = {
    owner: decoder.decode(data.subarray(9, 41)),
    mintA: decoder.decode(data.subarray(41, 73)),
    mintB: decoder.decode(data.subarray(73, 105)),
    reserveA: u128(105),
    reserveB: u128(121),
    shift: u128(137),
    royalties: view.getBigUint64(153, true),
    protocolFees: view.getBigUint64(161, true),
    bump: data[169]!,
    royaltyBps: BigInt(view.getUint16(194, true)),
  };
  const normalizationPeriod = view.getBigUint64(170, true);
  const decay = view.getFloat64(178, true);
  const reference = view.getBigUint64(186, true);
  if (
    !Number.isFinite(decay) ||
    decay <= 0 ||
    decay > 1 ||
    normalizationPeriod === 0n ||
    reference + normalizationPeriod > U64_MAX ||
    pool.royaltyBps + 5n >= 10_000n ||
    pool.shift === 0n ||
    pool.mintA === pool.mintB ||
    data[196]! > 1
  )
    invalid(request.pool, "Invalid Vertigo curve or fee parameters");
  if (data[196] !== 0)
    unsupported(
      "privileged-swapper",
      "Pools with privileged swapper configuration are not qualified",
    );
  if (
    request.snapshot.slot < reference ||
    request.snapshot.slot - reference < normalizationPeriod
  )
    unsupported(
      "anti-sniping-fees",
      "Vertigo's slot-dependent fee normalization period has not finished",
    );
  if (!(
    (request.inputMint === pool.mintA && request.outputMint === pool.mintB) ||
    (request.inputMint === pool.mintB && request.outputMint === pool.mintA)
  ))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested token pair does not match the Vertigo pool",
    });
  if (request.amount.kind === "exactOut")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "vertigo",
      mode: "exactOut",
      message: "Vertigo buy and sell instructions only support exact input",
    });
  return pool;
}
async function poolAddresses(request: SwapRequest, pool: Pool) {
  const [expected, bump] = await getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: [
      new TextEncoder().encode("pool"),
      encoder.encode(pool.owner),
      encoder.encode(pool.mintA),
      encoder.encode(pool.mintB),
    ],
  });
  if (expected !== request.pool || bump !== pool.bump)
    invalid(request.pool, "Invalid Vertigo pool PDA or bump");
  const deriveVault = (mint: Address) =>
    getProgramDerivedAddress({
      programAddress: VERTIGO_PROGRAM,
      seeds: [encoder.encode(request.pool), encoder.encode(mint)],
    });
  const [[vaultA], [vaultB]] = await Promise.all([
    deriveVault(pool.mintA),
    deriveVault(pool.mintB),
  ]);
  return { vaultA, vaultB };
}
async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  const { vaultA, vaultB } = await poolAddresses(request, pool);
  return [
    { address: request.pool, role: "Vertigo pool" },
    { address: pool.mintA, role: "quote mint" },
    { address: pool.mintB, role: "base mint" },
    { address: vaultA, role: "quote vault" },
    { address: vaultB, role: "base vault" },
  ];
}
async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const { vaultA, vaultB } = await poolAddresses(request, pool);
  for (const mint of [pool.mintA, pool.mintB])
    if (readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM)
      unsupported("token-2022", "Only classic SPL Token Vertigo pools are qualified");
  const a = readTokenAccount(
    request.snapshot,
    vaultA,
    pool.mintA,
    TOKEN_PROGRAM,
    request.pool,
  );
  const b = readTokenAccount(
    request.snapshot,
    vaultB,
    pool.mintB,
    TOKEN_PROGRAM,
    request.pool,
  );
  if (
    [vaultA, vaultB].some(
      (vault) => vault === tokenAccounts.input || vault === tokenAccounts.output,
    )
  )
    invalid(request.pool, "User token accounts must differ from Vertigo vaults");
  if (
    pool.reserveA + pool.royalties + pool.protocolFees > a.amount ||
    pool.reserveB > b.amount
  )
    invalid(
      request.pool,
      "Vertigo reserves and accrued fees exceed the observed vault balances",
    );
  const virtualA = pool.reserveA + pool.shift;
  if (virtualA > U128_MAX || virtualA * pool.reserveB > U128_MAX)
    insufficient("Vertigo curve exceeds the native u128 arithmetic range");
  if (request.amount.kind !== "exactIn")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "vertigo",
      mode: "exactOut",
      message: "Vertigo only supports exact input",
    });
  const input = request.amount.amountIn;
  const buy = request.inputMint === pool.mintA;
  if (virtualA + input > U128_MAX || input * (buy ? pool.reserveB : virtualA) > U128_MAX)
    insufficient("Vertigo swap exceeds the native u128 arithmetic range");
  let feeBasis: bigint;
  let output: bigint;
  if (buy) {
    feeBasis = input;
    const fee = (input * (pool.royaltyBps + 5n)) / 10_000n;
    const curveInput = input - fee;
    output = (curveInput * pool.reserveB) / (virtualA + curveInput);
  } else {
    feeBasis = (input * virtualA) / (pool.reserveB + input);
    output = feeBasis - (feeBasis * (pool.royaltyBps + 5n)) / 10_000n;
  }
  const fee = (feeBasis * (pool.royaltyBps + 5n)) / 10_000n;
  const tradeFee = (feeBasis * 5n) / 10_000n;
  if (
    output <= 0n ||
    output > U64_MAX ||
    (buy ? output > pool.reserveB : feeBasis > pool.reserveA)
  )
    insufficient("Vertigo reserves cannot fill the requested input");
  if (
    (buy ? a.amount : b.amount) + input > U64_MAX ||
    pool.royalties + fee - tradeFee > U64_MAX ||
    pool.protocolFees + tradeFee > U64_MAX
  )
    insufficient("Vertigo swap would overflow a vault or fee accumulator");
  const minimumAmountOut = minimumOutput(output, request.slippageBps);
  const instructionAccounts = {
    pool: request.pool,
    user: request.owner,
    poolOwner: pool.owner,
    mintA: pool.mintA,
    mintB: pool.mintB,
    userA: buy ? tokenAccounts.input : tokenAccounts.output,
    userB: buy ? tokenAccounts.output : tokenAccounts.input,
    vaultA,
    vaultB,
  };
  const instructionArgs = { amountIn: input, minimumAmountOut };
  const instruction = buy
    ? getVertigoBuyInstruction(instructionAccounts, instructionArgs)
    : getVertigoSellInstruction(instructionAccounts, instructionArgs);
  return {
    instructions: [instruction],
    quote: {
      kind: "exactIn",
      amountIn: input,
      expectedAmountIn: input,
      expectedAmountOut: output,
      minimumAmountOut,
      fees: [
        { kind: "trade", mint: pool.mintA, amount: tradeFee },
        { kind: "creator", mint: pool.mintA, amount: fee - tradeFee },
      ],
    },
    mayPartiallyFill: false,
  };
}
/**
 * Offline Vertigo native exact-input swaps for classic SPL Token pools after fee normalization.
 * @remarks The caller supplies the chain slot and raw account observations. Anti-sniping,
 * privileged swapper, Token-2022, and exact-output paths are explicitly unsupported.
 * Fees are denominated in mint A: charged on input for buys and output for sells.
 * The total fee rounds down once; the fixed five-basis-point protocol share also
 * rounds down, and creator royalties receive the remainder. Vault donations do
 * not increase the pool's recorded reserves or alter the quote.
 */
export const vertigoAdapter: ProtocolAdapter = {
  id: "vertigo",
  programAddresses: [VERTIGO_PROGRAM],
  requirements,
  build,
};
