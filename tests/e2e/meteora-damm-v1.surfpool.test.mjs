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
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import {
  meteoraDammV1Fixture,
  DAMM_V1_PROGRAM,
  VAULT_PROGRAM,
} from "../fixtures/meteora-damm-v1.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native DAMM v1 tests only accept loopback simulators");
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
async function chainTimestamp() {
  return (await accountData(SYSVAR_CLOCK_ADDRESS)).readBigInt64LE(32);
}
function roundedFee(amount, numerator) {
  return numerator === 0n || amount === 0n ? 0n : (amount * numerator) / 10000n || 1n;
}
async function execute(fixture, signer, context) {
  await install(fixture, signer);
  const build = value(await buildSwapInstructions(fixture.request));
  const reverse = fixture.request.inputMint === fixture.mintB;
  const input = fixture.vaults[reverse ? 1 : 0],
    output = fixture.vaults[reverse ? 0 : 1];
  const beforeInput = await tokenAmount(fixture.request.tokenAccounts.input),
    beforeOutput = await tokenAmount(fixture.request.tokenAccounts.output);
  const beforeFee = await tokenAmount(input.fee),
    beforeReserve = await tokenAmount(input.tokenVault),
    beforeOutReserve = await tokenAmount(output.tokenVault);
  const beforeShares = await tokenAmount(input.share),
    beforeOutShares = await tokenAmount(output.share);
  const signature = await send(build, signer);
  const receipt = await rpc("getTransaction", [
    signature,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);
  assert.ok(receipt);
  assert.equal(receipt.meta.err, null, JSON.stringify(receipt.meta));
  assert.ok(
    receipt.meta.logMessages.some((line) =>
      line.includes(`Program ${DAMM_V1_PROGRAM} invoke`),
    ),
  );
  assert.ok(
    receipt.meta.logMessages.some((line) =>
      line.includes(`Program ${VAULT_PROGRAM} invoke`),
    ),
  );
  const debit = beforeInput - (await tokenAmount(fixture.request.tokenAccounts.input)),
    credit = (await tokenAmount(fixture.request.tokenAccounts.output)) - beforeOutput;
  assert.equal(debit, build.quote.expectedAmountIn);
  assert.equal(credit, build.quote.expectedAmountOut);
  const pool = fixture.request.snapshot.accounts[fixture.pool].data,
    view = new DataView(pool.buffer);
  const trade = roundedFee(debit, view.getBigUint64(330, true));
  const protocol = roundedFee(trade, view.getBigUint64(346, true));
  assert.equal(build.quote.fees[0].amount, trade);
  assert.equal((await tokenAmount(input.fee)) - beforeFee, protocol);
  assert.equal((await tokenAmount(input.tokenVault)) - beforeReserve, debit - protocol);
  assert.equal(beforeOutReserve - (await tokenAmount(output.tokenVault)), credit);
  const inVaultBefore = fixture.request.snapshot.accounts[input.vault].data;
  const inVaultView = new DataView(inVaultBefore.buffer);
  const phase =
    fixture.request.snapshot.unixTimestamp - inVaultView.getBigUint64(1211, true);
  const ratio = phase * inVaultView.getBigUint64(1219, true);
  const locked =
    ratio >= 1000000000000n
      ? 0n
      : (inVaultView.getBigUint64(1203, true) * (1000000000000n - ratio)) /
        1000000000000n;
  const minted = ((debit - protocol) * input.supply) / (input.total - locked);
  assert.equal((await tokenAmount(input.share)) - beforeShares, minted);
  const burn = beforeOutShares - (await tokenAmount(output.share));
  assert.ok(burn > 0n);
  assert.equal(
    output.supply - (await accountData(output.lpMint)).readBigUInt64LE(36),
    burn,
  );
  assert.notEqual(minted, debit - protocol, "Non-unit share conversion is required");
  const inAfter = await accountData(input.vault),
    outAfter = await accountData(output.vault);
  assert.equal(inAfter.readBigUInt64LE(11) - input.total, debit - protocol);
  assert.equal(output.total - outAfter.readBigUInt64LE(11), credit);
  context.diagnostic(
    `${reverse ? "B->A" : "A->B"} debit=${debit} credit=${credit} fee=${trade} protocol=${protocol} minted=${minted} burned=${burn} signature=${signature}`,
  );
}
test(
  "native DAMM v1 exact-input swaps honor non-unit vault shares and protocol fee rounding",
  { skip: !endpoint, timeout: 180000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const [tradeNumerator, protocolNumerator, amountIn] of [
        [25n, 2000n, 1000003n],
        [37n, 3333n, 1000003n],
        [25n, 2000n, 100n],
        [0n, 0n, 1000003n],
      ]) {
        const fixture = await meteoraDammV1Fixture(signer.address, {
          reverse,
          tradeNumerator,
          poolType: tradeNumerator === 0n ? 0 : 1,
          protocolNumerator,
          amountIn,
          label: `fees:${reverse}:${tradeNumerator}:${amountIn}`,
          unixTimestamp: await chainTimestamp(),
        });
        await execute(fixture, signer, context);
      }
  },
);

test(
  "native DAMM v1 swaps match caller-timestamp locked-profit accounting before, at and after degradation completion",
  { skip: !endpoint, timeout: 120000 },
  async (context) => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true])
      for (const phase of ["locked", "releasing", "complete", "after"]) {
        const now = await chainTimestamp();
        const lockedProfit = 500_000_000n;
        const degradation =
          phase === "locked" ? 0n : phase === "releasing" ? 1n : 10_000_000_000n;
        const elapsed = phase === "after" ? 101n : phase === "complete" ? 100n : 50n;
        const fixture = await meteoraDammV1Fixture(signer.address, {
          reverse,
          label: `profit:${reverse}:${phase}`,
          unixTimestamp: now,
          lockedProfit,
          lastReport: now - elapsed,
          degradation,
        });
        await execute(fixture, signer, context);
      }
  },
);
function write(account, offset, amount) {
  new DataView(account.data.buffer).setBigUint64(offset, amount, true);
}
async function unchangedUserBalances(fixture, signer, build, error) {
  const beforeIn = await tokenAmount(fixture.request.tokenAccounts.input),
    beforeOut = await tokenAmount(fixture.request.tokenAccounts.output);
  await assert.rejects(() => send(build, signer), error);
  assert.equal(await tokenAmount(fixture.request.tokenAccounts.input), beforeIn);
  assert.equal(await tokenAmount(fixture.request.tokenAccounts.output), beforeOut);
}
test(
  "native DAMM v1 rejects stale slippage limits, missing output backing and dust without changing user balances",
  { skip: !endpoint, timeout: 120000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const reverse of [false, true]) {
      const stale = await meteoraDammV1Fixture(signer.address, {
        reverse,
        label: `stale:${reverse}`,
        unixTimestamp: await chainTimestamp(),
      });
      const build = value(await buildSwapInstructions(stale.request));
      const output = stale.vaults[reverse ? 0 : 1];
      write(stale.request.snapshot.accounts[output.vault], 11, output.total / 2n);
      write(stale.request.snapshot.accounts[output.tokenVault], 64, output.total / 2n);
      await install(stale, signer);
      await unchangedUserBalances(
        stale,
        signer,
        build,
        /ExceededSlippage|0x1774|"Custom":6004/,
      );
      const empty = await meteoraDammV1Fixture(signer.address, {
        reverse,
        label: `empty:${reverse}`,
        unixTimestamp: await chainTimestamp(),
      });
      const emptyBuild = value(await buildSwapInstructions(empty.request));
      const drained = empty.vaults[reverse ? 0 : 1];
      write(empty.request.snapshot.accounts[drained.tokenVault], 64, 0n);
      assert.equal(
        (await buildSwapInstructions(empty.request)).error.code,
        "INVALID_ACCOUNT",
      );
      await install(empty, signer);
      await unchangedUserBalances(
        empty,
        signer,
        emptyBuild,
        /insufficient funds|InsufficientFunds|custom program error: 0x1\b/,
      );
      const dust = await meteoraDammV1Fixture(signer.address, {
        reverse,
        label: `dust:${reverse}`,
        unixTimestamp: await chainTimestamp(),
      });
      const dustBuild = value(await buildSwapInstructions(dust.request));
      const dustData = dustBuild.instructions[0].data;
      new DataView(
        dustData.buffer,
        dustData.byteOffset,
        dustData.byteLength,
      ).setBigUint64(8, 1n, true);
      new DataView(
        dustData.buffer,
        dustData.byteOffset,
        dustData.byteLength,
      ).setBigUint64(16, 0n, true);
      const dustResult = await buildSwapInstructions({
        ...dust.request,
        amount: { kind: "exactIn", amountIn: 1n },
      });
      assert.equal(dustResult.error.code, "INSUFFICIENT_LIQUIDITY");
      await install(dust, signer);
      await unchangedUserBalances(
        dust,
        signer,
        dustBuild,
        /custom program error: 0x177d|"Custom":6013/,
      );
    }
  },
);
