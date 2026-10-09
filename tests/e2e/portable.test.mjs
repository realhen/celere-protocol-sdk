import { pumpV3Fixture } from "../fixtures/pump-v3.mjs";
import { pumpAmmQuotesFixture } from "../fixtures/pump-amm-quotes.mjs";
import { pumpRouteFixture } from "../fixtures/pump-route.mjs";
import { liquidAfAmmFixture } from "../fixtures/liquid-af-amm.mjs";
import { riseRichFixture } from "../fixtures/rise-rich.mjs";
import { liquidAfFixture } from "../fixtures/liquid-af.mjs";
import { boopFixture } from "../fixtures/boop.mjs";
import { heavenFixture } from "../fixtures/heaven.mjs";
import { metadaoFixture } from "../fixtures/metadao.mjs";
import { virtualCurveFixture } from "../fixtures/virtual-curve.mjs";
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
    const compiled = build.ok
      ? sdk.compileTransaction({
          instructions: build.value.instructions,
          feePayer: request.payer,
          lifetime: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 1n,
          },
        })
      : undefined;
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
      ["virtual-curve", (await virtualCurveFixture(signer.address)).request],
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
    await writeFile(join(directory, "worker.mjs"), workerScript);
    const results = await new Promise((resolve, reject) => {
      const worker = new Worker(join(directory, "worker.mjs"), {
        workerData: {
          module: pathToFileURL(browserPath).href,
          requests: fixtures.map(([, request]) => request),
        },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited ${code}`));
      });
    });
    assert.equal(results.length, fixtures.length);
    for (const [index, { discovery, build: built, compiled }] of results.entries()) {
      for (const result of [discovery, built, compiled]) {
        assert.equal(
          result?.ok,
          true,
          JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
        );
      }
      assert.equal(discovery.value.complete, true);
      assert.equal(built.value.protocol, fixtures[index][0]);
      assert.equal(built.value.quote.kind, "exactIn");
      assert.ok(built.value.instructions[0].data instanceof Uint8Array);
      assert.ok(compiled.value.wireBytes instanceof Uint8Array);
      assert.ok(compiled.value.byteLength <= 1232);
      assert.deepEqual(compiled.value.requiredSigners, [fixtures[index][1].owner]);
      assert.ok(
        Object.values(compiled.value.transaction.signatures).every(
          (signature) => signature === null,
        ),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
