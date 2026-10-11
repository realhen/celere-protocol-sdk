import {
  InsufficientLiquidityError,
  InvalidAccountError,
  UnsupportedPoolFeatureError,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { createProtocolSdk } from "../../dist/protocols/index.js";
import { meteoraDammV2Adapter } from "../../dist/protocols/meteora/damm-v2.js";
import {
  meteoraDammV2Fixture,
  DAMM_V2_PROGRAM,
  putU128,
} from "../fixtures/meteora-damm-v2.mjs";

const sdk = createProtocolSdk([meteoraDammV2Adapter]);

test("offline Meteora consumer discovers snapshots and builds native full-fill swap modes", async () => {
  const signer = await generateKeyPairSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline construction attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      for (const collectFeeMode of [0, 1]) {
        const fixture = await meteoraDammV2Fixture(signer.address, {
          reverse,
          collectFeeMode,
        });
        const discovered = await sdk.getSwapRequirements({
          ...fixture.request,
          snapshot: {
            ...fixture.request.snapshot,
            accounts: {
              [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool],
            },
          },
        });
        assert.equal(discovered.complete, false);
        assert.equal(discovered.protocol, "meteora-damm-v2");
        assert.ok(
          discovered.missing.some((account) => account.address === fixture.vaultA),
        );
        assert.ok(
          discovered.missing.some((account) => account.address === fixture.mintB),
        );
        for (const amount of [
          { kind: "exactIn", amountIn: 1_000_001n },
          { kind: "exactOut", amountOut: 1_000_001n },
        ]) {
          const built = await sdk.buildSwapInstructions({ ...fixture.request, amount });
          assert.equal(built.execution.mayPartiallyFill, false);
          assert.equal(built.quote.kind, amount.kind);
          assert.ok(built.quote.expectedAmountIn > 0n);
          assert.ok(built.quote.expectedAmountOut > 0n);
          assert.equal(
            built.quote.fees[0].mint,
            collectFeeMode === 1 ? fixture.mintB : fixture.request.outputMint,
          );
          const instruction = built.swapInstructions[0];
          assert.equal(instruction.programAddress, DAMM_V2_PROGRAM);
          assert.equal(instruction.accounts.length, 14);
          const data = new DataView(instruction.data.buffer, instruction.data.byteOffset);
          assert.equal(
            data.getBigUint64(8, true),
            amount.kind === "exactIn" ? amount.amountIn : amount.amountOut,
          );
          assert.equal(
            data.getBigUint64(16, true),
            amount.kind === "exactIn"
              ? built.quote.minimumAmountOut
              : built.quote.maximumAmountIn,
          );
          assert.equal(instruction.data[24], amount.kind === "exactIn" ? 0 : 2);
          assert.deepEqual(structuredClone(built), built);
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meteora consumer receives typed errors for unsupported fees, malformed state and exhausted ranges", async () => {
  const signer = await generateKeyPairSigner();
  for (const [offset, setting] of [
    [56, 1],
    [16, 2],
    [16, 3],
    [484, 2],
  ]) {
    const fixture = await meteoraDammV2Fixture(signer.address);
    fixture.request.snapshot.accounts[fixture.pool].data[offset] = setting;
    await assert.rejects(
      () => sdk.buildSwapInstructions(fixture.request),
      (error) => {
        assert.ok(error instanceof UnsupportedPoolFeatureError);
        assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
        return true;
      },
    );
  }
  for (const offset of [480, 482, 486, 696]) {
    const fixture = await meteoraDammV2Fixture(signer.address);
    fixture.request.snapshot.accounts[fixture.pool].data[offset] = 255;
    await assert.rejects(
      () => sdk.buildSwapInstructions(fixture.request),
      (error) => {
        assert.ok(error instanceof InvalidAccountError);
        assert.equal(error.code, "INVALID_ACCOUNT");
        return true;
      },
    );
  }
  const fixture = await meteoraDammV2Fixture(signer.address);
  for (const amount of [
    { kind: "exactIn", amountIn: 3_000_000_000n },
    { kind: "exactOut", amountOut: 1_000_000_000n },
  ]) {
    await assert.rejects(
      () => sdk.buildSwapInstructions({ ...fixture.request, amount }),
      (error) => {
        assert.ok(error instanceof InsufficientLiquidityError);
        assert.equal(error.code, "INSUFFICIENT_LIQUIDITY");
        return true;
      },
    );
  }
  putU128(fixture.request.snapshot.accounts[fixture.pool].data, 456, 0n);
  await assert.rejects(
    () => sdk.buildSwapInstructions(fixture.request),
    (error) => {
      assert.ok(error instanceof InvalidAccountError);
      assert.equal(error.code, "INVALID_ACCOUNT");
      return true;
    },
  );
});

test("Meteora consumer quotes linear fees at the caller's chain point and rejects exponential schedules", async () => {
  const signer = await generateKeyPairSigner();
  const fixture = await meteoraDammV2Fixture(signer.address, { linearFee: true });
  const data = fixture.request.snapshot.accounts[fixture.pool].data;
  new DataView(data.buffer).setBigUint64(24, 20n, true);
  const active = await sdk.buildSwapInstructions(fixture.request);
  const matured = await sdk.buildSwapInstructions({
    ...fixture.request,
    snapshot: { ...fixture.request.snapshot, slot: 200n },
  });
  assert.ok(active.quote.fees[0].amount > matured.quote.fees[0].amount);
  assert.ok(active.quote.expectedAmountOut < matured.quote.expectedAmountOut);
  data[16] = 1;
  await assert.rejects(
    () => sdk.buildSwapInstructions(fixture.request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      assert.equal(error.feature, "exponential fee scheduler");
      return true;
    },
  );
});
