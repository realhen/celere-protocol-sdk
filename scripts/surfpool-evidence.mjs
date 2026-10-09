import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  createSolanaRpc,
  fetchAddressesForLookupTables,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { setTimeout as delay } from "node:timers/promises";

/** Enumerates public native builders independently of the tests that exercise them. */
async function instructionCatalog() {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const catalog = [];
  // These dummy values inspect encoding only; they are never submitted to a network.
  const accounts = new Proxy(
    {},
    {
      get: (_, name) =>
        ["hops", "tickArrays", "binArrays", "supplementalTickArrays"].includes(name)
          ? []
          : SYSTEM_PROGRAM_ADDRESS,
    },
  );
  const args = new Proxy(
    {},
    {
      get: (_, name) => {
        if (["floorIncreaseRatio", "maxNewFloor", "minLiqRatio"].includes(name))
          return new Uint8Array(16);
        if (["swapMode", "fixedSide", "bondingCurveBump", "solVaultBump"].includes(name))
          return 0;
        if (["amountSpecifiedIsInput", "isBaseInput", "aToB"].includes(name)) return true;
        if (name === "direction") return "buy";
        return 1n;
      },
    },
  );
  for (const entry of Object.keys(manifest.exports).filter((key) =>
    key.startsWith("./instructions/"),
  )) {
    const protocol = entry.slice("./instructions/".length);
    const builders = await import(`celere-protocol-sdk/${entry.slice(2)}`);
    for (const [name, build] of Object.entries(builders)) {
      assert.equal(
        typeof build,
        "function",
        `Unexpected runtime export: ${entry}/${name}`,
      );
      const instruction = build(accounts, args);
      const size = protocol === "raydium-amm-v4" ? 1 : 8;
      catalog.push({
        protocol,
        name,
        program: instruction.programAddress,
        discriminator: Buffer.from(instruction.data.subarray(0, size)).toString("hex"),
        expected:
          protocol === "sugar" ? "disabled-program-rejection" : "confirmed-success",
        confirmed: 0,
        simulatedRejections: 0,
        signatures: [],
      });
    }
  }
  assert.equal(
    new Set(catalog.map((entry) => `${entry.program}:${entry.discriminator}`)).size,
    catalog.length,
    "Instruction discriminators must be unambiguous",
  );
  return catalog;
}

/** Records loaded mainnet programs and confirmed execution through a loopback RPC proxy. */
export async function createSurfpoolEvidence(endpoint) {
  const catalog = await instructionCatalog();
  const programs = [];
  const protectedAccounts = new Set();
  const errors = [];
  let confirmedTransactions = 0;
  async function rpc(method, params = []) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: globalThis.AbortSignal.timeout(90_000),
    });
    if (!response.ok)
      throw new Error(`Surfpool HTTP ${response.status} during ${method}`);
    return response.json();
  }
  async function account(address) {
    const response = await rpc("getAccountInfo", [
      address,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    assert.ok(
      !response.error && response.result?.value,
      `Unable to hydrate program account ${address}`,
    );
    return response.result.value;
  }
  for (const program of new Set(catalog.map((entry) => entry.program))) {
    const info = await account(program);
    assert.equal(info.executable, true, `Mainnet program is not executable: ${program}`);
    const data = Buffer.from(info.data[0], "base64");
    assert.equal(
      info.owner,
      "BPFLoaderUpgradeab1e11111111111111111111111",
      `Unexpected loader for ${program}`,
    );
    assert.equal(data.readUInt32LE(0), 2, "Expected upgradeable Program account");
    const programDataAddress = getAddressDecoder().decode(data.subarray(4, 36));
    const deployed = Buffer.from((await account(programDataAddress)).data[0], "base64");
    assert.equal(deployed.readUInt32LE(0), 3, "Expected ProgramData account");
    const elf = deployed.subarray(45);
    assert.equal(
      elf.subarray(0, 4).toString("hex"),
      "7f454c46",
      `Missing ELF for ${program}`,
    );
    programs.push({
      protocol: catalog.find((entry) => entry.program === program).protocol,
      address: program,
      programDataAddress,
      deploymentSlot: deployed.readBigUInt64LE(4).toString(),
      elfSha256: createHash("sha256").update(elf).digest("hex"),
      elfBytes: elf.length,
    });
    console.log(
      `Hydrated ${programs.at(-1).protocol}: deployment ${programs.at(-1).deploymentSlot}, ELF ${programs.at(-1).elfSha256}`,
    );
    protectedAccounts.add(program);
    protectedAccounts.add(programDataAddress);
  }
  function transactionMessage(request) {
    assert.equal(
      request.params[1]?.encoding,
      "base64",
      "Evidence requires explicit base64 transactions",
    );
    const transaction = getTransactionDecoder().decode(
      Buffer.from(request.params[0], "base64"),
    );
    return getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  }
  async function observe(request, response, message) {
    if (!message) return;
    const matches = message.instructions.flatMap((instruction, index) => {
      const program = message.staticAccounts[instruction.programAddressIndex];
      const data = Buffer.from(instruction.data ?? []);
      return catalog
        .filter(
          (entry) =>
            entry.program === program &&
            data.subarray(0, entry.discriminator.length / 2).toString("hex") ===
              entry.discriminator,
        )
        .map((entry) => ({ entry, index }));
    });
    if (!matches.length) return;
    if (request.method === "simulateTransaction") {
      const result = response.result?.value;
      for (const { entry, index } of matches) {
        if (
          entry.expected === "disabled-program-rejection" &&
          JSON.stringify(result?.err) ===
            JSON.stringify({ InstructionError: [index, { Custom: 1 }] }) &&
          result.unitsConsumed === 2 &&
          result.logs?.some((line) => line === `Program ${entry.program} invoke [1]`)
        )
          entry.simulatedRejections++;
      }
      return;
    }
    if (response.error) return; // Negative cases are asserted by their native E2E tests.
    assert.equal(typeof response.result, "string", "Missing transaction signature");
    let receipt;
    for (let attempt = 0; attempt < 20; attempt++) {
      receipt = (
        await rpc("getTransaction", [
          response.result,
          {
            encoding: "json",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          },
        ])
      ).result;
      if (receipt) break;
      await delay(100);
    }
    assert.ok(receipt?.meta, `No confirmed receipt for ${response.result}`);
    if (receipt.meta.err !== null) return;
    confirmedTransactions++;
    for (const { entry } of matches) {
      assert.ok(
        receipt.meta.logMessages?.some(
          (line) => line === `Program ${entry.program} invoke [1]`,
        ),
        `Missing native invocation for ${entry.name}`,
      );
      entry.confirmed++;
      if (entry.signatures.length < 3) entry.signatures.push(response.result);
    }
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      let body = "";
      for await (const chunk of incoming) body += chunk.toString();
      const request = JSON.parse(body);
      if (request.method === "surfnet_setAccount") {
        assert.ok(
          !protectedAccounts.has(request.params[0]) &&
            request.params[1]?.executable !== true,
          "Tests must not replace deployed program binaries",
        );
      }
      assert.ok(
        !/^(surfnet_setProgram|surfnet_cloneProgram)/.test(request.method),
        "Tests must not replace deployed program binaries",
      );
      const message = ["sendTransaction", "simulateTransaction"].includes(request.method)
        ? transactionMessage(request)
        : undefined;
      if (message) {
        // Hydrate through individual reads before Surfpool 1.6 batches missing accounts.
        // Reads preserve locally seeded state; absent accounts remain absent.
        const addresses = new Set(message.staticAccounts);
        const lookups = message.addressTableLookups ?? [];
        if (lookups.length) {
          const tables = await fetchAddressesForLookupTables(
            lookups.map((lookup) => lookup.lookupTableAddress),
            createSolanaRpc(endpoint),
            { abortSignal: globalThis.AbortSignal.timeout(90_000) },
          );
          for (const lookup of lookups) {
            for (const index of [...lookup.writableIndexes, ...lookup.readonlyIndexes]) {
              const address = tables[lookup.lookupTableAddress]?.[index];
              assert.ok(address, `Missing lookup-table address at index ${index}`);
              addresses.add(address);
            }
          }
        }
        for (const address of addresses) {
          const hydrated = await rpc("getAccountInfo", [
            address,
            { encoding: "base64", commitment: "confirmed" },
          ]);
          assert.ok(
            !hydrated.error && hydrated.result && "value" in hydrated.result,
            `Unable to hydrate transaction account ${address}`,
          );
          if (hydrated.result.value === null) {
            // Preserve verified absence without re-fetching uncreated accounts or virtual sysvars.
            const absent = await rpc("surfnet_offlineAccount", [address]);
            assert.ok(!absent.error, `Unable to retain absent account ${address}`);
          }
        }
      }
      const response = await rpc(request.method, request.params);
      await observe(request, response, message);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ ...response, id: request.id }));
    } catch (error) {
      errors.push(error.message);
      outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    report() {
      const instructions = catalog.map((entry) => ({
        ...entry,
        covered:
          entry.expected === "confirmed-success"
            ? entry.confirmed > 0
            : entry.simulatedRejections > 0 && entry.confirmed === 0,
      }));
      return {
        source: "https://api.mainnet-beta.solana.com",
        programs,
        confirmedTransactions,
        instructions,
        errors,
        complete: errors.length === 0 && instructions.every((entry) => entry.covered),
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
