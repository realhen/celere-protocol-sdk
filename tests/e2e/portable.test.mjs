import { pumpV3Fixture } from "../fixtures/pump-v3.mjs";
import { pumpAmmQuotesFixture } from "../fixtures/pump-amm-quotes.mjs";
import { pumpRouteFixture } from "../fixtures/pump-route.mjs";
import { liquidAfAmmFixture } from "../fixtures/liquid-af-amm.mjs";
import { riseRichFixture } from "../fixtures/rise-rich.mjs";
import { liquidAfFixture } from "../fixtures/liquid-af.mjs";
import { boopFixture } from "../fixtures/boop.mjs";
import { heavenFixture } from "../fixtures/heaven.mjs";
import { metadaoFixture } from "../fixtures/metadao.mjs";
import { meteoraDbcFixture } from "../fixtures/meteora-dbc.mjs";
import { meteoraDammV1Fixture } from "../fixtures/meteora-damm-v1.mjs";
import { moonshotFixture } from "../fixtures/moonshot.mjs";
import { vertigoFixture } from "../fixtures/vertigo.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSigner } from "@solana/kit";
import { raydiumAmmV4Fixture } from "../fixtures/raydium-amm-v4.mjs";
import { raydiumClmmFixture } from "../fixtures/raydium-clmm.mjs";
import { meteoraDlmmFixture } from "../fixtures/meteora-dlmm.mjs";
import { pumpAmmFixture } from "../fixtures/pump-amm.mjs";
import { raydiumLaunchlabFixture } from "../fixtures/raydium-launchlab.mjs";
import { meteoraDammV2Fixture } from "../fixtures/meteora-damm-v2.mjs";
import { orcaWhirlpoolFixture } from "../fixtures/orca-whirlpool.mjs";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

const workerScript = `
  import { parentPort, workerData } from "node:worker_threads";
  const deny = () => { throw new Error("SDK attempted network access"); };
  // Node workers do not expose the secure-context flag that browsers provide.
  globalThis.isSecureContext = true;
  globalThis.fetch = deny;
  globalThis.WebSocket = class { constructor() { deny(); } };
  const sdk = await import(workerData.module);
  const results = [];
  for (const request of workerData.requests) {
    const discovery = await (request.hops ? sdk.getRouteRequirements(request) : sdk.getSwapRequirements(request));
    const build = await (request.hops ? sdk.buildRouteInstructions(request) : sdk.buildSwapInstructions(request));
    const compiled = sdk.compileTransaction({
          instructions: build.instructions,
          feePayer: request.payer,
          lifetime: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 1n,
          },
        });
    results.push({ discovery, build, compiled });
  }
  parentPort.postMessage(results);
`;

test("browser bundle discovers, builds, and compiles all adapters inside an offline worker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "celere-browser-"));
  try {
    const browserPath = join(directory, "browser.mjs");
    const bundled = await build({
      entryPoints: ["dist/index.js"],
      outfile: browserPath,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      metafile: true,
      write: true,
    });
    assert.ok(
      Object.values(bundled.metafile.outputs).every((output) =>
        output.imports.every((dependency) => !dependency.external),
      ),
    );
    const signer = await generateKeyPairSigner();
    const pump = JSON.parse(
      await readFile(
        new URL("../fixtures/pump-observations.json", import.meta.url),
        "utf8",
      ),
      (_, value) =>
        value && typeof value === "object" && "bigint" in value
          ? BigInt(value.bigint)
          : value && typeof value === "object" && "base64" in value
            ? Uint8Array.from(Buffer.from(value.base64, "base64"))
            : value,
    );
    const fixtures = [
      [
        "pump",
        (
          await pumpV3Fixture(signer.address, {
            quote: "token",
            quote2022: true,
            crossing: true,
          })
        ).request,
      ],
      [
        "pump-amm",
        (await pumpAmmQuotesFixture(signer.address, { quote: "usdc" })).request,
      ],
      [
        "pump-amm",
        (
          await pumpRouteFixture(signer.address, {
            kinds: ["curve", "pool"],
            crossing: 0,
          })
        ).request,
      ],
      [
        "pump-amm",
        (
          await pumpRouteFixture(signer.address, {
            kinds: ["pool", "curve"],
            currency: "usdc",
            reverse: true,
          })
        ).request,
      ],
      ["liquid-af-amm", (await liquidAfAmmFixture(signer.address)).request],
      ["rise-rich", (await riseRichFixture(signer.address)).request],
      ["liquid-af", (await liquidAfFixture(signer.address)).request],
      ["boop", (await boopFixture(signer.address)).request],
      ["heaven", (await heavenFixture(signer.address)).request],
      ["metadao", (await metadaoFixture(signer.address)).request],
      ["meteora-dbc", (await meteoraDbcFixture(signer.address)).request],
      ["meteora-damm-v1", (await meteoraDammV1Fixture(signer.address)).request],
      ["moonshot", (await moonshotFixture(signer.address)).request],
      ["vertigo", (await vertigoFixture(signer.address)).request],
      ["pump", pump.observations[0].request],
      ["raydium-amm-v4", (await raydiumAmmV4Fixture(signer.address)).request],
      ["raydium-clmm", (await raydiumClmmFixture(signer.address)).request],
      ["meteora-dlmm", (await meteoraDlmmFixture(signer.address)).request],
      ["pump-amm", (await pumpAmmFixture(signer.address)).request],
      ["launchlab", (await raydiumLaunchlabFixture(signer.address)).request],
      ["meteora-damm-v2", (await meteoraDammV2Fixture(signer.address)).request],
      ["raydium-cpmm", (await raydiumCpmmFixture(signer.address)).request],
      ["orca-whirlpool", (await orcaWhirlpoolFixture(signer.address)).request],
    ];
    // Streaming clients may retain account bytes as slices of a larger receive buffer.
    // Padding must never become part of a decoded field or change a built transaction.
    const slicedRequests = fixtures.map(([, request]) => ({
      ...request,
      snapshot: {
        ...request.snapshot,
        accounts: Object.fromEntries(
          Object.entries(request.snapshot.accounts).map(([address, account]) => {
            if (!account) return [address, account];

            const buffer = new Uint8Array(account.data.length + 29).fill(0xa5);
            buffer.set(account.data, 13);
            const data = buffer.subarray(13, 13 + account.data.length);

            return [address, { ...account, data }];
          }),
        ),
      },
    }));

    await writeFile(join(directory, "worker.mjs"), workerScript);
    const results = await new Promise((resolve, reject) => {
      const worker = new Worker(join(directory, "worker.mjs"), {
        workerData: {
          module: pathToFileURL(browserPath).href,
          requests: [...fixtures.map(([, request]) => request), ...slicedRequests],
        },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited ${code}`));
      });
    });
    assert.equal(results.length, fixtures.length * 2);
    const originalResults = results.slice(0, fixtures.length);
    assert.deepEqual(results.slice(fixtures.length), originalResults);

    for (const [
      index,
      { discovery, build: built, compiled },
    ] of originalResults.entries()) {
      assert.equal(discovery.complete, true);
      assert.equal(built.protocol, fixtures[index][0]);
      assert.equal(built.quote.kind, "exactIn");
      assert.ok(built.instructions[0].data instanceof Uint8Array);
      assert.ok(compiled.wireBytes instanceof Uint8Array);
      assert.ok(compiled.byteLength <= 1232);
      assert.deepEqual(compiled.requiredSigners, [fixtures[index][1].owner]);
      assert.ok(
        Object.values(compiled.transaction.signatures).every(
          (signature) => signature === null,
        ),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("root sender exports bundle for a browser worker without Node shims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "celere-sender-browser-"));
  try {
    const browserPath = join(directory, "browser.mjs");
    await build({
      stdin: {
        contents: `export { SenderClient, ZeroSlotSender } from './dist/index.js'; export { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, getSignatureFromTransaction } from '@solana/kit';`,
        resolveDir: process.cwd(),
      },
      outfile: browserPath,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
    });
    await writeFile(
      join(directory, "worker.mjs"),
      `
      import { parentPort, workerData } from 'node:worker_threads';
      globalThis.isSecureContext = true;
      globalThis.fetch = () => { throw new Error('Unexpected network access'); };
      const sdk = await import(workerData.module);
      const payer = await sdk.generateKeyPairSigner();
      const nonce = await sdk.generateKeyPairSigner();
      let calls = 0;
      const sender = new sdk.SenderClient({routes: [new sdk.ZeroSlotSender({apiKey: 'fixture'})], defaultRpc: {url: 'https://fixture.invalid'}, fetch: async (_url, init) => {
        calls++;
        const bytes = sdk.getBase64Encoder().encode(JSON.parse(init.body).params[0]);
        return new Response(JSON.stringify({result:sdk.getSignatureFromTransaction(sdk.getTransactionDecoder().decode(bytes))}));
      }});
      if(calls !== 0) throw new Error('Construction performed network access');
      const submission = await sender.send({feePayer:payer.address,signers:[payer],nonce:{account:nonce.address,authority:payer.address,value:nonce.address},instructions:[{programAddress:'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',data:new Uint8Array([97])}],fees:{computeUnitLimit:100000,computeUnitPriceMicroLamports:0n,tipLamports:1000000n}});
      parentPort.postMessage({calls,results:await submission.results});
    `,
    );
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(join(directory, "worker.mjs"), {
        workerData: { module: pathToFileURL(browserPath).href },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited ${code}`));
      });
    });
    assert.equal(result.calls, 2);
    assert.ok(result.results.every((r) => r.status === "accepted"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker consumers explicitly serialize named error metadata for the receiving application", async () => {
  const sdkModule = new URL("../../dist/index.js", import.meta.url).href;
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL(
        `data:text/javascript,${encodeURIComponent(`
      import { parentPort, workerData } from "node:worker_threads";
      const sdk = await import(workerData.module);
      try {
        await sdk.buildSwapInstructions({});
      } catch (error) {
        if (!(error instanceof sdk.InvalidRequestError)) throw error;
        parentPort.postMessage({
          clonedError: error,
          serialized: { name: error.name, message: error.message, code: error.code, field: error.field },
        });
      }
    `)}`,
      ),
      { workerData: { module: sdkModule } },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}`));
    });
  });
  assert.ok(result.clonedError instanceof Error);
  assert.equal(result.clonedError.code, undefined);
  assert.equal(result.clonedError.field, undefined);
  assert.equal(result.serialized.name, "InvalidRequestError");
  assert.equal(result.serialized.code, "INVALID_REQUEST");
  assert.equal(typeof result.serialized.field, "string");
  assert.equal(typeof result.serialized.message, "string");
});
