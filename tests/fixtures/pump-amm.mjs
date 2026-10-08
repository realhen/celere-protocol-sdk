import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const PUMP_AMM = address("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const FEE_PROGRAM = address("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const SOL = address("So11111111111111111111111111111111111111112");
export const SYSTEM = address("11111111111111111111111111111111");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const bytes = getAddressEncoder();
const decoder = getAddressDecoder();
const utf8 = new TextEncoder();

export function deterministicAddress(label) {
  return decoder.decode(createHash("sha256").update(`celere-pump-amm:${label}`).digest());
}
export async function pda(programAddress, label, ...addresses) {
  return (
    await getProgramDerivedAddress({
      programAddress,
      seeds: [utf8.encode(label), ...addresses.map((value) => bytes.encode(value))],
    })
  )[0];
}
export async function ata(owner, mint, tokenProgram = TOKEN) {
  return (
    await getProgramDerivedAddress({
      programAddress: ATA_PROGRAM,
      seeds: [owner, tokenProgram, mint].map((value) => bytes.encode(value)),
    })
  )[0];
}
export async function poolAddress(creator, mint, index = 0) {
  const indexBytes = new Uint8Array(2);
  new DataView(indexBytes.buffer).setUint16(0, index, true);
  return getProgramDerivedAddress({
    programAddress: PUMP_AMM,
    seeds: [
      utf8.encode("pool"),
      indexBytes,
      ...[creator, mint, SOL].map((value) => bytes.encode(value)),
    ],
  });
}
function putAddress(data, offset, value) {
  data.set(bytes.encode(value), offset);
}
function putU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
export function mintData(supply = 1_000_000_000_000_000n) {
  const data = new Uint8Array(82);
  putU64(data, 36, supply);
  data[44] = 6;
  data[45] = 1;
  return data;
}
export function tokenData(mint, authority, amount) {
  const data = new Uint8Array(165);
  putAddress(data, 0, mint);
  putAddress(data, 32, authority);
  putU64(data, 64, amount);
  data[108] = 1;
  return data;
}

/** Complete synthetic public state; no user observations or keys. Native executions are separately retained. */
export async function pumpAmmFixture(
  owner,
  { label = "default", canonical = true, reverse = false } = {},
) {
  const mint = deterministicAddress(`mint:${label}`);
  const creator = canonical
    ? await pda(PUMP, "pool-authority", mint)
    : deterministicAddress(`creator:${label}`);
  const [pool, bump] = await poolAddress(creator, mint);
  const baseVault = await ata(pool, mint),
    quoteVault = await ata(pool, SOL);
  const userBase = await ata(owner, mint),
    userQuote = await ata(owner, SOL);
  const global = await pda(PUMP_AMM, "global_config"),
    feeConfig = await pda(FEE_PROGRAM, "fee_config", PUMP_AMM);
  const buyback = deterministicAddress("buyback"),
    buybackAta = await ata(buyback, SOL);
  const poolData = new Uint8Array(287);
  poolData.set([241, 154, 109, 4, 17, 177, 109, 188]);
  poolData[8] = bump;
  for (const [offset, value] of [
    [11, creator],
    [43, mint],
    [75, SOL],
    [107, deterministicAddress(`lp:${label}`)],
    [139, baseVault],
    [171, quoteVault],
    [211, canonical ? creator : SYSTEM],
  ])
    putAddress(poolData, offset, value);
  putU64(poolData, 203, 1_000_000_000n);
  putU64(poolData, 271, 100n);
  putU64(poolData, 279, 200n);
  const globalData = new Uint8Array(949);
  globalData.set([149, 8, 156, 202, 160, 252, 176, 217]);
  putAddress(globalData, 643, buyback);
  putU64(globalData, 899, 5000n);
  const fees = new Uint8Array(4097);
  fees.set([143, 52, 146, 187, 219, 123, 76, 155]);
  putU64(fees, 41, 20n);
  putU64(fees, 49, 5n);
  putU64(fees, 57, 10n);
  new DataView(fees.buffer).setUint32(65, 1, true);
  putU64(fees, 85, 20n);
  putU64(fees, 93, 5n);
  putU64(fees, 101, 10n);
  const snapshot = { slot: 100n, epoch: 1n, unixTimestamp: 1_700_000_000n, accounts: {} };
  const put = (accountAddress, accountOwner, data) => {
    snapshot.accounts[accountAddress] = {
      address: accountAddress,
      owner: accountOwner,
      data,
      lamports: 10_000_000n,
      executable: false,
      slot: snapshot.slot,
    };
  };
  put(pool, PUMP_AMM, poolData);
  put(global, PUMP_AMM, globalData);
  put(feeConfig, FEE_PROGRAM, fees);
  put(mint, TOKEN, mintData());
  const nativeMint = mintData(0n);
  nativeMint[44] = 9;
  put(SOL, TOKEN, nativeMint);
  put(baseVault, TOKEN, tokenData(mint, pool, 200_000_000_000_000n));
  put(quoteVault, TOKEN, tokenData(SOL, pool, 85_000_000_000n));
  put(userBase, TOKEN, tokenData(mint, owner, 50_000_000_000_000n));
  put(userQuote, TOKEN, tokenData(SOL, owner, 10_000_000_000n));
  put(buybackAta, TOKEN, tokenData(SOL, buyback, 1_000_000n));
  return {
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint : SOL,
      outputMint: reverse ? SOL : mint,
      amount: { kind: "exactIn", amountIn: reverse ? 1_000_000_000n : 1_000_000n },
      slippageBps: 50,
      snapshot,
    },
    pool,
    mint,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    feeConfig,
    global,
    buybackAta,
  };
}
