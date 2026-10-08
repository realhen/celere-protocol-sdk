import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
export const BOOP_PROGRAM = address("boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4");
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-boop:${label}`).digest());
}
function u64(data, offset, amount) {
  new DataView(data.buffer).setBigUint64(offset, amount, true);
}
function token(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint));
  data.set(encoder.encode(owner), 32);
  u64(data, 64, amount);
  data[108] = 1;
  return data;
}
/** Synthetic pre-graduation Boop native-SOL curve; all values are caller-owned. */
export async function boopFixture(
  owner,
  { reverse = false, label = "default", selector = 31, feeBps = 100 } = {},
) {
  const mint = key(`mint:${label}`);
  async function pda(seed, withMint = true) {
    return (
      await getProgramDerivedAddress({
        programAddress: BOOP_PROGRAM,
        seeds: withMint ? [seed, encoder.encode(mint)] : [seed],
      })
    )[0];
  }
  const pool = await pda("bonding_curve"),
    tokenVault = await pda("bonding_curve_vault"),
    solVault = await pda("bonding_curve_sol_vault"),
    feesVault = await pda("trading_fees_vault"),
    authority = await pda("vault_authority", false),
    config = await pda("config", false);
  const [userToken] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const curve = new Uint8Array(125);
  curve.set([23, 183, 248, 55, 96, 216, 172, 96]);
  curve.set(encoder.encode(owner), 8);
  curve.set(encoder.encode(mint), 40);
  for (const [offset, amount] of [
    [72, 30_000_000_000n],
    [80, 1_000_000_000_000_000_000n],
    [88, 85_000_000_000n],
    [96, 5_000_000_000n],
    [104, 10_000_000_000n],
    [112, 750_000_000_000_000_000n],
  ])
    u64(curve, offset, amount);
  curve[120] = selector;
  curve[121] = feeBps;
  const configData = new Uint8Array(189);
  configData.set([155, 12, 170, 224, 30, 250, 204, 130]);
  configData.set(encoder.encode(owner), 9);
  configData.set(encoder.encode(owner), 77);
  configData.set(encoder.encode(owner), 109);
  for (const [offset, amount] of [
    [141, 30_000_000_000n],
    [149, 1_000_000_000_000_000_000n],
    [157, 85_000_000_000n],
    [165, 5_000_000_000n],
    [177, 200_000_000_000_000_000n],
  ])
    u64(configData, offset, amount);
  configData[173] = selector;
  configData[176] = feeBps;
  const mintData = new Uint8Array(82);
  u64(mintData, 36, 1_000_000_000_000_000_000n);
  mintData[44] = 9;
  mintData[45] = 1;
  const accounts = {};
  function add(address, owner, data, lamports = 100_000_000n) {
    accounts[address] = { address, owner, data, lamports, executable: false, slot: 100n };
  }
  add(pool, BOOP_PROGRAM, curve);
  add(config, BOOP_PROGRAM, configData);
  add(mint, TOKEN_PROGRAM_ADDRESS, mintData);
  const nativeMint = new Uint8Array(82);
  nativeMint[44] = 9;
  nativeMint[45] = 1;
  add(WRAPPED_SOL_MINT, TOKEN_PROGRAM_ADDRESS, nativeMint);
  add(
    tokenVault,
    TOKEN_PROGRAM_ADDRESS,
    token(mint, authority, 750_000_000_000_000_000n),
  );
  add(userToken, TOKEN_PROGRAM_ADDRESS, token(mint, owner, 100_000_000_000_000_000n));
  add(solVault, SYSTEM_PROGRAM_ADDRESS, new Uint8Array(), 10_000_000_000n);
  const feeData = token(WRAPPED_SOL_MINT, authority, 1_000_000n);
  new DataView(feeData.buffer).setUint32(109, 1, true);
  u64(feeData, 113, 2_039_280n);
  add(feesVault, TOKEN_PROGRAM_ADDRESS, feeData, 3_039_280n);
  return {
    pool,
    config,
    mint,
    tokenVault,
    solVault,
    feesVault,
    authority,
    userToken,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint : WRAPPED_SOL_MINT,
      outputMint: reverse ? WRAPPED_SOL_MINT : mint,
      amount: { kind: "exactIn", amountIn: reverse ? 1_000_000_003n : 100_000_003n },
      slippageBps: 0,
      tokenAccounts: reverse
        ? { input: userToken, output: owner }
        : { input: owner, output: userToken },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_791_496_000n, accounts },
      fillPolicy: reverse ? "requireFull" : "allowPartial",
    },
  };
}
