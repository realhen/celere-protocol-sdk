import { createHash } from "node:crypto";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export const DLMM_PROGRAM = address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
const Q64 = 1n << 64n;
const U128_MAX = (1n << 128n) - 1n;
const textEncoder = new TextEncoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-dlmm:${label}`).digest());
}
export function putDlmmU128(data, offset, value) {
  const view = new DataView(data.buffer);
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, value >> 64n, true);
}
function discriminator(name) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}
function priceAt(binId, binStep) {
  let base = Q64 + (BigInt(binStep) * Q64) / 10_000n;
  let inverse = binId < 0;
  let exponent = Math.abs(binId);
  let result = Q64;
  if (base >= Q64) {
    base = U128_MAX / base;
    inverse = !inverse;
  }
  while (exponent > 0) {
    if (exponent % 2 === 1) result = (result * base) >> 64n;
    base = (base * base) >> 64n;
    exponent = Math.floor(exponent / 2);
  }
  return inverse ? U128_MAX / result : result;
}

/** Synthetic public-layout state and deterministic PDAs; no user account data or keys. */
export async function meteoraDlmmFixture(
  owner,
  {
    label = "default",
    reverse = false,
    dynamic = false,
    activeId = 0,
    binStep = 25,
    bitmapExtension = false,
    binLiquidity = 1_000_000n,
    unixTimestamp = 1_800_000_000n,
    feePhase = "decayed",
  } = {},
) {
  const suffix = `${owner}:${label}`;
  const mints = [key(`x:${suffix}`), key(`y:${suffix}`)].sort((a, b) =>
    Buffer.compare(Buffer.from(encoder.encode(a)), Buffer.from(encoder.encode(b))),
  );
  const [mintX, mintY] = mints;
  const stepBytes = new Uint8Array(2);
  new DataView(stepBytes.buffer).setUint16(0, binStep, true);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: DLMM_PROGRAM,
    seeds: [encoder.encode(mintX), encoder.encode(mintY), stepBytes],
  });
  const derive = async (seeds) =>
    (await getProgramDerivedAddress({ programAddress: DLMM_PROGRAM, seeds }))[0];
  const reserveX = await derive([encoder.encode(pool), encoder.encode(mintX)]);
  const reserveY = await derive([encoder.encode(pool), encoder.encode(mintY)]);
  const oracle = await derive([textEncoder.encode("oracle"), encoder.encode(pool)]);
  const bitmap = await derive([textEncoder.encode("bitmap"), encoder.encode(pool)]);
  const userX = key(`user-x:${suffix}`),
    userY = key(`user-y:${suffix}`);
  const poolData = new Uint8Array(904),
    view = new DataView(poolData.buffer);
  poolData.set(discriminator("LbPair"));
  view.setUint16(8, 12000, true);
  view.setUint16(10, 600, true);
  view.setUint16(12, 1200, true);
  view.setUint16(14, 5000, true);
  view.setUint32(16, dynamic ? 50000 : 0, true);
  view.setUint32(20, 350000, true);
  view.setInt32(24, -443636, true);
  view.setInt32(28, 443636, true);
  view.setUint16(32, 2000, true);
  poolData[35] = 1;
  view.setUint32(40, 100000, true);
  view.setUint32(44, 20000, true);
  view.setInt32(48, activeId + 2, true);
  view.setBigInt64(
    56,
    unixTimestamp - (feePhase === "filter" ? 60n : feePhase === "decay" ? 900n : 3600n),
    true,
  );
  poolData[72] = bump;
  poolData.set(stepBytes, 73);
  view.setInt32(76, activeId, true);
  view.setUint16(80, binStep, true);
  for (const [offset, value] of [
    [88, mintX],
    [120, mintY],
    [152, reserveX],
    [184, reserveY],
    [552, oracle],
  ])
    poolData.set(encoder.encode(value), offset);
  const oracleData = new Uint8Array(96);
  oracleData.set(discriminator("Oracle"));
  new DataView(oracleData.buffer).setBigUint64(16, 2n, true);
  new DataView(oracleData.buffer).setBigUint64(24, 2n, true);
  const bitmapData = new Uint8Array(1576);
  bitmapData.set(discriminator("BinArrayBitmapExtension"));
  bitmapData.set(encoder.encode(pool), 8);
  const accounts = {};
  function add(address, owner, data) {
    accounts[address] = {
      address,
      owner,
      data,
      slot: 100n,
      lamports: 100_000_000n,
      executable: false,
    };
  }
  function token(mint, authority, amount) {
    const d = new Uint8Array(165);
    d.set(encoder.encode(mint));
    d.set(encoder.encode(authority), 32);
    new DataView(d.buffer).setBigUint64(64, amount, true);
    d[108] = 1;
    return d;
  }
  function mint() {
    const d = new Uint8Array(82);
    d[44] = 6;
    d[45] = 1;
    new DataView(d.buffer).setBigUint64(36, 100_000_000_000_000n, true);
    return d;
  }
  add(pool, DLMM_PROGRAM, poolData);
  add(oracle, DLMM_PROGRAM, oracleData);
  const arrays = [];
  const center = Math.floor(activeId / 70);
  for (const index of [center - 1, center, center + 1]) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt(index), true);
    const array = await derive([
      textEncoder.encode("bin_array"),
      encoder.encode(pool),
      bytes,
    ]);
    const data = new Uint8Array(10136);
    data.set(discriminator("BinArray"));
    data.set(bytes, 8);
    data[16] = 1;
    data.set(encoder.encode(pool), 24);
    for (let id = index * 70; id < (index + 1) * 70; id++) {
      const offset = 56 + (id - index * 70) * 144;
      const d = new DataView(data.buffer);
      d.setBigUint64(offset, binLiquidity, true);
      d.setBigUint64(offset + 8, binLiquidity, true);
      putDlmmU128(data, offset + 16, priceAt(id, binStep));
      putDlmmU128(data, offset + 32, 1_000_000n * Q64);
    }
    if (index >= -512 && index <= 511) {
      const bit = index + 512;
      poolData[584 + Math.floor(bit / 8)] |= 1 << (bit % 8);
    } else {
      const bit = index >= 512 ? index - 512 : -index - 513;
      const start = index >= 512 ? 40 : 808;
      bitmapData[start + Math.floor(bit / 8)] |= 1 << (bit % 8);
    }
    add(array, DLMM_PROGRAM, data);
    arrays.push(array);
  }
  if (bitmapExtension || center < -511 || center > 510)
    add(bitmap, DLMM_PROGRAM, bitmapData);
  else accounts[bitmap] = null;
  add(mintX, TOKEN_PROGRAM_ADDRESS, mint());
  add(mintY, TOKEN_PROGRAM_ADDRESS, mint());
  add(reserveX, TOKEN_PROGRAM_ADDRESS, token(mintX, pool, 1_000_000_000_000_000n));
  add(reserveY, TOKEN_PROGRAM_ADDRESS, token(mintY, pool, 1_000_000_000_000_000n));
  add(userX, TOKEN_PROGRAM_ADDRESS, token(mintX, owner, 1_000_000_000_000_000n));
  add(userY, TOKEN_PROGRAM_ADDRESS, token(mintY, owner, 1_000_000_000_000_000n));
  return {
    pool,
    mintX,
    mintY,
    reserveX,
    reserveY,
    userX,
    userY,
    bitmap,
    oracle,
    arrays,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mintY : mintX,
      outputMint: reverse ? mintX : mintY,
      amount: { kind: "exactIn", amountIn: 2_100_001n },
      slippageBps: 0,
      tokenAccounts: { input: reverse ? userY : userX, output: reverse ? userX : userY },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp, accounts },
      fillPolicy: "requireFull",
    },
  };
}
