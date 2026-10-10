import { build } from "esbuild";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = resolve(root, "src");
const outputDirectory = resolve(root, "dist");
const configPath = resolve(root, "tsconfig.build.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error)
  throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);

/** Preserve source-linked declarations while emitting Node-compatible relative module paths. */
function declarationImports(context) {
  return (source) => {
    function modulePath(literal) {
      if (
        !literal ||
        !ts.isStringLiteral(literal) ||
        !/^\.\.?(?:\/|$)/.test(literal.text)
      )
        return literal;
      const result = ts.resolveModuleName(
        literal.text,
        source.fileName,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      // TypeScript normalizes separators even on Windows; compare native paths.
      const resolvedFilename = result && resolve(result.resolvedFileName);
      if (!resolvedFilename || !resolvedFilename.startsWith(sourceDirectory + sep)) {
        throw new Error(
          `Cannot resolve declaration import ${literal.text} in ${source.fileName}`,
        );
      }
      const filename = resolvedFilename.replace(/(?:\.d)?\.ts$/, ".js");
      let specifier = relative(dirname(source.fileName), filename).replaceAll("\\", "/");
      if (!specifier.startsWith(".")) specifier = "./" + specifier;
      return ts.setTextRange(
        ts.setOriginalNode(context.factory.createStringLiteral(specifier), literal),
        literal,
      );
    }
    function visit(node) {
      if (ts.isImportDeclaration(node)) {
        return context.factory.updateImportDeclaration(
          node,
          node.modifiers,
          node.importClause,
          modulePath(node.moduleSpecifier),
          node.attributes,
        );
      }
      if (ts.isExportDeclaration(node)) {
        return context.factory.updateExportDeclaration(
          node,
          node.modifiers,
          node.isTypeOnly,
          node.exportClause,
          modulePath(node.moduleSpecifier),
          node.attributes,
        );
      }
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        return context.factory.updateImportTypeNode(
          node,
          context.factory.updateLiteralTypeNode(
            node.argument,
            modulePath(node.argument.literal),
          ),
          node.attributes,
          node.qualifier,
          node.typeArguments?.map((argument) => ts.visitNode(argument, visit)),
          node.isTypeOf,
        );
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(source, visit);
  };
}

const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
}
const emitted = program.emit(undefined, undefined, undefined, true, {
  afterDeclarations: [declarationImports],
});
if (emitted.emitSkipped || emitted.diagnostics.length) {
  throw new Error("SDK declaration emission failed");
}

// Build modules together so root, subpaths, and native fixture imports share class identity.
// Retaining source entrypoints also keeps each declaration paired with a JavaScript module.
await build({
  absWorkingDir: root,
  entryPoints: [
    ...parsed.fileNames.filter((file) => !file.endsWith(".d.ts")),
    {
      in: resolve(outputDirectory, "protocols/orca/offline-core.js"),
      out: "protocols/orca/offline-core",
    },
  ],
  // Only the freshly generated Orca module overlaps an output path. It participates
  // in the same split build so its embedded WASM is shared, without absolute imports.
  allowOverwrite: true,
  outbase: sourceDirectory,
  outdir: outputDirectory,
  bundle: true,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  packages: "external",
  platform: "neutral",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  sourcesContent: true,
  plugins: [
    {
      name: "packaged-orca-core",
      setup(builder) {
        // The preceding build step embeds WASM into this portable, offline module.
        builder.onResolve({ filter: /^\.\/offline-core$/ }, (args) => {
          if (args.resolveDir !== resolve(sourceDirectory, "protocols/orca")) return;
          return {
            path: resolve(outputDirectory, "protocols/orca/offline-core.js"),
          };
        });
      },
    },
  ],
});
