import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import {
  buildSwapInstructions,
  getSwapRequirements,
  compileTransaction,
} from "../../dist/index.js";
import { pumpV3Fixture, u64 } from "../fixtures/pump-v3.mjs";
function value(r) {
  assert.equal(
    r.ok,
    true,
    JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return r.value;
}
test("Pump v3 public offline workflow discovers quote dependencies and compiles native modes", async () => {
  const owner = await generateKeyPairSigner();
  for (const quote of ["sol", "usdc", "token"])
    for (const mode of ["buyIn", "buyOut", "sellIn"]) {
      const f = await pumpV3Fixture(owner.address, {
        quote,
        buy: mode !== "sellIn",
        exactOut: mode === "buyOut",
        base2022: true,
        quote2022: quote === "token",
        customCreator: true,
        holder: quote === "token",
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () => {
        throw Error("SDK attempted network");
      };
      try {
        assert.equal(value(await getSwapRequirements(f.request)).complete, true);
        const built = value(await buildSwapInstructions(f.request));
        assert.equal(built.swapInstructions.at(-1).accounts.length, 17);
        assert.equal(built.execution.mayPartiallyFill, mode === "buyIn");
        assert.equal(built.quote.fees[1].mint, f.quoteMint);
        assert.ok(
          value(
            compileTransaction({
              instructions: built.instructions,
              feePayer: owner.address,
              lifetime: {
                blockhash: "11111111111111111111111111111111",
                lastValidBlockHeight: 1n,
              },
            }),
          ).byteLength <= 1232,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  const f = await pumpV3Fixture(owner.address, { quote: "token", missingBuyback: true });
  let built = value(await buildSwapInstructions(f.request));
  assert.equal(built.swapInstructions.length, 1);
  assert.equal(built.setupInstructions.length, 1);
  assert.equal(built.requiredSigners.includes(owner.address), true);
  delete f.request.snapshot.accounts[f.buyback];
  const discovery = value(await getSwapRequirements(f.request));
  assert.equal(discovery.complete, false);
  assert.ok(discovery.missing.some((a) => a.address === f.buyback));
  f.request.snapshot.accounts[f.buyback] = null;
  f.request.fillPolicy = "requireFull";
  const strict = await buildSwapInstructions(f.request);
  assert.equal(strict.ok, false);
  assert.equal(strict.error.code, "UNSUPPORTED_FILL_POLICY");
  const sol = await pumpV3Fixture(owner.address);
  sol.request.fillPolicy = "requireFull";
  built = value(await buildSwapInstructions(sol.request));
  assert.equal(built.execution.mayPartiallyFill, false);
  assert.equal(built.swapInstructions[0].accounts.length, 18);
});
test("Pump v3 rejects completed markets, invalid quote backing, unsupported extensions and impossible synthetic output", async () => {
  const owner = await generateKeyPairSigner();
  for (const mutate of [
    (f) => (f.request.snapshot.accounts[f.pool].data[48] = 1),
    (f) => u64(f.request.snapshot.accounts[f.quoteVault].data, 64, 0n),
    (f) => (f.request.outputMint = f.quoteMint),
  ]) {
    const f = await pumpV3Fixture(owner.address, { quote: "token" });
    mutate(f);
    assert.equal((await buildSwapInstructions(f.request)).ok, false);
  }
  const f = await pumpV3Fixture(owner.address, { crossing: true, exactOut: true });
  f.request.amount.amountOut = 206_901_000_000_000n;
  const out = await buildSwapInstructions(f.request);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "INSUFFICIENT_LIQUIDITY");
  const t = await pumpV3Fixture(owner.address, { quote: "token", quote2022: true });
  const d = new Uint8Array(178);
  d.set(t.request.snapshot.accounts[t.quoteMint].data);
  d[165] = 1;
  d[166] = 1;
  d[168] = 8;
  t.request.snapshot.accounts[t.quoteMint].data = d;
  const unsupported = await buildSwapInstructions(t.request);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "UNSUPPORTED_TOKEN_EXTENSION");
});
