/** Offline adaptation of Meteora's MIT DBC SDK and public IDL; see NOTICE.md. */
import type { Address } from "@solana/kit";
import {
  invalidAccount,
  accountDataView,
  readAddress,
  readU128,
  matchesDiscriminator,
} from "../shared/accounts";
import { readMint, readTokenAccount, TOKEN_PROGRAM } from "../../accounts/tokens";
import { ceilDiv, maximumInput, minimumOutput, U64_MAX } from "../../core/amounts";
import { fail } from "../../core/errors";
import { requireAccount } from "../../core/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapQuote,
  SwapRequest,
} from "../../core/types";
import { METEORA_DBC_PROGRAM, METEORA_DBC_AUTHORITY } from "./constants";

import {
  getMeteoraDbcPoolAddress,
  getMeteoraDbcTokenVaultAddress,
  getMeteoraDbcEventAuthorityAddress,
} from "./pda";
import { swap2 } from "./instructions/swap2";
import { calculateCurveSwap, type CurvePoint } from "./math";

export * from "./pda";
export { METEORA_DBC_PROGRAM, METEORA_DBC_AUTHORITY } from "./constants";

const FEE_DENOMINATOR = 1_000_000_000n;
const MIN_PRICE = 4_295_048_016n;
const MAX_PRICE = 79_226_673_521_066_979_257_578_248_091n;

interface Pool {
  readonly config: Address;
  readonly baseMint: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseReserve: bigint;
  readonly quoteReserve: bigint;
  readonly baseFees: bigint;
  readonly quoteFees: bigint;
  readonly sqrtPrice: bigint;
  readonly activationPoint: bigint;
}

interface Config {
  readonly quoteMint: Address;
  readonly fee: bigint;
  readonly creatorPercentage: bigint;
  readonly feesOnInput: boolean;
  readonly startPrice: bigint;
  readonly migrationPrice: bigint;
  readonly migrationThreshold: bigint;
  readonly points: readonly CurvePoint[];
  readonly decimals: number;
}

function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "meteora-dbc",
    feature,
    message: `Meteora DBC ${feature} is not qualified for this release`,
  });
}

function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "meteora-dbc", message });
}

function readPool(request: SwapRequest): Pool {
  const account = requireAccount(
    request.snapshot,
    request.pool,
    "DBC pool",
    METEORA_DBC_PROGRAM,
  );
  const data = account.data;
  const view = accountDataView(data);
  if (
    data.length !== 424 ||
    !matchesDiscriminator(data, [213, 224, 5, 209, 98, 69, 119, 92])
  ) {
    invalidAccount(request.pool, "Unknown Meteora DBC pool layout");
  }
  if (data[304] !== 0) {
    unsupported("Token-2022 base tokens");
  }
  if (data[305] !== 0 || data[308] !== 0 || view.getBigUint64(344, true) !== 0n) {
    invalidAccount(request.pool, "DBC pool has completed its curve or migration");
  }
  if (data[370]! > 1) {
    invalidAccount(request.pool, "Unknown DBC swap status");
  }

  return {
    config: readAddress(data, 72),
    baseMint: readAddress(data, 136),
    baseVault: readAddress(data, 168),
    quoteVault: readAddress(data, 200),
    baseReserve: view.getBigUint64(232, true),
    quoteReserve: view.getBigUint64(240, true),
    baseFees:
      view.getBigUint64(248, true) +
      view.getBigUint64(264, true) +
      view.getBigUint64(352, true),
    quoteFees:
      view.getBigUint64(256, true) +
      view.getBigUint64(272, true) +
      view.getBigUint64(360, true),
    sqrtPrice: readU128(view, 280),
    activationPoint: view.getBigUint64(296, true),
  };
}

function readConfig(request: SwapRequest, pool: Pool): Config {
  const data = requireAccount(
    request.snapshot,
    pool.config,
    "DBC config",
    METEORA_DBC_PROGRAM,
  ).data;
  if (
    data.length !== 1048 ||
    !matchesDiscriminator(data, [26, 108, 14, 123, 116, 230, 129, 43])
  ) {
    invalidAccount(pool.config, "Unknown Meteora DBC config layout");
  }

  const view = accountDataView(data);
  if (data[237] !== 0 || data[238] !== 0) {
    unsupported("Token-2022 assets");
  }
  if (data[136] !== 0) {
    unsupported("dynamic fees");
  }
  if (data[365] !== 0) {
    unsupported("privileged first-swap fee rules");
  }
  if (data[130] !== 0 && data[130] !== 1) {
    unsupported("rate limiter or unknown base fee mode");
  }
  if (data[232]! > 1 || data[234]! > 1 || data[236]! > 1 || data[245]! > 100) {
    invalidAccount(pool.config, "Unknown DBC config flags or creator fee percentage");
  }

  const point = data[234] === 0 ? request.snapshot.slot : request.snapshot.unixTimestamp;
  if (point < 0n || point > U64_MAX) {
    invalidAccount(request.pool, "DBC chain context must fit a native u64");
  }
  if (point < pool.activationPoint) {
    invalidAccount(request.pool, "DBC pool has not activated");
  }

  // Apply the fee schedule using the configured slot or timestamp activation clock.
  const cliff = view.getBigUint64(104, true);
  const frequency = view.getBigUint64(112, true);
  const reduction = view.getBigUint64(120, true);
  const periods = BigInt(view.getUint16(128, true));
  if (data[130] === 1 && frequency !== 0n && periods !== 0n && reduction !== 0n) {
    unsupported("exponential fee scheduler");
  }
  if (cliff > 990_000_000n || cliff - periods * reduction < 0n) {
    invalidAccount(pool.config, "Invalid DBC fee schedule");
  }

  const elapsed = frequency === 0n ? 0n : (point - pool.activationPoint) / frequency;
  const fee = cliff - (elapsed < periods ? elapsed : periods) * reduction;

  const quoteMint = readAddress(data, 8);
  if (!(
    (request.inputMint === pool.baseMint && request.outputMint === quoteMint) ||
    (request.inputMint === quoteMint && request.outputMint === pool.baseMint)
  )) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mints do not match the DBC pool",
    });
  }

  // Active curve points must be increasing and precede any zero-filled trailing entries.
  const points: CurvePoint[] = [];
  let ended = false;
  let previous = readU128(view, 392);

  for (let i = 0; i < 20; i++) {
    const sqrtPrice = readU128(view, 408 + i * 32);
    const liquidity = readU128(view, 424 + i * 32);
    if (sqrtPrice === 0n && liquidity === 0n) {
      ended = true;
      continue;
    }
    if (ended || sqrtPrice <= previous || sqrtPrice > MAX_PRICE || liquidity === 0n) {
      invalidAccount(pool.config, "Malformed piecewise DBC curve");
    }

    points.push({ sqrtPrice, liquidity });
    previous = sqrtPrice;
  }

  const startPrice = readU128(view, 392);
  const migrationPrice = readU128(view, 280);
  const migrationThreshold = view.getBigUint64(264, true);
  if (
    points.length === 0 ||
    startPrice < MIN_PRICE ||
    migrationPrice <= startPrice ||
    migrationPrice > previous ||
    pool.sqrtPrice < startPrice ||
    pool.sqrtPrice > migrationPrice
  ) {
    invalidAccount(pool.config, "DBC curve price bounds do not cover the pool");
  }
  if (pool.quoteReserve >= migrationThreshold) {
    invalidAccount(request.pool, "DBC pool reached its migration threshold");
  }

  return {
    quoteMint,
    fee,
    creatorPercentage: BigInt(data[245]!),
    feesOnInput: data[232] === 0 && request.inputMint === quoteMint,
    startPrice,
    migrationPrice,
    migrationThreshold,
    points,
    decimals: data[235]!,
  };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  const accounts: AccountRequirement[] = [
    { address: request.pool, role: "DBC pool" },
    { address: pool.config, role: "DBC config" },
    { address: pool.baseMint, role: "base mint" },
    { address: pool.baseVault, role: "base vault" },
    { address: pool.quoteVault, role: "quote vault" },
  ];
  if (request.snapshot.accounts[pool.config]) {
    accounts.push({ address: readConfig(request, pool).quoteMint, role: "quote mint" });
  }

  return accounts;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const config = readConfig(request, pool);
  const expectedPool = await getMeteoraDbcPoolAddress(
    pool.config,
    pool.baseMint,
    config.quoteMint,
  );
  if (
    expectedPool !== request.pool ||
    pool.baseMint === config.quoteMint ||
    pool.baseVault === pool.quoteVault
  ) {
    invalidAccount(request.pool, "DBC pool PDA or asset identities are invalid");
  }

  for (const [mint, vault] of [
    [pool.baseMint, pool.baseVault],
    [config.quoteMint, pool.quoteVault],
  ] as const) {
    if (readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM) {
      unsupported("Token-2022 assets");
    }

    const expected = await getMeteoraDbcTokenVaultAddress(mint, request.pool);
    if (vault !== expected) {
      invalidAccount(vault, "DBC vault PDA mismatch");
    }
  }
  if (readMint(request.snapshot, pool.baseMint).decimals !== config.decimals) {
    invalidAccount(pool.baseMint, "DBC config mint decimals mismatch");
  }

  const baseBalance = readTokenAccount(
    request.snapshot,
    pool.baseVault,
    pool.baseMint,
    TOKEN_PROGRAM,
    METEORA_DBC_AUTHORITY,
  ).amount;
  const quoteBalance = readTokenAccount(
    request.snapshot,
    pool.quoteVault,
    config.quoteMint,
    TOKEN_PROGRAM,
    METEORA_DBC_AUTHORITY,
  ).amount;
  if (
    pool.baseReserve + pool.baseFees > baseBalance ||
    pool.quoteReserve + pool.quoteFees > quoteBalance
  ) {
    invalidAccount(
      request.pool,
      "DBC reserves and accrued fees exceed observed vault balances",
    );
  }
  if (
    [pool.baseVault, pool.quoteVault].includes(accounts.input) ||
    [pool.baseVault, pool.quoteVault].includes(accounts.output)
  ) {
    invalidAccount(request.pool, "User accounts cannot alias DBC vaults");
  }

  const exactIn = request.amount.kind === "exactIn";
  const amount =
    request.amount.kind === "exactIn"
      ? request.amount.amountIn
      : request.amount.amountOut;

  // Convert the requested amount to curve units before traversing the liquidity segments.
  let totalFee = 0n;
  let curveAmount = amount;
  if (exactIn && config.feesOnInput) {
    totalFee = ceilDiv(amount * config.fee, FEE_DENOMINATOR);
    curveAmount = amount - totalFee;
  }
  if (!exactIn && !config.feesOnInput) {
    curveAmount = ceilDiv(amount * FEE_DENOMINATOR, FEE_DENOMINATOR - config.fee);
    totalFee = curveAmount - amount;
  }
  if (curveAmount <= 0n || curveAmount > U64_MAX) {
    insufficient("DBC amount is exhausted by fees or exceeds native arithmetic");
  }

  const baseToQuote = request.inputMint === pool.baseMint;
  const curve = calculateCurveSwap(
    config.points,
    config.startPrice,
    config.migrationPrice,
    pool.sqrtPrice,
    curveAmount,
    baseToQuote,
    exactIn,
  );

  // Restore user-facing amounts after applying fees on the configured side of the swap.
  let input = curve.input;
  let output = curve.output;
  if (exactIn && config.feesOnInput) {
    input = amount;
  }
  if (exactIn && !config.feesOnInput) {
    totalFee = ceilDiv(output * config.fee, FEE_DENOMINATOR);
    output -= totalFee;
  }
  if (!exactIn && config.feesOnInput) {
    input = ceilDiv(curve.input * FEE_DENOMINATOR, FEE_DENOMINATOR - config.fee);
    totalFee = input - curve.input;
  }
  if (!exactIn && !config.feesOnInput) {
    output = amount;
  }
  if (
    input > U64_MAX ||
    output <= 0n ||
    curve.output > (baseToQuote ? pool.quoteReserve : pool.baseReserve) ||
    (baseToQuote ? baseBalance : quoteBalance) + input > U64_MAX
  ) {
    insufficient("DBC vault reserves cannot settle this swap");
  }

  const protocolFee = (totalFee * 20n) / 100n;
  const creatorFee = ((totalFee - protocolFee) * config.creatorPercentage) / 100n;
  const feeMint = config.feesOnInput ? request.inputMint : request.outputMint;
  const fees = [
    { kind: "trade" as const, mint: feeMint, amount: totalFee - creatorFee },
    { kind: "creator" as const, mint: feeMint, amount: creatorFee },
  ];
  const swapQuote: SwapQuote = exactIn
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

  const eventAuthority = await getMeteoraDbcEventAuthorityAddress();
  const instruction = swap2(
    {
      config: pool.config,
      pool: request.pool,
      inputTokenAccount: accounts.input,
      outputTokenAccount: accounts.output,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault,
      baseMint: pool.baseMint,
      quoteMint: config.quoteMint,
      payer: request.owner,
      eventAuthority,
    },
    {
      amount: swapQuote.kind === "exactIn" ? swapQuote.amountIn : swapQuote.amountOut,
      otherAmountThreshold:
        swapQuote.kind === "exactIn"
          ? swapQuote.minimumAmountOut
          : swapQuote.maximumAmountIn,
      swapMode: exactIn ? 0 : 2,
    },
  );

  return { instructions: [instruction], quote: swapQuote, mayPartiallyFill: false };
}

/**
 * Offline Meteora DBC swaps across up to twenty classic-token liquidity segments.
 * @remarks Both native modes require full fills. Static and linear fees, output- or
 * quote-token fee collection and creator fee splits use caller chain context.
 * Dynamic/rate-limited fees, first-swap privileges and Token-2022 fail explicitly.
 */
export const meteoraDbcAdapter: ProtocolAdapter = {
  id: "meteora-dbc",
  programAddresses: [METEORA_DBC_PROGRAM],
  requirements,
  build,
};
