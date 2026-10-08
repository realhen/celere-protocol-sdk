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
import { meteoraDammV2Fixture, putU128 } from "../fixtures/meteora-damm-v2.mjs";

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
  "native Meteora swap2 settles exact-input/output quotes and fees in both directions and token programs",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const collectFeeMode of [0, 1]) {
        for (const token2022 of [false, true]) {
          for (const amount of [
            { kind: "exactIn", amountIn: 1_000_001n },
            { kind: "exactOut", amountOut: 1_000_001n },
          ]) {
            const fixture = await meteoraDammV2Fixture(signer.address, {
              reverse,
              collectFeeMode,
              token2022,
              linearFee: token2022,
              label: `${reverse}:${collectFeeMode}:${token2022}:${amount.kind}`,
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
            assert.equal(build.execution.mayPartiallyFill, false);
            assert.ok(
              receipt.meta.logMessages.some((line) =>
                line.includes("Instruction: Swap2"),
              ),
              "Native Meteora swap2 must execute",
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
            const fee = build.quote.fees[0];
            const feeA = fee.mint === fixture.mintA;
            assert.equal(
              state.readBigUInt64LE(feeA ? 392 : 400),
              (feeA ? 100_000n : 200_000n) + (fee.amount * 20n) / 100n,
            );
          }
        }
      }
    }
  },
);

test(
  "native Meteora rejects stale slippage and full-fill liquidity-range violations",
  { skip: !endpoint, timeout: 90_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        for (const change of ["price", "range"]) {
          const fixture = await meteoraDammV2Fixture(signer.address, {
            reverse,
            label: `adverse:${reverse}:${amount.kind}:${change}`,
          });
          const build = value(
            await buildSwapInstructions({ ...fixture.request, amount, slippageBps: 0 }),
          );
          const data = fixture.request.snapshot.accounts[fixture.pool].data;
          const price = 1n << 64n;
          if (change === "price")
            putU128(data, 456, (price * (reverse ? 11n : 9n)) / 10n);
          else putU128(data, reverse ? 440 : 424, price + (reverse ? 1n : -1n));
          await installFixture(fixture, signer);
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
          const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          await assert.rejects(
            () => sendPlan(build, signer),
            change === "price" ? /ExceededSlippage|0x1772/ : /PriceRangeViolation|0x177f/,
            "Native program must reject adverse state rather than partially settle",
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

test(
  "native Meteora matches active linear fees for caller-supplied slot and timestamp context",
  { skip: !endpoint, timeout: 90_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const activationType of [0, 1]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const clock = Buffer.from(
          (await rpc("getAccountInfo", [SYSVAR_CLOCK_ADDRESS, { encoding: "base64" }]))
            .value.data[0],
          "base64",
        );
        const slot = clock.readBigUInt64LE(0);
        const unixTimestamp = clock.readBigInt64LE(32);
        const currentPoint = activationType === 0 ? slot : unixTimestamp;
        const periodFrequency = activationType === 0 ? 100_000n : 3_600n;
        const fixture = await meteoraDammV2Fixture(signer.address, {
          collectFeeMode: 1,
          reverse: activationType === 1,
          linearFee: true,
          label: `active-linear:${activationType}:${amount.kind}`,
        });
        const poolData = fixture.request.snapshot.accounts[fixture.pool].data;
        const view = new DataView(poolData.buffer);
        view.setBigUint64(24, periodFrequency, true);
        view.setBigUint64(
          472,
          currentPoint - periodFrequency * 2n - periodFrequency / 2n,
          true,
        );
        poolData[480] = activationType;
        const request = {
          ...fixture.request,
          amount,
          slippageBps: 0,
          snapshot: { ...fixture.request.snapshot, slot, unixTimestamp },
        };
        const build = value(await buildSwapInstructions(request));
        const fees = build.quote.fees[0];
        if (activationType === 1 && amount.kind === "exactIn") {
          assert.equal(
            fees.amount,
            2_801n,
            "Active period 2 must apply 0.28%, before the terminal 0.20% fee",
          );
        }
        await installFixture(fixture, signer);
        const inputBefore = await tokenAmount(request.tokenAccounts.input);
        const outputBefore = await tokenAmount(request.tokenAccounts.output);
        const signature = await sendPlan(build, signer);
        const receipt = await rpc("getTransaction", [
          signature,
          { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]);
        assert.ok(receipt);
        assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
        assert.equal(
          inputBefore - (await tokenAmount(request.tokenAccounts.input)),
          build.quote.expectedAmountIn,
        );
        assert.equal(
          (await tokenAmount(request.tokenAccounts.output)) - outputBefore,
          build.quote.expectedAmountOut,
        );
        const state = Buffer.from(
          (await rpc("getAccountInfo", [fixture.pool, { encoding: "base64" }])).value
            .data[0],
          "base64",
        );
        assert.equal(state.readBigUInt64LE(400), 200_000n + (fees.amount * 20n) / 100n);
      }
    }
  },
);
