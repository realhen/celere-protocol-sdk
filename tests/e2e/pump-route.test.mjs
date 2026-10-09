import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { createRouteSdk } from "../../dist/core/routes.js";
import { pumpRouteAdapter } from "../../dist/protocols/pump/route.js";
import { compileTransaction } from "../../dist/index.js";
import { pumpRouteFixture } from "../fixtures/pump-route.mjs";
const sdk = createRouteSdk([pumpRouteAdapter]);
const owner = address("11111111111111111111111111111112");
const value = (r) => {
  assert.ok(
    r.ok,
    JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return r.value;
};
test("caller discovers, builds, inspects and compiles native two/three hop routes without intermediate accounts", async () => {
  for (const kinds of [
    ["pool", "pool"],
    ["curve", "curve"],
    ["pool", "curve"],
    ["curve", "pool"],
    ["pool", "curve", "pool"],
  ])
    for (const reverse of [false, true]) {
      const f = await pumpRouteFixture(owner, { kinds, reverse });
      const complete = f.request.snapshot.accounts;
      f.request.snapshot.accounts = {};
      let done = false;
      for (let round = 0; round < 8; round++) {
        const r = value(await sdk.getRouteRequirements(f.request));
        if (r.complete) {
          done = true;
          break;
        }
        for (const missing of r.missing) {
          assert.notEqual(complete[missing.address], undefined, missing.role);
          f.request.snapshot.accounts[missing.address] = complete[missing.address];
        }
      }
      assert.equal(done, true);
      const b = value(await sdk.buildRouteInstructions(f.request));
      assert.equal(b.hops.length, kinds.length);
      assert.equal(b.swapInstructions.length, 1);
      assert.equal(b.swapInstructions[0].accounts.length, 16 + 5 * kinds.length);
      assert.equal(b.swapInstructions[0].data.length, 24);
      assert.equal(b.quote.expectedAmountIn, f.request.amount.amountIn);
      const first = f.venues[0];
      assert.deepEqual(b.assets, {
        input: !reverse && first.kind === "curve" ? "nativeSol" : "spl",
        output: reverse && first.kind === "curve" ? "nativeSol" : "spl",
      });
      const c = value(
        compileTransaction({
          instructions: b.instructions,
          feePayer: owner,
          lifetime: {
            blockhash: address("11111111111111111111111111111111"),
            lastValidBlockHeight: 1n,
          },
        }),
      );
      assert.ok(c.wireBytes.length <= 1232);
    }
});
test("native route consumer errors preserve exact output, direction, canonical venue, snapshot and fill contracts", async () => {
  const f = await pumpRouteFixture(owner, { kinds: ["curve", "pool"] });
  for (const [request, code] of [
    [
      { ...f.request, amount: { kind: "exactOut", amountOut: 1n } },
      "UNSUPPORTED_SWAP_MODE",
    ],
    [{ ...f.request, hops: [f.request.hops[0]] }, "INVALID_REQUEST"],
    [{ ...f.request, slippageBps: 10000 }, "INVALID_REQUEST"],
    [{ ...f.request, maxAccountAgeSlots: -1n }, "INVALID_REQUEST"],
  ]) {
    const r = await sdk.buildRouteInstructions(request);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, code);
  }
  const bad = structuredClone(f.request);
  bad.snapshot.accounts[f.venues[1].pool].data[9] = 1;
  assert.equal(
    (await sdk.buildRouteInstructions(bad)).error.code,
    "UNSUPPORTED_POOL_FEATURE",
  );
  assert.equal(
    value(await sdk.buildRouteInstructions({ ...f.request, fillPolicy: "requireFull" }))
      .execution.mayPartiallyFill,
    false,
  );
  const excessive = await pumpRouteFixture(owner, {
    kinds: ["pool", "curve", "pool", "curve", "pool"],
  });
  assert.equal(
    (await sdk.buildRouteInstructions(excessive.request)).error.code,
    "UNSUPPORTED_POOL_FEATURE",
  );
  const insolvent = structuredClone(f.request);
  insolvent.snapshot.accounts[f.venues[0].pool].lamports = 0n;
  assert.equal(
    (await sdk.buildRouteInstructions(insolvent)).error.code,
    "INVALID_ACCOUNT",
  );
  const outputAbsent = structuredClone(f.request);
  outputAbsent.snapshot.accounts[f.userBase] = null;
  const built = value(await sdk.buildRouteInstructions(outputAbsent));
  assert.equal(built.setupInstructions.length, 1);
  outputAbsent.snapshot.accounts[f.buyback] = null;
  outputAbsent.payer = address("11111111111111111111111111111113");
  const created = value(await sdk.buildRouteInstructions(outputAbsent));
  assert.equal(created.setupInstructions.length, 2);
  assert.deepEqual(
    new Set(created.requiredSigners),
    new Set([owner, outputAbsent.payer]),
  );
});
