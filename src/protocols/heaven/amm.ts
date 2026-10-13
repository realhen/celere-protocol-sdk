import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import {
  UnsupportedPoolFeatureError,
  InsufficientLiquidityError,
  UnsupportedSwapModeError,
} from "../errors";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Address } from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../accounts/tokens";
import { assertAmount, minimumOutput } from "../amounts";

import { requireAccount } from "../accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  SwapRequest,
} from "../types";
import type { ResolvedTokenAccounts } from "../accounts/plan";
import { accountDataView, readAddress, matchesDiscriminator } from "../accounts/bytes";
import { HEAVEN_PROGRAM } from "./constants";
import * as instructions from "./instructions/index";
import {
  getHeavenTokenVaultAddress,
  findHeavenProtocolConfigPda,
  getHeavenPoolAddress,
} from "./pda";
export * from "./pda";
export * from "./constants";

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "heaven",
    feature,
    message: `Heaven ${feature} is not qualified`,
  });
}

function exhausted(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "heaven", message });
}

function direction(request: SwapRequest) {
  const buy = request.inputMint === WRAPPED_SOL_MINT;

  if (buy === (request.outputMint === WRAPPED_SOL_MINT)) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Heaven requires one wrapped SOL side",
    });
  }

  return { buy, mint: buy ? request.outputMint : request.inputMint };
}

function decodeState(
  request: SwapRequest,
  address: Address,
  size: number,
  discriminator: readonly number[],
) {
  const account = requireAccount(
    request.snapshot,
    address,
    "Heaven state",
    HEAVEN_PROGRAM,
  );

  if (
    account.data.length !== size ||
    !matchesDiscriminator(account.data, discriminator)
  ) {
    throw new InvalidAccountError({
      address: address,
      message: "Invalid Heaven account size or discriminator",
    });
  }

  const bytes = account.data;
  const view = accountDataView(bytes);

  return {
    bytes,
    view,
  };
}

function poolState(request: SwapRequest) {
  return decodeState(
    request,
    request.pool,
    2304,
    [190, 158, 220, 130, 15, 162, 132, 252],
  );
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const { mint } = direction(request);
  const pool = poolState(request);

  return [
    { address: request.pool, role: "Heaven pool" },
    { address: readAddress(pool.bytes, 728), role: "Heaven protocol configuration" },
    { address: readAddress(pool.bytes, 664), role: "Heaven token vault" },
    { address: readAddress(pool.bytes, 696), role: "Heaven wrapped SOL vault" },
    { address: mint, role: "Heaven token mint" },
    { address: WRAPPED_SOL_MINT, role: "Heaven wrapped SOL mint" },
  ];
}

function constantFee(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  buy: boolean,
): bigint {
  const count = bytes[offset + 64]!;

  if (count === 0) {
    if (bytes.subarray(offset, offset + 64).some((byte) => byte !== 0)) {
      unsupported("inactive fee brackets with data");
    }

    return 0n;
  }
  if (count !== 1 || view.getBigUint64(offset, true) !== U64_MAX) {
    unsupported("market-cap fee tiers");
  }

  const fee = BigInt(view.getUint32(offset + (buy ? 8 : 12), true));

  if (fee >= 10_000n) {
    unsupported("fee at or above 100 percent");
  }

  return fee;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  if (request.amount.kind !== "exactIn") {
    throw new UnsupportedSwapModeError({
      protocol: "heaven",
      mode: request.amount.kind,
      message: "Heaven exposes native exact-input swaps only",
    });
  }

  const { buy, mint } = direction(request);
  const pool = poolState(request);
  const configKey = readAddress(pool.bytes, 728);
  const config = decodeState(
    request,
    configKey,
    1792,
    [207, 91, 250, 28, 152, 179, 215, 209],
  );
  const version = pool.view.getUint16(88, true);

  if (version !== 1 && version !== 2) {
    unsupported(`configuration version ${version}`);
  }

  const [expectedConfig, bump] = await findHeavenProtocolConfigPda(version);
  const expectedPool = await getHeavenPoolAddress(mint, WRAPPED_SOL_MINT);

  if (
    expectedConfig !== configKey ||
    expectedPool !== request.pool ||
    readAddress(pool.bytes, 760) !== request.pool ||
    pool.bytes[91] !== bump ||
    config.view.getUint16(452, true) !== version
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Heaven pool/configuration PDA or authority mismatch",
    });
  }
  if (pool.bytes[90] !== 2) {
    unsupported("nonstandard pools");
  }
  if (
    pool.bytes[922] !== 1 ||
    pool.view.getBigUint64(72, true) > request.snapshot.unixTimestamp
  ) {
    unsupported("closed swaps");
  }
  if (pool.bytes[929] !== 0 || config.bytes[460] !== 0) {
    unsupported("sandwich resistance");
  }
  if (config.bytes[458] !== 0) {
    unsupported("automatic staking");
  }
  if (pool.bytes[937] !== 2 || pool.bytes[938] !== 0) {
    unsupported("non-quote fee taxation");
  }
  if (
    pool.bytes[939] !== 1 ||
    pool.bytes[940] !== 2 ||
    pool.view.getFloat64(648, true) !== 0 ||
    config.view.getFloat64(80, true) !== 0
  ) {
    unsupported("conditional creator fees");
  }
  if (pool.bytes[942]! > 1) {
    unsupported("migration state");
  }
  if (config.view.getBigUint64(72, true) !== U64_MAX) {
    unsupported("wallet supply limits");
  }
  if (
    pool.bytes.subarray(956, 2272).some((byte) => byte !== 0) ||
    config.bytes.subarray(476, 1792).some((byte) => byte !== 0)
  ) {
    unsupported("slot-based fees");
  }

  const feeMode = pool.bytes[941]!;

  if (feeMode > 1) {
    unsupported("fee configuration mode");
  }

  const feeState = feeMode === 1 ? pool : config;
  const feeStart = feeMode === 1 ? 96 : 88;
  const protocolBps = constantFee(feeState.bytes, feeState.view, feeStart, buy);
  const creatorBps = constantFee(feeState.bytes, feeState.view, feeStart + 144, buy);

  for (const offset of [72, 216, 288]) {
    if (constantFee(feeState.bytes, feeState.view, feeStart + offset, buy) !== 0n) {
      unsupported("LP, creator-protocol, or reflection fees");
    }
  }
  if (protocolBps + creatorBps >= 10_000n) {
    throw new InvalidAccountError({
      address: configKey,
      message: "Heaven aggregate fees must be below 100 percent",
    });
  }
  for (const [offset, expected, decimals] of [
    [792, mint, 824],
    [857, WRAPPED_SOL_MINT, 889],
  ] as const) {
    const info = readMint(request.snapshot, expected);

    if (info.tokenProgram !== TOKEN_PROGRAM_ADDRESS) {
      unsupported("Token-2022");
    }
    if (
      readAddress(pool.bytes, offset) !== expected ||
      readAddress(pool.bytes, offset + 33) !== info.tokenProgram ||
      pool.bytes[decimals] !== info.decimals
    ) {
      throw new InvalidAccountError({
        address: request.pool,
        message: "Heaven mint/program/decimal mismatch",
      });
    }
  }

  const vaultA = readAddress(pool.bytes, 664);
  const vaultB = readAddress(pool.bytes, 696);

  if (
    vaultA !== (await getHeavenTokenVaultAddress(configKey, mint)) ||
    vaultB !== (await getHeavenTokenVaultAddress(configKey, WRAPPED_SOL_MINT))
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Heaven vault PDA mismatch",
    });
  }

  const tokenVault = readTokenAccount(
    request.snapshot,
    vaultA,
    mint,
    TOKEN_PROGRAM_ADDRESS,
    configKey,
  );
  const solVault = readTokenAccount(
    request.snapshot,
    vaultB,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ADDRESS,
    configKey,
  );
  const reserveA = pool.view.getBigUint64(456, true);
  const reserveB = pool.view.getBigUint64(464, true);
  const amountIn = request.amount.amountIn;

  if (reserveA === 0n || reserveB === 0n) {
    exhausted("Heaven reserves are empty");
  }

  const grossSol = buy ? amountIn : (amountIn * reserveB) / (reserveA + amountIn);
  const protocolFee = (grossSol * protocolBps) / 10_000n;
  const creatorFee = (grossSol * creatorBps) / 10_000n;
  const netSol = grossSol - protocolFee - creatorFee;
  const amountOut = buy ? (netSol * reserveA) / (reserveB + netSol) : netSol;
  assertAmount(amountOut, "expectedAmountOut");

  if (
    buy
      ? amountOut > tokenVault.amount
      : grossSol > solVault.amount || grossSol > config.view.getBigUint64(32, true)
  ) {
    exhausted("Heaven real vault or unstaked SOL reserves are insufficient");
  }
  if (
    (buy ? reserveB + netSol : reserveA + amountIn) > U64_MAX ||
    pool.view.getBigUint64(576, true) + protocolFee > U64_MAX ||
    pool.view.getBigUint64(584, true) + creatorFee > U64_MAX ||
    (buy && config.view.getBigUint64(32, true) + amountIn > U64_MAX)
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Heaven reserve or accrued fees would overflow u64",
    });
  }

  const minimumAmountOut = minimumOutput(amountOut, request.slippageBps);
  const nativeAccounts = {
    tokenAProgram: TOKEN_PROGRAM_ADDRESS,
    tokenBProgram: TOKEN_PROGRAM_ADDRESS,
    pool: request.pool,
    user: request.owner,
    tokenAMint: mint,
    tokenBMint: WRAPPED_SOL_MINT,
    userTokenA: buy ? accounts.output : accounts.input,
    userTokenB: buy ? accounts.input : accounts.output,
    tokenAVault: vaultA,
    tokenBVault: vaultB,
    protocolConfig: configKey,
  };
  const instruction = buy
    ? instructions.buy(nativeAccounts, {
        maximumSolSpend: amountIn,
        minimumAmountOut,
      })
    : instructions.sell(nativeAccounts, { amountIn, minimumAmountOut });

  return {
    instructions: [instruction],
    mayPartiallyFill: false,
    quote: {
      kind: "exactIn",
      amountIn,
      expectedAmountIn: amountIn,
      expectedAmountOut: amountOut,
      minimumAmountOut,
      fees: [
        { kind: "trade", mint: WRAPPED_SOL_MINT, amount: protocolFee },
        { kind: "creator", mint: WRAPPED_SOL_MINT, amount: creatorFee },
      ],
    },
  };
}

/** Offline Heaven standard-pool swaps with constant quote-denominated protocol/creator fees.
 * @remarks Native exact input only. Uses existing SPL/WSOL accounts. Tiered/slot fees,
 * staking, reflection, Token-2022 and conditional creator fees are explicitly rejected.
 */
export const heavenAdapter: ProtocolAdapter = {
  id: "heaven",
  programAddresses: [HEAVEN_PROGRAM],
  requirements,
  build,
};
