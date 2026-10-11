import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type Address,
} from "@solana/kit";
import { fetchNonce } from "@solana-program/system";
import { getSysvarClockDecoder, SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";
import {
  SenderClient,
  HeliusSender,
  ZeroSlotSender,
  Region,
  buildSwapInstructions,
  getSwapRequirements,
  type AccountSnapshot,
  type SwapRequest,
  type Result,
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
const request = await fetchBuyRequest(rpc, {
  pool,
  owner: wallet.address,
  payer: wallet.address,
  inputMint: address("So11111111111111111111111111111111111111112"),
  outputMint,
  amount: { kind: "exactIn", amountIn: 10_000_000n }, // 0.01 WSOL.
  slippageBps: 100, // 1%.
  fillPolicy: "requireFull",
});
const buy = unwrap(await buildSwapInstructions(request));
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

// RPC plumbing: the SDK is offline, so this script fetches the accounts it asks for.
// Keep this helper below the example so the build-and-send flow reads top to bottom.
/** Convert an SDK failure into an application error without hiding its stable code. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * Discover dependencies in rounds, then supply one coherent RPC observation.
 * Every round refetches all known accounts together with the chain Clock sysvar.
 * Null records observed absence (for example, an output ATA the SDK will create).
 */
async function fetchBuyRequest(
  rpc: ReturnType<typeof createSolanaRpc>,
  intent: Omit<SwapRequest, "snapshot">,
): Promise<SwapRequest> {
  let snapshot: AccountSnapshot = {
    slot: 0n,
    epoch: 0n,
    unixTimestamp: 0n,
    accounts: {},
  };
  const addresses = new Set<Address>([SYSVAR_CLOCK_ADDRESS]);
  for (let round = 0; round < 20; round++) {
    const request = { ...intent, snapshot };
    const requirements = unwrap(await getSwapRequirements(request));
    if (requirements.complete) return request;
    for (const account of requirements.accounts) addresses.add(account.address);
    // One getMultipleAccounts call gives a single bank context. Larger buys that
    // need more bin arrays should use a dedicated data layer, rather than mix slots.
    if (addresses.size > 100)
      throw new Error("Buy needs more than 99 accounts; reduce its size.");
    const keys = [...addresses];
    const response = await rpc
      .getMultipleAccounts(keys, {
        encoding: "base64",
        commitment: "confirmed",
        minContextSlot: snapshot.slot,
      })
      .send();
    const accounts = Object.fromEntries(
      keys.map((key, index) => {
        const account = response.value[index];
        if (account === undefined)
          throw new Error("RPC returned an incomplete account batch");
        return [
          key,
          account === null
            ? null
            : {
                address: key,
                owner: account.owner,
                data: Buffer.from(account.data[0], "base64"),
                lamports: account.lamports,
                executable: account.executable,
                slot: response.context.slot,
              },
        ];
      }),
    );
    const clockAccount = accounts[SYSVAR_CLOCK_ADDRESS];
    if (!clockAccount) throw new Error("RPC did not return the Clock sysvar");
    const clock = getSysvarClockDecoder().decode(clockAccount.data);
    snapshot = {
      accounts,
      slot: response.context.slot,
      epoch: clock.epoch,
      unixTimestamp: clock.unixTimestamp,
    };
  }
  throw new Error(
    "Account discovery did not converge; retry with a fresh market snapshot.",
  );
}
