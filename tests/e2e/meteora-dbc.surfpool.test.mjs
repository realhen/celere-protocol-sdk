import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { createProtocolSdk, compileTransaction } from "../../dist/index.js";
import { meteoraDbcAdapter } from "../../dist/protocols/meteora-dbc/adapter.js";
const { buildSwapInstructions } = createProtocolSdk([meteoraDbcAdapter]);
import { meteoraDbcFixture, METEORA_DBC_PROGRAM } from "../fixtures/meteora-dbc.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Meteora DBC tests only accept loopback simulators");
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
    signal: globalThis.AbortSignal.timeout(60_000),
  });
  const body = await response.json();
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
  for (const account of Object.values(fixture.request.snapshot.accounts))
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

async function accountData(key) {
  return Buffer.from(
    (await rpc("getAccountInfo", [key, { encoding: "base64", commitment: "confirmed" }]))
      .value.data[0],
    "base64",
  );
}
function balanceChange(receipt, key) {
  const keys = receipt.transaction.message.accountKeys;
  const index = keys.findIndex((x) => (typeof x === "string" ? x : x.pubkey) === key);
  const before = receipt.meta.preTokenBalances.find((x) => x.accountIndex === index),
    after = receipt.meta.postTokenBalances.find((x) => x.accountIndex === index);
  assert.ok(before && after, `Missing actual token balances for ${key}`);
  return BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount);
}
function getU64(data, offset) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
    offset,
    true,
  );
}
function putU128(data, offset, amount) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  v.setBigUint64(offset, amount & ((1n << 64n) - 1n), true);
  v.setBigUint64(offset + 8, amount >> 64n, true);
}
test(
  "native Meteora DBC fills both modes across segments with output/quote fees and creator splits",
  { skip: !endpoint, timeout: 240000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const collectFeeMode of [0, 1])
        for (const kind of ["exactIn", "exactOut"]) {
          const f = await meteoraDbcFixture(signer.address, {
            reverse,
            collectFeeMode,
            label: `native:${reverse}:${collectFeeMode}:${kind}`,
          });
          const amount =
            kind === "exactIn"
              ? { kind, amountIn: 300000003n }
              : { kind, amountOut: 200000003n };
          await install(f, signer);
          const built = value(await buildSwapInstructions({ ...f.request, amount }));
          const signature = await send(built, signer);
          const receipt = await rpc("getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          assert.ok(receipt);
          assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
          assert.ok(
            receipt.meta.logMessages.some((line) =>
              line.includes(`Program ${METEORA_DBC_PROGRAM} invoke`),
            ),
          );
          const debit = -balanceChange(receipt, f.request.tokenAccounts.input),
            credit = balanceChange(receipt, f.request.tokenAccounts.output);
          assert.equal(debit, built.quote.expectedAmountIn);
          assert.equal(credit, built.quote.expectedAmountOut);
          assert.equal(
            balanceChange(receipt, reverse ? f.baseVault : f.quoteVault),
            debit,
          );
          assert.equal(
            -balanceChange(receipt, reverse ? f.quoteVault : f.baseVault),
            credit,
          );
          const state = await accountData(f.pool),
            initial = f.request.snapshot.accounts[f.pool].data;
          const feesOnBase = collectFeeMode === 1 && !reverse;
          const protocolOffset = feesOnBase ? 248 : 256,
            partnerOffset = feesOnBase ? 264 : 272,
            creatorOffset = feesOnBase ? 352 : 360;
          const protocol =
              getU64(state, protocolOffset) - getU64(initial, protocolOffset),
            partner = getU64(state, partnerOffset) - getU64(initial, partnerOffset),
            creator = getU64(state, creatorOffset) - getU64(initial, creatorOffset),
            total = protocol + partner + creator;
          assert.equal(
            total,
            built.quote.fees.reduce((sum, fee) => sum + fee.amount, 0n),
          );
          assert.equal(protocol, (total * 20n) / 100n);
          assert.equal(creator, ((total - protocol) * 33n) / 100n);
          assert.equal(
            built.quote.fees.find((fee) => fee.kind === "creator").amount,
            creator,
          );
          const feesOnInput = collectFeeMode === 0 && !reverse;
          assert.equal(
            getU64(state, reverse ? 232 : 240) - getU64(initial, reverse ? 232 : 240),
            debit - (feesOnInput ? total : 0n),
          );
          assert.equal(
            getU64(initial, reverse ? 240 : 232) - getU64(state, reverse ? 240 : 232),
            credit + (feesOnInput ? 0n : total),
          );
          context.diagnostic(
            `${reverse ? "base->quote" : "quote->base"} ${kind} collect=${collectFeeMode} debit=${debit} credit=${credit} protocol=${protocol} creator=${creator} signature=${signature}`,
          );
        }
  },
);
test(
  "native Meteora DBC enforces stale slippage and rejects partial fills at curve/migration boundaries",
  { skip: !endpoint, timeout: 180000 },
  async (context) => {
    const signer = await generateKeyPairSigner(),
      Q64 = 1n << 64n;
    for (const reverse of [false, true])
      for (const kind of ["exactIn", "exactOut"])
        for (const failure of ["slippage", "boundary"]) {
          const f = await meteoraDbcFixture(signer.address, {
            reverse,
            label: `reject:${reverse}:${kind}:${failure}`,
          });
          const amount =
            kind === "exactIn"
              ? { kind, amountIn: 1000003n }
              : { kind, amountOut: 1000003n };
          const built = value(await buildSwapInstructions({ ...f.request, amount }));
          if (failure === "slippage")
            putU128(
              f.request.snapshot.accounts[f.pool].data,
              280,
              reverse ? (Q64 * 7n) / 10n : (Q64 * 15n) / 10n,
            );
          else
            putU128(
              f.request.snapshot.accounts[f.pool].data,
              280,
              reverse ? Q64 / 2n : (Q64 * 18n) / 10n,
            );
          if (failure === "boundary") {
            const swap = built.instructions.find(
              (instruction) => instruction.programAddress === METEORA_DBC_PROGRAM,
            );
            new DataView(
              swap.data.buffer,
              swap.data.byteOffset,
              swap.data.byteLength,
            ).setBigUint64(16, kind === "exactIn" ? 0n : (1n << 64n) - 1n, true);
          }
          await install(f, signer);
          const beforeIn = await tokenAmount(f.request.tokenAccounts.input),
            beforeOut = await tokenAmount(f.request.tokenAccounts.output);
          await assert.rejects(
            () => send(built, signer),
            (error) => {
              assert.match(
                error.message,
                failure === "slippage"
                  ? /Error Code: ExceededSlippage/
                  : /Error Code: InsufficientLiquidity/,
              );
              context.diagnostic(
                `${reverse ? "base->quote" : "quote->base"} ${kind} ${failure}: ${error.message.match(/Error Code: [^.]+|custom program error: 0x[0-9a-f]+/g)?.join(", ")}`,
              );
              return true;
            },
            `${reverse ? "base->quote" : "quote->base"} ${kind} ${failure}`,
          );
          assert.equal(await tokenAmount(f.request.tokenAccounts.input), beforeIn);
          assert.equal(await tokenAmount(f.request.tokenAccounts.output), beforeOut);
        }
  },
);

test(
  "native Meteora DBC applies a completed linear fee schedule",
  { skip: !endpoint, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const clock = await accountData(SYSVAR_CLOCK_ADDRESS);
    const unixTimestamp = clock.readBigInt64LE(32);
    for (const reverse of [false, true]) {
      const f = await meteoraDbcFixture(signer.address, {
        reverse,
        linear: true,
        unixTimestamp,
        label: `linear:${reverse}`,
      });
      await install(f, signer);
      const built = value(await buildSwapInstructions(f.request));
      const signature = await send(built, signer);
      const receipt = await rpc("getTransaction", [
        signature,
        { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ]);
      assert.equal(receipt.meta.err, null);
      assert.equal(
        -balanceChange(receipt, f.request.tokenAccounts.input),
        built.quote.expectedAmountIn,
      );
      assert.equal(
        balanceChange(receipt, f.request.tokenAccounts.output),
        built.quote.expectedAmountOut,
      );
    }
  },
);

test(
  "native Meteora DBC uses the active linear period from caller slot or timestamp",
  { skip: !endpoint, timeout: 150000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const activationType of [0, 1]) {
      for (const kind of ["exactIn", "exactOut"]) {
        const clock = await accountData(SYSVAR_CLOCK_ADDRESS);
        const slot = clock.readBigUInt64LE(0),
          unixTimestamp = clock.readBigInt64LE(32);
        const point = activationType === 0 ? slot : unixTimestamp;
        const frequency = activationType === 0 ? 100_000n : 3600n;
        const f = await meteoraDbcFixture(signer.address, {
          reverse: activationType === 1,
          linear: true,
          unixTimestamp,
          label: `active-linear:${activationType}:${kind}`,
        });
        const config = f.request.snapshot.accounts[f.config].data;
        const pool = f.request.snapshot.accounts[f.pool].data;
        config[234] = activationType;
        new DataView(config.buffer).setBigUint64(112, frequency, true);
        new DataView(pool.buffer).setBigUint64(
          296,
          point - frequency * 2n - frequency / 2n,
          true,
        );
        const amount =
          kind === "exactIn"
            ? { kind, amountIn: 1_000_003n }
            : { kind, amountOut: 1_000_003n };
        const request = {
          ...f.request,
          amount,
          snapshot: { ...f.request.snapshot, slot, unixTimestamp },
        };
        await install(f, signer);
        const built = value(await buildSwapInstructions(request));
        const signature = await send(built, signer);
        const receipt = await rpc("getTransaction", [
          signature,
          { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ]);
        assert.equal(receipt.meta.err, null);
        assert.equal(
          -balanceChange(receipt, request.tokenAccounts.input),
          built.quote.expectedAmountIn,
        );
        assert.equal(
          balanceChange(receipt, request.tokenAccounts.output),
          built.quote.expectedAmountOut,
        );
        if (activationType === 0 && kind === "exactIn")
          assert.equal(
            built.quote.fees.reduce((sum, fee) => sum + fee.amount, 0n),
            3501n,
          );
      }
    }
  },
);
