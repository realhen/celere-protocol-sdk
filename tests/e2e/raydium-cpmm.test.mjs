import {
  InsufficientLiquidityError,
  InvalidAccountError,
  buildSwapInstructions,
  getSwapRequirements,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

import { raydiumCpmmFixture, CPMM_PROGRAM } from "../fixtures/raydium-cpmm.mjs";

test("offline consumer discovers CPMM accounts and builds both native swap modes in both directions", async () => {
  const signer = await generateKeyPairSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline construction attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      for (const { creatorFeeOn, creatorFeeEnabled } of [
        { creatorFeeOn: 0, creatorFeeEnabled: false },
        { creatorFeeOn: 0, creatorFeeEnabled: true },
        { creatorFeeOn: 1, creatorFeeEnabled: true },
        { creatorFeeOn: 2, creatorFeeEnabled: true },
      ]) {
        const fixture = await raydiumCpmmFixture(signer.address, {
          reverse,
          creatorFeeOn,
          creatorFeeEnabled,
        });
        const incomplete = {
          ...fixture.request,
          snapshot: {
            ...fixture.request.snapshot,
            accounts: { [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool] },
          },
        };
        const discovered = await getSwapRequirements(incomplete);
        assert.equal(discovered.protocol, "raydium-cpmm");
        assert.equal(discovered.complete, false);
        assert.ok(
          discovered.missing.some((account) => account.address === fixture.config),
        );
        assert.ok(
          discovered.missing.some((account) => account.address === fixture.observation),
        );
        for (const amount of [
          { kind: "exactIn", amountIn: 1_000_001n },
          { kind: "exactOut", amountOut: 1_000_001n },
        ]) {
          const built = await buildSwapInstructions({ ...fixture.request, amount });
          assert.equal(built.protocol, "raydium-cpmm");
          assert.equal(built.execution.mayPartiallyFill, false);
          assert.equal(built.swapInstructions.length, 1);
          assert.equal(built.swapInstructions[0].programAddress, CPMM_PROGRAM);
          assert.equal(built.swapInstructions[0].accounts.length, 13);
          assert.equal(built.quote.kind, amount.kind);
          assert.ok(built.quote.expectedAmountIn > 0n);
          assert.ok(built.quote.expectedAmountOut > 0n);
          const data = new DataView(
            built.swapInstructions[0].data.buffer,
            built.swapInstructions[0].data.byteOffset,
          );
          if (amount.kind === "exactIn") {
            assert.deepEqual(
              [...built.swapInstructions[0].data.subarray(0, 8)],
              [143, 190, 90, 218, 196, 30, 51, 222],
            );
            assert.equal(data.getBigUint64(8, true), built.quote.amountIn);
            assert.equal(data.getBigUint64(16, true), built.quote.minimumAmountOut);
          } else {
            assert.deepEqual(
              [...built.swapInstructions[0].data.subarray(0, 8)],
              [55, 217, 98, 86, 163, 74, 180, 173],
            );
            assert.equal(data.getBigUint64(8, true), built.quote.maximumAmountIn);
            assert.equal(data.getBigUint64(16, true), built.quote.amountOut);
          }
          assert.deepEqual(structuredClone(built), built);
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consumer receives typed failures for closed CPMM markets and impossible output", async () => {
  const signer = await generateKeyPairSigner();
  const fixture = await raydiumCpmmFixture(signer.address);
  await assert.rejects(
    () =>
      buildSwapInstructions({
        ...fixture.request,
        amount: { kind: "exactOut", amountOut: 2_000_000_000n },
      }),
    (error) => {
      assert.ok(error instanceof InsufficientLiquidityError);
      assert.equal(error.code, "INSUFFICIENT_LIQUIDITY");
      return true;
    },
  );
  fixture.request.snapshot.accounts[fixture.pool].data[329] = 4;
  await assert.rejects(
    () => buildSwapInstructions(fixture.request),
    (error) => {
      assert.ok(error instanceof InvalidAccountError);
      assert.equal(error.code, "INVALID_ACCOUNT");
      return true;
    },
  );
});
