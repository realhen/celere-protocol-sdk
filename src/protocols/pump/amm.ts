import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  associatedTokenAddress,
  createAssociatedTokenInstruction,
  readMint,
  readTokenAccount,
} from "../../accounts/tokens.js";
import { assertAmount } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import { quotePumpAmm } from "./amm-math.js";
import {
  AMM_FEE_PROGRAM,
  AMM_SYSTEM_PROGRAM,
  PUMP_AMM_PROGRAM,
  readAmmFees,
  readAmmGlobal,
  readAmmPool,
} from "./amm-state.js";

import { PUMP_PROGRAM } from "./constants.js";
import {
  getPumpAmmBuyV2Instruction,
  getPumpAmmBuyExactQuoteInV2Instruction,
  getPumpAmmSellV2Instruction,
} from "./instructions/amm/index.js";

const bytes = getAddressEncoder();
const utf8 = new TextEncoder();

async function derive(
  programAddress: Address,
  label: string,
  ...addresses: readonly Address[]
): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode(label), ...addresses.map((value) => bytes.encode(value))],
    })
  )[0];
}

async function commonAddresses() {
  const [global, feeConfig, eventAuthority] = await Promise.all([
    derive(PUMP_AMM_PROGRAM, "global_config"),
    derive(AMM_FEE_PROGRAM, "fee_config", PUMP_AMM_PROGRAM),
    derive(PUMP_AMM_PROGRAM, "__event_authority"),
  ]);
  return { global, feeConfig, eventAuthority };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const { global, feeConfig } = await commonAddresses();
  const result: AccountRequirement[] = [
    { address: request.pool, role: "Pump AMM pool" },
    { address: global, role: "Pump AMM global configuration" },
    { address: feeConfig, role: "Pump AMM fee configuration" },
  ];
  if (
    request.snapshot.accounts[request.pool] === undefined ||
    request.snapshot.accounts[request.pool] === null
  )
    return result;
  const pool = readAmmPool(request.snapshot, request.pool);
  result.push(
    { address: pool.baseMint, role: "Pump AMM base mint" },
    { address: pool.quoteMint, role: "Pump AMM quote mint" },
    { address: pool.baseVault, role: "Pump AMM base vault" },
    { address: pool.quoteVault, role: "Pump AMM quote vault" },
  );
  if (request.snapshot.accounts[global] && request.snapshot.accounts[pool.quoteMint]) {
    const { buybackRecipient } = readAmmGlobal(request.snapshot, global);
    const { tokenProgram } = readMint(request.snapshot, pool.quoteMint);
    result.push({
      address: await associatedTokenAddress(
        buybackRecipient,
        pool.quoteMint,
        tokenProgram,
      ),
      role: "Pump AMM buyback recipient token account",
      optional: true,
    });
  }
  return result;
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readAmmPool(request.snapshot, request.pool);
  const isBuy =
    request.inputMint === pool.quoteMint && request.outputMint === pool.baseMint;
  if (
    !isBuy &&
    !(request.inputMint === pool.baseMint && request.outputMint === pool.quoteMint)
  )
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested mints do not match the Pump AMM pool",
    });
  const indexBytes = new Uint8Array(2);
  new DataView(indexBytes.buffer).setUint16(0, pool.index, true);
  const [expectedPool, bump] = await getProgramDerivedAddress({
    programAddress: PUMP_AMM_PROGRAM,
    seeds: [
      utf8.encode("pool"),
      indexBytes,
      ...[pool.creator, pool.baseMint, pool.quoteMint].map((value) =>
        bytes.encode(value),
      ),
    ],
  });
  if (request.pool !== expectedPool || pool.bump !== bump)
    fail({
      code: "INVALID_ACCOUNT",
      address: request.pool,
      message: "Pump AMM pool PDA or bump does not match its state",
    });
  const { global, feeConfig, eventAuthority } = await commonAddresses();
  const globalState = readAmmGlobal(request.snapshot, global);
  if (globalState.disabled & (isBuy ? 8 : 16))
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "pump-amm",
      feature: "disabled-swap-direction",
      message: "Pump AMM global configuration disables this swap direction",
    });
  const base = readMint(request.snapshot, pool.baseMint);
  const quoteMint = readMint(request.snapshot, pool.quoteMint);
  const [expectedBaseVault, expectedQuoteVault] = await Promise.all([
    associatedTokenAddress(request.pool, pool.baseMint, base.tokenProgram),
    associatedTokenAddress(request.pool, pool.quoteMint, quoteMint.tokenProgram),
  ]);
  if (pool.baseVault !== expectedBaseVault || pool.quoteVault !== expectedQuoteVault)
    fail({
      code: "INVALID_ACCOUNT",
      address: request.pool,
      message: "Pump AMM pool vault addresses are not canonical",
    });
  const baseVault = readTokenAccount(
    request.snapshot,
    pool.baseVault,
    pool.baseMint,
    base.tokenProgram,
    request.pool,
  );
  const quoteVault = readTokenAccount(
    request.snapshot,
    pool.quoteVault,
    pool.quoteMint,
    quoteMint.tokenProgram,
    request.pool,
  );
  const buybackTokenAccount = await associatedTokenAddress(
    globalState.buybackRecipient,
    pool.quoteMint,
    quoteMint.tokenProgram,
  );
  const setupInstructions: Instruction[] = [];
  if (request.snapshot.accounts[buybackTokenAccount] === null) {
    setupInstructions.push(
      createAssociatedTokenInstruction(
        request.payer,
        globalState.buybackRecipient,
        pool.quoteMint,
        quoteMint.tokenProgram,
        buybackTokenAccount,
      ),
    );
  } else {
    readTokenAccount(
      request.snapshot,
      buybackTokenAccount,
      pool.quoteMint,
      quoteMint.tokenProgram,
      globalState.buybackRecipient,
    );
  }
  if (
    pool.isHolderReward &&
    pool.coinCreator !== (await derive(PUMP_PROGRAM, "holder-rewards", pool.baseMint))
  )
    fail({
      code: "INVALID_ACCOUNT",
      address: request.pool,
      message: "Pump AMM holder-reward creator is not the canonical rewards PDA",
    });
  const canonical =
    pool.creator === (await derive(PUMP_PROGRAM, "pool-authority", pool.baseMint));
  if (baseVault.amount === 0n)
    fail({
      code: "INSUFFICIENT_LIQUIDITY",
      protocol: "pump-amm",
      message: "Pump AMM base reserve is empty",
    });
  const rates = readAmmFees(
    request.snapshot,
    feeConfig,
    canonical,
    ((quoteVault.amount + pool.virtualQuoteReserves) * base.supply) / baseVault.amount,
    pool.coinCreator,
    {
      quoteMint: pool.quoteMint,
      creatorFeeConfigurable: globalState.creatorFeeConfigurable,
      creatorFeeBps: pool.creatorFeeBps,
    },
  );
  const quote = quotePumpAmm(
    request,
    isBuy,
    baseVault.amount,
    quoteVault.amount,
    pool.virtualQuoteReserves,
    pool.protocolFees + pool.creatorFees,
    rates,
    pool.quoteMint,
  );
  const instructionAccounts = {
    pool: request.pool,
    user: request.owner,
    globalConfig: global,
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    userBaseTokenAccount: isBuy ? accounts.output : accounts.input,
    userQuoteTokenAccount: isBuy ? accounts.input : accounts.output,
    poolBaseTokenAccount: pool.baseVault,
    poolQuoteTokenAccount: pool.quoteVault,
    baseTokenProgram: base.tokenProgram,
    quoteTokenProgram: quoteMint.tokenProgram,
    systemProgram: AMM_SYSTEM_PROGRAM,
    userVolumeAccumulator: await derive(
      PUMP_AMM_PROGRAM,
      "user_volume_accumulator",
      request.owner,
    ),
    feeConfig,
    buybackFeeRecipient: buybackTokenAccount,
    eventAuthority,
    program: PUMP_AMM_PROGRAM,
  };
  let instruction: Instruction;
  if (quote.kind === "exactOut") {
    assertAmount(quote.amountOut, "instructionAmount");
    assertAmount(quote.maximumAmountIn, "instructionLimit");
    instruction = getPumpAmmBuyV2Instruction(instructionAccounts, {
      baseAmountOut: quote.amountOut,
      maxQuoteAmountIn: quote.maximumAmountIn,
    });
  } else if (isBuy) {
    assertAmount(quote.amountIn, "instructionAmount");
    assertAmount(quote.minimumAmountOut, "instructionLimit");
    instruction = getPumpAmmBuyExactQuoteInV2Instruction(instructionAccounts, {
      spendableQuoteIn: quote.amountIn,
      minBaseAmountOut: quote.minimumAmountOut,
    });
  } else {
    assertAmount(quote.amountIn, "instructionAmount");
    assertAmount(quote.minimumAmountOut, "instructionLimit");
    instruction = getPumpAmmSellV2Instruction(instructionAccounts, {
      baseAmountIn: quote.amountIn,
      minQuoteAmountOut: quote.minimumAmountOut,
    });
  }
  return {
    quote,
    mayPartiallyFill: false,
    setupInstructions,
    instructions: [instruction],
  };
}

/**
 * Pump AMM native v2 swaps with SOL, USDC, or token quote assets.
 * @remarks Both assets use SPL accounts: callers supply wrapped SOL themselves. The owner may
 * additionally pay program account rent, outside quoted swap amounts. LP and protocol fees are
 * combined as trade fees; creator fees are separate, including fees retained for holder rewards.
 * An observed-absent buyback ATA is created idempotently, with rent paid by the caller payer.
 */
export const pumpAmmAdapter: ProtocolAdapter = {
  id: "pump-amm",
  programAddresses: [PUMP_AMM_PROGRAM],
  requirements,
  build,
};
