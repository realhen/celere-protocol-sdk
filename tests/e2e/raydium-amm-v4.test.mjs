import {
  InvalidAccountError,
  InsufficientLiquidityError,
  UnsupportedPoolFeatureError,
  MissingAccountsError,
  buildSwapInstructions,
  getSwapRequirements,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

import { raydiumAmmV4Fixture, AMM_V4_PROGRAM } from "../fixtures/raydium-amm-v4.mjs";

function writeU64(account, offset, amount) {
  new DataView(
    account.data.buffer,
    account.data.byteOffset,
    account.data.byteLength,
  ).setBigUint64(offset, amount, true);
}

test("offline AMM v4 consumer discovers snapshots, builds native modes and transfers results across worker boundaries", async () => {
  const signer = await generateKeyPairSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline construction attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      const fixture = await raydiumAmmV4Fixture(signer.address, { reverse });
      const unknown = await getSwapRequirements({
        ...fixture.request,
        snapshot: { ...fixture.request.snapshot, accounts: {} },
      });
      assert.equal(unknown.protocol, null);
      assert.equal(unknown.missing[0].address, fixture.pool);
      const partial = {
        ...fixture.request,
        snapshot: {
          ...fixture.request.snapshot,
          accounts: { [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool] },
        },
      };
      const discovered = await getSwapRequirements(partial);
      assert.equal(discovered.protocol, "raydium-amm-v4");
      assert.equal(discovered.complete, false);
      for (const account of [
        fixture.vault0,
        fixture.vault1,
        fixture.mint0,
        fixture.mint1,
      ])
        assert.ok(discovered.missing.some((item) => item.address === account));
      await assert.rejects(
        () => buildSwapInstructions(partial),
        (error) => {
          assert.ok(error instanceof MissingAccountsError);
          assert.equal(error.code, "MISSING_ACCOUNTS");
          return true;
        },
      );
      assert.equal((await getSwapRequirements(fixture.request)).complete, true);
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const build = await buildSwapInstructions({ ...fixture.request, amount });
        assert.equal(build.protocol, "raydium-amm-v4");
        assert.equal(build.execution.mayPartiallyFill, false);
        assert.equal(build.swapInstructions.length, 1);
        const instruction = build.swapInstructions[0];
        assert.equal(instruction.programAddress, AMM_V4_PROGRAM);
        assert.equal(instruction.accounts.length, 8);
        assert.equal(instruction.data[0], amount.kind === "exactIn" ? 16 : 17);
        const view = new DataView(
          instruction.data.buffer,
          instruction.data.byteOffset,
          instruction.data.byteLength,
        );
        assert.equal(
          view.getBigUint64(1, true),
          amount.kind === "exactIn" ? build.quote.amountIn : build.quote.maximumAmountIn,
        );
        assert.equal(
          view.getBigUint64(9, true),
          amount.kind === "exactIn"
            ? build.quote.minimumAmountOut
            : build.quote.amountOut,
        );
        assert.deepEqual(structuredClone(build), build);
        assert.deepEqual(build.requiredSigners, [signer.address]);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AMM v4 consumer receives typed errors for unqualified states, malformed snapshots and liquidity limits", async () => {
  const signer = await generateKeyPairSigner();
  for (const [change, code] of [
    [
      (fixture) => writeU64(fixture.request.snapshot.accounts[fixture.pool], 0, 1n),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (fixture) => writeU64(fixture.request.snapshot.accounts[fixture.pool], 0, 5n),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (fixture) => writeU64(fixture.request.snapshot.accounts[fixture.pool], 0, 2n),
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) => {
        writeU64(fixture.request.snapshot.accounts[fixture.pool], 0, 7n);
        writeU64(
          fixture.request.snapshot.accounts[fixture.pool],
          224,
          fixture.request.snapshot.unixTimestamp + 1n,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) => writeU64(fixture.request.snapshot.accounts[fixture.pool], 184, 0n),
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) =>
        writeU64(fixture.request.snapshot.accounts[fixture.pool], 192, 1_000_900_001n),
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) => writeU64(fixture.request.snapshot.accounts[fixture.pool], 8, 0n),
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) => {
        fixture.request.amount = { kind: "exactOut", amountOut: 2_000_000_000n };
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
    [
      (fixture) => {
        fixture.request.amount = { kind: "exactIn", amountIn: 1n };
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
    [
      (fixture) => {
        fixture.request.snapshot.accounts[fixture.pool].data = new Uint8Array(753);
      },
      "INVALID_ACCOUNT",
    ],
    [
      (fixture) => {
        fixture.request.snapshot.accounts[fixture.vault0].owner = AMM_V4_PROGRAM;
      },
      "INVALID_ACCOUNT",
    ],
  ]) {
    const fixture = await raydiumAmmV4Fixture(signer.address);
    change(fixture);
    await assert.rejects(
      () => buildSwapInstructions(fixture.request),
      (error) => {
        assert.equal(error.code, code, error.message);
        const expectedClass = {
          INVALID_ACCOUNT: InvalidAccountError,
          INSUFFICIENT_LIQUIDITY: InsufficientLiquidityError,
          UNSUPPORTED_POOL_FEATURE: UnsupportedPoolFeatureError,
        }[code];
        assert.ok(error instanceof expectedClass);
        if (error instanceof InvalidAccountError) {
          assert.ok(error.address in fixture.request.snapshot.accounts);
        } else {
          assert.equal(error.protocol, "raydium-amm-v4");
        }
        if (error instanceof UnsupportedPoolFeatureError) {
          assert.equal(typeof error.feature, "string");
          assert.ok(error.feature.length > 0);
        }
        const serialized = { ...error, message: error.message };
        assert.deepEqual(structuredClone(serialized), serialized);
        return true;
      },
    );
  }
});
