import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getSignatureFromTransaction,
  getCompiledTransactionMessageDecoder,
  signTransaction,
} from "@solana/kit";
import {
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import {
  SenderClient,
  AstralaneSender,
  BlockRazorSender,
  ZeroSlotSender,
  NextBlockSender,
  HeliusSender,
  AstralaneTier,
  HeliusSenderMode,
  Region,
  SenderProvider,
  SubmissionStatus,
  SenderErrorCode,
  SenderError,
  SenderConfigurationError,
  SenderRequestError,
  NonceRequiredError,
  TipTooLowError,
  PriorityFeeTooLowError,
  SenderCompilationError,
  SenderSigningError,
  SenderAbortedError,
} from "../../dist/sender/index.js";

async function fixture(t, handler) {
  const server = createServer((req, res) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await handler(req, res, Buffer.concat(chunks));
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
  return `http://127.0.0.1:${server.address().port}`;
}
async function trade() {
  const [payer, authority, account, recipient] = await Promise.all(
    Array.from({ length: 4 }, () => generateKeyPairSigner()),
  );
  return {
    payer,
    authority,
    request: {
      feePayer: payer.address,
      nonce: {
        account: account.address,
        authority: authority.address,
        value: recipient.address,
      },
      instructions: [
        getTransferSolInstruction({
          source: payer,
          destination: recipient.address,
          amount: 1_000_000n,
        }),
      ],
      fees: {
        computeUnitLimit: 100_000,
        computeUnitPriceMicroLamports: 100_000n,
        tipLamports: 1_000_000n,
      },
      signers: [payer, authority],
    },
  };
}
function signature(bytes) {
  return getSignatureFromTransaction(getTransactionDecoder().decode(bytes));
}
const errorClasses = {
  [SenderErrorCode.InvalidConfiguration]: SenderConfigurationError,
  [SenderErrorCode.InvalidRequest]: SenderRequestError,
  [SenderErrorCode.NonceRequired]: NonceRequiredError,
  [SenderErrorCode.TipTooLow]: TipTooLowError,
  [SenderErrorCode.PriorityFeeTooLow]: PriorityFeeTooLowError,
  [SenderErrorCode.CompilationFailed]: SenderCompilationError,
  [SenderErrorCode.SigningFailed]: SenderSigningError,
  [SenderErrorCode.Aborted]: SenderAbortedError,
};
const code = (value) => (error) => {
  assert.ok(error instanceof SenderError);
  assert.ok(error instanceof errorClasses[value]);
  return error.code === value;
};

test("consumer fans out every HTTP adapter before responses, batch-signs and shares regional variants", async (t) => {
  const received = [];
  let release;
  const allArrived = new Promise((resolve) => {
    release = resolve;
  });
  const url = await fixture(t, (req, res, body) => {
    const path = new URL(req.url, "http://localhost");
    const binary = path.pathname.startsWith("/astralane");
    const json = binary ? undefined : JSON.parse(body);
    const bytes = binary
      ? body
      : Buffer.from(
          json.params?.[0] ?? json.transaction?.content ?? json.transaction,
          "base64",
        );
    received.push({ path, headers: req.headers, json, bytes, res });
    if (received.length === 8) release();
  });
  const { request } = await trade();
  const defaultRpc = { url: `${url}/rpc` };
  const options = (name) => ({
    apiKey: "fixture-secret",
    endpoint: `${url}/${name}`,
    name,
  });
  const client = new SenderClient({
    defaultRpc,
    routes: [
      new AstralaneSender({ ...options("astralane-fr"), region: Region.Frankfurt }),
      new AstralaneSender({ ...options("astralane-ny"), region: Region.NewYork }),
      new BlockRazorSender(options("blockrazor")),
      new ZeroSlotSender(options("zeroslot")),
      new NextBlockSender(options("nextblock")),
      new HeliusSender(options("helius-max")),
      new HeliusSender({ ...options("helius-swqos"), mode: HeliusSenderMode.SwqosOnly }),
    ],
  });
  // Public SDK instances must not expose credential-bearing configuration when inspected.
  assert.equal(JSON.stringify(client), "{}");
  assert.deepEqual(Reflect.ownKeys(client), []);
  const batches = [];
  const observed = [];
  const submitted = await client.send({
    ...request,
    fees: {
      ...request.fees,
      tipOverrides: {
        [SenderProvider.BlockRazor]: 100_000n,
        [SenderProvider.NextBlock]: 100_000n,
      },
    },
    signers: request.signers.map((signer) => ({
      address: signer.address,
      signTransactions: async (txs) => {
        batches.push(txs.length);
        return signer.signTransactions(txs);
      },
    })),
    onRouteResult: async (result) => {
      observed.push(result);
      throw new Error("Application callback failure");
    },
  });
  assert.deepEqual(batches, [6, 6]);
  assert.equal(submitted.variants.length, 6);
  await Promise.race([
    allArrived,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Routes serialized or missing")),
        2000,
      );
      timer.unref();
    }),
  ]);
  assert.equal(observed.length, 0, "send returns before route responses");
  for (const { path, headers, json, bytes, res } of received) {
    const tx = getTransactionDecoder().decode(bytes);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    assert.equal(msg.lifetimeToken, request.nonce.value);
    assert.equal(
      msg.staticAccounts[msg.instructions[0].programAddressIndex],
      SYSTEM_PROGRAM_ADDRESS,
    );
    assert.equal(
      new DataView(
        msg.instructions[0].data.buffer,
        msg.instructions[0].data.byteOffset,
      ).getUint32(0, true),
      4,
    );
    assert.equal(Object.keys(tx.signatures).length, 2);
    if (path.pathname.startsWith("/astralane")) {
      assert.equal(headers["content-type"], "application/octet-stream");
      assert.equal(path.searchParams.get("method"), "sendTransaction");
      assert.equal(path.searchParams.get("api-key"), "fixture-secret");
    } else if (path.pathname === "/blockrazor") {
      assert.equal(headers.apikey, "fixture-secret");
      assert.equal(json.mode, "fast");
    } else if (path.pathname === "/nextblock") {
      assert.equal(headers.authorization, "fixture-secret");
      assert.equal(json.skipPreFlight, true);
      assert.equal(json.disableRetries, true);
    } else {
      assert.equal(json.method, "sendTransaction");
      assert.deepEqual(json.params[1], {
        encoding: "base64",
        skipPreflight: true,
        maxRetries: 0,
      });
      if (path.pathname !== "/rpc")
        assert.equal(path.searchParams.get("api-key"), "fixture-secret");
      assert.equal(
        path.searchParams.get("swqos_only"),
        path.pathname === "/helius-swqos" ? "true" : null,
      );
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        path.pathname === "/blockrazor" || path.pathname === "/nextblock"
          ? { signature: signature(bytes) }
          : { jsonrpc: "2.0", result: signature(bytes) },
      ),
    );
  }
  const results = await submitted.results;
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r.status === SubmissionStatus.Accepted));
  assert.equal(observed.length, 8);
  assert.equal(new Set(results.map((r) => r.signature)).size, 6);
  assert.equal(JSON.stringify(results).includes("fixture-secret"), false);
  const ordinary = { ...request };
  delete ordinary.nonce;
  const simple = new SenderClient({ defaultRpc }).prepare({
    ...ordinary,
    lifetime: { blockhash: request.nonce.value, lastValidBlockHeight: 1n },
  });
  assert.equal(simple.variants.length, 1, "RPC-only clients have a single variant");
});

test("consumer sends through an RPC-only client with an explicit recent blockhash", async (t) => {
  const received = [];
  const url = await fixture(t, (req, res, body) => {
    const json = JSON.parse(body);
    const bytes = Buffer.from(json.params[0], "base64");
    received.push(getTransactionDecoder().decode(bytes));
    res.end(JSON.stringify({ result: signature(bytes) }));
  });
  const { payer, request } = await trade();
  const { nonce, ...ordinary } = request;
  const sender = new SenderClient({ defaultRpc: { url } });
  const submission = await sender.send({
    ...ordinary,
    signers: [payer],
    lifetime: { blockhash: nonce.value, lastValidBlockHeight: 1n },
  });
  const results = await submission.results;
  assert.equal(submission.variants.length, 1);
  assert.equal(received.length, 1);
  assert.deepEqual(
    results.map((result) => result.provider),
    [SenderProvider.Rpc],
  );
  assert.equal(results[0].status, SubmissionStatus.Accepted);
  const message = getCompiledTransactionMessageDecoder().decode(received[0].messageBytes);
  assert.equal(message.lifetimeToken, nonce.value);
  assert.equal(
    message.instructions.length,
    3,
    "compute budget plus the caller transfer, without nonce advance or provider tip",
  );
});

test("consumer gets independent rejection, ambiguous response and bounded timeout observations", async (t) => {
  const url = await fixture(t, (req, res, body) => {
    if (req.url.startsWith("/hang")) {
      res.writeHead(200);
      res.write('{"result":');
      return;
    }
    if (req.url.startsWith("/reject")) {
      res.writeHead(429);
      res.end("secret should not escape");
      return;
    }
    if (req.url.startsWith("/mismatch")) {
      res.end(JSON.stringify({ result: "unrelated-signature" }));
      return;
    }
    const json = JSON.parse(body);
    res.end(JSON.stringify({ result: signature(Buffer.from(json.params[0], "base64")) }));
  });
  const { request } = await trade();
  const client = new SenderClient({
    defaultRpc: { url },
    routes: [
      new ZeroSlotSender({ apiKey: "secret", endpoint: `${url}/hang`, timeoutMs: 100 }),
      new ZeroSlotSender({ apiKey: "secret", endpoint: `${url}/reject` }),
      new ZeroSlotSender({ apiKey: "secret", endpoint: `${url}/mismatch` }),
    ],
  });
  const submitted = await client.send(request);
  const results = await submitted.results;
  assert.deepEqual(
    results.map((r) => r.status),
    [
      SubmissionStatus.Accepted,
      SubmissionStatus.Unknown,
      SubmissionStatus.Rejected,
      SubmissionStatus.Unknown,
    ],
  );
  assert.equal(results[1].httpStatus, 200);
  assert.ok(results[1].elapsedMs < 2000);
  assert.equal(JSON.stringify(results).includes("secret"), false);
});

test("consumer validates nonce and fee policy before invoking wallets or networking", async () => {
  const { request } = await trade();
  let calls = 0;
  const client = new SenderClient({
    defaultRpc: { url: "http://localhost:1" },
    fetch: async () => {
      calls++;
      throw new Error();
    },
    routes: [new HeliusSender({ apiKey: "test" })],
  });
  const { nonce, ...rest } = request;
  await assert.rejects(client.send(rest), code(SenderErrorCode.InvalidRequest));
  await assert.rejects(
    client.send({
      ...request,
      lifetime: { blockhash: nonce.value, lastValidBlockHeight: 1n },
    }),
    code(SenderErrorCode.InvalidRequest),
  );
  await assert.rejects(
    client.send({
      ...rest,
      lifetime: { blockhash: nonce.value, lastValidBlockHeight: 1n },
    }),
    code(SenderErrorCode.NonceRequired),
  );
  await assert.rejects(
    client.send({ ...request, fees: { ...request.fees, tipLamports: 0n } }),
    code(SenderErrorCode.TipTooLow),
  );
  await assert.rejects(
    client.send({
      ...request,
      fees: { ...request.fees, computeUnitPriceMicroLamports: 0n },
    }),
    code(SenderErrorCode.PriorityFeeTooLow),
  );
  await assert.rejects(
    client.send({ ...request, signers: [request.signers[0]] }),
    code(SenderErrorCode.SigningFailed),
  );
  await assert.rejects(
    client.send({ ...request, signal: globalThis.AbortSignal.abort() }),
    code(SenderErrorCode.Aborted),
  );
  await assert.rejects(
    client.send({
      ...request,
      signers: request.signers.map((s) => ({
        address: s.address,
        signTransactions: async (txs) =>
          txs.map(() => ({ [s.address]: new Uint8Array(64) })),
      })),
    }),
    code(SenderErrorCode.SigningFailed),
  );
  await assert.rejects(
    client.send({ ...request, fees: { ...request.fees, tipLamports: -1n } }),
    code(SenderErrorCode.InvalidRequest),
  );
  await assert.rejects(
    client.send({
      ...request,
      instructions: [{ programAddress: request.feePayer, data: new Uint8Array(2000) }],
    }),
    code(SenderErrorCode.CompilationFailed),
  );
  assert.equal(calls, 0);
  assert.throws(
    () => new ZeroSlotSender({ apiKey: "test", region: Region.London }),
    code(SenderErrorCode.InvalidConfiguration),
  );
});

test("consumer externally signs a prepared plan; altered messages and signatures cannot be submitted", async (t) => {
  let calls = 0;
  const url = await fixture(t, (_req, res, body) => {
    calls++;
    const json = JSON.parse(body);
    res.end(JSON.stringify({ result: signature(Buffer.from(json.params[0], "base64")) }));
  });
  const { request, payer, authority } = await trade();
  const client = new SenderClient({ defaultRpc: { url } });
  const prepared = client.prepare(request);
  const signed = await Promise.all(
    prepared.variants.map((v) =>
      signTransaction([payer.keyPair, authority.keyPair], structuredClone(v.transaction)),
    ),
  );
  const changed = structuredClone(signed);
  changed[0].messageBytes[5] ^= 1;
  await assert.rejects(
    client.submitSigned(prepared, changed),
    code(SenderErrorCode.SigningFailed),
  );
  assert.equal(calls, 0);
  // Mutating the public plan cannot rewrite its private validation baseline.
  prepared.variants[0].transaction.messageBytes[5] ^= 1;
  const reversed = signed.map((tx) => ({
    ...tx,
    signatures: Object.fromEntries(Object.entries(tx.signatures).reverse()),
  }));
  const submitted = await client.submitSigned(prepared, reversed);
  assert.equal(submitted.variants[0].signature, getSignatureFromTransaction(signed[0]));
  assert.equal((await submitted.results)[0].status, SubmissionStatus.Accepted);
  assert.equal(calls, 1);
});

test("consumer signs and submits across every documented tip recipient", async (t) => {
  const observedRecipients = new Set();
  const url = await fixture(t, (req, res, body) => {
    const binary = req.headers["content-type"] === "application/octet-stream";
    const json = binary ? undefined : JSON.parse(body);
    const bytes = binary
      ? body
      : Buffer.from(
          json.params?.[0] ?? json.transaction?.content ?? json.transaction,
          "base64",
        );
    const tx = getTransactionDecoder().decode(bytes);
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (req.url.startsWith("/provider")) {
      const transfer = message.instructions.at(-1);
      assert.equal(
        message.staticAccounts[transfer.programAddressIndex],
        SYSTEM_PROGRAM_ADDRESS,
      );
      const data = new DataView(transfer.data.buffer, transfer.data.byteOffset);
      assert.equal(data.getUint32(0, true), 2, "tip is a native SOL transfer");
      assert.equal(data.getBigUint64(4, true), 1_000_000n);
      observedRecipients.add(message.staticAccounts[transfer.accountIndices[1]]);
    }
    res.end(JSON.stringify({ signature: signature(bytes) }));
  });
  const { request } = await trade();
  let fraction = 0;
  t.mock.method(Math, "random", () => fraction);
  // Counts are the independently audited public catalogs, not imported implementation arrays.
  for (const [Provider, count] of [
    [AstralaneSender, 17],
    [BlockRazorSender, 14],
    [ZeroSlotSender, 21],
    [NextBlockSender, 8],
    [HeliusSender, 10],
  ]) {
    const route = new Provider({ apiKey: "fixture", endpoint: `${url}/provider` });
    assert.equal(route.tipAccounts.length, count);
    assert.equal(new Set(route.tipAccounts).size, count);
    const client = new SenderClient({
      defaultRpc: { url: `${url}/rpc` },
      routes: [route],
    });
    for (let index = 0; index < count; index++) {
      fraction = (index + 0.5) / count;
      const submission = await client.send(request);
      assert.ok(
        (await submission.results).every(
          (result) => result.status === SubmissionStatus.Accepted,
        ),
      );
      assert.ok(observedRecipients.has(route.tipAccounts[index]));
    }
  }
  assert.equal(observedRecipients.size, 70);
});

test("consumer selects an eligible Astralane tier while retaining per-send tip control", async (t) => {
  let submissions = 0;
  const url = await fixture(t, (req, res, body) => {
    submissions++;
    const bytes =
      req.headers["content-type"] === "application/octet-stream"
        ? body
        : Buffer.from(JSON.parse(body).params[0], "base64");
    res.end(JSON.stringify({ signature: signature(bytes) }));
  });
  const { request } = await trade();
  assert.throws(
    () => new AstralaneSender({ apiKey: "fixture", tier: "invalid" }),
    code(SenderErrorCode.InvalidConfiguration),
  );
  for (const [tier, floor] of [
    [undefined, 1_000_000n],
    [AstralaneTier.Free, 1_000_000n],
    [AstralaneTier.Vip1, 100_000n],
    [AstralaneTier.Vip2, 100_000n],
    [AstralaneTier.Vip3, 10_000n],
  ]) {
    const client = new SenderClient({
      defaultRpc: { url },
      routes: [new AstralaneSender({ apiKey: "fixture", endpoint: url, tier })],
    });
    const before = submissions;
    await assert.rejects(
      client.send({
        ...request,
        fees: {
          ...request.fees,
          tipOverrides: { [SenderProvider.Astralane]: floor - 1n },
        },
      }),
      code(SenderErrorCode.TipTooLow),
    );
    assert.equal(submissions, before, "below-floor sends do not reach HTTP");
    const submission = await client.send({
      ...request,
      fees: { ...request.fees, tipOverrides: { [SenderProvider.Astralane]: floor } },
    });
    assert.ok(
      (await submission.results).every(
        (result) => result.status === SubmissionStatus.Accepted,
      ),
    );
  }
});

test("consumer supplies a provider implementation and configuration failures stay local", async (t) => {
  const paths = [];
  const url = await fixture(t, (req, res, body) => {
    paths.push(req.url);
    const json = JSON.parse(body);
    res.end(JSON.stringify({ result: signature(Buffer.from(json.params[0], "base64")) }));
  });
  const { request } = await trade();
  const configured = new ZeroSlotSender({ apiKey: "fixture", endpoint: `${url}/custom` });
  class ApplicationRoute {
    provider = configured.provider;
    tipAccounts = [...configured.tipAccounts];
    minimumTipLamports = configured.minimumTipLamports;
    minimumPriorityFeeLamports = configured.minimumPriorityFeeLamports;
    timeoutMs = configured.timeoutMs;
    encoder = configured;
    createRequest(payload) {
      return this.encoder.createRequest(payload);
    }
  }
  assert.throws(
    () => new ZeroSlotSender({ apiKey: "fixture", endpoint: "file:///tmp/private" }),
    code(SenderErrorCode.InvalidConfiguration),
  );
  assert.throws(
    () => new SenderClient({ defaultRpc: { url: "bad-url" } }),
    code(SenderErrorCode.InvalidConfiguration),
  );
  assert.throws(
    () =>
      new SenderClient({
        defaultRpc: { url },
        routes: [{ ...new ApplicationRoute(), createRequest: undefined }],
      }),
    code(SenderErrorCode.InvalidConfiguration),
  );
  const custom = new ApplicationRoute();
  const routes = [custom];
  const sender = new SenderClient({ defaultRpc: { url: `${url}/rpc` }, routes });
  // The client retains its own route list and metadata. Application encoder behavior stays caller-owned.
  routes.length = 0;
  custom.tipAccounts.length = 0;
  custom.minimumTipLamports = 99_000_000n;
  assert.equal(paths.length, 0);
  const submission = await sender.send(request);
  assert.ok(
    (await submission.results).every(
      (result) => result.status === SubmissionStatus.Accepted,
    ),
  );
  assert.equal(paths.length, 2);
  assert.ok(paths.some((path) => path.startsWith("/custom")));
});
