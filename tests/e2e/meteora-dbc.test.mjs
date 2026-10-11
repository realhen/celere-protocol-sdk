import {
  MissingAccountsError,
  createProtocolSdk,
  compileTransaction,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";

import { meteoraDbcAdapter } from "../../dist/protocols/meteora-dbc/adapter.js";
import { meteoraDbcFixture } from "../fixtures/meteora-dbc.mjs";
const sdk = createProtocolSdk([meteoraDbcAdapter]);

function write(data, o, n) {
  new DataView(data.buffer).setBigUint64(o, n, true);
}
test("offline Meteora DBC consumer discovers config and builds both native full-fill modes across segments", async () => {
  const signer = await generateKeyPairSigner(),
    original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Offline SDK attempted network access");
  };
  try {
    for (const reverse of [false, true])
      for (const collectFeeMode of [0, 1]) {
        const fixture = await meteoraDbcFixture(signer.address, {
          reverse,
          collectFeeMode,
        });
        const partial = {
          ...fixture.request,
          snapshot: {
            ...fixture.request.snapshot,
            accounts: { [fixture.pool]: fixture.request.snapshot.accounts[fixture.pool] },
          },
        };
        assert.ok(
          (await sdk.getSwapRequirements(partial)).missing.some(
            (x) => x.address === fixture.config,
          ),
        );
        await assert.rejects(
          () => sdk.buildSwapInstructions(partial),
          MissingAccountsError,
        );
        partial.snapshot.accounts[fixture.config] =
          fixture.request.snapshot.accounts[fixture.config];
        assert.ok(
          (await sdk.getSwapRequirements(partial)).missing.some(
            (x) => x.address === fixture.quoteMint,
          ),
        );
        for (const amount of [
          { kind: "exactIn", amountIn: 1_000_003n },
          { kind: "exactOut", amountOut: 1_000_003n },
          { kind: "exactIn", amountIn: 300_000_003n },
          { kind: "exactOut", amountOut: 200_000_003n },
        ]) {
          const built = await sdk.buildSwapInstructions({ ...fixture.request, amount });
          assert.equal(built.execution.mayPartiallyFill, false);
          assert.equal(built.instructions[0].data[24], amount.kind === "exactIn" ? 0 : 2);
          assert.equal(built.instructions[0].accounts.length, 15);
          assert.deepEqual(structuredClone(built), built);
          const tx = compileTransaction({
            instructions: built.instructions,
            feePayer: signer.address,
            lifetime: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 100n,
            },
          });
          assert.ok(tx.byteLength <= 1232);
          assert.ok(Object.values(tx.transaction.signatures).every((x) => x === null));
        }
      }
  } finally {
    globalThis.fetch = original;
  }
});
test("Meteora DBC reports malformed, unqualified and exhausted snapshots with typed errors", async () => {
  const signer = await generateKeyPairSigner();
  for (const [change, code] of [
    [
      (f) => (f.request.snapshot.accounts[f.config].data[136] = 1),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => (f.request.snapshot.accounts[f.config].data[130] = 2),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => (f.request.snapshot.accounts[f.config].data[365] = 1),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [(f) => (f.request.snapshot.accounts[f.pool].data[305] = 1), "INVALID_ACCOUNT"],
    [
      (f) => write(f.request.snapshot.accounts[f.pool].data, 240, 10_000_000_000n),
      "INVALID_ACCOUNT",
    ],
    [
      (f) =>
        write(
          f.request.snapshot.accounts[f.pool].data,
          296,
          f.request.snapshot.unixTimestamp + 1n,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      (f) => write(f.request.snapshot.accounts[f.baseVault].data, 64, 1n),
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.amount = { kind: "exactOut", amountOut: 2_000_000_000n };
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
  ]) {
    const f = await meteoraDbcFixture(signer.address);
    change(f);
    await assert.rejects(
      () => sdk.buildSwapInstructions(f.request),
      (error) => {
        assert.equal(error.code, code, error.message);
        return true;
      },
    );
  }
});
