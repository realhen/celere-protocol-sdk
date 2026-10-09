import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { buy, sell } from "celere-protocol-sdk/instructions/pump";
import { buildSwapInstructions } from "celere-protocol-sdk";
import {
  SOL,
  TOKEN,
  createCurveInstruction,
  curveAddress,
  tokenAddress,
  observeRequest,
  rpc,
  submitInstructions,
} from "../fixtures/pump-helpers.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Pump tests only accept loopback simulators");

test(
  "native Pump legacy buy and sell execute through the public instruction entrypoint",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const user = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    await rpc(endpoint, "surfnet_setAccount", [
      user.address,
      { lamports: 1_000_000_000_000 },
    ]);
    await submitInstructions(
      endpoint,
      [await createCurveInstruction(user.address, mint.address, TOKEN)],
      user,
      [user, mint],
    );
    const pool = await curveAddress(mint.address);
    const ata = await tokenAddress(user.address, mint.address, TOKEN);
    const request = await observeRequest(endpoint, {
      pool,
      owner: user.address,
      payer: user.address,
      inputMint: SOL,
      outputMint: mint.address,
      amount: { kind: "exactIn", amountIn: 10_000_000n },
      slippageBps: 50,
      fillPolicy: "requireFull",
    });
    const prepared = await buildSwapInstructions(request);
    assert.equal(prepared.ok, true);
    // Provision the ATA and resolve the shared legacy account set through the public workflow.
    await submitInstructions(endpoint, prepared.value.instructions, user);
    const metas = prepared.value.swapInstructions[0].accounts;
    const names = [
      "global",
      "feeRecipient",
      "mint",
      "bondingCurve",
      "associatedBondingCurve",
      "associatedUser",
      "user",
      "systemProgram",
      "tokenProgram",
      "creatorVault",
      "eventAuthority",
      "program",
      "globalVolumeAccumulator",
      "userVolumeAccumulator",
      "feeConfig",
      "feeProgram",
      "bondingCurveV2",
      "buybackFeeRecipient",
    ];
    assert.equal(metas.length, names.length);
    const accounts = Object.fromEntries(
      names.map((name, index) => [name, metas[index].address]),
    );
    const balance = async () =>
      BigInt((await rpc(endpoint, "getTokenAccountBalance", [ata])).value.amount);
    let beforeTokens = await balance();
    const buyAmount = 500_000_000n;
    const buySignature = await submitInstructions(
      endpoint,
      [buy(accounts, { amount: buyAmount, maxSolCost: 1_000_000_000n })],
      user,
    );
    const buyReceipt = await rpc(endpoint, "getTransaction", [
      buySignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    assert.equal(buyReceipt.meta.err, null);
    assert.equal((await balance()) - beforeTokens, buyAmount);
    beforeTokens = await balance();
    const beforeSol = BigInt((await rpc(endpoint, "getBalance", [user.address])).value);
    const sellAmount = 250_000_000n;
    const sellSignature = await submitInstructions(
      endpoint,
      [sell(accounts, { amount: sellAmount, minSolOutput: 1n })],
      user,
    );
    const sellReceipt = await rpc(endpoint, "getTransaction", [
      sellSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    assert.equal(sellReceipt.meta.err, null);
    assert.equal(beforeTokens - (await balance()), sellAmount);
    const afterSol = BigInt((await rpc(endpoint, "getBalance", [user.address])).value);
    assert.ok(afterSol - beforeSol + BigInt(sellReceipt.meta.fee) >= 1n);
  },
);
