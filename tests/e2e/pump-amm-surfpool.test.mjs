import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { buildSwapInstructions, compileTransaction } from "../../dist/index.js";
import { TOKEN, TOKEN_2022, SOL, ata } from "../fixtures/pump-amm.mjs";
import {
  observeAmmRequest,
  provisionCanonicalPool,
  provisionPermissionlessPool,
  readAccount,
  rpc,
  submitInstructions,
} from "../fixtures/pump-amm-native.mjs";

const url = process.env.CELERE_SURFPOOL_URL;
for (const tokenProgram of [TOKEN, TOKEN_2022]) {
  test(
    `Pump AMM ${tokenProgram === TOKEN ? "classic" : "Token-2022 metadata"}: canonical and permissionless native swaps`,
    { skip: !url, timeout: 120_000 },
    async () => {
      const user = await generateKeyPairSigner(),
        mint = await generateKeyPairSigner();
      const canonical = await provisionCanonicalPool(url, user, mint, tokenProgram);
      const permissionless = await provisionPermissionlessPool(
        url,
        user,
        mint.address,
        tokenProgram,
      );
      const baseAccount = await ata(user.address, mint.address, tokenProgram),
        quoteAccount = await ata(user.address, SOL);
      const amount = async (account) =>
        BigInt((await rpc(url, "getTokenAccountBalance", [account])).value.amount);
      for (const pool of [canonical.pool, permissionless]) {
        for (const [isBuy, swapAmount] of [
          [true, { kind: "exactIn", amountIn: 10_000_000n }],
          [true, { kind: "exactIn", amountIn: 3376n }],
          [true, { kind: "exactOut", amountOut: 1_000_000n }],
          [false, { kind: "exactIn", amountIn: 1_000_000_000n }],
        ]) {
          const request = await observeAmmRequest(url, {
            pool,
            owner: user.address,
            payer: user.address,
            inputMint: isBuy ? SOL : mint.address,
            outputMint: isBuy ? mint.address : SOL,
            amount: swapAmount,
            slippageBps: 50,
            fillPolicy: "requireFull",
          });
          const built = await buildSwapInstructions(request);
          assert.ok(
            built.ok,
            JSON.stringify(built, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
          );
          const [baseBefore, quoteBefore] = await Promise.all([
            amount(baseAccount),
            amount(quoteAccount),
          ]);
          const signature = await submitInstructions(url, built.value.instructions, user);
          const [baseAfter, quoteAfter] = await Promise.all([
            amount(baseAccount),
            amount(quoteAccount),
          ]);
          assert.equal(
            isBuy ? baseAfter - baseBefore : quoteAfter - quoteBefore,
            built.value.quote.expectedAmountOut,
          );
          assert.equal(
            isBuy ? quoteBefore - quoteAfter : baseBefore - baseAfter,
            built.value.quote.expectedAmountIn,
          );
          const tx = await rpc(url, "getTransaction", [
            signature,
            { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
          ]);
          const events = tx.meta.logMessages
            .filter((line) => line.startsWith("Program data: "))
            .map((line) => Buffer.from(line.slice(14), "base64"));
          const discriminator = isBuy
            ? [103, 244, 82, 31, 44, 245, 119, 119]
            : [62, 47, 55, 10, 165, 3, 220, 42];
          const event = events.find((data) =>
            discriminator.every((byte, index) => data[index] === byte),
          );
          assert.ok(
            event,
            `Native trade event missing: ${JSON.stringify(tx.meta.logMessages)}`,
          );
          const lpFee = event.readBigUInt64LE(80),
            protocolFee = event.readBigUInt64LE(96),
            creatorFee = event.readBigUInt64LE(352);
          assert.equal(
            built.value.quote.fees.find((fee) => fee.kind === "trade").amount,
            lpFee + protocolFee,
          );
          assert.equal(
            built.value.quote.fees.find((fee) => fee.kind === "creator").amount,
            creatorFee,
          );
        }
        const buy = await observeAmmRequest(url, {
          pool,
          owner: user.address,
          payer: user.address,
          inputMint: SOL,
          outputMint: mint.address,
          amount: { kind: "exactOut", amountOut: 1_000_000n },
          slippageBps: 50,
        });
        const built = await buildSwapInstructions(buy);
        assert.ok(built.ok);
        const instruction = structuredClone(built.value.swapInstructions[0]);
        const vaultAddress = instruction.accounts[7].address;
        const remaining = await amount(vaultAddress);
        new DataView(instruction.data.buffer).setBigUint64(8, remaining + 1n, true);
        new DataView(instruction.data.buffer).setBigUint64(16, (1n << 64n) - 1n, true);
        const latest = await rpc(url, "getLatestBlockhash");
        const compiled = compileTransaction({
          instructions: [instruction],
          feePayer: user.address,
          lifetime: {
            blockhash: latest.value.blockhash,
            lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
          },
        });
        assert.ok(compiled.ok);
        const simulated = await rpc(url, "simulateTransaction", [
          Buffer.from(compiled.value.wireBytes).toString("base64"),
          { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true },
        ]);
        assert.notEqual(
          simulated.value.err,
          null,
          "Exact output at reserve exhaustion must fail rather than partially fill",
        );
        assert.equal(
          simulated.value.err?.InstructionError?.[1]?.Custom,
          6016,
          JSON.stringify(simulated.value),
        );
        const rejected = await buildSwapInstructions({
          ...buy,
          inputMint: mint.address,
          outputMint: SOL,
        });
        assert.equal(rejected.ok, false);
        assert.equal(rejected.error.code, "UNSUPPORTED_SWAP_MODE");
        const poolData = (await readAccount(url, pool)).data;
        assert.ok(
          new DataView(poolData.buffer).getBigUint64(271, true) > 0n,
          "Sequential swaps retain nonzero protocol fee buckets",
        );
      }
    },
  );
}
