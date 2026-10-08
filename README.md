# celere-protocol-sdk

Strictly offline, typed Solana swap instruction and unsigned transaction builders.

**Status: alpha.** All 21 Axiom registry labels are accounted for in `PROTOCOL_COVERAGE`: 19 implemented adapters, one routing alias, and one disabled deployment. Support is qualified by native program variant and execution mode, as listed below. Stable Swap is a routing alias. Sugar's current deployed program unconditionally fails; its historical instruction builders are exposed, but no high-level swap adapter is registered. This package has not been published to npm.

Callers supply account observations and chain context. Celere discovers dependencies, validates protocol state, calculates native swap amounts, and builds instructions. Callers own market selection, data acquisition, wallets, signing, and sending. Runtime code contains no RPC client, subscriptions, retries, sender selection, or key storage.

## Use

Requires Node.js 22.16+ for development. The ESM package also bundles for secure browser contexts and workers. PDA derivation uses WebCrypto; async APIs do not imply network access.

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

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

`owner` authorizes token/native SOL spending. `payer` pays for common token-account setup. `feePayer` belongs to transaction compilation and may differ from both. Protocol-created accounts can impose their own payer rules; Pump, PumpSwap, and LaunchLab can charge the owner for program account creation.

To request a native exact-output swap, use:

```ts
amount: { kind: "exactOut", amountOut: 250_000n }
```

The SDK quotes the required input and encodes an upward-rounded maximum input. It never replaces exact output with inverse-sized exact-input execution. Unsupported directions or variants return structured errors.

## Native instruction builders

The protocol-neutral swap API performs discovery, account validation, quoting, and limit calculation. If your application already has the accounts and native amounts, use an instruction entrypoint directly:

```ts
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getRaydiumCpmmSwapBaseInputInstruction } from "celere-protocol-sdk/instructions/raydium-cpmm";
import { compileTransaction } from "celere-protocol-sdk/transactions";

const swap = getRaydiumCpmmSwapBaseInputInstruction(
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

Each distinct native instruction has its own file. For example, [CPMM swap base input](src/protocols/raydium/instructions/cpmm/swap-base-input.ts) shows the discriminator, named binary fields, byte offsets and endianness, followed by every account in native order with its signer/writable role. [Pump buy](src/protocols/pump/instructions/bonding-curve/buy.ts) also makes the trailing native flags explicit. The adapters call these same builders.

Instruction entrypoints expose `get…Instruction` functions and their readonly account/argument interfaces. Available subpaths are `/instructions/pump`, `/instructions/pump-amm`, `/instructions/raydium-amm-v4`, `/instructions/raydium-cpmm`, `/instructions/raydium-clmm`, `/instructions/raydium-launchlab`, `/instructions/meteora-damm-v1`, `/instructions/meteora-damm-v2`, `/instructions/meteora-dlmm`, `/instructions/moonshot`, `/instructions/vertigo`, `/instructions/orca`, `/instructions/boop`, `/instructions/virtual-curve`, `/instructions/heaven`, `/instructions/rise-rich`, `/instructions/liquid-af`, `/instructions/liquid-af-amm`, `/instructions/metadao`, `/instructions/stable-swap`, and historical `/instructions/sugar`. They do not import quote adapters or Orca's math WASM.

These synchronous functions encode the documented native instruction variant. Callers supply valid account addresses, verify PDAs and program state, and choose atomic amounts and execution bounds. The builders do not quote, discover accounts, create token accounts, or provide the high-level full-fill guarantee. Codec range errors throw synchronously; use the protocol-neutral API for structured validation results. Fixed flags and unsupported optional instruction features are documented in each builder. Account roles describe required signatures but never attach a signer or private key.

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
- `fillPolicy` defaults to `requireFull`. Orca exact-input swaps and LaunchLab, Boop, and LiquidAF curve exact-input buys require explicit `allowPartial`, because their native instructions can partially consume input. Native Orca exact output uses a zero price limit and rejects incomplete output on chain. LaunchLab and LiquidAF curve exact-output buys are rejected because the native instruction can succeed with less output at graduation. LiquidAF AMM exact-output buys are rejected because native rounding can underfill by one atomic unit.
- Token accounts default to the owner's ATAs. An observed-absent output ATA is created idempotently. Input accounts and custom token accounts must already exist. The SDK never closes an existing account or generates temporary keys.
- For PumpSwap, Raydium, Meteora, and Orca, WSOL uses an existing wrapped token account. This alpha does not automatically wrap or unwrap SOL. For Pump, Moonshot/Moonit, Boop, and LiquidAF's native SOL curve instructions, the WSOL mint identifies native wallet lamports; `build.assets` makes this distinction explicit.
- Token transfer fees, hooks, and other unqualified extensions are rejected. Basic Token-2022 metadata extensions are accepted; see the execution coverage below.
- Building does not prove wallet affordability, transaction landing, or execution success. Consumers may compose funding instructions before the returned swap plan.

The result includes ordered instructions, setup/swap/cleanup boundaries, quote/limit fields, fee components, signer addresses, state context, and execution semantics. No result is signed.

`compileTransaction` builds v0 messages using caller-supplied lifetime and lookup-table addresses, preserves every required signer slot, and checks the complete wire size. Lookup-table activity, extension-slot usability, blockhash validity, compute sufficiency, and live account state remain consumer responsibilities. Signatures are null until an external signer supplies them.

## Errors and types

`getSwapRequirements`, `buildSwapInstructions`, and `compileTransaction` return a discriminated `Result<T>`:

```ts
if (!result.ok && result.error.code === "MISSING_ACCOUNTS") {
  requestAccounts(result.error.accounts);
}
```

Stable codes include `INVALID_REQUEST`, `MISSING_ACCOUNTS`, `INVALID_ACCOUNT`, `INVALID_SNAPSHOT_CONTEXT`, `UNSUPPORTED_PROTOCOL`, `UNSUPPORTED_POOL_FEATURE`, `UNSUPPORTED_SWAP_MODE`, `UNSUPPORTED_TOKEN_EXTENSION`, `UNSUPPORTED_FILL_POLICY`, `INSUFFICIENT_LIQUIDITY`, and `TRANSACTION_TOO_LARGE`. `INTERNAL_ERROR` denotes an unexpected implementation failure, not normal unsupported state. Consumers never need to parse error messages.

The small `address()` and `basisPoints()` validation constructors throw for invalid values. Creating a registry with duplicate protocol identities/programs also throws. These configuration-time contracts are separate from operation results.

## Current protocol coverage

| Adapter             | Exact input                         | Native exact output      | Initial qualification                                                                                                   |
| ------------------- | ----------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Pump bonding curve  | Buy and sell                        | Buy; sell rejected       | Standard SOL curves, classic token and Token-2022 metadata; fee-tier and rounding checks                                |
| PumpSwap            | Buy and sell                        | Buy; sell rejected       | Standard WSOL quotes, canonical tier fees and permissionless flat fees; signed virtual reserves and accrued fee buckets |
| Raydium CPMM        | Both directions                     | Both directions          | Classic-token pools, creator fees disabled/input/output, accrued-fee deductions, native slippage rejections             |
| Raydium AMM v4      | Both directions                     | Both directions          | Classic-token vault-backed pools, pending-PnL deductions, swap-only and opened waiting-trade status                     |
| Raydium CLMM        | Both directions                     | Both directions          | Classic-token legacy pools, static input fees, tick crossings and both bitmap-extension directions                      |
| Meteora DLMM        | Both directions                     | Both directions          | Classic-token permissionless pools, input fees, static/dynamic fees, bin crossings and bitmap extensions                |
| Raydium LaunchLab   | Buy with `allowPartial`; sell       | Sell; buy rejected       | Constant-product curves, trading/platform/creator fees, graduation boundary behavior                                    |
| Meteora DAMM v2     | Both directions                     | Both directions          | Noncompounding pools, both fee collection directions, static/linear time fees, classic token and basic Token-2022       |
| Meteora DAMM v1     | Both directions                     | Rejected                 | Constant-product classic-token pools, fully backed idle vaults, non-unit shares and time-based profit release           |
| Moonshot / Moonit   | Buy and sell                        | Buy and sell             | Native SOL constant-product v1/v2 curves, recipient fee accounting, migration and allocation boundaries                 |
| Vertigo             | Buy and sell                        | Rejected                 | Classic-token pools after fee normalization, shifted reserves, protocol and creator fee rounding                        |
| Orca Whirlpool      | Both directions with `allowPartial` | Both directions          | Static fees and fixed tick arrays; adaptive fees/dynamic arrays rejected                                                |
| Virtual Curve / DBC | Both directions                     | Both directions          | Classic-token curves, static/linear fees, both fee collection modes, multiple liquidity segments                        |
| Boop                | Buy with `allowPartial`; sell       | Rejected                 | Modern selector-31 native SOL curves; graduation clipping and recipient fees                                            |
| Heaven              | Buy and sell                        | Rejected                 | Classic tokens and WSOL, standard pools, constant protocol/creator quote fees, config versions 1/2                      |
| Rise Rich           | Buy and sell                        | Rejected                 | Prewrapped WSOL collateral, swaps wholly within the constant-price floor, Dutch auction disabled                        |
| LiquidAF curve      | Buy with `allowPartial`; sell       | Sell; buy rejected       | Native SOL, Token-2022 base, recipient fees and cashback earning; no referrals or cashback spending                     |
| LiquidAF AMM        | Both directions                     | Sell; buy rejected       | USDC/WSOL quotes, classic or basic Token-2022 base, fee tiers, recipient fees and cashback earning                      |
| MetaDAO             | Both directions                     | Rejected                 | Standalone v0.6 spot state, classic tokens, native 50-bps upward-rounded input fee                                      |
| Stable Swap         | Canonical Raydium routes            | Canonical Raydium routes | Alias for qualified Raydium AMM v4/CLMM routes; optional Poseidon route unsupported                                     |
| Sugar               | Unavailable                         | Unavailable              | Current deployment immediately returns an error; historical raw builders only                                           |

Pump mayhem, cashback, configured creator fees, holder rewards, non-SOL quotes, completed-curve routing, and unsupported account versions are rejected explicitly. PumpSwap also rejects mayhem, cashback, configured creator fees, holder rewards, and non-WSOL quotes. Its listed buyback recipient ATA must already exist; exact-input buy limits must remain positive after slippage rounding. LaunchLab rejects nonconstant curves and migrated pools. Meteora DAMM v2 rejects compounding, dynamic fees, rate limiters, market-cap fee schedulers, and nonstatic exponential fees. The Orca math is pinned to a historical Apache-2.0 release; newer features require a separately qualified implementation.

Raydium AMM v4 rejects orderbook-active pool modes and Token-2022. CLMM rejects dynamic fees, fixed-token/output fees, permissioned pools, active limit-order fields, and Token-2022; its bitmap-extension account must be supplied. DLMM supports permissionless type-0 pools with input fees and up to eight bin arrays per swap; it rejects other pool address schemes, output fees, limit-order features, and Token-2022. Discovery reports missing arrays in stages. Exceeding the supported DLMM array count returns an unsupported-feature error. CLMM and DLMM use native exact-output instructions and reject incomplete fills on chain.

DAMM v1 rejects stable curves, partner fees, Token-2022, and vaults with strategies. It preserves native minimum-one-atom fees and independent vault share rounding; output is based on caller-supplied unlocked balances. Moonshot/Moonit rejects linear, flat, anti-snipe and non-SOL curves; the token side must use the owner's ATA. Vertigo rejects active fee normalization, privileged swappers, and Token-2022. DAMM v1 and Vertigo expose native exact-input swaps only; exact-output requests return `UNSUPPORTED_SWAP_MODE`.

Virtual Curve refers to Meteora DBC. Its adapter qualifies up to 20 liquidity segments and static/linear fees with quote/output collection; it rejects dynamic, rate-limiter and exponential fees, privileged first swaps, Token-2022, and the native overflow fallback. Boop qualifies modern selector-31 curves and rejects legacy selector-30 math. Its buy instruction may clip at graduation; sells consume the full input or fail.

Heaven qualifies standard classic-token pools with constant quote-denominated protocol/creator fees. Market-cap tiers, slot fees, automatic staking, reflection, conditional creator fees and Token-2022 are rejected. Its oracle remains a native instruction dependency, but constant-fee offline quotes do not need oracle prices. Rise Rich qualifies only prewrapped WSOL swaps staying in its constant-price floor with unscaled units and disabled Dutch auctions. Buys require at least 700,000 lamports input; sells require at least 700,000 lamports net output. Sloped regions, floor raises, Token-2022 and restricted permissions are rejected. MetaDAO rejects active futarchy/conditional market state and zero-output inputs.

LiquidAF curve and AMM reject referrals and cashback spending; cashback earning is supported. AMM quotes must be USDC or WSOL, with classic or basic Token-2022 base tokens. Tiered fees require a caller-supplied verified SOL/USD oracle observation no more than 30 seconds old, including USDC pools. Native AMM fee splitting computes the LP share before waiving it for exact-input buys and exact-output sells; exact-input sells retain it. The public adapter rejects exact-output buys because the native program can succeed one base-token atom short. Raw builders expose this native limitation in their contracts.

Stable Swap has no separate program ABI. `stableSwapAdapters` from `/protocols/stable-swap` selects the existing Raydium AMM v4 and CLMM adapters; discovery and builds return those canonical IDs. Register this subset once, without adding duplicate Raydium adapters. WSOL/USDC maps to AMM v4; WSOL/USD1 maps to CLMM. Exhausted CLMM order-phase counters are accepted when remaining order amounts and ratios are zero. Active orders and the optional Poseidon route are unsupported. Market selection remains caller-owned.

Sugar's deployment at slot `450795393` contains an entrypoint that returns `Custom(1)` immediately. The Surfpool E2E verifies a correctly encoded instruction fails in two compute units with unchanged pool state. Historical `/instructions/sugar` builders preserve the published interface for inspection; they cannot make the currently disabled program execute. `PROTOCOL_COVERAGE` distinguishes implemented adapters, routing aliases, and disabled deployments.

## Smaller browser bundles

The default export includes all implemented adapters. Consumers can choose a fixed subset without importing the others:

```ts
import { createProtocolSdk } from "celere-protocol-sdk/core";
import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";

const sdk = createProtocolSdk([raydiumCpmmAdapter]);
```

Additional subpaths: `/protocols/pump`, `/protocols/pump-amm`, `/protocols/raydium-amm-v4`, `/protocols/raydium-clmm`, `/protocols/raydium-launchlab`, `/protocols/meteora-damm-v1`, `/protocols/meteora-damm-v2`, `/protocols/meteora-dlmm`, `/protocols/moonshot`, `/protocols/vertigo`, `/protocols/orca`, `/protocols/boop`, `/protocols/virtual-curve`, `/protocols/heaven`, `/protocols/rise-rich`, `/protocols/liquid-af`, `/protocols/liquid-af-amm`, `/protocols/metadao`, `/protocols/stable-swap`, and `/transactions`. Standard Solana addresses and common ATA/compute-budget primitives come from official `@solana-program/*` packages pinned to compatible Kit releases. These imports perform no RPC or wallet initialization. No code depends on the old `sol-trade-sdk` fork. Orca's official math WASM is embedded when this package is built; runtime initialization performs no fetch or file access. Third-party licenses remain in [NOTICE.md](NOTICE.md) and `licenses/`.

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

The runner starts an isolated simulator on available loopback ports, runs the full suite, and stops its own simulator afterward. Diagnostics remain in ignored `outputs/surfpool/` logs. Initial program hydration requires access to public mainnet RPC; SDK runtime operations remain offline. To run one native workflow:

```sh
npm run test:surfpool -- tests/e2e/raydium-clmm.surfpool.test.mjs
```

You can also supply an existing disposable simulator. The runner leaves its lifecycle to you:

```sh
CELERE_SURFPOOL_URL=http://127.0.0.1:18999 npm run test:surfpool
```

Native tests create ephemeral test keys, fetch the deployed programs into Surfpool, and submit transactions only to a loopback simulator. Pump creates fresh markets through the real program; PumpSwap qualifies native migrated and permissionless pools; Raydium AMM v4, CPMM, CLMM, LaunchLab, Meteora, Moonshot/Moonit, Vertigo, Boop, Heaven, Rise Rich, LiquidAF, and MetaDAO use isolated synthetic state; Orca remaps captured public liquidity to isolated addresses. Tests verify balance deltas, fee rounding, and encoded constraints through the real programs. Native workflows cover both directions and supported amount modes, fee rounding, vault share conversions and locked-profit release, crossed liquidity ranges, curve completion, adverse slippage, and depleted liquidity; failed swaps must leave user balances unchanged. They do not demonstrate mainnet delivery or qualify every pool/token variant. Tests mutate simulator state, so do not point them at a simulator whose state must be preserved.

Repository code stays formatted and readable. Adapters own state validation and quotes; individual native instruction files own ordered accounts and binary encoding; caller workflows do not belong in this package. CI checks formatting, lint, strict types, builds, and public consumer workflows.
