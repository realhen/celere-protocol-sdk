import {
  buy_with_exact_cash_in,
  sell_with_exact_token_in,
} from "../../dist/protocols/rise-rich/instructions/index.js";
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
import { createProtocolSdk, compileTransaction } from "../../dist/index.js";
import { riseRichFixture } from "../fixtures/rise-rich.mjs";
import { riseRichAdapter } from "../../dist/protocols/rise-rich/curve.js";
const { buildSwapInstructions } = createProtocolSdk([riseRichAdapter]);

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Rise Rich tests only accept loopback simulators");
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
    signal: globalThis.AbortSignal.timeout(30_000),
  }).catch((error) => {
    throw new Error(`${method} ${String(params[0])}: ${error.message}`, { cause: error });
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

test(
  "native Rise floor swaps match actual token deltas and fee distribution",
  { skip: !endpoint, timeout: 240_000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false])
      for (const feeRate of [0, 97, 12500])
        for (const floor of [1n, 3n]) {
          const f = await riseRichFixture(signer.address, {
            buy,
            feeRate,
            floor,
            platformShare: 150000,
            label: "native-rise",
          });
          process.stdout.write(`Rise native case ${buy}/${feeRate}/${floor}: install\n`);
          const build = value(await buildSwapInstructions(f.request));
          await install(f, signer);
          const before = [await tokenAmount(f.userToken), await tokenAmount(f.userMain)];
          process.stdout.write(`Rise native case ${buy}/${feeRate}/${floor}: send\n`);
          const signature = await send(build, signer);
          const receipt = await rpc("getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
          const tokenDelta = (await tokenAmount(f.userToken)) - before[0],
            cashDelta = (await tokenAmount(f.userMain)) - before[1];
          const fees =
            (await tokenAmount(f.cashEscrow)) +
            (await tokenAmount(f.creatorEscrow)) +
            (await tokenAmount(f.teamEscrow)) +
            (await tokenAmount(f.revEscrowGroup)) +
            (await tokenAmount(f.revEscrowTenant));
          context.diagnostic(
            JSON.stringify(
              {
                buy,
                feeRate,
                floor: String(floor),
                tokens: String(tokenDelta),
                cash: String(cashDelta),
                fees: String(fees),
                quote: build.quote,
              },
              (_, v) => (typeof v === "bigint" ? String(v) : v),
            ),
          );
          assert.equal(buy ? -cashDelta : -tokenDelta, build.quote.expectedAmountIn);
          assert.equal(buy ? tokenDelta : cashDelta, build.quote.expectedAmountOut);
          assert.equal(fees, build.quote.fees[0].amount);
        }
  },
);

async function observedAccounts(fixture) {
  const keys = [
    fixture.pool,
    fixture.mayMarket,
    fixture.mint,
    fixture.userToken,
    fixture.userMain,
    fixture.liqVaultMain,
    fixture.revEscrowGroup,
    fixture.revEscrowTenant,
    fixture.cashEscrow,
    fixture.creatorEscrow,
    fixture.teamEscrow,
  ];
  return (
    await rpc("getMultipleAccounts", [
      keys,
      { encoding: "base64", commitment: "confirmed" },
    ])
  ).value;
}
async function atomicFailure(build, fixture, signer, pattern) {
  const before = await observedAccounts(fixture);
  await assert.rejects(() => send(build, signer), pattern);
  assert.deepEqual(await observedAccounts(fixture), before);
}
test(
  "native Rise enforces stale minimum outputs and rejects depleted liquidity atomically",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false]) {
      const label = "native-rise";
      const old = await riseRichFixture(signer.address, {
        buy,
        feeRate: 12500,
        label,
        floor: buy ? 1n : 3n,
      });
      const build = value(await buildSwapInstructions(old.request));
      const adverse = await riseRichFixture(signer.address, {
        buy,
        feeRate: 12500,
        label,
        floor: buy ? 3n : 1n,
      });
      await install(adverse, signer);
      await atomicFailure(
        build,
        adverse,
        signer,
        /Slippage|Minimum|Insufficient|custom program error/,
      );
    }
    const f = await riseRichFixture(signer.address, {
      buy: false,
      feeRate: 12500,
      label: "native-rise",
    });
    const valid = value(await buildSwapInstructions({ ...f.request, slippageBps: 9999 }));
    new DataView(f.request.snapshot.accounts[f.mayMarket].data.buffer).setBigUint64(
      48,
      1n,
      true,
    );
    new DataView(f.request.snapshot.accounts[f.liqVaultMain].data.buffer).setBigUint64(
      64,
      1n,
      true,
    );
    f.request.snapshot.accounts[f.liqVaultMain].lamports = 2_039_281n;
    const rejected = await buildSwapInstructions(f.request);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "INSUFFICIENT_LIQUIDITY");
    await install(f, signer);
    await atomicFailure(
      valid,
      f,
      signer,
      /Insufficient|liquidity|cash|custom program error/,
    );
  },
);

test(
  "native Rise respects permission and start-time gates on stale instructions",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false])
      for (const disabled of ["permission", "start"]) {
        const f = await riseRichFixture(signer.address, {
          buy,
          label: "native-rise",
        });
        const built = value(await buildSwapInstructions(f.request));
        const view = new DataView(f.request.snapshot.accounts[f.marketMeta].data.buffer);
        if (disabled === "permission") view.setUint16(330, 0, true);
        else view.setBigUint64(332, 9_000_000_000n, true);
        const rejected = await buildSwapInstructions(f.request);
        assert.equal(rejected.ok, false);
        assert.equal(rejected.error.code, "UNSUPPORTED_POOL_FEATURE");
        await install(f, signer);
        await atomicFailure(
          built,
          f,
          signer,
          /Permission|NotStarted|start|custom program error/,
        );
      }
  },
);

test(
  "native Rise preserves full input at the floor boundary and decimal-price rounding",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false]) {
      const f = await riseRichFixture(signer.address, {
        buy,
        label: "native-rise",
        feeRate: 12500,
        floorScale: 2,
        mainIntercept: -2n,
      });
      const build = value(
        await buildSwapInstructions({
          ...f.request,
          amount: { kind: "exactIn", amountIn: buy ? 1_000_001n : 99_999_999n },
        }),
      );
      await install(f, signer);
      const before = [await tokenAmount(f.userMain), await tokenAmount(f.userToken)];
      const signature = await send(build, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      const cashDelta = (await tokenAmount(f.userMain)) - before[0],
        tokenDelta = (await tokenAmount(f.userToken)) - before[1];
      assert.equal(buy ? -cashDelta : -tokenDelta, build.quote.expectedAmountIn);
      assert.equal(buy ? tokenDelta : cashDelta, build.quote.expectedAmountOut);
    }
    const boundary = 901_000_000_000n;
    const f = await riseRichFixture(signer.address, {
      label: "native-rise",
      feeRate: 12500,
      supply: boundary - 987500n,
    });
    const built = value(await buildSwapInstructions(f.request));
    assert.equal(built.quote.expectedAmountOut, 987500n);
    await install(f, signer);
    const cashBefore = await tokenAmount(f.userMain),
      tokenBefore = await tokenAmount(f.userToken);
    await send(built, signer);
    assert.equal(cashBefore - (await tokenAmount(f.userMain)), 1_000_001n);
    assert.equal((await tokenAmount(f.userToken)) - tokenBefore, 987500n);
    const original = await riseRichFixture(signer.address, {
      label: "native-rise",
      feeRate: 12500,
    });
    const stale = value(
      await buildSwapInstructions({ ...original.request, slippageBps: 9999 }),
    );
    const crossing = await riseRichFixture(signer.address, {
      label: "native-rise",
      feeRate: 12500,
      supply: boundary - 1n,
    });
    const rejected = await buildSwapInstructions(crossing.request);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "UNSUPPORTED_POOL_FEATURE");
    await install(crossing, signer);
    const beforeCash = await tokenAmount(crossing.userMain),
      beforeToken = await tokenAmount(crossing.userToken);
    await send(stale, signer);
    assert.equal(
      beforeCash - (await tokenAmount(crossing.userMain)),
      stale.quote.amountIn,
    );
    assert.ok((await tokenAmount(crossing.userToken)) - beforeToken > 0n);
  },
);

test(
  "native Rise enforces exact minimum collateral amounts atomically",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false]) {
      const f = await riseRichFixture(signer.address, {
        buy,
        label: "native-rise",
        feeRate: 12500,
      });
      const below = buy ? 699_999n : 708_860n,
        at = below + 1n;
      const refused = await buildSwapInstructions({
        ...f.request,
        amount: { kind: "exactIn", amountIn: below },
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, "INVALID_REQUEST");
      const raw = buy
        ? buy_with_exact_cash_in(f.instructionAccounts, {
            cashIn: below,
            minTokenOut: 0n,
            newShoulderEnd: 0n,
            floorIncreaseRatio: new Uint8Array(16),
            maxNewFloor: new Uint8Array(16),
            maxAreaShrinkageToleranceUnits: 100_000_000n,
            minLiqRatio: new Uint8Array(16),
          })
        : sell_with_exact_token_in(f.instructionAccounts, {
            tokenIn: below,
            minCashOut: 0n,
          });
      await install(f, signer);
      await atomicFailure(
        { instructions: [raw] },
        f,
        signer,
        /AmountTooSmall|"Custom":6022/,
      );
      const valid = value(
        await buildSwapInstructions({
          ...f.request,
          amount: { kind: "exactIn", amountIn: at },
        }),
      );
      const cashBefore = await tokenAmount(f.userMain),
        tokenBefore = await tokenAmount(f.userToken);
      await send(valid, signer);
      const cashDelta = (await tokenAmount(f.userMain)) - cashBefore,
        tokenDelta = (await tokenAmount(f.userToken)) - tokenBefore;
      assert.equal(buy ? -cashDelta : -tokenDelta, valid.quote.expectedAmountIn);
      assert.equal(buy ? tokenDelta : cashDelta, valid.quote.expectedAmountOut);
    }
  },
);
