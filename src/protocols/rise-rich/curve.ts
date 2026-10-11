import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Address } from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../../accounts/tokens";
import { assertAmount, ceilDiv, minimumOutput, U64_MAX } from "../../core/amounts";
import { fail } from "../../core/errors";
import { requireAccount } from "../../core/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types";
import {
  invalidAccount,
  accountDataView,
  readAddress,
  matchesDiscriminator,
} from "../shared/accounts";
import { MAYFLOWER_PROGRAM, RISE_RICH_PROGRAM } from "./constants";
import { buy_with_exact_cash_in, sell_with_exact_token_in } from "./instructions/index";
import {
  findRiseRichMayflowerLogPda,
  findRiseRichTenantPda,
  findRiseRichMayflowerTenantPda,
  findRiseRichMayflowerMarketGroupPda,
  findRiseRichMayflowerMarketMetaPda,
  findRiseRichMayflowerLinearMarketPda,
  findRiseRichCashEscrowPda,
  findRiseRichMayflowerLiquidityVaultPda,
  findRiseRichMayflowerGroupRevenueEscrowPda,
  findRiseRichMayflowerTenantRevenueEscrowPda,
  getRiseRichMarketAddresses,
} from "./pda";
export * from "./pda";
export { MAYFLOWER_PROGRAM, RISE_RICH_PROGRAM } from "./constants";

function unsupported(feature: string): never {
  return fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "rise-rich",
    feature,
    message: `Rise ${feature} is not qualified`,
  });
}

function state(
  request: SwapRequest,
  key: Address,
  owner: Address,
  size: number,
  discriminator: readonly number[],
) {
  const account = requireAccount(request.snapshot, key, "Rise/Mayflower state", owner);

  if (account.data.length < size || !matchesDiscriminator(account.data, discriminator)) {
    invalidAccount(key, "Invalid Rise/Mayflower account layout");
  }
  if (account.data.subarray(size).some((b) => b !== 0)) {
    unsupported("nonzero state extension");
  }

  const view = accountDataView(account.data);

  return {
    bytes: account.data,
    view,
  };
}

function market(request: SwapRequest) {
  return state(
    request,
    request.pool,
    RISE_RICH_PROGRAM,
    501,
    [219, 190, 213, 55, 0, 227, 198, 154],
  );
}

async function deriveAddresses(request: SwapRequest) {
  const marketData = market(request);
  const tenant = readAddress(marketData.bytes, 8);
  const marketMeta = readAddress(marketData.bytes, 40);
  const mintToken = readAddress(marketData.bytes, 72);
  const mintMain = readAddress(marketData.bytes, 104);

  if (mintMain !== WRAPPED_SOL_MINT) {
    unsupported("non-WSOL collateral");
  }

  const addresses = await getRiseRichMarketAddresses(tenant, marketMeta, mintMain);

  if (addresses.pool !== request.pool || addresses.marketBump !== marketData.bytes[381]) {
    invalidAccount(request.pool, "Rise market PDA mismatch");
  }

  return {
    marketData,
    tenant,
    marketMeta,
    mintToken,
    mintMain,
    cashEscrow: readAddress(marketData.bytes, 137),
    creatorEscrow: addresses.creatorEscrow,
    teamEscrow: addresses.teamEscrow,
    mayLogAccount: addresses.mayLogAccount,
    eventAuthority: addresses.eventAuthority,
  };
}

async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const keys = await deriveAddresses(request);

  for (const mint of [keys.mintToken, keys.mintMain]) {
    const observation = request.snapshot.accounts[mint];

    if (observation && observation.owner !== TOKEN_PROGRAM_ADDRESS) {
      unsupported("Token-2022 or other token program");
    }
  }

  const result: AccountRequirement[] = [
    { address: request.pool, role: "Rise market" },
    ...[
      keys.tenant,
      keys.marketMeta,
      keys.mintToken,
      keys.mintMain,
      keys.cashEscrow,
      keys.creatorEscrow,
      keys.teamEscrow,
      keys.mayLogAccount,
    ].map((address) => ({ address, role: "Rise dependency" })),
  ];

  if (request.snapshot.accounts[keys.tenant]) {
    const tenantState = state(
      request,
      keys.tenant,
      RISE_RICH_PROGRAM,
      85,
      [61, 43, 215, 51, 232, 242, 209, 170],
    );
    result.push({
      address: readAddress(tenantState.bytes, 52),
      role: "Rise tenant seed",
    });
  }
  if (request.snapshot.accounts[keys.marketMeta]) {
    const meta = state(
      request,
      keys.marketMeta,
      MAYFLOWER_PROGRAM,
      361,
      [95, 146, 205, 231, 152, 205, 151, 183],
    );

    for (const offset of [104, 136, 200, 232, 264]) {
      result.push({
        address: readAddress(meta.bytes, offset),
        role: "Mayflower dependency",
      });
    }

    const group = readAddress(meta.bytes, 104);

    if (request.snapshot.accounts[group]) {
      const groupState = state(
        request,
        group,
        MAYFLOWER_PROGRAM,
        122,
        [131, 205, 141, 87, 148, 210, 33, 36],
      );
      result.push({
        address: readAddress(groupState.bytes, 8),
        role: "Mayflower tenant",
      });
    }
  }

  return result;
}

/** A serialized Rust Decimal as an exact signed base-ten integer ratio. */
function decimal(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 16);
  const flags = view.getUint32(0, true);
  const scale = (flags >>> 16) & 255;

  if ((flags & 0x7f00ffff) !== 0 || scale > 28) {
    unsupported("invalid decimal encoding");
  }

  const coefficient =
    BigInt(view.getUint32(4, true)) +
    (BigInt(view.getUint32(8, true)) << 32n) +
    (BigInt(view.getUint32(12, true)) << 64n);

  return { n: flags >>> 31 === 0 ? coefficient : -coefficient, d: 10n ** BigInt(scale) };
}

function multiply(a: { n: bigint; d: bigint }, b: bigint) {
  return { n: a.n * b, d: a.d };
}

function subtract(a: { n: bigint; d: bigint }, b: { n: bigint; d: bigint }) {
  return { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
}

async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  if (request.amount.kind !== "exactIn") {
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "rise-rich",
      mode: request.amount.kind,
      message: "Rise exposes native exact-input swaps only",
    });
  }

  const keys = await deriveAddresses(request);
  const buy =
    request.inputMint === keys.mintMain && request.outputMint === keys.mintToken;
  const sell =
    request.inputMint === keys.mintToken && request.outputMint === keys.mintMain;

  if (!buy && !sell) {
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested pair does not match Rise market",
    });
  }

  const meta = state(
    request,
    keys.marketMeta,
    MAYFLOWER_PROGRAM,
    361,
    [95, 146, 205, 231, 152, 205, 151, 183],
  );
  const group = state(
    request,
    readAddress(meta.bytes, 104),
    MAYFLOWER_PROGRAM,
    122,
    [131, 205, 141, 87, 148, 210, 33, 36],
  );
  const mayTenant = state(
    request,
    readAddress(group.bytes, 8),
    MAYFLOWER_PROGRAM,
    79,
    [61, 43, 215, 51, 232, 242, 209, 170],
  );
  const tenant = state(
    request,
    keys.tenant,
    RISE_RICH_PROGRAM,
    85,
    [61, 43, 215, 51, 232, 242, 209, 170],
  );
  const linear = state(
    request,
    readAddress(meta.bytes, 136),
    MAYFLOWER_PROGRAM,
    176,
    [133, 114, 237, 100, 77, 96, 120, 49],
  );
  const log = state(
    request,
    keys.mayLogAccount,
    MAYFLOWER_PROGRAM,
    17,
    [21, 166, 62, 121, 167, 196, 176, 195],
  );
  const logPda = await findRiseRichMayflowerLogPda();

  if (log.bytes[16] !== logPda[1] || log.view.getBigUint64(8, true) > U64_MAX - 3n) {
    invalidAccount(
      keys.mayLogAccount,
      "Invalid Mayflower log bump or exhausted event counter",
    );
  }
  if (group.bytes[72] !== 0 || mayTenant.bytes[73] !== 0) {
    unsupported("pending Mayflower authority transfer");
  }

  const [tenantPda, mayTenantPda, groupPda, metaPda, linearPda, cashEscrowPda] =
    await Promise.all([
      findRiseRichTenantPda(readAddress(tenant.bytes, 52)),
      findRiseRichMayflowerTenantPda(readAddress(mayTenant.bytes, 8)),
      findRiseRichMayflowerMarketGroupPda(readAddress(group.bytes, 74)),
      findRiseRichMayflowerMarketMetaPda(readAddress(meta.bytes, 297)),
      findRiseRichMayflowerLinearMarketPda(keys.marketMeta),
      findRiseRichCashEscrowPda(request.pool),
    ]);

  if (
    tenantPda[0] !== keys.tenant ||
    tenantPda[1] !== tenant.bytes[84] ||
    mayTenantPda[0] !== readAddress(group.bytes, 8) ||
    mayTenantPda[1] !== mayTenant.bytes[40] ||
    groupPda[0] !== readAddress(meta.bytes, 104) ||
    groupPda[1] !== group.bytes[73] ||
    metaPda[0] !== keys.marketMeta ||
    metaPda[1] !== meta.bytes[296] ||
    linearPda[0] !== readAddress(meta.bytes, 136) ||
    cashEscrowPda[0] !== keys.cashEscrow
  ) {
    invalidAccount(request.pool, "Rise/Mayflower PDA mismatch");
  }
  if (
    readAddress(meta.bytes, 8) !== keys.mintMain ||
    readAddress(meta.bytes, 40) !== keys.mintToken ||
    readAddress(meta.bytes, 168) !== TOKEN_PROGRAM_ADDRESS ||
    readAddress(linear.bytes, 8) !== keys.marketMeta ||
    readAddress(group.bytes, 40) !== keys.tenant
  ) {
    invalidAccount(request.pool, "Rise/Mayflower linkage mismatch");
  }
  if (
    meta.view.getUint16(330, true) !== 65535 ||
    keys.marketData.view.getUint16(418, true) !== 65535
  ) {
    unsupported("restricted trading permissions");
  }
  if (meta.view.getBigUint64(332, true) > request.snapshot.unixTimestamp) {
    unsupported("market not started");
  }
  if (meta.bytes.subarray(340, 360).some((b) => b !== 0)) {
    unsupported("Dutch auction configuration");
  }
  if (meta.bytes[360] !== 0) {
    unsupported("nonzero token unit scale");
  }

  const mint = readMint(request.snapshot, keys.mintToken);
  const main = readMint(request.snapshot, keys.mintMain);

  if (
    mint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    main.tokenProgram !== TOKEN_PROGRAM_ADDRESS
  ) {
    unsupported("Token-2022");
  }
  if (main.decimals !== meta.bytes[329] || main.decimals !== keys.marketData.bytes[136]) {
    invalidAccount(keys.mintMain, "Rise main-token decimals mismatch");
  }

  const supply = linear.view.getBigUint64(40, true);
  const liquidity = linear.view.getBigUint64(48, true);
  const mintAccount = requireAccount(
    request.snapshot,
    keys.mintToken,
    "Rise mint authority",
    TOKEN_PROGRAM_ADDRESS,
  );
  const mintView = accountDataView(mintAccount.data);

  if (
    mintView.getUint32(0, true) !== 1 ||
    readAddress(mintAccount.data, 4) !== keys.marketMeta
  ) {
    invalidAccount(
      keys.mintToken,
      "Rise mint authority is not the Mayflower market metadata PDA",
    );
  }
  if (mint.supply !== supply) {
    invalidAccount(keys.mintToken, "Rise mint supply disagrees with Mayflower state");
  }

  const floor = decimal(linear.bytes, 104);
  const m1 = decimal(linear.bytes, 120);
  const m2 = decimal(linear.bytes, 136);
  const x2 = linear.view.getBigUint64(152, true);
  const b2 = decimal(linear.bytes, 160);

  if (floor.n <= 0n || m1.n <= 0n || m2.n <= 0n || m1.n * m2.d < m2.n * m1.d) {
    unsupported("invalid linear curve parameters");
  }

  const b1 = subtract(b2, multiply(subtract(m1, m2), x2));
  const floorEndNumerator = (floor.n * b1.d - b1.n * floor.d) * m1.d;
  const floorEndDenominator = floor.d * b1.d * m1.n;

  if (floorEndNumerator < 0n || floorEndNumerator > x2 * floorEndDenominator) {
    unsupported("invalid floor-to-shoulder boundary");
  }

  const feeRate = BigInt(group.view.getUint32(buy ? 106 : 110, true));
  const platformShare = BigInt(mayTenant.view.getUint32(74, true));

  if (feeRate >= 1_000_000n || platformShare > 1_000_000n) {
    invalidAccount(readAddress(meta.bytes, 104), "Invalid Mayflower fee rate");
  }
  if (BigInt(keys.marketData.view.getUint32(buy ? 169 : 201, true)) !== feeRate) {
    invalidAccount(request.pool, "Rise governance and Mayflower fee rates disagree");
  }

  const amount = request.amount.amountIn;
  let output: bigint;
  let fee: bigint;

  if (buy) {
    fee = ceilDiv(amount * feeRate, 1_000_000n);
    output = ((amount - fee) * floor.d) / floor.n;

    if ((supply + output) * floorEndDenominator > floorEndNumerator) {
      unsupported("swap enters the sloped curve region");
    }
  } else {
    if (amount > supply) {
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "rise-rich",
        message: "Rise token input exceeds issued supply",
      });
    }
    if (supply * floorEndDenominator > floorEndNumerator) {
      unsupported("swap starts in the sloped curve region");
    }

    const gross = (amount * floor.n) / floor.d;
    fee = ceilDiv(gross * feeRate, 1_000_000n);
    output = gross - fee;

    if (gross > liquidity) {
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "rise-rich",
        message: "Rise sell exceeds available liquidity",
      });
    }
  }
  if ((buy ? amount : output) < 700_000n) {
    fail({
      code: "INVALID_REQUEST",
      field: "amount",
      message:
        "Rise WSOL swaps require at least 700,000 lamports of buy input or net sell output",
    });
  }

  assertAmount(output, "expectedAmountOut");

  if (keys.marketData.bytes[484]! > 25) {
    invalidAccount(request.pool, "Rise creator revenue share exceeds 25 percent");
  }

  const vaultAddresses = [
    keys.cashEscrow,
    keys.creatorEscrow,
    keys.teamEscrow,
    readAddress(meta.bytes, 200),
    readAddress(meta.bytes, 232),
    readAddress(meta.bytes, 264),
  ];

  if (
    new Set(vaultAddresses).size !== vaultAddresses.length ||
    vaultAddresses.some(
      (vaultAddress) =>
        vaultAddress === accounts.input || vaultAddress === accounts.output,
    )
  ) {
    unsupported("aliased settlement accounts");
  }

  const settlementVaults = await Promise.all([
    findRiseRichMayflowerLiquidityVaultPda(keys.marketMeta),
    findRiseRichMayflowerGroupRevenueEscrowPda(keys.marketMeta),
    findRiseRichMayflowerTenantRevenueEscrowPda(keys.marketMeta),
  ]);

  for (const [index, offset] of [200, 232, 264].entries()) {
    if (settlementVaults[index]![0] !== readAddress(meta.bytes, offset)) {
      invalidAccount(keys.marketMeta, "Mayflower vault PDA mismatch");
    }
  }
  for (const vaultAddress of vaultAddresses) {
    const observed = readTokenAccount(
      request.snapshot,
      vaultAddress,
      keys.mintMain,
      TOKEN_PROGRAM_ADDRESS,
    );

    if (observed.amount + (buy ? amount : fee) > U64_MAX) {
      invalidAccount(vaultAddress, "Rise settlement balance could overflow u64");
    }
    if (
      vaultAddress === readAddress(meta.bytes, 200) &&
      (observed.authority !== keys.marketMeta || observed.amount < liquidity)
    ) {
      invalidAccount(vaultAddress, "Mayflower vault authority or liquidity mismatch");
    }
  }
  if (buy && (supply + output > U64_MAX || liquidity + amount - fee > U64_MAX)) {
    invalidAccount(readAddress(meta.bytes, 136), "Mayflower state would overflow u64");
  }

  const outputState = request.snapshot.accounts[accounts.output];

  if (
    outputState &&
    readTokenAccount(
      request.snapshot,
      accounts.output,
      request.outputMint,
      TOKEN_PROGRAM_ADDRESS,
      request.owner,
    ).amount +
      output >
      U64_MAX
  ) {
    invalidAccount(accounts.output, "Rise output balance would overflow u64");
  }

  const quote = {
    kind: "exactIn" as const,
    amountIn: amount,
    expectedAmountIn: amount,
    expectedAmountOut: output,
    minimumAmountOut: minimumOutput(output, request.slippageBps),
    fees: [{ kind: "trade" as const, mint: keys.mintMain, amount: fee }],
  };
  const instructionAccounts = {
    buyer: request.owner,
    seller: request.owner,
    tenant: keys.tenant,
    market: request.pool,
    cashEscrow: keys.cashEscrow,
    mayTenant: readAddress(group.bytes, 8),
    mayMarketGroup: readAddress(meta.bytes, 104),
    marketMeta: keys.marketMeta,
    mayMarket: readAddress(meta.bytes, 136),
    tenantSeed: readAddress(tenant.bytes, 52),
    mintToken: keys.mintToken,
    mintMain: keys.mintMain,
    tokenDst: accounts.output,
    mainSrc: accounts.input,
    tokenSrc: accounts.input,
    mainDst: accounts.output,
    liqVaultMain: readAddress(meta.bytes, 200),
    revEscrowGroup: readAddress(meta.bytes, 232),
    revEscrowTenant: readAddress(meta.bytes, 264),
    tokenProgramMain: TOKEN_PROGRAM_ADDRESS,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mayflowerProgram: MAYFLOWER_PROGRAM,
    mayLogAccount: keys.mayLogAccount,
    creatorEscrow: keys.creatorEscrow,
    teamEscrow: keys.teamEscrow,
    eventAuthority: keys.eventAuthority,
    program: RISE_RICH_PROGRAM,
  };
  const instruction = buy
    ? buy_with_exact_cash_in(instructionAccounts, {
        cashIn: amount,
        minTokenOut: quote.minimumAmountOut,
        newShoulderEnd: 0n,
        floorIncreaseRatio: new Uint8Array(16),
        maxNewFloor: new Uint8Array(16),
        maxAreaShrinkageToleranceUnits: 100_000_000n,
        minLiqRatio: new Uint8Array(16),
      })
    : sell_with_exact_token_in(instructionAccounts, {
        tokenIn: amount,
        minCashOut: quote.minimumAmountOut,
      });

  return { instructions: [instruction], quote, mayPartiallyFill: false };
}

/** Offline native exact-input swaps wholly within Rise's constant-price floor region.
 * @remarks Uses prewrapped WSOL collateral. Buy input and net sell output must be at least 700,000 lamports.
 * Floor raises, Dutch auctions,
 * scaled/sloped curves, Token-2022 and restricted permissions are rejected explicitly.
 */
export const riseRichAdapter: ProtocolAdapter = {
  id: "rise-rich",
  programAddresses: [RISE_RICH_PROGRAM],
  requirements,
  build,
};
