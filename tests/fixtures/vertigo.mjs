import { createHash } from "node:crypto";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const VERTIGO_PROGRAM = address("vrTGoBuy5rYSxAfV3jaRJWHH6nN9WK4NRExGxsk1bCJ");
const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-vertigo:${label}`).digest());
}
export function putU128(data, offset, value) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, value >> 64n, true);
}
function tokenData(mint, authority, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint));
  data.set(encoder.encode(authority), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  return data;
}
function mintData() {
  const data = new Uint8Array(82);
  new DataView(data.buffer).setBigUint64(36, 100_000_000_000n, true);
  data[44] = 6;
  data[45] = 1;
  return data;
}
/** Synthetic state using the official published Vertigo pool layout and PDA seeds. */
export async function vertigoFixture(
  owner,
  { reverse = false, label = "default", royaltiesBps = 25, shift = 300_000_000n } = {},
) {
  const poolOwner = key(`pool-owner:${label}`);
  const mintA = key(`mint-a:${label}`);
  const mintB = key(`mint-b:${label}`);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: [
      new TextEncoder().encode("pool"),
      encoder.encode(poolOwner),
      encoder.encode(mintA),
      encoder.encode(mintB),
    ],
  });
  const [vaultA] = await getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: [encoder.encode(pool), encoder.encode(mintA)],
  });
  const [vaultB] = await getProgramDerivedAddress({
    programAddress: VERTIGO_PROGRAM,
    seeds: [encoder.encode(pool), encoder.encode(mintB)],
  });
  const userA = key(`user-a:${label}`);
  const userB = key(`user-b:${label}`);
  const data = new Uint8Array(229);
  const view = new DataView(data.buffer);
  data.set([241, 154, 109, 4, 17, 177, 109, 188]);
  data[8] = 1;
  data.set(encoder.encode(poolOwner), 9);
  data.set(encoder.encode(mintA), 41);
  data.set(encoder.encode(mintB), 73);
  putU128(data, 105, 1_000_000_000n);
  putU128(data, 121, 2_000_000_000n);
  putU128(data, 137, shift);
  view.setBigUint64(153, 9_000n, true);
  view.setBigUint64(161, 3_000n, true);
  data[169] = bump;
  view.setBigUint64(170, 1n, true);
  view.setFloat64(178, 1, true);
  view.setBigUint64(186, 1n, true);
  view.setUint16(194, royaltiesBps, true);
  const accounts = {};
  function add(address, accountOwner, bytes) {
    accounts[address] = {
      address,
      owner: accountOwner,
      data: bytes,
      lamports: 100_000_000n,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, VERTIGO_PROGRAM, data);
  add(poolOwner, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  add(mintA, TOKEN_PROGRAM_ADDRESS, mintData());
  add(mintB, TOKEN_PROGRAM_ADDRESS, mintData());
  add(vaultA, TOKEN_PROGRAM_ADDRESS, tokenData(mintA, pool, 1_000_012_000n));
  add(vaultB, TOKEN_PROGRAM_ADDRESS, tokenData(mintB, pool, 2_000_000_000n));
  add(userA, TOKEN_PROGRAM_ADDRESS, tokenData(mintA, owner, 3_000_000_000n));
  add(userB, TOKEN_PROGRAM_ADDRESS, tokenData(mintB, owner, 3_000_000_000n));
  return {
    pool,
    poolOwner,
    mintA,
    mintB,
    vaultA,
    vaultB,
    userA,
    userB,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mintB : mintA,
      outputMint: reverse ? mintA : mintB,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      tokenAccounts: { input: reverse ? userB : userA, output: reverse ? userA : userB },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
