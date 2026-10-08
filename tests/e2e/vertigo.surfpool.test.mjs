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
import { vertigoFixture, VERTIGO_PROGRAM } from "../fixtures/vertigo.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Vertigo tests only accept loopback simulators");
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
  "native Vertigo exact-input swaps match quotes, vaults and separate fee accumulators",
  { skip: !endpoint, timeout: 420_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    const cases = [];
    for (const reverse of [false, true])
      for (const royaltiesBps of [0, 25, 137])
        for (const shift of [1n, 300_000_000n])
          for (const amountIn of [1_000_001n, 123_456_789n])
            cases.push({ reverse, royaltiesBps, shift, amountIn });
    for (const reverse of [false, true])
      for (const amountIn of [reverse ? 3n : 1n, 333n, 334n, 1999n, 2000n, 2001n])
        cases.push({ reverse, royaltiesBps: 25, shift: 300_000_000n, amountIn });
    cases.push({
      reverse: false,
      royaltiesBps: 137,
      shift: 300_000_000n,
      amountIn: 9_007_199_254_740_993n,
    });
    for (const [index, parameters] of cases.entries()) {
      const { reverse, amountIn, royaltiesBps } = parameters;
      const f = await vertigoFixture(signer.address, {
        ...parameters,
        label: `native:${index}`,
      });
      const userBalance =
        amountIn > 3_000_000_000n ? amountIn + 1_000_000n : 3_000_000_000n;
      new DataView(
        f.request.snapshot.accounts[f.request.tokenAccounts.input].data.buffer,
      ).setBigUint64(64, userBalance, true);
      const request = {
        ...f.request,
        amount: { kind: "exactIn", amountIn },
        slippageBps: 0,
      };
      const build = value(await buildSwapInstructions(request));
      await install(f, signer);
      const beforeIn = await tokenAmount(f.request.tokenAccounts.input);
      const beforeOut = await tokenAmount(f.request.tokenAccounts.output);
      const vaultABefore = await tokenAmount(f.vaultA);
      const vaultBBefore = await tokenAmount(f.vaultB);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.ok(receipt);
      assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
      assert.ok(
        receipt.meta.logMessages.some((line) =>
          line.includes(`Program ${VERTIGO_PROGRAM} invoke`),
        ),
      );
      const debit = beforeIn - (await tokenAmount(f.request.tokenAccounts.input));
      const credit = (await tokenAmount(f.request.tokenAccounts.output)) - beforeOut;
      assert.equal(debit, amountIn);
      assert.equal(credit, build.quote.expectedAmountOut);
      assert.equal(
        (await tokenAmount(f.vaultA)) - vaultABefore,
        reverse ? -credit : debit,
      );
      assert.equal(
        (await tokenAmount(f.vaultB)) - vaultBBefore,
        reverse ? debit : -credit,
      );
      const state = await poolData(f);
      const actualRoyalty = state.readBigUInt64LE(153) - 9_000n;
      const actualTradeFee = state.readBigUInt64LE(161) - 3_000n;
      assert.equal(
        actualRoyalty,
        build.quote.fees.find((fee) => fee.kind === "creator").amount,
      );
      assert.equal(
        actualTradeFee,
        build.quote.fees.find((fee) => fee.kind === "trade").amount,
      );
      const quoteMovement = reverse
        ? 1_000_000_000n - state.readBigUInt64LE(105)
        : state.readBigUInt64LE(105) - 1_000_000_000n;
      assert.equal(
        quoteMovement,
        reverse
          ? credit + actualRoyalty + actualTradeFee
          : debit - actualRoyalty - actualTradeFee,
      );
      assert.equal(
        state.readBigUInt64LE(121),
        reverse ? 2_000_000_000n + debit : 2_000_000_000n - credit,
      );
      context.diagnostic(
        `${reverse ? "sell" : "buy"} royalty=${royaltiesBps} shift=${parameters.shift} input=${debit} output=${credit} royaltyFee=${actualRoyalty} protocolFee=${actualTradeFee} signature=${signature}`,
      );
    }
  },
);

test(
  "native Vertigo rejects adverse minimum outputs and exhausted real reserves without partial debits",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const exhausted of [false, true]) {
        const f = await vertigoFixture(signer.address, {
          reverse,
          label: `rejection:${reverse}:${exhausted}`,
        });
        const build = value(
          await buildSwapInstructions({ ...f.request, slippageBps: 0 }),
        );
        const reserve = exhausted ? 0n : reverse ? 500_000_000n : 1_000_000_000n;
        const pool = f.request.snapshot.accounts[f.pool].data;
        new DataView(pool.buffer).setBigUint64(reverse ? 105 : 121, reserve, true);
        const vault = f.request.snapshot.accounts[reverse ? f.vaultA : f.vaultB].data;
        new DataView(vault.buffer).setBigUint64(
          64,
          reserve + (reverse ? 12_000n : 0n),
          true,
        );
        await install(f, signer);
        const beforeIn = await tokenAmount(f.request.tokenAccounts.input);
        const beforeOut = await tokenAmount(f.request.tokenAccounts.output);
        await assert.rejects(
          () => send(build, signer),
          /InsufficientOutput|PoolEmpty|InsufficientFunds|MathOverflow|"Custom":60/,
        );
        assert.equal(await tokenAmount(f.request.tokenAccounts.input), beforeIn);
        assert.equal(await tokenAmount(f.request.tokenAccounts.output), beforeOut);
        const offline = await buildSwapInstructions({ ...f.request, slippageBps: 0 });
        if (exhausted) {
          assert.equal(offline.ok, false);
          assert.equal(offline.error.code, "INSUFFICIENT_LIQUIDITY");
        }
      }
  },
);
