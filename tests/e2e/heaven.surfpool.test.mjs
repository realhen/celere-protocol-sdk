import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  generateKeyPairSigner,
  signTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { createProtocolSdk, compileTransaction } from "../../dist/index.js";
import { heavenAdapter } from "../../dist/protocols/heaven/amm.js";
import { heavenFixture } from "../fixtures/heaven.mjs";
const sdk = createProtocolSdk([heavenAdapter]);
const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw Error("Heaven native tests require a loopback simulator");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
async function rpc(method, params = []) {
  const body = await (
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: globalThis.AbortSignal.timeout(30_000),
    })
  ).json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
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
async function balance(key) {
  return BigInt((await rpc("getTokenAccountBalance", [key])).value.amount);
}
async function account(key) {
  return (await rpc("getAccountInfo", [key, { encoding: "base64" }])).value;
}
async function send(build, signer) {
  const latest = (await rpc("getLatestBlockhash")).value;
  const c = value(
    compileTransaction({
      instructions: build.instructions,
      feePayer: signer.address,
      lifetime: {
        blockhash: latest.blockhash,
        lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
      },
    }),
  );
  const signed = await signTransaction([signer.keyPair], c.transaction);
  return rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64" },
  ]);
}
test(
  "native Heaven constant fees match token debit, credit, accrued fees and pool reserves",
  { skip: !endpoint, timeout: 240_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const globalFees of [false, true])
      for (const protocolFeeBps of [0, 97])
        for (const buy of [true, false])
          for (const size of ["small", "normal", "large"]) {
            const f = await heavenFixture(signer.address, {
              buy,
              protocolFeeBps,
              creatorFeeBps: 113,
              label: "qualification",
              configVersion: globalFees ? 1 : 2,
            });
            const pool = f.request.snapshot.accounts[f.pool].data;
            if (globalFees) {
              f.request.snapshot.accounts[f.config].data.set(pool.subarray(96, 456), 88);
              pool[941] = 0;
              new DataView(pool.buffer).setUint32(104, 333, true);
              new DataView(pool.buffer).setUint32(108, 444, true);
              new DataView(pool.buffer).setUint32(248, 555, true);
              new DataView(pool.buffer).setUint32(252, 666, true);
            }
            const amount = {
              kind: "exactIn",
              amountIn:
                size === "large"
                  ? (1n << 53n) + 1n
                  : size === "small"
                    ? buy
                      ? 1n
                      : 16_000_001n
                    : f.request.amount.amountIn,
            };
            const built = value(
              await sdk.buildSwapInstructions({ ...f.request, amount }),
            );
            assert.equal(built.execution.mayPartiallyFill, false);
            for (const key of [f.userA, f.userB])
              new DataView(f.request.snapshot.accounts[key].data.buffer).setBigUint64(
                64,
                1n << 63n,
                true,
              );
            await install(f);
            const beforeA = await balance(f.userA),
              beforeB = await balance(f.userB);
            const signature = await send(built, signer),
              receipt = await rpc("getTransaction", [
                signature,
                { maxSupportedTransactionVersion: 0 },
              ]);
            assert.equal(receipt.meta.err, null);
            const a = (await balance(f.userA)) - beforeA,
              b = (await balance(f.userB)) - beforeB;
            assert.equal(buy ? -b : -a, amount.amountIn);
            assert.equal(buy ? a : b, built.quote.expectedAmountOut);
            const after = Buffer.from((await account(f.pool)).data[0], "base64");
            assert.equal(after.readBigUInt64LE(576), built.quote.fees[0].amount);
            assert.equal(after.readBigUInt64LE(584), built.quote.fees[1].amount);
            assert.equal(after.readBigUInt64LE(456), 800_000_000_000_000_000n - a);
            assert.equal(
              after.readBigUInt64LE(464),
              100_000_000_000n -
                b -
                built.quote.fees.reduce((sum, fee) => sum + fee.amount, 0n),
            );
          }
  },
);

test(
  "native Heaven rejects stale limits and exhausted real vaults atomically",
  { skip: !endpoint, timeout: 180_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const buy of [true, false])
      for (const exhaustion of [false, true]) {
        const label = `failure:${buy}:${exhaustion}`,
          original = await heavenFixture(signer.address, { buy, label });
        const built = value(
          await sdk.buildSwapInstructions({
            ...original.request,
            slippageBps: exhaustion ? 9999 : 0,
          }),
        );
        const stale = await heavenFixture(signer.address, {
          buy,
          label,
          reserveA:
            !exhaustion && !buy ? 900_000_000_000_000_000n : 800_000_000_000_000_000n,
          reserveB: !exhaustion && buy ? 110_000_000_000n : 100_000_000_000n,
        });
        if (exhaustion)
          new DataView(
            stale.request.snapshot.accounts[buy ? stale.vaultA : stale.vaultB].data
              .buffer,
          ).setBigUint64(64, 1n, true);
        await install(stale);
        const keys = [
          stale.userA,
          stale.userB,
          stale.pool,
          stale.vaultA,
          stale.vaultB,
          stale.config,
        ];
        const before = await Promise.all(keys.map(account));
        await assert.rejects(
          () => send(built, signer),
          /custom program error|insufficient|Insufficient|Slippage/i,
        );
        assert.deepEqual(await Promise.all(keys.map(account)), before);
      }
  },
);
