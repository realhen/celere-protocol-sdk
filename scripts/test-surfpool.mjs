import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
let simulator;
let tests;
let interrupted = false;

function interrupt() {
  interrupted = true;
  tests?.child.kill("SIGTERM");
  simulator?.child.kill("SIGINT");
}
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

function start(command, args, options) {
  const child = spawn(command, args, options);
  let failure;
  const done = new Promise((resolve) => {
    child.once("error", (error) => {
      failure = error;
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
  return {
    child,
    done,
    get failure() {
      return failure;
    },
  };
}

async function reservePorts() {
  const servers = [createServer(), createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          }),
      ),
    );
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}

async function awaitSimulator(endpoint) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Native validation interrupted");
    if (simulator.failure) {
      throw new Error(
        "Surfpool could not start. Install the Surfpool CLI and ensure it is on PATH.",
        { cause: simulator.failure },
      );
    }
    if (simulator.child.exitCode !== null || simulator.child.signalCode !== null) {
      throw new Error("Surfpool exited before becoming ready");
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: globalThis.AbortSignal.timeout(2_000),
      });
      if (response.ok && (await response.json()).result === "ok") return;
    } catch {
      // The RPC listener becomes available after simulator initialization.
    }
    await delay(250);
  }
  throw new Error("Surfpool did not become ready within 60 seconds");
}

async function stopSimulator() {
  if (
    !simulator ||
    simulator.child.exitCode !== null ||
    simulator.child.signalCode !== null ||
    simulator.failure
  )
    return;
  simulator.child.kill("SIGINT");
  const stopped = await Promise.race([
    simulator.done.then(() => true),
    delay(5_000, undefined, { ref: false }).then(() => false),
  ]);
  if (!stopped) {
    simulator.child.kill("SIGKILL");
    await simulator.done;
  }
}

let directory;
let log;
try {
  let endpoint = process.env.CELERE_SURFPOOL_URL;
  if (endpoint) {
    const url = new URL(endpoint);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol)
    ) {
      throw new Error("Native transaction tests only accept loopback HTTP simulators");
    }
    console.log("Using the caller-supplied disposable Surfpool; tests mutate its state.");
  } else {
    directory = await mkdtemp(join(tmpdir(), "celere-surfpool-"));
    const output = join(root, "outputs", "surfpool");
    await mkdir(output, { recursive: true });
    const logPath = join(output, `surfpool-${Date.now()}-${process.pid}.log`);
    log = await open(logPath, "w");
    const [rpcPort, wsPort, studioPort] = await reservePorts();
    endpoint = `http://127.0.0.1:${rpcPort}`;
    simulator = start(
      "surfpool",
      [
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        String(rpcPort),
        "--ws-port",
        String(wsPort),
        "--studio-port",
        String(studioPort),
        "--no-studio",
        "--no-tui",
        "--no-deploy",
        "--rpc-url",
        "https://api.mainnet-beta.solana.com",
        "--block-production-mode",
        "transaction",
        "--max-profiles",
        "20",
        "--log-level",
        "warn",
      ],
      { cwd: directory, stdio: ["ignore", log.fd, log.fd] },
    );
    console.log(`Starting disposable Surfpool at ${endpoint}; diagnostics: ${logPath}`);
    await awaitSimulator(endpoint);
  }
  if (interrupted) throw new Error("Native validation interrupted");
  const patterns = process.argv.slice(2);
  tests = start(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      ...(patterns.length ? patterns : ["tests/e2e/*.test.mjs"]),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CELERE_SURFPOOL_URL: endpoint },
    },
  );
  process.exitCode = await tests.done;
  if (tests.failure) throw tests.failure;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await stopSimulator();
  await log?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (interrupted) process.exitCode = 130;
}
