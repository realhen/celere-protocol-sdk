import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;

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

async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function installFixture(fixture, signer) {
  await rpc("surfnet_setAccount", [
    signer.address,
    {
      lamports: 10_000_000_000,
      owner: SYSTEM_PROGRAM_ADDRESS,
      executable: false,
      data: "",
    },
  ]);
  for (const account of Object.values(fixture.request.snapshot.accounts)) {
    await rpc("surfnet_setAccount", [
      account.address,
      {
        lamports: Number(account.lamports),
        owner: account.owner,
        executable: false,
        data: Buffer.from(account.data).toString("hex"),
      },
    ]);
  }
}

async function tokenAmount(account) {
  return BigInt(
    (await rpc("getTokenAccountBalance", [account, { commitment: "confirmed" }])).value
      .amount,
  );
}

async function sendPlan(build, signer) {
  const latest = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const compiled = value(
    compileTransaction({
      instructions: build.instructions,
      feePayer: signer.address,
      lifetime: {
        blockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
      },
    }),
  );
  const signed = await signTransaction([signer.keyPair], compiled.transaction);
  return rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
}

test(
  "native CPMM program executes exact-input and exact-output quotes across creator-fee modes",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const { creatorFeeOn, creatorFeeEnabled } of [
        { creatorFeeOn: 0, creatorFeeEnabled: false },
        { creatorFeeOn: 0, creatorFeeEnabled: true },
        { creatorFeeOn: 1, creatorFeeEnabled: true },
        { creatorFeeOn: 2, creatorFeeEnabled: true },
      ]) {
        for (const amount of [
          { kind: "exactIn", amountIn: 1_000_001n },
          { kind: "exactOut", amountOut: 1_000_001n },
        ]) {
          const fixture = await raydiumCpmmFixture(signer.address, {
            reverse,
            creatorFeeOn,
            creatorFeeEnabled,
            label: `${reverse}:${creatorFeeOn}:${creatorFeeEnabled}:${amount.kind}`,
          });
          await installFixture(fixture, signer);
          const build = value(
            await buildSwapInstructions({ ...fixture.request, amount, slippageBps: 0 }),
          );
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
          const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          const signature = await sendPlan(build, signer);
          const receipt = await rpc("getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          assert.ok(receipt, "Native program transaction receipt is required");
          assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
          assert.equal(
            inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
            build.quote.expectedAmountIn,
          );
          assert.equal(
            (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
            build.quote.expectedAmountOut,
          );
          assert.ok(
            receipt.meta.logMessages.some((line) =>
              line.includes("Instruction: SwapBase"),
            ),
            "Native Raydium swap must execute",
          );
          const state = Buffer.from(
            (
              await rpc("getAccountInfo", [
                fixture.pool,
                { encoding: "base64", commitment: "confirmed" },
              ])
            ).value.data[0],
            "base64",
          );
          const trade = build.quote.fees.find((fee) => fee.kind === "trade").amount;
          const creator = build.quote.fees.find((fee) => fee.kind === "creator");
          const creatorIsToken0 = creator?.mint === fixture.mint0;
          assert.equal(
            state.readBigUInt64LE(reverse ? 349 : 341),
            (reverse ? 200_000n : 100_000n) + (trade * 120_000n) / 1_000_000n,
          );
          assert.equal(
            state.readBigUInt64LE(reverse ? 365 : 357),
            (reverse ? 400_000n : 300_000n) + (trade * 40_000n) / 1_000_000n,
          );
          if (creator)
            assert.equal(
              state.readBigUInt64LE(creatorIsToken0 ? 397 : 405),
              (creatorIsToken0 ? 500_000n : 600_000n) + creator.amount,
            );
        }
      }
    }
  },
);

test(
  "native CPMM program rejects a stale build when encoded slippage limits are exceeded",
  { skip: !endpoint, timeout: 60_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const amount of [
      { kind: "exactIn", amountIn: 1_000_001n },
      { kind: "exactOut", amountOut: 1_000_001n },
    ]) {
      const fixture = await raydiumCpmmFixture(signer.address, {
        label: `slippage:${amount.kind}`,
      });
      const build = value(
        await buildSwapInstructions({ ...fixture.request, amount, slippageBps: 0 }),
      );
      const outputVault = fixture.request.snapshot.accounts[fixture.vault1];
      new DataView(outputVault.data.buffer).setBigUint64(64, 1_001_200_000n, true);
      await installFixture(fixture, signer);
      await assert.rejects(
        () => sendPlan(build, signer),
        /ExceededSlippage|0x1774|custom program error: 0x1774/,
        "The actual native program must reject an adverse reserve movement",
      );
    }
  },
);
