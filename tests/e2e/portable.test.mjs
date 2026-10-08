import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSigner } from "@solana/kit";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

const workerScript = `
  import { parentPort, workerData } from "node:worker_threads";
  const deny = () => { throw new Error("SDK attempted network access"); };
  // Node workers do not expose the secure-context flag that browsers provide.
  globalThis.isSecureContext = true;
  globalThis.fetch = deny;
  globalThis.WebSocket = class { constructor() { deny(); } };
  const sdk = await import(workerData.module);
  const result = await sdk.buildSwapInstructions(workerData.request);
  parentPort.postMessage(result);
`;

test("browser bundle builds from a structured-cloned snapshot inside an offline worker", async () => {
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
    const fixture = await raydiumCpmmFixture(signer.address);
    await writeFile(join(directory, "worker.mjs"), workerScript);
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(join(directory, "worker.mjs"), {
        workerData: { module: pathToFileURL(browserPath).href, request: fixture.request },
      });
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker exited ${code}`));
      });
    });
    assert.equal(
      result.ok,
      true,
      JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    assert.equal(result.value.protocol, "raydium-cpmm");
    assert.equal(result.value.quote.kind, "exactIn");
    assert.ok(result.value.instructions[0].data instanceof Uint8Array);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
