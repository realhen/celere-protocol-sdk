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

import { raydiumLaunchlabFixture } from "../fixtures/raydium-launchlab.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (
  endpoint &&
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)
) {
  throw new Error("Native LaunchLab fixtures may only run against loopback Surfpool");
}

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
    signal: globalThis.AbortSignal.timeout(30_000),
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
  "native LaunchLab supported modes match user balances and all protocol fees",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false])
      for (const kind of buy ? ["exactIn"] : ["exactIn", "exactOut"])
        for (const rates of [
          { tradeRate: 0n, platformRate: 0n, creatorRate: 0n },
          { tradeRate: 2500n, platformRate: 7500n, creatorRate: 5000n },
          { tradeRate: 3333n, platformRate: 4444n, creatorRate: 1777n },
        ])
          for (const small of [false, true]) {
            const fixture = await raydiumLaunchlabFixture(signer.address, {
              buy,
              label: `${buy}:${kind}:${rates.tradeRate}:${small}`,
              ...rates,
            });
            const amount =
              kind === "exactIn"
                ? {
                    kind,
                    amountIn: small
                      ? buy
                        ? 101n
                        : 1_000_001n
                      : fixture.request.amount.amountIn,
                  }
                : { kind, amountOut: small ? 101n : 1_000_001n };
            await installFixture(fixture, signer);
            const build = value(
              await buildSwapInstructions({ ...fixture.request, amount, slippageBps: 0 }),
            );
            const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input),
              outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
            const signature = await sendPlan(build, signer);
            const receipt = await rpc("getTransaction", [
              signature,
              { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
            ]);
            assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
            assert.ok(
              receipt.meta.logMessages.some((line) =>
                line.includes(
                  "Instruction: " +
                    (buy
                      ? "BuyExactIn"
                      : kind === "exactIn"
                        ? "SellExactIn"
                        : "SellExactOut"),
                ),
              ),
            );
            assert.equal(
              inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
              build.quote.expectedAmountIn,
              `${buy}:${kind} input`,
            );
            assert.equal(
              (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
              build.quote.expectedAmountOut,
              `${buy}:${kind} output`,
            );
            const creatorFee = await tokenAmount(fixture.creatorFeeVault);
            assert.equal(
              creatorFee,
              build.quote.fees.find((fee) => fee.kind === "creator")?.amount ?? 0n,
              `${buy}:${kind} creator`,
            );
            const poolState = Buffer.from(
              (await rpc("getAccountInfo", [fixture.pool, { encoding: "base64" }])).value
                .data[0],
              "base64",
            );
            assert.equal(
              poolState.readBigUInt64LE(77) +
                (await tokenAmount(fixture.platformFeeVault)),
              build.quote.fees.find((fee) => fee.kind === "trade").amount,
            );
          }
  },
);

test(
  "native LaunchLab buys partially fill at graduation, including buy_exact_out",
  { skip: !endpoint, timeout: 60_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const kind of ["exactIn", "exactOut"]) {
      const fixture = await raydiumLaunchlabFixture(signer.address, {
        label: `boundary:${kind}`,
      });
      const build = value(await buildSwapInstructions(fixture.request));
      const state = new DataView(
        fixture.request.snapshot.accounts[fixture.pool].data.buffer,
      );
      state.setBigUint64(29, state.getBigUint64(53, true) + 500_000_000n, true);
      state.setBigUint64(69, state.getBigUint64(61, true) + 17_001n, true);
      await installFixture(fixture, signer);
      const instruction = build.swapInstructions[0];
      const data = new Uint8Array(instruction.data);
      const amounts = new DataView(data.buffer);
      if (kind === "exactOut") {
        // Direct native evidence for why the public SDK refuses exact-output buys.
        data.set([24, 211, 116, 40, 105, 3, 153, 56]);
        amounts.setBigUint64(8, 1_000_000_001n, true);
        amounts.setBigUint64(16, 1_000_001n, true);
      } else amounts.setBigUint64(16, 1n, true);
      const inputBefore = await tokenAmount(fixture.userQuote),
        outputBefore = await tokenAmount(fixture.userBase);
      await sendPlan({ ...build, instructions: [{ ...instruction, data }] }, signer);
      assert.ok(inputBefore - (await tokenAmount(fixture.userQuote)) < 1_000_001n);
      assert.equal((await tokenAmount(fixture.userBase)) - outputBefore, 500_000_000n);
    }
  },
);

test(
  "native LaunchLab exact-output sells fail when current liquidity cannot satisfy output",
  { skip: !endpoint, timeout: 60_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const fixture = await raydiumLaunchlabFixture(signer.address, {
      buy: false,
      label: "sell-output-insufficient",
    });
    const build = value(
      await buildSwapInstructions({
        ...fixture.request,
        amount: { kind: "exactOut", amountOut: 1_000_001n },
      }),
    );
    const state = new DataView(
      fixture.request.snapshot.accounts[fixture.pool].data.buffer,
    );
    state.setBigUint64(53, 1n, true);
    state.setBigUint64(61, 1n, true);
    await installFixture(fixture, signer);
    await assert.rejects(() => sendPlan(build, signer), /RequireGteViolated/);
  },
);

test(
  "consumer can build a quoted partial-input buy that completes LaunchLab funding",
  { skip: !endpoint, timeout: 60_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const fixture = await raydiumLaunchlabFixture(signer.address, {
      label: "quoted-graduation",
    });
    const state = new DataView(
      fixture.request.snapshot.accounts[fixture.pool].data.buffer,
    );
    state.setBigUint64(29, state.getBigUint64(53, true) + 500_000_000n, true);
    state.setBigUint64(69, state.getBigUint64(61, true) + 17_001n, true);
    await installFixture(fixture, signer);
    const build = value(
      await buildSwapInstructions({ ...fixture.request, slippageBps: 0 }),
    );
    assert.equal(build.quote.amountIn, fixture.request.amount.amountIn);
    assert.ok(build.quote.expectedAmountIn < build.quote.amountIn);
    assert.equal(build.quote.expectedAmountOut, 500_000_000n);
    const inputBefore = await tokenAmount(fixture.userQuote),
      outputBefore = await tokenAmount(fixture.userBase);
    await sendPlan(build, signer);
    assert.equal(
      inputBefore - (await tokenAmount(fixture.userQuote)),
      build.quote.expectedAmountIn,
    );
    assert.equal(
      (await tokenAmount(fixture.userBase)) - outputBefore,
      build.quote.expectedAmountOut,
    );
  },
);

test(
  "native LaunchLab swaps accept ordinary Token-2022 base and quote mints",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const base2022 of [true, false])
      for (const buy of [true, false])
        for (const kind of buy ? ["exactIn"] : ["exactIn", "exactOut"]) {
          const fixture = await raydiumLaunchlabFixture(signer.address, {
            base2022,
            quote2022: !base2022,
            buy,
            label: `token2022:${base2022}:${buy}:${kind}`,
          });
          await installFixture(fixture, signer);
          const build = value(
            await buildSwapInstructions({
              ...fixture.request,
              slippageBps: 0,
              amount:
                kind === "exactIn"
                  ? fixture.request.amount
                  : { kind, amountOut: 1_000_001n },
            }),
          );
          const inputBefore = await tokenAmount(fixture.request.tokenAccounts.input),
            outputBefore = await tokenAmount(fixture.request.tokenAccounts.output);
          await sendPlan(build, signer);
          assert.equal(
            inputBefore - (await tokenAmount(fixture.request.tokenAccounts.input)),
            build.quote.expectedAmountIn,
          );
          assert.equal(
            (await tokenAmount(fixture.request.tokenAccounts.output)) - outputBefore,
            build.quote.expectedAmountOut,
          );
        }
  },
);
