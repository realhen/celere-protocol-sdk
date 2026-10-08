import { createHash } from "node:crypto";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const AMM_V4_PROGRAM = address("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const decoder = getAddressDecoder();
const encoder = getAddressEncoder();

function deterministicAddress(label) {
  return decoder.decode(createHash("sha256").update(`celere-amm-v4:${label}`).digest());
}

function putU64(data, offset, amount) {
  new DataView(data.buffer).setBigUint64(offset, amount, true);
}

function mintData() {
  const data = new Uint8Array(82);
  putU64(data, 36, 100_000_000_000n);
  data[44] = 6;
  data[45] = 1;
  return data;
}

function tokenData(mint, authority, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint), 0);
  data.set(encoder.encode(authority), 32);
  putU64(data, 64, amount);
  data[108] = 1;
  return data;
}

/** Synthetic public-layout state with pending PnL; never uses user snapshots. */
export async function raydiumAmmV4Fixture(
  owner,
  {
    reverse = false,
    label = "default",
    feeNumerator = 25n,
    feeDenominator = 10_000n,
    status = 6n,
  } = {},
) {
  const pool = deterministicAddress(`pool:${label}`);
  const mint0 = deterministicAddress(`mint0:${label}`);
  const mint1 = deterministicAddress(`mint1:${label}`);
  const vault0 = deterministicAddress(`vault0:${label}`);
  const vault1 = deterministicAddress(`vault1:${label}`);
  const user0 = deterministicAddress(`user0:${label}`);
  const user1 = deterministicAddress(`user1:${label}`);
  const [authority, bump] = await getProgramDerivedAddress({
    programAddress: AMM_V4_PROGRAM,
    seeds: [new TextEncoder().encode("amm authority")],
  });
  const poolData = new Uint8Array(752);
  for (const [offset, amount] of [
    [0, status],
    [8, BigInt(bump)],
    [32, 6n],
    [40, 6n],
    [176, feeNumerator],
    [184, feeDenominator],
    [192, 900_000n],
    [200, 1_200_000n],
  ])
    putU64(poolData, offset, amount);
  for (const [offset, key] of [
    [336, vault0],
    [368, vault1],
    [400, mint0],
    [432, mint1],
  ])
    poolData.set(encoder.encode(key), offset);
  const accounts = {};
  function add(key, accountOwner, data) {
    accounts[key] = {
      address: key,
      owner: accountOwner,
      data,
      lamports: 100_000_000n,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, AMM_V4_PROGRAM, poolData);
  add(mint0, TOKEN_PROGRAM_ADDRESS, mintData());
  add(mint1, TOKEN_PROGRAM_ADDRESS, mintData());
  add(vault0, TOKEN_PROGRAM_ADDRESS, tokenData(mint0, authority, 1_000_900_000n));
  add(vault1, TOKEN_PROGRAM_ADDRESS, tokenData(mint1, authority, 2_001_200_000n));
  add(user0, TOKEN_PROGRAM_ADDRESS, tokenData(mint0, owner, 3_000_000_000n));
  add(user1, TOKEN_PROGRAM_ADDRESS, tokenData(mint1, owner, 3_000_000_000n));
  return {
    pool,
    mint0,
    mint1,
    vault0,
    vault1,
    user0,
    user1,
    authority,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint1 : mint0,
      outputMint: reverse ? mint0 : mint1,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      tokenAccounts: { input: reverse ? user1 : user0, output: reverse ? user0 : user1 },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
