import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

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
    const instructionFiles = packed.files.filter(
      (file) =>
        file.path.includes("/instructions/") &&
        file.path.endsWith(".js") &&
        !["index.js", "accounts.js"].includes(file.path.split("/").at(-1)),
    );
    assert.equal(instructionFiles.length, 51);
    assert.ok(
      packed.files.every((file) => !/\/(virtual-curve|stable-swap)\//.test(file.path)),
    );
    for (const file of instructionFiles)
      assert.match(file.path.split("/").at(-1), /^[a-z][a-z0-9_]*\.js$/);

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
    // Compile documentation exactly as a consumer sees it in the installed package.
    const installedPackage = join(directory, "node_modules/celere-protocol-sdk");
    const documentationSources = [];
    const documentedEntryFiles = [
      ...instructionFiles,
      ...[
        "client",
        "providers/astralane",
        "providers/block-razor",
        "providers/zero-slot",
        "providers/next-block",
        "providers/helius",
      ].map((name) => ({
        path: `dist/sender/${name}.js`,
      })),
    ];
    for (const [index, file] of documentedEntryFiles.entries()) {
      const declarationPath = file.path.replace(/\.js$/, ".d.ts");
      const declaration = await readFile(join(installedPackage, declarationPath), "utf8");
      const snippets = [
        ...declaration.matchAll(/^\s*\* ?```ts\r?\n([\s\S]*?)^\s*\* ?```/gm),
      ];
      assert.ok(snippets.length > 0, `Missing public usage example: ${declarationPath}`);
      for (const [snippetIndex, snippet] of snippets.entries()) {
        const examplePath = join(
          directory,
          `instruction-example-${index}-${snippetIndex}.ts`,
        );
        await writeFile(examplePath, snippet[1].replace(/^\s*\* ?/gm, ""));
        documentationSources.push(examplePath);
      }
    }
    const protocolExamples = packed.files.filter(
      (file) => file.path.startsWith("example/") && file.path.endsWith(".ts"),
    );
    assert.equal(protocolExamples.length, 21);
    documentationSources.push(
      ...protocolExamples.map((file) => join(installedPackage, file.path)),
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--noEmit",
        "--skipLibCheck",
        "--noUncheckedIndexedAccess",
        "--exactOptionalPropertyTypes",
        "--verbatimModuleSyntax",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        ...documentationSources,
      ],
      { cwd: directory, stdio: "pipe" },
    );
    await writeFile(
      join(directory, "consumer.ts"),
      await readFile(new URL("../consumers/package.ts", import.meta.url), "utf8"),
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
    assert.equal(output.trim(), "20");
    const cases = [];
    const owner = (await generateKeyPairSigner()).address;
    const lifetime = {
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1n,
    };
    for (const reverse of [false, true]) {
      const fixture = await raydiumCpmmFixture(owner, { reverse });
      for (const amount of [
        { kind: "exactIn", amountIn: 1_000_001n },
        { kind: "exactOut", amountOut: 1_000_001n },
      ]) {
        const built = await buildSwapInstructions({ ...fixture.request, amount });
        assert.equal(built.ok, true);
        assert.equal(built.value.instructions.length, 1);
        const compiled = compileTransaction({
          instructions: built.value.instructions,
          feePayer: owner,
          lifetime,
        });
        assert.equal(compiled.ok, true);
        const { quote } = built.value;
        cases.push({
          kind: amount.kind,
          accounts: {
            owner,
            authority: fixture.authority,
            ammConfig: fixture.config,
            pool: fixture.pool,
            inputTokenAccount: fixture.request.tokenAccounts.input,
            outputTokenAccount: fixture.request.tokenAccounts.output,
            inputVault: reverse ? fixture.vault1 : fixture.vault0,
            outputVault: reverse ? fixture.vault0 : fixture.vault1,
            inputTokenProgram: TOKEN_PROGRAM_ADDRESS,
            outputTokenProgram: TOKEN_PROGRAM_ADDRESS,
            inputMint: fixture.request.inputMint,
            outputMint: fixture.request.outputMint,
            observationState: fixture.observation,
          },
          args:
            quote.kind === "exactIn"
              ? { amountIn: quote.amountIn, minimumAmountOut: quote.minimumAmountOut }
              : { maximumAmountIn: quote.maximumAmountIn, amountOut: quote.amountOut },
          lifetime,
          expectedInstruction: built.value.instructions[0],
          expectedWireBytes: compiled.value.wireBytes,
        });
      }
    }
    await writeFile(
      join(directory, "native-instructions.json"),
      JSON.stringify(
        {
          entrypoints: Object.keys(sourceManifest.exports)
            .filter((path) => path.startsWith("./instructions/"))
            .map((path) => path.slice(2)),
          cases,
        },
        (_, value) =>
          typeof value === "bigint"
            ? { bigint: String(value) }
            : value instanceof Uint8Array
              ? { bytes: Array.from(value) }
              : value,
      ),
    );
    await writeFile(
      join(directory, "native-instructions.mjs"),
      await readFile(new URL("../consumers/native-instructions.mjs", import.meta.url)),
    );
    const nativeOutput = execFileSync(process.execPath, ["native-instructions.mjs"], {
      cwd: directory,
      encoding: "utf8",
    });
    const nativeResult = JSON.parse(nativeOutput);
    assert.equal(nativeResult.entrypoints, 20);
    assert.equal(nativeResult.cases, 4);
    assert.ok(nativeResult.builderCount >= 51);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
