import { readFile } from "node:fs/promises";
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { fetchNonce } from "@solana-program/system";
import {
  SenderClient,
  HeliusSender,
  ZeroSlotSender,
  Region,
  fetchSwapInstructions,
} from "celere-protocol-sdk";

// Replace these example values with your own RPC, wallet file, token, and nonce.
const rpcUrl = "https://YOUR_RPC_ENDPOINT";
const walletFile = "/absolute/path/to/your/keypair.json";
const outputMint = address("YOUR_TOKEN_MINT");
const nonceAccount = address("YOUR_NONCE_ACCOUNT");
const pool = address("YOUR_DLMM_POOL_ADDRESS");
const rpc = createSolanaRpc(rpcUrl);
const wallet = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(await readFile(walletFile, "utf8"))),
);

// 1. Set up the sender. Every provider and the default RPC send concurrently.
const sender = new SenderClient({
  defaultRpc: { url: rpcUrl },
  routes: [
    new HeliusSender({ apiKey: "YOUR_HELIUS_API_KEY", region: Region.Frankfurt }),
    new ZeroSlotSender({ apiKey: "YOUR_ZERO_SLOT_API_KEY", region: Region.Frankfurt }),
  ],
});

// 2. Build the buy using fresh account data. The SDK quotes and applies slippage.
// DLMM spends WSOL from your wallet's ATA. Fund it with at least 0.01 WSOL first.
const buy = await fetchSwapInstructions(rpc, {
  pool,
  owner: wallet.address,
  payer: wallet.address,
  inputMint: address("So11111111111111111111111111111111111111112"),
  outputMint,
  amount: { kind: "exactIn", amountIn: 10_000_000n }, // 0.01 WSOL.
  slippageBps: 100, // 1%.
  fillPolicy: "requireFull",
});
if (buy.protocol !== "meteora-dlmm") throw new Error("Expected a Meteora DLMM pool");
console.log("Expected output (token atoms):", buy.quote.expectedAmountOut);

// 3. Give every variant the same nonce so only one buy can execute.
// Create this nonce beforehand, use this wallet as its authority, and reserve it
// for this buy. Do not use the same nonce for another concurrent trade.
const nonce = await fetchNonce(rpc, nonceAccount, { commitment: "confirmed" });
if (nonce.data.authority !== wallet.address)
  throw new Error("Wallet must authorize the nonce");
const submission = await sender.send({
  instructions: buy.instructions, // Includes output ATA creation when needed.
  feePayer: wallet.address,
  signers: [wallet],
  nonce: {
    account: nonceAccount,
    authority: wallet.address,
    value: nonce.data.blockhash,
  },
  fees: {
    computeUnitLimit: 300_000,
    computeUnitPriceMicroLamports: 50_000n,
    tipLamports: 1_000_000n, // 0.001 SOL per provider variant; RPC has no tip.
  },
});

for (const variant of submission.variants)
  console.log("Submitted signature:", variant.signature);
console.table(await submission.results); // HTTP results, not chain confirmation.
