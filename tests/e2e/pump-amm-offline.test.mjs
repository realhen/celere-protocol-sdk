import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
} from "../../dist/index.js";
import { pumpAmmFixture, deterministicAddress } from "../fixtures/pump-amm.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/pump-amm-observations.json", import.meta.url),
    "utf8",
  ),
  (_, value) =>
    value && typeof value === "object" && "bigint" in value
      ? BigInt(value.bigint)
      : value && typeof value === "object" && "base64" in value
        ? Uint8Array.from(Buffer.from(value.base64, "base64"))
        : value,
);

test("Pump AMM offline public consumer reproduces native amounts and fees across both pool and token types", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline SDK attempted a network request");
  };
  try {
    for (const observation of fixture.observations) {
      const request = structuredClone(observation.request),
        requirements = await getSwapRequirements(request);
      assert.ok(requirements.ok);
      assert.equal(requirements.value.complete, true);
      const built = await buildSwapInstructions(request);
      assert.ok(
        built.ok,
        JSON.stringify(built, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
      );
      assert.equal(built.value.quote.expectedAmountIn, observation.actual.amountIn);
      assert.equal(built.value.quote.expectedAmountOut, observation.actual.amountOut);
      assert.equal(
        built.value.quote.fees.find((fee) => fee.kind === "trade").amount,
        observation.actual.tradeFee,
      );
      assert.equal(
        built.value.quote.fees.find((fee) => fee.kind === "creator").amount,
        observation.actual.creatorFee,
      );
      assert.deepEqual(built.value.assets, { input: "spl", output: "spl" });
      assert.equal(built.value.execution.mayPartiallyFill, false);
      const transaction = compileTransaction({
        instructions: built.value.instructions,
        feePayer: request.payer,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1n,
        },
      });
      assert.ok(transaction.ok);
      assert.deepEqual(transaction.value.requiredSigners, [request.owner]);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("Pump AMM caller resolves requirements and gets structured unsupported and invalid-state failures", async () => {
  const fixture = await pumpAmmFixture(deterministicAddress("offline-owner"));
  const request = structuredClone(fixture.request);
  delete request.snapshot.accounts[fixture.buybackAta];
  const discovered = await getSwapRequirements(request);
  assert.ok(discovered.ok);
  assert.ok(
    discovered.value.missing.some((account) => account.address === fixture.buybackAta),
  );
  const missing = await buildSwapInstructions(request);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "MISSING_ACCOUNTS");
  request.snapshot.accounts[fixture.buybackAta] = structuredClone(
    fixture.request.snapshot.accounts[fixture.buybackAta],
  );
  const built = await buildSwapInstructions(request);
  assert.ok(built.ok);
  const sell = await buildSwapInstructions({
    ...request,
    inputMint: request.outputMint,
    outputMint: request.inputMint,
    amount: { kind: "exactOut", amountOut: 1n },
  });
  assert.equal(sell.ok, false);
  assert.equal(sell.error.code, "UNSUPPORTED_SWAP_MODE");
  request.snapshot.accounts[request.pool].data[244] = 1;
  const cashback = await buildSwapInstructions(request);
  assert.equal(cashback.ok, false);
  assert.equal(cashback.error.code, "UNSUPPORTED_POOL_FEATURE");
  request.snapshot.accounts[request.pool].data[244] = 0;
  request.snapshot.accounts[fixture.buybackAta] = null;
  const absent = await buildSwapInstructions(request);
  assert.equal(absent.ok, true);
  assert.equal(absent.value.setupInstructions.length, 1);
});
