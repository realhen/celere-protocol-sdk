import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import { InsufficientLiquidityError, UnsupportedSwapModeError } from "../errors";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { address, type Address } from "@solana/kit";
import {
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  WRAPPED_SOL_MINT,
  readMint,
  readTokenAccount,
} from "../accounts/tokens";
import { ceilDiv, maximumInput, minimumOutput } from "../amounts";

import { requireAccount } from "../accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../types";
import { accountDataView, readAddress } from "../accounts/bytes";
import {
  liquidAccount,
  readLiquidSolPrice,
  unsupportedLiquidFeature,
  validateLiquidSharedState,
} from "../liquid-af/shared-state";
import { LIQUID_AF_AMM_PROGRAM } from "./constants";
import {
  buy_exact_in,
  sell_exact_in,
  sell_exact_out,
  type LiquidAfAmmSwapAccounts,
} from "./instructions/index";
import {
  getLiquidAfAmmPoolAddresses,
  findLiquidAfAmmProtocolFeeVaultPda,
  getLiquidAfFeeVaultTokenAddress,
} from "./pda";
export * from "./pda";
export * from "./constants";
export {
  LIQUID_AF_FEES_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_EVENTS_PROGRAM,
  LIQUID_AF_PYTH_RECEIVER_PROGRAM,
} from "../liquid-af/constants";

const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

interface Pool {
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly lpMint: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly observation: Address;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly creator: Address;
  readonly authorityBump: number;
  readonly buy: boolean;
}

interface FeeTier {
  readonly start: bigint;
  readonly end: bigint;
  readonly lpBps: bigint;
  readonly protocolBps: bigint;
  readonly creatorBps: bigint;
}

function insufficient(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "liquid-af-amm", message });
}

function unsupported(feature: string, message: string): never {
  return unsupportedLiquidFeature("liquid-af-amm", feature, message);
}

function readPool(request: SwapRequest): Pool {
  const { data } = liquidAccount(
    request,
    request.pool,
    LIQUID_AF_AMM_PROGRAM,
    [247, 237, 227, 245, 215, 195, 222, 70],
    316,
    "LiquidAF AMM pool",
  );

  if (data.length !== 316) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Unsupported LiquidAF AMM pool layout",
    });
  }

  const view = accountDataView(data);
  const baseMint = readAddress(data, 104);
  const quoteMint = readAddress(data, 136);
  const buy = request.inputMint === quoteMint;

  if (
    baseMint === quoteMint ||
    (buy
      ? request.outputMint !== baseMint
      : request.inputMint !== baseMint || request.outputMint !== quoteMint)
  ) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Requested token pair does not match the LiquidAF AMM pool",
    });
  }
  if (buy && request.amount.kind === "exactOut") {
    throw new UnsupportedSwapModeError({
      protocol: "liquid-af-amm",
      mode: "exactOut",
      message:
        "LiquidAF AMM buy_exact_out can underfill by atomic rounding and cannot guarantee the requested output",
    });
  }
  if (quoteMint !== USDC_MINT && quoteMint !== WRAPPED_SOL_MINT) {
    unsupported("quote-mint", "Only USDC and wrapped-SOL quote pools are qualified");
  }
  if (view.getBigUint64(267, true) === 0n) {
    insufficient("LiquidAF AMM has no liquidity shares");
  }

  const pool = {
    baseVault: readAddress(data, 8),
    quoteVault: readAddress(data, 40),
    lpMint: readAddress(data, 72),
    baseMint,
    quoteMint,
    baseTokenProgram: readAddress(data, 168),
    quoteTokenProgram: readAddress(data, 200),
    observation: readAddress(data, 232),
    baseDecimals: data[265]!,
    quoteDecimals: data[266]!,
    creator: readAddress(data, 275),
    authorityBump: data[315]!,
    buy,
  };

  if (
    (pool.baseTokenProgram !== TOKEN_PROGRAM &&
      pool.baseTokenProgram !== TOKEN_2022_PROGRAM) ||
    pool.quoteTokenProgram !== TOKEN_PROGRAM
  ) {
    unsupported(
      "token-program",
      "LiquidAF AMM requires a classic quote mint and a classic or Token-2022 base mint",
    );
  }
  if (pool.quoteDecimals !== (quoteMint === WRAPPED_SOL_MINT ? 9 : 6)) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LiquidAF quote decimals do not match its qualified mint",
    });
  }

  return pool;
}

function readConfig(
  request: SwapRequest,
  account: Address,
  bump: number,
  quoteMint: Address,
) {
  const { data } = liquidAccount(
    request,
    account,
    LIQUID_AF_AMM_PROGRAM,
    [218, 244, 33, 104, 203, 203, 43, 111],
    339,
    "LiquidAF AMM configuration",
  );
  const view = accountDataView(data);
  const quoteCount = view.getUint32(296, true);
  let offset = 300 + quoteCount * 32;

  if (offset + 4 > data.length) {
    throw new InvalidAccountError({
      address: account,
      message: "Truncated LiquidAF AMM quote whitelist",
    });
  }

  let quoteAllowed = false;

  for (let index = 0; index < quoteCount; index++) {
    if (readAddress(data, 300 + index * 32) === quoteMint) {
      quoteAllowed = true;
    }
  }
  if (!quoteAllowed) {
    throw new InvalidAccountError({
      address: account,
      message: "Pool quote mint is not in the current LiquidAF whitelist",
    });
  }

  const count = view.getUint32(offset, true);
  offset += 4;

  if (count === 0 || offset + count * 22 + 35 > data.length) {
    throw new InvalidAccountError({
      address: account,
      message: "Truncated or empty LiquidAF fee tiers",
    });
  }

  const tiers: FeeTier[] = [];
  let previousEnd = 0n;

  for (let index = 0; index < count; index++) {
    const tier = {
      start: view.getBigUint64(offset, true),
      end: view.getBigUint64(offset + 8, true),
      lpBps: BigInt(view.getUint16(offset + 16, true)),
      protocolBps: BigInt(view.getUint16(offset + 18, true)),
      creatorBps: BigInt(view.getUint16(offset + 20, true)),
    };

    if (
      tier.start !== previousEnd ||
      tier.end <= tier.start ||
      tier.lpBps + tier.protocolBps + tier.creatorBps >= 10_000n
    ) {
      throw new InvalidAccountError({
        address: account,
        message:
          "LiquidAF fee tiers must be contiguous, increasing and below 100 percent",
      });
    }

    tiers.push(tier);
    previousEnd = tier.end;
    offset += 22;
  }

  const oracle = readAddress(data, offset);
  offset += 32;

  const pending = data[offset++];

  if (pending === 1) {
    offset += 32;
  } else if (pending !== 0) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid LiquidAF AMM pending-admin option",
    });
  }
  if (offset + 2 > data.length || data[offset] !== bump || data[offset + 1]! > 1) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid LiquidAF AMM configuration flags or bump",
    });
  }
  if (data[offset + 1] !== 0) {
    unsupported("paused", "LiquidAF AMM trading is paused");
  }

  const feeRecipient = Array.from({ length: 8 }, (_, index) =>
    readAddress(data, 40 + index * 32),
  ).find((key) => key !== SYSTEM_PROGRAM_ADDRESS && key !== request.owner);

  if (!feeRecipient) {
    unsupported(
      "self-fee-recipient",
      "No distinct LiquidAF protocol fee recipient is configured",
    );
  }

  return { tiers, oracle, feeRecipient };
}

async function resolve(request: SwapRequest, pool: Pool) {
  const {
    pool: expectedPool,
    baseVault,
    quoteVault,
    lpMint,
    observation,
    authority,
    authorityBump,
    globalConfig,
    configBump,
    cpiAuthority,
    buybackVault,
    shared,
  } = await getLiquidAfAmmPoolAddresses(
    pool.baseMint,
    pool.quoteMint,
    request.owner,
    pool.creator,
  );

  if (
    expectedPool !== request.pool ||
    baseVault !== pool.baseVault ||
    quoteVault !== pool.quoteVault ||
    lpMint !== pool.lpMint ||
    observation !== pool.observation ||
    authorityBump !== pool.authorityBump
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LiquidAF AMM PDA relationships or vault-authority bump do not match",
    });
  }

  const config = readConfig(request, globalConfig, configBump, pool.quoteMint);
  const [[protocolFeeVault], feeVaultTokenAccount] = await Promise.all([
    findLiquidAfAmmProtocolFeeVaultPda(config.feeRecipient, pool.quoteMint),
    getLiquidAfFeeVaultTokenAddress(
      shared.feeVault,
      pool.quoteMint,
      pool.quoteTokenProgram,
    ),
  ]);

  return {
    authority,
    globalConfig,
    cpiAuthority,
    buybackVault,
    shared,
    config,
    protocolFeeVault,
    feeVaultTokenAccount,
  };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  const resolved = await resolve(request, pool);
  const accounts: AccountRequirement[] = [
    { address: request.pool, role: "LiquidAF AMM pool" },
    { address: resolved.globalConfig, role: "LiquidAF AMM configuration" },
    { address: pool.baseMint, role: "base mint" },
    { address: pool.quoteMint, role: "quote mint" },
    { address: pool.baseVault, role: "base reserve vault" },
    { address: pool.quoteVault, role: "quote reserve vault" },
    { address: pool.observation, role: "pool observation" },
    { address: resolved.shared.feeConfig, role: "LiquidAF fee configuration" },
    { address: resolved.shared.feeVault, role: "creator fee authority" },
    { address: resolved.feeVaultTokenAccount, role: "creator fee token account" },
    { address: resolved.protocolFeeVault, role: "protocol fee token account" },
    { address: resolved.buybackVault, role: "buyback token vault" },
    { address: resolved.shared.userProperties, role: "user properties" },
    { address: resolved.shared.globalVolume, role: "global AMM volume" },
    { address: resolved.shared.tokenVolume, role: "token volume" },
    { address: resolved.shared.cashbackConfig, role: "cashback configuration" },
  ];
  accounts.push({ address: resolved.config.oracle, role: "SOL/USD Pyth price" });

  return accounts;
}

/**
 * Native fee shares use the complete tier, even in modes that waive the LP share.
 * The combined fee rounds up once; LP and creator shares floor and protocol gets dust.
 */
function feesFor(amount: bigint, tier: FeeTier, includeLp: boolean) {
  const rate = tier.lpBps + tier.creatorBps + tier.protocolBps;
  const tierTotal = ceilDiv(amount * rate, 10_000n);
  const tierLp = rate === 0n ? 0n : (tierTotal * tier.lpBps) / rate;
  const creator = rate === 0n ? 0n : (tierTotal * tier.creatorBps) / rate;
  const protocol = tierTotal - tierLp - creator;
  const lp = includeLp ? tierLp : 0n;

  return { total: lp + creator + protocol, lp, creator, protocol };
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const resolved = await resolve(request, pool);
  const baseMint = readMint(request.snapshot, pool.baseMint);
  const quoteMint = readMint(request.snapshot, pool.quoteMint);

  if (
    baseMint.tokenProgram !== pool.baseTokenProgram ||
    quoteMint.tokenProgram !== pool.quoteTokenProgram ||
    baseMint.decimals !== pool.baseDecimals ||
    quoteMint.decimals !== pool.quoteDecimals
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LiquidAF pool mint metadata does not match supplied mint accounts",
    });
  }

  const base = readTokenAccount(
    request.snapshot,
    pool.baseVault,
    pool.baseMint,
    pool.baseTokenProgram,
    resolved.authority,
  );
  const quote = readTokenAccount(
    request.snapshot,
    pool.quoteVault,
    pool.quoteMint,
    pool.quoteTokenProgram,
    resolved.authority,
  );
  const protocolVault = readTokenAccount(
    request.snapshot,
    resolved.protocolFeeVault,
    pool.quoteMint,
    pool.quoteTokenProgram,
    resolved.authority,
  );
  const creatorVault = readTokenAccount(
    request.snapshot,
    resolved.feeVaultTokenAccount,
    pool.quoteMint,
    pool.quoteTokenProgram,
    resolved.shared.feeVault,
  );
  readTokenAccount(
    request.snapshot,
    resolved.buybackVault,
    pool.quoteMint,
    pool.quoteTokenProgram,
    resolved.authority,
  );

  const feeAuthority = requireAccount(
    request.snapshot,
    resolved.shared.feeVault,
    "LiquidAF creator fee authority",
    SYSTEM_PROGRAM_ADDRESS,
  );

  if (feeAuthority.data.length !== 0) {
    throw new InvalidAccountError({
      address: feeAuthority.address,
      message: "LiquidAF fee authority must be a plain system account",
    });
  }
  if (
    [
      pool.baseVault,
      pool.quoteVault,
      resolved.protocolFeeVault,
      resolved.feeVaultTokenAccount,
      resolved.buybackVault,
    ].some(
      (account) => account === tokenAccounts.input || account === tokenAccounts.output,
    )
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "User accounts must differ from LiquidAF reserve and fee vaults",
    });
  }

  const observation = liquidAccount(
    request,
    pool.observation,
    LIQUID_AF_AMM_PROGRAM,
    [122, 174, 197, 53, 129, 9, 165, 132],
    4075,
    "LiquidAF observation state",
  );
  const observationView = accountDataView(observation.data);

  if (
    observation.data.length !== 4075 ||
    observation.data[8]! > 1 ||
    observationView.getUint16(9, true) >= 100 ||
    readAddress(observation.data, 11) !== request.pool ||
    observationView.getBigUint64(4043, true) > request.snapshot.unixTimestamp
  ) {
    throw new InvalidAccountError({
      address: pool.observation,
      message: "LiquidAF observation does not match its pool or supplied chain time",
    });
  }

  validateLiquidSharedState(
    request,
    "liquid-af-amm",
    resolved.shared,
    pool.creator,
    pool.baseMint,
    pool.quoteMint,
    true,
  );

  if (base.amount === 0n || quote.amount === 0n) {
    insufficient("LiquidAF AMM reserve vaults are exhausted");
  }

  const solPrice = readLiquidSolPrice(request, resolved.config.oracle);
  const marketCap =
    pool.quoteMint === WRAPPED_SOL_MINT
      ? (quote.amount * solPrice * baseMint.supply) / (1_000_000_000n * base.amount)
      : (quote.amount * baseMint.supply) / base.amount;
  const tier =
    resolved.config.tiers.find(
      (tier) => marketCap >= tier.start && marketCap < tier.end,
    ) ?? resolved.config.tiers[resolved.config.tiers.length - 1]!;
  const externalRate = tier.creatorBps + tier.protocolBps;
  const includeLp = !pool.buy && request.amount.kind === "exactIn";
  let amountIn: bigint;
  let amountOut: bigint;
  let feeBasis: bigint;

  if (request.amount.kind === "exactIn") {
    amountIn = request.amount.amountIn;

    if (pool.buy) {
      feeBasis = amountIn;

      const net = amountIn - feesFor(amountIn, tier, false).total;
      amountOut = (net * base.amount) / (quote.amount + net);
    } else {
      feeBasis = (amountIn * quote.amount) / (base.amount + amountIn);
      amountOut = feeBasis - feesFor(feeBasis, tier, true).total;
    }
  } else {
    amountOut = request.amount.amountOut;
    feeBasis = ceilDiv(amountOut * 10_000n, 10_000n - externalRate);

    if (feeBasis >= quote.amount) {
      insufficient("LiquidAF requested quote output exhausts its reserve");
    }

    amountIn = ceilDiv(feeBasis * base.amount, quote.amount - feeBasis);
  }

  const fees = feesFor(feeBasis, tier, includeLp);

  if (
    amountIn <= 0n ||
    amountOut <= 0n ||
    amountIn > U64_MAX ||
    amountOut > U64_MAX ||
    amountOut >= (pool.buy ? base.amount : quote.amount) ||
    (!pool.buy && amountOut + fees.creator + fees.protocol > quote.amount)
  ) {
    insufficient("LiquidAF AMM cannot produce a positive fully funded output");
  }
  if (
    (pool.buy ? quote.amount + amountIn : base.amount + amountIn) > U64_MAX ||
    protocolVault.amount + fees.protocol > U64_MAX ||
    creatorVault.amount + fees.creator > U64_MAX
  ) {
    insufficient("LiquidAF AMM swap would overflow a token vault");
  }

  const accounts: LiquidAfAmmSwapAccounts = {
    user: request.owner,
    pool: request.pool,
    userBaseAccount: pool.buy ? tokenAccounts.output : tokenAccounts.input,
    userQuoteAccount: pool.buy ? tokenAccounts.input : tokenAccounts.output,
    baseVault: pool.baseVault,
    quoteVault: pool.quoteVault,
    observationState: pool.observation,
    feeRecipient: resolved.config.feeRecipient,
    protocolFeeVault: resolved.protocolFeeVault,
    feeVault: resolved.shared.feeVault,
    feeVaultTokenAccount: resolved.feeVaultTokenAccount,
    buybackVault: resolved.buybackVault,
    authority: resolved.authority,
    globalConfig: resolved.globalConfig,
    creator: pool.creator,
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    feeConfig: resolved.shared.feeConfig,
    userProperties: resolved.shared.userProperties,
    globalAmmVolume: resolved.shared.globalVolume,
    tokenVolume: resolved.shared.tokenVolume,
    cashbackConfig: resolved.shared.cashbackConfig,
    stateEventsCpiAuthority: resolved.shared.stateEventsCpiAuthority,
    baseTokenProgram: pool.baseTokenProgram,
    quoteTokenProgram: pool.quoteTokenProgram,
    cpiAuthority: resolved.cpiAuthority,
    oraclePriceFeed: resolved.config.oracle,
  };
  const feeAmounts = [
    { kind: "trade" as const, mint: pool.quoteMint, amount: fees.protocol + fees.lp },
    { kind: "creator" as const, mint: pool.quoteMint, amount: fees.creator },
  ];

  if (request.amount.kind === "exactOut") {
    const maximumAmountIn = maximumInput(amountIn, request.slippageBps);
    const args = { amountOut, maximumAmountIn };
    const instruction = sell_exact_out(accounts, args);

    return {
      instructions: [instruction],
      quote: {
        kind: "exactOut",
        amountOut,
        maximumAmountIn,
        expectedAmountIn: amountIn,
        expectedAmountOut: amountOut,
        fees: feeAmounts,
      },
      mayPartiallyFill: false,
    };
  }

  const minimumAmountOut = minimumOutput(amountOut, request.slippageBps);
  const args = { amountIn, minimumAmountOut };
  const instruction = pool.buy
    ? buy_exact_in(accounts, args)
    : sell_exact_in(accounts, args);

  return {
    instructions: [instruction],
    quote: {
      kind: "exactIn",
      amountIn,
      minimumAmountOut,
      expectedAmountIn: amountIn,
      expectedAmountOut: amountOut,
      fees: feeAmounts,
    },
    mayPartiallyFill: false,
  };
}

/**
 * Offline LiquidAF AMM exact-input buys/sells and native exact-output sells.
 * @remarks Qualified quote mints are USDC and wrapped SOL; base mints may use classic SPL
 * Token or supported Token-2022 metadata extensions. Recipient fees, non-referred users
 * and earning-mode cashback are supported. All fees are in quote units. The deployed
 * program retains the LP share only for sell exact-input. All modes split fees using
 * the complete tier before waiving the LP share for other modes. Trade fees combine retained LP fees and transferred protocol fees.
 * Buy exact-output is rejected because native integer rounding can underfill its target.
 * Tiered-fee instructions require caller-supplied, fully verified SOL/USD data at most
 * 30 seconds old, including USDC pools whose price conversion does not use SOL.
 */
export const liquidAfAmmAdapter: ProtocolAdapter = {
  id: "liquid-af-amm",
  programAddresses: [LIQUID_AF_AMM_PROGRAM],
  requirements,
  build,
};
