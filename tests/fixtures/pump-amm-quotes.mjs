import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import {
  PUMP,
  PUMP_AMM,
  FEE_PROGRAM,
  TOKEN,
  SOL,
  SYSTEM,
  deterministicAddress,
  ata,
  pda,
  mintData,
  tokenData,
} from "./pump-amm.mjs";
export const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const NATIVE_2022 = address("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
const encoder = getAddressEncoder();
const utf8 = new TextEncoder();
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function key(data, offset, value) {
  data.set(encoder.encode(value), offset);
}
function rates(data, offset, values) {
  values.forEach((v, i) => u64(data, offset + i * 8, v));
}
/** Caller snapshots with independently chosen schedules and modern quote assets; all balances synthetic. */
export async function pumpAmmQuotesFixture(
  owner,
  {
    label = "quote-assets",
    quote = "usdc",
    baseTokenProgram = TOKEN,
    quoteTokenProgram = TOKEN,
    canonical = true,
    holderRewards = false,
    creatorFeeConfigurable = false,
    creatorFeeBps = 0n,
    baseReserve = 200_000_000_000_000n,
    quoteReserve = 85_000_000_000n,
    virtualQuoteReserves = -300n,
    protocolFees = 100n,
    creatorFees = 200n,
    feeConfigSize = 4097,
    exoticFees = [31n, 17n, 13n],
    flatFees = [7n, 11n, 19n],
    solFees = [23n, 29n, 31n],
    stableFees = [37n, 41n, 43n],
    reverse = false,
  } = {},
) {
  const mint = deterministicAddress(`new-base:${label}`);
  const quoteMint =
    quote === "usdc"
      ? USDC
      : quote === "sol"
        ? SOL
        : quote === "native2022"
          ? NATIVE_2022
          : deterministicAddress(`new-quote:${label}`);
  const creator = canonical
    ? await pda(PUMP, "pool-authority", mint)
    : deterministicAddress(`new-creator:${label}`);
  const coinCreator = holderRewards
    ? await pda(PUMP, "holder-rewards", mint)
    : deterministicAddress(`new-coin-creator:${label}`);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: PUMP_AMM,
    seeds: [
      utf8.encode("pool"),
      new Uint8Array(2),
      ...[creator, mint, quoteMint].map((k) => encoder.encode(k)),
    ],
  });
  const baseVault = await ata(pool, mint, baseTokenProgram);
  const quoteVault = await ata(pool, quoteMint, quoteTokenProgram);
  const userBase = await ata(owner, mint, baseTokenProgram);
  const userQuote = await ata(owner, quoteMint, quoteTokenProgram);
  const global = await pda(PUMP_AMM, "global_config");
  const feeConfig = await pda(FEE_PROGRAM, "fee_config", PUMP_AMM);
  const buyback = deterministicAddress("new-buyback");
  const buybackAta = await ata(buyback, quoteMint, quoteTokenProgram);
  const poolData = new Uint8Array(287);
  poolData.set([241, 154, 109, 4, 17, 177, 109, 188]);
  poolData[8] = bump;
  for (const [offset, value] of [
    [11, creator],
    [43, mint],
    [75, quoteMint],
    [107, deterministicAddress(`new-lp:${label}`)],
    [139, baseVault],
    [171, quoteVault],
    [211, coinCreator],
  ])
    key(poolData, offset, value);
  u64(poolData, 203, 1_000_000_000n);
  new DataView(poolData.buffer).setBigUint64(
    245,
    BigInt.asUintN(64, virtualQuoteReserves),
    true,
  );
  new DataView(poolData.buffer).setBigInt64(253, virtualQuoteReserves >> 64n, true);
  u64(poolData, 261, creatorFeeBps);
  poolData[269] = 1;
  poolData[270] = Number(holderRewards);
  u64(poolData, 271, protocolFees);
  u64(poolData, 279, creatorFees);
  const globalData = new Uint8Array(949);
  globalData.set([149, 8, 156, 202, 160, 252, 176, 217]);
  key(globalData, 643, buyback);
  u64(globalData, 899, 5000n);
  globalData[940] = Number(creatorFeeConfigurable);
  u64(globalData, 941, 1000n);
  const feeData = new Uint8Array(feeConfigSize);
  feeData.set([143, 52, 146, 187, 219, 123, 76, 155]);
  feeData[8] = (
    await getProgramDerivedAddress({
      programAddress: FEE_PROGRAM,
      seeds: [utf8.encode("fee_config"), encoder.encode(PUMP_AMM)],
    })
  )[1];
  rates(feeData, 41, flatFees);
  new DataView(feeData.buffer).setUint32(65, 1, true);
  rates(feeData, 85, solFees);
  // New fields immediately follow the actual vector, never its maximum allocated capacity.
  new DataView(feeData.buffer).setUint32(109, 1, true);
  rates(feeData, 129, stableFees);
  rates(feeData, 153, exoticFees);
  const snapshot = { slot: 100n, epoch: 1n, unixTimestamp: 1_700_000_000n, accounts: {} };
  const put = (accountAddress, accountOwner, data, lamports = 10_000_000n) => {
    snapshot.accounts[accountAddress] = {
      address: accountAddress,
      owner: accountOwner,
      data,
      lamports,
      executable: false,
      slot: snapshot.slot,
    };
  };
  put(owner, SYSTEM, new Uint8Array(), 100_000_000_000n);
  put(pool, PUMP_AMM, poolData);
  put(global, PUMP_AMM, globalData);
  put(feeConfig, FEE_PROGRAM, feeData);
  put(mint, baseTokenProgram, mintData());
  const quoteData = mintData(1_000_000_000_000_000n);
  quoteData[44] = quote === "sol" || quote === "native2022" ? 9 : 6;
  put(quoteMint, quoteTokenProgram, quoteData);
  put(baseVault, baseTokenProgram, tokenData(mint, pool, baseReserve));
  put(quoteVault, quoteTokenProgram, tokenData(quoteMint, pool, quoteReserve));
  put(userBase, baseTokenProgram, tokenData(mint, owner, 1n << 63n));
  put(userQuote, quoteTokenProgram, tokenData(quoteMint, owner, 1n << 63n));
  put(buybackAta, quoteTokenProgram, tokenData(quoteMint, buyback, 1_000_000n));
  return {
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint : quoteMint,
      outputMint: reverse ? quoteMint : mint,
      amount: { kind: "exactIn", amountIn: reverse ? 1_000_000_001n : 1_000_003n },
      slippageBps: 0,
      snapshot,
    },
    pool,
    mint,
    quoteMint,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    global,
    feeConfig,
    buyback,
    buybackAta,
    coinCreator,
    baseTokenProgram,
    quoteTokenProgram,
  };
}
