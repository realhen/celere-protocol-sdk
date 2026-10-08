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
import { raydiumAmmV4Fixture, AMM_V4_PROGRAM } from "../fixtures/raydium-amm-v4.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native AMM v4 tests only accept loopback simulators");
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
async function install(fixture, signer) {
  await rpc("surfnet_setAccount", [
    signer.address,
    {
      lamports: 10_000_000_000,
      owner: SYSTEM_PROGRAM_ADDRESS,
      executable: false,
      data: "",
    },
  ]);
  for (const account of Object.values(fixture.request.snapshot.accounts))
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
async function tokenAmount(key) {
  return BigInt(
    (await rpc("getTokenAccountBalance", [key, { commitment: "confirmed" }])).value
      .amount,
  );
}
async function send(build, signer) {
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
  "native AMM v4 executes both directions and native amount modes with rounded fees and pending PnL",
  { skip: !endpoint, timeout: 180_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const status of [6n, 7n]) {
        for (const feeNumerator of [0n, 25n, 37n]) {
          for (const amount of [
            { kind: "exactIn", amountIn: 1_000_001n },
            { kind: "exactOut", amountOut: 1_000_001n },
          ]) {
            const fixture = await raydiumAmmV4Fixture(signer.address, {
              reverse,
              status,
              feeNumerator,
              label: `native:${reverse}:${status}:${feeNumerator}:${amount.kind}`,
            });
            await install(fixture, signer);
            const build = value(
              await buildSwapInstructions({
                ...fixture.request,
                amount,
                slippageBps: 0,
              }),
            );
            const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input);
            const outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
            const vaultInBefore = await tokenAmount(
              reverse ? fixture.vault1 : fixture.vault0,
            );
            const vaultOutBefore = await tokenAmount(
              reverse ? fixture.vault0 : fixture.vault1,
            );
            const signature = await send(build, signer);
            const receipt = await rpc("getTransaction", [
              signature,
              { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
            ]);
            assert.ok(receipt, "A real native transaction receipt is required");
            assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
            assert.ok(
              receipt.meta.logMessages.some((line) =>
                line.includes(`Program ${AMM_V4_PROGRAM} invoke`),
              ),
            );
            assert.ok(receipt.meta.logMessages.some((line) => line.includes("ray_log:")));
            const debit =
              inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input));
            const credit =
              (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore;
            assert.equal(debit, build.quote.expectedAmountIn);
            assert.equal(credit, build.quote.expectedAmountOut);
            assert.equal(
              (await tokenAmount(reverse ? fixture.vault1 : fixture.vault0)) -
                vaultInBefore,
              debit,
            );
            assert.equal(
              vaultOutBefore -
                (await tokenAmount(reverse ? fixture.vault0 : fixture.vault1)),
              credit,
            );
            const reserveIn = reverse ? 2_000_000_000n : 1_000_000_000n;
            const reserveOut = reverse ? 1_000_000_000n : 2_000_000_000n;
            const expectedFee =
              amount.kind === "exactIn"
                ? (debit * feeNumerator + 9_999n) / 10_000n
                : debit -
                  (reserveIn * credit + reserveOut - credit - 1n) / (reserveOut - credit);
            assert.equal(build.quote.fees[0].amount, expectedFee);
            const pool = Buffer.from(
              (
                await rpc("getAccountInfo", [
                  fixture.pool,
                  { encoding: "base64", commitment: "confirmed" },
                ])
              ).value.data[0],
              "base64",
            );
            assert.equal(pool.readBigUInt64LE(192), 900_000n);
            assert.equal(pool.readBigUInt64LE(200), 1_200_000n);
            assert.equal(pool.readBigUInt64LE(0), 6n);
            context.diagnostic(
              `${reverse ? "1->0" : "0->1"} ${amount.kind} status=${status} fee=${feeNumerator}/10000 debit=${debit} credit=${credit} signature=${signature}`,
            );
          }
        }
      }
    }
  },
);

test(
  "native AMM v4 enforces stale slippage bounds and rejects output at the reserve boundary",
  { skip: !endpoint, timeout: 90_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const fixture = await raydiumAmmV4Fixture(signer.address, {
          reverse,
          label: `adverse:${reverse}:${amount.kind}`,
        });
        const build = value(
          await buildSwapInstructions({ ...fixture.request, amount, slippageBps: 0 }),
        );
        const outputVault =
          fixture.request.snapshot.accounts[reverse ? fixture.vault0 : fixture.vault1];
        new DataView(outputVault.data.buffer).setBigUint64(
          64,
          reverse ? 500_900_000n : 1_001_200_000n,
          true,
        );
        await install(fixture, signer);
        await assert.rejects(
          () => send(build, signer),
          /ExceededSlippage|custom program error: 0x1e|"Custom":30/,
        );
        const boundaryFixture = await raydiumAmmV4Fixture(signer.address, {
          reverse,
          label: `boundary:${reverse}:${amount.kind}`,
        });
        const boundary = await buildSwapInstructions({
          ...boundaryFixture.request,
          amount: {
            kind: "exactOut",
            amountOut: reverse ? 1_000_000_000n : 2_000_000_000n,
          },
        });
        assert.equal(boundary.ok, false);
        assert.equal(boundary.error.code, "INSUFFICIENT_LIQUIDITY");
        const noLiquidityBuild = value(
          await buildSwapInstructions({
            ...boundaryFixture.request,
            amount,
            slippageBps: 0,
          }),
        );
        const depleted =
          boundaryFixture.request.snapshot.accounts[
            reverse ? boundaryFixture.vault0 : boundaryFixture.vault1
          ];
        new DataView(depleted.data.buffer).setBigUint64(
          64,
          reverse ? 900_000n : 1_200_000n,
          true,
        );
        await install(boundaryFixture, signer);
        await assert.rejects(
          () => send(noLiquidityBuild, signer),
          /custom program error|Program failed to complete|panicked/,
        );
      }
    }
  },
);
