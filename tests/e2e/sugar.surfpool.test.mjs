import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test from "node:test";
import { SYSVAR_RENT_ADDRESS } from "@solana/sysvars";
import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { buy_exact_in } from "../../dist/protocols/sugar/instructions/index.js";
import { SUGAR_PROGRAM } from "../../dist/protocols/sugar/constants.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  signTransaction,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { compileTransaction } from "../../dist/index.js";
import { sugarFixture } from "../fixtures/sugar.mjs";

const endpoint = process.env.CELERE_SURFPOOL_URL;
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error("Native Sugar tests only accept loopback simulators");
function value(result) {
  assert.equal(
    result.ok,
    true,
    JSON.stringify(result, (_, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
  return result.value;
}
async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function install(fixture, signer) {
  await rpc("surfnet_setAccount", [
    signer.address,
    {
      lamports: 1_000_000_000_000,
      owner: SYSTEM_PROGRAM_ADDRESS,
      executable: false,
      data: "",
    },
  ]);
  for (const account of Object.values(fixture.request.snapshot.accounts)) {
    if (!account) continue;
    await rpc("surfnet_setAccount", [
      account.address,
      {
        lamports: Number(account.lamports),
        owner: account.owner,
        executable: false,
        data: Buffer.from(account.data).toString("hex"),
      },
    ]);
  }
}

// Mainnet deployment slot 450795393 replaced Sugar with a two-instruction
// program: mov64 r0, 1; exit. An interface-only builder cannot restore execution.
test(
  "Sugar current deployment rejects a correctly formed historical swap",
  { skip: !endpoint, timeout: 120_000 },
  async () => {
    const signer = await generateKeyPairSigner();
    const f = await sugarFixture(signer.address);
    await install(f, signer);
    const enc = getAddressEncoder(),
      text = new TextEncoder();
    const [, curveBump] = await getProgramDerivedAddress({
      programAddress: SUGAR_PROGRAM,
      seeds: [text.encode("bonding_curve_"), enc.encode(f.mint)],
    });
    const [, solVaultBump] = await getProgramDerivedAddress({
      programAddress: SUGAR_PROGRAM,
      seeds: [
        text.encode("bonding_curve_"),
        enc.encode(f.mint),
        text.encode("_sol_vault"),
      ],
    });
    const [eventAuthority] = await getProgramDerivedAddress({
      programAddress: SUGAR_PROGRAM,
      seeds: [text.encode("__event_authority")],
    });
    const instruction = buy_exact_in(
      {
        state: f.state,
        mint: f.mint,
        bondingCurve: f.pool,
        solVault: f.solVault,
        tokenVault: f.vault,
        userTokenAccount: f.user,
        payer: signer.address,
        receiver: signer.address,
        feeReceiver: f.feeReceiver,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        systemProgram: SYSTEM_PROGRAM_ADDRESS,
        rent: SYSVAR_RENT_ADDRESS,
        eventAuthority,
        program: SUGAR_PROGRAM,
      },
      {
        bondingCurveBump: curveBump,
        solVaultBump,
        solAmountInput: 1_000_001n,
        minTokensOutput: 1n,
      },
    );
    const latest = (await rpc("getLatestBlockhash")).value;
    const built = value(
      compileTransaction({
        instructions: [instruction],
        feePayer: signer.address,
        lifetime: {
          blockhash: latest.blockhash,
          lastValidBlockHeight: BigInt(latest.lastValidBlockHeight),
        },
      }),
    );
    const signed = await signTransaction([signer.keyPair], built.transaction);
    const before = (await rpc("getAccountInfo", [f.pool, { encoding: "base64" }])).value;
    const simulation = (
      await rpc("simulateTransaction", [
        getBase64EncodedWireTransaction(signed),
        { encoding: "base64", sigVerify: true },
      ])
    ).value;
    assert.deepEqual(simulation.err, { InstructionError: [0, { Custom: 1 }] });
    assert.equal(simulation.unitsConsumed, 2);
    assert.deepEqual(
      (await rpc("getAccountInfo", [f.pool, { encoding: "base64" }])).value,
      before,
    );
    const program = (await rpc("getAccountInfo", [SUGAR_PROGRAM, { encoding: "base64" }]))
      .value;
    const programData = getAddressDecoder().decode(
      Buffer.from(program.data[0], "base64").subarray(4),
    );
    const deployed = (await rpc("getAccountInfo", [programData, { encoding: "base64" }]))
      .value;
    const elf = Buffer.from(deployed.data[0], "base64").subarray(45);
    const entry = Number(elf.readBigUInt64LE(24));
    assert.equal(
      elf.subarray(entry, entry + 16).toString("hex"),
      "b7000000010000009500000000000000",
    );
  },
);
