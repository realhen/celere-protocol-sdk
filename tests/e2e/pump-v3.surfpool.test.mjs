import { preservePumpConfiguration } from "../fixtures/pump-surfpool-state.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions } from "../../dist/index.js";
import { pumpV3Fixture, u64 } from "../fixtures/pump-v3.mjs";
import { rpc, submitInstructions, SOL } from "../fixtures/pump-helpers.mjs";
const url = process.env.CELERE_SURFPOOL_URL;
preservePumpConfiguration(url);
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
  throw Error("Pump tests require loopback Surfpool");
function value(r) {
  assert.equal(
    r.ok,
    true,
    JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return r.value;
}
async function install(f) {
  for (const a of Object.values(f.request.snapshot.accounts)) {
    if (!a) continue;
    await rpc(url, "surfnet_setAccount", [
      a.address,
      {
        owner: a.owner,
        data: Buffer.from(a.data).toString("hex"),
        lamports: Number(a.lamports),
        executable: false,
      },
    ]);
  }
}
async function account(a) {
  return (await rpc(url, "getAccountInfo", [a, { encoding: "base64" }])).value;
}
async function amount(a) {
  return BigInt((await rpc(url, "getTokenAccountBalance", [a])).value.amount);
}
async function execute(f, signer) {
  const built = value(await buildSwapInstructions(f.request));
  await install(f);
  const beforeBase = await amount(f.userBase),
    beforeQuote =
      f.quoteMint === SOL
        ? BigInt((await rpc(url, "getBalance", [signer.address])).value)
        : await amount(f.userQuote);
  const beforeCurve = Buffer.from((await account(f.pool)).data[0], "base64"),
    beforeBuyback =
      f.quoteMint === SOL
        ? BigInt((await rpc(url, "getBalance", [f.buyback])).value)
        : await amount(f.buyback);
  const signature = await submitInstructions(url, built.instructions, signer),
    receipt = await rpc(url, "getTransaction", [
      signature,
      { maxSupportedTransactionVersion: 0 },
    ]);
  const baseDelta = (await amount(f.userBase)) - beforeBase,
    quoteDelta =
      (f.quoteMint === SOL
        ? BigInt((await rpc(url, "getBalance", [signer.address])).value)
        : await amount(f.userQuote)) - beforeQuote;
  const rent = receipt.meta.postBalances.reduce(
    (sum, b, index) => sum + (receipt.meta.preBalances[index] === 0 ? BigInt(b) : 0n),
    0n,
  );
  const isBuy = f.request.inputMint === f.quoteMint;
  assert.equal(
    isBuy ? baseDelta : -baseDelta,
    isBuy ? built.quote.expectedAmountOut : built.quote.expectedAmountIn,
  );
  const quoteAdjusted =
    quoteDelta + (f.quoteMint === SOL ? BigInt(receipt.meta.fee) + rent : 0n);
  assert.equal(
    isBuy ? -quoteAdjusted : quoteAdjusted,
    isBuy ? built.quote.expectedAmountIn : built.quote.expectedAmountOut,
    JSON.stringify({ isBuy, quote: f.quoteMint, amount: f.request.amount }, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    ),
  );
  const after = Buffer.from((await account(f.pool)).data[0], "base64"),
    buyback =
      (f.quoteMint === SOL
        ? BigInt((await rpc(url, "getBalance", [f.buyback])).value)
        : await amount(f.buyback)) - beforeBuyback;
  assert.equal(
    after.readBigUInt64LE(125) - beforeCurve.readBigUInt64LE(125),
    built.quote.fees[1].amount,
    "retained creator fees",
  );
  assert.equal(
    after.readBigUInt64LE(133) - beforeCurve.readBigUInt64LE(133) + buyback,
    built.quote.fees[0].amount,
    "retained protocol plus paid buyback",
  );
  return { built, after, receipt };
}
test(
  "Pump v3 native SOL, USDC and token quotes match balances and retained fee counters",
  { skip: !url, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "token"])
      for (const mode of ["buyIn", "buyOut", "sellIn"]) {
        const f = await pumpV3Fixture(signer.address, {
          quote,
          buy: mode !== "sellIn",
          exactOut: mode === "buyOut",
          base2022: quote !== "sol",
          quote2022: quote === "token",
          customCreator: quote === "token",
          holder: quote === "token",
        });
        await execute(f, signer);
      }
  },
);
test(
  "Pump v3 synthetic migration crosses both portions with native limits and quote fees",
  { skip: !url, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "token"])
      for (const exactOut of [false, true]) {
        const f = await pumpV3Fixture(signer.address, {
          quote,
          crossing: true,
          exactOut,
          base2022: true,
          quote2022: quote === "token",
          customCreator: true,
        });
        const { after } = await execute(f, signer);
        assert.equal(after[48], 1);
        assert.ok(after.readBigUInt64LE(150) > 0n);
        assert.ok(after.readBigUInt64LE(158) > 0n);
        f.request.snapshot.accounts[f.pool].data = Uint8Array.from(after);
        const complete = await buildSwapInstructions(f.request);
        assert.equal(complete.ok, false);
        assert.equal(complete.error.code, "INVALID_ACCOUNT");
      }
  },
);

test(
  "Pump v3 native quote setup and creator-rate gates preserve atomic amount accounting",
  { skip: !url, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["usdc", "token"]) {
      const f = await pumpV3Fixture(signer.address, {
        quote,
        base2022: true,
        quote2022: quote === "token",
        customCreator: true,
      });
      f.request.snapshot.accounts[f.global].data[1045] = 0;
      await execute(f, signer);
    }
    for (const quote of ["sol", "usdc", "token"])
      for (const amountIn of [3376n, (1n << 53n) + 1n]) {
        const f = await pumpV3Fixture(signer.address, {
          quote,
          base2022: true,
          quote2022: quote === "token",
        });
        f.request.amount.amountIn = amountIn;
        if (amountIn > 1n << 53n) {
          // Large exact-output instead avoids exhausting curve inventory solely to test bigint input arithmetic.
          f.request.amount = { kind: "exactOut", amountOut: (1n << 53n) + 1n };
          u64(f.request.snapshot.accounts[f.pool].data, 8, 1n << 62n);
          u64(f.request.snapshot.accounts[f.pool].data, 24, 1n << 61n);
          u64(f.request.snapshot.accounts[f.baseVault].data, 64, 1n << 61n);
        }
        await execute(f, signer);
      }
    for (const mode of ["buyIn", "buyOut", "sellIn"]) {
      const f = await pumpV3Fixture(signer.address, {
        quote: "token",
        buy: mode !== "sellIn",
        exactOut: mode === "buyOut",
        quote2022: false,
      });
      await execute(f, signer);
    }
    const missing = await pumpV3Fixture(signer.address, {
      quote: "token",
      quote2022: true,
      missingBuyback: true,
      label: "missing-buyback",
    });
    const payer = await generateKeyPairSigner();
    missing.request.payer = payer.address;
    missing.request.snapshot.accounts[payer.address] = {
      ...missing.request.snapshot.accounts[signer.address],
      address: payer.address,
    };
    const built = value(await buildSwapInstructions(missing.request));
    assert.deepEqual(
      new Set(built.requiredSigners),
      new Set([signer.address, payer.address]),
    );
    await install(missing);
    assert.equal(built.setupInstructions.length, 1);
    await submitInstructions(url, built.instructions, payer, [payer, signer]);
    assert.ok(await account(missing.buyback));
  },
);

test(
  "Pump v3 completion refunds a budget whose synthetic remainder buys no token atom",
  { skip: !url, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "token"]) {
      const f = await pumpV3Fixture(signer.address, { quote, customCreator: true });
      const d = f.request.snapshot.accounts[f.pool].data;
      u64(d, 8, 1000n);
      u64(d, 16, 1_000_000_000n);
      u64(d, 24, 1n);
      u64(d, 32, 1_000_000_000n);
      u64(f.request.snapshot.accounts[f.baseVault].data, 64, 11n);
      f.request.amount.amountIn = 3_000_000n;
      f.request.slippageBps = 0;
      const { built, after } = await execute(f, signer);
      assert.equal(after[48], 1);
      assert.equal(after.readBigUInt64LE(150), 0n);
      assert.equal(built.quote.expectedAmountOut, 1n);
      assert.ok(built.quote.expectedAmountIn < built.quote.amountIn);
      assert.equal(built.execution.mayPartiallyFill, true);
    }
  },
);

test(
  "Pump v3 native input and output limits roll back curve, vault, user and fee balances",
  { skip: !url, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "token"])
      for (const mode of ["buyIn", "buyOut", "sellIn"]) {
        const f = await pumpV3Fixture(signer.address, {
          quote,
          buy: mode !== "sellIn",
          exactOut: mode === "buyOut",
          crossing: mode !== "sellIn",
          quote2022: quote === "token",
        });
        const built = value(await buildSwapInstructions(f.request));
        await install(f);
        const keys = [
          f.pool,
          f.baseVault,
          f.userBase,
          f.buyback,
          ...(quote === "sol" ? [] : [f.quoteVault, f.userQuote]),
        ];
        const before = await Promise.all(keys.map(account));
        const bad = {
          ...built.swapInstructions[0],
          data: Uint8Array.from(built.swapInstructions[0].data),
        };
        u64(bad.data, 16, mode === "buyOut" ? 1n : (1n << 64n) - 1n);
        const latest = (await rpc(url, "getLatestBlockhash")).value;
        const { compileTransaction } = await import("../../dist/index.js");
        const { signTransaction, getBase64EncodedWireTransaction } =
          await import("@solana/kit");
        const compiled = value(
          compileTransaction({
            instructions: [...built.setupInstructions, bad],
            feePayer: signer.address,
            lifetime: {
              blockhash: latest.blockhash,
              lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
            },
            computeBudget: { units: 500000 },
          }),
        );
        const signed = await signTransaction([signer.keyPair], compiled.transaction);
        const signature = await rpc(url, "sendTransaction", [
          getBase64EncodedWireTransaction(signed),
          { encoding: "base64", skipPreflight: true },
        ]);
        const receipt = await rpc(url, "getTransaction", [
          signature,
          { maxSupportedTransactionVersion: 0 },
        ]);
        assert.ok(receipt.meta.err);
        assert.match(
          receipt.meta.logMessages.join("\n"),
          /TooMuchSolRequired|TooLittleSolReceived|TooLittleTokensReceived|BuySlippageBelowMinTokensOut/,
        );
        assert.deepEqual(await Promise.all(keys.map(account)), before);
      }
  },
);
