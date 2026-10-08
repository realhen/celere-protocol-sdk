import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import {
  associatedTokenAddress,
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

const PUMP_PROGRAM = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
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
  readTokenAccount(
    request.snapshot,
    buybackTokenAccount,
    pool.quoteMint,
    quoteMint.tokenProgram,
    globalState.buybackRecipient,
  );
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
  );
  const quote = quotePumpAmm(
    request,
    isBuy,
    baseVault.amount,
    quoteVault.amount,
    pool.virtualQuoteReserves,
    pool.protocolFees + pool.creatorFees,
    rates,
  );
  const first = quote.kind === "exactOut" ? quote.amountOut : quote.amountIn;
  const second =
    quote.kind === "exactOut" ? quote.maximumAmountIn : quote.minimumAmountOut;
  assertAmount(first, "instructionAmount");
  assertAmount(second, "instructionLimit");
  const data = new Uint8Array(24);
  data.set(
    quote.kind === "exactOut"
      ? [184, 23, 238, 97, 103, 197, 211, 61]
      : isBuy
        ? [194, 171, 28, 70, 104, 77, 91, 47]
        : [93, 246, 130, 60, 231, 233, 64, 178],
  );
  const view = new DataView(data.buffer);
  view.setBigUint64(8, first, true);
  view.setBigUint64(16, second, true);
  const readonly = (value: Address) => ({ address: value, role: AccountRole.READONLY });
  const writable = (value: Address) => ({ address: value, role: AccountRole.WRITABLE });
  return {
    quote,
    mayPartiallyFill: false,
    instructions: [
      {
        programAddress: PUMP_AMM_PROGRAM,
        data,
        accounts: [
          writable(request.pool),
          { address: request.owner, role: AccountRole.WRITABLE_SIGNER },
          readonly(global),
          readonly(pool.baseMint),
          readonly(pool.quoteMint),
          writable(isBuy ? accounts.output : accounts.input),
          writable(isBuy ? accounts.input : accounts.output),
          writable(pool.baseVault),
          writable(pool.quoteVault),
          readonly(base.tokenProgram),
          readonly(quoteMint.tokenProgram),
          readonly(AMM_SYSTEM_PROGRAM),
          writable(
            await derive(PUMP_AMM_PROGRAM, "user_volume_accumulator", request.owner),
          ),
          readonly(feeConfig),
          writable(buybackTokenAccount),
          readonly(eventAuthority),
          readonly(PUMP_AMM_PROGRAM),
        ],
      },
    ],
  };
}

/**
 * Pump AMM native v2 swaps for standard WSOL-quoted pools.
 * @remarks Both assets use SPL accounts: callers supply wrapped SOL themselves. The owner may
 * additionally pay program account rent, outside quoted swap amounts. LP and protocol fees are
 * combined as trade fees; creator fees are separate. A listed buyback ATA must already exist.
 */
export const pumpAmmAdapter: ProtocolAdapter = {
  id: "pump-amm",
  programAddresses: [PUMP_AMM_PROGRAM],
  requirements,
  build,
};
