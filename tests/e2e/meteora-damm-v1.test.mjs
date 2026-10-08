import assert from "node:assert/strict";
import test from "node:test";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { generateKeyPairSigner, getAddressEncoder } from "@solana/kit";
import {
  buildSwapInstructions,
  getSwapRequirements,
  compileTransaction,
} from "../../dist/index.js";
import { meteoraDammV1Fixture, DAMM_V1_PROGRAM } from "../fixtures/meteora-damm-v1.mjs";
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  return result.value;
}
function write(account, offset, amount) {
  new DataView(account.data.buffer).setBigUint64(offset, amount, true);
}
test("offline DAMM v1 consumer discovers vault dependencies and builds portable unsigned swaps", async () => {
  const signer = await generateKeyPairSigner();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected network operation");
  };
  try {
    for (const reverse of [false, true]) {
      const fixture = await meteoraDammV1Fixture(signer.address, { reverse });
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
      const stage1 = value(await getSwapRequirements(partial));
      assert.equal(stage1.protocol, "meteora-damm-v1");
      assert.ok(stage1.missing.some((a) => a.address === fixture.vaults[0].vault));
      for (const vault of fixture.vaults)
        partial.snapshot.accounts[vault.vault] =
          fixture.request.snapshot.accounts[vault.vault];
      const stage2 = value(await getSwapRequirements(partial));
      assert.ok(stage2.missing.some((a) => a.address === fixture.vaults[0].lpMint));
      assert.ok(stage2.missing.some((a) => a.address === fixture.vaults[0].tokenVault));
      assert.equal((await buildSwapInstructions(partial)).error.code, "MISSING_ACCOUNTS");
      assert.equal(value(await getSwapRequirements(fixture.request)).complete, true);
      const build = value(await buildSwapInstructions(fixture.request));
      assert.equal(build.protocol, "meteora-damm-v1");
      assert.equal(build.execution.mayPartiallyFill, false);
      assert.equal(build.instructions.length, 1);
      assert.equal(build.instructions[0].programAddress, DAMM_V1_PROGRAM);
      assert.equal(build.instructions[0].accounts.length, 15);
      assert.deepEqual(structuredClone(build), build);
      const compiled = value(
        compileTransaction({
          instructions: build.instructions,
          feePayer: signer.address,
          lifetime: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123n,
          },
        }),
      );
      assert.ok(compiled.byteLength <= 1232);
      assert.ok(Object.values(compiled.transaction.signatures).every((s) => s === null));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("DAMM v1 consumer receives structured errors for unsupported curves, modes, vault strategies and corrupt backing", async () => {
  const signer = await generateKeyPairSigner();
  for (const [change, code] of [
    [
      (f) => {
        f.request.snapshot.unixTimestamp = 1n << 64n;
      },
      "INVALID_SNAPSHOT_CONTEXT",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.mintA].owner = TOKEN_2022_PROGRAM_ADDRESS;
        f.request.snapshot.accounts[f.userA].owner = TOKEN_2022_PROGRAM_ADDRESS;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.vaults[0].vault].data[9] ^= 1;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) =>
        write(
          f.request.snapshot.accounts[f.pool],
          403,
          f.request.snapshot.unixTimestamp + 1n,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      (f) => {
        f.request.amount = { kind: "exactOut", amountOut: 1000n };
      },
      "UNSUPPORTED_SWAP_MODE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[874] = 1;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.pool].data[233] = 0;
      },
      "INVALID_ACCOUNT",
    ],
    [
      (f) => write(f.request.snapshot.accounts[f.pool], 476, 1n),
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.vaults[0].vault].data[147] = 1;
      },
      "UNSUPPORTED_POOL_FEATURE",
    ],
    [
      (f) =>
        write(f.request.snapshot.accounts[f.vaults[0].vault], 11, f.vaults[0].total + 1n),
      "INVALID_ACCOUNT",
    ],
    [
      (f) =>
        write(
          f.request.snapshot.accounts[f.vaults[0].vault],
          1211,
          f.request.snapshot.unixTimestamp + 1n,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      (f) =>
        write(
          f.request.snapshot.accounts[f.vaults[0].vault],
          1203,
          f.vaults[0].total + 1n,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      (f) =>
        write(
          f.request.snapshot.accounts[f.vaults[0].lpMint],
          36,
          f.vaults[0].shares - 1n,
        ),
      "INVALID_ACCOUNT",
    ],
    [
      (f) => write(f.request.snapshot.accounts[f.vaults[0].share], 64, 0n),
      "INSUFFICIENT_LIQUIDITY",
    ],
    [
      (f) => {
        f.request.snapshot.accounts[f.vaults[0].lpMint].data.set(
          getAddressEncoder().encode(signer.address),
          4,
        );
      },
      "INVALID_ACCOUNT",
    ],
    [(f) => write(f.request.snapshot.accounts[f.pool], 338, 0n), "INVALID_ACCOUNT"],
    [
      (f) => {
        f.request.amount = { kind: "exactIn", amountIn: 1n };
      },
      "INSUFFICIENT_LIQUIDITY",
    ],
  ]) {
    const fixture = await meteoraDammV1Fixture(signer.address);
    change(fixture);
    const result = await buildSwapInstructions(fixture.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code, result.error.message);
  }
});
