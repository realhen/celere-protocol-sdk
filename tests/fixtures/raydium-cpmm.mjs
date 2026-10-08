import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

export const CPMM_PROGRAM = address("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
export const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const decodeAddress = getAddressDecoder();
const encodeAddress = getAddressEncoder();

function deterministicAddress(label) {
  return decodeAddress.decode(
    createHash("sha256").update(`celere-cpmm-fixture:${label}`).digest(),
  );
}

function discriminator(name) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function putAddress(data, offset, value) {
  data.set(encodeAddress.encode(value), offset);
}

function putU64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
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

/** Synthetic state with real program layouts; no user snapshots or private keys. */
export async function raydiumCpmmFixture(
  owner,
  { creatorFeeOn = 0, creatorFeeEnabled = true, reverse = false, label = "default" } = {},
) {
  const pool = deterministicAddress(`pool:${label}`);
  const mint0 = deterministicAddress(`mint0:${label}`);
  const mint1 = deterministicAddress(`mint1:${label}`);
  const vault0 = deterministicAddress(`vault0:${label}`);
  const vault1 = deterministicAddress(`vault1:${label}`);
  const user0 = deterministicAddress(`user0:${label}`);
  const user1 = deterministicAddress(`user1:${label}`);
  const [authority, authorityBump] = await getProgramDerivedAddress({
    programAddress: CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("vault_and_lp_mint_auth_seed")],
  });
  const [config, configBump] = await getProgramDerivedAddress({
    programAddress: CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("amm_config"), Uint8Array.of(0, 0)],
  });
  const [observation] = await getProgramDerivedAddress({
    programAddress: CPMM_PROGRAM,
    seeds: [new TextEncoder().encode("observation"), encodeAddress.encode(pool)],
  });
  const poolData = new Uint8Array(637);
  poolData.set(discriminator("PoolState"));
  for (const [offset, value] of [
    [8, config],
    [40, owner],
    [72, vault0],
    [104, vault1],
    [136, deterministicAddress(`lp:${label}`)],
    [168, mint0],
    [200, mint1],
    [232, TOKEN_PROGRAM],
    [264, TOKEN_PROGRAM],
    [296, observation],
  ])
    putAddress(poolData, offset, value);
  poolData[328] = authorityBump;
  poolData[330] = poolData[331] = poolData[332] = 6;
  putU64(poolData, 333, 1_000_000_000n);
  putU64(poolData, 341, 100_000n);
  putU64(poolData, 349, 200_000n);
  putU64(poolData, 357, 300_000n);
  putU64(poolData, 365, 400_000n);
  poolData[389] = creatorFeeOn;
  poolData[390] = Number(creatorFeeEnabled);
  putU64(poolData, 397, 500_000n);
  putU64(poolData, 405, 600_000n);
  const configData = new Uint8Array(236);
  configData.set(discriminator("AmmConfig"));
  configData[8] = configBump;
  putU64(configData, 12, 2500n);
  putU64(configData, 20, 120_000n);
  putU64(configData, 28, 40_000n);
  putU64(configData, 108, 1000n);
  const observationData = new Uint8Array(4075);
  observationData.set(discriminator("ObservationState"));
  putAddress(observationData, 11, pool);
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
  add(pool, CPMM_PROGRAM, poolData);
  add(config, CPMM_PROGRAM, configData);
  add(observation, CPMM_PROGRAM, observationData);
  add(mint0, TOKEN_PROGRAM, mintData());
  add(mint1, TOKEN_PROGRAM, mintData());
  add(vault0, TOKEN_PROGRAM, tokenData(mint0, authority, 1_000_900_000n));
  add(vault1, TOKEN_PROGRAM, tokenData(mint1, authority, 2_001_200_000n));
  add(user0, TOKEN_PROGRAM, tokenData(mint0, owner, 3_000_000_000n));
  add(user1, TOKEN_PROGRAM, tokenData(mint1, owner, 3_000_000_000n));
  const request = {
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
  };
  return {
    request,
    pool,
    config,
    observation,
    vault0,
    vault1,
    user0,
    user1,
    mint0,
    mint1,
    authority,
  };
}
