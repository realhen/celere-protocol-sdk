import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../../accounts/tokens.js";
import { assertAmount, ceilDiv, minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import { MAYFLOWER_PROGRAM, RISE_RICH_PROGRAM } from "./constants.js";
import {
  buy_with_exact_cash_in,
  sell_with_exact_token_in,
} from "./instructions/index.js";
export { MAYFLOWER_PROGRAM, RISE_RICH_PROGRAM } from "./constants.js";
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder(),
  text = new TextEncoder();
function invalid(address: Address, message: string): never {
  return fail({ code: "INVALID_ACCOUNT", address, message });
}
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
  if (account.data.length < size || !discriminator.every((b, i) => account.data[i] === b))
    invalid(key, "Invalid Rise/Mayflower account layout");
  if (account.data.subarray(size).some((b) => b !== 0))
    unsupported("nonzero state extension");
  const view = new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  );
  return {
    bytes: account.data,
    view,
    pub: (offset: number) => decoder.decode(account.data.subarray(offset, offset + 32)),
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
async function pda(program: Address, name: string, ...keys: Address[]) {
  return getProgramDerivedAddress({
    programAddress: program,
    seeds: [text.encode(name), ...keys.map((k) => encoder.encode(k))],
  });
}
async function deriveAddresses(request: SwapRequest) {
  const marketData = market(request);
  const tenant = marketData.pub(8),
    marketMeta = marketData.pub(40),
    mintToken = marketData.pub(72),
    mintMain = marketData.pub(104);
  if (mintMain !== WRAPPED_SOL_MINT) unsupported("non-WSOL collateral");
  const [pool, creator, team, log, event] = await Promise.all([
    pda(RISE_RICH_PROGRAM, "market", tenant, marketMeta),
    pda(RISE_RICH_PROGRAM, "creator_escrow", request.pool),
    pda(RISE_RICH_PROGRAM, "team_escrow", mintMain),
    pda(MAYFLOWER_PROGRAM, "log"),
    pda(RISE_RICH_PROGRAM, "__event_authority"),
  ]);
  if (pool[0] !== request.pool || pool[1] !== marketData.bytes[381])
    invalid(request.pool, "Rise market PDA mismatch");
  return {
    marketData,
    tenant,
    marketMeta,
    mintToken,
    mintMain,
    cashEscrow: marketData.pub(137),
    creatorEscrow: creator[0],
    teamEscrow: team[0],
    mayLogAccount: log[0],
    eventAuthority: event[0],
  };
}
async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const keys = await deriveAddresses(request);
  for (const mint of [keys.mintToken, keys.mintMain]) {
    const observation = request.snapshot.accounts[mint];
    if (observation && observation.owner !== TOKEN_PROGRAM_ADDRESS)
      unsupported("Token-2022 or other token program");
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
    const t = state(
      request,
      keys.tenant,
      RISE_RICH_PROGRAM,
      85,
      [61, 43, 215, 51, 232, 242, 209, 170],
    );
    result.push({ address: t.pub(52), role: "Rise tenant seed" });
  }
  if (request.snapshot.accounts[keys.marketMeta]) {
    const meta = state(
      request,
      keys.marketMeta,
      MAYFLOWER_PROGRAM,
      361,
      [95, 146, 205, 231, 152, 205, 151, 183],
    );
    for (const o of [104, 136, 200, 232, 264])
      result.push({ address: meta.pub(o), role: "Mayflower dependency" });
    const group = meta.pub(104);
    if (request.snapshot.accounts[group]) {
      const g = state(
        request,
        group,
        MAYFLOWER_PROGRAM,
        122,
        [131, 205, 141, 87, 148, 210, 33, 36],
      );
      result.push({ address: g.pub(8), role: "Mayflower tenant" });
    }
  }
  return result;
}
/** A serialized Rust Decimal as an exact signed base-ten integer ratio. */
function decimal(bytes: Uint8Array, offset: number) {
  const v = new DataView(bytes.buffer, bytes.byteOffset + offset, 16),
    flags = v.getUint32(0, true);
  const scale = (flags >>> 16) & 255;
  if ((flags & 0x7f00ffff) !== 0 || scale > 28) unsupported("invalid decimal encoding");
  const coefficient =
    BigInt(v.getUint32(4, true)) +
    (BigInt(v.getUint32(8, true)) << 32n) +
    (BigInt(v.getUint32(12, true)) << 64n);
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
  if (request.amount.kind !== "exactIn")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "rise-rich",
      mode: request.amount.kind,
      message: "Rise exposes native exact-input swaps only",
    });
  const keys = await deriveAddresses(request),
    buy = request.inputMint === keys.mintMain && request.outputMint === keys.mintToken,
    sell = request.inputMint === keys.mintToken && request.outputMint === keys.mintMain;
  if (!buy && !sell)
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Requested pair does not match Rise market",
    });
  const meta = state(
    request,
    keys.marketMeta,
    MAYFLOWER_PROGRAM,
    361,
    [95, 146, 205, 231, 152, 205, 151, 183],
  );
  const group = state(
    request,
    meta.pub(104),
    MAYFLOWER_PROGRAM,
    122,
    [131, 205, 141, 87, 148, 210, 33, 36],
  );
  const mayTenant = state(
    request,
    group.pub(8),
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
    meta.pub(136),
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
  const logPda = await pda(MAYFLOWER_PROGRAM, "log");
  if (log.bytes[16] !== logPda[1] || log.view.getBigUint64(8, true) > U64_MAX - 3n)
    invalid(keys.mayLogAccount, "Invalid Mayflower log bump or exhausted event counter");
  if (group.bytes[72] !== 0 || mayTenant.bytes[73] !== 0)
    unsupported("pending Mayflower authority transfer");
  const [tenantPda, mayTenantPda, groupPda, metaPda, linearPda, cashEscrowPda] =
    await Promise.all([
      pda(RISE_RICH_PROGRAM, "tenant", tenant.pub(52)),
      pda(MAYFLOWER_PROGRAM, "tenant", mayTenant.pub(8)),
      pda(MAYFLOWER_PROGRAM, "market_group", group.pub(74)),
      pda(MAYFLOWER_PROGRAM, "market_meta", meta.pub(297)),
      pda(MAYFLOWER_PROGRAM, "market_linear", keys.marketMeta),
      pda(RISE_RICH_PROGRAM, "cash_escrow", request.pool),
    ]);
  if (
    tenantPda[0] !== keys.tenant ||
    tenantPda[1] !== tenant.bytes[84] ||
    mayTenantPda[0] !== group.pub(8) ||
    mayTenantPda[1] !== mayTenant.bytes[40] ||
    groupPda[0] !== meta.pub(104) ||
    groupPda[1] !== group.bytes[73] ||
    metaPda[0] !== keys.marketMeta ||
    metaPda[1] !== meta.bytes[296] ||
    linearPda[0] !== meta.pub(136) ||
    cashEscrowPda[0] !== keys.cashEscrow
  )
    invalid(request.pool, "Rise/Mayflower PDA mismatch");
  if (
    meta.pub(8) !== keys.mintMain ||
    meta.pub(40) !== keys.mintToken ||
    meta.pub(168) !== TOKEN_PROGRAM_ADDRESS ||
    linear.pub(8) !== keys.marketMeta ||
    group.pub(40) !== keys.tenant
  )
    invalid(request.pool, "Rise/Mayflower linkage mismatch");
  if (
    meta.view.getUint16(330, true) !== 65535 ||
    keys.marketData.view.getUint16(418, true) !== 65535
  )
    unsupported("restricted trading permissions");
  if (meta.view.getBigUint64(332, true) > request.snapshot.unixTimestamp)
    unsupported("market not started");
  if (meta.bytes.subarray(340, 360).some((b) => b !== 0))
    unsupported("Dutch auction configuration");
  if (meta.bytes[360] !== 0) unsupported("nonzero token unit scale");
  const mint = readMint(request.snapshot, keys.mintToken),
    main = readMint(request.snapshot, keys.mintMain);
  if (
    mint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    main.tokenProgram !== TOKEN_PROGRAM_ADDRESS
  )
    unsupported("Token-2022");
  if (main.decimals !== meta.bytes[329] || main.decimals !== keys.marketData.bytes[136])
    invalid(keys.mintMain, "Rise main-token decimals mismatch");
  const supply = linear.view.getBigUint64(40, true),
    liquidity = linear.view.getBigUint64(48, true);
  const mintAccount = requireAccount(
    request.snapshot,
    keys.mintToken,
    "Rise mint authority",
    TOKEN_PROGRAM_ADDRESS,
  );
  const mintView = new DataView(
    mintAccount.data.buffer,
    mintAccount.data.byteOffset,
    mintAccount.data.byteLength,
  );
  if (
    mintView.getUint32(0, true) !== 1 ||
    decoder.decode(mintAccount.data.subarray(4, 36)) !== keys.marketMeta
  )
    invalid(
      keys.mintToken,
      "Rise mint authority is not the Mayflower market metadata PDA",
    );
  if (mint.supply !== supply)
    invalid(keys.mintToken, "Rise mint supply disagrees with Mayflower state");
  const floor = decimal(linear.bytes, 104),
    m1 = decimal(linear.bytes, 120),
    m2 = decimal(linear.bytes, 136),
    x2 = linear.view.getBigUint64(152, true),
    b2 = decimal(linear.bytes, 160);
  if (floor.n <= 0n || m1.n <= 0n || m2.n <= 0n || m1.n * m2.d < m2.n * m1.d)
    unsupported("invalid linear curve parameters");
  const b1 = subtract(b2, multiply(subtract(m1, m2), x2));
  const floorEndNumerator = (floor.n * b1.d - b1.n * floor.d) * m1.d;
  const floorEndDenominator = floor.d * b1.d * m1.n;
  if (floorEndNumerator < 0n || floorEndNumerator > x2 * floorEndDenominator)
    unsupported("invalid floor-to-shoulder boundary");
  const feeRate = BigInt(group.view.getUint32(buy ? 106 : 110, true)),
    platformShare = BigInt(mayTenant.view.getUint32(74, true));
  if (feeRate >= 1_000_000n || platformShare > 1_000_000n)
    invalid(meta.pub(104), "Invalid Mayflower fee rate");
  if (BigInt(keys.marketData.view.getUint32(buy ? 169 : 201, true)) !== feeRate)
    invalid(request.pool, "Rise governance and Mayflower fee rates disagree");
  const amount = request.amount.amountIn;
  let output: bigint, fee: bigint;
  if (buy) {
    fee = ceilDiv(amount * feeRate, 1_000_000n);
    output = ((amount - fee) * floor.d) / floor.n;
    if ((supply + output) * floorEndDenominator > floorEndNumerator)
      unsupported("swap enters the sloped curve region");
  } else {
    if (amount > supply)
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "rise-rich",
        message: "Rise token input exceeds issued supply",
      });
    if (supply * floorEndDenominator > floorEndNumerator)
      unsupported("swap starts in the sloped curve region");
    const gross = (amount * floor.n) / floor.d;
    fee = ceilDiv(gross * feeRate, 1_000_000n);
    output = gross - fee;
    if (gross > liquidity)
      fail({
        code: "INSUFFICIENT_LIQUIDITY",
        protocol: "rise-rich",
        message: "Rise sell exceeds available liquidity",
      });
  }
  if ((buy ? amount : output) < 700_000n)
    fail({
      code: "INVALID_REQUEST",
      field: "amount",
      message:
        "Rise WSOL swaps require at least 700,000 lamports of buy input or net sell output",
    });
  assertAmount(output, "expectedAmountOut");
  if (keys.marketData.bytes[484]! > 25)
    invalid(request.pool, "Rise creator revenue share exceeds 25 percent");
  const vaultAddresses = [
    keys.cashEscrow,
    keys.creatorEscrow,
    keys.teamEscrow,
    meta.pub(200),
    meta.pub(232),
    meta.pub(264),
  ];
  if (
    new Set(vaultAddresses).size !== vaultAddresses.length ||
    vaultAddresses.some((k) => k === accounts.input || k === accounts.output)
  )
    unsupported("aliased settlement accounts");
  for (const [seed, offset] of [
    ["liq_vault_main", 200],
    ["rev_escrow_group", 232],
    ["rev_escrow_tenant", 264],
  ] as const) {
    if ((await pda(MAYFLOWER_PROGRAM, seed, keys.marketMeta))[0] !== meta.pub(offset))
      invalid(keys.marketMeta, "Mayflower vault PDA mismatch");
  }
  for (const k of vaultAddresses) {
    const observed = readTokenAccount(
      request.snapshot,
      k,
      keys.mintMain,
      TOKEN_PROGRAM_ADDRESS,
    );
    if (observed.amount + (buy ? amount : fee) > U64_MAX)
      invalid(k, "Rise settlement balance could overflow u64");
    if (
      k === meta.pub(200) &&
      (observed.authority !== keys.marketMeta || observed.amount < liquidity)
    )
      invalid(k, "Mayflower vault authority or liquidity mismatch");
  }
  if (buy && (supply + output > U64_MAX || liquidity + amount - fee > U64_MAX))
    invalid(meta.pub(136), "Mayflower state would overflow u64");
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
  )
    invalid(accounts.output, "Rise output balance would overflow u64");
  const quote = {
    kind: "exactIn" as const,
    amountIn: amount,
    expectedAmountIn: amount,
    expectedAmountOut: output,
    minimumAmountOut: minimumOutput(output, request.slippageBps),
    fees: [{ kind: "trade" as const, mint: keys.mintMain, amount: fee }],
  };
  const ixAccounts = {
    buyer: request.owner,
    seller: request.owner,
    tenant: keys.tenant,
    market: request.pool,
    cashEscrow: keys.cashEscrow,
    mayTenant: group.pub(8),
    mayMarketGroup: meta.pub(104),
    marketMeta: keys.marketMeta,
    mayMarket: meta.pub(136),
    tenantSeed: tenant.pub(52),
    mintToken: keys.mintToken,
    mintMain: keys.mintMain,
    tokenDst: accounts.output,
    mainSrc: accounts.input,
    tokenSrc: accounts.input,
    mainDst: accounts.output,
    liqVaultMain: meta.pub(200),
    revEscrowGroup: meta.pub(232),
    revEscrowTenant: meta.pub(264),
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
    ? buy_with_exact_cash_in(ixAccounts, {
        cashIn: amount,
        minTokenOut: quote.minimumAmountOut,
        newShoulderEnd: 0n,
        floorIncreaseRatio: new Uint8Array(16),
        maxNewFloor: new Uint8Array(16),
        maxAreaShrinkageToleranceUnits: 100_000_000n,
        minLiqRatio: new Uint8Array(16),
      })
    : sell_with_exact_token_in(ixAccounts, {
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
