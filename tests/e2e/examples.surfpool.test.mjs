import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  generateKeyPairSigner,
  getAddressEncoder,
} from "@solana/kit";
import {
  SYSTEM_PROGRAM_ADDRESS,
  getCreateAccountInstruction,
  getInitializeNonceAccountInstruction,
  getTransferSolInstruction,
} from "@solana-program/system";
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
} from "@solana-program/token";
import { installExampleProject } from "../fixtures/example-projects.mjs";
import { meteoraDlmmFixture } from "../fixtures/meteora-dlmm.mjs";
import { pumpV3Fixture } from "../fixtures/pump-v3.mjs";
import { preservePumpConfiguration } from "../fixtures/pump-surfpool-state.mjs";
import { rpc, SOL, submitInstructions } from "../fixtures/pump-helpers.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
const run = promisify(execFile);
preservePumpConfiguration(endpoint);

async function tokenBalance(account) {
  const response = await rpc(endpoint, "getAccountInfo", [
    account,
    { encoding: "base64" },
  ]);
  return response.value
    ? Buffer.from(response.value.data[0], "base64").readBigUInt64LE(64)
    : 0n;
}

for (const project of ["pumpfun", "meteora-dlmm"]) {
  test(
    `copied ${project} project builds and sends a native buy through its CLI`,
    { skip: !endpoint, timeout: 120_000 },
    async () => {
      assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname));
      const directory = await mkdtemp(join(tmpdir(), "celere-example-e2e-"));
      try {
        // Ephemeral simulator-only keys stay in this temporary directory and are removed below.
        const seed = randomBytes(32);
        const wallet = await createKeyPairSignerFromPrivateKeyBytes(seed);
        const keyPath = join(directory, "wallet.json");
        await writeFile(
          keyPath,
          JSON.stringify([...seed, ...getAddressEncoder().encode(wallet.address)]),
          { mode: 0o600 },
        );
        const packed = JSON.parse(
          execFileSync(
            "npm",
            ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
            { encoding: "utf8" },
          ),
        )[0];
        const application = join(directory, project);
        await installExampleProject(
          resolve("example", project),
          application,
          join(directory, packed.filename),
          packed.integrity,
        );
        const clock = await rpc(endpoint, "getAccountInfo", [
          SYSVAR_CLOCK_ADDRESS,
          { encoding: "base64" },
        ]);
        const timestamp = Buffer.from(clock.value.data[0], "base64").readBigInt64LE(32);
        const fixture =
          project === "pumpfun"
            ? await pumpV3Fixture(wallet.address, { label: `example:${wallet.address}` })
            : await meteoraDlmmFixture(wallet.address, {
                label: "example-wsol",
                unixTimestamp: timestamp,
                quoteMint: SOL,
              });
        const outputMint =
          project === "pumpfun"
            ? fixture.mint
            : fixture.mintX === SOL
              ? fixture.mintY
              : fixture.mintX;
        const [outputAta] = await findAssociatedTokenPda({
          owner: wallet.address,
          mint: outputMint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        for (const account of Object.values(fixture.request.snapshot.accounts)) {
          if (!account || account.address === outputAta || account.address === SOL)
            continue;
          const data = Buffer.from(account.data);
          let lamports = account.lamports;
          // WSOL reserves must carry real native lamports as well as their token balance.
          if (
            account.owner === TOKEN_PROGRAM_ADDRESS &&
            data.length === 165 &&
            data.subarray(0, 32).equals(Buffer.from(getAddressEncoder().encode(SOL)))
          ) {
            data.writeUInt32LE(1, 109);
            data.writeBigUInt64LE(2_039_280n, 113);
            lamports = data.readBigUInt64LE(64) + 2_039_280n;
          }
          await rpc(endpoint, "surfnet_setAccount", [
            account.address,
            {
              owner: account.owner,
              data: data.toString("hex"),
              lamports: Number(lamports),
              executable: false,
            },
          ]);
        }
        await rpc(endpoint, "surfnet_setAccount", [
          wallet.address,
          {
            owner: SYSTEM_PROGRAM_ADDRESS,
            data: "",
            lamports: 10_000_000_000,
            executable: false,
          },
        ]);
        const nonce = await generateKeyPairSigner();
        await submitInstructions(
          endpoint,
          [
            getCreateAccountInstruction({
              payer: wallet,
              newAccount: nonce,
              lamports: BigInt(
                await rpc(endpoint, "getMinimumBalanceForRentExemption", [80]),
              ),
              space: 80n,
              programAddress: SYSTEM_PROGRAM_ADDRESS,
            }),
            getInitializeNonceAccountInstruction({
              nonceAccount: nonce.address,
              nonceAuthority: wallet.address,
            }),
          ],
          wallet,
          [wallet, nonce],
        );
        if (project === "meteora-dlmm") {
          // The simplified example explicitly expects a pre-funded canonical WSOL ATA.
          const [ata] = await findAssociatedTokenPda({
            owner: wallet.address,
            mint: SOL,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          });
          await submitInstructions(
            endpoint,
            [
              getCreateAssociatedTokenIdempotentInstruction({
                payer: wallet,
                ata,
                owner: wallet.address,
                mint: SOL,
              }),
              getTransferSolInstruction({
                source: wallet,
                destination: ata,
                amount: 10_000_000n,
              }),
              getSyncNativeInstruction({ account: ata }),
            ],
            wallet,
          );
        }
        // Exercise error handling and cancellation through the installed public API,
        // before the same package builds and submits the real buy below.
        await writeFile(
          join(application, "errors.mjs"),
          `
          import assert from "node:assert/strict";
          import { createSolanaRpc, createSolanaRpcFromTransport, createDefaultRpcTransport } from "@solana/kit";
          import { fetchSwapInstructions, InvalidRequestError, UnsupportedProtocolError, getPumpBondingCurveAddress } from "celere-protocol-sdk";
          import { getPumpBondingCurveAddress as getCurve } from "celere-protocol-sdk/protocols/pump";
          const rpc = createSolanaRpc(${JSON.stringify(endpoint)});
          const request = {
            pool: ${JSON.stringify(fixture.pool ?? fixture.request.pool)},
            owner: ${JSON.stringify(wallet.address)}, payer: ${JSON.stringify(wallet.address)},
            inputMint: ${JSON.stringify(SOL)}, outputMint: ${JSON.stringify(outputMint)},
            amount: { kind: "exactIn", amountIn: 10_000_000n }, slippageBps: 100,
            fillPolicy: "requireFull",
          };
          assert.equal(await getCurve(request.outputMint), await getPumpBondingCurveAddress(request.outputMint));
          await assert.rejects(fetchSwapInstructions(rpc, { ...request, slippageBps: 10001 }),
            error => error instanceof InvalidRequestError && error.code === "INVALID_REQUEST" && error.field === "slippageBps");
          // This wallet exists but is owned by System, so discovery must preserve the
          // unsupported-program detail from the offline builder after an actual RPC read.
          await assert.rejects(fetchSwapInstructions(rpc, { ...request, pool: request.owner }),
            error => error instanceof UnsupportedProtocolError && error.code === "UNSUPPORTED_PROTOCOL");
          // Observe real RPC discovery, then cancel just after the final batch.
          // PDA derivation yields during final discovery/build after network I/O ends.
          const transport = createDefaultRpcTransport({ url: ${JSON.stringify(endpoint)} });
          let rounds = 0;
          await fetchSwapInstructions(createSolanaRpcFromTransport(async (...args) => {
            rounds++;
            return transport(...args);
          }), request);
          let reads = 0;
          const duringBuild = new AbortController();
          const buildReason = new Error("Cancelled during final construction");
          const abortingRpc = createSolanaRpcFromTransport(async (...args) => {
            const response = await transport(...args);
            if (++reads === rounds) setImmediate(() => duringBuild.abort(buildReason));
            return response;
          });
          await assert.rejects(fetchSwapInstructions(abortingRpc, request, { abortSignal: duringBuild.signal }),
            error => error === buildReason);
          assert.equal(reads, rounds);
          const controller = new AbortController();
          const reason = new Error("Caller cancelled the build");
          controller.abort(reason);
          await assert.rejects(fetchSwapInstructions(rpc, request, { abortSignal: controller.signal }),
            error => error === reason);
        `,
        );
        await run("node", ["errors.mjs"], { cwd: application });

        // Fill in the copied script exactly as a reader would. Both provider URLs
        // point to the disposable simulator; the test never contacts live senders.
        const scriptPath = join(application, "main.ts");
        let source = await readFile(scriptPath, "utf8");
        for (const [placeholder, value] of [
          ["https://YOUR_RPC_ENDPOINT", endpoint],
          ["/absolute/path/to/your/keypair.json", keyPath],
          ["YOUR_TOKEN_MINT", outputMint],
          ["YOUR_NONCE_ACCOUNT", nonce.address],
          ...(project === "meteora-dlmm"
            ? [["YOUR_DLMM_POOL_ADDRESS", fixture.pool]]
            : []),
        ]) {
          assert.ok(source.includes(JSON.stringify(placeholder)));
          source = source.replace(JSON.stringify(placeholder), JSON.stringify(value));
        }
        for (const key of ["YOUR_HELIUS_API_KEY", "YOUR_ZERO_SLOT_API_KEY"]) {
          assert.ok(source.includes(JSON.stringify(key)));
          source = source.replace(
            JSON.stringify(key),
            `"simulator", endpoint: ${JSON.stringify(endpoint)}`,
          );
        }
        await writeFile(scriptPath, source);
        const beforeTokens = await tokenBalance(outputAta);
        const sent = await run("npm", ["start"], {
          cwd: application,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        });
        const signatures = [...sent.stdout.matchAll(/Submitted signature: (\w+)/g)].map(
          (match) => match[1],
        );
        assert.equal(signatures.length, 3);
        const successful = [];
        for (const signature of signatures) {
          const receipt = await rpc(endpoint, "getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          if (receipt && receipt.meta.err === null) successful.push(receipt);
        }
        assert.equal(successful.length, 1, "Exactly one buy variant must execute");
        assert.ok(
          (await tokenBalance(outputAta)) > beforeTokens,
          "The copied application's buy must credit actual output tokens",
        );
        assert.ok(
          successful[0].meta.logMessages.some((line) =>
            line.includes(
              project === "pumpfun" ? "Instruction: BuyExactSolIn" : "Instruction: Swap2",
            ),
          ),
        );
      } catch (error) {
        if (error.stdout) console.error(error.stdout.toString());
        if (error.stderr) console.error(error.stderr.toString());
        throw error;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
