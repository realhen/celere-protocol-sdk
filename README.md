# celere-protocol-sdk

Strictly offline, typed Solana swap instruction and unsigned transaction builders.

**Status: alpha.** Six adapters are implemented: Pump bonding curves, PumpSwap, Raydium CPMM, Raydium LaunchLab, Meteora DAMM v2, and static-fee Orca Whirlpools. Qualified variants are exercised against real programs in local Surfpool. The remaining Axiom registry entries are a coverage target, not supported adapters. This package has not been published to npm.

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
- `fillPolicy` defaults to `requireFull`. Orca exact-input swaps and LaunchLab exact-input buys require explicit `allowPartial`, because their native instructions can partially consume input. Native Orca exact output uses a zero price limit and rejects incomplete output on chain. LaunchLab exact-output buys are rejected because the native instruction can succeed with less output at graduation.
- Token accounts default to the owner's ATAs. An observed-absent output ATA is created idempotently. Input accounts and custom token accounts must already exist. The SDK never closes an existing account or generates temporary keys.
- For PumpSwap, Raydium, Meteora, and Orca, WSOL uses an existing wrapped token account. This alpha does not automatically wrap or unwrap SOL. For Pump's native-only curve instructions, the WSOL mint identifies native wallet lamports; `build.assets` makes this distinction explicit.
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

| Adapter            | Exact input                         | Native exact output | Initial qualification                                                                                                   |
| ------------------ | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pump bonding curve | Buy and sell                        | Buy; sell rejected  | Standard SOL curves, classic token and Token-2022 metadata; fee-tier and rounding checks                                |
| PumpSwap           | Buy and sell                        | Buy; sell rejected  | Standard WSOL quotes, canonical tier fees and permissionless flat fees; signed virtual reserves and accrued fee buckets |
| Raydium CPMM       | Both directions                     | Both directions     | Classic-token pools, creator fees disabled/input/output, accrued-fee deductions, native slippage rejections             |
| Raydium LaunchLab  | Buy with `allowPartial`; sell       | Sell; buy rejected  | Constant-product curves, trading/platform/creator fees, graduation boundary behavior                                    |
| Meteora DAMM v2    | Both directions                     | Both directions     | Noncompounding pools, both fee collection directions, static/linear time fees, classic token and basic Token-2022       |
| Orca Whirlpool     | Both directions with `allowPartial` | Both directions     | Static fees and fixed tick arrays; adaptive fees/dynamic arrays rejected                                                |

Pump mayhem, cashback, configured creator fees, holder rewards, non-SOL quotes, completed-curve routing, and unsupported account versions are rejected explicitly. PumpSwap also rejects mayhem, cashback, configured creator fees, holder rewards, and non-WSOL quotes. Its listed buyback recipient ATA must already exist; exact-input buy limits must remain positive after slippage rounding. LaunchLab rejects nonconstant curves and migrated pools. Meteora rejects compounding, dynamic fees, rate limiters, market-cap fee schedulers, and nonstatic exponential fees. The Orca math is pinned to a historical Apache-2.0 release; newer features require a separately qualified implementation.

Planned adapters: Raydium V4/CLMM; Meteora AMM/DLMM; Boop; Moonshot; Virtual Curve; Vertigo; Heaven; Sugar; Stable Swap; LiquidAF/LiquidAF AMM; Rise Rich; MetaDAO. These correspond to the 21 labels captured in Axiom's registry, not a promise that every label has unrestricted current trading support. `PROTOCOL_COVERAGE` exposes this inventory programmatically.

## Smaller browser bundles

The default export includes all implemented adapters. Consumers can choose a fixed subset without importing the others:

```ts
import { createProtocolSdk } from "celere-protocol-sdk/core";
import { raydiumCpmmAdapter } from "celere-protocol-sdk/protocols/raydium-cpmm";

const sdk = createProtocolSdk([raydiumCpmmAdapter]);
```

Additional subpaths: `/protocols/pump`, `/protocols/pump-amm`, `/protocols/raydium-launchlab`, `/protocols/meteora-damm-v2`, `/protocols/orca`, and `/transactions`. Standard Solana addresses and common ATA/compute-budget primitives come from official `@solana-program/*` packages pinned to compatible Kit releases. These imports perform no RPC or wallet initialization. No code depends on the old `sol-trade-sdk` fork. Orca's official math WASM is embedded when this package is built; runtime initialization performs no fetch or file access. Third-party licenses remain in [NOTICE.md](NOTICE.md) and `licenses/`.

## Development and verification

```sh
npm run format
npm run check
```

The default suite exercises public consumer flows using captured local execution receipts, synthetic protocol state, and public pool data. It checks offline construction, staged account discovery, invalid inputs, native amount-mode encoding, worker structured cloning, browser bundling, transaction limits, and installing the actual packed package. Native-program tests are skipped unless a local Surfpool endpoint is supplied.

Run a separate disposable simulator, then the native suite:

```sh
surfpool start --port 18999 --ws-port 19000 --no-studio --no-tui --no-deploy \
  --rpc-url https://api.mainnet-beta.solana.com --block-production-mode transaction
CELERE_SURFPOOL_URL=http://127.0.0.1:18999 npm run test:surfpool
```

Native tests create ephemeral test keys, fetch the deployed programs into Surfpool, and submit transactions only to a loopback simulator. Pump creates fresh markets through the real program; PumpSwap qualifies native migrated and permissionless pools; CPMM, LaunchLab, and Meteora use isolated synthetic state; Orca remaps captured public liquidity to isolated addresses. Tests verify balance deltas and encoded constraints through the real programs. They do not demonstrate mainnet delivery or qualify every pool/token variant. Tests mutate simulator state, so do not point them at a simulator whose state must be preserved.

Repository code stays formatted and readable. Protocol logic belongs in adapters; caller workflows do not belong in this package. CI checks formatting, lint, strict types, builds, and public consumer workflows.
