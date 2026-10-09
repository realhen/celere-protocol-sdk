import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { pumpV3Fixture } from "./pump-v3.mjs";
import { pumpAmmQuotesFixture, USDC } from "./pump-amm-quotes.mjs";
import {
  PUMP,
  PUMP_AMM,
  TOKEN,
  TOKEN_2022,
  SOL,
  SYSTEM,
  deterministicAddress,
  ata,
  pda,
  mintData,
  tokenData,
} from "./pump-amm.mjs";
const encoder = getAddressEncoder();
const u64 = (data, offset, value) =>
  new DataView(data.buffer).setBigUint64(offset, value, true);
const key = (data, offset, value) => data.set(encoder.encode(value), offset);

/** Deterministic caller-owned route snapshots; simulator state contains no public user accounts. */
export async function pumpRouteFixture(
  owner,
  {
    kinds = ["pool", "pool"],
    reverse = false,
    currency = "sol",
    token2022 = false,
    crossing = -1,
    label = "route",
  } = {},
) {
  const curveConfig = await pumpV3Fixture(owner, { label: `route-config:${label}` });
  const ammConfig = await pumpAmmQuotesFixture(owner, { label: `route-config:${label}` });
  const snapshot = { slot: 100n, epoch: 1n, unixTimestamp: 1_700_000_000n, accounts: {} };
  const put = (address, owner, data, lamports = 10_000_000n) =>
    (snapshot.accounts[address] = {
      address,
      owner,
      data,
      lamports,
      executable: false,
      slot: snapshot.slot,
    });
  for (const source of [curveConfig, ammConfig])
    for (const address of [source.global, source.feeConfig]) {
      const a = source.request.snapshot.accounts[address];
      put(a.address, a.owner, new Uint8Array(a.data), a.lamports);
    }
  key(snapshot.accounts[ammConfig.global].data, 643, curveConfig.buybackWallet);
  put(owner, SYSTEM, new Uint8Array(), 10_000_000_000_000n);
  const quoteMint =
    currency === "sol"
      ? SOL
      : currency === "usdc"
        ? USDC
        : deterministicAddress(`route-currency:${label}`);
  const mintPath = [
    quoteMint,
    ...kinds.map((_, index) => deterministicAddress(`route-base:${label}:${index}`)),
  ];
  const tokenProgram = token2022 ? TOKEN_2022 : TOKEN;
  const programFor = (mint) => (mint === SOL || mint === USDC ? TOKEN : tokenProgram);
  for (const mint of mintPath) {
    const data = mintData();
    data[44] = mint === SOL ? 9 : 6;
    put(mint, programFor(mint), data);
  }
  const venues = [];
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index],
      baseMint = mintPath[index + 1],
      quoteMint = mintPath[index];
    const creator = await pda(PUMP, "pool-authority", baseMint);
    const [pool, bump] =
      kind === "pool"
        ? await getProgramDerivedAddress({
            programAddress: PUMP_AMM,
            seeds: [
              new TextEncoder().encode("pool"),
              new Uint8Array(2),
              ...[creator, baseMint, quoteMint].map((k) => encoder.encode(k)),
            ],
          })
        : [await pda(PUMP, "bonding-curve", baseMint), 0];
    const baseVault = await ata(pool, baseMint, programFor(baseMint)),
      quoteVault = await ata(pool, quoteMint, programFor(quoteMint));
    const isCrossing = index === crossing;
    const realBase = isCrossing ? 1_000_000n : 600_000_000_000_000n;
    const realQuote = index === 0 ? 85_000_000_000n : 85_000_000_000_000n;
    if (kind === "pool") {
      const data = new Uint8Array(287);
      data.set([241, 154, 109, 4, 17, 177, 109, 188]);
      data[8] = bump;
      for (const [offset, value] of [
        [11, creator],
        [43, baseMint],
        [75, quoteMint],
        [107, deterministicAddress(`route-lp:${index}`)],
        [139, baseVault],
        [171, quoteVault],
        [211, deterministicAddress(`route-creator:${index}`)],
      ])
        key(data, offset, value);
      u64(data, 203, 1_000_000_000n);
      u64(data, 271, 17n);
      u64(data, 279, 11n);
      new DataView(data.buffer).setBigUint64(245, BigInt.asUintN(64, -28n), true);
      new DataView(data.buffer).setBigInt64(253, -1n, true);
      put(pool, PUMP_AMM, data);
    } else {
      const data = new Uint8Array(166);
      data.set([23, 183, 248, 55, 96, 216, 172, 96]);
      u64(data, 8, realBase + 206_900_000_000_000n);
      u64(data, 16, realQuote + (index === 0 ? 30_000_000_000n : 30_000_000_000_000n));
      u64(data, 24, realBase);
      u64(data, 32, realQuote);
      u64(data, 40, 1_000_000_000_000_000n);
      key(data, 49, deterministicAddress(`route-creator:${index}`));
      if (quoteMint !== SOL) key(data, 83, quoteMint);
      u64(data, 125, 11n);
      u64(data, 133, 17n);
      data[141] = index;
      put(pool, PUMP, data, realQuote + 100_000_028n);
    }
    put(
      baseVault,
      programFor(baseMint),
      tokenData(
        baseMint,
        pool,
        kind === "pool" ? 200_000_000_000_000n : realBase + 206_900_000_000_000n,
      ),
    );
    if (kind === "pool" || quoteMint !== SOL)
      put(quoteVault, programFor(quoteMint), tokenData(quoteMint, pool, realQuote + 28n));
    venues.push({ kind, pool, baseMint, quoteMint, baseVault, quoteVault });
  }
  const userQuote = await ata(owner, mintPath[0], programFor(mintPath[0]));
  const userBase = await ata(owner, mintPath.at(-1), programFor(mintPath.at(-1)));
  put(
    userQuote,
    programFor(mintPath[0]),
    tokenData(mintPath[0], owner, 1_000_000_000_000n),
  );
  put(
    userBase,
    programFor(mintPath.at(-1)),
    tokenData(mintPath.at(-1), owner, 50_000_000_000_000n),
  );
  const buyback = await ata(
    curveConfig.buybackWallet,
    mintPath[0],
    programFor(mintPath[0]),
  );
  put(
    buyback,
    programFor(mintPath[0]),
    tokenData(mintPath[0], curveConfig.buybackWallet, 0n),
  );
  if (mintPath[0] === SOL)
    for (const address of [
      userQuote,
      buyback,
      ...venues
        .filter((v) => v.kind === "pool" && v.quoteMint === SOL)
        .map((v) => v.quoteVault),
    ]) {
      const a = snapshot.accounts[address],
        reserve = 2_039_280n;
      new DataView(a.data.buffer).setUint32(109, 1, true);
      u64(a.data, 113, reserve);
      a.lamports = new DataView(a.data.buffer).getBigUint64(64, true) + reserve;
    }
  const ordered = reverse ? [...venues].reverse() : venues;
  const hops = ordered.map((v) => ({
    pool: v.pool,
    inputMint: reverse ? v.baseMint : v.quoteMint,
    outputMint: reverse ? v.quoteMint : v.baseMint,
  }));
  const request = {
    owner,
    payer: owner,
    inputMint: hops[0].inputMint,
    outputMint: hops.at(-1).outputMint,
    hops,
    amount: { kind: "exactIn", amountIn: reverse ? 1_000_000_003n : 10_000_003n },
    slippageBps: 0,
    fillPolicy: "allowPartial",
    snapshot,
  };
  return {
    request,
    venues,
    ordered,
    userQuote,
    userBase,
    buyback,
    curveConfig,
    ammConfig,
  };
}
