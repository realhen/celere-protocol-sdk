import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { liquidAfAmmFixture, LIQUID_AF_AMM_PROGRAM } from "../fixtures/liquid-af-amm.mjs";
const owner = address("11111111111111111111111111111112");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
test("consumer builds three qualified LiquidAF AMM native swaps for USDC and wrapped SOL", async () => {
  for (const nativeQuote of [false, true])
    for (const reverse of [false, true])
      for (const exactOut of reverse ? [false, true] : [false]) {
        const f = await liquidAfAmmFixture(owner, { nativeQuote, reverse });
        const request = {
          ...f.request,
          amount: exactOut
            ? { kind: "exactOut", amountOut: 1_000_001n }
            : f.request.amount,
        };
        assert.equal(value(await getSwapRequirements(request)).complete, true);
        const build = value(await buildSwapInstructions(request));
        assert.equal(build.protocol, "liquid-af-amm");
        assert.equal(build.swapInstructions[0].programAddress, LIQUID_AF_AMM_PROGRAM);
        assert.equal(build.swapInstructions[0].accounts.length, 34);
        assert.equal(build.swapInstructions[0].data.length, 24);
        assert.equal(
          build.quote.expectedAmountIn,
          exactOut ? (reverse ? 2_017_149n : 504_032n) : 1_000_001n,
        );
        assert.equal(
          build.quote.expectedAmountOut,
          exactOut ? 1_000_001n : reverse ? 494_752n : 1_983_031n,
        );
        assert.equal(
          build.quote.fees.find((fee) => fee.kind === "creator").amount,
          exactOut ? (reverse ? 2519n : 1260n) : reverse ? 1249n : 2500n,
        );
        assert.equal(
          build.quote.fees.find((fee) => fee.kind === "trade").amount,
          exactOut ? (reverse ? 5038n : 2521n) : reverse ? 3749n : 5001n,
        );
        assert.equal(build.execution.mayPartiallyFill, false);
        assert.deepEqual(build.assets, { input: "spl", output: "spl" });
      }
});
test("LiquidAF AMM exposes missing state dependencies without fetching", async () => {
  const f = await liquidAfAmmFixture(owner);
  const discovery = value(
    await getSwapRequirements({
      ...f.request,
      snapshot: {
        ...f.request.snapshot,
        accounts: { [f.pool]: f.request.snapshot.accounts[f.pool] },
      },
    }),
  );
  assert.equal(discovery.complete, false);
  assert.ok(discovery.missing.some((account) => account.address === f.globalConfig));
});
test("LiquidAF AMM rejects unqualified state, malformed fees, transfer extensions and exhausted output", async () => {
  for (const variant of [
    "authority-bump",
    "fee-tier",
    "fee-config",
    "referral",
    "spending",
    "revoked",
    "observation",
    "stale-price",
    "transfer-fee",
    "empty-reserve",
    "exhausted-exactOut",
    "buy-exactOut",
  ]) {
    const f = await liquidAfAmmFixture(owner, {
      nativeQuote: true,
      reverse: variant === "exhausted-exactOut",
    });
    let expected = "INVALID_ACCOUNT";
    if (variant === "authority-bump") f.request.snapshot.accounts[f.pool].data[315] ^= 1;
    if (variant === "fee-tier")
      new DataView(f.request.snapshot.accounts[f.globalConfig].data.buffer).setUint16(
        352,
        10_000,
        true,
      );
    if (variant === "fee-config") f.request.snapshot.accounts[f.feeConfig].data[40] ^= 1;
    if (variant === "referral") {
      f.request.snapshot.accounts[f.userProperties].data[8] = 1;
      expected = "UNSUPPORTED_POOL_FEATURE";
    }
    if (variant === "spending") {
      f.request.snapshot.accounts[f.userProperties].data[49] = 1;
      expected = "UNSUPPORTED_POOL_FEATURE";
    }
    if (variant === "revoked") {
      f.request.snapshot.accounts[f.feeConfig].data[104] = 1;
      expected = "UNSUPPORTED_POOL_FEATURE";
    }
    if (variant === "observation")
      f.request.snapshot.accounts[f.observationState].data[11] ^= 1;
    if (variant === "stale-price") f.request.snapshot.unixTimestamp += 31n;
    if (variant === "transfer-fee") {
      const mint = f.request.snapshot.accounts[f.baseMint];
      const bytes = new Uint8Array(278);
      bytes.set(mint.data);
      bytes[165] = 1;
      new DataView(bytes.buffer).setUint16(166, 1, true);
      new DataView(bytes.buffer).setUint16(168, 108, true);
      mint.data = bytes;
      expected = "UNSUPPORTED_TOKEN_EXTENSION";
    }
    if (variant === "empty-reserve") {
      new DataView(f.request.snapshot.accounts[f.baseVault].data.buffer).setBigUint64(
        64,
        0n,
        true,
      );
      expected = "INSUFFICIENT_LIQUIDITY";
    }
    if (variant === "exhausted-exactOut") {
      f.request.amount = { kind: "exactOut", amountOut: 2_000_000_000n };
      expected = "INSUFFICIENT_LIQUIDITY";
    }
    if (variant === "buy-exactOut") {
      f.request.amount = { kind: "exactOut", amountOut: 123_456_789n };
      expected = "UNSUPPORTED_SWAP_MODE";
    }
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false, variant);
    assert.equal(result.error.code, expected, variant);
  }
});
