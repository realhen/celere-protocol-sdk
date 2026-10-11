import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import {
  UnsupportedPoolFeatureError,
  InsufficientLiquidityError,
  UnsupportedSwapModeError,
} from "../errors";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Address } from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../accounts/tokens";
import { minimumOutput } from "../amounts";

import { requireAccount } from "../accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../types";
import { accountDataView, readAddress, matchesDiscriminator } from "../accounts/bytes";
import { BOOP_PROGRAM } from "./constants";
import { buy_token, sell_token } from "./instructions/index";
import { getBoopCurveAddresses, getBoopUserTokenAddress } from "./pda";
export * from "./pda";
export { BOOP_PROGRAM } from "./constants";

const INITIAL_TOKEN_SUPPLY = 1_000_000_000_000_000_000n;
const BASIS_POINTS = 10_000n;

interface Curve {
  readonly mint: Address;
  readonly virtualSol: bigint;
  readonly target: bigint;
  readonly sol: bigint;
  readonly tokens: bigint;
  readonly feeBps: bigint;
}

function unsupported(feature: string): never {
  throw new UnsupportedPoolFeatureError({
    protocol: "boop",
    feature,
    message: `Boop ${feature} is not qualified`,
  });
}

function insufficient(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "boop", message });
}

function direction(request: SwapRequest): {
  readonly isBuy: boolean;
  readonly mint: Address;
} {
  const isBuy = request.inputMint === WRAPPED_SOL_MINT;

  if (isBuy === (request.outputMint === WRAPPED_SOL_MINT)) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Boop curves require one native SOL side",
    });
  }

  return { isBuy, mint: isBuy ? request.outputMint : request.inputMint };
}

function readCurve(request: SwapRequest): Curve {
  const data = requireAccount(
    request.snapshot,
    request.pool,
    "Boop bonding curve",
    BOOP_PROGRAM,
  ).data;

  if (
    data.length < 125 ||
    !matchesDiscriminator(data, [23, 183, 248, 55, 96, 216, 172, 96]) ||
    data.subarray(125).some((byte) => byte !== 0)
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Unknown Boop curve layout",
    });
  }
  if (data[124] !== 0) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Boop curve has graduated or migrated",
    });
  }
  if (data[120] !== 31) {
    unsupported(`curve selector ${data[120]}`);
  }

  const view = accountDataView(data);
  const curve = {
    mint: readAddress(data, 40),
    virtualSol: view.getBigUint64(72, true),
    target: view.getBigUint64(88, true),
    sol: view.getBigUint64(104, true),
    tokens: view.getBigUint64(112, true),
    feeBps: BigInt(data[121]!),
  };

  if (curve.mint !== direction(request).mint) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Boop curve mint mismatch",
    });
  }
  if (
    curve.virtualSol === 0n ||
    curve.virtualSol + curve.sol > U64_MAX ||
    curve.tokens === 0n ||
    curve.tokens > INITIAL_TOKEN_SUPPLY ||
    curve.target <= curve.sol ||
    view.getBigUint64(96, true) > curve.target ||
    view.getUint16(122, true) > 10000
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid Boop reserve or graduation state",
    });
  }

  return curve;
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const curve = readCurve(request);
  const derived = await getBoopCurveAddresses(curve.mint);

  return [
    { address: request.pool, role: "Boop bonding curve" },
    { address: derived.config, role: "Boop configuration" },
    { address: curve.mint, role: "base mint" },
    { address: WRAPPED_SOL_MINT, role: "native fee mint" },
    { address: derived.tokenVault, role: "base vault" },
    { address: derived.solVault, role: "native SOL vault" },
    { address: derived.feesVault, role: "WSOL fee vault" },
  ];
}

function readConfig(request: SwapRequest, config: Address): void {
  const data = requireAccount(
    request.snapshot,
    config,
    "Boop configuration",
    BOOP_PROGRAM,
  ).data;

  if (
    data.length < 189 ||
    !matchesDiscriminator(data, [155, 12, 170, 224, 30, 250, 204, 130])
  ) {
    throw new InvalidAccountError({
      address: config,
      message: "Unknown Boop configuration layout",
    });
  }

  const view = accountDataView(data);
  const end = 189 + view.getUint32(73, true) * 32;

  if (
    end > data.length ||
    data.subarray(end).some((byte) => byte !== 0) ||
    data[8]! > 1
  ) {
    throw new InvalidAccountError({
      address: config,
      message: "Malformed Boop configuration",
    });
  }
  if (data[8] !== 0) {
    throw new InvalidAccountError({ address: config, message: "Boop swaps are paused" });
  }
}

/**
 * Independently derived from Boop's deployed selector-31 behavior.
 * @remarks The invariant uses the fixed initial supply, not the deprecated virtual
 * token reserve. Native execution floors the new reserve before taking the difference.
 * SOL fees are floored; buys clamp net SOL input at the remaining graduation target.
 */
function quoteAmounts(curve: Curve, amount: bigint, isBuy: boolean) {
  const invariant = INITIAL_TOKEN_SUPPLY * curve.virtualSol;
  const solWithVirtual = curve.sol + curve.virtualSol;
  let fee: bigint;
  let input = amount;
  let output: bigint;

  if (isBuy) {
    fee = (amount * curve.feeBps) / BASIS_POINTS;

    let net = amount - fee;
    const remaining = curve.target - curve.sol;

    if (net > remaining) {
      net = remaining;
      fee = (net * curve.feeBps) / (BASIS_POINTS - curve.feeBps);
      input = net + fee;
    }
    if (net === 0n || solWithVirtual + net > U64_MAX) {
      insufficient("Boop input cannot settle within native arithmetic");
    }

    output = curve.tokens - invariant / (solWithVirtual + net);

    if (output > curve.tokens) {
      insufficient("Boop output exceeds its token reserve");
    }
  } else {
    if (curve.tokens + amount > INITIAL_TOKEN_SUPPLY) {
      insufficient("Boop sell exhausts real SOL backing");
    }

    const gross = solWithVirtual - invariant / (curve.tokens + amount);

    if (gross <= 0n || gross > curve.sol) {
      insufficient("Boop sell exhausts real SOL backing");
    }

    fee = (gross * curve.feeBps) / BASIS_POINTS;
    output = gross - fee;
  }
  if (output <= 0n || output > U64_MAX) {
    insufficient("Boop swap has no positive native output");
  }

  return { input, output, fee };
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  if (request.amount.kind !== "exactIn") {
    throw new UnsupportedSwapModeError({
      protocol: "boop",
      mode: request.amount.kind,
      message: "Boop exposes native exact-input swaps only",
    });
  }

  const { isBuy } = direction(request);
  const curve = readCurve(request);
  const derived = await getBoopCurveAddresses(curve.mint);

  if (derived.pool !== request.pool) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Boop curve PDA mismatch",
    });
  }

  readConfig(request, derived.config);

  const mint = readMint(request.snapshot, curve.mint);
  const nativeMint = readMint(request.snapshot, WRAPPED_SOL_MINT);

  if (
    mint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    mint.decimals !== 9 ||
    mint.supply > INITIAL_TOKEN_SUPPLY ||
    nativeMint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    nativeMint.decimals !== 9
  ) {
    unsupported("mint program, supply or decimal variant");
  }

  const tokenBalance = readTokenAccount(
    request.snapshot,
    derived.tokenVault,
    curve.mint,
    TOKEN_PROGRAM_ADDRESS,
    derived.authority,
  ).amount;
  const feeBalance = readTokenAccount(
    request.snapshot,
    derived.feesVault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ADDRESS,
    derived.authority,
  ).amount;
  const feeVault = requireAccount(
    request.snapshot,
    derived.feesVault,
    "Boop fee vault",
    TOKEN_PROGRAM_ADDRESS,
  );
  const feeData = accountDataView(feeVault.data);

  if (
    feeData.getUint32(109, true) !== 1 ||
    feeVault.lamports !== feeBalance + feeData.getBigUint64(113, true)
  ) {
    throw new InvalidAccountError({
      address: derived.feesVault,
      message: "Boop fee vault must contain synchronized native WSOL",
    });
  }

  const solVault = requireAccount(
    request.snapshot,
    derived.solVault,
    "Boop native SOL vault",
    SYSTEM_PROGRAM_ADDRESS,
  );

  if (
    solVault.data.length !== 0 ||
    solVault.lamports < curve.sol ||
    tokenBalance < curve.tokens ||
    mint.supply < curve.tokens
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Boop reserves exceed observed backing",
    });
  }

  const userToken = isBuy ? accounts.output : accounts.input;

  if ([derived.tokenVault, derived.feesVault].includes(userToken)) {
    throw new InvalidAccountError({
      address: userToken,
      message: "User token account aliases a Boop vault",
    });
  }
  if (!isBuy) {
    const ata = await getBoopUserTokenAddress(request.owner, curve.mint);

    if (accounts.input !== ata) {
      throw new InvalidAccountError({
        address: accounts.input,
        message: "Boop sells require the owner's associated token account",
      });
    }
  }

  const amounts = quoteAmounts(curve, request.amount.amountIn, isBuy);

  if (
    feeBalance + amounts.fee > U64_MAX ||
    (!isBuy && tokenBalance + amounts.input > U64_MAX)
  ) {
    insufficient("Boop destination balance exceeds native u64 arithmetic");
  }

  const quote = {
    kind: "exactIn" as const,
    amountIn: request.amount.amountIn,
    minimumAmountOut: minimumOutput(amounts.output, request.slippageBps),
    expectedAmountIn: amounts.input,
    expectedAmountOut: amounts.output,
    fees: [{ kind: "trade" as const, mint: WRAPPED_SOL_MINT, amount: amounts.fee }],
  };
  const common = {
    mint: curve.mint,
    bondingCurve: request.pool,
    tradingFeesVault: derived.feesVault,
    bondingCurveVault: derived.tokenVault,
    bondingCurveSolVault: derived.solVault,
    config: derived.config,
  };
  const instruction = isBuy
    ? buy_token(
        {
          ...common,
          recipientTokenAccount: accounts.output,
          buyer: request.owner,
          vaultAuthority: derived.authority,
        },
        { buyAmount: quote.amountIn, amountOutMin: quote.minimumAmountOut },
      )
    : sell_token(
        {
          ...common,
          sellerTokenAccount: accounts.input,
          seller: request.owner,
          recipient: request.owner,
        },
        { sellAmount: quote.amountIn, amountOutMin: quote.minimumAmountOut },
      );

  return { instructions: [instruction], quote, mayPartiallyFill: isBuy };
}

/**
 * Offline Boop selector-31 native SOL swaps with classic nine-decimal SPL tokens.
 * @remarks Buy instructions can clamp input at graduation, so callers must explicitly
 * allow partial fills. Sells enforce full input. Exact output and legacy selector 30
 * are unsupported. WSOL identifies native wallet lamports at the public swap boundary;
 * the protocol fee vault must already exist as synchronized native WSOL.
 */
export const boopAdapter: ProtocolAdapter = {
  id: "boop",
  programAddresses: [BOOP_PROGRAM],
  requirements,
  build,
  tokenAccountKinds(request) {
    return direction(request).isBuy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
};
