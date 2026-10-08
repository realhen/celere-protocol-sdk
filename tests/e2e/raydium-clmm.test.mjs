import assert from "node:assert/strict";
import { address, getAddressEncoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import test from "node:test";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { raydiumClmmFixture } from "../fixtures/raydium-clmm.mjs";

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
function error(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}

test("public CLMM consumer discovers dependencies in rounds and builds native full-fill modes", async () => {
  for (const reverse of [false, true])
    for (const kind of ["exactIn", "exactOut"]) {
      const fixture = await raydiumClmmFixture(owner, {
        reverse,
        label: `offline:${reverse}:${kind}`,
      });
      const original = fixture.request.snapshot.accounts;
      const supplied = {};
      const request = {
        ...fixture.request,
        amount:
          kind === "exactIn"
            ? { kind, amountIn: 50_000_001n }
            : { kind, amountOut: 50_000_001n },
        snapshot: { ...fixture.request.snapshot, accounts: supplied },
      };
      let rounds = 0;
      while (true) {
        const requirements = value(await getSwapRequirements(request));
        if (requirements.complete) break;
        assert.ok(requirements.missing.length > 0);
        for (const item of requirements.missing) {
          assert.ok(original[item.address], item.role);
          supplied[item.address] = original[item.address];
        }
        assert.ok(++rounds < 10);
      }
      assert.ok(
        rounds >= 4,
        "Pool, dependencies, and successive tick arrays are discovered in stages",
      );
      const build = value(await buildSwapInstructions(request));
      assert.equal(build.protocol, "raydium-clmm");
      assert.equal(build.execution.mayPartiallyFill, false);
      assert.equal(
        build.quote.expectedAmountOut,
        kind === "exactIn" ? 49_731_369n : 50_000_001n,
      );
      assert.equal(
        build.quote.expectedAmountIn,
        kind === "exactIn" ? 50_000_001n : 50_271_194n,
      );
      assert.equal(build.quote.fees[0].amount, kind === "exactIn" ? 125_001n : 125_679n);
      const instruction = build.swapInstructions[0];
      assert.equal(instruction.data.length, 41);
      const bytes = new DataView(
        instruction.data.buffer,
        instruction.data.byteOffset,
        instruction.data.byteLength,
      );
      assert.equal(bytes.getBigUint64(8, true), 50_000_001n);
      assert.equal(
        bytes.getBigUint64(16, true),
        kind === "exactIn" ? build.quote.minimumAmountOut : build.quote.maximumAmountIn,
      );
      assert.ok(
        instruction.data.subarray(24, 40).every((byte) => byte === 0),
        "Native zero-price-limit full-fill guard must be encoded",
      );
      assert.equal(instruction.data[40], Number(kind === "exactIn"));
      assert.ok(structuredClone(build).instructions.length > 0);
    }
});

test("public CLMM consumer discovers tick arrays in positive and negative extension bitmaps", async () => {
  for (const [tickOffset, sqrtPrice] of [
    [-30840, 3947036234115134552n],
    [30840, 86212121383584052877n],
  ]) {
    for (const reverse of [false, true]) {
      const fixture = await raydiumClmmFixture(owner, {
        tickOffset,
        sqrtPrice,
        reverse,
        label: `bitmap:${tickOffset}:${reverse}`,
      });
      const build = value(await buildSwapInstructions(fixture.request));
      assert.ok(build.quote.expectedAmountOut > 0n);
      const accounts = build.swapInstructions[0].accounts.map((item) => item.address);
      assert.ok(accounts.includes(fixture.bitmap));
      assert.ok(fixture.tickArrays.some((item) => accounts.includes(item.address)));
    }
  }
});

test("public CLMM consumer reports exhausted liquidity and malformed account dependencies", async () => {
  for (const reverse of [false, true])
    for (const kind of ["exactIn", "exactOut"]) {
      const fixture = await raydiumClmmFixture(owner, { reverse });
      error(
        await buildSwapInstructions({
          ...fixture.request,
          amount:
            kind === "exactIn"
              ? { kind, amountIn: 10_000_000_000n }
              : { kind, amountOut: 10_000_000_000n },
        }),
        "INSUFFICIENT_LIQUIDITY",
      );
    }
  for (const mutation of [
    (f) => {
      f.request.snapshot.accounts[f.pool].owner = owner;
    },
    (f) => {
      f.request.snapshot.accounts[f.bitmap].owner = owner;
    },
    (f) => {
      f.request.snapshot.accounts[f.bitmap].data.set(
        getAddressEncoder().encode(owner),
        8,
      );
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].owner = owner;
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].data[10124]++;
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].data[40]++;
    },
    (f) => {
      f.request.snapshot.accounts[f.pool].data[8] ^= 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.config].data[51]++;
    },
    (f) => {
      f.request.snapshot.accounts[f.observation].data[19] ^= 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.vault0].data[32] ^= 1;
    },
  ]) {
    const fixture = await raydiumClmmFixture(owner);
    mutation(fixture);
    const result = await buildSwapInstructions(fixture.request);
    assert.equal(result.ok, false);
    assert.ok(
      ["INVALID_ACCOUNT", "UNSUPPORTED_PROTOCOL"].includes(result.error.code),
      result.error.code,
    );
  }
});

test("public CLMM consumer rejects unqualified dynamic fees, token features, and limit orders", async () => {
  for (const mutation of [
    (f) => {
      f.request.snapshot.accounts[f.pool].data[1096] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.pool].data[390] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.pool].data[391] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.pool].data[1176] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.pool].data[389] = 16;
    },
    (f) => {
      f.request.snapshot.accounts[f.mint0].owner = TOKEN_2022_PROGRAM_ADDRESS;
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].data[44 + 30 * 168 + 124] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].data[44 + 30 * 168 + 132] = 1;
    },
    (f) => {
      f.request.snapshot.accounts[f.tickArrays[1].address].data[44 + 30 * 168 + 140] = 1;
    },
  ]) {
    const fixture = await raydiumClmmFixture(owner);
    mutation(fixture);
    error(await buildSwapInstructions(fixture.request), "UNSUPPORTED_POOL_FEATURE");
  }
});

test("public CLMM consumer rejects u64 input-vault settlement overflow in both modes and directions", async () => {
  for (const reverse of [false, true])
    for (const kind of ["exactIn", "exactOut"]) {
      const fixture = await raydiumClmmFixture(owner, { reverse });
      const data =
        fixture.request.snapshot.accounts[reverse ? fixture.vault1 : fixture.vault0].data;
      new DataView(data.buffer).setBigUint64(64, (1n << 64n) - 1n, true);
      error(
        await buildSwapInstructions({
          ...fixture.request,
          amount:
            kind === "exactIn"
              ? { kind, amountIn: 1_000_001n }
              : { kind, amountOut: 1_000_001n },
        }),
        "INSUFFICIENT_LIQUIDITY",
      );
    }
});
