import { build } from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(
  await readFile(
    resolve(repository, "node_modules/@orca-so/whirlpools-core/package.json"),
    "utf8",
  ),
);
if (metadata.version !== "1.0.3" || metadata.license !== "Apache-2.0") {
  throw new Error("Orca core dependency must be the verified Apache-2.0 release 1.0.3");
}
const upstream = resolve(
  repository,
  "node_modules/@orca-so/whirlpools-core/dist/browser",
);
const output = resolve(repository, "dist/protocols/orca");
await mkdir(output, { recursive: true });

// Embed official WASM at package build time. Consumers never fetch or read files.
await build({
  stdin: {
    contents: `
      import * as bindings from "./orca_whirlpools_core_js_bindings_bg.js";
      import bytes from "./orca_whirlpools_core_js_bindings_bg.wasm";
      export * from "./orca_whirlpools_core_js_bindings_bg.js";
      let initialized = false;
      export function initialize() {
        if (initialized) return;
        const module = new WebAssembly.Module(bytes);
        const instance = new WebAssembly.Instance(module, {
          "./orca_whirlpools_core_js_bindings_bg.js": bindings,
        });
        bindings.__wbg_set_wasm(instance.exports);
        initialized = true;
      }
    `,
    resolveDir: upstream,
    sourcefile: "offline-orca-core.js",
    loader: "js",
  },
  outfile: resolve(output, "offline-core.js"),
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2022",
  loader: { ".wasm": "binary" },
  banner: {
    js: "// Generated from @orca-so/whirlpools-core; see NOTICE.md and ORCA-LICENSE.",
  },
});
await copyFile(
  resolve(repository, "src/protocols/orca/offline-core.d.ts"),
  resolve(output, "offline-core.d.ts"),
);
await copyFile(
  resolve(repository, "licenses/ORCA-LICENSE"),
  resolve(repository, "dist/ORCA-LICENSE"),
);
