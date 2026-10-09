import { preservePumpConfiguration } from "../fixtures/pump-surfpool-state.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  generateKeyPairSigner,
  signTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { TOKEN, TOKEN_2022 } from "../fixtures/pump-amm.mjs";
import { pumpAmmQuotesFixture } from "../fixtures/pump-amm-quotes.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
preservePumpConfiguration(endpoint);
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw Error("Pump AMM tests require a loopback simulator");
function value(r) {
  assert.equal(
    r.ok,
    true,
    JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return r.value;
}
async function rpc(method, params = []) {
  const body = await (
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: globalThis.AbortSignal.timeout(30000),
    })
  ).json();
  if (body.error) throw Error(JSON.stringify(body.error));
  return body.result;
}
async function install(f) {
  for (const a of Object.values(f.request.snapshot.accounts)) {
    if (!a) continue;
    await rpc("surfnet_setAccount", [
      a.address,
      {
        owner: a.owner,
        lamports: Number(a.lamports),
        data: Buffer.from(a.data).toString("hex"),
        executable: false,
      },
    ]);
  }
}
async function account(k) {
  return (await rpc("getAccountInfo", [k, { encoding: "base64" }])).value;
}
async function balance(k) {
  return BigInt((await rpc("getTokenAccountBalance", [k])).value.amount);
}
async function send(b, signer, additionalSigners = []) {
  const latest = (await rpc("getLatestBlockhash")).value;
  const c = value(
    compileTransaction({
      instructions: b.instructions,
      feePayer: signer.address,
      lifetime: {
        blockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
      },
    }),
  );
  const signed = await signTransaction(
    [signer, ...additionalSigners].map((s) => s.keyPair),
    c.transaction,
  );
  return rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64" },
  ]);
}
function signed128(data, offset) {
  return data.readBigUInt64LE(offset) | (data.readBigInt64LE(offset + 8) << 64n);
}
async function verifySwap(f, signer, amount) {
  const built = value(await buildSwapInstructions({ ...f.request, amount }));
  await install(f);
  const isBuy = f.request.inputMint === f.quoteMint;
  const [baseBefore, quoteBefore, buybackBefore] = await Promise.all([
    balance(f.userBase),
    balance(f.userQuote),
    balance(f.buybackAta),
  ]);
  const signature = await send(built, signer);
  const receipt = await rpc("getTransaction", [
    signature,
    { maxSupportedTransactionVersion: 0 },
  ]);
  assert.equal(receipt.meta.err, null);
  const [baseAfter, quoteAfter, buybackAfter] = await Promise.all([
    balance(f.userBase),
    balance(f.userQuote),
    balance(f.buybackAta),
  ]);
  assert.equal(
    isBuy ? quoteBefore - quoteAfter : baseBefore - baseAfter,
    built.quote.expectedAmountIn,
  );
  assert.equal(
    isBuy ? baseAfter - baseBefore : quoteAfter - quoteBefore,
    built.quote.expectedAmountOut,
  );
  const discriminator = isBuy
    ? [103, 244, 82, 31, 44, 245, 119, 119]
    : [62, 47, 55, 10, 165, 3, 220, 42];
  const event = receipt.meta.logMessages
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => Buffer.from(l.slice(14), "base64"))
    .find((d) => discriminator.every((b, i) => d[i] === b));
  assert.ok(event);
  const lp = event.readBigUInt64LE(80),
    protocol = event.readBigUInt64LE(96),
    creator = event.readBigUInt64LE(352);
  assert.equal(built.quote.fees[0].amount, lp + protocol);
  assert.equal(built.quote.fees[1].amount, creator);
  for (const fee of built.quote.fees) assert.equal(fee.mint, f.quoteMint);
  const before = Buffer.from(f.request.snapshot.accounts[f.pool].data),
    after = Buffer.from((await account(f.pool)).data[0], "base64");
  assert.equal(
    after.readBigUInt64LE(271) - before.readBigUInt64LE(271),
    protocol - (buybackAfter - buybackBefore),
  );
  assert.equal(after.readBigUInt64LE(279) - before.readBigUInt64LE(279), creator);
  assert.equal(
    signed128(after, 245) - signed128(before, 245),
    -(protocol + creator - (buybackAfter - buybackBefore)),
  );
  return built;
}
test(
  "native PumpSwap quote assets use stable/exotic/flat fees and preserve exact amounts across token programs",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["usdc", "exotic"])
      for (const baseTokenProgram of [TOKEN, TOKEN_2022])
        for (const quoteTokenProgram of quote === "usdc" ? [TOKEN] : [TOKEN, TOKEN_2022])
          for (const mode of ["buy-in", "buy-out", "sell-in"]) {
            const f = await pumpAmmQuotesFixture(signer.address, {
              quote,
              baseTokenProgram,
              quoteTokenProgram,
              reverse: mode === "sell-in",
              label: `matrix:${quote}:${baseTokenProgram}:${quoteTokenProgram}`,
            });
            await verifySwap(
              f,
              signer,
              mode === "buy-out"
                ? { kind: "exactOut", amountOut: 123_456_789n }
                : f.request.amount,
            );
          }
  },
);
test(
  "native PumpSwap configured creator fees and holder rewards retain fees with signed virtual reserves",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const canonical of [true, false])
      for (const creatorFeeConfigurable of [false, true])
        for (const holderRewards of [false, true])
          for (const reverse of [false, true]) {
            const f = await pumpAmmQuotesFixture(signer.address, {
              label: "configured",
              quote: "exotic",
              canonical,
              creatorFeeConfigurable,
              creatorFeeBps: 71n,
              holderRewards,
              reverse,
              virtualQuoteReserves: -10_000_000_000n,
            });
            await verifySwap(f, signer, f.request.amount);
          }
  },
);
test(
  "native PumpSwap version gates ignore stale schedules and exotic zero fees fall back",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const feeConfigSize of [2512, 4073, 4097])
      for (const quote of ["sol", "exotic", ...(feeConfigSize >= 4073 ? ["usdc"] : [])]) {
        const f = await pumpAmmQuotesFixture(signer.address, {
          label: "version",
          quote,
          feeConfigSize,
          exoticFees: [0n, 0n, 0n],
        });
        await verifySwap(f, signer, { kind: "exactIn", amountIn: 3376n });
      }
  },
);
test(
  "native PumpSwap stale limits and reserve exhaustion fail atomically for both quote token programs",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quoteTokenProgram of [TOKEN, TOKEN_2022])
      for (const mode of ["buy-in", "buy-out", "sell-in"]) {
        const f = await pumpAmmQuotesFixture(signer.address, {
          label: "atomic",
          quote: "exotic",
          quoteTokenProgram,
          reverse: mode === "sell-in",
        });
        const built = value(
          await buildSwapInstructions({
            ...f.request,
            amount:
              mode === "buy-out"
                ? { kind: "exactOut", amountOut: 123456789n }
                : f.request.amount,
          }),
        );
        const stale = structuredClone(f);
        const reserve =
          stale.request.snapshot.accounts[mode === "sell-in" ? f.baseVault : f.quoteVault]
            .data;
        new DataView(reserve.buffer).setBigUint64(
          64,
          new DataView(reserve.buffer).getBigUint64(64, true) * 2n,
          true,
        );
        await install(stale);
        const keys = [
          f.pool,
          f.baseVault,
          f.quoteVault,
          f.userBase,
          f.userQuote,
          f.buybackAta,
        ];
        const before = await Promise.all(keys.map(account));
        await assert.rejects(
          () => send(built, signer),
          /custom program error|Slippage|slippage/i,
        );
        assert.deepEqual(await Promise.all(keys.map(account)), before);
        const exhausted = structuredClone(f);
        const ix = structuredClone(built.swapInstructions[0]);
        if (mode === "sell-in")
          new DataView(
            exhausted.request.snapshot.accounts[f.pool].data.buffer,
          ).setBigUint64(271, 85_000_000_000n - 200n, true);
        else if (mode === "buy-out")
          new DataView(ix.data.buffer).setBigUint64(8, 200_000_000_000_001n, true);
        else
          new DataView(
            exhausted.request.snapshot.accounts[f.baseVault].data.buffer,
          ).setBigUint64(64, 1n, true);
        await install(exhausted);
        const exhaustedBefore = await Promise.all(keys.map(account));
        await assert.rejects(
          () => send({ instructions: [ix] }, signer),
          /custom program error|insufficient|Insufficient/i,
        );
        assert.deepEqual(await Promise.all(keys.map(account)), exhaustedBefore);
      }
  },
);

test(
  "native PumpSwap creates missing quote buyback and base ATAs using the separate caller payer",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner(),
      payer = await generateKeyPairSigner();
    for (const tokenProgram of [TOKEN, TOKEN_2022]) {
      const f = await pumpAmmQuotesFixture(signer.address, {
        label: `ata:${tokenProgram}`,
        quote: "exotic",
        baseTokenProgram: tokenProgram,
        quoteTokenProgram: tokenProgram,
      });
      f.request.payer = payer.address;
      f.request.snapshot.accounts[f.buybackAta] = null;
      f.request.snapshot.accounts[f.userBase] = null;
      const built = value(await buildSwapInstructions(f.request));
      assert.equal(built.setupInstructions.length, 2);
      await install(f);
      await rpc("surfnet_setAccount", [payer.address, { lamports: 10000000000 }]);
      const quoteBefore = await balance(f.userQuote);
      const signature = await send(built, signer, [payer]);
      const receipt = await rpc("getTransaction", [
        signature,
        { maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.equal(await balance(f.userBase), built.quote.expectedAmountOut);
      assert.equal(
        quoteBefore - (await balance(f.userQuote)),
        built.quote.expectedAmountIn,
      );
      assert.equal((await account(f.buybackAta)).owner, tokenProgram);
    }
  },
);
test(
  "native PumpSwap refuses missing stable tiers rather than falling back to SOL fees",
  { skip: !endpoint, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const f = await pumpAmmQuotesFixture(signer.address, {
      label: "missing-stable",
      quote: "usdc",
    });
    const built = value(await buildSwapInstructions(f.request));
    for (const oldLength of [true, false]) {
      const bad = structuredClone(f);
      if (oldLength)
        bad.request.snapshot.accounts[f.feeConfig].data = bad.request.snapshot.accounts[
          f.feeConfig
        ].data.slice(0, 2512);
      else
        new DataView(bad.request.snapshot.accounts[f.feeConfig].data.buffer).setUint32(
          109,
          0,
          true,
        );
      const rejected = await buildSwapInstructions(bad.request);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error.code, "INVALID_ACCOUNT");
      await install(bad);
      const keys = [f.pool, f.userBase, f.userQuote, f.baseVault, f.quoteVault];
      const before = await Promise.all(keys.map(account));
      await assert.rejects(() => send(built, signer), /FeeTiersEmpty|6082/);
      assert.deepEqual(await Promise.all(keys.map(account)), before);
    }
  },
);
test(
  "native PumpSwap fee rounding remains exact for one-atom outputs and inputs above number precision",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["usdc", "exotic"])
      for (const mode of ["buy-in", "buy-out", "sell-in"]) {
        const f = await pumpAmmQuotesFixture(signer.address, {
          label: "rounding",
          quote,
          quoteTokenProgram: quote === "exotic" ? TOKEN_2022 : TOKEN,
          reverse: mode === "sell-in",
        });
        await verifySwap(
          f,
          signer,
          mode === "buy-out"
            ? { kind: "exactOut", amountOut: 1n }
            : { kind: "exactIn", amountIn: (1n << 53n) + 1n },
        );
      }
  },
);

test(
  "native PumpSwap selects SOL and USDC market-cap tiers exactly at the threshold",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "native2022"])
      for (const thresholdOffset of [-1n, 0n, 1n]) {
        const f = await pumpAmmQuotesFixture(signer.address, {
          label: "threshold",
          quote,
          quoteTokenProgram: quote === "native2022" ? TOKEN_2022 : TOKEN,
        });
        const data = f.request.snapshot.accounts[f.feeConfig].data;
        data.fill(0, 65);
        const view = new DataView(data.buffer);
        const marketCap = (85_000_000_000n - 300n) * 5n;
        for (const [offset, first, second] of [
          [65, [11n, 13n, 17n], [19n, 23n, 29n]],
          [149, [31n, 37n, 41n], [43n, 47n, 53n]],
        ]) {
          view.setUint32(offset, 2, true);
          view.setBigUint64(offset + 44, marketCap + thresholdOffset, true);
          for (const [index, fee] of first.entries())
            view.setBigUint64(offset + 20 + index * 8, fee, true);
          for (const [index, fee] of second.entries())
            view.setBigUint64(offset + 60 + index * 8, fee, true);
        }
        await verifySwap(f, signer, f.request.amount);
      }
  },
);
