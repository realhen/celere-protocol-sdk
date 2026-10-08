import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions } from "../../dist/index.js";
import {
  SOL,
  TOKEN,
  TOKEN_2022,
  createCurveInstruction,
  curveAddress,
  observeRequest,
  rpc,
  submitInstructions,
  tokenAddress,
} from "../fixtures/pump-helpers.mjs";

const url = process.env.CELERE_SURFPOOL_URL;

for (const tokenProgram of [TOKEN, TOKEN_2022]) {
  test(
    `Pump ${tokenProgram === TOKEN ? "classic token" : "Token-2022 metadata"}: offline native modes execute`,
    { skip: !url, timeout: 120_000 },
    async () => {
      const user = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();
      await rpc(url, "surfnet_setAccount", [
        user.address,
        { lamports: 1_000_000_000_000 },
      ]);
      await submitInstructions(
        url,
        [await createCurveInstruction(user.address, mint.address, tokenProgram)],
        user,
        [user, mint],
      );
      const pool = await curveAddress(mint.address);
      const ata = await tokenAddress(user.address, mint.address, tokenProgram);
      const tokenBalance = async () =>
        BigInt((await rpc(url, "getTokenAccountBalance", [ata])).value.amount);
      const solBalance = async () =>
        BigInt((await rpc(url, "getBalance", [user.address])).value);
      let previousTokens = 0n;
      for (const [isBuy, amount] of [
        [true, { kind: "exactIn", amountIn: 10_000_000n }],
        [true, { kind: "exactIn", amountIn: 3_376n }],
        [true, { kind: "exactOut", amountOut: 1_000_000n }],
        [false, { kind: "exactIn", amountIn: 1_000_000n }],
      ]) {
        const request = await observeRequest(url, {
          pool,
          owner: user.address,
          payer: user.address,
          inputMint: isBuy ? SOL : mint.address,
          outputMint: isBuy ? mint.address : SOL,
          amount,
          slippageBps: 50,
          fillPolicy: "requireFull",
        });
        const result = await buildSwapInstructions(request);
        assert.equal(
          result.ok,
          true,
          JSON.stringify(result, (_, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        );
        const build = result.value;
        assert.equal(build.execution.mayPartiallyFill, false);
        const previousSol = await solBalance();
        const signature = await submitInstructions(url, build.instructions, user);
        const nextTokens = await tokenBalance();
        const nextSol = await solBalance();
        const transaction = await rpc(url, "getTransaction", [
          signature,
          { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        ]);
        if (isBuy) {
          assert.equal(nextTokens - previousTokens, build.quote.expectedAmountOut);
          if (amount.kind === "exactOut") {
            assert.equal(
              previousSol - nextSol - BigInt(transaction.meta.fee),
              build.quote.expectedAmountIn,
            );
            assert.ok(build.quote.expectedAmountIn <= build.quote.maximumAmountIn);
          }
        } else {
          assert.equal(previousTokens - nextTokens, build.quote.expectedAmountIn);
          assert.equal(
            nextSol - previousSol + BigInt(transaction.meta.fee),
            build.quote.expectedAmountOut,
          );
        }
        if (previousTokens > 0n) {
          const swap = build.swapInstructions[0];
          const balanceDelta = (account) => {
            const index = transaction.transaction.message.accountKeys.indexOf(account);
            assert.ok(index >= 0);
            return (
              BigInt(transaction.meta.postBalances[index]) -
              BigInt(transaction.meta.preBalances[index])
            );
          };
          const creatorDelta = balanceDelta(swap.accounts[isBuy ? 9 : 8].address);
          const protocolDelta =
            balanceDelta(swap.accounts[1].address) +
            balanceDelta(swap.accounts.at(-1).address);
          assert.equal(
            creatorDelta,
            build.quote.fees.find((fee) => fee.kind === "creator").amount,
          );
          assert.equal(
            protocolDelta,
            build.quote.fees.find((fee) => fee.kind === "trade").amount,
          );
        }
        previousTokens = nextTokens;
      }
      const unsupported = await observeRequest(url, {
        pool,
        owner: user.address,
        payer: user.address,
        inputMint: mint.address,
        outputMint: SOL,
        amount: { kind: "exactOut", amountOut: 1n },
        slippageBps: 50,
      });
      const rejected = await buildSwapInstructions(unsupported);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error.code, "UNSUPPORTED_SWAP_MODE");
    },
  );
}
