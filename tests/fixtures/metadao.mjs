import { createHash } from "node:crypto";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { METADAO_PROGRAM } from "../../dist/protocols/metadao/constants.js";
export { METADAO_PROGRAM };
const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-metadao:${label}`).digest());
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
function mintData(supply) {
  const data = new Uint8Array(82);
  new DataView(data.buffer).setBigUint64(36, supply, true);
  data[44] = 6;
  data[45] = 1;
  return data;
}
/** Synthetic DAO spot-state using published v0.6.1 account interface facts. */
export async function metadaoFixture(
  owner,
  {
    reverse = false,
    label = "default",
    baseReserves = 2_000_000_000n,
    quoteReserves = 1_000_000_000n,
    inputBalance = 10_000_000_000n,
  } = {},
) {
  const creator = key(`creator:${label}`);
  const mintA = key(`base:${label}`);
  const mintB = key(`quote:${label}`);
  const nonce = new Uint8Array(8);
  new DataView(nonce.buffer).setBigUint64(0, 123n, true);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: METADAO_PROGRAM,
    seeds: [new TextEncoder().encode("dao"), encoder.encode(creator), nonce],
  });
  const [baseVault] = await findAssociatedTokenPda({
    owner: pool,
    mint: mintA,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [quoteVault] = await findAssociatedTokenPda({
    owner: pool,
    mint: mintB,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: METADAO_PROGRAM,
    seeds: [new TextEncoder().encode("__event_authority")],
  });
  const userBase = key(`user-base:${label}`);
  const userQuote = key(`user-quote:${label}`);
  const data = new Uint8Array(1600);
  const view = new DataView(data.buffer);
  data.set(createHash("sha256").update("account:Dao").digest().subarray(0, 8));
  data[8] = 0;
  view.setBigInt64(25, 1n, true);
  view.setBigInt64(33, 1n, true);
  const price = (quoteReserves * 1_000_000_000_000n) / (baseReserves || 1n);
  for (const offset of [41, 57, 73, 89]) putU128(data, offset, price);
  view.setBigUint64(109, quoteReserves, true);
  view.setBigUint64(117, baseReserves, true);
  view.setBigUint64(125, 7_000n, true);
  view.setBigUint64(133, 9_000n, true);
  putU128(data, 141, 1_000_000_000n);
  data.set(encoder.encode(mintA), 157);
  data.set(encoder.encode(mintB), 189);
  data.set(encoder.encode(baseVault), 221);
  data.set(encoder.encode(quoteVault), 253);
  data.set(nonce, 285);
  data.set(encoder.encode(creator), 293);
  data[325] = bump;
  data.set(encoder.encode(key(`squads:${label}`)), 326);
  data.set(encoder.encode(key(`squads-vault:${label}`)), 358);
  data.set(encoder.encode(mintA), 390);
  data.set(encoder.encode(mintB), 422);
  view.setUint32(460, 86400, true);
  putU128(data, 464, price);
  putU128(data, 480, price);
  const accounts = {};
  function add(address, bytes) {
    accounts[address] = {
      address,
      owner: address === pool ? METADAO_PROGRAM : TOKEN_PROGRAM_ADDRESS,
      data: bytes,
      lamports: 100_000_000n,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, data);
  add(mintA, mintData(baseReserves + inputBalance + 9_000n));
  add(mintB, mintData(quoteReserves + inputBalance + 7_000n));
  add(baseVault, tokenData(mintA, pool, baseReserves + 9_000n));
  add(quoteVault, tokenData(mintB, pool, quoteReserves + 7_000n));
  add(userBase, tokenData(mintA, owner, inputBalance));
  add(userQuote, tokenData(mintB, owner, inputBalance));
  return {
    pool,
    creator,
    mintA,
    mintB,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    eventAuthority,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mintA : mintB,
      outputMint: reverse ? mintB : mintA,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      tokenAccounts: {
        input: reverse ? userBase : userQuote,
        output: reverse ? userQuote : userBase,
      },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
