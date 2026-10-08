import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { liquidAfFixture, LIQUID_AF_PROGRAM } from "../fixtures/liquid-af.mjs";
const owner = address("11111111111111111111111111111112");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
test("consumer builds LiquidAF native-SOL buys and both sell modes from caller snapshots", async () => {
  for (const [reverse, exactOut] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    const f = await liquidAfFixture(owner, { reverse });
    const request = {
      ...f.request,
      amount: exactOut ? { kind: "exactOut", amountOut: 1_000_001n } : f.request.amount,
    };
    assert.equal(value(await getSwapRequirements(request)).complete, true);
    const build = value(await buildSwapInstructions(request));
    assert.equal(build.protocol, "liquid-af");
    assert.equal(build.swapInstructions[0].programAddress, LIQUID_AF_PROGRAM);
    assert.equal(build.swapInstructions[0].accounts.length, 29);
    assert.equal(build.swapInstructions[0].data.length, 24);
    assert.equal(build.quote.expectedAmountIn, exactOut ? 1_512_099n : 1_000_001n);
    assert.equal(
      build.quote.expectedAmountOut,
      exactOut ? 1_000_001n : reverse ? 661_446n : 1_488_011n,
    );
    assert.equal(build.execution.mayPartiallyFill, !reverse);
    assert.deepEqual(
      build.assets,
      reverse
        ? { input: "spl", output: "nativeSol" }
        : { input: "nativeSol", output: "spl" },
    );
  }
});
test("LiquidAF buys explicitly reject full-fill policy and high-level exact-output requests", async () => {
  const f = await liquidAfFixture(owner);
  const full = await buildSwapInstructions({
    ...f.request,
    fillPolicy: "requireFull",
  });
  assert.equal(full.ok, false);
  assert.equal(full.error.code, "UNSUPPORTED_FILL_POLICY");
  const output = await buildSwapInstructions({
    ...f.request,
    amount: { kind: "exactOut", amountOut: 100n },
  });
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "UNSUPPORTED_SWAP_MODE");
  new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigUint64(
    73,
    500_000n,
    true,
  );
  new DataView(f.request.snapshot.accounts[f.tokenVault].data.buffer).setBigUint64(
    64,
    500_000n,
    true,
  );
  const clipped = value(await buildSwapInstructions(f.request));
  assert.equal(clipped.quote.amountIn, 1_000_001n);
  assert.equal(clipped.quote.expectedAmountIn, 335_909n);
  assert.equal(clipped.quote.expectedAmountOut, 500_000n);
});
test("LiquidAF discovers caller-owned dependencies without account fetching", async () => {
  const f = await liquidAfFixture(owner);
  const request = {
    ...f.request,
    snapshot: {
      ...f.request.snapshot,
      accounts: { [f.pool]: f.request.snapshot.accounts[f.pool] },
    },
  };
  const discovery = value(await getSwapRequirements(request));
  assert.equal(discovery.complete, false);
  assert.ok(discovery.missing.some((account) => account.address === f.globalConfig));
});
test("LiquidAF rejects unsupported fee states, referrals, cashback spending and stale Pyth data", async () => {
  for (const variant of [
    "referrer",
    "cashback-spending",
    "revoked",
    "stable",
    "completed",
    "bad-fee-config",
    "stale-oracle",
    "partial-oracle",
    "bad-vault",
    "zero-output",
  ]) {
    const f = await liquidAfFixture(owner, { reverse: true });
    let expected = "UNSUPPORTED_POOL_FEATURE";
    if (variant === "referrer") f.request.snapshot.accounts[f.userProperties].data[8] = 1;
    if (variant === "cashback-spending")
      f.request.snapshot.accounts[f.userProperties].data[49] = 1;
    if (variant === "revoked") f.request.snapshot.accounts[f.feeConfig].data[104] = 1;
    if (variant === "stable") f.request.snapshot.accounts[f.pool].data[72] = 1;
    if (variant === "completed") f.request.snapshot.accounts[f.pool].data[113] = 1;
    if (variant === "bad-fee-config") {
      f.request.snapshot.accounts[f.feeConfig].data[40] ^= 1;
      expected = "INVALID_ACCOUNT";
    }
    if (variant === "stale-oracle") {
      f.request.snapshot.unixTimestamp += 31n;
      expected = "INVALID_ACCOUNT";
    }
    if (variant === "partial-oracle") {
      f.request.snapshot.accounts[f.instructionAccounts.pythPriceFeed].data[40] = 0;
      expected = "INVALID_ACCOUNT";
    }
    if (variant === "bad-vault") {
      f.request.snapshot.accounts[f.solVault].lamports = 1n;
      expected = "INVALID_ACCOUNT";
    }
    if (variant === "zero-output") {
      f.request.amount = { kind: "exactIn", amountIn: 1n };
      expected = "INSUFFICIENT_LIQUIDITY";
    }
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false, variant);
    assert.equal(result.error.code, expected, variant);
  }
});
