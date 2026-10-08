import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("packed public package installs offline and exposes usable strict TypeScript entrypoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "celere-package-"));
  try {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
        { encoding: "utf8" },
      ),
    )[0];
    assert.ok(
      packed.files.some((file) => file.path === "dist/protocols/orca/offline-core.js"),
    );
    assert.ok(packed.files.some((file) => file.path === "licenses/ORCA-LICENSE"));
    assert.ok(
      packed.files.every(
        (file) => !file.path.startsWith("tests/") && !file.path.startsWith("outputs/"),
      ),
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "celere-consumer",
        private: true,
        type: "module",
        dependencies: {
          "celere-protocol-sdk": `file:${join(directory, packed.filename)}`,
        },
      }),
    );
    const consumerManifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const sourceManifest = JSON.parse(await readFile("package.json", "utf8"));
    const sourceLock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const productionPackages = Object.fromEntries(
      Object.entries(sourceLock.packages).filter(
        ([name, info]) => name !== "" && !info.dev,
      ),
    );
    const consumerLock = {
      name: consumerManifest.name,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: consumerManifest.name, dependencies: consumerManifest.dependencies },
        ...productionPackages,
        "node_modules/celere-protocol-sdk": {
          version: sourceManifest.version,
          resolved: consumerManifest.dependencies["celere-protocol-sdk"],
          integrity: packed.integrity,
          license: sourceManifest.license,
          dependencies: sourceManifest.dependencies,
          engines: sourceManifest.engines,
        },
      },
    };
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(consumerLock));
    execFileSync(
      "npm",
      ["ci", "--offline", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"],
      { cwd: directory, stdio: "pipe" },
    );
    await writeFile(
      join(directory, "consumer.ts"),
      `
      import { address, buildSwapInstructions, compileTransaction, getSwapRequirements, type SwapRequest, type BuildError } from "celere-protocol-sdk";
      import { createProtocolSdk } from "celere-protocol-sdk/core";
      import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";
      import { pumpAdapter } from "celere-protocol-sdk/protocols/pump";
      import { orcaWhirlpoolAdapter } from "celere-protocol-sdk/protocols/orca";
      import { pumpAmmAdapter } from "celere-protocol-sdk/protocols/pump-amm";
      import { raydiumLaunchlabAdapter } from "celere-protocol-sdk/protocols/raydium-launchlab";
      import { meteoraDammV2Adapter } from "celere-protocol-sdk/protocols/meteora-damm-v2";
      import { raydiumAmmV4Adapter } from "celere-protocol-sdk/protocols/raydium-amm-v4";
      import { raydiumClmmAdapter } from "celere-protocol-sdk/protocols/raydium-clmm";
      import { meteoraDlmmAdapter } from "celere-protocol-sdk/protocols/meteora-dlmm";
      import { compileTransaction as compiler } from "celere-protocol-sdk/transactions";
      declare const request: SwapRequest;
      const subset = createProtocolSdk([raydiumCpmmAdapter, pumpAdapter, orcaWhirlpoolAdapter, pumpAmmAdapter, raydiumLaunchlabAdapter, meteoraDammV2Adapter, raydiumAmmV4Adapter, raydiumClmmAdapter, meteoraDlmmAdapter]);
      const requirements = await getSwapRequirements(request);
      const result = await buildSwapInstructions(request);
      if (result.ok) {
        const quote = result.value.quote;
        if (quote.kind === "exactOut") { const limit: bigint = quote.maximumAmountIn; void limit; }
        const tx = compileTransaction({ feePayer: address("11111111111111111111111111111111"), lifetime: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n }, instructions: result.value.instructions });
        if (tx.ok) { const bytes: Uint8Array = tx.value.wireBytes; void bytes; }
      } else {
        const error: BuildError = result.error;
        if (error.code === "MISSING_ACCOUNTS") { const role: string | undefined = error.accounts[0]?.role; void role; }
      }
      // @ts-expect-error Atomic quantities must never accept floating-point numbers.
      const wrong: SwapRequest["amount"] = { kind: "exactIn", amountIn: 0.5 };
      void [subset, requirements, compiler, wrong];
    `,
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        join(directory, "consumer.ts"),
      ],
      { cwd: directory, stdio: "pipe" },
    );
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const sdk = await import('celere-protocol-sdk'); console.log(sdk.PROTOCOL_COVERAGE.length);",
      ],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(output.trim(), "21");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
