import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { raydiumClmmFixture } from "../fixtures/raydium-clmm.mjs";

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
    signal: globalThis.AbortSignal.timeout(60_000),
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
async function tokenAmount(address) {
  return BigInt(
    (await rpc("getTokenAccountBalance", [address, { commitment: "confirmed" }])).value
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
function put128(data, offset, amount) {
  const unsigned = BigInt.asUintN(128, amount);
  const view = new DataView(data.buffer);
  view.setBigUint64(offset, unsigned & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, unsigned >> 64n, true);
}

test(
  "native CLMM executes both modes and directions, including crossings through exhausted historical order cohorts",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const crossing of [false, true])
        for (const kind of ["exactIn", "exactOut"]) {
          const amount = crossing ? 50_000_001n : 1_000_001n;
          const fixture = await raydiumClmmFixture(signer.address, {
            reverse,
            label: `${signer.address}:${reverse}:${crossing}:${kind}`,
            historicalOrders: crossing,
          });
          await installFixture(fixture, signer);
          const build = value(
            await buildSwapInstructions({
              ...fixture.request,
              amount:
                kind === "exactIn"
                  ? { kind, amountIn: amount }
                  : { kind, amountOut: amount },
              slippageBps: 0,
            }),
          );
          assert.equal(build.execution.mayPartiallyFill, false);
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
          const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          const vaultInput = reverse ? fixture.vault1 : fixture.vault0;
          const vaultOutput = reverse ? fixture.vault0 : fixture.vault1;
          const vaultInputBefore = await tokenAmount(vaultInput);
          const vaultOutputBefore = await tokenAmount(vaultOutput);
          const signature = await sendPlan(build, signer);
          const receipt = await rpc("getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          assert.ok(receipt);
          assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
          assert.ok(
            receipt.meta.logMessages.some((line) => line.includes("Instruction: Swap")),
          );
          assert.equal(
            inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
            build.quote.expectedAmountIn,
          );
          assert.equal(
            (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
            build.quote.expectedAmountOut,
          );
          assert.equal(
            (await tokenAmount(vaultInput)) - vaultInputBefore,
            build.quote.expectedAmountIn,
          );
          assert.equal(
            vaultOutputBefore - (await tokenAmount(vaultOutput)),
            build.quote.expectedAmountOut,
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
          const fee = build.quote.fees[0].amount;
          const protocolFee = state.readBigUInt64LE(reverse ? 317 : 309);
          const fundFee = state.readBigUInt64LE(reverse ? 1072 : 1064);
          const perStepRounding = crossing ? 1n : 0n;
          assert.ok(
            protocolFee <= (fee * 120_000n) / 1_000_000n &&
              protocolFee >= (fee * 120_000n) / 1_000_000n - perStepRounding,
          );
          assert.ok(
            fundFee <= (fee * 40_000n) / 1_000_000n &&
              fundFee >= (fee * 40_000n) / 1_000_000n - perStepRounding,
          );
          assert.equal(
            state.readBigUInt64LE(237),
            crossing ? 10_000_000_000n : fixture.liquidity,
          );
          if (crossing)
            assert.ok(
              reverse ? state.readInt32LE(269) >= 30 : state.readInt32LE(269) < -30,
            );
        }
  },
);

test(
  "native CLMM rejects stale adverse-slippage builds in both modes and directions",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const kind of ["exactIn", "exactOut"]) {
        const fixture = await raydiumClmmFixture(signer.address, {
          reverse,
          label: `${signer.address}:slippage:${reverse}:${kind}`,
        });
        const build = value(
          await buildSwapInstructions({
            ...fixture.request,
            amount:
              kind === "exactIn"
                ? { kind, amountIn: 1_000_001n }
                : { kind, amountOut: 1_000_001n },
            slippageBps: 0,
          }),
        );
        put128(fixture.request.snapshot.accounts[fixture.pool].data, 237, 2_000_000_000n);
        await installFixture(fixture, signer);
        await assert.rejects(
          () => sendPlan(build, signer),
          /TooLittleOutputReceived|TooMuchInputPaid|0x1784|0x1785/,
        );
      }
  },
);

test(
  "native CLMM never returns a partial success when initialized ranges are exhausted",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const kind of ["exactIn", "exactOut"]) {
        const fixture = await raydiumClmmFixture(signer.address, {
          reverse,
          label: `${signer.address}:exhaust:${reverse}:${kind}`,
        });
        const build = value(
          await buildSwapInstructions({
            ...fixture.request,
            amount:
              kind === "exactIn"
                ? { kind, amountIn: 50_000_001n }
                : { kind, amountOut: 50_000_001n },
            slippageBps: 9999,
          }),
        );
        put128(fixture.request.snapshot.accounts[fixture.pool].data, 237, 200_000_000n);
        for (const { address } of fixture.tickArrays) {
          const data = fixture.request.snapshot.accounts[address].data;
          for (let index = 0; index < 60; index++) {
            const offset = 44 + index * 168;
            if (new DataView(data.buffer).getBigUint64(offset + 20, true) === 0n)
              continue;
            const tick = new DataView(data.buffer).getInt32(offset, true);
            put128(data, offset + 4, tick < 0 ? 100_000_000n : -100_000_000n);
            put128(data, offset + 20, 100_000_000n);
          }
        }
        await installFixture(fixture, signer);
        const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
        const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
        await assert.rejects(
          () => sendPlan(build, signer),
          /LiquidityInsufficient|NotEnoughTickArrayAccount|MissingTickArrayBitmapExtensionAccount/,
        );
        assert.equal(await tokenAmount(fixture.request.tokenAccounts.input), inputBefore);
        assert.equal(
          await tokenAmount(fixture.request.tokenAccounts.output),
          outputBefore,
        );
      }
  },
);

test(
  "native CLMM executes both extension bitmap directions and both native amount modes",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const [tickOffset, sqrtPrice] of [
      [-30840, 3947036234115134552n],
      [30840, 86212121383584052877n],
    ]) {
      for (const reverse of [false, true])
        for (const kind of ["exactIn", "exactOut"]) {
          const fixture = await raydiumClmmFixture(signer.address, {
            reverse,
            tickOffset,
            sqrtPrice,
            label: `${signer.address}:bitmap:${tickOffset}:${reverse}:${kind}`,
          });
          await installFixture(fixture, signer);
          const build = value(
            await buildSwapInstructions({
              ...fixture.request,
              slippageBps: 0,
              amount:
                kind === "exactIn"
                  ? { kind, amountIn: 1_000_001n }
                  : { kind, amountOut: 1_000_001n },
            }),
          );
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
          const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          const signature = await sendPlan(build, signer);
          const receipt = await rpc("getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          assert.ok(receipt);
          assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
          assert.equal(
            inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
            build.quote.expectedAmountIn,
          );
          assert.equal(
            (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
            build.quote.expectedAmountOut,
          );
        }
    }
  },
);
