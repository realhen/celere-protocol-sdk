import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

test("JavaScript consumers receive structured request, missing-state, and freshness errors", async () => {
  const fixture = await raydiumCpmmFixture(address("11111111111111111111111111111111"));
  const request = fixture.request;
  const missing = structuredClone(request);
  missing.snapshot.accounts[request.pool] = undefined;
  const discovery = await getSwapRequirements(missing);
  assert.equal(discovery.ok, true);
  assert.equal(discovery.value.complete, false);
  assert.equal(discovery.value.missing[0].address, request.pool);
  assert.equal((await buildSwapInstructions(missing)).error.code, "MISSING_ACCOUNTS");
  const stale = structuredClone(request);
  stale.snapshot.slot += 10n;
  stale.maxAccountAgeSlots = 1n;
  assert.equal(
    (await buildSwapInstructions(stale)).error.code,
    "INVALID_SNAPSHOT_CONTEXT",
  );
  const malformed = structuredClone(request);
  malformed.snapshot.accounts[request.pool] = { address: request.pool };
  assert.equal((await buildSwapInstructions(malformed)).error.code, "INVALID_ACCOUNT");
  for (const bad of [
    null,
    {},
    { ...request, amount: { kind: "exactIn", amountIn: 1.5 } },
  ]) {
    assert.equal((await buildSwapInstructions(bad)).error.code, "INVALID_REQUEST");
  }
});
