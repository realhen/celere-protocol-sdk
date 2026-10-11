# Meteora DLMM buy and send

A complete TypeScript application that buys a token from a supported Meteora DLMM pool using WSOL or another funded quote token. Copy this entire folder anywhere; it has no imports or file dependencies on the surrounding repository.

## Run

Requires Node.js 22.16+, npm, Git, access to the SDK's GitHub repository, an RPC endpoint, and a funded Solana CLI keypair. The wallet needs input funds, transaction fees, output-account rent, and any configured provider tip.

```sh
npm install
cp .env.example .env
# Edit .env: set RPC_URL, KEYPAIR_PATH, TOKEN_MINT, and your trade parameters.
npm run simulate
npm start
```

`npm start` signs and submits the configured buy using real funds on the selected cluster. `npm run simulate` only reads RPC state and simulates; it never signs or submits. Set an absolute `KEYPAIR_PATH`; shell `~` expansion does not occur inside `.env`. Keep the keypair outside the copied project.

The SDK has not been published to npm yet, so `package.json` pins SDK GitHub revision `e98c809`. npm builds the SDK through its `prepare` hook before installation. Keep install scripts enabled. Once a release is published, replace this dependency with that release version. The included lockfile fixes the full dependency tree; use `npm ci` for subsequent installs.

## What the application does

1. Loads your keypair and selects the input, output, amount, and slippage tolerance.
2. Fetches the accounts requested by the SDK, including chain time from the Clock sysvar. Every discovery round refreshes the whole known set in one RPC bank context.
3. Uses `buildSwapInstructions` to quote and build the native buy, including output ATA creation when needed. The minimum received amount incorporates your slippage setting.
4. Reads recent priority fee samples and the transaction lifetime. It simulates complete sender variants with a high CU limit, then requests the largest measured usage plus 10% headroom. State can change after simulation; this is an estimate, not a landing guarantee.
5. Calls `SenderClient.send`, prints local signatures immediately after dispatch, and reports each route's HTTP result. HTTP acceptance does not confirm execution. The application consuming these signatures owns chain tracking and any decision to retry.

Set `POOL_ADDRESS` to the DLMM pool, `TOKEN_MINT` to the token you want to buy, and `INPUT_MINT` to the quote token you will spend. Amounts are atomic units of that input mint (for example, `10000000` is 0.01 WSOL, but 10 USDC).

For WSOL, `npm start` creates the wallet's canonical WSOL ATA if needed and tops up only the missing balance. That funding transaction is confirmed before account discovery. A failed buy leaves the wrapped SOL available in your wallet; the example never closes an existing account. `npm run simulate` makes no state changes and therefore needs WSOL already funded. For another input mint, fund its canonical ATA beforehand. The SDK creates a missing output ATA in the buy transaction.

This SDK adapter supports classic SPL permissionless pools with input-side fees and timestamp-based dynamic fees. Token-2022, limit orders, output-side fees, and other pool address schemes are rejected explicitly. Bin arrays and the optional bitmap are discovered from RPC in successive rounds. The example limits the snapshot to 99 accounts plus the Clock sysvar in one RPC call; very large trades may need a dedicated data layer and address lookup tables.

## RPC or provider fan-out

Leave provider keys and `NONCE_ACCOUNT` empty for one transaction sent to the default RPC using a recent blockhash. Set `HELIUS_API_KEY` and/or `ZERO_SLOT_API_KEY` to add concurrent provider lanes. `src/send.ts` shows exactly where to add another provider or region, using the SDK's typed provider classes and `Region` enum.

When providers are enabled, supply an **existing** nonce account authorized by the configured wallet. The example fetches its current value and gives every tipped provider variant and the untipped RPC variant that same nonce. It never creates/discovers nonces, selects randomly, or falls back to RPC-only. Do not run concurrent independent buys using the same nonce account. After a failed or uncertain response, track the printed signatures and refresh chain state before deciding whether to repeat a trade.

`TIP_LAMPORTS` is per provider variant; regional copies do not create additional on-chain tips. The example averages the RPC's recent per-slot minimum priority fee samples, or uses `CU_PRICE_MICROLAMPORTS` when specified. It raises that price when needed to meet a configured provider's total priority-fee floor and prints the final fees. The RPC-only variant has no provider tip. All fees are explicit application policy, not an SDK fee oracle.

## Read the code

- `src/main.ts`: wallet loading, trade intent, native buy construction, and submission.
- `src/rpc.ts`: account discovery and coherent snapshots.
- `src/send.ts`: optional routes, lifetime selection, fees, simulation, and fan-out.
- `src/wrapped-sol.ts`: caller-owned WSOL funding and prerequisite confirmation.

The RPC reads and simulation make this a readable one-shot application. A latency-sensitive service would keep its data and fee estimates current before a trade trigger and reuse its sender instance. No live provider delivery or inclusion latency is promised by this example.
