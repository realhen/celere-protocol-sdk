import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { buy_exact_out } from "../../dist/protocols/liquid-af-amm/instructions/index.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { compileTransaction, buildSwapInstructions } from "../../dist/index.js";
import { liquidAfAmmFixture, LIQUID_AF_AMM_PROGRAM } from "../fixtures/liquid-af-amm.mjs";
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

async function clockTime() {
  const account = (
    await rpc("getAccountInfo", [SYSVAR_CLOCK_ADDRESS, { encoding: "base64" }])
  ).value;
  return Buffer.from(account.data[0], "base64").readBigInt64LE(32);
}
test(
  "native LiquidAF AMM public builds match balances and mode-specific fees",
  { skip: !endpoint, timeout: 420_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    const cases = [];
    for (const nativeQuote of [false, true])
      for (const reverse of [false, true])
        for (const exactOut of reverse ? [false, true] : [false]) {
          for (const [lpBps, protocolBps, creatorBps] of [
            [0, 0, 0],
            [25, 50, 25],
            [317, 29, 53],
            [1000, 1000, 2000],
          ])
            for (const amount of [201n, 999n, 1_000_001n, 123_456_789n])
              cases.push({
                nativeQuote,
                reverse,
                exactOut,
                lpBps,
                protocolBps,
                creatorBps,
                amount,
              });
          cases.push({
            nativeQuote,
            reverse,
            exactOut,
            amount: exactOut ? 1n : reverse ? 5n : 2n,
          });
          cases.push({
            nativeQuote,
            reverse,
            exactOut,
            amount: 1_000_001n,
            base2022: false,
            cashbackBps: 1000,
          });
        }
    for (const reverse of [true])
      cases.push({
        nativeQuote: false,
        reverse,
        exactOut: true,
        amount: reverse ? 500_000_000n : 1_000_000_000n,
        lpBps: 0,
        protocolBps: 0,
        creatorBps: 0,
      });
    for (const nativeQuote of [false, true])
      for (const reverse of [false, true])
        for (const boundary of [0n, 1n]) {
          const marketCap = nativeQuote ? 750_000_000n : 5_000_000_000n;
          cases.push({
            nativeQuote,
            reverse,
            exactOut: false,
            amount: 1_000_001n,
            feeTiers: [
              {
                start: 0n,
                end: marketCap + boundary,
                lpBps: 25,
                protocolBps: 50,
                creatorBps: 25,
              },
              {
                start: marketCap + boundary,
                end: (1n << 64n) - 1n,
                lpBps: 100,
                protocolBps: 200,
                creatorBps: 300,
              },
            ],
          });
        }
    const failures = [];
    for (const parameters of cases) {
      const { nativeQuote, reverse, exactOut, amount } = parameters;
      const f = await liquidAfAmmFixture(signer.address, {
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
      const inputBefore = await tokenAmount(f.request.tokenAccounts.input),
        outputBefore = await tokenAmount(f.request.tokenAccounts.output),
        baseBefore = await tokenAmount(f.baseVault),
        quoteBefore = await tokenAmount(f.quoteVault),
        creatorBefore = await tokenAmount(f.feeVaultTokenAccount),
        protocolBefore = await tokenAmount(f.protocolFeeVault);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.ok(
        receipt.meta.logMessages.some((line) =>
          line.includes(`Program ${LIQUID_AF_AMM_PROGRAM} invoke`),
        ),
      );
      const debit = inputBefore - (await tokenAmount(f.request.tokenAccounts.input)),
        credit = (await tokenAmount(f.request.tokenAccounts.output)) - outputBefore;
      const creatorFee = (await tokenAmount(f.feeVaultTokenAccount)) - creatorBefore,
        protocolFee = (await tokenAmount(f.protocolFeeVault)) - protocolBefore;
      const baseDelta = (await tokenAmount(f.baseVault)) - baseBefore,
        quoteDelta = (await tokenAmount(f.quoteVault)) - quoteBefore;
      const lpFee =
        reverse && !exactOut
          ? (debit * quoteBefore) / (baseBefore + debit) + quoteDelta
          : 0n;
      try {
        assert.equal(debit, build.quote.expectedAmountIn);
        assert.equal(credit, build.quote.expectedAmountOut);
        if (exactOut) assert.ok(credit >= amount);
        assert.equal(
          creatorFee,
          build.quote.fees.find((fee) => fee.kind === "creator").amount,
        );
        assert.equal(
          protocolFee + lpFee,
          build.quote.fees.find((fee) => fee.kind === "trade").amount,
        );
        assert.equal(baseDelta, reverse ? debit : -credit);
        assert.equal(
          quoteDelta,
          reverse
            ? -(credit + creatorFee + protocolFee)
            : debit - creatorFee - protocolFee,
        );
        assert.equal(build.execution.mayPartiallyFill, false);
      } catch (error) {
        failures.push(
          `${JSON.stringify(parameters, (_, value) => (typeof value === "bigint" ? value.toString() : value))}: ${error.message}`,
        );
      }
      context.diagnostic(
        `${nativeQuote ? "WSOL" : "USDC"} ${reverse ? "sell" : "buy"} ${exactOut ? "exactOut" : "exactIn"} input=${debit} output=${credit} lp=${lpFee} creator=${creatorFee} protocol=${protocolFee} signature=${signature}`,
      );
    }
    assert.deepEqual(failures, []);
  },
);
test(
  "native LiquidAF AMM adverse bounds and exhausted reserves fail without partial debits",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const exactOut of reverse ? [false, true] : [false])
        for (const exhausted of [false, true]) {
          const f = await liquidAfAmmFixture(signer.address, {
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
          const vault = f.request.snapshot.accounts[reverse ? f.quoteVault : f.baseVault];
          new DataView(vault.data.buffer).setBigUint64(
            64,
            exhausted ? 0n : reverse ? 500_000_000n : 1_000_000_000n,
            true,
          );
          await install(f, signer);
          const inputBefore = await tokenAmount(f.request.tokenAccounts.input),
            outputBefore = await tokenAmount(f.request.tokenAccounts.output),
            stateBefore = await poolData(f);
          await assert.rejects(
            () => send(build, signer),
            exhausted
              ? reverse
                ? /attempt to divide by zero/
                : /InvalidPoolState/
              : /Slippage|slippage/,
          );
          assert.equal(await tokenAmount(f.request.tokenAccounts.input), inputBefore);
          assert.equal(await tokenAmount(f.request.tokenAccounts.output), outputBefore);
          assert.deepEqual(await poolData(f), stateBefore);
          if (exhausted) {
            const offline = await buildSwapInstructions(request);
            assert.equal(offline.ok, false);
            assert.equal(offline.error.code, "INSUFFICIENT_LIQUIDITY");
          }
        }
  },
);

test(
  "native LiquidAF AMM buy exact-output can underfill and is rejected by the public SDK",
  { skip: !endpoint, timeout: 120_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const nativeQuote of [false, true]) {
      const f = await liquidAfAmmFixture(signer.address, {
        nativeQuote,
        label: "rounding-underfill",
        unixTimestamp: await clockTime(),
      });
      const amountOut = 123_456_789n;
      const result = await buildSwapInstructions({
        ...f.request,
        amount: { kind: "exactOut", amountOut },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "UNSUPPORTED_SWAP_MODE");
      const instruction = buy_exact_out(f.instructionAccounts, {
        amountOut,
        maximumAmountIn: 100_000_000n,
      });
      await install(f, signer);
      const before = await tokenAmount(f.userBase);
      const signature = await send({ instructions: [instruction] }, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.equal((await tokenAmount(f.userBase)) - before, amountOut - 1n);
      context.diagnostic(
        `Native BuyExactOut requested=${amountOut} actual=${amountOut - 1n} quote=${nativeQuote ? "WSOL" : "USDC"} signature=${signature}`,
      );
    }
  },
);
