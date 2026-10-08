import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const DAMM_V2_PROGRAM = address("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const TOKEN_2022_PROGRAM = TOKEN_2022_PROGRAM_ADDRESS;
const AUTHORITY = address("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
const encodeAddress = getAddressEncoder();
const decodeAddress = getAddressDecoder();

function deterministicAddress(label) {
  return decodeAddress.decode(
    createHash("sha256").update(`celere-damm-v2-fixture:${label}`).digest(),
  );
}

function putAddress(data, offset, value) {
  data.set(encodeAddress.encode(value), offset);
}

function putU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}

export function putU128(data, offset, value) {
  putU64(data, offset, value & ((1n << 64n) - 1n));
  putU64(data, offset + 8, value >> 64n);
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
  putAddress(data, 0, mint);
  putAddress(data, 32, authority);
  putU64(data, 64, amount);
  data[108] = 1;
  return data;
}

/** Synthetic immutable observations with real mainnet layouts; no user data or keys. */
export async function meteoraDammV2Fixture(
  owner,
  {
    label = "default",
    reverse = false,
    collectFeeMode = 0,
    token2022 = false,
    linearFee = false,
  } = {},
) {
  const suffix = `${owner}:${label}`;
  const pool = deterministicAddress(`pool:${suffix}`);
  const mintA = deterministicAddress(`mintA:${suffix}`);
  const mintB = deterministicAddress(`mintB:${suffix}`);
  const userA = deterministicAddress(`userA:${suffix}`);
  const userB = deterministicAddress(`userB:${suffix}`);
  const tokenProgram = token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  async function vault(mint) {
    return (
      await getProgramDerivedAddress({
        programAddress: DAMM_V2_PROGRAM,
        seeds: [
          new TextEncoder().encode("token_vault"),
          encodeAddress.encode(mint),
          encodeAddress.encode(pool),
        ],
      })
    )[0];
  }
  const vaultA = await vault(mintA);
  const vaultB = await vault(mintB);
  const poolData = new Uint8Array(1112);
  poolData.set(createHash("sha256").update("account:Pool").digest().subarray(0, 8));
  putU64(poolData, 8, 3_000_000n);
  if (linearFee) {
    new DataView(poolData.buffer).setUint16(22, 10, true);
    putU64(poolData, 24, 1n);
    putU64(poolData, 32, 100_000n);
  }
  poolData[48] = 20;
  poolData[50] = 20;
  const sqrtPrice = 1n << 64n;
  putU128(poolData, 152, sqrtPrice);
  putAddress(poolData, 168, mintA);
  putAddress(poolData, 200, mintB);
  putAddress(poolData, 232, vaultA);
  putAddress(poolData, 264, vaultB);
  putU128(poolData, 360, 2_000_000_000n * sqrtPrice);
  putU64(poolData, 392, 100_000n);
  putU64(poolData, 400, 200_000n);
  putU128(poolData, 424, sqrtPrice / 2n);
  putU128(poolData, 440, sqrtPrice * 2n);
  putU128(poolData, 456, sqrtPrice);
  poolData[482] = poolData[483] = Number(token2022);
  poolData[484] = collectFeeMode;
  poolData[486] = 1;
  putAddress(poolData, 648, owner);
  putU64(poolData, 680, 1_000_000_000n);
  putU64(poolData, 688, 1_000_000_000n);
  poolData[696] = 1;
  const accounts = {};
  function add(accountAddress, accountOwner, data) {
    accounts[accountAddress] = {
      address: accountAddress,
      owner: accountOwner,
      data,
      lamports: 100_000_000n,
      executable: false,
      slot: 100n,
    };
  }
  add(pool, DAMM_V2_PROGRAM, poolData);
  add(mintA, tokenProgram, mintData());
  add(mintB, tokenProgram, mintData());
  add(vaultA, tokenProgram, tokenData(mintA, AUTHORITY, 1_000_100_000n));
  add(vaultB, tokenProgram, tokenData(mintB, AUTHORITY, 1_000_200_000n));
  add(userA, tokenProgram, tokenData(mintA, owner, 3_000_000_000n));
  add(userB, tokenProgram, tokenData(mintB, owner, 3_000_000_000n));
  return {
    pool,
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
