import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  PUMP,
  SOL,
  TOKEN,
  TOKEN_2022,
  curveAddress,
  tokenAddress,
} from "./pump-helpers.mjs";
const encoded = getAddressEncoder(),
  decoded = getAddressDecoder();
const captured = JSON.parse(
  await readFile(new URL("./pump-observations.json", import.meta.url), "utf8"),
  (_, v) =>
    v?.bigint
      ? BigInt(v.bigint)
      : v?.base64
        ? Uint8Array.from(Buffer.from(v.base64, "base64"))
        : v,
);
export const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export function u64(data, offset, value) {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(
    offset,
    value,
    true,
  );
}
function key(label) {
  return decoded.decode(createHash("sha256").update(`celere-pump-v3:${label}`).digest());
}
export function mintData(supply, decimals = 6) {
  const d = new Uint8Array(82);
  u64(d, 36, supply);
  d[44] = decimals;
  d[45] = 1;
  return d;
}
export function tokenData(mint, owner, amount) {
  const d = new Uint8Array(165);
  d.set(encoded.encode(mint));
  d.set(encoded.encode(owner), 32);
  u64(d, 64, amount);
  d[108] = 1;
  return d;
}
export async function pumpPda(label, ...keys) {
  return (
    await getProgramDerivedAddress({
      programAddress: PUMP,
      seeds: [new TextEncoder().encode(label), ...keys.map((k) => encoded.encode(k))],
    })
  )[0];
}
/** Public captured configuration plus deterministic synthetic market state; never includes signing keys. */
export async function pumpV3Fixture(
  owner,
  {
    quote = "sol",
    base2022 = false,
    quote2022 = false,
    buy = true,
    exactOut = false,
    crossing = false,
    customCreator = false,
    holder = false,
    missingBuyback = false,
    label = "matrix",
  } = {},
) {
  const mint = key(`base:${label}`),
    quoteMint = quote === "sol" ? SOL : quote === "usdc" ? USDC : key(`quote:${label}`),
    tokenProgram = base2022 ? TOKEN_2022 : TOKEN,
    quoteProgram = quote2022 ? TOKEN_2022 : TOKEN;
  const pool = await curveAddress(mint),
    global = await pumpPda("global"),
    feeConfig = Object.values(captured.observations[0].request.snapshot.accounts).find(
      (a) => a?.data.length === 4097,
    ).address;
  const creator = holder ? await pumpPda("holder-rewards", mint) : key("creator");
  const snapshot = { slot: 1n, epoch: 0n, unixTimestamp: 1n, accounts: {} };
  const add = (address, owner, data, lamports = 10_000_000n) =>
    (snapshot.accounts[address] = {
      address,
      owner,
      data,
      lamports,
      executable: false,
      slot: 1n,
    });
  add(
    global,
    PUMP,
    structuredClone(captured.observations[0].request.snapshot.accounts[global].data),
  );
  const gd = snapshot.accounts[global].data;
  gd[1045] = customCreator ? 1 : 0;
  add(
    feeConfig,
    captured.observations[0].request.snapshot.accounts[feeConfig].owner,
    new Uint8Array(4097),
  );
  const fd = snapshot.accounts[feeConfig].data;
  fd.set([143, 52, 146, 187, 219, 123, 76, 155]);
  fd[8] = captured.observations[0].request.snapshot.accounts[feeConfig].data[8];
  // Distinct SOL, stable and exotic rates detect selection of the wrong schedule.
  const setRates = (start, protocol, creator) => {
    u64(fd, start, 0n);
    u64(fd, start + 8, protocol);
    u64(fd, start + 16, creator);
  };
  setRates(41, 73n, 89n);
  new DataView(fd.buffer).setUint32(65, 1, true);
  setRates(85, 91n, 113n);
  new DataView(fd.buffer).setUint32(109, 1, true);
  setRates(129, 47n, 83n);
  setRates(153, 61n, 109n);
  const curve = new Uint8Array(166);
  curve.set([23, 183, 248, 55, 96, 216, 172, 96]);
  const realTokens = crossing ? 1_000_000_000n : 600_000_000_000_000n,
    virtualTokens = crossing ? 206_901_000_000_000n : 806_900_000_000_000n;
  u64(curve, 8, virtualTokens);
  u64(curve, 16, crossing ? 115_000_000_000n : 40_000_000_000n);
  u64(curve, 24, realTokens);
  u64(curve, 32, crossing ? 85_000_000_000n : 10_000_000_000n);
  u64(curve, 40, 1_000_000_000_000_000n);
  curve.set(encoded.encode(creator), 49);
  if (quote !== "sol") curve.set(encoded.encode(quoteMint), 83);
  u64(curve, 115, customCreator ? 137n : 0n);
  curve[124] = holder ? 1 : 0;
  u64(curve, 125, 11n);
  u64(curve, 133, 17n);
  curve[141] = quote === "token" ? 1 : 0;
  add(pool, PUMP, curve, (crossing ? 85_000_000_000n : 10_000_000_000n) + 100_000_028n);
  add(mint, tokenProgram, mintData(1_000_000_000_000_000n));
  const baseVault = await tokenAddress(pool, mint, tokenProgram),
    userBase = await tokenAddress(owner, mint, tokenProgram),
    quoteVault = await tokenAddress(pool, quoteMint, quoteProgram),
    userQuote = await tokenAddress(owner, quoteMint, quoteProgram);
  add(baseVault, tokenProgram, tokenData(mint, pool, realTokens + 206_900_000_000_000n));
  add(userBase, tokenProgram, tokenData(mint, owner, 10_000_000_000_000n));
  const buybackWallet = decoded.decode(gd.subarray(741, 773)),
    buyback =
      quote === "sol"
        ? buybackWallet
        : await tokenAddress(buybackWallet, quoteMint, quoteProgram);
  if (quote !== "sol") {
    add(quoteMint, quoteProgram, mintData(1_000_000_000_000_000n));
    add(
      quoteVault,
      quoteProgram,
      tokenData(quoteMint, pool, (crossing ? 85_000_000_000n : 10_000_000_000n) + 28n),
    );
    add(userQuote, quoteProgram, tokenData(quoteMint, owner, 1_000_000_000_000n));
    if (missingBuyback) snapshot.accounts[buyback] = null;
    else add(buyback, quoteProgram, tokenData(quoteMint, buybackWallet, 0n));
  } else add(buyback, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  add(owner, SYSTEM_PROGRAM_ADDRESS, new Uint8Array(), 10_000_000_000_000n);
  const request = {
    pool,
    owner,
    payer: owner,
    inputMint: buy ? quoteMint : mint,
    outputMint: buy ? mint : quoteMint,
    amount: exactOut
      ? { kind: "exactOut", amountOut: crossing ? 10_000_000_000n : 1_000_000_000n }
      : { kind: "exactIn", amountIn: buy ? 10_000_003n : 1_000_000_003n },
    slippageBps: 50,
    fillPolicy: "allowPartial",
    snapshot,
  };
  return {
    request,
    pool,
    mint,
    quoteMint,
    tokenProgram,
    quoteProgram,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    buyback,
    buybackWallet,
    global,
    feeConfig,
  };
}
