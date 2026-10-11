import { InvalidAccountError } from "../errors";
import { U64_MAX } from "../../shared/numbers";
import { InvalidRequestError } from "../../shared/errors";
import {
  UnsupportedPoolFeatureError,
  InsufficientLiquidityError,
  UnsupportedSwapModeError,
} from "../errors";
import type { Address } from "@solana/kit";
import { TOKEN_PROGRAM, readMint, readTokenAccount } from "../accounts/tokens";
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
import { METADAO_PROGRAM } from "./constants";
import { spot_swap } from "./instructions/index";
import {
  getMetaDaoTokenVaultAddress,
  findMetaDaoDaoPda,
  findMetaDaoEventAuthorityPda,
} from "./pda";
export * from "./pda";
export { METADAO_PROGRAM } from "./constants";

const DAO_DISCRIMINATOR = [163, 9, 47, 31, 52, 85, 197, 49];

interface SpotPool {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseReserves: bigint;
  readonly quoteReserves: bigint;
  readonly baseProtocolFees: bigint;
  readonly quoteProtocolFees: bigint;
  readonly creator: Address;
  readonly nonce: bigint;
  readonly bump: number;
}

function unsupported(feature: string, message: string): never {
  throw new UnsupportedPoolFeatureError({ protocol: "metadao", feature, message });
}

function insufficient(message: string): never {
  throw new InsufficientLiquidityError({ protocol: "metadao", message });
}

function readPool(request: SwapRequest): SpotPool {
  const { data } = requireAccount(
    request.snapshot,
    request.pool,
    "MetaDAO DAO",
    METADAO_PROGRAM,
  );

  if (data.length < 9 || !matchesDiscriminator(data, DAO_DISCRIMINATOR)) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Invalid MetaDAO DAO account discriminator",
    });
  }
  if (data[8] === 1) {
    unsupported(
      "futarchy-state",
      "Only the DAO's standalone spot-pool state is qualified; active conditional markets are unsupported",
    );
  }
  if (data[8] !== 0 || data.length < 569) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "Unsupported or truncated MetaDAO v0.6 DAO layout",
    });
  }

  const view = accountDataView(data);
  const pool: SpotPool = {
    quoteReserves: view.getBigUint64(109, true),
    baseReserves: view.getBigUint64(117, true),
    quoteProtocolFees: view.getBigUint64(125, true),
    baseProtocolFees: view.getBigUint64(133, true),
    baseMint: readAddress(data, 157),
    quoteMint: readAddress(data, 189),
    baseVault: readAddress(data, 221),
    quoteVault: readAddress(data, 253),
    nonce: view.getBigUint64(285, true),
    creator: readAddress(data, 293),
    bump: data[325]!,
  };

  if (
    pool.baseMint === pool.quoteMint ||
    readAddress(data, 390) !== pool.baseMint ||
    readAddress(data, 422) !== pool.quoteMint
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "The DAO and embedded AMM must describe the same distinct mints",
    });
  }
  if (view.getBigUint64(141, true) === 0n && view.getBigUint64(149, true) === 0n) {
    insufficient("MetaDAO spot pool has no liquidity shares");
  }

  const updatedAt = view.getBigInt64(25, true);
  const createdAt = view.getBigInt64(33, true);

  if (
    createdAt < 0n ||
    updatedAt < createdAt ||
    updatedAt > request.snapshot.unixTimestamp
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "MetaDAO oracle timestamps are inconsistent with the supplied chain time",
    });
  }

  validateGovernanceLayout(data, request.pool);

  if (!(
    (request.inputMint === pool.baseMint && request.outputMint === pool.quoteMint) ||
    (request.inputMint === pool.quoteMint && request.outputMint === pool.baseMint)
  )) {
    throw new InvalidRequestError({
      field: "inputMint",
      message: "Requested pair does not match the MetaDAO spot pool",
    });
  }
  if (request.amount.kind === "exactOut") {
    throw new UnsupportedSwapModeError({
      protocol: "metadao",
      mode: "exactOut",
      message: "MetaDAO spotSwap only supports native exact-input execution",
    });
  }

  return pool;
}

/** Validate the variable Borsh tail without assigning trading semantics to governance fields. */
function validateGovernanceLayout(data: Uint8Array, account: Address): void {
  const view = accountDataView(data);
  let offset = 532;
  const spendingLimit = data[offset++];

  if (spendingLimit === 1) {
    if (offset + 12 > data.length) {
      throw new InvalidAccountError({
        address: account,
        message: "Truncated MetaDAO spending limit",
      });
    }

    const members = view.getUint32(offset + 8, true);
    offset += 12 + members * 32;
  } else if (spendingLimit !== 0) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid MetaDAO spending-limit option",
    });
  }

  offset += 34;

  if (offset >= data.length) {
    throw new InvalidAccountError({
      address: account,
      message: "Truncated MetaDAO governance fields",
    });
  }

  const optimisticProposal = data[offset++];

  if (optimisticProposal === 1) {
    offset += 40;
  } else if (optimisticProposal !== 0) {
    throw new InvalidAccountError({
      address: account,
      message: "Invalid MetaDAO optimistic-proposal option",
    });
  }
  if (offset >= data.length || data[offset]! > 1) {
    throw new InvalidAccountError({
      address: account,
      message: "Truncated or invalid MetaDAO governance flag",
    });
  }
}

async function validateAddresses(request: SwapRequest, pool: SpotPool): Promise<Address> {
  const [[expectedPool, bump], baseVault, quoteVault, [eventAuthority]] =
    await Promise.all([
      findMetaDaoDaoPda(pool.creator, pool.nonce),
      getMetaDaoTokenVaultAddress(request.pool, pool.baseMint),
      getMetaDaoTokenVaultAddress(request.pool, pool.quoteMint),
      findMetaDaoEventAuthorityPda(),
    ]);

  if (
    expectedPool !== request.pool ||
    bump !== pool.bump ||
    baseVault !== pool.baseVault ||
    quoteVault !== pool.quoteVault
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "MetaDAO DAO PDA, bump, or vault addresses do not match their derivation",
    });
  }

  return eventAuthority;
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const pool = readPool(request);
  await validateAddresses(request, pool);

  return [
    { address: request.pool, role: "MetaDAO DAO" },
    { address: pool.baseMint, role: "base mint" },
    { address: pool.quoteMint, role: "quote mint" },
    { address: pool.baseVault, role: "base vault" },
    { address: pool.quoteVault, role: "quote vault" },
  ];
}

async function build(
  request: SwapRequest,
  tokenAccounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  const pool = readPool(request);
  const eventAuthority = await validateAddresses(request, pool);

  for (const mint of [pool.baseMint, pool.quoteMint]) {
    if (readMint(request.snapshot, mint).tokenProgram !== TOKEN_PROGRAM) {
      unsupported("token-2022", "MetaDAO spotSwap supports classic SPL Token only");
    }
  }

  const baseVault = readTokenAccount(
    request.snapshot,
    pool.baseVault,
    pool.baseMint,
    TOKEN_PROGRAM,
    request.pool,
  );
  const quoteVault = readTokenAccount(
    request.snapshot,
    pool.quoteVault,
    pool.quoteMint,
    TOKEN_PROGRAM,
    request.pool,
  );

  if (
    [pool.baseVault, pool.quoteVault].some(
      (vault) => vault === tokenAccounts.input || vault === tokenAccounts.output,
    )
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "User accounts must differ from MetaDAO vaults",
    });
  }
  if (
    pool.baseReserves + pool.baseProtocolFees > baseVault.amount ||
    pool.quoteReserves + pool.quoteProtocolFees > quoteVault.amount
  ) {
    throw new InvalidAccountError({
      address: request.pool,
      message: "MetaDAO reserves and accrued fees exceed the supplied vault balances",
    });
  }
  if (request.amount.kind !== "exactIn") {
    throw new UnsupportedSwapModeError({
      protocol: "metadao",
      mode: "exactOut",
      message: "MetaDAO spotSwap only supports exact input",
    });
  }

  const buy = request.inputMint === pool.quoteMint;
  const reserveIn = buy ? pool.quoteReserves : pool.baseReserves;
  const reserveOut = buy ? pool.baseReserves : pool.quoteReserves;
  const amountIn = request.amount.amountIn;
  const protocolFee = (amountIn + 199n) / 200n;
  const curveInput = amountIn - protocolFee;

  if (reserveIn === 0n || reserveOut === 0n) {
    insufficient("MetaDAO spot reserves are exhausted");
  }

  const output = (curveInput * reserveOut) / (reserveIn + curveInput);

  if (output <= 0n || output >= reserveOut) {
    insufficient("MetaDAO cannot produce a positive, fully funded output for this input");
  }
  if (
    (buy ? quoteVault.amount : baseVault.amount) + amountIn > U64_MAX ||
    (buy ? pool.quoteProtocolFees : pool.baseProtocolFees) + protocolFee > U64_MAX
  ) {
    insufficient("MetaDAO input would overflow a vault or protocol-fee accumulator");
  }

  const minimumAmountOut = minimumOutput(output, request.slippageBps);

  return {
    instructions: [
      spot_swap(
        {
          dao: request.pool,
          userBaseAccount: buy ? tokenAccounts.output : tokenAccounts.input,
          userQuoteAccount: buy ? tokenAccounts.input : tokenAccounts.output,
          ammBaseVault: pool.baseVault,
          ammQuoteVault: pool.quoteVault,
          user: request.owner,
          eventAuthority,
        },
        { amountIn, direction: buy ? "buy" : "sell", minimumAmountOut },
      ),
    ],
    quote: {
      kind: "exactIn",
      amountIn,
      expectedAmountIn: amountIn,
      expectedAmountOut: output,
      minimumAmountOut,
      fees: [{ kind: "trade", mint: request.inputMint, amount: protocolFee }],
    },
    mayPartiallyFill: false,
  };
}

/**
 * Offline native MetaDAO v0.6 spot swaps for classic SPL Token pairs.
 * @remarks The caller supplies raw DAO/vault observations and chain time. The 50-basis-point
 * input fee rounds up; constant-product output rounds down. Quotes use recorded reserves,
 * excluding accrued protocol fees and vault donations. Active futarchy state, Token-2022,
 * exact output, and amounts yielding no output are explicitly rejected. Interface facts
 * come from the published IDL; quote arithmetic is independently authored and validated natively.
 */
export const metadaoAdapter: ProtocolAdapter = {
  id: "metadao",
  programAddresses: [METADAO_PROGRAM],
  requirements,
  build,
};
