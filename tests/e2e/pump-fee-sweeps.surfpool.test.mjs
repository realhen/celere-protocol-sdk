import { preservePumpConfiguration } from "../fixtures/pump-surfpool-state.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { buildSwapInstructions } from "../../dist/index.js";
import {
  getPumpSweepCreatorFeeInstruction,
  getPumpSweepProtocolFeeInstruction,
} from "../../dist/protocols/pump/instructions/bonding-curve/index.js";
import {
  getPumpAmmSweepCreatorFeeInstruction,
  getPumpAmmSweepProtocolFeeInstruction,
} from "../../dist/protocols/pump/instructions/amm/index.js";
import { pumpV3Fixture } from "../fixtures/pump-v3.mjs";
import { pumpAmmQuotesFixture } from "../fixtures/pump-amm-quotes.mjs";
import {
  PUMP,
  PUMP_AMM,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  ata,
  pda,
  deterministicAddress,
} from "../fixtures/pump-amm.mjs";
import { rpc, submitInstructions } from "../fixtures/pump-helpers.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
preservePumpConfiguration(endpoint);
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw Error("Fee sweep tests require loopback Surfpool");
const decode = getAddressDecoder();
const encode = getAddressEncoder();
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
  return result.value;
}
async function install(snapshot) {
  for (const a of Object.values(snapshot.accounts)) {
    if (a)
      await rpc(endpoint, "surfnet_setAccount", [
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
async function account(address) {
  return (await rpc(endpoint, "getAccountInfo", [address, { encoding: "base64" }])).value;
}
async function data(address) {
  return Buffer.from((await account(address)).data[0], "base64");
}
async function tokenBalance(address) {
  const a = await account(address);
  return a ? Buffer.from(a.data[0], "base64").readBigUInt64LE(64) : 0n;
}
async function lamports(address) {
  return BigInt((await rpc(endpoint, "getBalance", [address])).value);
}
function signed128(bytes, offset) {
  return bytes.readBigUInt64LE(offset) | (bytes.readBigInt64LE(offset + 8) << 64n);
}
async function refresh(snapshot, addresses) {
  for (const address of addresses) {
    const a = await account(address);
    snapshot.accounts[address] = {
      ...snapshot.accounts[address],
      data: Uint8Array.from(Buffer.from(a.data[0], "base64")),
      lamports: BigInt(a.lamports),
    };
  }
}

// Exercises exported builders against native programs, including destination account creation.
test(
  "Pump v3 creator and protocol sweeps pay retained fees without changing swap prices",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "token"]) {
      const f = await pumpV3Fixture(signer.address, {
        quote,
        quote2022: quote === "token",
        label: `sweeps:${quote}`,
      });
      const beforeQuote = value(await buildSwapInstructions(f.request)).quote;
      await install(f.request.snapshot);
      const creator = decode.decode(
        f.request.snapshot.accounts[f.pool].data.subarray(49, 81),
      );
      const protocolRecipient = decode.decode(
        f.request.snapshot.accounts[f.global].data.subarray(41, 73),
      );
      for (const kind of ["creator", "protocol"]) {
        const recipient =
          kind === "creator"
            ? await pda(PUMP, "creator-vault", creator)
            : protocolRecipient;
        const recipientAta = await ata(recipient, f.quoteMint, f.quoteProgram);
        // Existing rent floor isolates the fee transfer from creator-vault initialization rent.
        if (quote === "sol")
          await rpc(endpoint, "surfnet_setAccount", [
            recipient,
            { owner: SYSTEM, data: "", lamports: 10_000_000, executable: false },
          ]);
        const accounts = {
          payer: signer.address,
          global: f.global,
          baseMint: f.mint,
          quoteMint: f.quoteMint,
          quoteTokenProgram: f.quoteProgram,
          bondingCurve: f.pool,
          associatedQuoteBondingCurve: f.quoteVault,
          recipient,
          associatedQuoteRecipient: recipientAta,
          eventAuthority: await pda(PUMP, "__event_authority"),
        };
        const builder =
          kind === "creator"
            ? getPumpSweepCreatorFeeInstruction
            : getPumpSweepProtocolFeeInstruction;
        const before = await data(f.pool),
          offset = kind === "creator" ? 125 : 133,
          fee = before.readBigUInt64LE(offset);
        const beforeRecipient =
          quote === "sol" ? await lamports(recipient) : await tokenBalance(recipientAta);
        const beforeVault =
          quote === "sol" ? await lamports(f.pool) : await tokenBalance(f.quoteVault);
        const signature = await submitInstructions(endpoint, [builder(accounts)], signer);
        assert.equal(
          (
            await rpc(endpoint, "getTransaction", [
              signature,
              { maxSupportedTransactionVersion: 0 },
            ])
          ).meta.err,
          null,
        );
        assert.equal((await data(f.pool)).readBigUInt64LE(offset), 0n);
        assert.equal(
          (quote === "sol"
            ? await lamports(recipient)
            : await tokenBalance(recipientAta)) - beforeRecipient,
          fee,
        );
        assert.equal(
          beforeVault -
            (quote === "sol" ? await lamports(f.pool) : await tokenBalance(f.quoteVault)),
          fee,
        );
        const afterRecipient =
          quote === "sol" ? await lamports(recipient) : await tokenBalance(recipientAta);
        await submitInstructions(endpoint, [builder(accounts)], signer);
        assert.equal(
          quote === "sol" ? await lamports(recipient) : await tokenBalance(recipientAta),
          afterRecipient,
          "empty sweep is a no-op",
        );
      }
      await refresh(
        f.request.snapshot,
        quote === "sol" ? [f.pool] : [f.pool, f.quoteVault],
      );
      assert.deepEqual(value(await buildSwapInstructions(f.request)).quote, beforeQuote);
    }
  },
);

test(
  "PumpSwap sweeps preserve effective reserves and reject redirected payouts atomically",
  { skip: !endpoint, timeout: 240000 },
  async () => {
    const signer = await generateKeyPairSigner();
    for (const quote of ["sol", "usdc", "exotic"]) {
      const f = await pumpAmmQuotesFixture(signer.address, {
        quote,
        quoteTokenProgram: quote === "exotic" ? TOKEN_2022 : TOKEN,
        label: `sweeps:${quote}`,
      });
      const curveFixture = await pumpV3Fixture(signer.address);
      const protocolRecipient = decode.decode(
        curveFixture.request.snapshot.accounts[curveFixture.global].data.subarray(41, 73),
      );
      for (let index = 0; index < 8; index++)
        f.request.snapshot.accounts[f.global].data.set(
          encode.encode(protocolRecipient),
          57 + 32 * index,
        );
      if (quote === "sol") {
        for (const address of [f.quoteVault, f.userQuote, f.buybackAta]) {
          const a = f.request.snapshot.accounts[address],
            view = new DataView(a.data.buffer);
          view.setUint32(109, 1, true);
          view.setBigUint64(113, 2_039_280n, true);
          a.lamports = view.getBigUint64(64, true) + 2_039_280n;
          // Keep JSON numeric lamports exactly representable in this synthetic fixture.
          if (address === f.userQuote) {
            view.setBigUint64(64, 1_000_000_000_000n, true);
            a.lamports = 1_000_002_039_280n;
          }
        }
      }
      const beforeQuote = value(await buildSwapInstructions(f.request)).quote;
      await install(f.request.snapshot);
      for (const kind of ["creator", "protocol"]) {
        const recipient =
          kind === "creator"
            ? await pda(PUMP_AMM, "creator_vault", f.coinCreator)
            : protocolRecipient;
        const recipientTokenAccount = await ata(
          recipient,
          f.quoteMint,
          f.quoteTokenProgram,
        );
        const accounts = {
          payer: signer.address,
          globalConfig: f.global,
          pool: f.pool,
          quoteMint: f.quoteMint,
          quoteTokenProgram: f.quoteTokenProgram,
          poolQuoteTokenAccount: f.quoteVault,
          recipient,
          recipientTokenAccount,
          eventAuthority: await pda(PUMP_AMM, "__event_authority"),
        };
        const builder =
          kind === "creator"
            ? getPumpAmmSweepCreatorFeeInstruction
            : getPumpAmmSweepProtocolFeeInstruction;
        const before = await data(f.pool),
          offset = kind === "creator" ? 279 : 271,
          fee = before.readBigUInt64LE(offset),
          vaultBefore = await tokenBalance(f.quoteVault),
          recipientBefore = await tokenBalance(recipientTokenAccount);
        const badRecipient = deterministicAddress("invalid-sweep-recipient");
        await assert.rejects(
          submitInstructions(
            endpoint,
            [
              builder({
                ...accounts,
                recipient: badRecipient,
                recipientTokenAccount: await ata(
                  badRecipient,
                  f.quoteMint,
                  f.quoteTokenProgram,
                ),
              }),
            ],
            signer,
          ),
        );
        assert.deepEqual(await data(f.pool), before);
        assert.equal(await tokenBalance(f.quoteVault), vaultBefore);
        await submitInstructions(endpoint, [builder(accounts)], signer);
        const after = await data(f.pool);
        assert.equal(after.readBigUInt64LE(offset), 0n);
        assert.equal((await tokenBalance(recipientTokenAccount)) - recipientBefore, fee);
        assert.equal(vaultBefore - (await tokenBalance(f.quoteVault)), fee);
        assert.equal(signed128(after, 245) - signed128(before, 245), fee);
        await submitInstructions(endpoint, [builder(accounts)], signer);
        assert.equal(await tokenBalance(recipientTokenAccount), recipientBefore + fee);
      }
      await refresh(f.request.snapshot, [f.pool, f.quoteVault]);
      assert.deepEqual(value(await buildSwapInstructions(f.request)).quote, beforeQuote);
    }
  },
);
