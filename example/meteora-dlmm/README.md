# Meteora DLMM: build a buy and send it

Everything is in [main.ts](main.ts). Read the sender setup, swap build, and send call from top to bottom. `fetchSwapInstructions` handles account discovery, fetching, quoting, and instruction construction.

1. From the SDK repository root, run `npm ci` to install and build the SDK (Node.js 22.16+ required). Then run `npm ci` inside this example folder.
2. Edit the RPC URL, wallet-file path, token/pool addresses, nonce address, and API-key placeholders directly in `main.ts`.
3. Run `npm start` to sign and submit the buy.

The example buys with **0.01 WSOL**, allows **1% slippage**, and uses fixed fees: **300,000 CUs**, **50,000 micro-lamports/CU**, and a **0.001 SOL provider tip**. These are illustrative values you can edit, not automatic estimates. Keep your actual keys out of commits.

Use a supported classic SPL DLMM pool pairing WSOL with your token. Fund your wallet’s canonical WSOL ATA with at least 0.01 WSOL beforehand. This script spends that existing balance; it does not wrap or unwrap SOL. Token-2022 and limit-order pools are unsupported.

Have an existing nonce account authorized by your wallet. Helius, 0slot, and the default RPC receive variants using that same nonce; only one can execute. Reserve it for this buy, and check the printed signatures before retrying. HTTP results are not confirmation. The wallet also needs SOL for fees and account rent.

The SDK dependency is `file:../..`, pointing to this repository root. No npm release is needed. After editing SDK source, run `npm run build` at the repository root to refresh its JavaScript and declarations. If you copy this example elsewhere, change the dependency path to your SDK checkout and run `npm install`.
