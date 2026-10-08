import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { createProtocolSdk, compileTransaction } from "../../dist/index.js";
import { heavenAdapter } from "../../dist/protocols/heaven/amm.js";
import { heavenFixture } from "../fixtures/heaven.mjs";
const sdk = createProtocolSdk([heavenAdapter]);
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
test("Heaven consumer discovers caller state and builds portable unsigned native instructions", async () => {
  const owner = (await generateKeyPairSigner()).address;
  for (const buy of [true, false]) {
    const f = await heavenFixture(owner, { buy });
    const config = f.request.snapshot.accounts[f.config];
    delete f.request.snapshot.accounts[f.config];
    const missing = value(await sdk.getSwapRequirements(f.request));
    assert.equal(missing.complete, false);
    assert(missing.missing.some((a) => a.address === f.config));
    f.request.snapshot.accounts[f.config] = config;
    assert.equal(value(await sdk.getSwapRequirements(f.request)).complete, true);
    const built = value(await sdk.buildSwapInstructions(f.request));
    assert.equal(built.protocol, "heaven");
    assert.equal(built.swapInstructions[0].accounts.length, 16);
    assert.equal(built.swapInstructions[0].data.length, 28);
    const tx = value(
      compileTransaction({
        instructions: built.instructions,
        feePayer: owner,
        lifetime: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1n,
        },
      }),
    );
    assert(tx.wireBytes.length <= 1232);
    assert.deepEqual(structuredClone(built), built);
  }
});
test("Heaven rejects native exact output, tiered fees, invalid authority and unsupported state explicitly", async () => {
  const owner = (await generateKeyPairSigner()).address;
  const f = await heavenFixture(owner);
  for (const [modify, code] of [
    [
      (r) => {
        r.amount = { kind: "exactOut", amountOut: 1n };
      },
      "UNSUPPORTED_SWAP_MODE",
    ],
    [
      (r) => {
        r.snapshot.accounts[f.pool].data[160] = 2;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (r) => {
        r.snapshot.accounts[f.pool].data[91] = 0;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (r) => {
        r.snapshot.accounts[f.config].data[458] = 1;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (r) => {
        new DataView(r.snapshot.accounts[f.pool].data.buffer).setBigUint64(456, 0n, true);
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
  ]) {
    const request = structuredClone(f.request);
    modify(request);
    const rejected = await sdk.buildSwapInstructions(request);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, code);
  }
});
