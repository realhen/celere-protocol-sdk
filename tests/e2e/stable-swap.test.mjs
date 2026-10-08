import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { createProtocolSdk, compileTransaction } from "../../dist/index.js";
import { stableSwapAdapters } from "../../dist/protocols/stable-swap/index.js";
import { raydiumAmmV4Fixture } from "../fixtures/raydium-amm-v4.mjs";
import { raydiumClmmFixture } from "../fixtures/raydium-clmm.mjs";

function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
test("Stable Swap subset resolves canonical Raydium identities and builds both native amount modes", async () => {
  const sdk = createProtocolSdk(stableSwapAdapters);
  const owner = (await generateKeyPairSigner()).address;
  for (const [id, factory] of [
    ["raydium-amm-v4", raydiumAmmV4Fixture],
    ["raydium-clmm", raydiumClmmFixture],
  ]) {
    for (const reverse of [false, true]) {
      const fixture = await factory(owner, { reverse });
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const request = { ...fixture.request, amount };
        const requirements = value(await sdk.getSwapRequirements(request));
        assert.equal(requirements.protocol, id);
        assert.equal(requirements.complete, true);
        const built = value(await sdk.buildSwapInstructions(request));
        assert.equal(built.protocol, id);
        assert.equal(built.quote.kind, amount.kind);
        assert.equal(built.execution.mayPartiallyFill, false);
        const compiled = value(
          compileTransaction({
            instructions: built.instructions,
            feePayer: owner,
            lifetime: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 1n,
            },
          }),
        );
        assert(compiled.byteLength <= 1232);
      }
    }
  }
});
