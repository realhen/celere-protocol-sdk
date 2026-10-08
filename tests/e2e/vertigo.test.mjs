import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { vertigoFixture, putU128, VERTIGO_PROGRAM } from "../fixtures/vertigo.mjs";
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

test("offline Vertigo consumer discovers account snapshots and builds portable native exact-input instructions", async () => {
  const signer = await generateKeyPairSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline build attempted network access");
  };
  try {
    for (const reverse of [false, true]) {
      const fixture = await vertigoFixture(signer.address, { reverse });
      const unknown = value(
        await getSwapRequirements({
          ...fixture.request,
          snapshot: { ...fixture.request.snapshot, accounts: {} },
        }),
      );
      assert.equal(unknown.protocol, null);
      assert.equal(unknown.missing[0].address, fixture.pool);
      const partial = {
        ...fixture.request,
        snapshot: {
          ...fixture.request.snapshot,
          accounts: { [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool] },
        },
      };
      const discovered = value(await getSwapRequirements(partial));
      assert.equal(discovered.protocol, "vertigo");
      for (const address of [
        fixture.mintA,
        fixture.mintB,
        fixture.vaultA,
        fixture.vaultB,
      ])
        assert.ok(discovered.missing.some((item) => item.address === address));
      const missing = await buildSwapInstructions(partial);
      assert.equal(missing.ok, false);
      assert.equal(missing.error.code, "MISSING_ACCOUNTS");
      assert.equal(value(await getSwapRequirements(fixture.request)).complete, true);
      const build = value(await buildSwapInstructions(fixture.request));
      assert.equal(build.protocol, "vertigo");
      assert.equal(build.quote.kind, "exactIn");
      assert.equal(build.execution.mayPartiallyFill, false);
      assert.equal(build.swapInstructions.length, 1);
      const instruction = build.swapInstructions[0];
      assert.equal(instruction.programAddress, VERTIGO_PROGRAM);
      assert.equal(instruction.accounts.length, 13);
      assert.deepEqual(
        [...instruction.data.subarray(0, 8)],
        reverse
          ? [51, 230, 133, 164, 1, 127, 131, 173]
          : [102, 6, 61, 18, 1, 218, 235, 234],
      );
      const view = new DataView(
        instruction.data.buffer,
        instruction.data.byteOffset,
        instruction.data.byteLength,
      );
      assert.equal(view.getBigUint64(8, true), fixture.request.amount.amountIn);
      assert.equal(view.getBigUint64(16, true), build.quote.minimumAmountOut);
      assert.ok(build.quote.fees.every((fee) => fee.mint === fixture.mintA));
      assert.deepEqual(build.requiredSigners, [signer.address]);
      assert.deepEqual(structuredClone(build), build);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vertigo consumer rejects unsupported execution modes, launch fees and invalid account observations", async () => {
  const signer = await generateKeyPairSigner();
  for (const [change, expected] of [
    [
      (f) => {
        f.request.amount = { kind: "exactOut", amountOut: 1n };
      },
      "UNSUPPORTED_SWAP_MODE",
    ],
    [
      (f) => {
        f.request.snapshot.slot = 1n;
        for (const a of Object.values(f.request.snapshot.accounts)) a.slot = 1n;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[196] = 1;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[8] = 0;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[169] ^= 1;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[0] ^= 1;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data = new Uint8Array(230);
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setUint16(
          194,
          10_000,
          true,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setFloat64(
          178,
          NaN,
          true,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigUint64(
          170,
          0n,
          true,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setFloat64(
          178,
          2,
          true,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        putU128(f.request.snapshot.accounts[f.pool].data, 137, 0n);
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        putU128(f.request.snapshot.accounts[f.pool].data, 105, 2_000_000_000n);
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        new DataView(f.request.snapshot.accounts[f.vaultA].data.buffer).setBigUint64(
          64,
          1n,
          true,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.vaultB].owner = VERTIGO_PROGRAM;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        putU128(f.request.snapshot.accounts[f.pool].data, 121, 0n);
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
    [
      (f) => {
        putU128(f.request.snapshot.accounts[f.pool].data, 137, (1n << 128n) - 1n);
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
  ]) {
    const fixture = await vertigoFixture(signer.address);
    change(fixture);
    const result = await buildSwapInstructions(fixture.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, expected, result.error.message);
    assert.deepEqual(structuredClone(result), result);
  }
  const token2022 = await vertigoFixture(signer.address);
  for (const address of [token2022.mintA, token2022.vaultA, token2022.userA])
    token2022.request.snapshot.accounts[address].owner = TOKEN_2022_PROGRAM_ADDRESS;
  const unsupported = await buildSwapInstructions(token2022.request);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "UNSUPPORTED_POOL_FEATURE");
  assert.equal(unsupported.error.feature, "token-2022");
  const reverse = await vertigoFixture(signer.address, { reverse: true });
  putU128(reverse.request.snapshot.accounts[reverse.pool].data, 105, 0n);
  const depleted = await buildSwapInstructions(reverse.request);
  assert.equal(depleted.ok, false);
  assert.equal(depleted.error.code, "INSUFFICIENT_LIQUIDITY");
});
