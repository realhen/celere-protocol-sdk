import {
  UnsupportedPoolFeatureError,
  UnsupportedSwapModeError,
  createProtocolSdk,
  compileTransaction,
} from "../../dist/index.js";
import { buy_with_exact_cash_in } from "../../dist/protocols/rise-rich/instructions/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

import {
  riseRichAdapter,
  RISE_RICH_PROGRAM,
} from "../../dist/protocols/rise-rich/curve.js";
import { riseRichFixture } from "../fixtures/rise-rich.mjs";
const { getSwapRequirements, buildSwapInstructions } = createProtocolSdk([
  riseRichAdapter,
]);

test("Rise public consumer discovers raw snapshots, builds and compiles native exact-input swaps offline", async () => {
  for (const buy of [true, false]) {
    const f = await riseRichFixture(SYSTEM_PROGRAM_ADDRESS, {
      buy,
      feeRate: 12500,
      label: `offline:${buy}`,
    });
    const missing = structuredClone(f.request);
    delete missing.snapshot.accounts[f.marketMeta];
    assert.ok(
      (await getSwapRequirements(missing)).missing.some(
        (a) => a.address === f.marketMeta,
      ),
    );
    assert.equal((await getSwapRequirements(f.request)).complete, true);
    const built = await buildSwapInstructions(f.request);
    assert.equal(built.protocol, "rise-rich");
    assert.equal(built.execution.mayPartiallyFill, false);
    assert.equal(built.swapInstructions[0].programAddress, RISE_RICH_PROGRAM);
    assert.deepEqual(built.assets, { input: "spl", output: "spl" });
    assert.deepEqual(structuredClone(built), built);
    const compiled = compileTransaction({
      instructions: built.instructions,
      feePayer: f.request.owner,
      lifetime: { blockhash: SYSTEM_PROGRAM_ADDRESS, lastValidBlockHeight: 100n },
    });
    assert.ok(compiled.byteLength <= 1232);
    const output = buy ? f.userToken : f.userMain;
    f.request.snapshot.accounts[output] = null;
    const created = await buildSwapInstructions(f.request);
    assert.equal(created.setupInstructions.length, 1);
  }
});
test("Rise public consumer rejects native-unsupported modes and unqualified state", async () => {
  const f = await riseRichFixture(SYSTEM_PROGRAM_ADDRESS);
  await assert.rejects(
    () =>
      buildSwapInstructions({
        ...f.request,
        amount: { kind: "exactOut", amountOut: 1n },
      }),
    (error) => {
      assert.ok(error instanceof UnsupportedSwapModeError);
      assert.equal(error.code, "UNSUPPORTED_SWAP_MODE");
      return true;
    },
  );
  for (const [label, mutate, code] of [
    [
      "sloped",
      (f) =>
        new DataView(f.request.snapshot.accounts[f.mayMarket].data.buffer).setBigUint64(
          40,
          950_000_000_000n,
          true,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      "permission",
      (f) =>
        new DataView(f.request.snapshot.accounts[f.marketMeta].data.buffer).setUint16(
          330,
          0,
          true,
        ),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      "Dutch",
      (f) => (f.request.snapshot.accounts[f.marketMeta].data[340] = 1),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      "unit scale",
      (f) => (f.request.snapshot.accounts[f.marketMeta].data[360] = 1),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      "Token2022",
      (f) => (f.request.snapshot.accounts[f.mint].owner = TOKEN_2022_PROGRAM_ADDRESS),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      "curve link",
      (f) => (f.request.snapshot.accounts[f.mayMarket].data[8] ^= 1),
      "INVALID_ACCOUNT",
    ],
    [
      "fee",
      (f) =>
        new DataView(f.request.snapshot.accounts[f.mayMarketGroup].data.buffer).setUint32(
          106,
          1_000_000,
          true,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      "tail",
      (f) => (f.request.snapshot.accounts[f.pool].data[597] = 1),
      "UNSUPPORTED_POOL_FEATURE",
    ],
  ]) {
    const fixture = await riseRichFixture(SYSTEM_PROGRAM_ADDRESS, { label });
    mutate(fixture);
    await assert.rejects(
      () => buildSwapInstructions(fixture.request),
      (error) => {
        assert.equal(error.code, code, label);
        return true;
      },
    );
  }
  const sloped = await riseRichFixture(SYSTEM_PROGRAM_ADDRESS, {
    supply: 950_000_000_000n,
  });
  await assert.rejects(
    () => buildSwapInstructions(sloped.request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      return true;
    },
  );
});

test("Rise raw public builder rejects malformed Decimal argument widths synchronously", async () => {
  const f = await riseRichFixture(SYSTEM_PROGRAM_ADDRESS);
  const args = {
    cashIn: 1_000_001n,
    minTokenOut: 1n,
    newShoulderEnd: 0n,
    floorIncreaseRatio: new Uint8Array(16),
    maxNewFloor: new Uint8Array(16),
    maxAreaShrinkageToleranceUnits: 100_000_000n,
    minLiqRatio: new Uint8Array(16),
  };
  for (const field of ["floorIncreaseRatio", "maxNewFloor", "minLiqRatio"]) {
    assert.throws(
      () =>
        buy_with_exact_cash_in(f.instructionAccounts, {
          ...args,
          [field]: new Uint8Array(15),
        }),
      RangeError,
    );
    assert.throws(
      () =>
        buy_with_exact_cash_in(f.instructionAccounts, {
          ...args,
          [field]: new Uint8Array(17),
        }),
      RangeError,
    );
  }
});
