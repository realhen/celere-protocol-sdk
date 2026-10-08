import { createHash } from "node:crypto";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
export const LAUNCHLAB_PROGRAM = address("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const encode = getAddressEncoder();
function addressFor(label) {
  return getAddressDecoder().decode(
    createHash("sha256").update(`celere-launchlab:${label}`).digest(),
  );
}
function disc(name) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function key(data, offset, value) {
  data.set(encode.encode(value), offset);
}
async function pda(seeds) {
  return getProgramDerivedAddress({
    programAddress: LAUNCHLAB_PROGRAM,
    seeds: seeds.map((seed) =>
      typeof seed === "string" ? new TextEncoder().encode(seed) : seed,
    ),
  });
}
function mintData(supply) {
  const data = new Uint8Array(82);
  u64(data, 36, supply);
  data[44] = 6;
  data[45] = 1;
  return data;
}
function tokenData(mint, owner, amount) {
  const data = new Uint8Array(165);
  key(data, 0, mint);
  key(data, 32, owner);
  u64(data, 64, amount);
  data[108] = 1;
  return data;
}
/** Synthetic account observations for native LaunchLab consumer workflows. */
export async function raydiumLaunchlabFixture(
  owner,
  {
    buy = true,
    label = "default",
    tradeRate = 2500n,
    platformRate = 7500n,
    creatorRate = 5000n,
    base2022 = false,
    quote2022 = false,
  } = {},
) {
  const baseMint = addressFor(`base:${label}`),
    quoteMint = addressFor(`quote:${label}`),
    platform = addressFor(`platform:${label}`),
    creator = addressFor(`creator:${label}`);
  const [authority, bump] = await pda(["vault_auth_seed"]);
  const [pool] = await pda(["pool", encode.encode(baseMint), encode.encode(quoteMint)]);
  const [baseVault] = await pda([
    "pool_vault",
    encode.encode(pool),
    encode.encode(baseMint),
  ]);
  const [quoteVault] = await pda([
    "pool_vault",
    encode.encode(pool),
    encode.encode(quoteMint),
  ]);
  const [config] = await pda([
    "global_config",
    encode.encode(quoteMint),
    Uint8Array.of(0),
    Uint8Array.of(0, 0),
  ]);
  const [platformFeeVault] = await pda([
    encode.encode(platform),
    encode.encode(quoteMint),
  ]);
  const [creatorFeeVault] = await pda([encode.encode(creator), encode.encode(quoteMint)]);
  const [platformFeeAuthority] = await pda(["platform_fee_vault_auth_seed"]);
  const [creatorFeeAuthority] = await pda(["creator_fee_vault_auth_seed"]);
  const userBase = addressFor(`userbase:${owner}:${label}`),
    userQuote = addressFor(`userquote:${owner}:${label}`);
  const baseProgram = base2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  const quoteProgram = quote2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
  const poolData = new Uint8Array(429);
  poolData.set(disc("PoolState"));
  poolData[16] = bump;
  poolData[18] = 6;
  poolData[19] = 6;
  poolData[20] = 1;
  poolData[365] = Number(base2022) + Number(quote2022) * 2;
  for (const [offset, value] of [
    [21, 1_000_000_000_000_000n],
    [29, 800_000_000_000_000n],
    [37, 1_073_000_000_000_000n],
    [45, 30_000_000_000n],
    [53, 100_000_000_000_000n],
    [61, 3_083_247_687n],
    [69, 85_000_000_000n],
  ])
    u64(poolData, offset, value);
  for (const [offset, value] of [
    [141, config],
    [173, platform],
    [205, baseMint],
    [237, quoteMint],
    [269, baseVault],
    [301, quoteVault],
    [333, creator],
  ])
    key(poolData, offset, value);
  const configData = new Uint8Array(371);
  configData.set(disc("GlobalConfig"));
  u64(configData, 27, tradeRate);
  key(configData, 83, quoteMint);
  const platformData = new Uint8Array(944);
  platformData.set(disc("PlatformConfig"));
  u64(platformData, 104, platformRate);
  u64(platformData, 720, creatorRate);
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
  add(pool, LAUNCHLAB_PROGRAM, poolData);
  add(config, LAUNCHLAB_PROGRAM, configData);
  add(platform, LAUNCHLAB_PROGRAM, platformData);
  add(baseMint, baseProgram, mintData(1_000_000_000_000_000n));
  add(quoteMint, quoteProgram, mintData(1_000_000_000_000n));
  add(baseVault, baseProgram, tokenData(baseMint, authority, 900_000_000_000_000n));
  add(quoteVault, quoteProgram, tokenData(quoteMint, authority, 3_083_247_687n));
  add(userBase, baseProgram, tokenData(baseMint, owner, 100_000_000_000_000n));
  add(userQuote, quoteProgram, tokenData(quoteMint, owner, 20_000_000_000n));
  add(platformFeeVault, quoteProgram, tokenData(quoteMint, platformFeeAuthority, 0n));
  add(creatorFeeVault, quoteProgram, tokenData(quoteMint, creatorFeeAuthority, 0n));
  return {
    pool,
    config,
    platform,
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
    userBase,
    userQuote,
    platformFeeVault,
    creatorFeeVault,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: buy ? quoteMint : baseMint,
      outputMint: buy ? baseMint : quoteMint,
      amount: { kind: "exactIn", amountIn: buy ? 1_000_001n : 1_000_000_001n },
      slippageBps: 50,
      fillPolicy: buy ? "allowPartial" : "requireFull",
      tokenAccounts: {
        input: buy ? userQuote : userBase,
        output: buy ? userBase : userQuote,
      },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
    },
  };
}
