import process from "node:process";
import { readFile } from "node:fs/promises";
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { buildSwapInstructions } from "celere-protocol-sdk";
import { fetchBuyRequest, unwrap } from "./rpc";
import { configureSender, sendBuy } from "./send";
import { ensureWrappedSol } from "./wrapped-sol";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

async function main() {
  const simulateOnly = process.argv.includes("--simulate");
  const rpcUrl = required("RPC_URL");
  const rpc = createSolanaRpc(rpcUrl);
  const sender = configureSender(rpcUrl);
  // Read a Solana CLI keypair from a caller-owned file; never embed or log its bytes.
  const bytes: unknown = JSON.parse(await readFile(required("KEYPAIR_PATH"), "utf8"));
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    !bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  ) {
    throw new Error("KEYPAIR_PATH must point to a Solana CLI 64-byte keypair JSON file");
  }
  const wallet = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  const outputMint = address(required("TOKEN_MINT"));
  const amountIn = BigInt(required("AMOUNT_IN_ATOMS"));
  const slippageBps = Number(process.env.SLIPPAGE_BPS ?? "100");
  if (amountIn <= 0n) throw new Error("AMOUNT_IN_ATOMS must be positive");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000)
    throw new Error("SLIPPAGE_BPS must be an integer from 0 to 10000");
  const pool = address(required("POOL_ADDRESS"));
  const inputMint = address(
    process.env.INPUT_MINT ?? "So11111111111111111111111111111111111111112",
  );
  // DLMM debits a token account. For WSOL, fund only the missing balance before
  // fetching the swap snapshot. Existing WSOL and its ATA remain caller-owned.
  await ensureWrappedSol(rpc, wallet, inputMint, amountIn, simulateOnly);
  const request = await fetchBuyRequest(rpc, {
    pool,
    owner: wallet.address,
    payer: wallet.address,
    inputMint,
    outputMint,
    amount: { kind: "exactIn", amountIn },
    slippageBps,
    fillPolicy: "requireFull",
  });
  const buy = unwrap(await buildSwapInstructions(request));
  if (buy.protocol !== "meteora-dlmm")
    throw new Error("The configured pool is not a Meteora DLMM pool");
  console.log("Buy", {
    wallet: wallet.address,
    pool,
    inputMint,
    outputMint,
    inputAtoms: String(buy.quote.expectedAmountIn),
    expectedOutputAtoms: String(buy.quote.expectedAmountOut),
    minimumOutputAtoms:
      buy.quote.kind === "exactIn" ? String(buy.quote.minimumAmountOut) : undefined,
  });
  // Includes the SDK's output ATA setup and native swap instructions in their required order.
  await sendBuy(rpc, sender, wallet, buy.instructions, simulateOnly);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Buy failed");
  process.exitCode = 1;
});
