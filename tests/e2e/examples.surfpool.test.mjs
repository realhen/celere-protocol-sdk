import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
} from "@solana-program/system";
import { SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
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
        const env = {
          RPC_URL: endpoint,
          KEYPAIR_PATH: keyPath,
          TOKEN_MINT: outputMint,
          AMOUNT_IN_ATOMS: "2100001",
          SLIPPAGE_BPS: "100",
          CU_PRICE_MICROLAMPORTS: "1000",
          POOL_ADDRESS: fixture.pool,
          INPUT_MINT: SOL,
        };
        // Exercise RPC-only blockhash sending for Pump, nonce fan-out for DLMM.
        if (project === "meteora-dlmm") {
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
          Object.assign(env, {
            NONCE_ACCOUNT: nonce.address,
            ZERO_SLOT_API_KEY: "simulator",
            ZERO_SLOT_ENDPOINT: endpoint,
          });
        }
        await writeFile(
          join(application, ".env"),
          Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n"),
        );
        const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
        const beforeSol = (await rpc(endpoint, "getBalance", [wallet.address])).value;
        const beforeTokens = await tokenBalance(outputAta);
        if (project === "pumpfun") {
          const simulation = await run("npm", ["run", "simulate"], {
            cwd: application,
            env: cleanEnv,
          });
          assert.match(
            simulation.stdout,
            /Simulation succeeded; nothing was signed or submitted/,
          );
        } else {
          await assert.rejects(
            () => run("npm", ["run", "simulate"], { cwd: application, env: cleanEnv }),
            (error) => {
              assert.match(error.stderr, /Fund your WSOL ATA before simulation/);
              return true;
            },
          );
        }
        assert.equal(
          (await rpc(endpoint, "getBalance", [wallet.address])).value,
          beforeSol,
        );
        assert.equal(await tokenBalance(outputAta), beforeTokens);
        const sent = await run("npm", ["start"], { cwd: application, env: cleanEnv });
        const signatures = [...sent.stdout.matchAll(/Submitted signature: (\w+)/g)].map(
          (match) => match[1],
        );
        assert.equal(signatures.length, project === "pumpfun" ? 1 : 2);
        if (project === "meteora-dlmm")
          assert.match(sent.stdout, /WSOL funding signature:/);
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
