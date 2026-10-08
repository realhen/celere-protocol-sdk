import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { meteoraDlmmFixture, DLMM_PROGRAM } from "../fixtures/meteora-dlmm.mjs";
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

test("DLMM consumer discovers observed bitmap then directional bin arrays without network or clock access", async () => {
  const fixture = await meteoraDlmmFixture(owner);
  const supplied = fixture.request.snapshot.accounts;
  const accounts = {};
  const request = {
    ...fixture.request,
    snapshot: { ...fixture.request.snapshot, accounts },
  };
  const savedFetch = globalThis.fetch;
  const savedNow = Date.now;
  globalThis.fetch = () => {
    throw new Error("Offline consumer must not fetch");
  };
  Date.now = () => {
    throw new Error("Offline consumer must use chain context");
  };
  try {
    let rounds = 0;
    let complete = false;
    while (!complete) {
      const requirements = value(await getSwapRequirements(request));
      complete = requirements.complete;
      for (const missing of requirements.missing) {
        assert.ok(
          Object.hasOwn(supplied, missing.address),
          `Fixture missing ${missing.role}`,
        );
        accounts[missing.address] = supplied[missing.address];
      }
      assert.ok(++rounds < 10);
    }
    assert.ok(rounds >= 4, "Pool, bitmap and directional arrays must be staged");
    for (const reverse of [false, true]) {
      const full = await meteoraDlmmFixture(owner, { reverse });
      for (const amount of [
        { kind: "exactIn", amountIn: 2_100_001n },
        { kind: "exactOut", amountOut: 2_100_001n },
      ]) {
        const built = value(await buildSwapInstructions({ ...full.request, amount }));
        assert.equal(built.protocol, "meteora-dlmm");
        assert.equal(built.execution.mayPartiallyFill, false);
        assert.equal(built.swapInstructions[0].programAddress, DLMM_PROGRAM);
        assert.equal(built.swapInstructions[0].data.length, 28);
        assert.deepEqual(built.context, {
          slot: 100n,
          epoch: 0n,
          unixTimestamp: full.request.snapshot.unixTimestamp,
        });
        assert.ok(built.quote.fees[0].amount > 0n);
        const view = new DataView(built.swapInstructions[0].data.buffer);
        assert.equal(
          view.getBigUint64(8, true),
          amount.kind === "exactIn" ? built.quote.amountIn : built.quote.maximumAmountIn,
        );
        assert.equal(
          view.getBigUint64(16, true),
          amount.kind === "exactIn"
            ? built.quote.minimumAmountOut
            : built.quote.amountOut,
        );
      }
    }
  } finally {
    globalThis.fetch = savedFetch;
    Date.now = savedNow;
  }
});

test("DLMM public consumer rejects unsupported semantics and malformed or exhausted observations", async () => {
  const cases = [
    [
      "MISSING_ACCOUNTS",
      (f) => {
        delete f.request.snapshot.accounts[f.bitmap];
      },
    ],
    [
      "INVALID_ACCOUNT",
      (f) => {
        f.request.snapshot.accounts[f.arrays[1]].data[24] ^= 1;
      },
    ],
    [
      "INVALID_ACCOUNT",
      (f) => {
        f.request.snapshot.accounts[f.oracle].data[0] ^= 1;
      },
    ],
    [
      "INVALID_ACCOUNT",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[72] ^= 1;
      },
    ],
    [
      "INVALID_ACCOUNT",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[82] = 1;
      },
    ],
    [
      "UNSUPPORTED_POOL_FEATURE",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[75] = 1;
      },
    ],
    [
      "UNSUPPORTED_POOL_FEATURE",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[35] = 2;
      },
    ],
    [
      "UNSUPPORTED_POOL_FEATURE",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[36] = 1;
      },
    ],
    [
      "UNSUPPORTED_POOL_FEATURE",
      (f) => {
        f.request.snapshot.accounts[f.pool].data[880] = 1;
      },
    ],
    [
      "UNSUPPORTED_POOL_FEATURE",
      (f) => {
        new DataView(f.request.snapshot.accounts[f.arrays[1]].data.buffer).setBigUint64(
          56 + 112,
          1n,
          true,
        );
      },
    ],
    [
      "INVALID_SNAPSHOT_CONTEXT",
      (f) => {
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigInt64(
          56,
          f.request.snapshot.unixTimestamp + 1n,
          true,
        );
      },
    ],
    [
      "INSUFFICIENT_LIQUIDITY",
      (f) => {
        f.request.amount = { kind: "exactOut", amountOut: 1_000_000_000_000n };
      },
    ],
    [
      "INSUFFICIENT_LIQUIDITY",
      (f) => {
        f.request.amount = { kind: "exactIn", amountIn: 1_000_000_000_000n };
      },
    ],
  ];
  for (const [code, mutate] of cases) {
    const fixture = await meteoraDlmmFixture(owner);
    mutate(fixture);
    const result = await buildSwapInstructions(fixture.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code, JSON.stringify(result));
  }
});

test("DLMM quotes use chain filter, decay and volatility updates without mutating observations", async () => {
  const fees = [];
  for (const feePhase of ["filter", "decay", "decayed"]) {
    const fixture = await meteoraDlmmFixture(owner, { dynamic: true, feePhase });
    const before = Uint8Array.from(fixture.request.snapshot.accounts[fixture.pool].data);
    const built = value(await buildSwapInstructions(fixture.request));
    fees.push(built.quote.fees[0].amount);
    assert.deepEqual(fixture.request.snapshot.accounts[fixture.pool].data, before);
  }
  assert.ok(
    new Set(fees).size === 3,
    "Chain fee phases must produce distinct dynamic fees",
  );
});
