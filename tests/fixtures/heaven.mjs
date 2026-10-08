import { createHash } from "node:crypto";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { HEAVEN_PROGRAM } from "../../dist/protocols/heaven/constants.js";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder(),
  utf8 = new TextEncoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-heaven:${label}`).digest());
}
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function mintData(supply, decimals) {
  const data = new Uint8Array(82);
  u64(data, 36, supply);
  data[44] = decimals;
  data[45] = 1;
  return data;
}
function tokenData(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint));
  data.set(encoder.encode(owner), 32);
  u64(data, 64, amount);
  data[108] = 1;
  return data;
}
/** Synthetic constant-fee Heaven standard pool, with classic SPL tokens and WSOL collateral. */
export async function heavenFixture(
  owner,
  {
    label = "default",
    configVersion = 2,
    buy = true,
    protocolFeeBps = 25,
    creatorFeeBps = 100,
    reserveA = 800_000_000_000_000_000n,
    reserveB = 100_000_000_000n,
  } = {},
) {
  const mint = key(label),
    creator = key(`creator:${label}`);
  const [pool] = await getProgramDerivedAddress({
    programAddress: HEAVEN_PROGRAM,
    seeds: [
      utf8.encode("liquidity_pool_state"),
      encoder.encode(mint),
      encoder.encode(WRAPPED_SOL_MINT),
    ],
  });
  const [config, configBump] = await getProgramDerivedAddress({
    programAddress: HEAVEN_PROGRAM,
    seeds: [utf8.encode("protocol_config_state"), Uint8Array.of(0, configVersion)],
  });
  const ata = async (mint, owner) =>
    (
      await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS })
    )[0];
  const vaultA = await ata(mint, config),
    vaultB = await ata(WRAPPED_SOL_MINT, config),
    userA = await ata(mint, owner),
    userB = await ata(WRAPPED_SOL_MINT, owner);
  const state = new Uint8Array(2304);
  state.set([190, 158, 220, 130, 15, 162, 132, 252]);
  state.set(encoder.encode(creator), 8);
  u64(state, 72, 1n);
  u64(state, 80, 1n);
  new DataView(state.buffer).setUint16(88, configVersion, true);
  state[90] = 2;
  state[91] = configBump;
  state[92] = 254;
  for (const [offset, fee] of [
    [96, protocolFeeBps],
    [240, creatorFeeBps],
  ]) {
    u64(state, offset, (1n << 64n) - 1n);
    new DataView(state.buffer).setUint32(offset + 8, fee, true);
    new DataView(state.buffer).setUint32(offset + 12, fee, true);
    state[offset + 64] = 1;
  }
  u64(state, 456, reserveA);
  u64(state, 464, reserveB);
  u64(state, 472, 1n);
  u64(state, 480, reserveA);
  u64(state, 488, reserveB);
  u64(state, 504, 1_000_000_000_000_000_000n);
  u64(state, 512, 80_000_000_000n);
  state[520] = 1;
  for (const [offset, address] of [
    [664, vaultA],
    [696, vaultB],
    [728, config],
    [760, pool],
    [792, mint],
    [825, TOKEN_PROGRAM_ADDRESS],
    [857, WRAPPED_SOL_MINT],
    [890, TOKEN_PROGRAM_ADDRESS],
    [2272, creator],
  ])
    state.set(encoder.encode(address), offset);
  state[824] = 9;
  state[889] = 9;
  state[922] = 1;
  state[937] = 2;
  state[938] = 0;
  state[939] = 1;
  state[940] = 2;
  state[941] = 1;
  const cfg = new Uint8Array(1792);
  cfg.set([207, 91, 250, 28, 152, 179, 215, 209]);
  u64(cfg, 32, reserveB);
  u64(cfg, 24, 1_000_000_000_000_000_000n);
  u64(cfg, 72, (1n << 64n) - 1n);
  new DataView(cfg.buffer).setUint16(452, configVersion, true);
  cfg[454] = configBump;
  cfg[456] = 2;
  cfg[457] = 1;
  cfg[461] = 9;
  new DataView(cfg.buffer).setUint32(472, 3999, true);
  const accounts = {};
  function add(address, accountOwner, data, lamports = 100_000_000n) {
    accounts[address] = {
      address,
      owner: accountOwner,
      data,
      lamports,
      executable: false,
      slot: 100n,
    };
  }
  add(owner, SYSTEM_PROGRAM_ADDRESS, new Uint8Array(), 1_000_000_000_000n);
  add(pool, HEAVEN_PROGRAM, state);
  add(config, HEAVEN_PROGRAM, cfg);
  add(mint, TOKEN_PROGRAM_ADDRESS, mintData(1_000_000_000_000_000_000n, 9));
  add(WRAPPED_SOL_MINT, TOKEN_PROGRAM_ADDRESS, mintData(0n, 9));
  add(vaultA, TOKEN_PROGRAM_ADDRESS, tokenData(mint, config, reserveA));
  add(vaultB, TOKEN_PROGRAM_ADDRESS, tokenData(WRAPPED_SOL_MINT, config, reserveB));
  add(userA, TOKEN_PROGRAM_ADDRESS, tokenData(mint, owner, 100_000_000_000_000_000n));
  add(userB, TOKEN_PROGRAM_ADDRESS, tokenData(WRAPPED_SOL_MINT, owner, 100_000_000_000n));
  return {
    pool,
    mint,
    config,
    vaultA,
    vaultB,
    userA,
    userB,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: buy ? WRAPPED_SOL_MINT : mint,
      outputMint: buy ? mint : WRAPPED_SOL_MINT,
      amount: { kind: "exactIn", amountIn: buy ? 1_000_001n : 1_000_000_000_001n },
      slippageBps: 0,
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
