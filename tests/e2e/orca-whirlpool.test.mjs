import {
  InsufficientLiquidityError,
  InvalidAccountError,
  MissingAccountsError,
  UnsupportedFillPolicyError,
  UnsupportedPoolFeatureError,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";

import { orcaWhirlpoolFixture } from "../fixtures/orca-whirlpool.mjs";

const owner = address("11111111111111111111111111111111");

test("Orca consumer discovers raw account state and builds both native amount modes offline", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("SDK attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      const { request } = await orcaWhirlpoolFixture(owner, { reverse });
      const empty = await getSwapRequirements({
        ...request,
        snapshot: { ...request.snapshot, accounts: {} },
      });
      assert.deepEqual(
        empty.missing.map((item) => item.address),
        [request.pool],
      );
      const staged = await getSwapRequirements({
        ...request,
        snapshot: {
          ...request.snapshot,
          accounts: { [request.pool]: request.snapshot.accounts[request.pool] },
        },
      });
      assert.ok(staged.missing.length >= 10);
      assert.equal((await getSwapRequirements(request)).complete, true);
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const build = await buildSwapInstructions({ ...request, amount });
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
          compileTransaction({
            instructions: build.instructions,
            feePayer: owner,
            lifetime: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 10n,
            },
          }).wireBytes.length < 1232,
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
  await assert.rejects(
    () => buildSwapInstructions({ ...request, fillPolicy: "requireFull" }),
    (error) => {
      assert.ok(error instanceof UnsupportedFillPolicyError);
      assert.equal(error.code, "UNSUPPORTED_FILL_POLICY");
      return true;
    },
  );
  assert.equal(
    (
      await buildSwapInstructions({
        ...request,
        amount: { kind: "exactOut", amountOut: 1000n },
        fillPolicy: "requireFull",
      })
    ).quote.kind,
    "exactOut",
  );
  const corrupted = structuredClone(request);
  const corruptData = corrupted.snapshot.accounts[fixture.tickArrays[0]].data;
  corruptData[corruptData.length - 1] ^= 1;
  await assert.rejects(
    () => buildSwapInstructions(corrupted),
    (error) => {
      assert.ok(error instanceof InvalidAccountError);
      assert.equal(error.code, "INVALID_ACCOUNT");
      return true;
    },
  );
  const missing = structuredClone(request);
  delete missing.snapshot.accounts[fixture.tickArrays[0]];
  await assert.rejects(
    () => buildSwapInstructions(missing),
    (error) => {
      assert.ok(error instanceof MissingAccountsError);
      assert.equal(error.code, "MISSING_ACCOUNTS");
      assert.ok(error.accounts.some((entry) => entry.address === fixture.tickArrays[0]));
      return true;
    },
  );
});

test("Orca rejects adaptive fee pools and dynamic tick arrays with explicit feature errors", async () => {
  const adaptive = await orcaWhirlpoolFixture(owner, { adaptive: true });
  await assert.rejects(
    () => buildSwapInstructions(adaptive.request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      assert.equal(error.feature, "adaptiveFees");
      return true;
    },
  );
  const dynamic = await orcaWhirlpoolFixture(owner);
  dynamic.request.snapshot.accounts[dynamic.tickArrays[0]].data.set([
    17, 216, 246, 142, 225, 199, 218, 56,
  ]);
  await assert.rejects(
    () => buildSwapInstructions(dynamic.request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      assert.equal(error.feature, "dynamicTickArrays");
      return true;
    },
  );
});

test("Orca throws typed errors for invalid numeric snapshots and empty liquidity", async () => {
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
      await assert.rejects(
        () => operation(request),
        (error) => {
          assert.ok(error instanceof InvalidAccountError);
          assert.equal(error.code, "INVALID_ACCOUNT");
          assert.equal(error.address, fixture.pool);
          return true;
        },
      );
    }
  }
  const invalidFee = structuredClone(fixture.request);
  const feeData = invalidFee.snapshot.accounts[fixture.pool].data;
  new DataView(feeData.buffer, feeData.byteOffset, feeData.byteLength).setUint16(
    47,
    10001,
    true,
  );
  await assert.rejects(
    () => buildSwapInstructions(invalidFee),
    (error) => {
      assert.ok(error instanceof InvalidAccountError);
      assert.equal(error.code, "INVALID_ACCOUNT");
      return true;
    },
  );
  const empty = structuredClone(fixture.request);
  empty.snapshot.accounts[fixture.pool].data.fill(0, 49, 65);
  for (const tickArray of fixture.tickArrays) {
    empty.snapshot.accounts[tickArray]?.data.fill(0, 12, 9956);
  }
  for (const amount of [
    { kind: "exactIn", amountIn: 1000n },
    { kind: "exactOut", amountOut: 1000n },
  ]) {
    await assert.rejects(
      () => buildSwapInstructions({ ...empty, amount }),
      (error) => {
        assert.ok(error instanceof InsufficientLiquidityError);
        assert.equal(error.code, "INSUFFICIENT_LIQUIDITY");
        return true;
      },
    );
  }
});
