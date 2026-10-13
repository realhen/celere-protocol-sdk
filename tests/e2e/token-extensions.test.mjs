import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import {
  AccountState,
  getMintDecoder,
  getMintEncoder,
  getTokenDecoder,
  getTokenEncoder,
} from "@solana-program/token-2022";
import {
  buildSwapInstructions,
  compileTransaction,
  InvalidAccountError,
  UnsupportedTokenExtensionError,
} from "../../dist/index.js";
import { pumpV3Fixture } from "../fixtures/pump-v3.mjs";

function setMintExtensions(account, extensions) {
  account.data = Uint8Array.from(
    getMintEncoder().encode({
      ...getMintDecoder().decode(account.data),
      extensions,
    }),
  );
}

function setTokenExtensions(account, extensions, state = AccountState.Initialized) {
  account.data = Uint8Array.from(
    getTokenEncoder().encode({
      ...getTokenDecoder().decode(account.data),
      state,
      extensions,
    }),
  );
}

test("consumer builds and compiles swaps from officially encoded metadata and immutable-owner accounts", async () => {
  const owner = await generateKeyPairSigner();
  const fixture = await pumpV3Fixture(owner.address, {
    quote: "token",
    base2022: true,
    quote2022: true,
  });
  const { request } = fixture;
  const baseline = await buildSwapInstructions(request);

  for (const address of [fixture.mint, fixture.quoteMint]) {
    setMintExtensions(request.snapshot.accounts[address], [
      { __kind: "MetadataPointer", authority: null, metadataAddress: address },
      {
        __kind: "TokenMetadata",
        updateAuthority: null,
        mint: address,
        name: "Example token",
        symbol: "EXAMPLE",
        uri: "https://example.com/token.json",
        additionalMetadata: new Map(),
      },
    ]);
  }

  for (const address of [fixture.userBase, fixture.userQuote]) {
    setTokenExtensions(request.snapshot.accounts[address], [
      { __kind: "ImmutableOwner" },
    ]);
  }

  const built = await buildSwapInstructions(request);
  assert.deepEqual(built.quote, baseline.quote);
  assert.deepEqual(built.instructions, baseline.instructions);

  // Real account allocations can retain either odd or even unused TLV padding.
  for (const padding of [1, 2, 3]) {
    for (const address of [fixture.quoteMint, fixture.userQuote]) {
      const account = request.snapshot.accounts[address];
      const original = account.data;
      account.data = new Uint8Array(original.length + padding);
      account.data.set(original);
      assert.deepEqual(
        (await buildSwapInstructions(request)).instructions,
        baseline.instructions,
      );
      account.data = original;
    }
  }

  assert.ok(
    compileTransaction({
      instructions: built.instructions,
      feePayer: owner.address,
      lifetime: {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 1n,
      },
    }).byteLength <= 1232,
  );
});

test("consumer receives named failures for unsupported extensions and malformed token snapshots", async () => {
  const owner = await generateKeyPairSigner();
  for (const mutation of [
    "transfer-hook",
    "memo-transfer",
    "duplicate-mint-extension",
    "duplicate-account-extension",
    "extension-after-padding",
    "truncated-extension",
    "unknown-extension",
    "wrong-account-type",
    "frozen-account",
  ]) {
    const fixture = await pumpV3Fixture(owner.address, {
      quote: "token",
      base2022: true,
      quote2022: true,
    });
    const mint = fixture.request.snapshot.accounts[fixture.quoteMint];
    const token = fixture.request.snapshot.accounts[fixture.userQuote];
    const pointer = { __kind: "MetadataPointer", authority: null, metadataAddress: null };
    let unsupported;

    switch (mutation) {
      case "transfer-hook":
        setMintExtensions(mint, [
          { __kind: "TransferHook", authority: owner.address, programId: owner.address },
        ]);
        unsupported = "TransferHook";
        break;
      case "memo-transfer":
        setTokenExtensions(token, [
          { __kind: "MemoTransfer", requireIncomingTransferMemos: true },
        ]);
        unsupported = "MemoTransfer";
        break;
      case "duplicate-mint-extension":
        setMintExtensions(mint, [pointer, pointer]);
        break;
      case "duplicate-account-extension":
        setTokenExtensions(token, [
          { __kind: "ImmutableOwner" },
          { __kind: "ImmutableOwner" },
        ]);
        break;
      case "extension-after-padding":
        setMintExtensions(mint, [{ __kind: "Uninitialized" }, pointer]);
        break;
      case "truncated-extension":
        setMintExtensions(mint, [pointer]);
        mint.data = mint.data.slice(0, -1);
        break;
      case "unknown-extension":
        setMintExtensions(mint, [pointer]);
        mint.data[166] = 255;
        mint.data[167] = 255;
        break;
      case "wrong-account-type":
        setMintExtensions(mint, [pointer]);
        mint.data[165] = 2;
        break;
      case "frozen-account":
        setTokenExtensions(token, [{ __kind: "ImmutableOwner" }], AccountState.Frozen);
        break;
    }

    await assert.rejects(
      () => buildSwapInstructions(fixture.request),
      (error) => {
        if (unsupported) {
          assert.ok(error instanceof UnsupportedTokenExtensionError, mutation);
          assert.equal(error.extension, unsupported);
        } else {
          assert.ok(error instanceof InvalidAccountError, mutation);
        }
        return true;
      },
    );
  }
});
