/** Native LaunchLab interface facts: raydium-io/raydium-idl e7e0c96; independent implementation. */
import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import {
  UnsupportedPoolFeatureError,
  InsufficientLiquidityError,
  UnsupportedSwapModeError,
} from "../errors";
import type { Address, Instruction } from "@solana/kit";
import {
  readMint,
  readTokenAccount,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../accounts/tokens";
import { ceilDiv, maximumInput, minimumOutput } from "../amounts";

import {
  accountDataView,
  matchesDiscriminator,
  readAddress,
  readU64,
} from "../accounts/bytes";
import { requireAccount } from "../accounts/snapshot";
import type {
  ProtocolAdapter,
  ProtocolSwap,
  SwapRequest,
  SnapshotAccount,
  SwapFee,
} from "../types";
import type { ResolvedTokenAccounts } from "../accounts/plan";
import {
  buy_exact_in,
  sell_exact_in,
  sell_exact_out,
} from "./instructions/launchlab/index";
import { RAYDIUM_LAUNCHLAB_PROGRAM } from "./constants";
export { RAYDIUM_LAUNCHLAB_PROGRAM } from "./constants";
import {
  findRaydiumLaunchlabAuthorityPda,
  getRaydiumLaunchlabGlobalConfigAddress,
  getRaydiumLaunchlabPoolAddress,
  getRaydiumLaunchlabVaultAddress,
  getRaydiumLaunchlabEventAuthorityAddress,
  getRaydiumLaunchlabPlatformFeeVaultAddress,
  getRaydiumLaunchlabCreatorFeeVaultAddress,
} from "./pda";
export {
  findRaydiumLaunchlabAuthorityPda,
  getRaydiumLaunchlabAuthorityAddress,
  getRaydiumLaunchlabGlobalConfigAddress,
  getRaydiumLaunchlabPoolAddress,
  getRaydiumLaunchlabVaultAddress,
  getRaydiumLaunchlabEventAuthorityAddress,
  getRaydiumLaunchlabPlatformFeeVaultAddress,
  getRaydiumLaunchlabCreatorFeeVaultAddress,
} from "./pda";
const FEE_SCALE = 1_000_000n;

interface Pool {
  config: Address;
  platform: Address;
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  creator: Address;
  supply: bigint;
  totalSell: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  sold: bigint;
  raised: bigint;
  target: bigint;
  baseDecimals: number;
  quoteDecimals: number;
  bump: number;
  tokenFlags: number;
  pendingFees: bigint;
  locked: bigint;
}

interface Rates {
  trade: bigint;
  platform: bigint;
  creator: bigint;
}

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "launchlab",
    feature,
    message: `Unsupported LaunchLab feature: ${feature}`,
  });
}

function liquidity(): never {
  throw new InsufficientLiquidityError({
    protocol: "launchlab",
    message: "Requested amount exceeds the active LaunchLab curve's liquidity",
  });
}

function layout(
  account: SnapshotAccount,
  length: number,
  discriminator: readonly number[],
  exact = true,
): Uint8Array {
  if (
    (exact ? account.data.length !== length : account.data.length < length) ||
    !matchesDiscriminator(account.data, discriminator)
  ) {
    throw new InvalidAccountError({
      address: account.address,
      message: "Unsupported LaunchLab account layout or discriminator",
    });
  }

  return account.data;
}

function poolState(request: SwapRequest): Pool {
  const data = layout(
    requireAccount(
      request.snapshot,
      request.pool,
      "LaunchLab pool",
      RAYDIUM_LAUNCHLAB_PROGRAM,
    ),
    429,
    [247, 237, 227, 245, 215, 195, 222, 70],
  );

  if (data[17] !== 0) {
    unsupported("closed or migrated pool");
  }
  if (data[20]! > 1 || data[365]! > 3 || data[366]! > 1) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LaunchLab pool flags",
    });
  }

  const pool: Pool = {
    bump: data[16]!,
    baseDecimals: data[18]!,
    quoteDecimals: data[19]!,
    supply: readU64(data, 21),
    totalSell: readU64(data, 29),
    virtualBase: readU64(data, 37),
    virtualQuote: readU64(data, 45),
    sold: readU64(data, 53),
    raised: readU64(data, 61),
    target: readU64(data, 69),
    pendingFees: readU64(data, 77) + readU64(data, 85) + readU64(data, 93),
    locked: readU64(data, 101),
    config: readAddress(data, 141),
    platform: readAddress(data, 173),
    baseMint: readAddress(data, 205),
    quoteMint: readAddress(data, 237),
    baseVault: readAddress(data, 269),
    quoteVault: readAddress(data, 301),
    creator: readAddress(data, 333),
    tokenFlags: data[365]!,
  };

  if (
    pool.baseMint === pool.quoteMint ||
    pool.baseVault === pool.quoteVault ||
    pool.sold > pool.totalSell ||
    pool.totalSell + pool.locked > pool.supply ||
    pool.totalSell >= pool.virtualBase ||
    pool.raised >= pool.target
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Inconsistent LaunchLab pool state",
    });
  }
  if (!(
    (request.inputMint === pool.baseMint && request.outputMint === pool.quoteMint) ||
    (request.inputMint === pool.quoteMint && request.outputMint === pool.baseMint)
  )) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Requested pair does not match the LaunchLab pool",
    });
  }

  return pool;
}

async function readRates(request: SwapRequest, pool: Pool): Promise<Rates> {
  const config = layout(
    requireAccount(
      request.snapshot,
      pool.config,
      "LaunchLab global config",
      RAYDIUM_LAUNCHLAB_PROGRAM,
    ),
    371,
    [149, 8, 156, 202, 160, 252, 176, 217],
  );

  if (config[16] !== 0) {
    unsupported("non constant-product curve");
  }

  const index = accountDataView(config).getUint16(17, true);
  const expected = await getRaydiumLaunchlabGlobalConfigAddress(pool.quoteMint, index);

  if (expected !== pool.config || readAddress(config, 83) !== pool.quoteMint) {
    throw new InvalidAccountError({
      address: pool.config,
      message: "LaunchLab global config does not match its quote mint and PDA",
    });
  }

  const platform = layout(
    requireAccount(
      request.snapshot,
      pool.platform,
      "LaunchLab platform config",
      RAYDIUM_LAUNCHLAB_PROGRAM,
    ),
    944,
    [160, 78, 128, 0, 248, 83, 230, 160],
    false,
  );
  const rates = {
    trade: readU64(config, 27),
    platform: readU64(platform, 104),
    creator: readU64(platform, 720),
  };

  if (
    rates.trade + rates.platform + rates.creator >= FEE_SCALE ||
    rates.platform > 50_000n ||
    rates.creator > 5_000n
  ) {
    throw new InvalidAccountError({
      address: pool.platform,
      message: "Invalid LaunchLab fee rates",
    });
  }

  return rates;
}

function fees(
  gross: bigint,
  rates: Rates,
): { total: bigint; trade: bigint; creator: bigint } {
  const total = ceilDiv(
    gross * (rates.trade + rates.platform + rates.creator),
    FEE_SCALE,
  );
  const creator = (gross * rates.creator) / FEE_SCALE;

  return { total, trade: total - creator, creator };
}

function grossForNet(net: bigint, rates: Rates): bigint {
  return ceilDiv(
    net * FEE_SCALE,
    FEE_SCALE - rates.trade - rates.platform - rates.creator,
  );
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = poolState(request);
  const buy = request.inputMint === pool.quoteMint;

  if (buy && request.amount.kind === "exactOut") {
    throw new UnsupportedSwapModeError({
      protocol: "launchlab",
      mode: "exactOut",
      message:
        "LaunchLab buy_exact_out can deliver less than the requested output at graduation",
    });
  }

  const rates = await readRates(request, pool);
  const [authority, bump] = await findRaydiumLaunchlabAuthorityPda();
  const expectedPool = await getRaydiumLaunchlabPoolAddress(
    pool.baseMint,
    pool.quoteMint,
  );

  if (expectedPool !== request.pool || bump !== pool.bump) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LaunchLab pool or authority PDA mismatch",
    });
  }

  const base = readMint(request.snapshot, pool.baseMint);
  const quote = readMint(request.snapshot, pool.quoteMint);

  if (
    base.decimals !== pool.baseDecimals ||
    quote.decimals !== pool.quoteDecimals ||
    base.tokenProgram !== (pool.tokenFlags & 1 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM) ||
    quote.tokenProgram !== (pool.tokenFlags & 2 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM)
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LaunchLab mint metadata does not match pool state",
    });
  }

  const baseVault = await getRaydiumLaunchlabVaultAddress(request.pool, pool.baseMint);
  const quoteVault = await getRaydiumLaunchlabVaultAddress(request.pool, pool.quoteMint);

  if (baseVault !== pool.baseVault || quoteVault !== pool.quoteVault) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LaunchLab vault PDA mismatch",
    });
  }

  const baseBalance = readTokenAccount(
    request.snapshot,
    pool.baseVault,
    pool.baseMint,
    base.tokenProgram,
    authority,
  ).amount;
  const quoteBalance = readTokenAccount(
    request.snapshot,
    pool.quoteVault,
    pool.quoteMint,
    quote.tokenProgram,
    authority,
  ).amount;

  if (
    baseBalance < pool.totalSell - pool.sold ||
    quoteBalance < pool.raised + pool.pendingFees
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LaunchLab vault does not back the recorded curve reserves",
    });
  }
  if (pool.virtualBase <= pool.sold || pool.virtualQuote + pool.raised > U64_MAX) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LaunchLab effective reserves",
    });
  }

  // Price against virtual reserves after validating the vault-backed sale balances.
  const x = pool.virtualBase - pool.sold;
  const y = pool.virtualQuote + pool.raised;

  if (y === 0n) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LaunchLab effective quote reserve is zero",
    });
  }

  let input: bigint;
  let output: bigint;
  let quoteGross: bigint;

  if (request.amount.kind === "exactIn") {
    input = request.amount.amountIn;

    if (buy) {
      quoteGross = input;
      const net = input - fees(input, rates).total;

      if (net <= 0n) {
        liquidity();
      }

      output = (x * net) / (y + net);
      const remainingBase = pool.totalSell - pool.sold;

      // Graduation caps the delivered base and can reduce the actual quote debit.
      if (output >= remainingBase) {
        output = remainingBase;
        input = grossForNet(ceilDiv(y * output, x - output), rates);
        quoteGross = input;
      }
    } else {
      if (input > pool.sold) {
        liquidity();
      }

      quoteGross = (y * input) / (x + input);
      output = quoteGross - fees(quoteGross, rates).total;
    }
  } else {
    output = request.amount.amountOut;
    quoteGross = grossForNet(output, rates);

    if (quoteGross >= y || quoteGross > pool.raised) {
      liquidity();
    }

    input = ceilDiv(x * quoteGross, y - quoteGross);
  }
  if (
    input <= 0n ||
    output <= 0n ||
    input > U64_MAX ||
    output > U64_MAX ||
    (buy
      ? output > pool.totalSell - pool.sold
      : input > pool.sold || quoteGross > pool.raised)
  ) {
    liquidity();
  }

  const charged = fees(quoteGross, rates);
  const feeItems: SwapFee[] = [
    { kind: "trade", mint: pool.quoteMint, amount: charged.trade },
  ];

  if (charged.creator !== 0n) {
    feeItems.push({ kind: "creator", mint: pool.quoteMint, amount: charged.creator });
  }

  const swapQuote =
    request.amount.kind === "exactIn"
      ? {
          kind: "exactIn" as const,
          amountIn: request.amount.amountIn,
          minimumAmountOut: minimumOutput(output, request.slippageBps),
          expectedAmountIn: input,
          expectedAmountOut: output,
          fees: feeItems,
        }
      : {
          kind: "exactOut" as const,
          amountOut: output,
          maximumAmountIn: maximumInput(input, request.slippageBps),
          expectedAmountIn: input,
          expectedAmountOut: output,
          fees: feeItems,
        };

  const eventAuthority = await getRaydiumLaunchlabEventAuthorityAddress();
  const platformFeeVault = await getRaydiumLaunchlabPlatformFeeVaultAddress(
    pool.platform,
    pool.quoteMint,
  );
  const creatorFeeVault = await getRaydiumLaunchlabCreatorFeeVaultAddress(
    pool.creator,
    pool.quoteMint,
  );

  const instructionAccounts = {
    owner: request.owner,
    authority,
    config: pool.config,
    platform: pool.platform,
    pool: request.pool,
    userBase: buy ? accounts.output : accounts.input,
    userQuote: buy ? accounts.input : accounts.output,
    baseVault: pool.baseVault,
    quoteVault: pool.quoteVault,
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    baseTokenProgram: base.tokenProgram,
    quoteTokenProgram: quote.tokenProgram,
    eventAuthority,
    platformFeeVault,
    creatorFeeVault,
  };

  let instruction: Instruction;

  if (swapQuote.kind === "exactOut") {
    instruction = sell_exact_out(instructionAccounts, {
      amountOut: swapQuote.amountOut,
      maximumAmountIn: swapQuote.maximumAmountIn,
    });
  } else {
    const instructionArgs = {
      amountIn: swapQuote.amountIn,
      minimumAmountOut: swapQuote.minimumAmountOut,
    };
    instruction = buy
      ? buy_exact_in(instructionAccounts, instructionArgs)
      : sell_exact_in(instructionAccounts, instructionArgs);
  }

  return {
    instructions: [instruction],
    quote: swapQuote,
    mayPartiallyFill: buy && request.amount.kind === "exactIn",
  };
}

/**
 * Offline constant-product LaunchLab exact-input swaps and exact-output sells.
 * @remarks All amounts use supplied state. Referral fees are disabled. Exact-input buys may
 * finish funding with a partial debit and require allowPartial. Nonconstant curves and
 * Token-2022 transfer-fee extensions and exact-output buys are rejected. The native buy
 * output-specified instruction can partially fill at graduation. The trader funds lazy fee-vault rent.
 */
export const raydiumLaunchlabAdapter: ProtocolAdapter = {
  id: "launchlab",
  programAddresses: [RAYDIUM_LAUNCHLAB_PROGRAM],
  async requirements(request) {
    const pool = poolState(request);

    return [
      { address: pool.config, role: "LaunchLab global config" },
      { address: pool.platform, role: "LaunchLab platform config" },
      { address: pool.baseMint, role: "base mint" },
      { address: pool.quoteMint, role: "quote mint" },
      { address: pool.baseVault, role: "base vault" },
      { address: pool.quoteVault, role: "quote vault" },
    ];
  },
  build,
};
