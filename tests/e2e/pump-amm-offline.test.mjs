import {
  MissingAccountsError,
  UnsupportedPoolFeatureError,
  UnsupportedSwapModeError,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

      assert.equal(requirements.complete, true);
      const built = await buildSwapInstructions(request);
      assert.equal(built.quote.expectedAmountIn, observation.actual.amountIn);
      assert.equal(built.quote.expectedAmountOut, observation.actual.amountOut);
      assert.equal(
        built.quote.fees.find((fee) => fee.kind === "trade").amount,
        observation.actual.tradeFee,
      );
      assert.equal(
        built.quote.fees.find((fee) => fee.kind === "creator").amount,
        observation.actual.creatorFee,
      );
      assert.deepEqual(built.assets, { input: "spl", output: "spl" });
      assert.equal(built.execution.mayPartiallyFill, false);
      const transaction = compileTransaction({
        instructions: built.instructions,
        feePayer: request.payer,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1n,
        },
      });

      assert.deepEqual(transaction.requiredSigners, [request.owner]);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("Pump AMM caller resolves requirements and gets typed unsupported and invalid-state failures", async () => {
  const fixture = await pumpAmmFixture(deterministicAddress("offline-owner"));
  const request = structuredClone(fixture.request);
  delete request.snapshot.accounts[fixture.buybackAta];
  const discovered = await getSwapRequirements(request);

  assert.ok(discovered.missing.some((account) => account.address === fixture.buybackAta));
  await assert.rejects(
    () => buildSwapInstructions(request),
    (error) => {
      assert.ok(error instanceof MissingAccountsError);
      assert.equal(error.code, "MISSING_ACCOUNTS");
      return true;
    },
  );
  request.snapshot.accounts[fixture.buybackAta] = structuredClone(
    fixture.request.snapshot.accounts[fixture.buybackAta],
  );
  await buildSwapInstructions(request);

  await assert.rejects(
    () =>
      buildSwapInstructions({
        ...request,
        inputMint: request.outputMint,
        outputMint: request.inputMint,
        amount: { kind: "exactOut", amountOut: 1n },
      }),
    (error) => {
      assert.ok(error instanceof UnsupportedSwapModeError);
      assert.equal(error.code, "UNSUPPORTED_SWAP_MODE");
      return true;
    },
  );
  request.snapshot.accounts[request.pool].data[244] = 1;
  await assert.rejects(
    () => buildSwapInstructions(request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      return true;
    },
  );
  request.snapshot.accounts[request.pool].data[244] = 0;
  request.snapshot.accounts[fixture.buybackAta] = null;
  const absent = await buildSwapInstructions(request);

  assert.equal(absent.setupInstructions.length, 1);
});
