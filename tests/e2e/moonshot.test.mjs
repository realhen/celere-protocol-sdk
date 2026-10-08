import assert from "node:assert/strict";
import test from "node:test";
import { getAddressEncoder } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  buildSwapInstructions,
  getSwapRequirements,
  compileTransaction,
} from "../../dist/index.js";
import { MOONSHOT_PROGRAM } from "../../dist/protocols/moonshot/curve.js";
import { moonshotFixture } from "../fixtures/moonshot.mjs";

function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}

test("Moonshot public consumer discovers supplied accounts and compiles all qualified native modes offline", async () => {
  for (const curveType of [1, 2])
    for (const buy of [true, false])
      for (const kind of ["exactIn", "exactOut"]) {
        const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, {
          curveType,
          buy,
          label: `offline:${curveType}:${buy}:${kind}`,
        });
        const amount =
          kind === "exactIn"
            ? f.request.amount
            : { kind, amountOut: buy ? 1_000_000_000_001n : 1_000_001n };
        const request = { ...f.request, amount };
        const missing = structuredClone(request);
        delete missing.snapshot.accounts[f.config];
        assert.equal(
          value(await getSwapRequirements(missing)).missing.some(
            (a) => a.address === f.config,
          ),
          true,
        );
        assert.equal(value(await getSwapRequirements(request)).complete, true);
        const build = value(await buildSwapInstructions(request));
        assert.equal(build.protocol, "moonshot");
        assert.equal(build.execution.mayPartiallyFill, false);
        assert.equal(build.swapInstructions[0].programAddress, MOONSHOT_PROGRAM);
        assert.equal(build.quote.kind, kind);
        assert.deepEqual(
          build.assets,
          buy
            ? { input: "nativeSol", output: "spl" }
            : { input: "spl", output: "nativeSol" },
        );
        const compiled = value(
          compileTransaction({
            instructions: build.instructions,
            feePayer: request.owner,
            lifetime: { blockhash: SYSTEM_PROGRAM_ADDRESS, lastValidBlockHeight: 100n },
          }),
        );
        assert.ok(compiled.byteLength <= 1232);
        assert.deepEqual(structuredClone(build), build);
      }
});

test("Moonshot rejects unsupported curves, token programs, and malformed state through structured errors", async () => {
  for (const curveType of [0, 3, 4]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { curveType });
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNSUPPORTED_POOL_FEATURE");
  }
  const token = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS);
  token.request.snapshot.accounts[token.mint].owner = TOKEN_2022_PROGRAM_ADDRESS;
  const tokenResult = await buildSwapInstructions(token.request);
  assert.equal(tokenResult.ok, false);
  assert.equal(tokenResult.error.code, "UNSUPPORTED_POOL_FEATURE");
  const invalid = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS);
  invalid.request.snapshot.accounts[invalid.pool].data[80] ^= 1;
  const rejected = await buildSwapInstructions(invalid.request);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "INVALID_ACCOUNT");
});

test("Moonshot consumer rejects aliased fees, unknown state and settlement overflows before producing instructions", async () => {
  for (const target of ["owner", "pool", "vault", "user"]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { label: `alias:${target}` });
    const key = target === "owner" ? f.request.owner : f[target];
    f.request.snapshot.accounts[f.config].data.set(getAddressEncoder().encode(key), 136);
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false);
    assert.ok(
      ["UNSUPPORTED_POOL_FEATURE", "INVALID_ACCOUNT"].includes(result.error.code),
    );
  }
  for (const target of ["pool", "config"]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { label: `tail:${target}` });
    f.request.snapshot.accounts[f[target]].data[
      f.request.snapshot.accounts[f[target]].data.length - 1
    ] = 1;
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNSUPPORTED_POOL_FEATURE");
  }
  for (const target of ["dexFee", "helioFee", "pool", "user", "owner"]) {
    const buy = target !== "owner";
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, {
      buy,
      label: `overflow:${target}`,
    });
    if (target === "user")
      new DataView(f.request.snapshot.accounts[f.user].data.buffer).setBigUint64(
        64,
        (1n << 64n) - 1n,
        true,
      );
    else
      f.request.snapshot.accounts[
        target === "owner" ? f.request.owner : f[target]
      ].lamports = (1n << 64n) - 1n;
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_ACCOUNT");
  }
});
