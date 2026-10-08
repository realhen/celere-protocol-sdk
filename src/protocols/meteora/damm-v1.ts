/** Bigint adaptation of Meteora's MIT-declared DAMM v1 and vault SDKs; see NOTICE.md. */
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { readMint, readTokenAccount, TOKEN_PROGRAM } from "../../accounts/tokens.js";
import { ceilDiv, minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";

import { METEORA_DAMM_V1_PROGRAM, METEORA_VAULT_PROGRAM } from "./constants.js";
import { getMeteoraDammV1SwapInstruction } from "./instructions/damm-v1/swap.js";
export { METEORA_DAMM_V1_PROGRAM, METEORA_VAULT_PROGRAM } from "./constants.js";
const decoder = getAddressDecoder();
const encoder = getAddressEncoder();
const utf8 = new TextEncoder();
const PROFIT_DENOMINATOR = 1_000_000_000_000n;
const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
const VAULT_DISCRIMINATOR = [211, 8, 232, 43, 2, 152, 117, 119];

interface Pool {
  readonly mintA: Address;
  readonly mintB: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
  readonly shareA: Address;
  readonly shareB: Address;
  readonly feeA: Address;
  readonly feeB: Address;
  readonly authorityBump: number;
  readonly tradeNumerator: bigint;
  readonly tradeDenominator: bigint;
  readonly protocolNumerator: bigint;
  readonly protocolDenominator: bigint;
}
interface Vault {
  readonly address: Address;
  readonly token: Address;
  readonly mint: Address;
  readonly lpMint: Address;
  readonly base: Address;
  readonly bump: number;
  readonly tokenBump: number;
  readonly total: bigint;
  readonly unlocked: bigint;
}
interface VaultBalances {
  readonly vault: Vault;
  readonly supply: bigint;
  readonly shares: bigint;
  readonly reserve: bigint;
  readonly poolAmount: bigint;
}
function invalid(key: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: key, message });
}
function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "meteora-damm-v1",
    feature,
    message: `Meteora DAMM v1 ${feature} is not qualified for this release`,
  });
}
function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "meteora-damm-v1", message });
}
function readKey(data: Uint8Array, offset: number): Address {
  return decoder.decode(data.subarray(offset, offset + 32));
}
function readPool(request: SwapRequest): Pool {
  if (request.snapshot.unixTimestamp > U64_MAX || request.snapshot.slot > U64_MAX)
    fail({
      code: "INVALID_SNAPSHOT_CONTEXT",
      message: "Meteora chain time and slot must fit u64",
    });
  if (request.amount.kind === "exactOut")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "meteora-damm-v1",
      mode: "exactOut",
      message: "Meteora DAMM v1 only exposes a native exact-input swap",
    });
  const data = requireAccount(
    request.snapshot,
    request.pool,
    "pool",
    METEORA_DAMM_V1_PROGRAM,
  ).data;
  if (data.length !== 1387 || !POOL_DISCRIMINATOR.every((b, i) => data[i] === b))
    invalid(request.pool, "Unsupported Meteora DAMM v1 pool layout");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[874] !== 0) unsupported("stable or unknown curves");
  if (data[362] !== 0 && data[362] !== 1)
    invalid(request.pool, "Unknown Meteora pool type");
  if (data[233] !== 1) invalid(request.pool, "Meteora DAMM v1 pool is disabled");
  if (data[475] !== 0 && data[475] !== 1)
    invalid(request.pool, "Unknown activation type");
  const point = data[475] === 0 ? request.snapshot.slot : request.snapshot.unixTimestamp;
  if (point < view.getBigUint64(403, true))
    invalid(request.pool, "Meteora DAMM v1 pool has not activated");
  if (
    view.getBigUint64(476, true) !== 0n ||
    view.getBigUint64(516, true) !== 0n ||
    view.getBigUint64(524, true) !== 0n
  )
    unsupported("partner fees");
  const pool: Pool = {
    mintA: readKey(data, 40),
    mintB: readKey(data, 72),
    vaultA: readKey(data, 104),
    vaultB: readKey(data, 136),
    shareA: readKey(data, 168),
    shareB: readKey(data, 200),
    feeA: readKey(data, 234),
    feeB: readKey(data, 266),
    authorityBump: data[232]!,
    tradeNumerator: view.getBigUint64(330, true),
    tradeDenominator: view.getBigUint64(338, true),
    protocolNumerator: view.getBigUint64(346, true),
    protocolDenominator: view.getBigUint64(354, true),
  };
  if (
    pool.mintA === pool.mintB ||
    pool.vaultA === pool.vaultB ||
    pool.shareA === pool.shareB ||
    pool.feeA === pool.feeB
  )
    invalid(request.pool, "Pool asset accounts must be distinct");
  if (
    pool.tradeDenominator === 0n ||
    pool.tradeNumerator >= pool.tradeDenominator ||
    pool.protocolDenominator === 0n ||
    pool.protocolNumerator > pool.protocolDenominator
  )
    invalid(request.pool, "Invalid Meteora fee fractions");
  if (!(
    (request.inputMint === pool.mintA && request.outputMint === pool.mintB) ||
    (request.inputMint === pool.mintB && request.outputMint === pool.mintA)
  ))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mints do not match the DAMM v1 pool",
    });
  return pool;
}
function readVault(request: SwapRequest, key: Address, mint: Address): Vault {
  const data = requireAccount(
    request.snapshot,
    key,
    "Meteora vault",
    METEORA_VAULT_PROGRAM,
  ).data;
  if (
    data.length < 1227 ||
    data.length > 10240 ||
    !VAULT_DISCRIMINATOR.every((b, i) => data[i] === b)
  )
    invalid(key, "Unsupported Meteora vault layout");
  if (data[8] !== 1) invalid(key, "Meteora vault deposits are disabled");
  if (data.subarray(147, 1107).some((b) => b !== 0)) unsupported("vault strategies");
  if (readKey(data, 83) !== mint) invalid(key, "Vault mint does not match the pool");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const total = view.getBigUint64(11, true),
    locked = view.getBigUint64(1203, true),
    lastReport = view.getBigUint64(1211, true),
    degradation = view.getBigUint64(1219, true);
  if (
    lastReport > request.snapshot.unixTimestamp ||
    degradation > PROFIT_DENOMINATOR ||
    locked > total
  )
    invalid(key, "Invalid vault locked-profit state or chain timestamp");
  const ratio = (request.snapshot.unixTimestamp - lastReport) * degradation;
  const remaining =
    ratio >= PROFIT_DENOMINATOR
      ? 0n
      : (locked * (PROFIT_DENOMINATOR - ratio)) / PROFIT_DENOMINATOR;
  return {
    address: key,
    mint,
    token: readKey(data, 19),
    lpMint: readKey(data, 115),
    base: readKey(data, 1107),
    bump: data[9]!,
    tokenBump: data[10]!,
    total,
    unlocked: total - remaining,
  };
}
async function pda(
  programAddress: Address,
  seeds: readonly (Address | string)[],
  literalFirst = false,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map((seed, index) =>
      literalFirst && index === 0 ? utf8.encode(seed) : encoder.encode(seed as Address),
    ),
  });
}
async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  const required: AccountRequirement[] = [
    { address: request.pool, role: "DAMM v1 pool" },
    { address: pool.mintA, role: "token A mint" },
    { address: pool.mintB, role: "token B mint" },
    { address: pool.shareA, role: "pool vault A shares" },
    { address: pool.shareB, role: "pool vault B shares" },
    { address: pool.feeA, role: "token A protocol fees" },
    { address: pool.feeB, role: "token B protocol fees" },
  ];
  for (const [key, mint] of [
    [pool.vaultA, pool.mintA],
    [pool.vaultB, pool.mintB],
  ] as const) {
    required.push({ address: key, role: "Meteora vault" });
    if (request.snapshot.accounts[key]) {
      const vault = readVault(request, key, mint);
      required.push(
        { address: vault.token, role: "vault token reserve" },
        { address: vault.lpMint, role: "vault share mint" },
      );
    }
  }
  return required;
}
async function balances(
  request: SwapRequest,
  pool: Pool,
  key: Address,
  mint: Address,
  share: Address,
  fee: Address,
): Promise<VaultBalances> {
  const vault = readVault(request, key, mint);
  const [expectedVault, bump] = await pda(
    METEORA_VAULT_PROGRAM,
    ["vault", mint, vault.base],
    true,
  );
  const [expectedToken, tokenBump] = await pda(
    METEORA_VAULT_PROGRAM,
    ["token_vault", key],
    true,
  );
  const [expectedMint] = await pda(METEORA_VAULT_PROGRAM, ["lp_mint", key], true);
  const [expectedShare, shareBump] = await pda(METEORA_DAMM_V1_PROGRAM, [
    key,
    request.pool,
  ]);
  const [expectedFee] = await pda(
    METEORA_DAMM_V1_PROGRAM,
    ["fee", mint, request.pool],
    true,
  );
  if (
    key !== expectedVault ||
    bump !== vault.bump ||
    vault.token !== expectedToken ||
    tokenBump !== vault.tokenBump ||
    vault.lpMint !== expectedMint ||
    share !== expectedShare ||
    fee !== expectedFee ||
    (share === pool.shareA && shareBump !== pool.authorityBump)
  )
    invalid(key, "Vault or pool share PDA mismatch");
  const lp = readMint(request.snapshot, vault.lpMint);
  if (
    readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM ||
    lp.tokenProgram !== TOKEN_PROGRAM
  )
    unsupported("Token-2022 assets or vault shares");
  const lpData = requireAccount(request.snapshot, vault.lpMint, "vault share mint").data;
  const lpView = new DataView(lpData.buffer, lpData.byteOffset, lpData.byteLength);
  if (
    lpView.getUint32(0, true) !== 1 ||
    readKey(lpData, 4) !== key ||
    lpView.getUint32(46, true) !== 0
  )
    invalid(vault.lpMint, "Invalid vault share mint authority");
  const reserve = readTokenAccount(
    request.snapshot,
    vault.token,
    mint,
    TOKEN_PROGRAM,
    key,
  ).amount;
  const shares = readTokenAccount(
    request.snapshot,
    share,
    vault.lpMint,
    TOKEN_PROGRAM,
    pool.shareA,
  ).amount;
  readTokenAccount(request.snapshot, fee, mint, TOKEN_PROGRAM, pool.shareA);
  if (vault.total > reserve || shares > lp.supply)
    invalid(key, "Vault total or pool shares exceed supplied backing");
  if (lp.supply === 0n || vault.unlocked === 0n || shares === 0n)
    insufficient("Meteora vault has no unlocked pool liquidity");
  return {
    vault,
    supply: lp.supply,
    shares,
    reserve,
    poolAmount: (shares * vault.unlocked) / lp.supply,
  };
}
function fee(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (amount === 0n || numerator === 0n) return 0n;
  const rounded = (amount * numerator) / denominator;
  return rounded === 0n ? 1n : rounded;
}
/** Share mint/burn conversions round down independently from the constant-product output. */
function quoteInput(
  request: SwapRequest,
  pool: Pool,
  input: VaultBalances,
  output: VaultBalances,
) {
  if (request.amount.kind !== "exactIn") throw new Error("Validated swap mode changed");
  const amount = request.amount.amountIn;
  const tradeFee = fee(amount, pool.tradeNumerator, pool.tradeDenominator);
  const protocolFee = fee(tradeFee, pool.protocolNumerator, pool.protocolDenominator);
  const deposit = amount - protocolFee;
  if (deposit <= 0n || input.poolAmount === 0n || output.poolAmount === 0n)
    insufficient("Swap input or pool reserves are exhausted");
  const minted = (deposit * input.supply) / input.vault.unlocked;
  if (minted === 0n) insufficient("Swap input cannot mint one vault share");
  if (
    input.supply + minted > U64_MAX ||
    input.shares + minted > U64_MAX ||
    input.vault.total + deposit > U64_MAX ||
    input.reserve + deposit > U64_MAX
  )
    insufficient("Swap exceeds native vault accounting range");
  const after =
    ((input.shares + minted) * (input.vault.unlocked + deposit)) /
    (input.supply + minted);
  const curveInput = after - input.poolAmount - (tradeFee - protocolFee);
  if (curveInput <= 0n) insufficient("Swap input is consumed by vault rounding and fees");
  const invariant = input.poolAmount * output.poolAmount;
  const denominator = input.poolAmount + curveInput;
  if (invariant / denominator === 0n)
    insufficient("Swap exceeds the native constant-product arithmetic range");
  const curveOutput = output.poolAmount - ceilDiv(invariant, denominator);
  const burned = (curveOutput * output.supply) / output.vault.unlocked;
  const credit = (burned * output.vault.unlocked) / output.supply;
  if (credit <= 0n || credit >= output.reserve || burned >= output.shares)
    insufficient("Swap output exceeds available vault liquidity or rounds to zero");
  const protocolAccount = request.inputMint === pool.mintA ? pool.feeA : pool.feeB;
  if (
    readTokenAccount(
      request.snapshot,
      protocolAccount,
      request.inputMint,
      TOKEN_PROGRAM,
      pool.shareA,
    ).amount +
      protocolFee >
    U64_MAX
  )
    insufficient("Protocol fee account would overflow");
  return {
    kind: "exactIn" as const,
    amountIn: amount,
    minimumAmountOut: minimumOutput(credit, request.slippageBps),
    expectedAmountIn: amount,
    expectedAmountOut: credit,
    fees: [{ kind: "trade" as const, mint: request.inputMint, amount: tradeFee }],
  };
}
async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const a = await balances(
    request,
    pool,
    pool.vaultA,
    pool.mintA,
    pool.shareA,
    pool.feeA,
  );
  const b = await balances(
    request,
    pool,
    pool.vaultB,
    pool.mintB,
    pool.shareB,
    pool.feeB,
  );
  const reserved = [
    pool.shareA,
    pool.shareB,
    pool.feeA,
    pool.feeB,
    a.vault.token,
    b.vault.token,
  ];
  if (reserved.includes(tokenAccounts.input) || reserved.includes(tokenAccounts.output))
    invalid(request.pool, "User token accounts cannot alias protocol accounts");
  const reverse = request.inputMint === pool.mintB;
  const quote = quoteInput(request, pool, reverse ? b : a, reverse ? a : b);
  const instruction = getMeteoraDammV1SwapInstruction(
    {
      pool: request.pool,
      userSourceToken: tokenAccounts.input,
      userDestinationToken: tokenAccounts.output,
      vaultA: pool.vaultA,
      vaultB: pool.vaultB,
      tokenVaultA: a.vault.token,
      tokenVaultB: b.vault.token,
      vaultLpMintA: a.vault.lpMint,
      vaultLpMintB: b.vault.lpMint,
      vaultLpTokenA: pool.shareA,
      vaultLpTokenB: pool.shareB,
      protocolTokenFee: reverse ? pool.feeB : pool.feeA,
      user: request.owner,
    },
    { amountIn: quote.amountIn, minimumAmountOut: quote.minimumAmountOut },
  );
  return { instructions: [instruction], quote, mayPartiallyFill: false };
}
/**
 * Offline native exact-input swaps for constant-product DAMM v1 pools.
 * @remarks Supports classic SPL assets and fully backed vaults without strategies.
 * Caller chain time determines locked-profit release. Stable curves, partner fees,
 * strategy vaults and exact output fail explicitly. Fees include the protocol cut.
 */
export const meteoraDammV1Adapter: ProtocolAdapter = {
  id: "meteora-damm-v1",
  programAddresses: [METEORA_DAMM_V1_PROGRAM],
  requirements,
  build,
};
