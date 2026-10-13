import {
  InsufficientLiquidityError,
  UnsupportedFillPolicyError,
  UnsupportedTokenExtensionError,
  buildSwapInstructions,
  getSwapRequirements,
  compileTransaction,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { getMintDecoder, getMintEncoder } from "@solana-program/token-2022";

import { pumpV3Fixture, u64 } from "../fixtures/pump-v3.mjs";

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
        assert.equal((await getSwapRequirements(f.request)).complete, true);
        const built = await buildSwapInstructions(f.request);
        assert.equal(built.swapInstructions.at(-1).accounts.length, 17);
        assert.equal(built.execution.mayPartiallyFill, mode === "buyIn");
        assert.equal(built.quote.fees[1].mint, f.quoteMint);
        assert.ok(
          compileTransaction({
            instructions: built.instructions,
            feePayer: owner.address,
            lifetime: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 1n,
            },
          }).byteLength <= 1232,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  const f = await pumpV3Fixture(owner.address, { quote: "token", missingBuyback: true });
  let built = await buildSwapInstructions(f.request);
  assert.equal(built.swapInstructions.length, 1);
  assert.equal(built.setupInstructions.length, 1);
  assert.equal(built.requiredSigners.includes(owner.address), true);
  delete f.request.snapshot.accounts[f.buyback];
  const discovery = await getSwapRequirements(f.request);
  assert.equal(discovery.complete, false);
  assert.ok(discovery.missing.some((a) => a.address === f.buyback));
  f.request.snapshot.accounts[f.buyback] = null;
  f.request.fillPolicy = "requireFull";
  await assert.rejects(
    () => buildSwapInstructions(f.request),
    (error) => {
      assert.ok(error instanceof UnsupportedFillPolicyError);
      assert.equal(error.code, "UNSUPPORTED_FILL_POLICY");
      return true;
    },
  );
  const sol = await pumpV3Fixture(owner.address);
  sol.request.fillPolicy = "requireFull";
  built = await buildSwapInstructions(sol.request);
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
    await assert.rejects(() => buildSwapInstructions(f.request));
  }
  const f = await pumpV3Fixture(owner.address, { crossing: true, exactOut: true });
  f.request.amount.amountOut = 206_901_000_000_000n;
  await assert.rejects(
    () => buildSwapInstructions(f.request),
    (error) => {
      assert.ok(error instanceof InsufficientLiquidityError);
      assert.equal(error.code, "INSUFFICIENT_LIQUIDITY");
      return true;
    },
  );
  const t = await pumpV3Fixture(owner.address, { quote: "token", quote2022: true });
  const mint = t.request.snapshot.accounts[t.quoteMint];
  mint.data = Uint8Array.from(
    getMintEncoder().encode({
      ...getMintDecoder().decode(mint.data),
      extensions: [{ __kind: "NonTransferable" }],
    }),
  );
  await assert.rejects(
    () => buildSwapInstructions(t.request),
    (error) => {
      assert.ok(error instanceof UnsupportedTokenExtensionError);
      assert.equal(error.code, "UNSUPPORTED_TOKEN_EXTENSION");
      return true;
    },
  );
});
