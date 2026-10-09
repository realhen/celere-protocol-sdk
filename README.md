# celere-protocol-sdk

Strictly offline, typed native Solana protocol instruction and unsigned transaction builders.

**Status: alpha.** Native instruction builders cover 20 protocol deployments. Optional swap adapters support 19 of them with the variant limits below. Sugar's deployed program currently fails on chain, but its historical instruction builders remain available. This package has not been published to npm.

Callers select the protocol and native instruction, supply accounts and arguments, and receive a portable unsigned instruction. Builders encode the native ABI without choosing routes, inspecting trading activity, fetching accounts, quoting amounts, or applying the optional swap API's fill policy. Callers own wallet management, signing, sending, and execution policy.

Optional offline helpers provide account discovery, state validation, quotes, and swap limits from caller-supplied snapshots. Their supported variants and execution guarantees are separate from direct instruction construction.

Requires Node.js 22.16+ for development. The ESM package also bundles for secure browser contexts and workers. PDA derivation uses WebCrypto; async APIs do not imply network access.

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

## Native instruction builders

Use the protocol’s instruction entrypoint with its native accounts and arguments:

```ts
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { swap_base_input } from "celere-protocol-sdk/instructions/raydium-cpmm";
import { compileTransaction } from "celere-protocol-sdk/transactions";

const swap = swap_base_input(
  {
    owner,
    authority,
    ammConfig,
    pool,
    inputTokenAccount,
    outputTokenAccount,
    inputVault,
    outputVault,
    inputTokenProgram: TOKEN_PROGRAM_ADDRESS,
    outputTokenProgram: TOKEN_PROGRAM_ADDRESS,
    inputMint,
    outputMint,
    observationState,
  },
  {
    amountIn: 1_000_000n,
    minimumAmountOut: 950_000n,
  },
);

const compiled = compileTransaction({
  instructions: [swap],
  feePayer: owner,
  lifetime: { blockhash, lastValidBlockHeight },
});
```

Each distinct native instruction has its own file, named exactly like its exported function and native ABI entry: `buy_v3.ts` exports `buy_v3`, `sell_v3.ts` exports `sell_v3`, and `swap_base_input.ts` exports `swap_base_input`. Version suffixes are preserved. Pump's separate `buy.ts` and `sell.ts` builders encode the legacy instructions; they never stand in for v3. These native names replace the former `get…Instruction` exports. The high-level swap and route API names are unchanged.

Use protocol-specific imports to distinguish shared instruction names:

```ts
import * as pump from "celere-protocol-sdk/instructions/pump";
import * as pumpAmm from "celere-protocol-sdk/instructions/pump-amm";

const curveBuy = pump.buy_v3(curveAccounts, curveArgs);
const poolBuy = pumpAmm.buy_v2(poolAccounts, poolArgs);
```

For example, [CPMM swap base input](src/protocols/raydium/instructions/cpmm/swap_base_input.ts) shows the named instruction-data encoder followed by every account in native order with its signer/writable role. TSDoc explains argument units, amount bounds, concrete values, and native execution caveats, with a typed usage example for every function. [Pump buy](src/protocols/pump/instructions/bonding-curve/buy.ts) also makes the trailing native flags explicit. The adapters call these same builders.

The [`example/` folder](example/README.md) contains one standalone TypeScript example per protocol. These use caller-resolved accounts and clearly hypothetical quotes to show instruction construction; the caller selects the amounts and slippage tolerance. The packed-package consumer test typechecks all instruction documentation snippets and protocol examples against the public exports.

Instruction entrypoints expose functions named exactly after the native instructions and their readonly account/argument interfaces. Available subpaths are `/instructions/pump`, `/instructions/pump-amm`, `/instructions/raydium-amm-v4`, `/instructions/raydium-cpmm`, `/instructions/raydium-clmm`, `/instructions/raydium-launchlab`, `/instructions/meteora-damm-v1`, `/instructions/meteora-damm-v2`, `/instructions/meteora-dlmm`, `/instructions/moonshot`, `/instructions/vertigo`, `/instructions/orca`, `/instructions/boop`, `/instructions/meteora-dbc`, `/instructions/heaven`, `/instructions/rise-rich`, `/instructions/liquid-af`, `/instructions/liquid-af-amm`, `/instructions/metadao`, and historical `/instructions/sugar`. They do not import quote adapters or Orca's math WASM.

These synchronous functions encode the documented native instruction variant. Callers supply valid account addresses, verify PDAs and program state, and choose atomic amounts and execution bounds. The builders do not quote, discover accounts, create token accounts, or provide the high-level full-fill guarantee. Codec range errors throw synchronously; use the protocol-neutral API for structured validation results. Fixed flags and unsupported optional instruction features are documented in each builder. Account roles describe required signatures but never attach a signer or private key.

## Optional swap helpers

Install the generated tarball in a consumer project. The package exposes one API across supported protocols:

```ts
import {
  address,
  basisPoints,
  buildSwapInstructions,
  compileTransaction,
  getSwapRequirements,
  type AccountSnapshot,
  type SwapRequest,
} from "celere-protocol-sdk";

// All values below come from your application's state/data layer.
const request: SwapRequest = {
  pool: address(poolAddress),
  owner: address(walletAddress),
  payer: address(rentPayerAddress),
  inputMint: address(inputMintAddress),
  outputMint: address(outputMintAddress),
  amount: { kind: "exactIn", amountIn: 1_000_000n },
  slippageBps: basisPoints(50),
  snapshot,
};

const requirements = await getSwapRequirements(request);
if (!requirements.ok) {
  handleError(requirements.error);
} else if (!requirements.value.complete) {
  // Your data layer fulfills these requirements, then repeats discovery.
  requestAccounts(requirements.value.missing);
} else {
  const built = await buildSwapInstructions(request);
  if (!built.ok) {
    handleError(built.error);
  } else {
    const compiled = compileTransaction({
      instructions: built.value.instructions,
      feePayer: address(feePayerAddress),
      lifetime: { blockhash, lastValidBlockHeight },
      computeBudget: { units: 300_000, microLamports: 1_000n },
    });
    // Your application handles compiled.error or signs compiled.value.transaction.
  }
}
```

`owner` authorizes token/native SOL spending. `payer` pays for shared token-account setup and missing protocol dependency ATAs. `feePayer` belongs to transaction compilation and may differ from both. Protocol-created accounts can impose their own payer rules; Pump, PumpSwap, and LaunchLab can charge the owner for program account creation.

To request a native exact-output swap, use:

```ts
amount: { kind: "exactOut", amountOut: 250_000n }
```

The SDK quotes the required input and encodes an upward-rounded maximum input. It never replaces exact output with inverse-sized exact-input execution. Unsupported directions or variants return structured errors.

## Native multi-hop routes

`getRouteRequirements` and `buildRouteInstructions` accept a caller-selected ordered path. They perform staged offline discovery and return one atomic native router instruction, endpoint totals, per-hop quotes, fee amounts grouped by category and mint, and the same setup/signer/asset metadata as a swap. They do not search for routes.

```ts
import { buildRouteInstructions, type RouteRequest } from "celere-protocol-sdk";

const route: RouteRequest = {
  owner,
  payer,
  inputMint: currencyMint,
  outputMint: destinationMint,
  hops: [
    { pool: firstPool, inputMint: currencyMint, outputMint: intermediateMint },
    { pool: secondPool, inputMint: intermediateMint, outputMint: destinationMint },
  ],
  amount: { kind: "exactIn", amountIn: 1_000_000n },
  slippageBps: basisPoints(50),
  fillPolicy: "requireFull",
  snapshot,
};
const built = await buildRouteInstructions(route);
```

Pump's native route charges protocol fees at the currency end and creator/LP fees at the far end. Its quotes cannot be reproduced by summing ordinary single-pool quotes. Routes consume the full input or fail, including at synthetic-completion rounding boundaries. The high-level API supports two through four hops through Pump curves and canonical PumpSwap pools. Every hop follows the quote/base chain in the same direction and uses native exact input. Exact output, cycles, repeated pools, permissionless pools, and arbitrary mixed-direction paths are rejected. No intermediate user ATAs are needed. Five- and six-hop requests are rejected because tested longer mixed routes exhausted the deployed program allocator even with a larger heap request; the raw instruction builder remains available for independently qualified compositions.

A native SOL curve endpoint still requires a WSOL token account as the router's mint-bearing sentinel, even though settlement changes wallet lamports. That sentinel's wrapped balance is not spent; inspect `build.assets` for settlement semantics. Input endpoint accounts must exist; an observed-absent output ATA can be created. The SDK does not wrap SOL. Larger routes may require caller-supplied lookup tables to fit the transaction size limit.

For a smaller bundle, use `createRouteSdk([pumpRouteAdapter])` from `/core` with `pumpRouteAdapter` from `/protocols/pump-routes`.

## Account snapshots

```ts
const snapshot: AccountSnapshot = {
  slot: 100n,
  epoch: 1n,
  unixTimestamp: 1_700_000_000n,
  accounts: {
    [someAddress]: {
      address: address(someAddress),
      owner: address(programAddress),
      data: rawAccountBytes,
      lamports: 2_039_280n,
      executable: false,
      slot: 100n,
    },
    [observedAbsentAddress]: null,
  },
};
```

An omitted key is unknown. `null` means the consumer observed that the account does not exist. Optional requirements still need an observation; `null` is acceptable when the protocol allows absence. Discovery can take several rounds as the pool and mints reveal more addresses. It never fetches them.

Account slots may differ. They must not exceed `snapshot.slot`; `maxAccountAgeSlots` optionally bounds their age relative to it. Supplied epoch/time drive protocol calculations. These checks cannot prove that a snapshot is authentic, coherent across a fork, or still current on chain. Keep snapshots immutable while an async operation runs.

Public inputs/results use addresses, bigint amounts, byte arrays, and plain data. They survive structured cloning; there are no object-identity tokens or SDK clients to reconstruct in a worker. The SDK does not create workers.

## Amount and account semantics

- All quantities are atomic integer units, never floating-point token amounts.
- Quotes describe expected account debit/credit; transaction fees and rent are excluded. Native exact-input budgets can leave integer-rounding dust unspent.
- Slippage uses integral basis points from 0 through 9999. Exact-input minimum output rounds down; exact-output maximum input rounds up.
- `fillPolicy` defaults to `requireFull`. Pump v3 exact-input buys, Orca exact-input swaps, and LaunchLab, Boop, and LiquidAF curve exact-input buys require explicit `allowPartial`, because their native instructions can partially consume input. Native Orca exact output uses a zero price limit and rejects incomplete output on chain. LaunchLab and LiquidAF curve exact-output buys are rejected because the native instruction can succeed with less output at graduation. LiquidAF AMM exact-output buys are rejected because native rounding can underfill by one atomic unit.
- Token accounts default to the owner's ATAs. An observed-absent output ATA is created idempotently. Input accounts and custom token accounts must already exist. The SDK never closes an existing account or generates temporary keys.
- For PumpSwap, Raydium, Meteora, and Orca, WSOL uses an existing wrapped token account. This alpha does not automatically wrap or unwrap SOL. For Pump, Moonshot/Moonit, Boop, and LiquidAF's native SOL curve instructions, the WSOL mint identifies native wallet lamports; `build.assets` makes this distinction explicit.
- Token transfer fees, hooks, and other unqualified extensions are rejected. Basic Token-2022 metadata extensions are accepted; see the execution coverage below.
- Building does not prove wallet affordability, transaction landing, or execution success. Consumers may compose funding instructions before the returned swap plan.

The result includes ordered instructions, setup/swap/cleanup boundaries, quote/limit fields, fee components, signer addresses, state context, and execution semantics. No result is signed.

`compileTransaction` builds v0 messages using caller-supplied lifetime and lookup-table addresses, preserves every required signer slot, and checks the complete wire size. Lookup-table activity, extension-slot usability, blockhash validity, compute sufficiency, and live account state remain consumer responsibilities. Signatures are null until an external signer supplies them.

## Errors and types

`getSwapRequirements`, `buildSwapInstructions`, `getRouteRequirements`, `buildRouteInstructions`, and `compileTransaction` return a discriminated `Result<T>`:

```ts
if (!result.ok && result.error.code === "MISSING_ACCOUNTS") {
  requestAccounts(result.error.accounts);
}
```

Stable codes include `INVALID_REQUEST`, `MISSING_ACCOUNTS`, `INVALID_ACCOUNT`, `INVALID_SNAPSHOT_CONTEXT`, `UNSUPPORTED_PROTOCOL`, `UNSUPPORTED_POOL_FEATURE`, `UNSUPPORTED_SWAP_MODE`, `UNSUPPORTED_TOKEN_EXTENSION`, `UNSUPPORTED_FILL_POLICY`, `INSUFFICIENT_LIQUIDITY`, and `TRANSACTION_TOO_LARGE`. `INTERNAL_ERROR` denotes an unexpected implementation failure, not normal unsupported state. Consumers never need to parse error messages.

The small `address()` and `basisPoints()` validation constructors throw for invalid values. Creating a registry with duplicate protocol identities/programs also throws. These configuration-time contracts are separate from operation results.

## Optional swap adapter coverage

| Adapter            | Exact input                         | Native exact output | Initial qualification                                                                                             |
| ------------------ | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Pump bonding curve | Buy and sell                        | Buy; sell rejected  | SOL, USDC and token quotes; v3 trades, synthetic completion, configured creator fees and holder-reward vaults     |
| PumpSwap           | Buy and sell                        | Buy; sell rejected  | WSOL, USDC and token quotes; canonical/permissionless fees, creator overrides, signed reserves and retained fees  |
| Raydium CPMM       | Both directions                     | Both directions     | Classic-token pools, creator fees disabled/input/output, accrued-fee deductions, native slippage rejections       |
| Raydium AMM v4     | Both directions                     | Both directions     | Classic-token vault-backed pools, pending-PnL deductions, swap-only and opened waiting-trade status               |
| Raydium CLMM       | Both directions                     | Both directions     | Classic-token legacy pools, static input fees, tick crossings and both bitmap-extension directions                |
| Meteora DLMM       | Both directions                     | Both directions     | Classic-token permissionless pools, input fees, static/dynamic fees, bin crossings and bitmap extensions          |
| Raydium LaunchLab  | Buy with `allowPartial`; sell       | Sell; buy rejected  | Constant-product curves, trading/platform/creator fees, graduation boundary behavior                              |
| Meteora DAMM v2    | Both directions                     | Both directions     | Noncompounding pools, both fee collection directions, static/linear time fees, classic token and basic Token-2022 |
| Meteora DAMM v1    | Both directions                     | Rejected            | Constant-product classic-token pools, fully backed idle vaults, non-unit shares and time-based profit release     |
| Moonshot / Moonit  | Buy and sell                        | Buy and sell        | Native SOL constant-product v1/v2 curves, recipient fee accounting, migration and allocation boundaries           |
| Vertigo            | Buy and sell                        | Rejected            | Classic-token pools after fee normalization, shifted reserves, protocol and creator fee rounding                  |
| Orca Whirlpool     | Both directions with `allowPartial` | Both directions     | Static fees and fixed tick arrays; adaptive fees/dynamic arrays rejected                                          |
| Meteora DBC        | Both directions                     | Both directions     | Classic-token curves, static/linear fees, both fee collection modes, multiple liquidity segments                  |
| Boop               | Buy with `allowPartial`; sell       | Rejected            | Modern selector-31 native SOL curves; graduation clipping and recipient fees                                      |
| Heaven             | Buy and sell                        | Rejected            | Classic tokens and WSOL, standard pools, constant protocol/creator quote fees, config versions 1/2                |
| Rise Rich          | Buy and sell                        | Rejected            | Prewrapped WSOL collateral, swaps wholly within the constant-price floor, Dutch auction disabled                  |
| LiquidAF curve     | Buy with `allowPartial`; sell       | Sell; buy rejected  | Native SOL, Token-2022 base, recipient fees and cashback earning; no referrals or cashback spending               |
| LiquidAF AMM       | Both directions                     | Sell; buy rejected  | USDC/WSOL quotes, classic or basic Token-2022 base, fee tiers, recipient fees and cashback earning                |
| MetaDAO            | Both directions                     | Rejected            | Standalone v0.6 spot state, classic tokens, native 50-bps upward-rounded input fee                                |
| Sugar              | Unavailable                         | Unavailable         | Current deployment immediately returns an error; historical raw builders only                                     |

Pump and PumpSwap support classic tokens and basic Token-2022 base/quote accounts. Mayhem, cashback, unsupported account versions and transfer-affecting extensions remain rejected. SOL/stable/exotic fee schedules and configured creator overrides are read from caller state; holder rewards use the native creator-fee category and designated payout vault. An observed-absent buyback ATA is created idempotently using `payer`; an unknown account still requires an observation. PumpSwap exact-input buy limits must remain positive after slippage rounding.

Pump uses v3 for exact-output buys and exact-input sells. For exact-input SOL buys, `requireFull` preserves the legacy instruction; `allowPartial` selects v3. Token-quote exact-input buys require `allowPartial`. A v3 buy can finish the curve and continue into the prospective pool's reserves in the same instruction. It can refund a remainder too small to buy one pool token atom, so v3 exact-input buy builds always report `execution.mayPartiallyFill`. Synthetic migration supports the completing buy; a snapshot of an already-completed curve is rejected, and selecting its migrated pool remains caller-owned.

Raw `/instructions/pump` and `/instructions/pump-amm` entrypoints include permissionless creator/protocol fee sweeps. These pay accrued buckets to designated recipients and can create recipient ATAs; they do not claim fees for the payer. Sweep creator fees before composing creator claims or fee-sharing changes. Pool sweeps increase signed virtual quote reserves as real quote tokens leave, preserving effective reserves and swap prices. LaunchLab rejects nonconstant curves and migrated pools. Meteora DAMM v2 rejects compounding, dynamic fees, rate limiters, market-cap fee schedulers, and nonstatic exponential fees. The Orca math is pinned to a historical Apache-2.0 release; newer features require a separately qualified implementation.

Raydium AMM v4 rejects orderbook-active pool modes and Token-2022. CLMM rejects dynamic fees, fixed-token/output fees, permissioned pools, active limit-order fields, and Token-2022; its bitmap-extension account must be supplied. DLMM supports permissionless type-0 pools with input fees and up to eight bin arrays per swap; it rejects other pool address schemes, output fees, limit-order features, and Token-2022. Discovery reports missing arrays in stages. Exceeding the supported DLMM array count returns an unsupported-feature error. CLMM and DLMM use native exact-output instructions and reject incomplete fills on chain.

DAMM v1 rejects stable curves, partner fees, Token-2022, and vaults with strategies. It preserves native minimum-one-atom fees and independent vault share rounding; output is based on caller-supplied unlocked balances. Moonshot/Moonit rejects linear, flat, anti-snipe and non-SOL curves; the token side must use the owner's ATA. Vertigo rejects active fee normalization, privileged swappers, and Token-2022. DAMM v1 and Vertigo expose native exact-input swaps only; exact-output requests return `UNSUPPORTED_SWAP_MODE`.

Meteora DBC’s optional adapter qualifies up to 20 liquidity segments and static/linear fees with quote/output collection; it rejects dynamic, rate-limiter and exponential fees, privileged first swaps, Token-2022, and the native overflow fallback. Boop qualifies modern selector-31 curves and rejects legacy selector-30 math. Its buy instruction may clip at graduation; sells consume the full input or fail.

Heaven qualifies standard classic-token pools with constant quote-denominated protocol/creator fees. Market-cap tiers, slot fees, automatic staking, reflection, conditional creator fees and Token-2022 are rejected. Its oracle remains a native instruction dependency, but constant-fee offline quotes do not need oracle prices. Rise Rich qualifies only prewrapped WSOL swaps staying in its constant-price floor with unscaled units and disabled Dutch auctions. Buys require at least 700,000 lamports input; sells require at least 700,000 lamports net output. Sloped regions, floor raises, Token-2022 and restricted permissions are rejected. MetaDAO rejects active futarchy/conditional market state and zero-output inputs.

LiquidAF curve and AMM reject referrals and cashback spending; cashback earning is supported. AMM quotes must be USDC or WSOL, with classic or basic Token-2022 base tokens. Tiered fees require a caller-supplied verified SOL/USD oracle observation no more than 30 seconds old, including USDC pools. Native AMM fee splitting computes the LP share before waiving it for exact-input buys and exact-output sells; exact-input sells retain it. The public adapter rejects exact-output buys because the native program can succeed one base-token atom short. Raw builders expose this native limitation in their contracts.

Sugar's deployment at slot `450795393` contains an entrypoint that returns `Custom(1)` immediately. The Surfpool E2E verifies a correctly encoded instruction fails in two compute units with unchanged pool state. Historical `/instructions/sugar` builders preserve the published interface for inspection; they cannot make the currently disabled program execute. `PROTOCOL_COVERAGE` describes optional adapter status and deployed execution limitations; it does not gate raw instruction construction.

## Smaller browser bundles

The default export includes all implemented adapters. Consumers can choose a fixed subset without importing the others:

```ts
import { createProtocolSdk } from "celere-protocol-sdk/core";
import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";

const sdk = createProtocolSdk([raydiumCpmmAdapter]);
```

Additional subpaths: `/protocols/pump`, `/protocols/pump-amm`, `/protocols/pump-routes`, `/protocols/raydium-amm-v4`, `/protocols/raydium-clmm`, `/protocols/raydium-launchlab`, `/protocols/meteora-damm-v1`, `/protocols/meteora-damm-v2`, `/protocols/meteora-dlmm`, `/protocols/moonshot`, `/protocols/vertigo`, `/protocols/orca`, `/protocols/boop`, `/protocols/meteora-dbc`, `/protocols/heaven`, `/protocols/rise-rich`, `/protocols/liquid-af`, `/protocols/liquid-af-amm`, `/protocols/metadao`, and `/transactions`. Standard Solana addresses and common ATA/compute-budget primitives come from official `@solana-program/*` packages pinned to compatible Kit releases. These imports perform no RPC or wallet initialization. No code depends on the old `sol-trade-sdk` fork. Orca's official math WASM is embedded when this package is built; runtime initialization performs no fetch or file access. Third-party licenses remain in [NOTICE.md](NOTICE.md) and `licenses/`.

## Development and verification

```sh
npm run format
npm run check
```

The default suite exercises public consumer flows using captured local execution receipts, synthetic protocol state, and public pool data. It checks offline construction, staged account discovery, invalid inputs, native amount-mode encoding, worker structured cloning, browser bundling, transaction limits, and installing the actual packed package. The default `npm test` suite skips native-program tests unless a local Surfpool endpoint is supplied. Use the dedicated command below to run every test against real programs.

With the [Surfpool CLI](https://docs.surfpool.run/) installed and on `PATH`, run:

```sh
npm run test:surfpool
```

GitHub Actions also runs the strict native gate on every push and pull request, on manual dispatch, and daily to detect mainnet program changes:

```bash
npm run test:surfpool:ci
```

This gate installs the checksum-pinned Surfpool release defined in [CI](.github/workflows/ci.yml), starts a fresh simulator backed by mainnet RPC, and hydrates every protocol program before running the complete native suite. Before submission, the evidence proxy hydrates transaction accounts through individual account reads, preserving locally seeded state and avoiding Surfpool 1.6 batched remote-fetch timeouts. It records program addresses, deployment slots, ELF SHA-256 hashes, and confirmed transaction signatures. It rejects attempts to replace those program binaries. For every exported native instruction, the gate requires a successful local confirmed receipt with a native program invocation. Test failures, skips, TODOs, missing receipts, and missing instruction coverage fail the job.

Sugar is an explicit exception: its four historical instructions must produce the checked disabled-program rejection, and are reported as `disabled-program-rejection`, never as successful swaps. Tests also cover native limitations such as clipped output; a successful instruction does not imply an unconditional full-fill guarantee.

The workflow uploads `native-coverage.json`, `results.tap`, stderr and simulator diagnostics as the `native-execution-<commit>` artifact. The report marks a run passed only when the tests and instruction coverage both pass. Program fingerprints identify what was executed; each fresh run loads the current deployment, rather than pinning historical binaries. Mainnet RPC availability is required, and an unavailable program fails the job instead of skipping it. There is no automatic npm publication; this job is the native validation gate for future release workflows.

The runner starts an isolated simulator on available loopback ports, runs the full suite, and stops its own simulator afterward. Diagnostics remain in ignored `outputs/surfpool/` logs. Initial program hydration requires access to public mainnet RPC; SDK runtime operations remain offline. To run one native workflow:

```sh
npm run test:surfpool -- tests/e2e/raydium-clmm.surfpool.test.mjs
```

You can also supply an existing disposable simulator. The runner leaves its lifecycle to you:

```sh
CELERE_SURFPOOL_URL=http://127.0.0.1:18999 npm run test:surfpool
```

Native tests create ephemeral test keys, fetch the deployed programs into Surfpool, and submit transactions only to a loopback simulator. Pump creates fresh markets through the real program and qualifies v3 synthetic migration on isolated state; PumpSwap qualifies native migrated and permissionless pools; additional quote assets, retained-fee sweeps, and multi-hop fee allocation use isolated synthetic state with native execution; Raydium AMM v4, CPMM, CLMM, LaunchLab, Meteora, Moonshot/Moonit, Vertigo, Boop, Heaven, Rise Rich, LiquidAF, and MetaDAO use isolated synthetic state; Orca remaps captured public liquidity to isolated addresses. Tests verify balance deltas, fee rounding, and encoded constraints through the real programs. Native workflows cover both directions and supported amount modes, fee rounding, vault share conversions and locked-profit release, crossed liquidity ranges, curve completion, adverse slippage, and depleted liquidity; failed swaps must leave user balances unchanged. They do not demonstrate mainnet delivery or qualify every pool/token variant. Tests mutate simulator state, so do not point them at a simulator whose state must be preserved.

Repository code stays formatted and readable. Adapters own state validation and quotes; individual native instruction files own ordered accounts and binary encoding; caller workflows do not belong in this package. CI checks formatting, lint, strict types, builds, and public consumer workflows.
