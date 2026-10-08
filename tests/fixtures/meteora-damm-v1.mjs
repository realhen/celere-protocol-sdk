import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
export const DAMM_V1_PROGRAM = address("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
export const VAULT_PROGRAM = address("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi");
const enc = getAddressEncoder(),
  dec = getAddressDecoder(),
  utf8 = new TextEncoder();
function key(label) {
  return dec.decode(createHash("sha256").update(`celere-damm-v1:${label}`).digest());
}
function put(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function mint(supply, authority) {
  const data = new Uint8Array(82);
  put(data, 36, supply);
  data[44] = 6;
  data[45] = 1;
  if (authority) {
    data[0] = 1;
    data.set(enc.encode(authority), 4);
  }
  return data;
}
function token(mint, authority, amount) {
  const data = new Uint8Array(165);
  data.set(enc.encode(mint), 0);
  data.set(enc.encode(authority), 32);
  put(data, 64, amount);
  data[108] = 1;
  return data;
}
async function pda(programAddress, seeds) {
  return getProgramDerivedAddress({ programAddress, seeds });
}
/** Synthetic non-unit vault shares and liquidity under the deployed program ABIs. */
export async function meteoraDammV1Fixture(
  owner,
  {
    reverse = false,
    poolType = 1,
    label = "default",
    tradeNumerator = 25n,
    protocolNumerator = 2000n,
    lockedProfit = 0n,
    lastReport = 0n,
    degradation = 0n,
    unixTimestamp = 1_800_000_000n,
    amountIn = 1_000_003n,
  } = {},
) {
  const pool = key(`pool:${label}`),
    mintA = key(`mintA:${label}`),
    mintB = key(`mintB:${label}`),
    userA = key(`userA:${label}`),
    userB = key(`userB:${label}`);
  const poolData = new Uint8Array(1387);
  poolData.set([241, 154, 109, 4, 17, 177, 109, 188]);
  poolData[233] = 1;
  poolData[362] = poolType;
  poolData[475] = 1;
  for (const [offset, n] of [
    [330, tradeNumerator],
    [338, 10000n],
    [346, protocolNumerator],
    [354, 10000n],
  ])
    put(poolData, offset, n);
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
  const vaults = [];
  for (const [i, mintKey, total, supply, shares] of [
    [0, mintA, 2_000_000_333n, 1_400_000_017n, 400_000_011n],
    [1, mintB, 4_000_000_777n, 3_000_000_029n, 1_000_000_033n],
  ]) {
    const [vault, bump] = await pda(VAULT_PROGRAM, [
      utf8.encode("vault"),
      enc.encode(mintKey),
      enc.encode(SYSTEM_PROGRAM_ADDRESS),
    ]);
    const [tokenVault, tokenBump] = await pda(VAULT_PROGRAM, [
      utf8.encode("token_vault"),
      enc.encode(vault),
    ]);
    const [lpMint] = await pda(VAULT_PROGRAM, [
      utf8.encode("lp_mint"),
      enc.encode(vault),
    ]);
    const [share, shareBump] = await pda(DAMM_V1_PROGRAM, [
      enc.encode(vault),
      enc.encode(pool),
    ]);
    const [fee] = await pda(DAMM_V1_PROGRAM, [
      utf8.encode("fee"),
      enc.encode(mintKey),
      enc.encode(pool),
    ]);
    const vaultData = new Uint8Array(10240);
    vaultData.set([211, 8, 232, 43, 2, 152, 117, 119]);
    vaultData[8] = 1;
    vaultData[9] = bump;
    vaultData[10] = tokenBump;
    put(vaultData, 11, total);
    put(vaultData, 1203, lockedProfit);
    put(vaultData, 1211, lastReport);
    put(vaultData, 1219, degradation);
    for (const [offset, k] of [
      [19, tokenVault],
      [83, mintKey],
      [115, lpMint],
    ])
      vaultData.set(enc.encode(k), offset);
    for (const [offset, k] of [
      [40 + i * 32, mintKey],
      [104 + i * 32, vault],
      [168 + i * 32, share],
      [234 + i * 32, fee],
    ])
      poolData.set(enc.encode(k), offset);
    if (i === 0) poolData[232] = shareBump;
    add(vault, VAULT_PROGRAM, vaultData);
    add(mintKey, TOKEN_PROGRAM_ADDRESS, mint(10_000_000_000n));
    add(lpMint, TOKEN_PROGRAM_ADDRESS, mint(supply, vault));
    add(tokenVault, TOKEN_PROGRAM_ADDRESS, token(mintKey, vault, total));
    vaults.push({
      vault,
      tokenVault,
      lpMint,
      share,
      fee,
      mint: mintKey,
      total,
      supply,
      shares,
    });
  }
  for (const v of vaults) {
    add(v.share, TOKEN_PROGRAM_ADDRESS, token(v.lpMint, vaults[0].share, v.shares));
    add(v.fee, TOKEN_PROGRAM_ADDRESS, token(v.mint, vaults[0].share, 177n));
  }
  add(pool, DAMM_V1_PROGRAM, poolData);
  add(userA, TOKEN_PROGRAM_ADDRESS, token(mintA, owner, 3_000_000_000n));
  add(userB, TOKEN_PROGRAM_ADDRESS, token(mintB, owner, 3_000_000_000n));
  return {
    pool,
    mintA,
    mintB,
    userA,
    userB,
    vaults,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mintB : mintA,
      outputMint: reverse ? mintA : mintB,
      amount: { kind: "exactIn", amountIn },
      slippageBps: 0,
      tokenAccounts: { input: reverse ? userB : userA, output: reverse ? userA : userB },
      fillPolicy: "requireFull",
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp, accounts },
    },
  };
}
