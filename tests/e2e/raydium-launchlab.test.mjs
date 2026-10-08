import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import {
  raydiumLaunchlabFixture,
  LAUNCHLAB_PROGRAM,
} from "../fixtures/raydium-launchlab.mjs";
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, item) => (typeof item === "bigint" ? String(item) : item)),
  );
  return result.value;
}

test("offline LaunchLab consumer discovers accounts and builds native supported swap modes", async () => {
  const signer = await generateKeyPairSigner();
  const saved = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Builder must not access the network");
  };
  try {
    for (const buy of [true, false]) {
      const fixture = await raydiumLaunchlabFixture(signer.address, { buy });
      const discovery = value(
        await getSwapRequirements({
          ...fixture.request,
          snapshot: {
            ...fixture.request.snapshot,
            accounts: { [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool] },
          },
        }),
      );
      assert.equal(discovery.protocol, "launchlab");
      assert.equal(discovery.complete, false);
      assert.ok(discovery.missing.some((item) => item.address === fixture.platform));
      assert.ok(discovery.missing.some((item) => item.address === fixture.config));
      assert.equal(value(await getSwapRequirements(fixture.request)).complete, true);
      for (const amount of buy
        ? [fixture.request.amount]
        : [fixture.request.amount, { kind: "exactOut", amountOut: 1_000_001n }]) {
        const built = value(await buildSwapInstructions({ ...fixture.request, amount }));
        assert.equal(built.protocol, "launchlab");
        assert.equal(built.execution.mayPartiallyFill, buy);
        assert.equal(built.swapInstructions[0].programAddress, LAUNCHLAB_PROGRAM);
        assert.equal(built.swapInstructions[0].accounts.length, 18);
        assert.equal(built.quote.kind, amount.kind);
        assert.deepEqual(structuredClone(built), built);
      }
    }
  } finally {
    globalThis.fetch = saved;
  }
});

test("LaunchLab consumer receives explicit unsupported guarantees and invalid snapshot errors", async () => {
  const signer = await generateKeyPairSigner();
  const fixture = await raydiumLaunchlabFixture(signer.address);
  for (const fillPolicy of ["allowPartial", "requireFull"]) {
    const result = await buildSwapInstructions({
      ...fixture.request,
      fillPolicy,
      amount: { kind: "exactOut", amountOut: 1_000_000n },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNSUPPORTED_SWAP_MODE");
  }
  const full = await buildSwapInstructions({
    ...fixture.request,
    fillPolicy: "requireFull",
  });
  assert.equal(full.ok, false);
  assert.equal(full.error.code, "UNSUPPORTED_FILL_POLICY");
  fixture.request.snapshot.accounts[fixture.config].data[16] = 1;
  const curve = await buildSwapInstructions(fixture.request);
  assert.equal(curve.ok, false);
  assert.equal(curve.error.code, "UNSUPPORTED_POOL_FEATURE");
  fixture.request.snapshot.accounts[fixture.config].data[16] = 0;
  fixture.request.snapshot.accounts[fixture.pool].data[17] = 1;
  const closed = await buildSwapInstructions(fixture.request);
  assert.equal(closed.ok, false);
  assert.equal(closed.error.code, "UNSUPPORTED_POOL_FEATURE");
  fixture.request.snapshot.accounts[fixture.pool].data[17] = 0;
  fixture.request.snapshot.accounts[fixture.baseVault].data[32] ^= 1;
  const vault = await buildSwapInstructions(fixture.request);
  assert.equal(vault.ok, false);
  assert.equal(vault.error.code, "INVALID_ACCOUNT");
});
