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
import {
  getBoopBuyTokenInstruction,
  getBoopSellTokenInstruction,
} from "../../dist/protocols/boop/instructions/index.js";
import { boopAdapter } from "../../dist/protocols/boop/adapter.js";
const { buildSwapInstructions } = createProtocolSdk([boopAdapter]);
import { boopFixture, BOOP_PROGRAM } from "../fixtures/boop.mjs";
const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Boop native test requires loopback");
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
async function install(f, s) {
  await rpc("surfnet_setAccount", [
    s.address,
    {
      lamports: 100_000_000_000,
      owner: SYSTEM_PROGRAM_ADDRESS,
      executable: false,
      data: "",
    },
  ]);
  for (const a of Object.values(f.request.snapshot.accounts))
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
async function send(instruction, signer) {
  const latest = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const result = compileTransaction({
    instructions: Array.isArray(instruction) ? instruction : [instruction],
    feePayer: signer.address,
    lifetime: {
      blockhash: latest.blockhash,
      lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
    },
  });
  assert.equal(result.ok, true);
  const signed = await signTransaction([signer.keyPair], result.value.transaction);
  return rpc("sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
}
function raw(f, signer, reverse) {
  const accounts = {
    mint: f.mint,
    bondingCurve: f.pool,
    tradingFeesVault: f.feesVault,
    bondingCurveVault: f.tokenVault,
    bondingCurveSolVault: f.solVault,
    config: f.config,
  };
  return reverse
    ? getBoopSellTokenInstruction(
        {
          ...accounts,
          sellerTokenAccount: f.userToken,
          seller: signer.address,
          recipient: signer.address,
        },
        { sellAmount: f.request.amount.amountIn, amountOutMin: 0n },
      )
    : getBoopBuyTokenInstruction(
        {
          ...accounts,
          recipientTokenAccount: f.userToken,
          buyer: signer.address,
          vaultAuthority: f.authority,
        },
        { buyAmount: f.request.amount.amountIn, amountOutMin: 0n },
      );
}

function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
  return result.value;
}
function accountIndex(receipt, address) {
  return receipt.transaction.message.accountKeys.findIndex(
    (key) => (typeof key === "string" ? key : key.pubkey) === address,
  );
}
function tokenChange(receipt, address) {
  const index = accountIndex(receipt, address);
  const before = receipt.meta.preTokenBalances.find(
    (balance) => balance.accountIndex === index,
  );
  const after = receipt.meta.postTokenBalances.find(
    (balance) => balance.accountIndex === index,
  );
  assert.ok(before && after);
  return BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount);
}
function lamportChange(receipt, address) {
  const index = accountIndex(receipt, address);
  return (
    BigInt(receipt.meta.postBalances[index]) - BigInt(receipt.meta.preBalances[index])
  );
}
async function account(address) {
  const info = (
    await rpc("getAccountInfo", [
      address,
      { encoding: "base64", commitment: "confirmed" },
    ])
  ).value;
  return { data: Buffer.from(info.data[0], "base64"), lamports: BigInt(info.lamports) };
}
function write(data, offset, amount) {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(
    offset,
    amount,
    true,
  );
}
async function checkSwap(f, signer, context) {
  await install(f, signer);
  const built = value(await buildSwapInstructions(f.request));
  const signature = await send(built.instructions, signer);
  const receipt = await rpc("getTransaction", [
    signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
  assert.equal(receipt.meta.err, null);
  assert.ok(
    receipt.meta.logMessages.some((line) =>
      line.includes(`Program ${BOOP_PROGRAM} invoke`),
    ),
  );
  const reverse = f.request.inputMint === f.mint;
  const ownerSol = lamportChange(receipt, signer.address) + BigInt(receipt.meta.fee);
  const tokens = tokenChange(receipt, f.userToken);
  assert.equal(reverse ? -tokens : -ownerSol, built.quote.expectedAmountIn);
  assert.equal(reverse ? ownerSol : tokens, built.quote.expectedAmountOut);
  const fee = built.quote.fees[0].amount;
  assert.equal(tokenChange(receipt, f.feesVault), fee);
  assert.equal(lamportChange(receipt, f.feesVault), fee);
  assert.equal(tokenChange(receipt, f.tokenVault), -tokens);
  const netSol = reverse
    ? -(built.quote.expectedAmountOut + fee)
    : built.quote.expectedAmountIn - fee;
  assert.equal(lamportChange(receipt, f.solVault), netSol);
  const initial = Buffer.from(f.request.snapshot.accounts[f.pool].data),
    state = (await account(f.pool)).data;
  assert.equal(state.readBigUInt64LE(104) - initial.readBigUInt64LE(104), netSol);
  assert.equal(state.readBigUInt64LE(112) - initial.readBigUInt64LE(112), -tokens);
  const event = Buffer.from(
    receipt.meta.logMessages.find((line) => line.startsWith("Program data: ")).slice(14),
    "base64",
  );
  assert.equal(
    event.readBigUInt64LE(40),
    reverse ? built.quote.expectedAmountIn : built.quote.expectedAmountIn - fee,
  );
  assert.equal(event.readBigUInt64LE(48), built.quote.expectedAmountOut);
  assert.equal(event.readBigUInt64LE(56), fee);
  context.diagnostic(
    `${reverse ? "sell" : "buy"}: input=${built.quote.expectedAmountIn} output=${built.quote.expectedAmountOut} fee=${fee} signature=${signature}`,
  );
  return { built, state };
}
test(
  "native Boop selector31 matches fixed-supply quotes and floor fees in both directions",
  { skip: !endpoint, timeout: 180000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      for (const feeBps of [0, 7, 100, 200]) {
        const f = await boopFixture(signer.address, { reverse, feeBps, label: "native" });
        f.request.amount.amountIn = reverse ? 1_000_000_000_000_099n : 100_000_099n;
        write(f.request.snapshot.accounts[f.pool].data, 80, 123n);
        await checkSwap(f, signer, context);
      }
    }
  },
);
test(
  "native Boop buys expose graduation partial fills and quote initial curves",
  { skip: !endpoint, timeout: 120000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    const f = await boopFixture(signer.address, { label: "boundary" });
    f.request.amount.amountIn = 80_000_000_003n;
    const full = await buildSwapInstructions({ ...f.request, fillPolicy: "requireFull" });
    assert.equal(full.ok, false);
    assert.equal(full.error.code, "UNSUPPORTED_FILL_POLICY");
    const { built, state } = await checkSwap(f, signer, context);
    assert.equal(built.execution.mayPartiallyFill, true);
    assert.ok(built.quote.expectedAmountIn < built.quote.amountIn);
    assert.equal(built.quote.expectedAmountIn, 75_757_575_757n);
    assert.equal(state.readBigUInt64LE(104), state.readBigUInt64LE(88));
    assert.equal(state[124], 0, "Graduation is a separate native operation");
    const first = await boopFixture(signer.address, { label: "boundary" });
    write(first.request.snapshot.accounts[first.pool].data, 104, 0n);
    write(
      first.request.snapshot.accounts[first.pool].data,
      112,
      1_000_000_000_000_000_000n,
    );
    write(
      first.request.snapshot.accounts[first.tokenVault].data,
      64,
      1_000_000_000_000_000_000n,
    );
    first.request.snapshot.accounts[first.solVault].lamports = 890_880n;
    await checkSwap(first, signer, context);
    first.request.amount.amountIn = 40_000_000_003n;
    const largeFirst = await checkSwap(first, signer, context);
    assert.ok(largeFirst.built.quote.expectedAmountOut > 500_000_000_000_000_000n);
  },
);
test(
  "native Boop stale minimums and exhausted SOL settle atomically",
  { skip: !endpoint, timeout: 150000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      const f = await boopFixture(signer.address, { reverse, label: "failure" });
      f.request.amount.amountIn = reverse ? 1_000_000_000_000_099n : 100_000_099n;
      const built = value(await buildSwapInstructions(f.request));
      const newSol = reverse ? 5_000_000_000n : 20_000_000_000n;
      const newTokens =
        (30_000_000_000n * 1_000_000_000_000_000_000n) / (newSol + 30_000_000_000n);
      write(f.request.snapshot.accounts[f.pool].data, 104, newSol);
      write(f.request.snapshot.accounts[f.pool].data, 112, newTokens);
      write(f.request.snapshot.accounts[f.tokenVault].data, 64, newTokens);
      f.request.snapshot.accounts[f.solVault].lamports = newSol;
      await install(f, signer);
      const before = await Promise.all([
        account(f.pool),
        account(f.userToken),
        account(f.solVault),
        account(f.feesVault),
      ]);
      await assert.rejects(() => send(built.instructions, signer), /AmountOutTooLow/);
      assert.deepEqual(
        await Promise.all([
          account(f.pool),
          account(f.userToken),
          account(f.solVault),
          account(f.feesVault),
        ]),
        before,
      );
    }
    const f = await boopFixture(signer.address, { reverse: true, label: "failure" });
    f.request.amount.amountIn = 300_000_000_000_000_003n;
    write(f.request.snapshot.accounts[f.userToken].data, 64, 400_000_000_000_000_003n);
    const rejected = await buildSwapInstructions(f.request);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "INSUFFICIENT_LIQUIDITY");
    await install(f, signer);
    const before = await Promise.all([
      account(f.pool),
      account(f.userToken),
      account(f.solVault),
      account(f.feesVault),
    ]);
    await assert.rejects(
      () => send(raw(f, signer, true), signer),
      /insufficient lamports/,
    );
    assert.deepEqual(
      await Promise.all([
        account(f.pool),
        account(f.userToken),
        account(f.solVault),
        account(f.feesVault),
      ]),
      before,
    );
  },
);
