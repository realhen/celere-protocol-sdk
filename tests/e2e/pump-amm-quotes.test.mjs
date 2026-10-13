import {
  UnsupportedSwapModeError,
  getSwapRequirements,
  buildSwapInstructions,
  compileTransaction,
} from "../../dist/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { getMintDecoder, getMintEncoder } from "@solana-program/token-2022";

import { deterministicAddress, TOKEN, TOKEN_2022 } from "../fixtures/pump-amm.mjs";
import { pumpAmmQuotesFixture } from "../fixtures/pump-amm-quotes.mjs";

test("offline PumpSwap consumers discover modern quote accounts and compile each native amount mode", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("SDK accessed network");
  };
  try {
    for (const quote of ["usdc", "exotic"])
      for (const tokenProgram of [TOKEN, TOKEN_2022])
        for (const mode of ["buy-in", "buy-out", "sell-in"]) {
          const f = await pumpAmmQuotesFixture(deterministicAddress("quote-consumer"), {
            quote,
            baseTokenProgram: tokenProgram,
            quoteTokenProgram: quote === "exotic" ? tokenProgram : TOKEN,
            reverse: mode === "sell-in",
            creatorFeeConfigurable: true,
            creatorFeeBps: 71n,
            holderRewards: true,
          });
          const request = {
            ...f.request,
            amount:
              mode === "buy-out"
                ? { kind: "exactOut", amountOut: 123456789n }
                : f.request.amount,
          };
          assert.equal((await getSwapRequirements(request)).complete, true);
          const build = await buildSwapInstructions(request);
          assert.equal(build.execution.mayPartiallyFill, false);
          for (const fee of build.quote.fees) assert.equal(fee.mint, f.quoteMint);
          const tx = compileTransaction({
            instructions: build.instructions,
            feePayer: request.payer,
            lifetime: {
              blockhash: "11111111111111111111111111111111",
              lastValidBlockHeight: 1n,
            },
          });
          assert.deepEqual(tx.requiredSigners, [request.owner]);
        }
  } finally {
    globalThis.fetch = fetch;
  }
});
test("offline PumpSwap discovers unknown buyback ATAs and creates observed-absent ATAs with caller payer", async () => {
  const f = await pumpAmmQuotesFixture(deterministicAddress("ata-owner"), {
    quote: "exotic",
    quoteTokenProgram: TOKEN_2022,
  });
  const payer = deterministicAddress("ata-payer");
  const request = { ...f.request, payer };
  delete request.snapshot.accounts[f.buybackAta];
  const incomplete = await getSwapRequirements(request);
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.some((r) => r.address === f.buybackAta));
  request.snapshot.accounts[f.buybackAta] = null;
  request.snapshot.accounts[f.userBase] = null;
  const build = await buildSwapInstructions(request);
  assert.equal(build.setupInstructions.length, 2);
  assert.equal(build.swapInstructions.length, 1);
  assert.deepEqual(new Set(build.requiredSigners), new Set([payer, request.owner]));
  assert.equal(build.setupInstructions[1].accounts[1].address, f.buybackAta);
  assert.equal(build.setupInstructions[1].accounts[3].address, f.quoteMint);
  assert.equal(build.setupInstructions[1].accounts[5].address, TOKEN_2022);
});
test("offline PumpSwap rejects invalid fee schedules, holder destinations and unsafe token features", async () => {
  for (const mutation of [
    "stable-missing",
    "tiers",
    "holder",
    "creator-rate",
    "quote-extension",
    "quote-owner",
  ]) {
    const f = await pumpAmmQuotesFixture(deterministicAddress("invalid-owner"), {
      quote: mutation === "stable-missing" ? "usdc" : "exotic",
      holderRewards: true,
      creatorFeeConfigurable: true,
    });
    if (mutation === "stable-missing")
      f.request.snapshot.accounts[f.feeConfig].data = f.request.snapshot.accounts[
        f.feeConfig
      ].data.slice(0, 2512);
    if (mutation === "tiers")
      new DataView(f.request.snapshot.accounts[f.feeConfig].data.buffer).setUint32(
        109,
        0xffffffff,
        true,
      );
    if (mutation === "holder") f.request.snapshot.accounts[f.pool].data.fill(0, 211, 243);
    if (mutation === "creator-rate")
      new DataView(f.request.snapshot.accounts[f.pool].data.buffer).setBigUint64(
        261,
        10000n,
        true,
      );
    if (mutation === "quote-owner")
      f.request.snapshot.accounts[f.quoteVault].owner = TOKEN_2022;
    if (mutation === "quote-extension") {
      const mint = f.request.snapshot.accounts[f.quoteMint];
      mint.data = Uint8Array.from(
        getMintEncoder().encode({
          ...getMintDecoder().decode(mint.data),
          extensions: [{ __kind: "NonTransferable" }],
        }),
      );
      mint.owner = TOKEN_2022;
    }
    await assert.rejects(
      () => buildSwapInstructions(f.request),
      (error) => {
        assert.equal(
          error.code,
          mutation === "quote-extension"
            ? "UNSUPPORTED_TOKEN_EXTENSION"
            : "INVALID_ACCOUNT",
          mutation,
        );
        return true;
      },
    );
  }
  const f = await pumpAmmQuotesFixture(deterministicAddress("sell-out"), {
    quote: "exotic",
    reverse: true,
  });
  await assert.rejects(
    () =>
      buildSwapInstructions({
        ...f.request,
        amount: { kind: "exactOut", amountOut: 123n },
      }),
    (error) => {
      assert.ok(error instanceof UnsupportedSwapModeError);
      assert.equal(error.code, "UNSUPPORTED_SWAP_MODE");
      return true;
    },
  );
});
