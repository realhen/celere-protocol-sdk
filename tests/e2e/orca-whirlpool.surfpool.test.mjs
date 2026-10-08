import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
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
import { orcaWhirlpoolFixture } from "../fixtures/orca-whirlpool.mjs";

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
async function tokenAmount(account) {
  return BigInt(
    (await rpc("getTokenAccountBalance", [account, { commitment: "confirmed" }])).value
      .amount,
  );
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
    if (account === null) continue;
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
      computeBudget: { units: 400000 },
    }),
  );
  const signed = await signTransaction([signer.keyPair], compiled.transaction);
  return rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
}

test(
  "native Orca swap-v2 executes both directions and amount modes with static fees",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const clock = (
          await rpc("getAccountInfo", [SYSVAR_CLOCK_ADDRESS, { encoding: "base64" }])
        ).value;
        const timestamp = Buffer.from(clock.data[0], "base64").readBigInt64LE(32);
        const fixture = await orcaWhirlpoolFixture(signer.address, {
          reverse,
          timestamp,
          label: `${signer.address}:${reverse}:${amount.kind}`,
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
        assert.ok(receipt, "Native program receipt is required");
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
          receipt.meta.logMessages.some((line) => line.includes("Instruction: SwapV2")),
        );
        assert.equal(build.execution.mayPartiallyFill, amount.kind === "exactIn");
      }
  },
);
