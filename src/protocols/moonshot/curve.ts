import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import { UnsupportedPoolFeatureError, InsufficientLiquidityError } from "../errors";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Address, Instruction } from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../accounts/tokens";
import { assertAmount, maximumInput, minimumOutput } from "../amounts";

import { requireAccount } from "../accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapQuote,
  SwapRequest,
} from "../types";

import { accountDataView, readAddress, matchesDiscriminator } from "../accounts/bytes";
import { MOONSHOT_PROGRAM } from "./constants";
import * as instructions from "./instructions/index";
import {
  getMoonshotTokenVaultAddress,
  getMoonshotUserTokenAddress,
  getMoonshotCurveAddresses,
} from "./pda";
export * from "./pda";
export { MOONSHOT_PROGRAM } from "./constants";

const TOTAL_SUPPLY = 1_000_000_000_000_000_000n;

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "moonshot",
    feature,
    message: `Moonshot ${feature} is not qualified`,
  });
}

function exhausted(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "moonshot", message });
}

function direction(request: SwapRequest) {
  const buy = request.inputMint === WRAPPED_SOL_MINT;

  if (buy === (request.outputMint === WRAPPED_SOL_MINT)) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Moonshot requires exactly one native SOL side",
    });
  }

  return { buy, mint: buy ? request.outputMint : request.inputMint };
}

function data(
  request: SwapRequest,
  key: Address,
  size: number,
  discriminator: readonly number[],
) {
  const account = requireAccount(
    request.snapshot,
    key,
    "Moonshot state",
    MOONSHOT_PROGRAM,
  );

  if (account.data.length < size || !matchesDiscriminator(account.data, discriminator)) {
    throw new InvalidAccountError({
      address: key,
      message: "Invalid Moonshot state size or discriminator",
    });
  }
  if (account.data.subarray(size).some((byte) => byte !== 0)) {
    unsupported("nonzero state extension");
  }
  if (account.lamports > U64_MAX) {
    throw new InvalidAccountError({
      address: key,
      message: "Moonshot lamports exceed u64",
    });
  }

  return {
    account,
    bytes: account.data,
    view: accountDataView(account.data),
  };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const { mint } = direction(request);
  const observation = request.snapshot.accounts[mint];

  if (observation && observation.owner !== TOKEN_PROGRAM_ADDRESS) {
    unsupported("Token-2022 or other token program");
  }

  const { config } = await getMoonshotCurveAddresses(mint);
  const result: AccountRequirement[] = [
    { address: request.owner, role: "Moonshot native SOL owner" },
    { address: request.pool, role: "Moonshot curve" },
    { address: config, role: "Moonshot configuration" },
    { address: mint, role: "Moonshot mint" },
    {
      address: await getMoonshotTokenVaultAddress(request.pool, mint),
      role: "Moonshot token vault",
    },
  ];

  if (request.snapshot.accounts[config]) {
    const configuration = data(
      request,
      config,
      227,
      [189, 255, 97, 70, 186, 189, 24, 102],
    );
    result.push(
      {
        address: readAddress(configuration.bytes, 104),
        role: "Moonshot Helio fee recipient",
      },
      {
        address: readAddress(configuration.bytes, 136),
        role: "Moonshot DEX fee recipient",
      },
    );
  }

  return result;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const { buy, mint } = direction(request);
  const keys = await getMoonshotCurveAddresses(mint);

  if (keys.curve !== request.pool) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Moonshot curve PDA does not match mint",
    });
  }

  const curve = data(request, request.pool, 84, [8, 91, 83, 28, 132, 216, 248, 22]);
  const config = data(request, keys.config, 227, [189, 255, 97, 70, 186, 189, 24, 102]);

  if (
    readAddress(curve.bytes, 24) !== mint ||
    curve.bytes[80] !== keys.curveBump ||
    config.bytes[206] !== keys.configBump
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Moonshot mint or PDA bump mismatch",
    });
  }

  const curveType = curve.bytes[58]!;

  if (curveType !== 1 && curveType !== 2) {
    unsupported(`curve type ${curveType}`);
  }
  if (curve.bytes[57] !== 0 || curve.bytes[67] !== 0) {
    unsupported("non-SOL currency");
  }
  if (curve.bytes[81]! > 1) {
    unsupported("migration target");
  }
  if (curve.view.getUint16(82, true) !== 0) {
    unsupported("constant product price increase");
  }

  const mintInfo = readMint(request.snapshot, mint);

  if (mintInfo.tokenProgram !== TOKEN_PROGRAM_ADDRESS) {
    unsupported("Token-2022");
  }
  if (
    curve.bytes[56] !== 9 ||
    mintInfo.decimals !== 9 ||
    curve.view.getBigUint64(8, true) !== TOTAL_SUPPLY ||
    mintInfo.supply !== TOTAL_SUPPLY
  ) {
    throw new InvalidAccountError({
      address: mint,
      message: "Constant product curves require nine decimals and one billion tokens",
    });
  }

  const remaining = curve.view.getBigUint64(16, true);

  if (remaining > TOTAL_SUPPLY) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Curve amount exceeds total supply",
    });
  }

  const position = TOTAL_SUPPLY - remaining;
  const virtualTokens =
    (curveType === 1 ? 1_073_000_000_000_000_000n : 1_060_000_000_000_000_000n) -
    position;
  const constantProduct =
    curveType === 1
      ? 1_073_000_000_000_000_000n * 30_000_000_000n
      : 1_060_000_000_000_000_000n * 14_000_000_000n;
  const virtualSol = constantProduct / virtualTokens;
  const threshold = curve.view.getBigUint64(59, true);

  if (threshold === 0n) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Moonshot market-cap threshold must be positive",
    });
  }
  if ((virtualSol * position) / virtualTokens >= threshold) {
    exhausted("Moonshot migration threshold has been reached");
  }

  const feeBps = BigInt(config.view.getUint16(168, true));

  if (feeBps >= 10_000n || config.bytes[170]! > 100) {
    throw new InvalidAccountError({
      address: keys.config,
      message: "Invalid Moonshot fee configuration",
    });
  }

  const vault = await getMoonshotTokenVaultAddress(request.pool, mint);
  const vaultState = readTokenAccount(
    request.snapshot,
    vault,
    mint,
    TOKEN_PROGRAM_ADDRESS,
    request.pool,
  );

  if (vaultState.amount < remaining) {
    throw new InvalidAccountError({
      address: vault,
      message: "Moonshot token vault is below the curve amount",
    });
  }

  const dexFee = readAddress(config.bytes, 136);
  const helioFee = readAddress(config.bytes, 104);

  if (
    dexFee === helioFee ||
    [dexFee, helioFee].some((recipient) =>
      [request.owner, request.pool, vault, mint, keys.config].includes(recipient),
    )
  ) {
    unsupported("aliased fee recipients");
  }

  const ownerState = requireAccount(
    request.snapshot,
    request.owner,
    "Moonshot native SOL owner",
    SYSTEM_PROGRAM_ADDRESS,
  );
  const dexState = requireAccount(
    request.snapshot,
    dexFee,
    "Moonshot DEX recipient",
    SYSTEM_PROGRAM_ADDRESS,
  );
  const helioState = requireAccount(
    request.snapshot,
    helioFee,
    "Moonshot Helio recipient",
    SYSTEM_PROGRAM_ADDRESS,
  );

  if (
    [ownerState, dexState, helioState].some(
      (account) => account.data.length !== 0 || account.lamports > U64_MAX,
    )
  ) {
    throw new InvalidAccountError({
      address: keys.config,
      message:
        "Moonshot owner and fee recipients must be plain system accounts with u64 lamports",
    });
  }

  const userToken = buy ? accounts.output : accounts.input;

  if (userToken !== (await getMoonshotUserTokenAddress(request.owner, mint))) {
    throw new InvalidRequestError({
      field: "tokenAccounts",
      message: "Moonshot requires the owner's associated token account",
    });
  }

  let tokenAmount: bigint;
  let collateralAmount: bigint;
  let fee: bigint;

  if (request.amount.kind === "exactIn") {
    if (buy) {
      collateralAmount = request.amount.amountIn;
      fee = (collateralAmount * feeBps) / 10_000n;
      tokenAmount =
        virtualTokens - constantProduct / (virtualSol + collateralAmount - fee);
    } else {
      tokenAmount = request.amount.amountIn;

      const gross = virtualSol - constantProduct / (virtualTokens + tokenAmount);
      fee = (gross * feeBps) / 10_000n;
      collateralAmount = gross - fee;
    }
  } else if (buy) {
    tokenAmount = request.amount.amountOut;

    if (tokenAmount >= virtualTokens) {
      exhausted("Requested tokens exceed virtual reserves");
    }

    const net = constantProduct / (virtualTokens - tokenAmount) - virtualSol;
    fee = (net * feeBps) / 10_000n;
    collateralAmount = net + fee;
  } else {
    collateralAmount = request.amount.amountOut;
    fee = (collateralAmount * feeBps) / 10_000n;

    const gross = collateralAmount + fee;

    if (gross >= virtualSol) {
      exhausted("Requested SOL exceeds virtual reserves");
    }

    tokenAmount = constantProduct / (virtualSol - gross) - virtualTokens;
  }

  assertAmount(tokenAmount, "tokenAmount");
  assertAmount(collateralAmount, "collateralAmount");

  if (
    buy &&
    (tokenAmount > remaining || position + tokenAmount > (TOTAL_SUPPLY * 82n) / 100n)
  ) {
    exhausted("Buy exceeds Moonshot curve allocation");
  }
  if (
    !buy &&
    (tokenAmount > position || collateralAmount + fee > curve.account.lamports)
  ) {
    exhausted("Sell exceeds Moonshot real reserves");
  }

  const dexFeeAmount = (fee * BigInt(config.bytes[170]!)) / 100n;
  const helioFeeAmount = fee - dexFeeAmount;

  if (
    dexState.lamports + dexFeeAmount > U64_MAX ||
    helioState.lamports + helioFeeAmount > U64_MAX
  ) {
    throw new InvalidAccountError({
      address: keys.config,
      message: "Moonshot fee recipient balance would overflow u64",
    });
  }
  if (buy && curve.account.lamports + collateralAmount - fee > U64_MAX) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Moonshot curve balance would overflow u64",
    });
  }
  if (!buy && ownerState.lamports + collateralAmount > U64_MAX) {
    throw new InvalidAccountError({
      address: request.owner,
      message: "Moonshot owner balance would overflow u64",
    });
  }

  const userTokenState = request.snapshot.accounts[userToken];

  if (
    buy &&
    userTokenState &&
    readTokenAccount(
      request.snapshot,
      userToken,
      mint,
      TOKEN_PROGRAM_ADDRESS,
      request.owner,
    ).amount +
      tokenAmount >
      U64_MAX
  ) {
    throw new InvalidAccountError({
      address: userToken,
      message: "Moonshot output token balance would overflow u64",
    });
  }

  const expectedAmountIn = buy ? collateralAmount : tokenAmount;
  const expectedAmountOut = buy ? tokenAmount : collateralAmount;
  const quote: SwapQuote =
    request.amount.kind === "exactIn"
      ? {
          kind: "exactIn",
          amountIn: request.amount.amountIn,
          expectedAmountIn,
          expectedAmountOut,
          minimumAmountOut: minimumOutput(expectedAmountOut, request.slippageBps),
          fees: [{ kind: "trade", mint: WRAPPED_SOL_MINT, amount: fee }],
        }
      : {
          kind: "exactOut",
          amountOut: request.amount.amountOut,
          expectedAmountIn,
          expectedAmountOut,
          maximumAmountIn: maximumInput(expectedAmountIn, request.slippageBps),
          fees: [{ kind: "trade", mint: WRAPPED_SOL_MINT, amount: fee }],
        };
  const instructionAccounts = {
    sender: request.owner,
    senderTokenAccount: userToken,
    curveAccount: request.pool,
    curveTokenAccount: vault,
    dexFee,
    helioFee,
    mint,
    configAccount: keys.config,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    systemProgram: SYSTEM_PROGRAM_ADDRESS,
  };
  let instruction: Instruction;

  if (buy) {
    if (quote.kind === "exactIn") {
      instruction = instructions.buy(instructionAccounts, {
        tokenAmount: quote.minimumAmountOut,
        collateralAmount: quote.amountIn,
        fixedSide: 0,
      });
    } else {
      instruction = instructions.buy(instructionAccounts, {
        tokenAmount: quote.amountOut,
        collateralAmount: quote.maximumAmountIn,
        fixedSide: 1,
      });
    }
  } else if (quote.kind === "exactIn") {
    instruction = instructions.sell(instructionAccounts, {
      tokenAmount: quote.amountIn,
      collateralAmount: quote.minimumAmountOut,
      fixedSide: 0,
    });
  } else {
    instruction = instructions.sell(instructionAccounts, {
      tokenAmount: quote.maximumAmountIn,
      collateralAmount: quote.amountOut,
      fixedSide: 1,
    });
  }

  return { quote, mayPartiallyFill: false, instructions: [instruction] };
}

/** Native SOL swaps on Moonshot/Moonit constant product v1/v2 curves, using caller-supplied state only.
 * @remarks The WSOL mint denotes wallet lamports, excluding rent and transaction fees.
 * Both fixed-side modes settle fully or fail; swaps reaching migration may finish fully up to the allocation cap.
 * Linear, flat, authority-gated anti-snipe curves and aliased fee recipients are unsupported.
 */
export const moonshotAdapter: ProtocolAdapter = {
  id: "moonshot",
  programAddresses: [MOONSHOT_PROGRAM],
  requirements,
  build,
  tokenAccountKinds(request) {
    return direction(request).buy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
};
