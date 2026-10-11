# Meteora DLMM: build a buy and send it

Everything is in [main.ts](main.ts). Read the sender setup, swap build, and send call from top to bottom; the account-fetching helper is at the bottom.

1. Copy this folder and run `npm ci` (Node.js 22.16+ and Git required).
2. Edit the RPC URL, wallet-file path, token/pool addresses, nonce address, and API-key placeholders directly in `main.ts`.
3. Run `npm start` to sign and submit the buy.

The example buys with **0.01 WSOL**, allows **1% slippage**, and uses fixed fees: **300,000 CUs**, **50,000 micro-lamports/CU**, and a **0.001 SOL provider tip**. These are illustrative values you can edit, not automatic estimates. Keep your actual keys out of commits.

Use a supported classic SPL DLMM pool pairing WSOL with your token. Fund your wallet’s canonical WSOL ATA with at least 0.01 WSOL beforehand. This script spends that existing balance; it does not wrap or unwrap SOL. Token-2022 and limit-order pools are unsupported.

Have an existing nonce account authorized by your wallet. Helius, 0slot, and the default RPC receive variants using that same nonce; only one can execute. Reserve it for this buy, and check the printed signatures before retrying. HTTP results are not confirmation. The wallet also needs SOL for fees and account rent.

The SDK is not on npm yet, so the manifest and lockfile pin GitHub revision `e98c809`. The folder has no dependencies on neighboring example files.
