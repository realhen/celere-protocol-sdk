import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import {
  buildSwapInstructions,
  getSwapRequirements,
  createProtocolSdk,
  fetchSwapInstructions,
  SwapAccountFetchError,
  InvalidRequestError,
  MissingAccountsError,
  InvalidAccountError,
  InvalidSnapshotContextError,
  ProtocolError,
  ProtocolErrorCode,
  ValidationErrorCode,
} from "../../dist/index.js";
import { raydiumCpmmAdapter } from "../../dist/protocols/raydium/cpmm.js";
import { raydiumCpmmFixture } from "../fixtures/raydium-cpmm.mjs";

const owner = address("11111111111111111111111111111111");

test("JavaScript consumers catch named errors with direct request, missing-state, and freshness metadata", async () => {
  const { request } = await raydiumCpmmFixture(owner);
  const missing = structuredClone(request);
  missing.snapshot.accounts[request.pool] = undefined;
  const discovery = await getSwapRequirements(missing);
  assert.equal(discovery.complete, false);
  assert.equal(discovery.missing[0].address, request.pool);
  await assert.rejects(buildSwapInstructions(missing), (error) => {
    assert.ok(error instanceof MissingAccountsError);
    assert.ok(error instanceof ProtocolError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, "MissingAccountsError");
    assert.equal(error.code, ProtocolErrorCode.MissingAccounts);
    assert.deepEqual(error.accounts, discovery.missing);
    assert.equal("detail" in error, false);
    return true;
  });
  const stale = structuredClone(request);
  stale.snapshot.slot += 10n;
  stale.maxAccountAgeSlots = 1n;
  await assert.rejects(buildSwapInstructions(stale), InvalidSnapshotContextError);
  const malformed = structuredClone(request);
  malformed.snapshot.accounts[request.pool] = { address: request.pool };
  await assert.rejects(buildSwapInstructions(malformed), (error) => {
    assert.ok(error instanceof InvalidAccountError);
    assert.equal(error.address, request.pool);
    assert.equal(error.code, ProtocolErrorCode.InvalidAccount);
    return true;
  });
  for (const bad of [
    null,
    {},
    { ...request, amount: { kind: "exactIn", amountIn: 1.5 } },
  ]) {
    await assert.rejects(buildSwapInstructions(bad), (error) => {
      assert.ok(error instanceof InvalidRequestError);
      assert.equal(error.code, ValidationErrorCode.InvalidRequest);
      assert.equal(typeof error.field, "string");
      return true;
    });
  }
});

test("public adapter boundaries preserve unexpected thrown errors unchanged", async () => {
  const { request } = await raydiumCpmmFixture(owner);
  const unexpected = new Error("Application adapter failed");
  const discoverySdk = createProtocolSdk([
    {
      ...raydiumCpmmAdapter,
      async requirements() {
        throw unexpected;
      },
    },
  ]);
  await assert.rejects(
    discoverySdk.getSwapRequirements(request),
    (error) => error === unexpected,
  );
  await assert.rejects(
    discoverySdk.buildSwapInstructions(request),
    (error) => error === unexpected,
  );
  const buildSdk = createProtocolSdk([
    {
      ...raydiumCpmmAdapter,
      async build() {
        throw unexpected;
      },
    },
  ]);
  await assert.rejects(
    buildSdk.buildSwapInstructions(request),
    (error) => error === unexpected,
  );
});

test("RPC convenience preserves public request errors, transport failures, and cancellation reasons", async () => {
  const { request } = await raydiumCpmmFixture(owner);
  const intent = { ...request };
  delete intent.snapshot;
  let reads = 0;
  const transportFailure = new Error("RPC unavailable");
  const rpc = {
    getMultipleAccounts() {
      return {
        async send() {
          reads++;
          throw transportFailure;
        },
      };
    },
  };
  await assert.rejects(
    fetchSwapInstructions(rpc, { ...intent, slippageBps: 10001 }),
    (error) => error instanceof InvalidRequestError && error.field === "slippageBps",
  );
  assert.equal(reads, 0);
  await assert.rejects(
    fetchSwapInstructions(rpc, intent),
    (error) => error === transportFailure,
  );
  assert.equal(reads, 1);
  const controller = new globalThis.AbortController();
  const cancellation = new Error("Application cancelled the swap");
  controller.abort(cancellation);
  await assert.rejects(
    fetchSwapInstructions(rpc, intent, { abortSignal: controller.signal }),
    (error) => error === cancellation,
  );
  assert.equal(reads, 1);
  const incompleteRpc = {
    getMultipleAccounts() {
      return {
        async send() {
          return { context: { slot: 1n }, value: [] };
        },
      };
    },
  };
  await assert.rejects(
    fetchSwapInstructions(incompleteRpc, intent),
    SwapAccountFetchError,
  );
});
