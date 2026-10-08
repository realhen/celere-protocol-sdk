import {
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { SYSVAR_RENT_ADDRESS } from "@solana/sysvars";
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getBase64EncodedWireTransaction,
  signTransaction,
} from "@solana/kit";
import { compileTransaction, getSwapRequirements } from "../../dist/index.js";
import assert from "node:assert/strict";
import { TextEncoder } from "node:util";

export const PUMP = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const SOL = WRAPPED_SOL_MINT;
export const TOKEN = TOKEN_PROGRAM_ADDRESS;
export const TOKEN_2022 = TOKEN_2022_PROGRAM_ADDRESS;
const MAYHEM = address("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const ASSOCIATED = ASSOCIATED_TOKEN_PROGRAM_ADDRESS;
const METADATA = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SYSTEM = SYSTEM_PROGRAM_ADDRESS;
const bytes = getAddressEncoder();
const utf8 = new TextEncoder();

export async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.result;
}

async function derive(programAddress, seeds) {
  return (await getProgramDerivedAddress({ programAddress, seeds }))[0];
}

export async function curveAddress(mint) {
  return derive(PUMP, [utf8.encode("bonding-curve"), bytes.encode(mint)]);
}

export async function tokenAddress(owner, mint, tokenProgram = TOKEN) {
  return derive(
    ASSOCIATED,
    [owner, tokenProgram, mint].map((value) => bytes.encode(value)),
  );
}

function borshString(value) {
  const contents = utf8.encode(value);
  const data = new Uint8Array(contents.length + 4);
  new DataView(data.buffer).setUint32(0, contents.length, true);
  data.set(contents, 4);
  return data;
}

// Fixture provisioning only: native create layout from @pump-fun/pump-sdk 4.0.0 IDL.
export async function createCurveInstruction(user, mint, tokenProgram = TOKEN) {
  const isToken2022 = tokenProgram === TOKEN_2022;
  const curve = await curveAddress(mint);
  const readonly = (value) => ({ address: value, role: AccountRole.READONLY });
  const writable = (value) => ({ address: value, role: AccountRole.WRITABLE });
  const pieces = [
    new Uint8Array(
      isToken2022
        ? [214, 144, 76, 236, 95, 139, 49, 180]
        : [24, 30, 200, 40, 5, 28, 7, 119],
    ),
    borshString("Celere Builder Test"),
    borshString("CELT"),
    borshString("https://example.com/celere-test.json"),
    bytes.encode(user),
    ...(isToken2022 ? [new Uint8Array(11)] : []),
  ];
  const data = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    data.set(piece, offset);
    offset += piece.length;
  }
  return {
    programAddress: PUMP,
    data,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE_SIGNER },
      readonly(await derive(PUMP, [utf8.encode("mint-authority")])),
      writable(curve),
      writable(await tokenAddress(curve, mint, tokenProgram)),
      readonly(await derive(PUMP, [utf8.encode("global")])),
      ...(isToken2022
        ? []
        : [
            readonly(METADATA),
            writable(
              await derive(METADATA, [
                utf8.encode("metadata"),
                bytes.encode(METADATA),
                bytes.encode(mint),
              ]),
            ),
          ]),
      { address: user, role: AccountRole.WRITABLE_SIGNER },
      readonly(SYSTEM),
      readonly(tokenProgram),
      readonly(ASSOCIATED),
      ...(isToken2022
        ? [
            writable(MAYHEM),
            readonly(await derive(MAYHEM, [utf8.encode("global-params")])),
            writable(await derive(MAYHEM, [utf8.encode("sol-vault")])),
            writable(
              await derive(MAYHEM, [utf8.encode("mayhem-state"), bytes.encode(mint)]),
            ),
            writable(
              await tokenAddress(
                await derive(MAYHEM, [utf8.encode("sol-vault")]),
                mint,
                TOKEN_2022,
              ),
            ),
          ]
        : [readonly(SYSVAR_RENT_ADDRESS)]),
      readonly(await derive(PUMP, [utf8.encode("__event_authority")])),
      readonly(PUMP),
    ],
  };
}

export async function submitInstructions(url, instructions, payer, signers = [payer]) {
  const latest = await rpc(url, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const compiled = compileTransaction({
    instructions,
    feePayer: payer.address,
    lifetime: {
      blockhash: latest.value.blockhash,
      lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
    },
    computeBudget: { units: 500_000 },
  });
  assert.equal(
    compiled.ok,
    true,
    JSON.stringify(compiled, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
  const signed = await signTransaction(
    signers.map((signer) => signer.keyPair),
    compiled.value.transaction,
  );
  const signature = await rpc(url, "sendTransaction", [
    getBase64EncodedWireTransaction(signed),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await rpc(url, "getSignatureStatuses", [[signature]]);
    if (
      result.value[0]?.confirmationStatus === "confirmed" ||
      result.value[0]?.confirmationStatus === "finalized"
    ) {
      assert.equal(result.value[0].err, null);
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Local transaction did not confirm: ${signature}`);
}

export async function observeRequest(url, request) {
  const epoch = await rpc(url, "getEpochInfo", [{ commitment: "confirmed" }]);
  const timestamp = await rpc(url, "getBlockTime", [epoch.absoluteSlot]);
  const snapshot = {
    slot: BigInt(epoch.absoluteSlot),
    epoch: BigInt(epoch.epoch),
    unixTimestamp: BigInt(timestamp ?? 0),
    accounts: {},
  };
  const observed = { ...request, snapshot };
  for (let round = 0; round < 6; round++) {
    const result = await getSwapRequirements(observed);
    assert.equal(
      result.ok,
      true,
      JSON.stringify(result, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
    if (result.value.complete) return observed;
    const accounts = result.value.missing;
    const resultAccounts = await rpc(url, "getMultipleAccounts", [
      accounts.map((entry) => entry.address),
      { encoding: "base64", commitment: "confirmed" },
    ]);
    snapshot.slot = BigInt(resultAccounts.context.slot);
    resultAccounts.value.forEach((account, index) => {
      const accountAddress = accounts[index].address;
      snapshot.accounts[accountAddress] =
        account === null
          ? null
          : {
              address: accountAddress,
              owner: address(account.owner),
              data: Uint8Array.from(Buffer.from(account.data[0], "base64")),
              lamports: BigInt(account.lamports),
              executable: account.executable,
              slot: snapshot.slot,
            };
    });
  }
  assert.fail("Account discovery did not converge");
}
