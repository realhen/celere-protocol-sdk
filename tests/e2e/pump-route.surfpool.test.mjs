import { preservePumpConfiguration } from "../fixtures/pump-surfpool-state.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  generateKeyPairSigner,
  address,
  getAddressEncoder,
  getAddressDecoder,
  signTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { buildRouteInstructions, compileTransaction } from "../../dist/index.js";
import { pumpRouteFixture } from "../fixtures/pump-route.mjs";
import { PUMP_AMM, pda, ata, deterministicAddress } from "../fixtures/pump-amm.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
preservePumpConfiguration(endpoint);
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw Error("Native route qualification requires loopback Surfpool");
const value = (r) => {
  assert.ok(
    r.ok,
    JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return r.value;
};
async function rpc(method, params = []) {
  const r = await (
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: globalThis.AbortSignal.timeout(30000),
    })
  ).json();
  if (r.error) throw Error(JSON.stringify(r.error));
  return r.result;
}
async function account(key) {
  return (await rpc("getAccountInfo", [key, { encoding: "base64" }])).value;
}
async function balance(key) {
  return BigInt((await rpc("getTokenAccountBalance", [key])).value.amount);
}
async function install(f) {
  for (const a of Object.values(f.request.snapshot.accounts))
    if (a)
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
async function compile(b, signer) {
  let lookupTables;
  if (b.hops.length > 3) {
    const addresses = [
      ...new Set(
        b.instructions.flatMap(
          (instruction) =>
            instruction.accounts
              ?.filter((account) => account.address !== signer.address)
              .map((account) => account.address) ?? [],
        ),
      ),
    ];
    const table = deterministicAddress("route-test-lookup-table");
    const raw = new Uint8Array(56 + 32 * addresses.length);
    const view = new DataView(raw.buffer);
    view.setUint32(0, 1, true);
    view.setBigUint64(4, (1n << 64n) - 1n, true);
    const encode = getAddressEncoder();
    addresses.forEach((key, index) => raw.set(encode.encode(key), 56 + 32 * index));
    await rpc("surfnet_setAccount", [
      table,
      {
        owner: address("AddressLookupTab1e1111111111111111111111111"),
        lamports: 10_000_000,
        data: Buffer.from(raw).toString("hex"),
        executable: false,
      },
    ]);
    lookupTables = [{ address: table, addresses }];
  }
  const latest = (await rpc("getLatestBlockhash")).value;
  return value(
    compileTransaction({
      instructions: [
        getSetComputeUnitLimitInstruction({ units: 600000 }),
        ...b.instructions,
      ],
      feePayer: signer.address,
      lookupTables,
      lifetime: {
        blockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
      },
    }),
  );
}
async function send(b, signer) {
  const compiled = await compile(b, signer);
  const signed = await signTransaction([signer.keyPair], compiled.transaction);
  const signature = await rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64" },
  ]);
  const tx = await rpc("getTransaction", [
    signature,
    { maxSupportedTransactionVersion: 0 },
  ]);
  assert.equal(tx.meta.err, null);
  return tx;
}
function data(account) {
  return Buffer.from(account.data[0], "base64");
}
async function verify(options, signer) {
  const f = await pumpRouteFixture(signer.address, options);
  if (options.tail === "target") {
    const venue = f.venues[1],
      raw = f.request.snapshot.accounts[venue.pool].data;
    const view = new DataView(raw.buffer);
    view.setBigUint64(8, 1000n, true);
    view.setBigUint64(16, 1_000_000_000n, true);
    view.setBigUint64(24, 1n, true);
    view.setBigUint64(32, 1_000_000_000n, true);
    new DataView(f.request.snapshot.accounts[venue.baseVault].data.buffer).setBigUint64(
      64,
      11n,
      true,
    );
    new DataView(f.request.snapshot.accounts[venue.quoteVault].data.buffer).setBigUint64(
      64,
      1_000_000_028n,
      true,
    );
    f.request.amount = { kind: "exactIn", amountIn: 1300n };
  }
  if (options.tail === "currency") {
    const venue = f.venues[0],
      next = f.venues[1],
      raw = f.request.snapshot.accounts[venue.pool].data,
      view = new DataView(raw.buffer);
    view.setBigUint64(8, 1000n, true);
    view.setBigUint64(16, 1_000_000_000n, true);
    view.setBigUint64(24, 2n, true);
    view.setBigUint64(32, 1_000_000_000n, true);
    f.request.snapshot.accounts[venue.pool].lamports = 1_100_000_028n;
    new DataView(f.request.snapshot.accounts[venue.baseVault].data.buffer).setBigUint64(
      64,
      12n,
      true,
    );
    const nextRaw = f.request.snapshot.accounts[next.pool].data;
    nextRaw.fill(0, 49, 81);
    new DataView(nextRaw.buffer).setBigUint64(16, 1n, true);
    new DataView(nextRaw.buffer).setBigUint64(32, 1n, true);
    new DataView(f.request.snapshot.accounts[next.quoteVault].data.buffer).setBigUint64(
      64,
      29n,
      true,
    );
    f.request.amount = { kind: "exactIn", amountIn: 3_000_000n };
  }
  const b = value(
    await buildRouteInstructions({ ...f.request, fillPolicy: "requireFull" }),
  );
  await install(f);
  const volume = await pda(PUMP_AMM, "user_volume_accumulator", signer.address);
  const [baseBefore, quoteBefore, walletBefore, buybackBefore, volumeBefore] =
    await Promise.all([
      balance(f.userBase),
      balance(f.userQuote),
      account(signer.address),
      balance(f.buyback),
      account(volume),
    ]);
  const tx = await send(b, signer);
  const [baseAfter, quoteAfter, walletAfter, buybackAfter, volumeAfter] =
    await Promise.all([
      balance(f.userBase),
      balance(f.userQuote),
      account(signer.address),
      balance(f.buyback),
      account(volume),
    ]);
  const native = f.venues[0].kind === "curve" && (options.currency ?? "sol") === "sol";
  const rent = BigInt(volumeAfter?.lamports ?? 0) - BigInt(volumeBefore?.lamports ?? 0);
  const walletDebit =
    BigInt(walletBefore.lamports) -
    BigInt(walletAfter.lamports) -
    BigInt(tx.meta.fee) -
    rent;
  assert.equal(
    options.reverse
      ? baseBefore - baseAfter
      : native
        ? walletDebit
        : quoteBefore - quoteAfter,
    b.quote.expectedAmountIn,
    `input ${JSON.stringify(options)}`,
  );
  assert.equal(
    options.reverse
      ? native
        ? -walletDebit
        : quoteAfter - quoteBefore
      : baseAfter - baseBefore,
    b.quote.expectedAmountOut,
    `output ${JSON.stringify(options)}`,
  );
  if (native)
    assert.equal(
      quoteAfter,
      quoteBefore,
      "Native SOL curve routes must leave the WSOL sentinel unchanged",
    );
  const decoder = getAddressDecoder();
  const events = tx.meta.logMessages
    .filter((line) => line.startsWith("Program data: "))
    .map((line) => Buffer.from(line.slice(14), "base64"));
  for (let index = 0; index < f.ordered.length; index++) {
    const venue = f.ordered[index],
      hop = b.hops[index];
    const before = Buffer.from(f.request.snapshot.accounts[venue.pool].data),
      after = data(await account(venue.pool));
    const currencyIndex = options.reverse ? f.ordered.length - 1 : 0;
    const buyback = index === currencyIndex ? buybackAfter - buybackBefore : 0n;
    const trade = hop.quote.fees
      .filter((f) => f.kind === "trade")
      .reduce((sum, f) => sum + f.amount, 0n);
    const creator = hop.quote.fees
      .filter((f) => f.kind === "creator")
      .reduce((sum, f) => sum + f.amount, 0n);
    assert.equal(
      after.readBigUInt64LE(venue.kind === "pool" ? 279 : 125) -
        before.readBigUInt64LE(venue.kind === "pool" ? 279 : 125),
      creator,
      "Creator fee retention per hop",
    );
    if (venue.kind === "pool") {
      const event = events.find(
        (event) =>
          event.length > 360 && decoder.decode(event.subarray(120, 152)) === venue.pool,
      );
      assert.ok(event, "Native AMM route event");
      assert.equal(event.readBigUInt64LE(80) + event.readBigUInt64LE(96), trade);
      assert.equal(event.readBigUInt64LE(352), creator);
      assert.equal(
        after.readBigUInt64LE(271) - before.readBigUInt64LE(271),
        event.readBigUInt64LE(96) - buyback,
      );
    } else
      assert.equal(
        after.readBigUInt64LE(133) - before.readBigUInt64LE(133),
        trade - buyback,
        "Protocol fee retention per curve hop",
      );
  }
  return { f, b };
}
test(
  "native two/three hop Pump routes charge fees only at route ends across AMM, curve and mixed venues",
  { skip: !endpoint, timeout: 300000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const currency of ["sol", "usdc"])
      for (const kinds of [
        ["pool", "pool"],
        ["curve", "curve"],
        ["pool", "curve"],
        ["curve", "pool"],
        ["pool", "curve", "pool"],
        ["curve", "pool", "curve"],
      ])
        for (const reverse of [false, true])
          await verify({ kinds, reverse, currency, label: `matrix:${currency}` }, signer);
  },
);
test(
  "native token-2022 route balances and synthetic migration use the same offline contract",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const kinds of [
      ["pool", "curve"],
      ["curve", "pool"],
      ["curve", "curve"],
    ])
      for (const reverse of [false, true])
        await verify(
          { kinds, reverse, currency: "token", token2022: true, label: "token2022" },
          signer,
        );
    for (const kinds of [
      ["curve", "pool"],
      ["pool", "curve"],
      ["curve", "curve"],
    ])
      for (const crossing of kinds
        .map((kind, index) => (kind === "curve" ? index : -1))
        .filter((index) => index >= 0))
        await verify({ kinds, crossing, label: "crossing" }, signer);
  },
);
test(
  "native route stale endpoint limit and intermediate exhaustion roll back all hops",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const kinds of [
      ["pool", "pool"],
      ["curve", "pool"],
      ["pool", "curve"],
    ])
      for (const reverse of [false, true]) {
        const f = await pumpRouteFixture(signer.address, {
            kinds,
            reverse,
            label: "atomic",
          }),
          b = value(await buildRouteInstructions(f.request));
        await install(f);
        const keys = [
          f.userBase,
          f.userQuote,
          f.buyback,
          ...f.venues.flatMap((v) => [
            v.pool,
            v.baseVault,
            ...(f.request.snapshot.accounts[v.quoteVault] ? [v.quoteVault] : []),
          ]),
        ];
        const before = await Promise.all(keys.map(account));
        const bad = structuredClone(b);
        new DataView(bad.swapInstructions[0].data.buffer).setBigUint64(
          16,
          (1n << 64n) - 1n,
          true,
        );
        const compiled = await compile(bad, signer);
        const signed = await signTransaction([signer.keyPair], compiled.transaction);
        const signature = await rpc("sendTransaction", [
          getBase64EncodedWireTransaction(signed),
          { encoding: "base64", skipPreflight: true },
        ]);
        const failed = await rpc("getTransaction", [
          signature,
          { maxSupportedTransactionVersion: 0 },
        ]);
        assert.notEqual(failed.meta.err, null);
        assert.deepEqual(await Promise.all(keys.map(account)), before);
        const exhausted = structuredClone(f);
        const terminal = [...f.ordered]
          .reverse()
          .find(
            (venue) => !reverse || exhausted.request.snapshot.accounts[venue.quoteVault],
          );
        const vault = reverse ? terminal.quoteVault : terminal.baseVault;
        const state = exhausted.request.snapshot.accounts[vault];
        new DataView(state.data.buffer).setBigUint64(64, 0n, true);
        await install(exhausted);
        const exhaustedBefore = await Promise.all(keys.map(account));
        const second = await compile(b, signer);
        const signedSecond = await signTransaction([signer.keyPair], second.transaction);
        const exhaustedSignature = await rpc("sendTransaction", [
          getBase64EncodedWireTransaction(signedSecond),
          { encoding: "base64", skipPreflight: true },
        ]);
        const exhaustedReceipt = await rpc("getTransaction", [
          exhaustedSignature,
          { maxSupportedTransactionVersion: 0 },
        ]);
        assert.notEqual(exhaustedReceipt.meta.err, null);
        assert.deepEqual(await Promise.all(keys.map(account)), exhaustedBefore);
      }
  },
);

test(
  "native long routes compile with caller lookup tables and preserve masked fees",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const kinds of [
      ["pool", "pool", "pool", "pool"],
      ["curve", "curve", "curve", "curve"],
      ["pool", "curve", "pool", "curve"],
      ["curve", "pool", "curve", "pool"],
    ])
      for (const reverse of [false, true])
        await verify({ kinds, reverse, currency: "usdc", label: "long" }, signer);
  },
);
test(
  "native curve route consumes a synthetic completion tail that buys no additional token atom",
  { skip: !endpoint, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const { f, b } = await verify(
      { kinds: ["pool", "curve"], currency: "sol", tail: "target", label: "tail" },
      signer,
    );
    assert.equal(b.quote.expectedAmountOut, 1n);
    const last = f.venues[1],
      before = f.request.snapshot.accounts[last.quoteVault].data;
    assert.equal(
      (await balance(last.quoteVault)) -
        new DataView(before.buffer).getBigUint64(64, true),
      b.hops[1].quote.expectedAmountIn,
    );
  },
);

test(
  "native SOL currency curve consumes its complete wallet budget through a zero-extra-token completion tail",
  { skip: !endpoint, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const { b } = await verify(
      {
        kinds: ["curve", "curve"],
        currency: "sol",
        tail: "currency",
        label: "currency-tail",
      },
      signer,
    );
    assert.equal(b.hops[0].quote.expectedAmountOut, 2n);
    assert.equal(b.quote.expectedAmountIn, 3_000_000n);
    assert.equal(b.execution.mayPartiallyFill, false);
  },
);

test(
  "native routes create missing output and buyback ATAs with a separate caller-funded payer",
  { skip: !endpoint, timeout: 180000 },
  async () => {
    const owner = await generateKeyPairSigner(),
      payer = await generateKeyPairSigner();
    for (const kind of ["pool", "curve"]) {
      const recipient = await generateKeyPairSigner();
      const f = await pumpRouteFixture(owner.address, {
        kinds: [kind, "curve"],
        label: `setup:${kind}`,
        token2022: kind === "curve",
      });
      const quote = f.venues[0].quoteMint;
      const recipientAta = await ata(recipient.address, quote);
      const encode = getAddressEncoder();
      f.request.snapshot.accounts[f.ammConfig.global].data.set(
        encode.encode(recipient.address),
        643,
      );
      f.request.snapshot.accounts[f.curveConfig.global].data.set(
        encode.encode(recipient.address),
        741,
      );
      f.request.snapshot.accounts[f.userBase] = null;
      f.request.snapshot.accounts[recipientAta] = null;
      f.request.payer = payer.address;
      const built = value(await buildRouteInstructions(f.request));
      assert.equal(built.setupInstructions.length, 2);
      await install(f);
      await rpc("surfnet_setAccount", [payer.address, { lamports: 100_000_000_000 }]);
      const quoteBefore = await balance(f.userQuote),
        walletBefore = BigInt((await account(owner.address)).lamports),
        payerBefore = BigInt((await account(payer.address)).lamports);
      const volume = await pda(PUMP_AMM, "user_volume_accumulator", owner.address),
        volumeBefore = BigInt((await account(volume))?.lamports ?? 0);
      const compiled = await compile(built, owner),
        signed = await signTransaction(
          [owner.keyPair, payer.keyPair],
          compiled.transaction,
        );
      const signature = await rpc("sendTransaction", [
        getBase64EncodedWireTransaction(signed),
        { encoding: "base64" },
      ]);
      const receipt = await rpc("getTransaction", [
        signature,
        { maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.equal(await balance(f.userBase), built.quote.expectedAmountOut);
      assert.ok((await balance(recipientAta)) > 0n);
      const amountIn =
        kind === "pool"
          ? quoteBefore - (await balance(f.userQuote))
          : walletBefore -
            BigInt((await account(owner.address)).lamports) -
            BigInt(receipt.meta.fee) -
            (BigInt((await account(volume)).lamports) - volumeBefore);
      assert.equal(amountIn, built.quote.expectedAmountIn);
      assert.equal(
        payerBefore - BigInt((await account(payer.address)).lamports),
        BigInt((await account(f.userBase)).lamports) +
          BigInt((await account(recipientAta)).lamports) -
          (await balance(recipientAta)),
      );
    }
  },
);
