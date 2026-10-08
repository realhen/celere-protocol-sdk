import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions } from "../../dist/index.js";
import { TOKEN, TOKEN_2022, SOL, ata } from "./pump-amm.mjs";
import {
  observeAmmRequest,
  provisionCanonicalPool,
  provisionPermissionlessPool,
  rpc,
  submitInstructions,
} from "./pump-amm-native.mjs";

const url = process.env.CELERE_SURFPOOL_URL;
assert.ok(url, "Set CELERE_SURFPOOL_URL to a disposable local Surfpool validator");
const observations = [];
for (const tokenProgram of [TOKEN, TOKEN_2022]) {
  const user = await generateKeyPairSigner(),
    mint = await generateKeyPairSigner();
  const canonical = await provisionCanonicalPool(url, user, mint, tokenProgram);
  const permissionless = await provisionPermissionlessPool(
    url,
    user,
    mint.address,
    tokenProgram,
  );
  const userBase = await ata(user.address, mint.address, tokenProgram),
    userQuote = await ata(user.address, SOL);
  const balance = async (account) =>
    BigInt((await rpc(url, "getTokenAccountBalance", [account])).value.amount);
  for (const [kind, pool] of [
    ["canonical", canonical.pool],
    ["permissionless", permissionless],
  ]) {
    for (const [isBuy, amount] of [
      [true, { kind: "exactIn", amountIn: 10_000_000n }],
      [true, { kind: "exactIn", amountIn: 3376n }],
      [true, { kind: "exactOut", amountOut: 1_000_000n }],
      [false, { kind: "exactIn", amountIn: 1_000_000_000n }],
    ]) {
      const request = await observeAmmRequest(url, {
        pool,
        owner: user.address,
        payer: user.address,
        inputMint: isBuy ? SOL : mint.address,
        outputMint: isBuy ? mint.address : SOL,
        amount,
        slippageBps: 50,
        fillPolicy: "requireFull",
      });
      const build = await buildSwapInstructions(request);
      assert.ok(build.ok);
      const baseBefore = await balance(userBase),
        quoteBefore = await balance(userQuote);
      const signature = await submitInstructions(url, build.value.instructions, user);
      const baseAfter = await balance(userBase),
        quoteAfter = await balance(userQuote);
      const transaction = await rpc(url, "getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      const discriminator = isBuy
        ? [103, 244, 82, 31, 44, 245, 119, 119]
        : [62, 47, 55, 10, 165, 3, 220, 42];
      const event = transaction.meta.logMessages
        .filter((line) => line.startsWith("Program data: "))
        .map((line) => Buffer.from(line.slice(14), "base64"))
        .find((data) => discriminator.every((byte, index) => data[index] === byte));
      assert.ok(event);
      const actual = {
        amountIn: isBuy ? quoteBefore - quoteAfter : baseBefore - baseAfter,
        amountOut: isBuy ? baseAfter - baseBefore : quoteAfter - quoteBefore,
        tradeFee: event.readBigUInt64LE(80) + event.readBigUInt64LE(96),
        creatorFee: event.readBigUInt64LE(352),
      };
      assert.equal(actual.amountIn, build.value.quote.expectedAmountIn);
      assert.equal(actual.amountOut, build.value.quote.expectedAmountOut);
      assert.equal(
        actual.tradeFee,
        build.value.quote.fees.find((fee) => fee.kind === "trade").amount,
      );
      assert.equal(
        actual.creatorFee,
        build.value.quote.fees.find((fee) => fee.kind === "creator").amount,
      );
      observations.push({ tokenProgram, kind, request, actual, signature });
    }
  }
}
await writeFile(
  new URL("./pump-amm-observations.json", import.meta.url),
  JSON.stringify(
    {
      provenance:
        "Generated public test-market state from actual Pump create/completion/migrate_v2 and permissionless create_pool on local Surfpool. Actual amounts come from token balance changes; fees from native BuyEvent/SellEvent. No private keys. Regenerate with CELERE_SURFPOOL_URL=http://127.0.0.1:18999 node tests/fixtures/pump-amm-capture.mjs",
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
