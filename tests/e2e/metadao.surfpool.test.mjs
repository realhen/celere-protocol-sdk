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
import { compileTransaction, buildSwapInstructions } from "../../dist/index.js";
import { metadaoFixture, METADAO_PROGRAM } from "../fixtures/metadao.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native MetaDAO tests only accept loopback simulators");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  return result.value;
}
async function rpc(method, params = []) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: globalThis.AbortSignal.timeout(90_000),
  });
  const body = await r.json();
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
  for (const a of Object.values(fixture.request.snapshot.accounts))
    await rpc("surfnet_setAccount", [
      a.address,
      {
        lamports: Number(a.lamports),
        owner: a.owner,
        executable: false,
        data: Buffer.from(a.data).toString("hex"),
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
async function poolData(fixture) {
  return Buffer.from(
    (
      await rpc("getAccountInfo", [
        fixture.pool,
        { encoding: "base64", commitment: "confirmed" },
      ])
    ).value.data[0],
    "base64",
  );
}

test(
  "native MetaDAO public builds match balances, reserves and rounded input protocol fees",
  { skip: !endpoint, timeout: 420_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    const cases = [];
    for (const reverse of [false, true]) {
      for (const amountIn of [
        reverse ? 4n : 2n,
        199n,
        200n,
        201n,
        999n,
        1000n,
        1001n,
        1_000_001n,
        123_456_789n,
        9_007_199_254_740_993n,
      ])
        cases.push({ reverse, amountIn });
      cases.push({ reverse, amountIn: 19n, baseReserves: 31n, quoteReserves: 17n });
    }
    for (const [index, parameters] of cases.entries()) {
      const { reverse, amountIn } = parameters;
      const f = await metadaoFixture(signer.address, {
        ...parameters,
        inputBalance: amountIn + 1_000_000n,
        label: `native:${index}`,
      });
      const build = value(
        await buildSwapInstructions({
          ...f.request,
          amount: { kind: "exactIn", amountIn },
          slippageBps: 0,
        }),
      );
      const initialData = f.request.snapshot.accounts[f.pool].data;
      const initialView = new DataView(initialData.buffer);
      const baseBefore = initialView.getBigUint64(117, true);
      const quoteBefore = initialView.getBigUint64(109, true);
      await install(f, signer);
      const beforeIn = await tokenAmount(f.request.tokenAccounts.input);
      const beforeOut = await tokenAmount(f.request.tokenAccounts.output);
      const vaultBaseBefore = await tokenAmount(f.baseVault);
      const vaultQuoteBefore = await tokenAmount(f.quoteVault);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.ok(receipt);
      assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
      assert.ok(
        receipt.meta.logMessages.some((line) =>
          line.includes(`Program ${METADAO_PROGRAM} invoke`),
        ),
      );
      const debit = beforeIn - (await tokenAmount(f.request.tokenAccounts.input));
      const credit = (await tokenAmount(f.request.tokenAccounts.output)) - beforeOut;
      assert.equal(debit, amountIn);
      assert.equal(credit, build.quote.expectedAmountOut);
      assert.equal(
        (await tokenAmount(f.baseVault)) - vaultBaseBefore,
        reverse ? debit : -credit,
      );
      assert.equal(
        (await tokenAmount(f.quoteVault)) - vaultQuoteBefore,
        reverse ? -credit : debit,
      );
      const state = await poolData(f);
      const baseFee = state.readBigUInt64LE(133) - 9_000n;
      const quoteFee = state.readBigUInt64LE(125) - 7_000n;
      const fee = build.quote.fees[0].amount;
      assert.equal(baseFee, reverse ? fee : 0n);
      assert.equal(quoteFee, reverse ? 0n : fee);
      assert.equal(
        state.readBigUInt64LE(117),
        reverse ? baseBefore + debit - fee : baseBefore - credit,
      );
      assert.equal(
        state.readBigUInt64LE(109),
        reverse ? quoteBefore - credit : quoteBefore + debit - fee,
      );
      assert.equal(build.execution.mayPartiallyFill, false);
      context.diagnostic(
        `${reverse ? "sell" : "buy"} input=${debit} output=${credit} protocolFee=${fee} signature=${signature}`,
      );
    }
  },
);

test(
  "native MetaDAO adverse minimum outputs and reserve exhaustion roll back without partial debits",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const exhausted of [false, true]) {
        const f = await metadaoFixture(signer.address, {
          reverse,
          label: `rejection:${reverse}:${exhausted}`,
        });
        const build = value(
          await buildSwapInstructions({ ...f.request, slippageBps: 0 }),
        );
        const reserve = exhausted ? 0n : reverse ? 500_000_000n : 1_000_000_000n;
        new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigUint64(
          reverse ? 109 : 117,
          reserve,
          true,
        );
        new DataView(
          f.request.snapshot.accounts[reverse ? f.quoteVault : f.baseVault].data.buffer,
        ).setBigUint64(64, reserve + (reverse ? 7_000n : 9_000n), true);
        await install(f, signer);
        const inputBefore = await tokenAmount(f.request.tokenAccounts.input);
        const outputBefore = await tokenAmount(f.request.tokenAccounts.output);
        const stateBefore = await poolData(f);
        await assert.rejects(
          () => send(build, signer),
          exhausted
            ? /RequireNeqViolated|"Custom":2503/
            : /RequireGteViolated|"Custom":2506/,
        );
        assert.equal(await tokenAmount(f.request.tokenAccounts.input), inputBefore);
        assert.equal(await tokenAmount(f.request.tokenAccounts.output), outputBefore);
        assert.deepEqual(await poolData(f), stateBefore);
        if (exhausted) {
          const offline = await buildSwapInstructions(f.request);
          assert.equal(offline.ok, false);
          assert.equal(offline.error.code, "INSUFFICIENT_LIQUIDITY");
        }
      }
  },
);
