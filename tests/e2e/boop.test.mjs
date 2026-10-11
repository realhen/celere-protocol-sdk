import {
  MissingAccountsError,
  UnsupportedFillPolicyError,
  UnsupportedSwapModeError,
  createProtocolSdk,
  compileTransaction,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

import { boopAdapter } from "../../dist/protocols/boop/adapter.js";
import { boopFixture } from "../fixtures/boop.mjs";
const sdk = createProtocolSdk([boopAdapter]);

test("offline Boop consumer discovers native SOL accounts and compiles portable buy/sell plans", async () => {
  const signer = await generateKeyPairSigner(),
    previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline build attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      const f = await boopFixture(signer.address, { reverse });
      const partial = {
        ...f.request,
        snapshot: {
          ...f.request.snapshot,
          accounts: { [f.pool]: f.request.snapshot.accounts[f.pool] },
        },
      };
      const needed = await sdk.getSwapRequirements(partial);
      assert.ok(needed.missing.some((item) => item.address === f.feesVault));
      await assert.rejects(
        () => sdk.buildSwapInstructions(partial),
        MissingAccountsError,
      );
      const built = await sdk.buildSwapInstructions(f.request);
      assert.equal(built.execution.mayPartiallyFill, !reverse);
      assert.deepEqual(structuredClone(built), built);
      assert.equal(built.instructions[0].data.length, 24);
      assert.equal(built.instructions[0].accounts.length, reverse ? 12 : 13);
      const compiled = compileTransaction({
        instructions: built.instructions,
        feePayer: signer.address,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 100n,
        },
      });
      assert.ok(compiled.byteLength <= 1232);
      assert.ok(
        Object.values(compiled.transaction.signatures).every(
          (signature) => signature === null,
        ),
      );
      if (!reverse) {
        await assert.rejects(
          () =>
            sdk.buildSwapInstructions({
              ...f.request,
              fillPolicy: "requireFull",
            }),
          (error) => {
            assert.ok(error instanceof UnsupportedFillPolicyError);
            assert.equal(error.code, "UNSUPPORTED_FILL_POLICY");
            return true;
          },
        );
      }
      await assert.rejects(
        () =>
          sdk.buildSwapInstructions({
            ...f.request,
            amount: { kind: "exactOut", amountOut: 1000n },
          }),
        (error) => {
          assert.ok(error instanceof UnsupportedSwapModeError);
          assert.equal(error.code, "UNSUPPORTED_SWAP_MODE");
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
test("Boop rejects paused, legacy, malformed, unbacked and exhausted caller snapshots", async () => {
  const signer = await generateKeyPairSigner();
  for (const [mutate, code] of [
    [
      (f) => (f.request.snapshot.accounts[f.pool].data[120] = 30),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [(f) => (f.request.snapshot.accounts[f.pool].data[124] = 1), "INVALID_ACCOUNT"],
    [(f) => (f.request.snapshot.accounts[f.config].data[8] = 1), "INVALID_ACCOUNT"],
    [(f) => (f.request.snapshot.accounts[f.solVault].lamports = 1n), "INVALID_ACCOUNT"],
    [(f) => (f.request.snapshot.accounts[f.feesVault].lamports += 1n), "INVALID_ACCOUNT"],
    [
      (f) => (f.request.snapshot.accounts[f.mint].data[44] = 6),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [(f) => (f.request.snapshot.accounts[f.pool].data[0] = 0), "INVALID_ACCOUNT"],
    [
      (f) => (f.request.amount.amountIn = 300_000_000_000_000_003n),
      "INSUFFICIENT_LIQUIDITY",
    ],
  ]) {
    const f = await boopFixture(signer.address, { reverse: true });
    mutate(f);
    await assert.rejects(
      () => sdk.buildSwapInstructions(f.request),
      (error) => {
        assert.equal(error.code, code, error.message);
        return true;
      },
    );
  }
});
