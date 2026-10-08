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
import { liquidAfFixture, LIQUID_AF_PROGRAM } from "../fixtures/liquid-af.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native LiquidAF tests only accept loopback simulators");
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
      instructions: [
        getSetComputeUnitLimitInstruction({ units: 600_000 }),
        ...build.instructions,
      ],
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

import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import * as raw from "../../dist/protocols/liquid-af/instructions/index.js";
async function clockTime() {
  const account = (
    await rpc("getAccountInfo", [SYSVAR_CLOCK_ADDRESS, { encoding: "base64" }])
  ).value;
  return Buffer.from(account.data[0], "base64").readBigInt64LE(32);
}
async function lamports(address) {
  return BigInt((await rpc("getBalance", [address])).value);
}

test(
  "native LiquidAF public swaps match atomic amounts, fee destinations and curve reserves",
  { skip: !endpoint, timeout: 420_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    const cases = [];
    for (const [reverse, exactOut] of [
      [false, false],
      [true, false],
      [true, true],
    ]) {
      for (const [creatorBps, protocolBps] of [
        [0, 0],
        [25, 50],
        [37, 137],
      ])
        for (const amount of [1_000_001n, 123_456_789n])
          cases.push({ reverse, exactOut, creatorBps, protocolBps, amount });
      for (const amount of [exactOut ? 1n : reverse ? 4n : 2n, 133n, 134n, 135n])
        cases.push({ reverse, exactOut, creatorBps: 25, protocolBps: 50, amount });
      cases.push({
        reverse,
        exactOut,
        creatorBps: 25,
        protocolBps: 50,
        amount: 1_000_001n,
        cashbackBps: 1000,
      });
    }
    for (const parameters of cases) {
      const { reverse, exactOut, amount } = parameters;
      const f = await liquidAfFixture(signer.address, {
        ...parameters,
        label: "native-matrix",
        unixTimestamp: await clockTime(),
      });
      const request = {
        ...f.request,
        amount: exactOut
          ? { kind: "exactOut", amountOut: amount }
          : { kind: "exactIn", amountIn: amount },
        slippageBps: 0,
      };
      const build = value(await buildSwapInstructions(request));
      await install(f, signer);
      const beforeToken = await tokenAmount(f.userToken),
        beforeSol = await lamports(signer.address);
      const beforeVault = await lamports(f.solVault),
        beforeCreator = await lamports(f.feeVault),
        beforeProtocol = await lamports(f.feeRecipient);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.ok(
        receipt.meta.logMessages.some((line) =>
          line.includes(`Program ${LIQUID_AF_PROGRAM} invoke`),
        ),
      );
      const tokenDelta = (await tokenAmount(f.userToken)) - beforeToken;
      const solDelta =
        (await lamports(signer.address)) - beforeSol + BigInt(receipt.meta.fee);
      const debit = reverse ? -tokenDelta : -solDelta,
        credit = reverse ? solDelta : tokenDelta;
      assert.equal(debit, build.quote.expectedAmountIn);
      assert.equal(credit, build.quote.expectedAmountOut);
      if (exactOut) assert.equal(credit, amount);
      const creatorFee = (await lamports(f.feeVault)) - beforeCreator,
        protocolFee = (await lamports(f.feeRecipient)) - beforeProtocol;
      assert.equal(
        creatorFee,
        build.quote.fees.find((fee) => fee.kind === "creator").amount,
      );
      assert.equal(
        protocolFee,
        build.quote.fees.find((fee) => fee.kind === "trade").amount,
      );
      const quoteMovement = reverse
        ? -(credit + creatorFee + protocolFee)
        : debit - creatorFee - protocolFee;
      assert.equal((await lamports(f.solVault)) - beforeVault, quoteMovement);
      assert.equal(
        (await tokenAmount(f.tokenVault)) - 2_000_000_000n,
        reverse ? debit : -credit,
      );
      const state = await poolData(f);
      assert.equal(
        state.readBigUInt64LE(73),
        2_000_000_000n + (reverse ? debit : -credit),
      );
      assert.equal(
        state.readBigUInt64LE(81),
        3_000_000_000n + (reverse ? debit : -credit),
      );
      assert.equal(state.readBigUInt64LE(89), 1_000_000_000n + quoteMovement);
      assert.equal(build.execution.mayPartiallyFill, !reverse);
      context.diagnostic(
        `${reverse ? "sell" : "buy"} ${exactOut ? "exactOut" : "exactIn"} input=${debit} output=${credit} creator=${creatorFee} protocol=${protocolFee} signature=${signature}`,
      );
    }
  },
);

test(
  "native LiquidAF graduation explicitly clips buys and cannot guarantee exact output",
  { skip: !endpoint, timeout: 180_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const exactOut of [false, true]) {
      const f = await liquidAfFixture(signer.address, {
        label: "graduation",
        unixTimestamp: await clockTime(),
      });
      new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigUint64(
        73,
        500_000n,
        true,
      );
      new DataView(f.request.snapshot.accounts[f.tokenVault].data.buffer).setBigUint64(
        64,
        500_000n,
        true,
      );
      const publicResult = await buildSwapInstructions({
        ...f.request,
        amount: exactOut ? { kind: "exactOut", amountOut: 1_000_001n } : f.request.amount,
      });
      if (exactOut) {
        assert.equal(publicResult.ok, false);
        assert.equal(publicResult.error.code, "UNSUPPORTED_SWAP_MODE");
      }
      const instructions = exactOut
        ? [
            raw.getLiquidAfBuyExactOutNativeInstruction(f.instructionAccounts, {
              amountOut: 1_000_001n,
              maximumAmountIn: 10_000_000n,
            }),
          ]
        : value(publicResult).instructions;
      await install(f, signer);
      const beforeToken = await tokenAmount(f.userToken),
        beforeSol = await lamports(signer.address);
      const signature = await send({ instructions }, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.equal((await tokenAmount(f.userToken)) - beforeToken, 500_000n);
      assert.equal(
        beforeSol - (await lamports(signer.address)) - BigInt(receipt.meta.fee),
        335_909n,
      );
      assert.equal((await poolData(f))[113], 1);
      if (!exactOut) {
        assert.equal(publicResult.value.quote.expectedAmountIn, 335_909n);
        assert.equal(publicResult.value.quote.expectedAmountOut, 500_000n);
      }
      context.diagnostic(
        `clipped raw ${exactOut ? "exactOut" : "exactIn"} input=335909 output=500000 signature=${signature}`,
      );
    }
  },
);

test(
  "native LiquidAF slippage and exhausted sell reserves fail atomically",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const [reverse, exactOut] of [
      [false, false],
      [true, false],
      [true, true],
    ])
      for (const exhausted of [false, true]) {
        if (!reverse && exhausted) continue;
        const f = await liquidAfFixture(signer.address, {
          reverse,
          label: "rejection",
          unixTimestamp: await clockTime(),
        });
        const request = {
          ...f.request,
          slippageBps: 0,
          amount: exactOut
            ? { kind: "exactOut", amountOut: 1_000_001n }
            : f.request.amount,
        };
        const build = value(await buildSwapInstructions(request));
        const view = new DataView(f.request.snapshot.accounts[f.pool].data.buffer);
        if (reverse) {
          view.setBigUint64(89, exhausted ? 100_000n : 500_000_000n, true);
          f.request.snapshot.accounts[f.solVault].lamports =
            (exhausted ? 100_000n : 500_000_000n) + 890_880n;
        } else view.setBigUint64(81, 2_500_000_000n, true);
        await install(f, signer);
        const beforeToken = await tokenAmount(f.userToken),
          beforeSol = await lamports(signer.address),
          beforeState = await poolData(f);
        await assert.rejects(
          () => send(build, signer),
          exhausted ? /InvalidAmount/ : /Slippage|slippage/,
        );
        assert.equal(await tokenAmount(f.userToken), beforeToken);
        assert.equal(await lamports(signer.address), beforeSol);
        assert.deepEqual(await poolData(f), beforeState);
      }
  },
);
