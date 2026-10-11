# Buy-and-send examples

Two small, independently runnable projects, each with one `main.ts`:

- [Pump.fun](pumpfun): derive a bonding curve, build a SOL buy, and send it.
- [Meteora DLMM](meteora-dlmm): build a buy using an existing WSOL balance and send it.

Run `npm ci` at the SDK repository root, then `npm ci` in either example folder. Replace the placeholders in `main.ts`, then run `npm start`. Sender routes and fees are written directly in the script. Each uses a caller-provided nonce to send to Helius, 0slot, and the default RPC concurrently. The SDK handles account discovery and fetching through `fetchSwapInstructions`.

Both folders include their own package manifest, lockfile, and TypeScript configuration. They use `file:../..` to resolve the local SDK; if you copy a folder elsewhere, update that path to your SDK checkout and run `npm install`. Native instruction examples remain in the builders’ TSDoc. Repository checks build the copied projects and exercise their buys against native programs in Surfpool.
