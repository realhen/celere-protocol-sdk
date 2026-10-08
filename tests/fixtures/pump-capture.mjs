import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions } from "../../dist/index.js";
import {
  SOL,
  TOKEN,
  TOKEN_2022,
  createCurveInstruction,
  curveAddress,
  observeRequest,
  rpc,
  submitInstructions,
  tokenAddress,
} from "./pump-helpers.mjs";

const url = process.env.CELERE_SURFPOOL_URL;
assert.ok(url, "Set CELERE_SURFPOOL_URL to a disposable local Surfpool validator");
const observations = [];
for (const tokenProgram of [TOKEN, TOKEN_2022]) {
  const owner = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  await rpc(url, "surfnet_setAccount", [owner.address, { lamports: 1_000_000_000_000 }]);
  await submitInstructions(
    url,
    [await createCurveInstruction(owner.address, mint.address, tokenProgram)],
    owner,
    [owner, mint],
  );
  const pool = await curveAddress(mint.address);
  const token = await tokenAddress(owner.address, mint.address, tokenProgram);
  let previousTokens = 0n;
  for (const [isBuy, amount] of [
    [true, { kind: "exactIn", amountIn: 10_000_000n }],
    [true, { kind: "exactIn", amountIn: 3_376n }],
    [true, { kind: "exactOut", amountOut: 1_000_000n }],
    [false, { kind: "exactIn", amountIn: 1_000_000n }],
  ]) {
    const request = await observeRequest(url, {
      pool,
      owner: owner.address,
      payer: owner.address,
      inputMint: isBuy ? SOL : mint.address,
      outputMint: isBuy ? mint.address : SOL,
      amount,
      slippageBps: 50,
      fillPolicy: "requireFull",
    });
    const built = await buildSwapInstructions(request);
    assert.ok(built.ok);
    const signature = await submitInstructions(url, built.value.instructions, owner);
    const nextTokens = BigInt(
      (await rpc(url, "getTokenAccountBalance", [token])).value.amount,
    );
    assert.equal(
      isBuy ? nextTokens - previousTokens : previousTokens - nextTokens,
      isBuy ? built.value.quote.expectedAmountOut : built.value.quote.expectedAmountIn,
    );
    observations.push({
      tokenProgram,
      request,
      quote: built.value.quote,
      signature,
      observedTokenDelta: nextTokens - previousTokens,
    });
    previousTokens = nextTokens;
  }
}
await writeFile(
  new URL("./pump-observations.json", import.meta.url),
  JSON.stringify(
    {
      provenance:
        "Generated test-only markets created and traded through the native Pump program on local Surfpool. Public account observations only; no private keys. Regenerate with CELERE_SURFPOOL_URL=http://127.0.0.1:18999 node tests/fixtures/pump-capture.mjs",
      observations,
    },
    (_, value) =>
      typeof value === "bigint"
        ? { bigint: value.toString() }
        : value instanceof Uint8Array
          ? { base64: Buffer.from(value).toString("base64") }
          : value,
    2,
  ) + "\n",
);
