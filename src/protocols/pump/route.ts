import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  associatedTokenAddress,
  createAssociatedTokenInstruction,
  readMint,
  readTokenAccount,
  WRAPPED_SOL_MINT,
} from "../../accounts/tokens.js";
import { minimumOutput } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  RouteAdapter,
  RouteHop,
  RouteHopQuote,
  RouteRequest,
  ProtocolRoute,
} from "../../core/route-types.js";
import type {
  AccountRequirement,
  ResolvedTokenAccounts,
  SwapFee,
  SwapQuote,
  SwapRequest,
} from "../../core/types.js";
import { quotePumpAmm } from "./amm-math.js";
import {
  readAmmFees,
  readAmmGlobal,
  readAmmPool,
  type PumpAmmPool,
} from "./amm-state.js";
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM, PUMP_FEE_PROGRAM } from "./constants.js";
import { quotePump } from "./math.js";
import { readCurve, readFees, readPumpGlobal, type PumpCurve } from "./state.js";
import {
  multi_hop_swap,
  type PumpAmmMultiHopSwapHopAccounts,
} from "./instructions/amm/multi_hop_swap.js";

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
  const [
    global,
    feeConfig,
    eventAuthority,
    pumpGlobal,
    pumpFeeConfig,
    pumpEventAuthority,
  ] = await Promise.all([
    derive(PUMP_AMM_PROGRAM, "global_config"),
    derive(PUMP_FEE_PROGRAM, "fee_config", PUMP_AMM_PROGRAM),
    derive(PUMP_AMM_PROGRAM, "__event_authority"),
    derive(PUMP_PROGRAM, "global"),
    derive(PUMP_FEE_PROGRAM, "fee_config", PUMP_PROGRAM),
    derive(PUMP_PROGRAM, "__event_authority"),
  ]);
  return {
    global,
    feeConfig,
    eventAuthority,
    pumpGlobal,
    pumpFeeConfig,
    pumpEventAuthority,
  };
}

type Venue = PumpAmmMultiHopSwapHopAccounts & {
  readonly isBuy: boolean;
} & (
    | { readonly kind: "pool"; readonly state: PumpAmmPool }
    | { readonly kind: "curve"; readonly state: PumpCurve }
  );

function invalid(address: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address, message });
}

async function readVenue(request: RouteRequest, hop: RouteHop): Promise<Venue> {
  const account = requireAccount(request.snapshot, hop.pool, "route venue");
  if (account.owner === PUMP_AMM_PROGRAM) {
    const state = readAmmPool(request.snapshot, hop.pool);
    const isBuy = hop.inputMint === state.quoteMint && hop.outputMint === state.baseMint;
    if (
      !isBuy &&
      !(hop.inputMint === state.baseMint && hop.outputMint === state.quoteMint)
    )
      invalid(hop.pool, "Route hop mints do not match the pool");
    const creator = await derive(PUMP_PROGRAM, "pool-authority", state.baseMint);
    const [expected, bump] = await getProgramDerivedAddress({
      programAddress: PUMP_AMM_PROGRAM,
      seeds: [
        utf8.encode("pool"),
        new Uint8Array(2),
        ...[creator, state.baseMint, state.quoteMint].map((value) => bytes.encode(value)),
      ],
    });
    if (
      state.index !== 0 ||
      state.creator !== creator ||
      hop.pool !== expected ||
      state.bump !== bump
    )
      fail({
        code: "UNSUPPORTED_POOL_FEATURE",
        protocol: "pump-amm",
        feature: "noncanonical-route-pool",
        message: "Native Pump routes require canonical migrated pools at index zero",
      });
    return {
      kind: "pool",
      state,
      isBuy,
      pool: hop.pool,
      baseMint: state.baseMint,
      quoteMint: state.quoteMint,
      baseVault: state.baseVault,
      quoteVault: state.quoteVault,
    };
  }
  if (account.owner !== PUMP_PROGRAM)
    fail({
      code: "UNSUPPORTED_PROTOCOL",
      programAddress: account.owner,
      message: "Native Pump routes support only Pump curves and canonical PumpSwap pools",
    });
  const state = readCurve(request.snapshot, hop.pool);
  const isBuy = hop.inputMint === state.quoteMint;
  const baseMint = isBuy ? hop.outputMint : hop.inputMint;
  if (
    (!isBuy && hop.outputMint !== state.quoteMint) ||
    (await derive(PUMP_PROGRAM, "bonding-curve", baseMint)) !== hop.pool
  )
    invalid(hop.pool, "Route hop mints or curve PDA do not match the bonding curve");
  const base = readMint(request.snapshot, baseMint);
  const quote = readMint(request.snapshot, state.quoteMint);
  return {
    kind: "curve",
    state,
    isBuy,
    pool: hop.pool,
    baseMint,
    quoteMint: state.quoteMint,
    baseVault: await associatedTokenAddress(hop.pool, baseMint, base.tokenProgram),
    quoteVault: await associatedTokenAddress(
      hop.pool,
      state.quoteMint,
      quote.tokenProgram,
    ),
  };
}

async function readVenues(request: RouteRequest): Promise<readonly Venue[]> {
  if (request.amount.kind !== "exactIn")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "pump-amm",
      mode: "exactOut",
      message: "Native Pump routes support exact input only",
    });
  if (request.hops.length > 4)
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "pump-amm",
      feature: "route-size",
      message:
        "Qualified Pump routes support at most four hops; longer routes can exhaust the native allocator",
    });
  const venues = await Promise.all(request.hops.map((hop) => readVenue(request, hop)));
  if (venues.some((venue) => venue.isBuy !== venues[0]!.isBuy))
    fail({
      code: "INVALID_REQUEST",
      field: "hops",
      message: "Every Pump route hop must have the same buy or sell direction",
    });
  return venues;
}

async function requirements(
  request: RouteRequest,
): Promise<readonly AccountRequirement[]> {
  const common = await commonAddresses();
  const result: AccountRequirement[] = [
    { address: common.global, role: "PumpSwap route global" },
    { address: common.feeConfig, role: "PumpSwap route fees" },
    { address: common.pumpGlobal, role: "Pump route global" },
    { address: common.pumpFeeConfig, role: "Pump route fees" },
  ];
  for (const hop of request.hops) {
    result.push(
      { address: hop.pool, role: "route venue" },
      { address: hop.inputMint, role: "route input mint" },
      { address: hop.outputMint, role: "route output mint" },
    );
  }
  if (
    result.some(
      (requirement) => request.snapshot.accounts[requirement.address] === undefined,
    )
  )
    return result;
  const venues = await readVenues(request);
  const isBuy = venues[0]!.isBuy;
  for (const venue of venues) {
    result.push({ address: venue.baseVault, role: "route base vault" });
    if (venue.kind === "pool" || venue.quoteMint !== WRAPPED_SOL_MINT)
      result.push({ address: venue.quoteVault, role: "route quote vault" });
  }
  const currency = isBuy ? venues[0]! : venues.at(-1)!;
  const { buybackRecipient } = readAmmGlobal(request.snapshot, common.global);
  const quote = readMint(request.snapshot, currency.quoteMint);
  result.push({
    address: await associatedTokenAddress(
      buybackRecipient,
      currency.quoteMint,
      quote.tokenProgram,
    ),
    role: "route buyback recipient token account",
    optional: true,
  });
  return result;
}

function aggregateFees(hops: readonly RouteHopQuote[]): readonly SwapFee[] {
  const fees = new Map<string, SwapFee>();
  for (const hop of hops)
    for (const fee of hop.quote.fees) {
      const key = `${fee.kind}:${fee.mint}`;
      const previous = fees.get(key);
      fees.set(key, { ...fee, amount: fee.amount + (previous?.amount ?? 0n) });
    }
  return [...fees.values()].filter((fee) => fee.amount > 0n);
}

async function build(
  request: RouteRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolRoute> {
  const venues = await readVenues(request);
  if (request.amount.kind !== "exactIn") throw new Error("Validated exact-input route");
  const common = await commonAddresses();
  const global = readAmmGlobal(request.snapshot, common.global);
  const pumpGlobal = readPumpGlobal(request.snapshot, common.pumpGlobal);
  const isBuy = venues[0]!.isBuy;
  if (global.disabled & (isBuy ? 8 : 16))
    fail({
      code: "UNSUPPORTED_POOL_FEATURE",
      protocol: "pump-amm",
      feature: "disabled-swap-direction",
      message: "PumpSwap global disables this route direction",
    });
  const currency = isBuy ? venues[0]! : venues.at(-1)!;
  const quoteMint = readMint(request.snapshot, currency.quoteMint);
  const buybackTokenAccount = await associatedTokenAddress(
    global.buybackRecipient,
    currency.quoteMint,
    quoteMint.tokenProgram,
  );
  const setupInstructions: Instruction[] = [];
  if (request.snapshot.accounts[buybackTokenAccount] === null) {
    setupInstructions.push(
      createAssociatedTokenInstruction(
        request.payer,
        global.buybackRecipient,
        currency.quoteMint,
        quoteMint.tokenProgram,
        buybackTokenAccount,
      ),
    );
  } else {
    readTokenAccount(
      request.snapshot,
      buybackTokenAccount,
      currency.quoteMint,
      quoteMint.tokenProgram,
      global.buybackRecipient,
    );
  }
  let amountIn = request.amount.amountIn;
  const hops: RouteHopQuote[] = [];
  for (let index = 0; index < venues.length; index++) {
    const venue = venues[index]!;
    const hop = request.hops[index]!;
    const base = readMint(request.snapshot, venue.baseMint);
    const quote = readMint(request.snapshot, venue.quoteMint);
    const [baseVaultAddress, quoteVaultAddress] = await Promise.all([
      associatedTokenAddress(venue.pool, venue.baseMint, base.tokenProgram),
      associatedTokenAddress(venue.pool, venue.quoteMint, quote.tokenProgram),
    ]);
    if (baseVaultAddress !== venue.baseVault || quoteVaultAddress !== venue.quoteVault)
      invalid(venue.pool, "Route vault addresses must be canonical ATAs of the venue");
    const baseVault = readTokenAccount(
      request.snapshot,
      venue.baseVault,
      venue.baseMint,
      base.tokenProgram,
      venue.pool,
    );
    const quoteVault =
      venue.kind === "pool" || venue.quoteMint !== WRAPPED_SOL_MINT
        ? readTokenAccount(
            request.snapshot,
            venue.quoteVault,
            venue.quoteMint,
            quote.tokenProgram,
            venue.pool,
          )
        : undefined;
    const protocolFee = isBuy ? index === 0 : index === venues.length - 1;
    const targetFee = isBuy ? index === venues.length - 1 : index === 0;
    const hopRequest: SwapRequest = {
      ...request,
      ...hop,
      amount: { kind: "exactIn", amountIn },
      slippageBps: 0,
    };
    let quoted: SwapQuote;
    if (venue.kind === "pool") {
      if (baseVault.amount === 0n)
        fail({
          code: "INSUFFICIENT_LIQUIDITY",
          protocol: "pump-amm",
          message: "Route base reserve is empty",
        });
      const state = venue.state;
      const rates = readAmmFees(
        request.snapshot,
        common.feeConfig,
        true,
        ((quoteVault!.amount + state.virtualQuoteReserves) * base.supply) /
          baseVault.amount,
        state.coinCreator,
        {
          quoteMint: state.quoteMint,
          creatorFeeConfigurable: global.creatorFeeConfigurable,
          creatorFeeBps: state.creatorFeeBps,
        },
      );
      quoted = quotePumpAmm(
        hopRequest,
        isBuy,
        baseVault.amount,
        quoteVault!.amount,
        state.virtualQuoteReserves,
        state.protocolFees + state.creatorFees,
        {
          lpBps: targetFee ? rates.lpBps : 0n,
          protocolBps: protocolFee ? rates.protocolBps : 0n,
          creatorBps: targetFee ? rates.creatorBps : 0n,
        },
        venue.quoteMint,
        true,
      );
    } else {
      const state = venue.state;
      if (
        venue.quoteMint === WRAPPED_SOL_MINT &&
        requireAccount(request.snapshot, venue.pool, "Pump curve").lamports <
          state.realSol + state.protocolFees + state.creatorFees
      )
        invalid(
          venue.pool,
          "Curve lamports are below its real SOL reserve and retained fees",
        );
      if (state.realTokens > baseVault.amount)
        invalid(venue.baseVault, "Curve base balance is below its real token reserve");
      if (
        quoteVault &&
        quoteVault.amount < state.realSol + state.protocolFees + state.creatorFees
      )
        invalid(
          venue.quoteVault,
          "Curve quote balance is below its reserve and retained fees",
        );
      const rates = readFees(request.snapshot, common.pumpFeeConfig, state, pumpGlobal);
      quoted = quotePump(
        hopRequest,
        state,
        {
          protocolBps: protocolFee ? rates.protocolBps : 0n,
          creatorBps: targetFee ? rates.creatorBps : 0n,
        },
        isBuy,
        {
          baseVaultBalance: baseVault.amount,
          migrationFee:
            venue.quoteMint === WRAPPED_SOL_MINT ? pumpGlobal.migrationFee : 0n,
          allowSynthetic: true,
          route: true,
        },
      );
    }
    hops.push({
      ...hop,
      protocol: venue.kind === "pool" ? "pump-amm" : "pump",
      quote: quoted,
    });
    amountIn = quoted.expectedAmountOut;
  }
  const minimumAmountOut = minimumOutput(amountIn, request.slippageBps);
  if (minimumAmountOut === 0n)
    fail({
      code: "INVALID_REQUEST",
      field: "slippageBps",
      message: "Native routes require a nonzero minimum output",
    });
  const instruction = multi_hop_swap(
    {
      user: request.owner,
      userInTokenAccount: accounts.input,
      userOutTokenAccount: accounts.output,
      globalConfig: common.global,
      feeConfig: common.feeConfig,
      userVolumeAccumulator: await derive(
        PUMP_AMM_PROGRAM,
        "user_volume_accumulator",
        request.owner,
      ),
      buybackFeeRecipient: buybackTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
      systemProgram: SYSTEM_PROGRAM_ADDRESS,
      eventAuthority: common.eventAuthority,
      program: PUMP_AMM_PROGRAM,
      pumpProgram: PUMP_PROGRAM,
      pumpGlobal: common.pumpGlobal,
      pumpFeeConfig: common.pumpFeeConfig,
      pumpEventAuthority: common.pumpEventAuthority,
      hops: venues,
    },
    { amountIn: request.amount.amountIn, minAmountOut: minimumAmountOut },
  );
  const nativeCurrency =
    currency.kind === "curve" && currency.quoteMint === WRAPPED_SOL_MINT;
  return {
    instructions: [instruction],
    setupInstructions,
    hops,
    quote: {
      kind: "exactIn",
      amountIn: request.amount.amountIn,
      expectedAmountIn: hops[0]!.quote.expectedAmountIn,
      expectedAmountOut: amountIn,
      minimumAmountOut,
      fees: aggregateFees(hops),
    },
    mayPartiallyFill: false,
    assets: {
      input: nativeCurrency && isBuy ? "nativeSol" : "spl",
      output: nativeCurrency && !isBuy ? "nativeSol" : "spl",
    },
  };
}

/**
 * Native PumpSwap routes through canonical AMM pools and incomplete Pump curves.
 * @remarks Exact input only. Every hop trades in the same direction. Protocol fees apply
 * at the currency end; creator and AMM LP fees apply at the far-token end. Caller-selected
 * routes are never searched or changed. Existing WSOL is used on AMM endpoints; SOL curve
 * endpoints require a WSOL account as a sentinel but transfer wallet lamports directly.
 * Native routes consume their entire input, including synthetic-migration rounding tails.
 * Two to four hops are qualified; longer routes can exhaust the deployed native allocator.
 */
export const pumpRouteAdapter: RouteAdapter = {
  id: "pump-amm",
  programAddresses: [PUMP_AMM_PROGRAM, PUMP_PROGRAM],
  requirements,
  build,
};
