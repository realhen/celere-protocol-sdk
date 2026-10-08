import { createHash } from "node:crypto";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const CLMM_PROGRAM = address("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const decoder = getAddressDecoder();
const encoder = getAddressEncoder();
function deterministicAddress(label) {
  return decoder.decode(createHash("sha256").update(`celere-clmm:${label}`).digest());
}
function discriminator(name) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}
function putAddress(data, offset, value) {
  data.set(encoder.encode(value), offset);
}
function putU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function putU128(data, offset, value) {
  const unsigned = BigInt.asUintN(128, value);
  putU64(data, offset, unsigned & ((1n << 64n) - 1n));
  putU64(data, offset + 8, unsigned >> 64n);
}
function mintData() {
  const data = new Uint8Array(82);
  putU64(data, 36, 100_000_000_000_000n);
  data[44] = 6;
  data[45] = 1;
  return data;
}
function tokenData(mint, owner) {
  const data = new Uint8Array(165);
  putAddress(data, 0, mint);
  putAddress(data, 32, owner);
  putU64(data, 64, 5_000_000_000_000n);
  data[108] = 1;
  return data;
}
async function pda(seed, ...seeds) {
  return getProgramDerivedAddress({
    programAddress: CLMM_PROGRAM,
    seeds: [new TextEncoder().encode(seed), ...seeds],
  });
}

/** Synthetic accounts with official native layouts and PDAs; no captured user data. */
export async function raydiumClmmFixture(
  owner,
  {
    reverse = false,
    label = "default",
    tickOffset = 0,
    sqrtPrice = 1n << 64n,
    historicalOrders = false,
  } = {},
) {
  const ordered = [
    deterministicAddress(`mint-a:${label}`),
    deterministicAddress(`mint-b:${label}`),
  ].sort((a, b) =>
    Buffer.compare(Buffer.from(encoder.encode(a)), Buffer.from(encoder.encode(b))),
  );
  const [mint0, mint1] = ordered;
  const configIndex = createHash("sha256")
    .update(`config:${label}`)
    .digest()
    .readUInt16LE();
  const [config, configBump] = await pda(
    "amm_config",
    Uint8Array.of(configIndex >> 8, configIndex & 255),
  );
  const [pool, poolBump] = await pda(
    "pool",
    encoder.encode(config),
    encoder.encode(mint0),
    encoder.encode(mint1),
  );
  const [vault0] = await pda("pool_vault", encoder.encode(pool), encoder.encode(mint0));
  const [vault1] = await pda("pool_vault", encoder.encode(pool), encoder.encode(mint1));
  const [observation] = await pda("observation", encoder.encode(pool));
  const [bitmap] = await pda("pool_tick_array_bitmap_extension", encoder.encode(pool));
  const user0 = deterministicAddress(`user0:${label}`);
  const user1 = deterministicAddress(`user1:${label}`);
  const liquidity = 20_000_000_000n;
  const poolData = new Uint8Array(1544);
  poolData.set(discriminator("PoolState"));
  poolData[8] = poolBump;
  for (const [offset, value] of [
    [9, config],
    [41, owner],
    [73, mint0],
    [105, mint1],
    [137, vault0],
    [169, vault1],
    [201, observation],
  ])
    putAddress(poolData, offset, value);
  poolData[233] = 6;
  poolData[234] = 6;
  new DataView(poolData.buffer).setUint16(235, 1, true);
  putU128(poolData, 237, liquidity);
  putU128(poolData, 253, sqrtPrice);
  new DataView(poolData.buffer).setInt32(269, tickOffset, true);
  const configData = new Uint8Array(117);
  configData.set(discriminator("AmmConfig"));
  configData[8] = configBump;
  const configView = new DataView(configData.buffer);
  configView.setUint16(9, configIndex, true);
  putAddress(configData, 11, owner);
  configView.setUint32(43, 120_000, true);
  configView.setUint32(47, 2500, true);
  configView.setUint16(51, 1, true);
  configView.setUint32(53, 40_000, true);
  putAddress(configData, 61, owner);
  const observationData = new Uint8Array(4483);
  observationData.set(discriminator("ObservationState"));
  putAddress(observationData, 19, pool);
  const bitmapData = new Uint8Array(1832);
  bitmapData.set(discriminator("TickArrayBitmapExtension"));
  putAddress(bitmapData, 8, pool);
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
  const arrays = new Map();
  for (const [relativeTick, net] of [
    [-120, 10_000_000_000n],
    [-30, 10_000_000_000n],
    [30, -10_000_000_000n],
    [120, -10_000_000_000n],
  ]) {
    const tick = tickOffset + relativeTick;
    const start = Math.floor(tick / 60) * 60;
    let data = arrays.get(start);
    if (!data) {
      data = new Uint8Array(10240);
      data.set(discriminator("TickArrayState"));
      putAddress(data, 8, pool);
      new DataView(data.buffer).setInt32(40, start, true);
      arrays.set(start, data);
      const arrayIndex = start / 60;
      if (arrayIndex >= -512 && arrayIndex < 512) {
        const bit = arrayIndex + 512;
        poolData[904 + Math.floor(bit / 8)] |= 1 << (bit % 8);
      } else {
        const page =
          arrayIndex >= 512
            ? Math.floor(arrayIndex / 512) - 1
            : Math.floor((-arrayIndex - 1) / 512) - 1;
        const bit = ((arrayIndex % 512) + 512) % 512;
        bitmapData[(arrayIndex >= 512 ? 40 : 936) + page * 64 + Math.floor(bit / 8)] |=
          1 << (bit % 8);
      }
    }
    const offset = 44 + (tick - start) * 168;
    new DataView(data.buffer).setInt32(offset, tick, true);
    putU128(data, offset + 4, net);
    putU128(data, offset + 20, 10_000_000_000n);
    data[10124]++;
  }
  const tickArrays = [];
  for (const [start, data] of arrays) {
    if (historicalOrders)
      for (let index = 0; index < 60; index++) {
        const offset = 44 + index * 168;
        new DataView(data.buffer).setInt32(offset, start + index, true);
        putU64(data, offset + 116, 1n);
      }
    const seed = new Uint8Array(4);
    new DataView(seed.buffer).setInt32(0, start, false);
    const [address] = await pda("tick_array", encoder.encode(pool), seed);
    tickArrays.push({ address, start });
    add(address, CLMM_PROGRAM, data);
  }
  add(pool, CLMM_PROGRAM, poolData);
  add(config, CLMM_PROGRAM, configData);
  add(observation, CLMM_PROGRAM, observationData);
  add(bitmap, CLMM_PROGRAM, bitmapData);
  add(mint0, TOKEN_PROGRAM_ADDRESS, mintData());
  add(mint1, TOKEN_PROGRAM_ADDRESS, mintData());
  add(vault0, TOKEN_PROGRAM_ADDRESS, tokenData(mint0, pool));
  add(vault1, TOKEN_PROGRAM_ADDRESS, tokenData(mint1, pool));
  add(user0, TOKEN_PROGRAM_ADDRESS, tokenData(mint0, owner));
  add(user1, TOKEN_PROGRAM_ADDRESS, tokenData(mint1, owner));
  return {
    pool,
    config,
    bitmap,
    observation,
    mint0,
    mint1,
    vault0,
    vault1,
    user0,
    user1,
    tickArrays,
    liquidity,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint1 : mint0,
      outputMint: reverse ? mint0 : mint1,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      fillPolicy: "requireFull",
      tokenAccounts: { input: reverse ? user1 : user0, output: reverse ? user0 : user1 },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
    },
  };
}
