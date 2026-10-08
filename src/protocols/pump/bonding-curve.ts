import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS as ASSOCIATED_TOKEN_PROGRAM } from "@solana-program/token";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import { readMint, readTokenAccount } from "../../accounts/tokens.js";
import { assertAmount } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import { quotePump } from "./math.js";
import {
  getPumpBuyInstruction,
  getPumpBuyExactSolInInstruction,
  getPumpSellInstruction,
} from "./instructions/bonding-curve/index.js";
import {
  NATIVE_SOL_MINT,
  PUMP_FEE_PROGRAM,
  PUMP_PROGRAM,
  SYSTEM_PROGRAM,
  readCurve,
  readFees,
  readRecipients,
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

function direction(request: SwapRequest): { isBuy: boolean; mint: Address } {
  const isBuy = request.inputMint === NATIVE_SOL_MINT;
  if (isBuy === (request.outputMint === NATIVE_SOL_MINT)) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Pump bonding curves require one native SOL side",
    });
  }
  return { isBuy, mint: isBuy ? request.outputMint : request.inputMint };
}

async function commonAddresses() {
  const [global, feeConfig, eventAuthority] = await Promise.all([
    pda(PUMP_PROGRAM, "global"),
    pda(PUMP_FEE_PROGRAM, "fee_config", PUMP_PROGRAM),
    pda(PUMP_PROGRAM, "__event_authority"),
  ]);
  return { global, feeConfig, eventAuthority };
}

async function associatedTokenAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      seeds: [owner, tokenProgram, mint].map((value) => addressEncoder.encode(value)),
    })
  )[0];
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const { mint } = direction(request);
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
  return accounts;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const { isBuy, mint } = direction(request);
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
  const fees = readFees(request.snapshot, feeConfig, curve);
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
  const quote = quotePump(request, curve, fees, isBuy);
  const [creatorVault, curveV2, globalVolume, userVolume] = await Promise.all([
    pda(PUMP_PROGRAM, "creator-vault", curve.creator),
    pda(PUMP_PROGRAM, "bonding-curve-v2", mint),
    pda(PUMP_PROGRAM, "global_volume_accumulator"),
    pda(PUMP_PROGRAM, "user_volume_accumulator", request.owner),
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
  let instruction: Instruction;
  if (quote.kind === "exactOut") {
    assertAmount(quote.amountOut, "instructionAmount");
    assertAmount(quote.maximumAmountIn, "instructionLimit");
    instruction = getPumpBuyInstruction(instructionAccounts, {
      amount: quote.amountOut,
      maxSolCost: quote.maximumAmountIn,
    });
  } else if (isBuy) {
    assertAmount(quote.amountIn, "instructionAmount");
    assertAmount(quote.minimumAmountOut, "instructionLimit");
    instruction = getPumpBuyExactSolInInstruction(instructionAccounts, {
      spendableSolIn: quote.amountIn,
      minTokensOut: quote.minimumAmountOut,
    });
  } else {
    assertAmount(quote.amountIn, "instructionAmount");
    assertAmount(quote.minimumAmountOut, "instructionLimit");
    instruction = getPumpSellInstruction(instructionAccounts, {
      amount: quote.amountIn,
      minSolOutput: quote.minimumAmountOut,
    });
  }
  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/**
 * Native SOL bonding-curve swaps using Pump's native exact-input and buy exact-output instructions.
 * @remarks Quote-side WSOL mint identifies native wallet lamports, not a wrapped token account.
 * The owner additionally funds Pump-created accounts and rent; that debit is outside swap amounts.
 * Mayhem, cashback, holder rewards, configured creator fees, token quotes and post-completion routing are unsupported.
 */
export const pumpAdapter: ProtocolAdapter = {
  id: "pump",
  programAddresses: [PUMP_PROGRAM],
  tokenAccountKinds(request) {
    return direction(request).isBuy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
  requirements,
  build,
};
