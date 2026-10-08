import { spawnSync } from "node:child_process";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (!endpoint) {
  console.error(
    "Set CELERE_SURFPOOL_URL to a disposable local Surfpool (for example http://127.0.0.1:18999).",
  );
  process.exitCode = 1;
} else {
  const url = new URL(endpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Native transaction tests only accept loopback simulators");
  }
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "tests/e2e/*.test.mjs"],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status ?? 1;
}
