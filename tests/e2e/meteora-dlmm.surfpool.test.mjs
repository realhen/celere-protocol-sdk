import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { meteoraDlmmFixture } from "../fixtures/meteora-dlmm.mjs";

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
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname),
    "Native tests require loopback Surfpool",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    signal: globalThis.AbortSignal.timeout(60_000),
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
  "native DLMM settles multi-bin exact input/output in both directions",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 2_100_001n },
        { kind: "exactOut", amountOut: 2_100_001n },
      ]) {
        const fixture = await meteoraDlmmFixture(signer.address, {
          reverse,
          label: `native:${reverse}:${amount.kind}`,
        });
        await installFixture(fixture, signer);
        const build = value(await buildSwapInstructions({ ...fixture.request, amount }));
        const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
        const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
        const signature = await sendPlan(build, signer);
        const receipt = await rpc("getTransaction", [
          signature,
          { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]);
        assert.ok(receipt);
        assert.equal(receipt.meta.err, null);
        assert.equal(
          inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
          build.quote.expectedAmountIn,
        );
        assert.equal(
          (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
          build.quote.expectedAmountOut,
        );
        assert.equal(build.execution.mayPartiallyFill, false);
        assert.ok(
          receipt.meta.logMessages.some((line) =>
            line.includes(
              amount.kind === "exactIn"
                ? "Instruction: Swap2"
                : "Instruction: SwapExactOut2",
            ),
          ),
        );
      }
    }
  },
);

async function accountData(account) {
  return Buffer.from(
    (
      await rpc("getAccountInfo", [
        account,
        { encoding: "base64", commitment: "confirmed" },
      ])
    ).value.data[0],
    "base64",
  );
}
async function chainTimestamp() {
  return (await accountData(SYSVAR_CLOCK_ADDRESS)).readBigInt64LE(32);
}
function binTotal(data, offset) {
  let total = 0n;
  for (let i = 0; i < 70; i++)
    total += new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
      56 + i * 144 + offset,
      true,
    );
  return total;
}
async function executeAndCheck(fixture, signer, amount) {
  await installFixture(fixture, signer);
  const build = value(await buildSwapInstructions({ ...fixture.request, amount }));
  const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
  const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
  const signature = await sendPlan(build, signer);
  const receipt = await rpc("getTransaction", [
    signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
  assert.ok(receipt);
  assert.equal(receipt.meta.err, null);
  assert.equal(
    inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
    build.quote.expectedAmountIn,
  );
  assert.equal(
    (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
    build.quote.expectedAmountOut,
  );
  const inputOffset = fixture.request.inputMint === fixture.mintX ? 0 : 8;
  let before = 0n,
    after = 0n;
  for (const array of fixture.arrays) {
    before += binTotal(fixture.request.snapshot.accounts[array].data, inputOffset);
    after += binTotal(await accountData(array), inputOffset);
  }
  assert.equal(
    build.quote.expectedAmountIn - (after - before),
    build.quote.fees[0].amount,
    "Quote fee must equal user debit minus aggregate bin input liquidity increase",
  );
  assert.equal(build.execution.mayPartiallyFill, false);
  return build;
}

test(
  "native DLMM matches chain timestamp dynamic fees before filter, during decay, and after decay",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const feePhase of ["filter", "decay", "decayed"]) {
      for (const reverse of [false, true]) {
        for (const amount of [
          { kind: "exactIn", amountIn: 2_100_001n },
          { kind: "exactOut", amountOut: 2_100_001n },
        ]) {
          const fixture = await meteoraDlmmFixture(signer.address, {
            reverse,
            dynamic: true,
            feePhase,
            unixTimestamp: await chainTimestamp(),
            label: `dynamic:${feePhase}:${reverse}:${amount.kind}`,
          });
          await executeAndCheck(fixture, signer, amount);
        }
      }
    }
  },
);

test(
  "native DLMM traverses positive and negative bitmap extension boundaries",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const [activeId, reverse] of [
      [35840, false],
      [-35841, true],
    ]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 60_001n },
        { kind: "exactOut", amountOut: 2_100_001n },
      ]) {
        const fixture = await meteoraDlmmFixture(signer.address, {
          activeId,
          reverse,
          binStep: 1,
          bitmapExtension: true,
          unixTimestamp: await chainTimestamp(),
          label: `bitmap:${activeId}:${amount.kind}`,
        });
        const build = await executeAndCheck(fixture, signer, amount);
        assert.equal(build.swapInstructions[0].accounts[1].address, fixture.bitmap);
        assert.ok(
          build.swapInstructions[0].accounts.length >= 18,
          "Swap must span multiple bin arrays across bitmap boundary",
        );
      }
    }
  },
);

test(
  "native DLMM rejects stale fees and exhausted bins atomically in both native modes",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 2_100_001n },
        { kind: "exactOut", amountOut: 2_100_001n },
      ]) {
        for (const change of ["fee", "bins"]) {
          const fixture = await meteoraDlmmFixture(signer.address, {
            reverse,
            unixTimestamp: await chainTimestamp(),
            label: `adverse:${reverse}:${amount.kind}:${change}`,
            bitmapExtension: true,
          });
          const build = value(
            await buildSwapInstructions({ ...fixture.request, amount }),
          );
          if (change === "fee")
            fixture.request.snapshot.accounts[fixture.pool].data[34] = 1;
          else {
            fixture.request.snapshot.accounts[fixture.pool].data[648] &= ~2;
            for (const array of fixture.arrays) {
              const view = new DataView(
                fixture.request.snapshot.accounts[array].data.buffer,
              );
              for (let i = 0; i < 70; i++)
                view.setBigUint64(
                  56 + i * 144 + (reverse ? 0 : 8),
                  i === 0 || i === 69 ? 1000n : 0n,
                  true,
                );
            }
          }
          await installFixture(fixture, signer);
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
          const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          await assert.rejects(
            () => sendPlan(build, signer),
            (error) => {
              const failure = JSON.parse(error.message.slice("sendTransaction: ".length));
              const custom = failure.data.err.InstructionError[1].Custom;
              assert.equal(
                custom,
                change === "fee" ? (amount.kind === "exactIn" ? 6003 : 6104) : 6037,
              );
              return true;
            },
          );
          assert.equal(
            await tokenAmount(fixture.request.tokenAccounts.input),
            inputBefore,
          );
          assert.equal(
            await tokenAmount(fixture.request.tokenAccounts.output),
            outputBefore,
          );
        }
      }
    }
  },
);
