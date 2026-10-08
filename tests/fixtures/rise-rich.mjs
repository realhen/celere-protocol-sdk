import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  MAYFLOWER_PROGRAM,
  RISE_RICH_PROGRAM,
} from "../../dist/protocols/rise-rich/constants.js";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder(),
  text = new TextEncoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-rise:${label}`).digest());
}
function bytes(name, size) {
  const b = new Uint8Array(size);
  b.set(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8));
  return b;
}
function pub(d, o, k) {
  d.set(encoder.encode(k), o);
}
function u64(d, o, n) {
  new DataView(d.buffer).setBigUint64(o, n, true);
}
function u32(d, o, n) {
  new DataView(d.buffer).setUint32(o, n, true);
}
function decimal(d, o, n, scale = 0, negative = false) {
  u32(d, o, (scale << 16) + (negative ? 0x80000000 : 0));
  u32(d, o + 4, Number(n & 0xffffffffn));
  u32(d, o + 8, Number((n >> 32n) & 0xffffffffn));
  u32(d, o + 12, Number(n >> 64n));
}
function token(mint, owner, amount) {
  const d = new Uint8Array(165);
  pub(d, 0, mint);
  pub(d, 32, owner);
  u64(d, 64, amount);
  d[108] = 1;
  if (mint === WRAPPED_SOL_MINT) {
    u32(d, 109, 1);
    u64(d, 113, 2_039_280n);
  }
  return d;
}
async function pda(program, name, ...seeds) {
  return getProgramDerivedAddress({
    programAddress: program,
    seeds: [text.encode(name), ...seeds.map((s) => encoder.encode(s))],
  });
}
/** Entirely synthetic Rise/Mayflower state, with a valid floor region and plain SPL token accounts. */
export async function riseRichFixture(
  owner,
  {
    label = "default",
    buy = true,
    feeRate = 0,
    platformShare = 0,
    floor = 1n,
    floorScale = 0,
    mainIntercept = 0n,
    supply = 1_000_000_000n,
  } = {},
) {
  const mint = key(`mint:${label}`),
    main = WRAPPED_SOL_MINT,
    tenantSeed = key(`tenant-seed:${label}`),
    maySeed = key(`may-seed:${label}`),
    groupSeed = key(`group-seed:${label}`),
    metaSeed = key(`meta-seed:${label}`);
  const [tenant, tenantBump] = await pda(RISE_RICH_PROGRAM, "tenant", tenantSeed);
  const [mayTenant, mayTenantBump] = await pda(MAYFLOWER_PROGRAM, "tenant", maySeed);
  const [mayMarketGroup, groupBump] = await pda(
    MAYFLOWER_PROGRAM,
    "market_group",
    groupSeed,
  );
  const [marketMeta, metaBump] = await pda(MAYFLOWER_PROGRAM, "market_meta", metaSeed);
  const [mayMarket] = await pda(MAYFLOWER_PROGRAM, "market_linear", marketMeta);
  const [pool, bump] = await pda(RISE_RICH_PROGRAM, "market", tenant, marketMeta);
  const [cashEscrow] = await pda(RISE_RICH_PROGRAM, "cash_escrow", pool),
    [creatorEscrow] = await pda(RISE_RICH_PROGRAM, "creator_escrow", pool),
    [teamEscrow] = await pda(RISE_RICH_PROGRAM, "team_escrow", main);
  const [liqVaultMain] = await pda(MAYFLOWER_PROGRAM, "liq_vault_main", marketMeta),
    [revEscrowGroup] = await pda(MAYFLOWER_PROGRAM, "rev_escrow_group", marketMeta),
    [revEscrowTenant] = await pda(MAYFLOWER_PROGRAM, "rev_escrow_tenant", marketMeta),
    [mintOptions] = await pda(MAYFLOWER_PROGRAM, "mint_options", marketMeta),
    [mayLogAccount, logBump] = await pda(MAYFLOWER_PROGRAM, "log"),
    [eventAuthority] = await pda(RISE_RICH_PROGRAM, "__event_authority");
  const [userToken] = await findAssociatedTokenPda({
      mint,
      owner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    [userMain] = await findAssociatedTokenPda({
      mint: main,
      owner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
  const market = bytes("Market", 598);
  pub(market, 8, tenant);
  pub(market, 40, marketMeta);
  pub(market, 72, mint);
  pub(market, 104, main);
  market[136] = 9;
  pub(market, 137, cashEscrow);
  u32(market, 169, feeRate);
  u32(market, 201, feeRate);
  market[381] = bump;
  new DataView(market.buffer).setUint16(418, 65535, true);
  market[484] = 25;
  decimal(market, 485, floor, floorScale);
  const tenantData = bytes("Tenant", 213);
  pub(tenantData, 8, owner);
  pub(tenantData, 52, tenantSeed);
  tenantData[84] = tenantBump;
  const mayTenantData = bytes("Tenant", 111);
  pub(mayTenantData, 8, maySeed);
  mayTenantData[40] = mayTenantBump;
  pub(mayTenantData, 41, owner);
  u32(mayTenantData, 74, platformShare);
  const group = bytes("MarketGroup", 154);
  pub(group, 8, mayTenant);
  pub(group, 40, tenant);
  group[73] = groupBump;
  pub(group, 74, groupSeed);
  u32(group, 106, feeRate);
  u32(group, 110, feeRate);
  const meta = bytes("MarketMeta", 489);
  for (const [i, k] of [
    main,
    mint,
    mintOptions,
    mayMarketGroup,
    mayMarket,
    TOKEN_PROGRAM_ADDRESS,
    liqVaultMain,
    revEscrowGroup,
    revEscrowTenant,
  ].entries())
    pub(meta, 8 + i * 32, k);
  meta[296] = metaBump;
  pub(meta, 297, metaSeed);
  meta[329] = 9;
  new DataView(meta.buffer).setUint16(330, 65535, true);
  const linear = bytes("MarketLinear", 304);
  pub(linear, 8, marketMeta);
  u64(linear, 40, supply);
  u64(linear, 48, 1_000_000_000_000n);
  decimal(linear, 104, floor, floorScale);
  decimal(linear, 120, 1n, 9);
  decimal(linear, 136, 1n, 10);
  u64(linear, 152, 1_000_000_000_000n);
  decimal(
    linear,
    160,
    mainIntercept < 0n ? -mainIntercept : mainIntercept,
    0,
    mainIntercept < 0n,
  );
  const log = bytes("LogAccount", 17);
  log[16] = logBump;
  const md = new Uint8Array(82);
  u32(md, 0, 1);
  pub(md, 4, marketMeta);
  u64(md, 36, supply);
  md[44] = 9;
  md[45] = 1;
  const mainData = new Uint8Array(82);
  mainData[44] = 9;
  mainData[45] = 1;
  const accounts = {};
  function add(address, accountOwner, data, lamports = 100_000_000n) {
    accounts[address] = {
      address,
      owner: accountOwner,
      data,
      lamports,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, RISE_RICH_PROGRAM, market);
  add(tenant, RISE_RICH_PROGRAM, tenantData);
  add(tenantSeed, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  add(mayTenant, MAYFLOWER_PROGRAM, mayTenantData);
  add(mayMarketGroup, MAYFLOWER_PROGRAM, group);
  add(marketMeta, MAYFLOWER_PROGRAM, meta);
  add(mayMarket, MAYFLOWER_PROGRAM, linear);
  add(mayLogAccount, MAYFLOWER_PROGRAM, log);
  add(mint, TOKEN_PROGRAM_ADDRESS, md);
  add(main, TOKEN_PROGRAM_ADDRESS, mainData);
  for (const [addr, authority, amount] of [
    [cashEscrow, pool, 0n],
    [creatorEscrow, pool, 0n],
    [teamEscrow, tenant, 0n],
    [liqVaultMain, marketMeta, 1_000_000_000_000n],
    [revEscrowGroup, marketMeta, 0n],
    [revEscrowTenant, marketMeta, 0n],
    [userMain, owner, 1_000_000_000_000n],
  ])
    add(addr, TOKEN_PROGRAM_ADDRESS, token(main, authority, amount), amount + 2_039_280n);
  add(userToken, TOKEN_PROGRAM_ADDRESS, token(mint, owner, 100_000_000n));
  const instructionAccounts = {
    buyer: owner,
    seller: owner,
    tenant,
    market: pool,
    cashEscrow,
    mayTenant,
    mayMarketGroup,
    marketMeta,
    mayMarket,
    tenantSeed,
    mintToken: mint,
    mintMain: main,
    tokenDst: userToken,
    mainSrc: userMain,
    tokenSrc: userToken,
    mainDst: userMain,
    liqVaultMain,
    revEscrowGroup,
    revEscrowTenant,
    tokenProgramMain: TOKEN_PROGRAM_ADDRESS,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mayflowerProgram: MAYFLOWER_PROGRAM,
    mayLogAccount,
    creatorEscrow,
    teamEscrow,
    eventAuthority,
    program: RISE_RICH_PROGRAM,
  };
  return {
    pool,
    mint,
    main,
    userToken,
    userMain,
    tenant,
    marketMeta,
    mayMarket,
    mayMarketGroup,
    mayTenant,
    liqVaultMain,
    revEscrowGroup,
    revEscrowTenant,
    cashEscrow,
    creatorEscrow,
    teamEscrow,
    instructionAccounts,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: buy ? main : mint,
      outputMint: buy ? mint : main,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 0,
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
