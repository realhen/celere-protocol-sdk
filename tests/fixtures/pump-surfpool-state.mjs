import { before, after } from "node:test";
import { PUMP, PUMP_AMM, FEE_PROGRAM, SOL, SYSTEM, pda } from "./pump-amm.mjs";
import { USDC } from "./pump-amm-quotes.mjs";
import { rpc } from "./pump-helpers.mjs";

/** Restore shared native configuration after a synthetic fixture file mutates the simulator. */
export function preservePumpConfiguration(endpoint) {
  if (!endpoint) return;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
    throw Error("Synthetic Pump fixtures require loopback Surfpool");
  let saved = [];
  before(async () => {
    const addresses = await Promise.all([
      pda(PUMP, "global"),
      pda(PUMP_AMM, "global_config"),
      pda(FEE_PROGRAM, "fee_config", PUMP),
      pda(FEE_PROGRAM, "fee_config", PUMP_AMM),
      SOL,
      USDC,
    ]);
    const { value } = await rpc(endpoint, "getMultipleAccounts", [
      addresses,
      { encoding: "base64" },
    ]);
    saved = addresses.map((address, index) => [address, value[index]]);
  });
  after(async () => {
    for (const [address, account] of saved) {
      await rpc(endpoint, "surfnet_setAccount", [
        address,
        {
          owner: account?.owner ?? SYSTEM,
          lamports: account?.lamports ?? 0,
          executable: account?.executable ?? false,
          data: account ? Buffer.from(account.data[0], "base64").toString("hex") : "",
        },
      ]);
    }
  });
}
