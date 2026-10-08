import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import {
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
} from "../../dist/index.js";
import { orcaWhirlpoolFixture } from "../fixtures/orca-whirlpool.mjs";

const owner = address("11111111111111111111111111111111");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
  return result.value;
}

test("Orca consumer discovers raw account state and builds both native amount modes offline", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("SDK attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      const { request } = await orcaWhirlpoolFixture(owner, { reverse });
      const empty = value(
        await getSwapRequirements({
          ...request,
          snapshot: { ...request.snapshot, accounts: {} },
        }),
      );
      assert.deepEqual(
        empty.missing.map((item) => item.address),
        [request.pool],
      );
      const staged = value(
        await getSwapRequirements({
          ...request,
          snapshot: {
            ...request.snapshot,
            accounts: { [request.pool]: request.snapshot.accounts[request.pool] },
          },
        }),
      );
      assert.ok(staged.missing.length >= 10);
      assert.equal(value(await getSwapRequirements(request)).complete, true);
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const build = value(await buildSwapInstructions({ ...request, amount }));
        assert.equal(build.protocol, "orca-whirlpool");
        assert.equal(build.swapInstructions.length, 1);
        assert.ok(build.quote.expectedAmountIn > 0n);
        assert.ok(build.quote.expectedAmountOut > 0n);
        assert.deepEqual(build.requiredSigners, [owner]);
        const bytes = build.swapInstructions[0].data;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const instruction = {
          amount: view.getBigUint64(8, true),
          otherAmountThreshold: view.getBigUint64(16, true),
          sqrtPriceLimit:
            view.getBigUint64(24, true) | (view.getBigUint64(32, true) << 64n),
          amountSpecifiedIsInput: bytes[40] === 1,
          aToB: bytes[41] === 1,
        };
        assert.equal(instruction.amountSpecifiedIsInput, amount.kind === "exactIn");
        assert.equal(instruction.aToB, !reverse);
        assert.equal(instruction.sqrtPriceLimit, 0n);
        if (amount.kind === "exactOut") {
          assert.equal(instruction.amount, amount.amountOut);
          assert.equal(instruction.otherAmountThreshold, build.quote.maximumAmountIn);
          assert.equal(build.quote.expectedAmountOut, amount.amountOut);
          assert.equal(build.execution.mayPartiallyFill, false);
        } else {
          assert.equal(instruction.amount, amount.amountIn);
          assert.equal(instruction.otherAmountThreshold, build.quote.minimumAmountOut);
          assert.equal(build.execution.mayPartiallyFill, true);
        }
        assert.deepEqual(structuredClone(build), build);
        assert.ok(
          value(
            compileTransaction({
              instructions: build.instructions,
              feePayer: owner,
              lifetime: {
                blockhash: "11111111111111111111111111111111",
                lastValidBlockHeight: 10n,
              },
            }),
          ).wireBytes.length < 1232,
        );
      }
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("Orca rejects unenforceable full-input fills and invalid account observations through the public error boundary", async () => {
  const fixture = await orcaWhirlpoolFixture(owner);
  const request = fixture.request;
  const exactIn = await buildSwapInstructions({ ...request, fillPolicy: "requireFull" });
  assert.equal(exactIn.ok, false);
  assert.equal(exactIn.error.code, "UNSUPPORTED_FILL_POLICY");
  assert.equal(
    value(
      await buildSwapInstructions({
        ...request,
        amount: { kind: "exactOut", amountOut: 1000n },
        fillPolicy: "requireFull",
      }),
    ).quote.kind,
    "exactOut",
  );
  const corrupted = structuredClone(request);
  const corruptData = corrupted.snapshot.accounts[fixture.tickArrays[0]].data;
  corruptData[corruptData.length - 1] ^= 1;
  const badArray = await buildSwapInstructions(corrupted);
  assert.equal(badArray.ok, false);
  assert.equal(badArray.error.code, "INVALID_ACCOUNT");
  const missing = structuredClone(request);
  delete missing.snapshot.accounts[fixture.tickArrays[0]];
  const missingResult = await buildSwapInstructions(missing);
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.error.code, "MISSING_ACCOUNTS");
  assert.ok(
    missingResult.error.accounts.some((entry) => entry.address === fixture.tickArrays[0]),
  );
});

test("Orca rejects adaptive fee pools and dynamic tick arrays with explicit feature errors", async () => {
  const adaptive = await orcaWhirlpoolFixture(owner, { adaptive: true });
  const result = await buildSwapInstructions(adaptive.request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNSUPPORTED_POOL_FEATURE");
  assert.equal(result.error.feature, "adaptiveFees");
  const dynamic = await orcaWhirlpoolFixture(owner);
  dynamic.request.snapshot.accounts[dynamic.tickArrays[0]].data.set([
    17, 216, 246, 142, 225, 199, 218, 56,
  ]);
  const dynamicResult = await buildSwapInstructions(dynamic.request);
  assert.equal(dynamicResult.ok, false);
  assert.equal(dynamicResult.error.code, "UNSUPPORTED_POOL_FEATURE");
  assert.equal(dynamicResult.error.feature, "dynamicTickArrays");
});

test("Orca returns structured errors for invalid numeric snapshots and empty liquidity", async () => {
  const fixture = await orcaWhirlpoolFixture(owner);
  for (const price of [
    0n,
    4295048015n,
    79226673515401279992447579056n,
    (1n << 128n) - 1n,
  ]) {
    const request = structuredClone(fixture.request);
    const data = request.snapshot.accounts[fixture.pool].data;
    const writer = new DataView(data.buffer, data.byteOffset, data.byteLength);
    writer.setBigUint64(65, price & ((1n << 64n) - 1n), true);
    writer.setBigUint64(73, price >> 64n, true);
    for (const operation of [getSwapRequirements, buildSwapInstructions]) {
      const result = await operation(request);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "INVALID_ACCOUNT");
      assert.equal(result.error.address, fixture.pool);
    }
  }
  const invalidFee = structuredClone(fixture.request);
  const feeData = invalidFee.snapshot.accounts[fixture.pool].data;
  new DataView(feeData.buffer, feeData.byteOffset, feeData.byteLength).setUint16(
    47,
    10001,
    true,
  );
  const feeResult = await buildSwapInstructions(invalidFee);
  assert.equal(feeResult.ok, false);
  assert.equal(feeResult.error.code, "INVALID_ACCOUNT");
  const empty = structuredClone(fixture.request);
  empty.snapshot.accounts[fixture.pool].data.fill(0, 49, 65);
  for (const tickArray of fixture.tickArrays) {
    empty.snapshot.accounts[tickArray]?.data.fill(0, 12, 9956);
  }
  for (const amount of [
    { kind: "exactIn", amountIn: 1000n },
    { kind: "exactOut", amountOut: 1000n },
  ]) {
    const result = await buildSwapInstructions({ ...empty, amount });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INSUFFICIENT_LIQUIDITY");
  }
});
