import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { MOONSHOT_PROGRAM } from "../../dist/protocols/moonshot/curve.js";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
const utf8 = new TextEncoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-moonshot:${label}`).digest());
}
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function token(mint, owner, amount) {
  const d = new Uint8Array(165);
  d.set(encoder.encode(mint));
  d.set(encoder.encode(owner), 32);
  u64(d, 64, amount);
  d[108] = 1;
  return d;
}
/** Synthetic public-layout curve state; addresses and observations contain no customer data. */
export async function moonshotFixture(
  owner,
  {
    label = "default",
    buy = true,
    curveType = 1,
    feeBps = 100,
    position = 300_000_000_000_000_000n,
  } = {},
) {
  const mint = key(`mint:${label}`);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: MOONSHOT_PROGRAM,
    seeds: [utf8.encode("token"), encoder.encode(mint)],
  });
  const [config, configBump] = await getProgramDerivedAddress({
    programAddress: MOONSHOT_PROGRAM,
    seeds: [utf8.encode("config_account")],
  });
  const [vault] = await findAssociatedTokenPda({
    mint,
    owner: pool,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [user] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const dexFee = key(`dex:${label}`),
    helioFee = key(`helio:${label}`);
  const curve = new Uint8Array(128);
  curve.set([8, 91, 83, 28, 132, 216, 248, 22]);
  u64(curve, 8, 1_000_000_000_000_000_000n);
  u64(curve, 16, 1_000_000_000_000_000_000n - position);
  curve.set(encoder.encode(mint), 24);
  curve[56] = 9;
  curve[58] = curveType;
  u64(curve, 59, curveType === 1 ? 345_000_000_000n : 200_000_000_000n);
  u64(curve, 68, 6_000_000_000n);
  curve[80] = bump;
  const cfg = new Uint8Array(256);
  cfg.set([189, 255, 97, 70, 186, 189, 24, 102]);
  cfg.set(encoder.encode(helioFee), 104);
  cfg.set(encoder.encode(dexFee), 136);
  new DataView(cfg.buffer).setUint16(168, feeBps, true);
  cfg[170] = 40;
  cfg[206] = configBump;
  u64(cfg, 211, 345_000_000_000n);
  u64(cfg, 219, 200_000_000_000n);
  const md = new Uint8Array(82);
  u64(md, 36, 1_000_000_000_000_000_000n);
  md[44] = 9;
  md[45] = 1;
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
  add(pool, MOONSHOT_PROGRAM, curve, 100_000_000_000n);
  add(config, MOONSHOT_PROGRAM, cfg);
  add(mint, TOKEN_PROGRAM_ADDRESS, md);
  add(
    vault,
    TOKEN_PROGRAM_ADDRESS,
    token(mint, pool, 1_000_000_000_000_000_000n - position),
  );
  add(user, TOKEN_PROGRAM_ADDRESS, token(mint, owner, 100_000_000_000_000_000n));
  add(dexFee, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  add(helioFee, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  return {
    pool,
    mint,
    config,
    vault,
    user,
    dexFee,
    helioFee,
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
