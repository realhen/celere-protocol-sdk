import {
  InvalidAccountError,
  UnsupportedPoolFeatureError,
  buildSwapInstructions,
  getSwapRequirements,
  compileTransaction,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { getAddressEncoder } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

import { MOONSHOT_PROGRAM } from "../../dist/protocols/moonshot/curve.js";
import { moonshotFixture } from "../fixtures/moonshot.mjs";

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
          (await getSwapRequirements(missing)).missing.some(
            (a) => a.address === f.config,
          ),
          true,
        );
        assert.equal((await getSwapRequirements(request)).complete, true);
        const build = await buildSwapInstructions(request);
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
        const compiled = compileTransaction({
          instructions: build.instructions,
          feePayer: request.owner,
          lifetime: { blockhash: SYSTEM_PROGRAM_ADDRESS, lastValidBlockHeight: 100n },
        });
        assert.ok(compiled.byteLength <= 1232);
        assert.deepEqual(structuredClone(build), build);
      }
});

test("Moonshot rejects unsupported curves, token programs, and malformed state through typed errors", async () => {
  for (const curveType of [0, 3, 4]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { curveType });
    await assert.rejects(
      () => buildSwapInstructions(f.request),
      (error) => {
        assert.ok(error instanceof UnsupportedPoolFeatureError);
        assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
        return true;
      },
    );
  }
  const token = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS);
  token.request.snapshot.accounts[token.mint].owner = TOKEN_2022_PROGRAM_ADDRESS;
  await assert.rejects(
    () => buildSwapInstructions(token.request),
    (error) => {
      assert.ok(error instanceof UnsupportedPoolFeatureError);
      assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
      return true;
    },
  );
  const invalid = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS);
  invalid.request.snapshot.accounts[invalid.pool].data[80] ^= 1;
  await assert.rejects(
    () => buildSwapInstructions(invalid.request),
    (error) => {
      assert.ok(error instanceof InvalidAccountError);
      assert.equal(error.code, "INVALID_ACCOUNT");
      return true;
    },
  );
});

test("Moonshot consumer rejects aliased fees, unknown state and settlement overflows before producing instructions", async () => {
  for (const target of ["owner", "pool", "vault", "user"]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { label: `alias:${target}` });
    const key = target === "owner" ? f.request.owner : f[target];
    f.request.snapshot.accounts[f.config].data.set(getAddressEncoder().encode(key), 136);
    await assert.rejects(
      () => buildSwapInstructions(f.request),
      (error) => {
        assert.ok(["UNSUPPORTED_POOL_FEATURE", "INVALID_ACCOUNT"].includes(error.code));
        return true;
      },
    );
  }
  for (const target of ["pool", "config"]) {
    const f = await moonshotFixture(SYSTEM_PROGRAM_ADDRESS, { label: `tail:${target}` });
    f.request.snapshot.accounts[f[target]].data[
      f.request.snapshot.accounts[f[target]].data.length - 1
    ] = 1;
    await assert.rejects(
      () => buildSwapInstructions(f.request),
      (error) => {
        assert.ok(error instanceof UnsupportedPoolFeatureError);
        assert.equal(error.code, "UNSUPPORTED_POOL_FEATURE");
        return true;
      },
    );
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
    await assert.rejects(
      () => buildSwapInstructions(f.request),
      (error) => {
        assert.ok(error instanceof InvalidAccountError);
        assert.equal(error.code, "INVALID_ACCOUNT");
        return true;
      },
    );
  }
});
