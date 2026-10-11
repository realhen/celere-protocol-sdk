import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import { InsufficientLiquidityError, UnsupportedSwapModeError } from "../errors";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import type { Address } from "@solana/kit";
import {
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
import { LIQUID_AF_PROGRAM } from "./constants";
import {
  buy_exact_in_native,
  sell_exact_in_native,
  sell_exact_out_native,
  type LiquidAfNativeSwapAccounts,
} from "./instructions/index";
import {
  liquidAccount,
  readLiquidSolPrice,
  unsupportedLiquidFeature,
  validateLiquidSharedState,
} from "./shared-state";
import { getLiquidAfCurveAddresses } from "./pda";
export * from "./pda";
export * from "./constants";

interface Curve {
  readonly creator: Address;
  readonly mint: Address;
  readonly realTokenReserves: bigint;
  readonly virtualTokenReserves: bigint;
  readonly realQuoteReserves: bigint;
  readonly virtualQuoteReserves: bigint;
  readonly totalSupply: bigint;
  readonly bump: number;
  readonly buy: boolean;
}

function insufficient(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "liquid-af", message });
}

function readCurve(request: SwapRequest): Curve {
  const { data } = liquidAccount(
    request,
    request.pool,
    LIQUID_AF_PROGRAM,
    [23, 183, 248, 55, 96, 216, 172, 96],
    73,
    "LiquidAF bonding curve",
  );

  if (data[72] === 1) {
    unsupportedLiquidFeature(
      "liquid-af",
      "stable-curve",
      "Only LiquidAF native SOL curves are currently qualified",
    );
  }
  if (data[72] !== 0 || data.length !== 147) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LiquidAF native curve layout",
    });
  }
  if (data[113]! > 2) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LiquidAF lifecycle state",
    });
  }
  if (data[113] !== 0) {
    unsupportedLiquidFeature(
      "liquid-af",
      "completed-curve",
      "Completed or migrated LiquidAF curves cannot be traded",
    );
  }

  const view = accountDataView(data);
  const mint = readAddress(data, 40);
  const buy = request.inputMint === WRAPPED_SOL_MINT;

  if (
    buy
      ? request.outputMint !== mint
      : request.inputMint !== mint || request.outputMint !== WRAPPED_SOL_MINT
  ) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "LiquidAF native curves require the pool mint and native SOL",
    });
  }
  if (buy && request.amount.kind === "exactOut") {
    throw new UnsupportedSwapModeError({
      protocol: "liquid-af",
      mode: "exactOut",
      message:
        "LiquidAF native buy_exact_out can clip the requested output at graduation and cannot guarantee exact output",
    });
  }

  const realQuoteReserves = view.getBigUint64(89, true);
  const curve = {
    creator: readAddress(data, 8),
    mint,
    realTokenReserves: view.getBigUint64(73, true),
    virtualTokenReserves: view.getBigUint64(81, true),
    realQuoteReserves,
    virtualQuoteReserves: realQuoteReserves + view.getBigUint64(97, true),
    totalSupply: view.getBigUint64(105, true),
    bump: data[114]!,
    buy,
  };

  if (
    curve.virtualQuoteReserves === 0n ||
    curve.virtualQuoteReserves > U64_MAX ||
    curve.virtualTokenReserves === 0n ||
    curve.realTokenReserves > curve.virtualTokenReserves ||
    curve.realTokenReserves > curve.totalSupply
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LiquidAF virtual or real reserves",
    });
  }

  return curve;
}

function readGlobal(request: SwapRequest, account: Address, expectedBump: number) {
  const { data } = liquidAccount(
    request,
    account,
    LIQUID_AF_PROGRAM,
    [57, 102, 31, 49, 69, 215, 13, 20],
    383,
    "LiquidAF global configuration",
  );
  const view = accountDataView(data);
  const creatorBps = BigInt(view.getUint16(80, true));
  const protocolBps = BigInt(view.getUint16(86, true));

  if (
    creatorBps + protocolBps >= 10_000n ||
    view.getUint16(82, true) > 10_000 ||
    view.getUint16(84, true) > 10_000
  ) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid LiquidAF fee basis points",
    });
  }

  let offset = 380 + view.getUint32(376, true) * 32;

  if (offset >= data.length) {
    throw new InvalidAccountError({
      address: account,
      message: "Truncated LiquidAF quote-mint list",
    });
  }

  const pendingAdmin = data[offset++];

  if (pendingAdmin === 1) {
    offset += 32;
  } else if (pendingAdmin !== 0) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid LiquidAF pending-admin option",
    });
  }
  if (
    offset + 2 > data.length ||
    data[offset]! > 1 ||
    data[offset + 1] !== expectedBump
  ) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid LiquidAF global flags or PDA bump",
    });
  }
  if (data[offset] !== 0) {
    unsupportedLiquidFeature("liquid-af", "paused", "LiquidAF trading is paused");
  }

  const recipients = Array.from({ length: 8 }, (_, index) =>
    readAddress(data, 88 + index * 32),
  );
  const feeRecipient = recipients.find(
    (recipient) => recipient !== SYSTEM_PROGRAM_ADDRESS && recipient !== request.owner,
  );

  if (!feeRecipient) {
    unsupportedLiquidFeature(
      "liquid-af",
      "self-fee-recipient",
      "No distinct configured protocol fee recipient is available",
    );
  }

  return {
    creatorBps,
    protocolBps,
    feeRecipient,
    pythPriceFeed: readAddress(data, 344),
  };
}

async function resolve(request: SwapRequest, curve: Curve) {
  const {
    pool,
    bump,
    globalConfig,
    configBump,
    solVault,
    buybackVault,
    cpiAuthority,
    tokenVault,
    shared,
  } = await getLiquidAfCurveAddresses(curve.mint, request.owner, curve.creator);

  if (pool !== request.pool || bump !== curve.bump) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid LiquidAF curve PDA or bump",
    });
  }

  const config = readGlobal(request, globalConfig, configBump);

  return {
    globalConfig,
    solVault,
    buybackVault,
    cpiAuthority,
    tokenVault,
    shared,
    config,
  };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const curve = readCurve(request);
  const resolved = await resolve(request, curve);

  return [
    { address: request.pool, role: "LiquidAF curve" },
    { address: resolved.globalConfig, role: "LiquidAF global configuration" },
    { address: curve.mint, role: "Token-2022 base mint" },
    { address: resolved.solVault, role: "native SOL reserve vault" },
    { address: resolved.tokenVault, role: "base reserve vault" },
    { address: resolved.shared.feeConfig, role: "LiquidAF fee configuration" },
    { address: resolved.shared.feeVault, role: "creator fee vault" },
    { address: resolved.config.feeRecipient, role: "protocol fee recipient" },
    { address: resolved.buybackVault, role: "buyback vault" },
    { address: resolved.shared.creatorUserProperties, role: "creator properties" },
    { address: resolved.shared.userProperties, role: "user properties" },
    { address: resolved.shared.globalVolume, role: "global curve volume" },
    { address: resolved.shared.tokenVolume, role: "token volume" },
    { address: resolved.shared.cashbackConfig, role: "cashback configuration" },
    { address: resolved.config.pythPriceFeed, role: "SOL/USD Pyth price" },
  ];
}

function curveFees(amount: bigint, creatorBps: bigint, protocolBps: bigint) {
  const rate = creatorBps + protocolBps;
  const total = ceilDiv(amount * rate, 10_000n);
  const creator = rate === 0n ? 0n : (total * creatorBps) / rate;

  return { total, creator, protocol: total - creator };
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const curve = readCurve(request);
  const resolved = await resolve(request, curve);
  const mint = readMint(request.snapshot, curve.mint);

  if (mint.tokenProgram !== TOKEN_2022_PROGRAM) {
    unsupportedLiquidFeature(
      "liquid-af",
      "classic-base-mint",
      "LiquidAF native curve base mints must use Token-2022",
    );
  }

  const vault = readTokenAccount(
    request.snapshot,
    resolved.tokenVault,
    curve.mint,
    TOKEN_2022_PROGRAM,
    request.pool,
  );
  const solVault = requireAccount(
    request.snapshot,
    resolved.solVault,
    "LiquidAF SOL vault",
    SYSTEM_PROGRAM_ADDRESS,
  );

  if (
    solVault.data.length !== 0 ||
    solVault.lamports < curve.realQuoteReserves + 890_880n ||
    vault.amount < curve.realTokenReserves
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "LiquidAF recorded reserves exceed spendable vault balances",
    });
  }
  for (const account of [
    resolved.shared.feeVault,
    resolved.config.feeRecipient,
    resolved.buybackVault,
  ]) {
    const observation = requireAccount(
      request.snapshot,
      account,
      "LiquidAF native fee destination",
      SYSTEM_PROGRAM_ADDRESS,
    );

    if (observation.data.length !== 0) {
      throw new InvalidAccountError({
        address: account,
        message: "LiquidAF native fee destinations must be plain system accounts",
      });
    }
  }
  if (
    resolved.tokenVault === tokenAccounts.input ||
    resolved.tokenVault === tokenAccounts.output
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "User token accounts must differ from LiquidAF reserve vaults",
    });
  }

  validateLiquidSharedState(
    request,
    "liquid-af",
    resolved.shared,
    curve.creator,
    curve.mint,
    WRAPPED_SOL_MINT,
    false,
  );
  readLiquidSolPrice(request, resolved.config.pythPriceFeed);

  const rate = resolved.config.creatorBps + resolved.config.protocolBps;
  let amountIn: bigint;
  let amountOut: bigint;
  let grossQuote: bigint;

  if (request.amount.kind === "exactIn") {
    amountIn = request.amount.amountIn;

    if (curve.buy) {
      const net =
        amountIn -
        curveFees(amountIn, resolved.config.creatorBps, resolved.config.protocolBps)
          .total;
      amountOut = (net * curve.virtualTokenReserves) / (curve.virtualQuoteReserves + net);

      if (amountOut >= curve.realTokenReserves && curve.realTokenReserves > 0n) {
        amountOut = curve.realTokenReserves;

        if (amountOut >= curve.virtualTokenReserves) {
          insufficient("LiquidAF graduation would exhaust the virtual curve");
        }

        const requiredNet = ceilDiv(
          amountOut * curve.virtualQuoteReserves,
          curve.virtualTokenReserves - amountOut,
        );
        amountIn = ceilDiv(requiredNet * 10_000n, 10_000n - rate);
      }

      grossQuote = amountIn;
    } else {
      grossQuote =
        (amountIn * curve.virtualQuoteReserves) / (curve.virtualTokenReserves + amountIn);
      amountOut =
        grossQuote -
        curveFees(grossQuote, resolved.config.creatorBps, resolved.config.protocolBps)
          .total;
    }
  } else {
    amountOut = request.amount.amountOut;
    grossQuote = ceilDiv(amountOut * 10_000n, 10_000n - rate);

    if (grossQuote >= curve.virtualQuoteReserves) {
      insufficient("LiquidAF requested output exceeds virtual quote reserves");
    }

    amountIn = ceilDiv(
      grossQuote * curve.virtualTokenReserves,
      curve.virtualQuoteReserves - grossQuote,
    );
  }

  const fees = curveFees(
    grossQuote,
    resolved.config.creatorBps,
    resolved.config.protocolBps,
  );

  if (
    amountIn <= 0n ||
    amountOut <= 0n ||
    amountIn > U64_MAX ||
    amountOut > U64_MAX ||
    (curve.buy
      ? amountOut > curve.realTokenReserves
      : grossQuote > curve.realQuoteReserves)
  ) {
    insufficient("LiquidAF reserves cannot fund the requested swap");
  }
  if (
    curve.buy
      ? solVault.lamports + amountIn - fees.total > U64_MAX
      : vault.amount + amountIn > U64_MAX ||
        curve.virtualTokenReserves + amountIn > U64_MAX
  ) {
    insufficient("LiquidAF swap would overflow native reserve arithmetic");
  }

  const accounts: LiquidAfNativeSwapAccounts = {
    user: request.owner,
    feeRecipient: resolved.config.feeRecipient,
    bondingCurve: request.pool,
    bondingCurveSolVault: resolved.solVault,
    bondingCurveTokenAccount: resolved.tokenVault,
    userTokenAccount: curve.buy ? tokenAccounts.output : tokenAccounts.input,
    feeVault: resolved.shared.feeVault,
    buybackVault: resolved.buybackVault,
    globalConfig: resolved.globalConfig,
    mint: curve.mint,
    feeConfig: resolved.shared.feeConfig,
    creatorUserProperties: resolved.shared.creatorUserProperties,
    userProperties: resolved.shared.userProperties,
    globalCurveVolume: resolved.shared.globalVolume,
    tokenVolume: resolved.shared.tokenVolume,
    cashbackConfig: resolved.shared.cashbackConfig,
    stateEventsCpiAuthority: resolved.shared.stateEventsCpiAuthority,
    pythPriceFeed: resolved.config.pythPriceFeed,
    cpiAuthority: resolved.cpiAuthority,
  };
  const feeAmounts = [
    { kind: "trade" as const, mint: WRAPPED_SOL_MINT, amount: fees.protocol },
    { kind: "creator" as const, mint: WRAPPED_SOL_MINT, amount: fees.creator },
  ];

  if (request.amount.kind === "exactOut") {
    const maximumAmountIn = maximumInput(amountIn, request.slippageBps);

    return {
      instructions: [
        sell_exact_out_native(accounts, {
          amountOut,
          maximumAmountIn,
        }),
      ],
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
  const args = { amountIn: request.amount.amountIn, minimumAmountOut };
  const instruction = curve.buy
    ? buy_exact_in_native(accounts, args)
    : sell_exact_in_native(accounts, args);

  return {
    instructions: [instruction],
    quote: {
      kind: "exactIn",
      amountIn: request.amount.amountIn,
      minimumAmountOut,
      expectedAmountIn: amountIn,
      expectedAmountOut: amountOut,
      fees: feeAmounts,
    },
    mayPartiallyFill: curve.buy,
  };
}

/**
 * Offline LiquidAF native SOL curves with recipient fees and non-referred, earning-mode users.
 * @remarks Buys require allowPartial: graduation can reduce both input debit and output.
 * Native buy exact output is rejected because it clips rather than guaranteeing the requested
 * output. Sells support native exact input and exact output. Stable curves, revoked fees,
 * referrals and cashback spending are not qualified. Caller-supplied SOL/USD data must be
 * fully verified and no more than 30 seconds old at the supplied chain time.
 */
export const liquidAfAdapter: ProtocolAdapter = {
  id: "liquid-af",
  programAddresses: [LIQUID_AF_PROGRAM],
  requirements,
  build,
  tokenAccountKinds(request) {
    const curve = readCurve(request);

    return curve.buy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
};
