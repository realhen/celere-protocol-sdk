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
import { moonshotFixture } from "../fixtures/moonshot.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Moonshot tests only accept loopback simulators");
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
      lamports: 1_000_000_000_000,
      owner: SYSTEM_PROGRAM_ADDRESS,
      executable: false,
      data: "",
    },
  ]);
  for (const account of Object.values(fixture.request.snapshot.accounts)) {
    if (!account) continue;
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

async function solAmount(key) {
  return BigInt((await rpc("getBalance", [key, { commitment: "confirmed" }])).value);
}
test(
  "native Moonshot fixed-side swaps match actual lamport and token deltas",
  { skip: !endpoint, timeout: 240_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const curveType of [1, 2])
      for (const feeBps of [0, 97, 100])
        for (const buy of [true, false])
          for (const kind of ["exactIn", "exactOut"]) {
            const fixture = await moonshotFixture(signer.address, {
              curveType,
              buy,
              feeBps,
              label: `${curveType}:${buy}:${kind}:${feeBps}`,
            });
            const amount =
              kind === "exactIn"
                ? fixture.request.amount
                : { kind, amountOut: buy ? 1_000_000_000_001n : 1_000_001n };
            const build = value(
              await buildSwapInstructions({ ...fixture.request, amount }),
            );
            await install(fixture, signer);
            const tokenBefore = await tokenAmount(fixture.user),
              solBefore = await solAmount(signer.address);
            const feeBefore =
              (await solAmount(fixture.dexFee)) + (await solAmount(fixture.helioFee));
            const signature = await send(build, signer);
            const receipt = await rpc("getTransaction", [
              signature,
              { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
            ]);
            assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
            const tokenDelta = (await tokenAmount(fixture.user)) - tokenBefore;
            const solDelta =
              (await solAmount(signer.address)) - solBefore + BigInt(receipt.meta.fee);
            context.diagnostic(
              JSON.stringify(
                {
                  curveType,
                  feeBps,
                  buy,
                  kind,
                  tokenDelta: String(tokenDelta),
                  solDelta: String(solDelta),
                  quote: build.quote,
                },
                (_, v) => (typeof v === "bigint" ? String(v) : v),
              ),
            );
            assert.equal(buy ? -solDelta : -tokenDelta, build.quote.expectedAmountIn);
            assert.equal(buy ? tokenDelta : solDelta, build.quote.expectedAmountOut);
            assert.equal(
              (await solAmount(fixture.dexFee)) +
                (await solAmount(fixture.helioFee)) -
                feeBefore,
              build.quote.fees[0].amount,
            );
          }
  },
);

async function assertUnchangedFailure(build, fixture, signer, pattern) {
  const tokenBefore = await tokenAmount(fixture.user),
    solBefore = await solAmount(signer.address);
  const poolBefore = (await rpc("getAccountInfo", [fixture.pool, { encoding: "base64" }]))
    .value;
  await assert.rejects(() => send(build, signer), pattern);
  assert.equal(await tokenAmount(fixture.user), tokenBefore);
  assert.equal(await solAmount(signer.address), solBefore);
  assert.deepEqual(
    (await rpc("getAccountInfo", [fixture.pool, { encoding: "base64" }])).value,
    poolBefore,
  );
}

test(
  "native Moonshot rejects stale slippage and completed curves atomically",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const curveType of [1, 2])
      for (const buy of [true, false])
        for (const kind of ["exactIn", "exactOut"]) {
          const label = `adverse:${curveType}:${buy}:${kind}`;
          const original = await moonshotFixture(signer.address, {
            curveType,
            buy,
            label,
          });
          const amount =
            kind === "exactIn"
              ? original.request.amount
              : { kind, amountOut: buy ? 1_000_000_000_001n : 1_000_001n };
          const build = value(
            await buildSwapInstructions({ ...original.request, amount }),
          );
          const adverse = await moonshotFixture(signer.address, {
            curveType,
            buy,
            label,
            position: buy ? 310_000_000_000_000_000n : 290_000_000_000_000_000n,
          });
          await install(adverse, signer);
          await assertUnchangedFailure(
            build,
            adverse,
            signer,
            /SlippageOverflow|custom program error: 0x1773|"Custom":6003/,
          );
          const complete = await moonshotFixture(signer.address, {
            curveType,
            buy,
            label,
            position:
              curveType === 1 ? 800_000_000_000_000_000n : 815_000_000_000_000_000n,
          });
          const rejected = await buildSwapInstructions({ ...complete.request, amount });
          assert.equal(rejected.ok, false);
          assert.equal(rejected.error.code, "INSUFFICIENT_LIQUIDITY");
          await install(complete, signer);
          await assertUnchangedFailure(
            build,
            complete,
            signer,
            /ThresholdReached|CurveLimit|InvalidTokenAccount|custom program error/,
          );
        }
  },
);

test(
  "native Moonshot fixed-side buys cross graduation fully and reject allocation exhaustion",
  { skip: !endpoint, timeout: 240_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const curveType of [1, 2]) {
      const threshold = curveType === 1 ? 799820983207404442n : 814207069725281919n;
      for (const kind of ["exactIn", "exactOut"]) {
        const position = threshold - 1_000_000_000_000n;
        const fixture = await moonshotFixture(signer.address, {
          curveType,
          label: `cross:${curveType}:${kind}`,
          position,
        });
        const amount =
          kind === "exactIn"
            ? { kind, amountIn: 1_000_001n }
            : { kind, amountOut: 2_000_000_000_000n };
        const build = value(await buildSwapInstructions({ ...fixture.request, amount }));
        assert.equal(build.execution.mayPartiallyFill, false);
        assert.ok(position + build.quote.expectedAmountOut > threshold);
        await install(fixture, signer);
        const tokenBefore = await tokenAmount(fixture.user);
        const solBefore = await solAmount(signer.address);
        const feeBefore =
          (await solAmount(fixture.dexFee)) + (await solAmount(fixture.helioFee));
        const signature = await send(build, signer);
        const receipt = await rpc("getTransaction", [
          signature,
          { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]);
        assert.equal(receipt.meta.err, null);
        const creditedTokens = (await tokenAmount(fixture.user)) - tokenBefore;
        const debitedLamports =
          solBefore - (await solAmount(signer.address)) - BigInt(receipt.meta.fee);
        assert.equal(creditedTokens, build.quote.expectedAmountOut);
        assert.equal(debitedLamports, build.quote.expectedAmountIn);
        if (kind === "exactIn") assert.equal(debitedLamports, amount.amountIn);
        else assert.equal(creditedTokens, amount.amountOut);
        assert.equal(
          (await solAmount(fixture.dexFee)) +
            (await solAmount(fixture.helioFee)) -
            feeBefore,
          build.quote.fees[0].amount,
        );
        const poolAfter = (
          await rpc("getAccountInfo", [fixture.pool, { encoding: "base64" }])
        ).value;
        const remaining = Buffer.from(poolAfter.data[0], "base64").readBigUInt64LE(16);
        assert.equal(1_000_000_000_000_000_000n - remaining, position + creditedTokens);
        context.diagnostic(
          `v${curveType} crossed graduation with full ${kind} settlement: ${signature}`,
        );

        const label = `allocation:${curveType}:${kind}`;
        const old = await moonshotFixture(signer.address, {
          curveType,
          label,
          position: 750_000_000_000_000_000n,
        });
        const allocationAmount =
          kind === "exactIn"
            ? { kind, amountIn: curveType === 1 ? 20_000_000_001n : 10_000_000_001n }
            : { kind, amountOut: 60_000_000_000_000_000n };
        const oversize = value(
          await buildSwapInstructions({
            ...old.request,
            amount: allocationAmount,
            slippageBps: 9999,
          }),
        );
        assert.equal(oversize.execution.mayPartiallyFill, false);
        assert.ok(
          750_000_000_000_000_000n + oversize.quote.expectedAmountOut <=
            820_000_000_000_000_000n,
        );
        const depleted = await moonshotFixture(signer.address, {
          curveType,
          label,
          position: 790_000_000_000_000_000n,
        });
        const declined = await buildSwapInstructions({
          ...depleted.request,
          amount: allocationAmount,
          slippageBps: 9999,
        });
        assert.equal(declined.ok, false);
        assert.equal(declined.error.code, "INSUFFICIENT_LIQUIDITY");
        await install(depleted, signer);
        const vaultBefore = await tokenAmount(depleted.vault);
        const dexBefore = await solAmount(depleted.dexFee);
        const helioBefore = await solAmount(depleted.helioFee);
        await assertUnchangedFailure(
          oversize,
          depleted,
          signer,
          /CurveLimit|custom program error: 0x1778|"Custom":6008/,
        );
        assert.equal(await tokenAmount(depleted.vault), vaultBefore);
        assert.equal(await solAmount(depleted.dexFee), dexBefore);
        assert.equal(await solAmount(depleted.helioFee), helioBefore);
      }
    }
  },
);

test(
  "native Moonshot output ATA creation separates rent from swap amounts",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const kind of ["exactIn", "exactOut"]) {
      const f = await moonshotFixture(signer.address, { label: `ata:${kind}` });
      f.request.snapshot.accounts[f.user] = null;
      const amount =
        kind === "exactIn" ? f.request.amount : { kind, amountOut: 1_000_000_000_001n };
      const build = value(await buildSwapInstructions({ ...f.request, amount }));
      assert.equal(build.setupInstructions.length, 1);
      await install(f, signer);
      const before = await solAmount(signer.address);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      const rent = await solAmount(f.user);
      assert.equal(
        before - (await solAmount(signer.address)) - BigInt(receipt.meta.fee) - rent,
        build.quote.expectedAmountIn,
      );
      assert.equal(await tokenAmount(f.user), build.quote.expectedAmountOut);
    }
  },
);

test(
  "native Moonshot preserves one-lamport rounding and zero minimum output bounds",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false]) {
      const f = await moonshotFixture(signer.address, { buy, label: `small:${buy}` });
      const amount = { kind: "exactIn", amountIn: buy ? 1n : 20_000_000n };
      const build = value(
        await buildSwapInstructions({ ...f.request, amount, slippageBps: 9999 }),
      );
      if (!buy) {
        assert.equal(build.quote.expectedAmountOut, 1n);
        assert.equal(build.quote.minimumAmountOut, 0n);
      }
      await install(f, signer);
      const solBefore = await solAmount(signer.address),
        tokenBefore = await tokenAmount(f.user);
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      const solDelta =
          (await solAmount(signer.address)) - solBefore + BigInt(receipt.meta.fee),
        tokenDelta = (await tokenAmount(f.user)) - tokenBefore;
      assert.equal(buy ? -solDelta : -tokenDelta, build.quote.expectedAmountIn);
      assert.equal(buy ? tokenDelta : solDelta, build.quote.expectedAmountOut);
    }
  },
);
