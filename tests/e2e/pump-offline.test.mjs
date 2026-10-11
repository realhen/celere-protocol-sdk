import {
  UnsupportedPoolFeatureError,
  UnsupportedSwapModeError,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/pump-observations.json", import.meta.url), "utf8"),
  (_, value) =>
    value && typeof value === "object" && "bigint" in value
      ? BigInt(value.bigint)
      : value && typeof value === "object" && "base64" in value
        ? Uint8Array.from(Buffer.from(value.base64, "base64"))
        : value,
);

test("Pump offline consumer reproduces quotes from real native swap observations", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("SDK attempted network access");
  };
  try {
    for (const observation of fixture.observations) {
      const request = structuredClone(observation.request);
      const discovered = await getSwapRequirements(request);

      assert.equal(discovered.complete, true);
      const built = await buildSwapInstructions(request);

      assert.deepEqual(built.quote, observation.quote);
      assert.equal(built.execution.mayPartiallyFill, false);
      const compiled = compileTransaction({
        instructions: built.instructions,
        feePayer: request.payer,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1n,
        },
      });

      assert.deepEqual(compiled.requiredSigners, [request.owner]);
      assert.ok(compiled.byteLength <= 1232);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("Pump caller can recover missing state and receives explicit unsupported-mode and variant errors", async () => {
  const request = structuredClone(fixture.observations[0].request);
  delete request.snapshot.accounts[request.pool];
  const discovery = await getSwapRequirements(request);

  assert.ok(discovery.missing.some((entry) => entry.address === request.pool));
  request.snapshot.accounts[request.pool] = structuredClone(
    fixture.observations[0].request.snapshot.accounts[request.pool],
  );
  request.snapshot.accounts[request.pool].data[81] = 1;
  await assert.rejects(
    () => buildSwapInstructions(request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      return true;
    },
  );
  const sell = structuredClone(fixture.observations.at(-1).request);
  sell.amount = { kind: "exactOut", amountOut: 1n };
  await assert.rejects(
    () => buildSwapInstructions(sell),
    (error) => {
      assert.ok(error instanceof UnsupportedSwapModeError);
      assert.equal(error.code, "UNSUPPORTED_SWAP_MODE");
      return true;
    },
  );
});
