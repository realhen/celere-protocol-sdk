import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { SUGAR_PROGRAM } from "../../dist/protocols/sugar/constants.js";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder(),
  text = new TextEncoder();
function key(label) {
  return decoder.decode(createHash("sha256").update(`celere-sugar:${label}`).digest());
}
function u64(data, offset, value) {
  new DataView(data.buffer).setBigUint64(offset, value, true);
}
function token(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint));
  data.set(encoder.encode(owner), 32);
  u64(data, 64, amount);
  data[108] = 1;
  return data;
}
/** Synthetic public-layout Sugar v0 classic token curve; no customer observations. */
export async function sugarFixture(
  owner,
  { label = "default", buy = true, feeBps = 100n, position = 300_000_000_000_000n } = {},
) {
  const mint = key(`mint:${label}`),
    feeReceiver = key(`fee:${label}`);
  const [pool, bump] = await getProgramDerivedAddress({
    programAddress: SUGAR_PROGRAM,
    seeds: [text.encode("bonding_curve_"), encoder.encode(mint)],
  });
  const [solVault] = await getProgramDerivedAddress({
    programAddress: SUGAR_PROGRAM,
    seeds: [
      text.encode("bonding_curve_"),
      encoder.encode(mint),
      text.encode("_sol_vault"),
    ],
  });
  const [state, stateBump] = await getProgramDerivedAddress({
    programAddress: SUGAR_PROGRAM,
    seeds: [text.encode("state")],
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
  const curve = new Uint8Array(128);
  curve.set([191, 180, 249, 66, 180, 71, 51, 182]);
  curve[8] = bump;
  const virtualTokens = 1_073_000_000_000_000n - position;
  const virtualSol = (30_000_000_000n * 1_073_000_000_000_000n) / virtualTokens;
  const realSol = virtualSol - 30_000_000_000n;
  u64(curve, 18, 1_000_000_000_000_000n - position);
  u64(curve, 26, realSol);
  u64(curve, 34, virtualTokens);
  u64(curve, 42, virtualSol);
  const cfg = new Uint8Array(256);
  cfg.set([216, 146, 107, 94, 104, 75, 182, 177]);
  cfg[8] = stateBump;
  cfg[10] = 1;
  cfg.set(encoder.encode(feeReceiver), 107);
  u64(cfg, 139, feeBps);
  u64(cfg, 147, 1_073_000_000_000_000n);
  u64(cfg, 155, 30_000_000_000n);
  const md = new Uint8Array(82);
  u64(md, 36, 1_000_000_000_000_000n);
  md[44] = 6;
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
  add(pool, SUGAR_PROGRAM, curve);
  add(state, SUGAR_PROGRAM, cfg);
  add(solVault, SYSTEM_PROGRAM_ADDRESS, new Uint8Array(), realSol + 100_000_000n);
  add(mint, TOKEN_PROGRAM_ADDRESS, md);
  add(vault, TOKEN_PROGRAM_ADDRESS, token(mint, pool, 1_000_000_000_000_000n - position));
  add(user, TOKEN_PROGRAM_ADDRESS, token(mint, owner, 100_000_000_000_000n));
  add(feeReceiver, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  return {
    pool,
    mint,
    state,
    solVault,
    vault,
    user,
    feeReceiver,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: buy ? WRAPPED_SOL_MINT : mint,
      outputMint: buy ? mint : WRAPPED_SOL_MINT,
      amount: { kind: "exactIn", amountIn: buy ? 1_000_001n : 1_000_000_001n },
      slippageBps: 0,
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp: 1_800_000_000n, accounts },
      fillPolicy: "requireFull",
    },
  };
}
