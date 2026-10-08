import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { address } from "@solana/kit";
import { buildSwapInstructions, getSwapRequirements } from "../../dist/index.js";
import { metadaoFixture, METADAO_PROGRAM } from "../fixtures/metadao.mjs";
const owner = address("11111111111111111111111111111112");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
test("consumer builds native MetaDAO spot buys and sells from offline observations", async () => {
  for (const reverse of [false, true]) {
    const f = await metadaoFixture(owner, { reverse });
    const requirements = value(await getSwapRequirements(f.request));
    assert.equal(requirements.complete, true);
    const build = value(await buildSwapInstructions(f.request));
    assert.equal(build.protocol, "metadao");
    assert.equal(build.swapInstructions.length, 1);
    const instruction = build.swapInstructions[0];
    assert.equal(instruction.programAddress, METADAO_PROGRAM);
    assert.equal(instruction.accounts.length, 9);
    assert.equal(instruction.data.length, 25);
    assert.equal(instruction.data[16], reverse ? 1 : 0);
    assert.equal(build.quote.expectedAmountOut, reverse ? 497_252n : 1_988_021n);
    assert.deepEqual(build.quote.fees, [
      { kind: "trade", mint: f.request.inputMint, amount: 5_001n },
    ]);
    assert.equal(build.execution.mayPartiallyFill, false);
    assert.deepEqual(build.requiredSigners, [owner]);
  }
});
test("MetaDAO reports exact output and active futarchy state as unsupported", async () => {
  const f = await metadaoFixture(owner);
  const exactOut = await buildSwapInstructions({
    ...f.request,
    amount: { kind: "exactOut", amountOut: 100n },
  });
  assert.equal(exactOut.ok, false);
  assert.equal(exactOut.error.code, "UNSUPPORTED_SWAP_MODE");
  f.request.snapshot.accounts[f.pool].data[8] = 1;
  const active = await buildSwapInstructions(f.request);
  assert.equal(active.ok, false);
  assert.equal(active.error.code, "UNSUPPORTED_POOL_FEATURE");
});
test("MetaDAO rejects malformed observations, mismatched vault state, stale time and zero-output amounts", async () => {
  for (const variant of [
    "discriminator",
    "truncated",
    "pda",
    "vault-balance",
    "mint",
    "owner",
    "time",
    "borsh-tail",
    "token-2022",
    "zero-output",
  ]) {
    const f = await metadaoFixture(owner);
    const account = f.request.snapshot.accounts[f.pool];
    let expected = "INVALID_ACCOUNT";
    if (variant === "discriminator") account.data[0] ^= 255;
    if (variant === "truncated") account.data = account.data.slice(0, 568);
    if (variant === "pda") account.data[325] ^= 1;
    if (variant === "vault-balance")
      new DataView(f.request.snapshot.accounts[f.baseVault].data.buffer).setBigUint64(
        64,
        1n,
        true,
      );
    if (variant === "mint") account.data[390] ^= 1;
    if (variant === "owner") {
      account.owner = SYSTEM_PROGRAM_ADDRESS;
      expected = "UNSUPPORTED_PROTOCOL";
    }
    if (variant === "time")
      new DataView(account.data.buffer).setBigInt64(
        25,
        f.request.snapshot.unixTimestamp + 1n,
        true,
      );
    if (variant === "borsh-tail") account.data[532] = 2;
    if (variant === "token-2022") {
      for (const address of [f.mintA, f.baseVault, f.userBase])
        f.request.snapshot.accounts[address].owner = TOKEN_2022_PROGRAM_ADDRESS;
      expected = "UNSUPPORTED_POOL_FEATURE";
    }
    if (variant === "zero-output") {
      f.request.amount = { kind: "exactIn", amountIn: 1n };
      expected = "INSUFFICIENT_LIQUIDITY";
    }
    const result = await buildSwapInstructions(f.request);
    assert.equal(result.ok, false, variant);
    assert.equal(result.error.code, expected, variant);
  }
});
