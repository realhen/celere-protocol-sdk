import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";
import { installExampleProject } from "../fixtures/example-projects.mjs";

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
    const sourceManifest = JSON.parse(await readFile("package.json", "utf8"));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "celere-consumer",
        private: true,
        type: "module",
        dependencies: {
          "celere-protocol-sdk": `file:${join(directory, packed.filename)}`,
          "@types/node": sourceManifest.devDependencies["@types/node"],
        },
      }),
    );
    const consumerManifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
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
        // Kit's declarations reference Node types; the consumer supplies these just
        // as a Node application would, without adding them to the SDK runtime deps.
        "node_modules/@types/node": {
          ...sourceLock.packages["node_modules/@types/node"],
          dev: false,
        },
        "node_modules/@types/node/node_modules/undici-types": {
          ...sourceLock.packages["node_modules/@types/node/node_modules/undici-types"],
          dev: false,
        },
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
        "errors/sender-error",
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
    // Published guides and source maps must work from the installed tarball, not just this checkout.
    const guide = await readFile(join(installedPackage, "docs/sender.md"), "utf8");
    for (const [index, snippet] of [
      ...guide.matchAll(/```ts\r?\n([\s\S]*?)```/g),
    ].entries()) {
      const path = join(directory, `sender-guide-${index}.ts`);
      await writeFile(path, snippet[1]);
      documentationSources.push(path);
    }
    const addressGuide = await readFile(
      join(installedPackage, "docs/addresses.md"),
      "utf8",
    );
    for (const [index, snippet] of [
      ...addressGuide.matchAll(/```ts\r?\n([\s\S]*?)```/g),
    ].entries()) {
      const path = join(directory, `address-guide-${index}.ts`);
      await writeFile(path, snippet[1]);
      documentationSources.push(path);
    }
    const declarationMaps = packed.files.filter((file) =>
      file.path.endsWith(".d.ts.map"),
    );
    for (const file of declarationMaps) {
      const map = JSON.parse(await readFile(join(installedPackage, file.path), "utf8"));
      for (const source of map.sources) {
        await readFile(
          resolve(installedPackage, file.path, "..", map.sourceRoot ?? "", source),
          "utf8",
        );
      }
    }
    for (const project of ["pumpfun", "meteora-dlmm"]) {
      const source = join(installedPackage, "example", project);
      const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      assert.equal(manifest.dependencies["celere-protocol-sdk"], "file:../..");
      await readFile(join(source, "main.ts"), "utf8");
      await installExampleProject(
        source,
        join(directory, project),
        join(directory, packed.filename),
        packed.integrity,
      );
    }
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--noEmit",
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
    const consumerSources = [];
    for (const name of await readdir(new URL("../consumers/", import.meta.url))) {
      if (!name.endsWith(".ts")) continue;
      const path = join(directory, name);
      await writeFile(
        path,
        await readFile(new URL(`../consumers/${name}`, import.meta.url), "utf8"),
      );
      consumerSources.push(path);
    }
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--noEmit",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        ...consumerSources,
      ],
      { cwd: directory, stdio: "pipe" },
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--noEmit",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        ...consumerSources,
      ],
      { cwd: directory, stdio: "pipe" },
    );
    await writeFile(
      join(directory, "sender-identity.mjs"),
      `
      import assert from 'node:assert/strict';
      globalThis.fetch = () => { throw new Error('Import or construction attempted network access'); };
      const root = await import('celere-protocol-sdk');
      const sender = await import('celere-protocol-sdk/sender');
      const protocols = await import('celere-protocol-sdk/protocols');
      const pumpRoutes = await import('celere-protocol-sdk/protocols/pump-routes');
      assert.equal(root.createRouteSdk, pumpRoutes.createRouteSdk);
      assert.equal(protocols.createRouteSdk, pumpRoutes.createRouteSdk);
      const legacyCore = await import('celere-protocol-sdk/core');
      const transactions = await import('celere-protocol-sdk/transactions');
      for (const name of ['SwapAccountFetchError', 'ProtocolError', 'ProtocolErrorCode', 'MissingAccountsError', 'InvalidAccountError', 'InvalidSnapshotContextError', 'UnsupportedProtocolError', 'UnsupportedPoolFeatureError', 'UnsupportedSwapModeError', 'UnsupportedTokenExtensionError', 'InsufficientLiquidityError', 'UnsupportedFillPolicyError', 'InvalidRequestError', 'ValidationErrorCode']) {
        assert.equal(root[name], protocols[name], name);
        assert.equal(legacyCore[name], protocols[name], name);
      }
      for (const name of ['TransactionTooLargeError', 'TransactionErrorCode', 'InvalidRequestError', 'ValidationErrorCode']) assert.equal(root[name], transactions[name], name);
      assert.ok(new root.MissingAccountsError({ message: 'missing', accounts: [] }) instanceof protocols.ProtocolError);
      assert.ok(new root.TransactionTooLargeError({ message: 'too large', size: 1233, limit: 1232 }) instanceof transactions.TransactionTooLargeError);

      for (const name of Object.keys(sender)) assert.equal(root[name], sender[name], name);
      const client = new root.SenderClient({defaultRpc: {url: 'https://rpc.example'}});
      assert.ok(client instanceof sender.SenderClient);
      assert.ok(new root.SenderConfigurationError('example') instanceof sender.SenderError);
      for (const entrypoint of ${JSON.stringify(Object.keys(sourceManifest.exports))}) {
        const focused = await import(entrypoint === '.' ? 'celere-protocol-sdk' : 'celere-protocol-sdk/' + entrypoint.slice(2));
        if (entrypoint.startsWith('./protocols/')) {
          for (const [name, value] of Object.entries(focused)) {
            if (/^(get|find).*(Address|Pda)$/.test(name)) assert.equal(root[name], value, name);
          }
        }
      }
    `,
    );
    execFileSync(process.execPath, ["sender-identity.mjs"], {
      cwd: directory,
      stdio: "pipe",
    });
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
        assert.equal(built.instructions.length, 1);
        const compiled = compileTransaction({
          instructions: built.instructions,
          feePayer: owner,
          lifetime,
        });
        const { quote } = built;
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
          expectedInstruction: built.instructions[0],
          expectedWireBytes: compiled.wireBytes,
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
  } catch (error) {
    // Preserve compiler and package-manager diagnostics when a child process fails.
    if (error.stdout?.length) console.error(error.stdout.toString());
    if (error.stderr?.length) console.error(error.stderr.toString());
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
