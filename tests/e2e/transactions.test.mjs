import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountRole,
  address,
  getAddressDecoder,
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import {
  compileTransaction,
  InvalidRequestError,
  TransactionTooLargeError,
} from "../../dist/index.js";

const payer = address("11111111111111111111111111111111");
const owner = address("So11111111111111111111111111111111111111112");
const program = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const lifetime = { blockhash: payer, lastValidBlockHeight: 123n };

test("consumer composes instructions and compiles unsigned transactions with separate signers and lookup tables", () => {
  const account = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const instructions = [
    {
      programAddress: program,
      accounts: [
        { address: owner, role: AccountRole.READONLY_SIGNER },
        { address: account, role: AccountRole.WRITABLE },
      ],
      data: new TextEncoder().encode("celere"),
    },
  ];
  const original = structuredClone(instructions);
  const result = compileTransaction({
    feePayer: payer,
    lifetime,
    instructions,
    computeBudget: { units: 200_000, microLamports: 100n },
  });
  assert.deepEqual(result.requiredSigners, [payer, owner]);
  assert.deepEqual(Object.values(result.transaction.signatures), [null, null]);
  assert.deepEqual(instructions, original);
  assert.equal(result.byteLength, result.wireBytes.length);
  assert.equal(result.transaction.lifetimeConstraint.lastValidBlockHeight, 123n);
  assert.deepEqual(structuredClone(result), result);
  const decoded = getCompiledTransactionMessageDecoder().decode(
    result.transaction.messageBytes,
  );
  assert.equal(decoded.version, 0);
  assert.equal(decoded.instructions.length, 3);
  const compressed = compileTransaction({
    feePayer: payer,
    lifetime,
    instructions,
    lookupTables: [{ address: program, addresses: [account] }],
  });
  const message = getCompiledTransactionMessageDecoder().decode(
    compressed.transaction.messageBytes,
  );
  assert.equal(message.addressTableLookups.length, 1);
  assert.deepEqual(compressed.requiredSigners, [payer, owner]);
});

test("compiler reports actionable validation and size failures without dropping caller instructions", () => {
  assert.throws(
    () =>
      compileTransaction({
        feePayer: payer,
        lifetime,
        instructions: [{ programAddress: program, data: new Uint8Array(1400) }],
      }),
    (error) =>
      error instanceof TransactionTooLargeError &&
      error.code === "TRANSACTION_TOO_LARGE" &&
      error.size > error.limit,
  );

  assert.throws(
    () =>
      compileTransaction({
        feePayer: payer,
        lifetime,
        instructions: [
          {
            programAddress: address("ComputeBudget111111111111111111111111111111"),
            data: new Uint8Array([2, 1, 0, 0, 0]),
          },
        ],
        computeBudget: { units: 100_000 },
      }),
    (error) =>
      error instanceof InvalidRequestError &&
      error.code === "INVALID_REQUEST" &&
      error.field === "computeBudget",
  );
  assert.throws(
    () =>
      compileTransaction({
        feePayer: payer,
        lifetime,
        instructions: [{ programAddress: program }],
        computeBudget: { units: 100_000, microLamports: -1n },
      }),
    InvalidRequestError,
  );
});

test("compiler rejects fee payers that are invoked by caller or generated instructions", () => {
  const requests = [
    {
      feePayer: program,
      lifetime,
      instructions: [{ programAddress: program }],
    },
    {
      feePayer: address("ComputeBudget111111111111111111111111111111"),
      lifetime,
      instructions: [{ programAddress: program }],
      computeBudget: { units: 100_000 },
    },
    {
      feePayer: payer,
      lifetime: { account: owner, authority: payer, value: program },
      instructions: [{ programAddress: program }],
    },
  ];
  for (const request of requests) {
    assert.throws(
      () => compileTransaction(request),
      (error) => error instanceof InvalidRequestError && error.field === "feePayer",
    );
  }
});

test("compiler throws request errors for account-index overflow and malformed JavaScript input", () => {
  const accounts = Array.from({ length: 256 }, (_, index) => {
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, index + 1000, true);
    return { address: getAddressDecoder().decode(bytes), role: AccountRole.READONLY };
  });
  assert.throws(
    () =>
      compileTransaction({
        feePayer: payer,
        lifetime,
        instructions: [{ programAddress: program, accounts }],
      }),
    (error) =>
      error instanceof InvalidRequestError && error.field === "instructions.accounts",
  );
  for (const request of [null, {}, { feePayer: payer, lifetime, instructions: [null] }]) {
    assert.throws(() => compileTransaction(request), InvalidRequestError);
  }
});

test("durable nonce stays static when present in an ALT without renumbering other lookups", async () => {
  const payer = (await generateKeyPairSigner()).address;
  const recipient = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const result = compileTransaction({
    feePayer: payer,
    lifetime: { account: owner, authority: payer, value: program },
    instructions: [
      {
        programAddress: program,
        accounts: [{ address: recipient, role: AccountRole.WRITABLE }],
        data: new Uint8Array([1]),
      },
    ],
    computeBudget: { units: 100_000, microLamports: 1n },
    lookupTables: [{ address: program, addresses: [owner, recipient] }],
  });
  const message = getCompiledTransactionMessageDecoder().decode(
    result.transaction.messageBytes,
  );
  const nonceIndex = message.instructions[0].accountIndices[0];
  assert.ok(nonceIndex < message.staticAccounts.length);
  assert.equal(message.staticAccounts[nonceIndex], owner);
  assert.deepEqual([...message.addressTableLookups[0].writableIndexes], [1]);
  assert.equal(message.lifetimeToken, program);
  assert.throws(
    () =>
      compileTransaction({
        feePayer: payer,
        lifetime: { account: owner, authority: payer, value: program },
        instructions: [
          {
            programAddress: address("11111111111111111111111111111111"),
            data: new Uint8Array([4, 0, 0, 0]),
          },
        ],
      }),
    InvalidRequestError,
  );
});
