import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  readMint,
  readTokenAccount,
  createAssociatedTokenInstruction,
  TOKEN_PROGRAM,
  associatedTokenAddress,
} from "../../accounts/tokens.js";
import { assertAmount } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import { quotePump } from "./math.js";
import {
  getPumpBuyExactSolInInstruction,
  getPumpBuyV3Instruction,
  getPumpBuyExactQuoteInV3Instruction,
  getPumpSellV3Instruction,
} from "./instructions/bonding-curve/index.js";
import {
  NATIVE_SOL_MINT,
  PUMP_FEE_PROGRAM,
  PUMP_PROGRAM,
  SYSTEM_PROGRAM,
  readCurve,
  readFees,
  readRecipients,
  readPumpGlobal,
} from "./state.js";

const addressEncoder = getAddressEncoder();
const utf8 = new TextEncoder();

async function pda(
  programAddress: Address,
  label: string,
  ...addresses: readonly Address[]
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress,
      seeds: [
        utf8.encode(label),
        ...addresses.map((value) => addressEncoder.encode(value)),
      ],
    })
  )[0];
}

function direction(request: SwapRequest): {
  isBuy: boolean;
  mint: Address;
  quoteMint: Address;
} {
  const curve = readCurve(request.snapshot, request.pool);
  const isBuy = request.inputMint === curve.quoteMint;
  if (isBuy === (request.outputMint === curve.quoteMint)) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mints do not match the Pump curve's quote mint",
    });
  }
  return {
    isBuy,
    mint: isBuy ? request.outputMint : request.inputMint,
    quoteMint: curve.quoteMint,
  };
}

function usesLegacyBuy(request: SwapRequest): boolean {
  const { isBuy, quoteMint } = direction(request);
  return (
    isBuy &&
    quoteMint === NATIVE_SOL_MINT &&
    request.amount.kind === "exactIn" &&
    request.fillPolicy !== "allowPartial"
  );
}

async function commonAddresses() {
  const [global, feeConfig, eventAuthority] = await Promise.all([
    pda(PUMP_PROGRAM, "global"),
    pda(PUMP_FEE_PROGRAM, "fee_config", PUMP_PROGRAM),
    pda(PUMP_PROGRAM, "__event_authority"),
  ]);
  return { global, feeConfig, eventAuthority };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const { mint, quoteMint } = direction(request);
  const { global, feeConfig } = await commonAddresses();
  const accounts: AccountRequirement[] = [
    { address: request.pool, role: "Pump bonding curve" },
    { address: global, role: "Pump global" },
    { address: feeConfig, role: "Pump fee configuration" },
    { address: mint, role: "Pump base mint" },
  ];
  if (
    request.snapshot.accounts[mint] !== undefined &&
    request.snapshot.accounts[mint] !== null
  ) {
    const { tokenProgram } = readMint(request.snapshot, mint);
    accounts.push({
      address: await associatedTokenAddress(request.pool, mint, tokenProgram),
      role: "Pump base vault",
    });
  }
  if (quoteMint !== NATIVE_SOL_MINT) {
    accounts.push({ address: quoteMint, role: "Pump quote mint" });
    if (request.snapshot.accounts[quoteMint]) {
      const { tokenProgram } = readMint(request.snapshot, quoteMint);
      accounts.push({
        address: await associatedTokenAddress(request.pool, quoteMint, tokenProgram),
        role: "Pump quote vault",
      });
      if (request.snapshot.accounts[global]) {
        const { buybackRecipient } = readRecipients(request.snapshot, global);
        accounts.push({
          address: await associatedTokenAddress(
            buybackRecipient,
            quoteMint,
            tokenProgram,
          ),
          role: "Pump buyback quote account",
          optional: true,
        });
      }
    }
  }
  return accounts;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const { isBuy, mint, quoteMint } = direction(request);
  const curve = readCurve(request.snapshot, request.pool);
  if ((await pda(PUMP_PROGRAM, "bonding-curve", mint)) !== request.pool) {
    fail({
      code: "INVALID_ACCOUNT",
      address: request.pool,
      message: "Pump curve PDA does not match the requested base mint",
    });
  }
  const { global, feeConfig, eventAuthority } = await commonAddresses();
  const recipients = readRecipients(request.snapshot, global);
  const globalState = readPumpGlobal(request.snapshot, global);
  const fees = readFees(request.snapshot, feeConfig, curve, globalState);
  const { tokenProgram } = readMint(request.snapshot, mint);
  const vault = await associatedTokenAddress(request.pool, mint, tokenProgram);
  const vaultState = readTokenAccount(
    request.snapshot,
    vault,
    mint,
    tokenProgram,
    request.pool,
  );
  if (vaultState.amount < curve.realTokens) {
    fail({
      code: "INVALID_ACCOUNT",
      address: vault,
      message: "Pump vault contains fewer tokens than the curve's real reserve",
    });
  }
  const userTokenAccount = isBuy ? accounts.output : accounts.input;
  if (
    userTokenAccount !== (await associatedTokenAddress(request.owner, mint, tokenProgram))
  ) {
    fail({
      code: "INVALID_REQUEST",
      field: "tokenAccounts",
      message: "Pump requires the owner's associated base token account",
    });
  }
  if (
    quoteMint === NATIVE_SOL_MINT &&
    requireAccount(request.snapshot, request.pool, "Pump curve").lamports <
      curve.realSol + curve.creatorFees + curve.protocolFees
  ) {
    fail({
      code: "INVALID_ACCOUNT",
      address: request.pool,
      message: "Pump curve lamports do not cover its real reserve and accrued fees",
    });
  }
  const legacyBuy = usesLegacyBuy(request);
  const mayPartiallyFill = isBuy && request.amount.kind === "exactIn" && !legacyBuy;
  if (mayPartiallyFill && request.fillPolicy !== "allowPartial")
    fail({
      code: "UNSUPPORTED_FILL_POLICY",
      protocol: "pump",
      message: "Pump v3 exact-input buys may refund a completion tail; use allowPartial",
    });
  const quote = quotePump(request, curve, fees, isBuy, {
    baseVaultBalance: vaultState.amount,
    migrationFee: quoteMint === NATIVE_SOL_MINT ? globalState.migrationFee : 0n,
    allowSynthetic: !legacyBuy,
  });
  const userVolume = await pda(PUMP_PROGRAM, "user_volume_accumulator", request.owner);
  if (legacyBuy && quote.kind === "exactIn") {
    const [creatorVault, curveV2, globalVolume] = await Promise.all([
      pda(PUMP_PROGRAM, "creator-vault", curve.creator),
      pda(PUMP_PROGRAM, "bonding-curve-v2", mint),
      pda(PUMP_PROGRAM, "global_volume_accumulator"),
    ]);
    const instructionAccounts = {
      global,
      feeRecipient: recipients.feeRecipient,
      mint,
      bondingCurve: request.pool,
      associatedBondingCurve: vault,
      associatedUser: userTokenAccount,
      user: request.owner,
      systemProgram: SYSTEM_PROGRAM,
      tokenProgram,
      creatorVault,
      eventAuthority,
      program: PUMP_PROGRAM,
      globalVolumeAccumulator: globalVolume,
      userVolumeAccumulator: userVolume,
      feeConfig,
      feeProgram: PUMP_FEE_PROGRAM,
      bondingCurveV2: curveV2,
      buybackFeeRecipient: recipients.buybackRecipient,
    };

    return {
      instructions: [
        getPumpBuyExactSolInInstruction(instructionAccounts, {
          spendableSolIn: quote.amountIn,
          minTokensOut: quote.minimumAmountOut,
        }),
      ],
      quote,
      mayPartiallyFill: false,
    };
  }
  const quoteProgram =
    quoteMint === NATIVE_SOL_MINT
      ? TOKEN_PROGRAM
      : readMint(request.snapshot, quoteMint).tokenProgram;
  const quoteVault = await associatedTokenAddress(request.pool, quoteMint, quoteProgram);
  const userQuote = await associatedTokenAddress(request.owner, quoteMint, quoteProgram);
  const setup: Instruction[] = [];
  let buyback = recipients.buybackRecipient;
  if (quoteMint !== NATIVE_SOL_MINT) {
    if ((isBuy ? accounts.input : accounts.output) !== userQuote)
      fail({
        code: "INVALID_REQUEST",
        field: "tokenAccounts",
        message: "Pump requires the owner's associated quote token account",
      });
    const quoteState = readTokenAccount(
      request.snapshot,
      quoteVault,
      quoteMint,
      quoteProgram,
      request.pool,
    );
    if (quoteState.amount < curve.realSol + curve.creatorFees + curve.protocolFees)
      fail({
        code: "INVALID_ACCOUNT",
        address: quoteVault,
        message: "Pump quote vault does not cover its real reserve and accrued fees",
      });
    buyback = await associatedTokenAddress(
      recipients.buybackRecipient,
      quoteMint,
      quoteProgram,
    );
    if (request.snapshot.accounts[buyback] === null)
      setup.push(
        createAssociatedTokenInstruction(
          request.payer,
          recipients.buybackRecipient,
          quoteMint,
          quoteProgram,
          buyback,
        ),
      );
    else
      readTokenAccount(
        request.snapshot,
        buyback,
        quoteMint,
        quoteProgram,
        recipients.buybackRecipient,
      );
  }
  const v3Accounts = {
    global,
    baseMint: mint,
    quoteMint,
    baseTokenProgram: tokenProgram,
    quoteTokenProgram: quoteProgram,
    bondingCurve: request.pool,
    associatedBaseBondingCurve: vault,
    associatedQuoteBondingCurve: quoteVault,
    user: request.owner,
    associatedBaseUser: userTokenAccount,
    associatedQuoteUser: userQuote,
    userVolumeAccumulator: userVolume,
    feeConfig,
    buybackFeeRecipient: buyback,
    systemProgram: SYSTEM_PROGRAM,
    eventAuthority,
    program: PUMP_PROGRAM,
  };
  let instruction: Instruction;
  if (quote.kind === "exactOut") {
    assertAmount(quote.amountOut, "instructionAmount");
    assertAmount(quote.maximumAmountIn, "instructionLimit");
    instruction = getPumpBuyV3Instruction(v3Accounts, {
      amount: quote.amountOut,
      maxSolCost: quote.maximumAmountIn,
    });
  } else if (isBuy)
    instruction = getPumpBuyExactQuoteInV3Instruction(v3Accounts, {
      spendableQuoteIn: quote.amountIn,
      minTokensOut: quote.minimumAmountOut,
    });
  else
    instruction = getPumpSellV3Instruction(v3Accounts, {
      amount: quote.amountIn,
      minSolOutput: quote.minimumAmountOut,
    });
  return {
    setupInstructions: setup,
    instructions: [instruction],
    quote,
    mayPartiallyFill,
  };
}

/**
 * Pump curve swaps with native SOL, USDC or token quotes, including v3 synthetic migration.
 * @remarks SOL `exactIn` with default/requireFull uses the compatible legacy instruction.
 * Other buys and sells use v3 and retain fees on the curve. V3 exact-input buys require
 * allowPartial because completion may refund a tail too small to buy one more atom.
 * WSOL identifies wallet lamports on SOL curves; token-quote accounts use canonical ATAs.
 * Mayhem and cashback are rejected. Completed curves must migrate before further trading.
 * The owner funds native account initialization; the payer funds missing buyback quote ATAs.
 */
export const pumpAdapter: ProtocolAdapter = {
  id: "pump",
  programAddresses: [PUMP_PROGRAM],
  tokenAccountKinds(request) {
    const { isBuy, quoteMint } = direction(request);
    if (quoteMint !== NATIVE_SOL_MINT) return { input: "spl", output: "spl" };
    return isBuy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
  requirements,
  build,
};
