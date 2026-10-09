import { createHash } from "node:crypto";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
} from "@solana/kit";
export const METEORA_DBC_PROGRAM = address("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
export const METEORA_DBC_AUTHORITY = address(
  "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
);
const enc = getAddressEncoder(),
  dec = getAddressDecoder(),
  Q64 = 1n << 64n;
function key(label) {
  return dec.decode(createHash("sha256").update(`celere-dbc:${label}`).digest());
}
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function u128(data, offset, value) {
  u64(data, offset, value & ((1n << 64n) - 1n));
  u64(data, offset + 8, value >> 64n);
}
function mintData() {
  const data = new Uint8Array(82);
  u64(data, 36, 10_000_000_000n);
  data[44] = 6;
  data[45] = 1;
  return data;
}
function tokenData(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(enc.encode(mint), 0);
  data.set(enc.encode(owner), 32);
  u64(data, 64, amount);
  data[108] = 1;
  return data;
}
/** Synthetic three-segment DBC curve with accrued protocol, partner and creator fees. */
export async function meteoraDbcFixture(
  owner,
  {
    reverse = false,
    label = "default",
    collectFeeMode = 0,
    feeNumerator = 3_700_000n,
    creatorPercentage = 33,
    linear = false,
    unixTimestamp = 1_800_000_000n,
  } = {},
) {
  const config = key(`config:${label}`),
    baseMint = key(`base:${label}`),
    quoteMint = key(`quote:${label}`),
    userBase = key(`user-base:${label}`),
    userQuote = key(`user-quote:${label}`);
  const sorted = [enc.encode(baseMint), enc.encode(quoteMint)].sort((a, b) =>
    Buffer.compare(b, a),
  );
  const [pool] = await getProgramDerivedAddress({
    programAddress: METEORA_DBC_PROGRAM,
    seeds: ["pool", enc.encode(config), ...sorted],
  });
  const [baseVault] = await getProgramDerivedAddress({
    programAddress: METEORA_DBC_PROGRAM,
    seeds: ["token_vault", enc.encode(baseMint), enc.encode(pool)],
  });
  const [quoteVault] = await getProgramDerivedAddress({
    programAddress: METEORA_DBC_PROGRAM,
    seeds: ["token_vault", enc.encode(quoteMint), enc.encode(pool)],
  });
  const poolData = new Uint8Array(424);
  poolData.set([213, 224, 5, 209, 98, 69, 119, 92]);
  for (const [o, k] of [
    [72, config],
    [104, owner],
    [136, baseMint],
    [168, baseVault],
    [200, quoteVault],
  ])
    poolData.set(enc.encode(k), o);
  for (const [o, v] of [
    [232, 2_000_000_000n],
    [240, 1_000_000_000n],
    [248, 101n],
    [256, 103n],
    [264, 107n],
    [272, 109n],
    [352, 113n],
    [360, 127n],
    [296, linear ? unixTimestamp - 200n : 0n],
  ])
    u64(poolData, o, v);
  u128(poolData, 280, (Q64 * 11n) / 10n);
  poolData[370] = 1;
  const configData = new Uint8Array(1048);
  configData.set([26, 108, 14, 123, 116, 230, 129, 43]);
  configData.set(enc.encode(quoteMint), 8);
  configData[232] = collectFeeMode;
  configData[234] = 1;
  configData[235] = 6;
  configData[244] = 1;
  configData[245] = creatorPercentage;
  u64(configData, 104, feeNumerator);
  if (linear) {
    u64(configData, 112, 10n);
    u64(configData, 120, 100_000n);
    new DataView(configData.buffer).setUint16(128, 10, true);
  }
  u64(configData, 256, 2_000_000_000n);
  u64(configData, 264, 10_000_000_000n);
  u64(configData, 272, 100_000_000n);
  u128(configData, 280, (Q64 * 18n) / 10n);
  u128(configData, 392, Q64 / 2n);
  for (const [i, price, liquidity] of [
    [0, Q64, 1_000_000_000n * Q64],
    [1, (Q64 * 12n) / 10n, 1_500_000_000n * Q64],
    [2, Q64 * 2n, 2_000_000_000n * Q64],
  ]) {
    u128(configData, 408 + i * 32, price);
    u128(configData, 424 + i * 32, liquidity);
  }
  const accounts = {};
  function add(address, owner, data) {
    accounts[address] = {
      address,
      owner,
      data,
      lamports: 100_000_000n,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, METEORA_DBC_PROGRAM, poolData);
  add(config, METEORA_DBC_PROGRAM, configData);
  add(baseMint, TOKEN_PROGRAM_ADDRESS, mintData());
  add(quoteMint, TOKEN_PROGRAM_ADDRESS, mintData());
  add(
    baseVault,
    TOKEN_PROGRAM_ADDRESS,
    tokenData(baseMint, METEORA_DBC_AUTHORITY, 2_000_000_321n),
  );
  add(
    quoteVault,
    TOKEN_PROGRAM_ADDRESS,
    tokenData(quoteMint, METEORA_DBC_AUTHORITY, 1_000_000_339n),
  );
  add(userBase, TOKEN_PROGRAM_ADDRESS, tokenData(baseMint, owner, 3_000_000_000n));
  add(userQuote, TOKEN_PROGRAM_ADDRESS, tokenData(quoteMint, owner, 3_000_000_000n));
  return {
    pool,
    config,
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? baseMint : quoteMint,
      outputMint: reverse ? quoteMint : baseMint,
      amount: { kind: "exactIn", amountIn: 1_000_003n },
      slippageBps: 0,
      tokenAccounts: {
        input: reverse ? userBase : userQuote,
        output: reverse ? userQuote : userBase,
      },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp, accounts },
      fillPolicy: "requireFull",
    },
  };
}
