import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPairSigner, createSolanaRpc } from "@solana/kit";
import {
  getCreateAccountInstruction,
  getInitializeNonceAccountInstruction,
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import { SenderClient, zeroSlot } from "../../dist/sender/index.js";
import { discoverNonceAccounts } from "../../dist/nonce/index.js";
import { rpc, submitInstructions } from "../fixtures/pump-helpers.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
test(
  "native nonce fan-out executes one transfer and discovers the advanced account",
  { skip: !endpoint, timeout: 60000 },
  async (t) => {
    const [payer, nonce, authority, recipient, other] = await Promise.all(
      Array.from({ length: 5 }, () => generateKeyPairSigner()),
    );
    await rpc(endpoint, "requestAirdrop", [payer.address, 1_000_000_000]);
    await rpc(endpoint, "requestAirdrop", [recipient.address, 1_000_000]);
    const rent = await rpc(endpoint, "getMinimumBalanceForRentExemption", [80]);
    await submitInstructions(
      endpoint,
      [
        getCreateAccountInstruction({
          payer,
          newAccount: nonce,
          lamports: BigInt(rent),
          space: 80n,
          programAddress: SYSTEM_PROGRAM_ADDRESS,
        }),
        getInitializeNonceAccountInstruction({
          nonceAccount: nonce.address,
          nonceAuthority: authority.address,
        }),
      ],
      payer,
      [payer, nonce],
    );
    const kitRpc = createSolanaRpc(endpoint);
    const discovered = await discoverNonceAccounts({
      rpc: kitRpc,
      authority: authority.address,
    });
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].account, nonce.address);
    assert.deepEqual(
      await discoverNonceAccounts({ rpc: kitRpc, authority: other.address }),
      [],
    );
    const before = await rpc(endpoint, "getBalance", [recipient.address]);
    const server = createServer((req, res) => {
      void (async () => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: Buffer.concat(chunks),
        });
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      })().catch((error) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const sender = new SenderClient({
      defaultRpc: { url: endpoint },
      routes: [
        zeroSlot({
          apiKey: "local-fixture",
          endpoint: `http://127.0.0.1:${server.address().port}`,
        }),
      ],
    });
    const submission = await sender.send({
      feePayer: payer.address,
      nonce: discovered[0],
      signers: [payer, authority],
      instructions: [
        getTransferSolInstruction({
          source: payer,
          destination: recipient.address,
          amount: 1_000_000n,
        }),
      ],
      fees: {
        computeUnitLimit: 100_000,
        computeUnitPriceMicroLamports: 10_000n,
        tipLamports: 1_000_000n,
      },
    });
    assert.equal(submission.variants.length, 2);
    await submission.results;
    // Chain tracking belongs to this consumer, not SenderClient.
    let landed;
    for (let i = 0; i < 100; i++) {
      const states = await rpc(endpoint, "getSignatureStatuses", [
        submission.variants.map((v) => v.signature),
      ]);
      landed = states.value.filter(
        (s) =>
          s &&
          s.err === null &&
          ["confirmed", "finalized"].includes(s.confirmationStatus),
      );
      if (landed.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(landed.length, 1);
    const after = await rpc(endpoint, "getBalance", [recipient.address]);
    assert.equal(after.value - before.value, 1_000_000);
    const refreshed = await discoverNonceAccounts({
      rpc: kitRpc,
      authority: authority.address,
    });
    assert.notEqual(refreshed[0].value, discovered[0].value);
    // Replaying every old variant must not repeat the business transfer.
    for (const variant of submission.variants)
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [
            Buffer.from(variant.wireBytes).toString("base64"),
            { encoding: "base64", skipPreflight: true, maxRetries: 0 },
          ],
        }),
      });
    assert.equal(
      (await rpc(endpoint, "getBalance", [recipient.address])).value,
      after.value,
    );
  },
);
