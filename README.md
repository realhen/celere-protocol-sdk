# celere-protocol-sdk

Typed native Solana protocol instruction builders, offline transaction compilation, and an optional concurrent sender.

**Status: alpha.** Native instruction builders cover 20 protocol deployments. Optional swap adapters support 19 of them with the variant limits below. Sugar's deployed program currently fails on chain, but its historical instruction builders remain available. This package has not been published to npm.

Callers select the protocol and native instruction, supply accounts and arguments, and receive a portable unsigned instruction. Builders encode the native ABI without choosing routes, inspecting trading activity, fetching accounts, quoting amounts, or applying the optional swap API's fill policy. Callers own wallets and execution policy. The optional `/sender` entrypoint accepts caller-owned Kit signers and submits transactions.

For streaming applications, use `buildSwapInstructions` with caller-supplied account snapshots. The SDK handles offline address discovery, state validation, quotes, and swap limits while your application owns its gRPC/WebSocket/feed integration. See [offline addresses and streamed state](docs/addresses.md). `fetchSwapInstructions(rpc, request)` is an optional convenience for applications that want explicit RPC reads. Their supported variants and execution guarantees are separate from direct instruction construction.

Requires Node.js 22.16+ for development. The ESM package also bundles for secure browser contexts and workers. PDA derivation uses WebCrypto. Protocol builders and `/transactions` remain strictly offline. Root imports and client construction perform no I/O; `fetchSwapInstructions` performs explicitly requested account reads, and sender methods perform explicitly requested signing and submission. The root exports the sender API for convenience, and `/sender` remains available as a focused import.

```sh
npm ci --ignore-scripts
npm run build
npm pack
```

## Build a swap from RPC

```ts
import { fetchSwapInstructions, getPumpBondingCurveAddress } from "celere-protocol-sdk";

const buy = await fetchSwapInstructions(rpc, {
  pool: await getPumpBondingCurveAddress(outputMint),
  owner: wallet.address,
  payer: wallet.address,
  inputMint, // WSOL's mint identifies native SOL for a Pump SOL curve.
  outputMint,
  amount: { kind: "exactIn", amountIn: 10_000_000n },
  slippageBps: 100,
  fillPolicy: "requireFull",
});
// Pass buy.instructions to your sender with your signer, nonce and fees.
```

The same function handles a Meteora DLMM pool or another supported adapter; the pool's owner selects the protocol. It defaults to `confirmed` and accepts `{ commitment, abortSignal }` as its third argument. It fetches all discovered accounts together with Clock at one bank context per round, preserving observed absence for ATA creation. It supports up to 99 swap accounts plus Clock and 20 discovery rounds. Larger account sets need a caller-maintained coherent snapshot and the offline API.

Expected construction failures reject with the same named errors as the offline API, such as `MissingAccountsError` and `InvalidRequestError`. Their stable `code` and typed metadata are direct properties. `SwapAccountFetchError` identifies the convenience layer's own discovery limits and invalid RPC batches. RPC and cancellation errors propagate unchanged. There is no `unwrap` helper to copy. The function performs fresh RPC reads per call, without caching, signing, wrapping SOL, sending, or confirmation. Latency-sensitive applications with their own data feed can keep using `getSwapRequirements` and `buildSwapInstructions` to avoid these RPC round trips.

Protocol-owned PDA helpers are exported from the root and each protocol entrypoint. They cover the derivations used by every implemented adapter, with historical helpers for Sugar. See the [address helper inventory](docs/addresses.md#address-helpers) for coverage, native parameter meanings, and the streaming workflow. Standard token-account derivation continues to use `findAssociatedTokenPda` from `@solana-program/token`.

When reading the implementation, each protocol folder owns its native account layouts,
PDA seeds, fee and curve math, validation rules, and instructions. Common account-byte
readers live in [`src/protocols/accounts/bytes.ts`](src/protocols/accounts/bytes.ts);
protocol validation sites throw named errors with their native account context.
Token-account handling lives in `src/protocols/accounts`, and shared amount/slippage arithmetic
lives in `src/protocols/amounts.ts`. The byte readers are internal building blocks, not a
separate public entrypoint. They operate on caller-supplied data without fetching or
streaming accounts; each protocol validates its owner, applicable discriminator, and
supported layout before interpreting fields.

Protocol registries, swap/route orchestration, and their error classes also live under
`src/protocols`. Transaction compilation and its size errors belong to `src/transactions`;
route configuration and submission belong to `src/sender`. Only address validation,
u64 bounds, and request-validation errors are shared across these features in `src/shared`.
There is no `src/core` folder; `/core` is retained only as a compatibility import alias.

## Concurrent sender

Import from `celere-protocol-sdk/sender`. Configure once, supply protocol instructions, signer(s), nonce, and fees per transaction. Start with the [sender guide](docs/sender.md) for configuration, fees, signing, errors, and transport behavior. See the standalone [Pump.fun](example/pumpfun) and [Meteora DLMM](example/meteora-dlmm) projects for complete buy-and-send flows.

```ts
import {
  SenderClient,
  AstralaneSender,
  HeliusSender,
  Region,
} from "celere-protocol-sdk/sender";

const sender = new SenderClient({
  defaultRpc: { url: rpcUrl },
  routes: [
    new AstralaneSender({ apiKey: astralaneKey, region: Region.Frankfurt }),
    new AstralaneSender({ apiKey: astralaneKey, region: Region.NewYork }),
    new HeliusSender({ apiKey: heliusKey, region: Region.Frankfurt }),
  ],
});

const submission = await sender.send({
  instructions, // Any protocol's Kit-compatible instructions.
  feePayer: wallet.address,
  signers: [wallet], // Include a separate nonce authority or other required signers, if applicable.
  nonce: selectedNonce, // { account, authority, value }, already created and fetched by your app.
  fees: {
    computeUnitLimit: 200_000,
    computeUnitPriceMicroLamports: 50_000n,
    tipLamports: 1_000_000n,
  },
});

// The requests are already in flight; signatures are available without waiting for responses.
const signatures = submission.variants.map((variant) => variant.signature);
const transportResults = await submission.results; // Optional: HTTP results, never confirmation.
```

Provider classes implement the shared `SenderRoute` interface. Their options restrict regions to the locations that provider supports. Explicit route names are optional; the client assigns unique IDs for results.

The sender creates one untipped default RPC variant and provider-tipped variants. Regions with identical tip requirements reuse signed bytes and a signature. Every distinct variant uses the same nonce account and value, with the nonce advance instruction first. All required partial signers receive the variants in a batch; signatures are verified before dispatch. All HTTP requests launch concurrently, without waiting for the first acknowledgment. There are no trade-time fee, blockhash, nonce, or simulation reads.

`onRouteResult` is an optional callback passed to `send`: it receives each route's `RouteResult` as it settles. It does not track on-chain transactions, gate dispatch, or delay `results`; callback errors are isolated. Any application tracking code is your own, outside the SDK. `SubmissionStatus.Accepted` means the provider returned the expected signature; `Rejected` is an explicit transport rejection; `Unknown` covers timeouts, disconnects, malformed responses and mismatched signatures. Unknown submissions may still land. `NotSubmitted` means cancellation occurred before that route was attempted. Local preparation/signing failures throw `SenderError` before dispatch. A rejected route does not fail the other routes.

Every HTTP attempt has a bounded deadline (`timeoutMs`, default 3000, including reading the body). The client performs no retries. Provider-internal forwarding/retry behavior is independent of the client. Cancellation after dispatch does not cancel an on-chain transaction. There is no `start`/`close`, background polling, confirmation, recovery, persistent execution store, or required intent ID. An injected `fetch` can use a caller-managed connection pool; its lifecycle belongs to the caller. Reuse a client and transport for connection reuse; this package does not promise warmed connections or a measured landing-latency bound.

For external signing, call `sender.prepare(request)`, sign each `prepared.variants[i].transaction` without modifying its message, then call `sender.submitSigned(prepared, signedTransactions)`. Keep the original prepared object and use the same client. Kit partial signers return signatures only; modifying or signing-and-sending wallets require an application adapter. Wallets may prompt for multiple distinct messages. The sender never accepts private keys directly.

### Reading the sender implementation

Start with [SenderClient](src/sender/client.ts) for the public `prepare`, `send`, and `submitSigned` flow. Each public method documents its parameters, return timing, failures, and a typed example; these comments are included in the generated declarations.

| Module                                          | Responsibility                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [client](src/sender/client.ts)                  | Client configuration and class; validate requests, coordinate preparation/signing, launch every route, and collect observations. |
| [transaction](src/sender/transaction.ts)        | Preparation inputs, fees, plans, and signed payloads alongside compilation, signing, verification, and serialization.            |
| [transport](src/sender/transport.ts)            | HTTP request and transport contracts alongside deadlines, cancellation, and acknowledgment interpretation.                       |
| [submission](src/sender/submission.ts)          | Shared send requests, cancellation/callback options, submitted variants, and result statuses.                                    |
| [providers](src/sender/providers/index.ts)      | Each provider owns its class, options, regions, tiers, endpoints, recipients, fee floors, and request encoding.                  |
| [provider route](src/sender/providers/route.ts) | Shared provider identities, regions, route options, and the common provider contract.                                            |
| [errors](src/sender/errors/index.ts)            | Typed configuration, preparation, signing, and cancellation failures.                                                            |

Component-specific types live with their implementation. Shared route and submission contracts have their own modules. All supported public names remain available from `celere-protocol-sdk/sender`; consumers do not import internal source paths.

The HTTP boundary accepts a named `SenderHttpTransport`, compatible with Fetch API implementations. By default it calls the runtime's standard `fetch`; injection is available for application-managed pools and proxies. JavaScript private fields (`#routes`, `#transport`, and `#preparedSubmissions`) keep the client's configuration and original preparation buffers inaccessible through public properties. The preparation map uses weak keys so unused plans can be garbage-collected.

### Nonce ownership

The application provisions and funds nonce accounts, fetches their current values, and supplies `{ account, authority, value }` on each send. This SDK has no nonce discovery API or background nonce service. One nonce can arbitrate the variants of one logical trade; concurrent independent trades need different available nonce accounts.

The caller owns selection, freshness, and safe reuse. Slot duration does not establish availability: a submitted transaction can remain pending beyond a slot, and a failed durable-nonce transaction can consume its nonce. Confirmation, refreshes, and cross-process coordination belong to the application. A timeout does not free a nonce for a different trade. RPC-only sends may instead supply a recent blockhash lifetime.

### Validation and errors

Internal validators return discriminated success/error values. `prepare` and constructors retain synchronous errors; `send` and `submitSigned` retain promise rejections for failures before dispatch. Catch the common `SenderError` or a specific class such as `SenderConfigurationError`, `NonceRequiredError`, `TipTooLowError`, or `SenderSigningError`. Stable `SenderErrorCode` values remain available. All sender errors live in [errors](src/sender/errors/index.ts).

Built-in providers validate caller options once during construction. Client construction reuses their immutable configuration; it does not revalidate the provider catalog. Custom endpoint overrides and the default RPC are checked at configuration time. Per-send inputs still require validation before signing. Provider constructors and `SenderClient` perform no network work.

### Provider configuration

These adapters submit single transactions over HTTP. They do not implement bundles, gRPC or QUIC. `Region` values select documented regional endpoints; unsupported combinations fail rather than falling back to another region. `endpoint` overrides accept full submission URLs for proxies or private deployments. Some provider regional endpoints use HTTP; browser callers must choose HTTPS endpoints with suitable CORS support and avoid exposing server credentials. Existing Kit types, including commitment strings, are preserved; SDK-owned provider/region/status values are enums.

| Adapter            | Per-variant tip floor | Notes                                                                                                                                                      |
| ------------------ | --------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AstralaneSender`  |    1,000,000 lamports | Binary Iris (`/irisb`), Free tier. `AstralaneTier.Vip1`/`Vip2` allow 100,000; `Vip3` allows 10,000. Select only your provisioned tier.                     |
| `BlockRazorSender` |      100,000 lamports | Fast mode; sandwich mitigation is incompatible with nonce fan-out.                                                                                         |
| `ZeroSlotSender`   |    1,000,000 lamports | Advanced-plan callers can explicitly set `minimumTipLamports: 100_000n` in route options. This selects the provider plan floor, not the transaction's tip. |
| `NextBlockSender`  |      100,000 lamports | HTTP v2, skip preflight and disable retries requested.                                                                                                     |
| `HeliusSender`     |    1,000,000 lamports | Sender Max default; requires at least 5,000 lamports in priority fees. `HeliusSenderMode.SwqosOnly` selects the 5,000-lamport tip tier.                    |

Fees are explicit per send. `tipOverrides` uses `SenderProvider` keys and applies to all that provider's regional lanes. Below-floor amounts fail before signing; the SDK never silently raises your fees. Compute-unit limits cover the whole transaction, including setup, nonce and tip instructions. Set priority price from your application's fee estimate; simulate/estimate compute outside the latency-sensitive send call when needed. No automatic fee sampling or CU estimation is implied by these example values. Floors and endpoints follow the references below and may change with provider plans.

The provider catalogs were checked against official documentation on **2026-10-09**. It includes all public tip accounts listed in these sources, including their additional/recently added sections:

| Provider   | Tip accounts | Official recipient source                                                                                                                       | SDK endpoint regions                                                                            |
| ---------- | -----------: | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Astralane  |           17 | [Endpoints and configs](https://astralane.gitbook.io/docs/low-latency/endpoints-and-configs)                                                    | Global, Frankfurt, Amsterdam, New York, Tokyo, Singapore, Los Angeles                           |
| BlockRazor |           14 | [Official JavaScript example](https://docs.blockrazor.io/transaction-submission/transaction-sending/solana/send-transaction/request-example/js) | Frankfurt, New York, Tokyo, Amsterdam, London, Singapore, Los Angeles, Toronto                  |
| 0slot      |           21 | [Quickstart and additional tip accounts](https://0slot.trade/docs.php)                                                                          | Frankfurt, Amsterdam, New York, Tokyo, Los Angeles                                              |
| NextBlock  |            8 | [Quickstart](https://docs.nextblock.io/getting-started/quickstart)                                                                              | Frankfurt, Amsterdam, New York, London, Singapore, Tokyo, Salt Lake City, Dublin, Vilnius       |
| Helius     |           10 | [Sender Max](https://www.helius.dev/docs/sending-transactions/sender-max)                                                                       | Global, Frankfurt, Amsterdam, New York metro (Newark), London, Tokyo, Singapore, Salt Lake City |

Recipient selection is random per provider group, per preparation. Compatible regional lanes retain the same recipient and signed bytes. Including the complete lists spreads tip-account write locks across sends; it does not guarantee contention-free execution.

Fee policies follow [Astralane's tier table](https://astralane.gitbook.io/docs/low-latency/send-txn-fee-tiers), [BlockRazor's sending API](https://docs.blockrazor.io/transaction-submission/transaction-sending/solana/send-transaction), 0slot's plan table, [NextBlock's tip-floor example](https://docs.nextblock.io/api/examples/python/tip-floor-stream), and Helius Sender Max. Tier eligibility remains caller-owned; the SDK does not query accounts or automatically change fees.

Endpoint coverage is explicit:

- Astralane's official catalog publishes `/iris` URLs for additional London, Limburg, and Lithuania locations and secondary Frankfurt/Amsterdam servers. This adapter uses binary `/irisb`; only the binary locations corroborated by fnzero's current client are built in. Additional binary locations need provider verification before adding defaults. Do not pass a JSON `/iris` URL to the binary adapter.
- [BlockRazor's endpoint catalog](https://docs.blockrazor.io/transaction-submission/transaction-sending/solana/endpoint) also offers Frankfurt Allnodes/Cherry Servers and Amsterdam Cherry Servers. Select these using a full `endpoint` override, for example `http://frankfurt-allnodes.solana.blockrazor.xyz:443/sendTransaction`. The built-in defaults choose one endpoint per region; HTTPS is published for Frankfurt, New York, and Tokyo.
- NextBlock, 0slot, and Helius include every HTTP region in the linked catalogs. The SDK’s existing `Region.NewYork` option selects Helius’s Newark endpoint.

Both fnzero's [providers.ts](https://github.com/0xfnzero/sol-trade-sdk-nodejs/blob/56a4105360b5de50d19adf5b3dffbc1124634a86/src/swqos/providers.ts) and [clients.ts](https://github.com/0xfnzero/sol-trade-sdk-nodejs/blob/56a4105360b5de50d19adf5b3dffbc1124634a86/src/swqos/clients.ts) were reviewed. The latter provides the binary Iris request shape. Its 0slot list contains only five of the 21 officially documented accounts; its Astralane London/Dublin/Salt Lake City aliases route to other cities. Those aliases are intentionally not exposed as supported regions. Provider acknowledgments without the expected signature remain `Unknown`, even where a reference client treats a generic success response as accepted.

Tests cover real loopback HTTP contracts, all 70 recipients through signed submissions, and local Surfpool execution. They do not establish live provider acceptance or landing performance.

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

The [`example/` folder](example/README.md) contains two independently runnable projects: Pump.fun and Meteora DLMM. Each has one readable `main.ts` showing sender setup, swap construction, and submission, with inline configuration and fixed fees. The SDK handles account discovery and fetching through `fetchSwapInstructions`; there is no application-side discovery loop. Native instruction usage remains documented in each builder’s TSDoc. The packed-package consumer test compiles those snippets and independently builds both copied projects.

Instruction entrypoints expose functions named exactly after the native instructions and their readonly account/argument interfaces. Available subpaths are `/instructions/pump`, `/instructions/pump-amm`, `/instructions/raydium-amm-v4`, `/instructions/raydium-cpmm`, `/instructions/raydium-clmm`, `/instructions/raydium-launchlab`, `/instructions/meteora-damm-v1`, `/instructions/meteora-damm-v2`, `/instructions/meteora-dlmm`, `/instructions/moonshot`, `/instructions/vertigo`, `/instructions/orca`, `/instructions/boop`, `/instructions/meteora-dbc`, `/instructions/heaven`, `/instructions/rise-rich`, `/instructions/liquid-af`, `/instructions/liquid-af-amm`, `/instructions/metadao`, and historical `/instructions/sugar`. They do not import quote adapters or Orca's math WASM.

These synchronous functions encode the documented native instruction variant. Callers supply valid account addresses, verify PDAs and program state, and choose atomic amounts and execution bounds. The builders do not quote, discover accounts, create token accounts, or provide the high-level full-fill guarantee. Codec range errors throw synchronously; use the protocol-neutral API for named validation errors. Fixed flags and unsupported optional instruction features are documented in each builder. Account roles describe required signatures but never attach a signer or private key.

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

try {
  const requirements = await getSwapRequirements(request);
  if (!requirements.complete) {
    // Your data layer fulfills these requirements, then repeats discovery.
    requestAccounts(requirements.missing);
  } else {
    const built = await buildSwapInstructions(request);
    const compiled = compileTransaction({
      instructions: built.instructions,
      feePayer: address(feePayerAddress),
      lifetime: { blockhash, lastValidBlockHeight },
      computeBudget: { units: 300_000, microLamports: 1_000n },
    });
    // Your application signs compiled.transaction.
  }
} catch (error) {
  handleError(error);
}
```

`owner` authorizes token/native SOL spending. `payer` pays for shared token-account setup and missing protocol dependency ATAs. `feePayer` belongs to transaction compilation and may differ from both. Protocol-created accounts can impose their own payer rules; Pump, PumpSwap, and LaunchLab can charge the owner for program account creation.

To request a native exact-output swap, use:

```ts
amount: { kind: "exactOut", amountOut: 250_000n }
```

The SDK quotes the required input and encodes an upward-rounded maximum input. It never replaces exact output with inverse-sized exact-input execution. Unsupported directions or variants throw named errors.

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

For a smaller bundle, use `createRouteSdk([pumpRouteAdapter])` from `/protocols` with `pumpRouteAdapter` from `/protocols/pump-routes`.

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

Public inputs and successful return values use addresses, bigint amounts, byte arrays, and plain data. They survive structured cloning; there are no object-identity tokens or SDK clients to reconstruct in a worker. The SDK does not create workers. Error instances need explicit application serialization before crossing a worker boundary: structured cloning an `Error` does not preserve its custom `code` or metadata fields. Send a plain object containing the fields your application needs and handle it as data on the receiving side.

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

`getSwapRequirements`, `buildSwapInstructions`, `getRouteRequirements`, and `buildRouteInstructions` resolve directly to their success values and reject with named `Error` subclasses on failure. `compileTransaction` returns a compiled transaction directly and throws synchronously on failure.

```ts
import {
  buildSwapInstructions,
  MissingAccountsError,
  InvalidRequestError,
} from "celere-protocol-sdk";

try {
  const built = await buildSwapInstructions(request);
  useInstructions(built.instructions);
} catch (error) {
  if (error instanceof MissingAccountsError) {
    requestAccounts(error.accounts);
  } else if (error instanceof InvalidRequestError) {
    reportInvalidField(error.field, error.message);
  } else {
    throw error;
  }
}
```

`ProtocolError` is the base for protocol failures such as `MissingAccountsError`, `InvalidAccountError`, `InvalidSnapshotContextError`, `UnsupportedProtocolError`, `UnsupportedPoolFeatureError`, `UnsupportedSwapModeError`, `UnsupportedTokenExtensionError`, `UnsupportedFillPolicyError`, and `InsufficientLiquidityError`. `InvalidRequestError` covers request validation; `TransactionTooLargeError` carries the actual `size` and packet `limit`.

Stable uppercase codes are available through `ProtocolErrorCode`, `ValidationErrorCode`, and `TransactionErrorCode`. Metadata such as `accounts`, `address`, `field`, `protocol`, and `feature` lives directly on the appropriate error. Root, `/protocols`, and `/transactions` exports share constructor identity where applicable, so `instanceof` works across entrypoints. Unexpected implementation errors, RPC errors, and cancellation errors propagate unchanged; they are not converted into a generic internal-error result.

Migration from the former `Result<T>` API: remove `.ok` branches and `.value` access, await the returned value directly, and catch named errors. Replace `SwapBuildError` and `.detail` access with the specific error class and its direct properties. `getSwapRequirements` still returns an incomplete discovery value when observations are missing; construction throws `MissingAccountsError` until they are supplied. `/core` remains an import compatibility alias for `/protocols`.

The small `address()` and `basisPoints()` validation constructors also throw for invalid values. Creating a registry with duplicate protocol identities/programs throws `InvalidRequestError`.

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

Raydium AMM v4 rejects orderbook-active pool modes and Token-2022. CLMM rejects dynamic fees, fixed-token/output fees, permissioned pools, active limit-order fields, and Token-2022; its bitmap-extension account must be supplied. DLMM supports permissionless type-0 pools with input fees and up to eight bin arrays per swap; it rejects other pool address schemes, output fees, limit-order features, and Token-2022. Discovery reports missing arrays in stages. Exceeding the supported DLMM array count throws `UnsupportedPoolFeatureError`. CLMM and DLMM use native exact-output instructions and reject incomplete fills on chain.

DAMM v1 rejects stable curves, partner fees, Token-2022, and vaults with strategies. It preserves native minimum-one-atom fees and independent vault share rounding; output is based on caller-supplied unlocked balances. Moonshot/Moonit rejects linear, flat, anti-snipe and non-SOL curves; the token side must use the owner's ATA. Vertigo rejects active fee normalization, privileged swappers, and Token-2022. DAMM v1 and Vertigo expose native exact-input swaps only; exact-output requests throw `UnsupportedSwapModeError` with code `UNSUPPORTED_SWAP_MODE`.

Meteora DBC’s optional adapter qualifies up to 20 liquidity segments and static/linear fees with quote/output collection; it rejects dynamic, rate-limiter and exponential fees, privileged first swaps, Token-2022, and the native overflow fallback. Boop qualifies modern selector-31 curves and rejects legacy selector-30 math. Its buy instruction may clip at graduation; sells consume the full input or fail.

Heaven qualifies standard classic-token pools with constant quote-denominated protocol/creator fees. Market-cap tiers, slot fees, automatic staking, reflection, conditional creator fees and Token-2022 are rejected. Its oracle remains a native instruction dependency, but constant-fee offline quotes do not need oracle prices. Rise Rich qualifies only prewrapped WSOL swaps staying in its constant-price floor with unscaled units and disabled Dutch auctions. Buys require at least 700,000 lamports input; sells require at least 700,000 lamports net output. Sloped regions, floor raises, Token-2022 and restricted permissions are rejected. MetaDAO rejects active futarchy/conditional market state and zero-output inputs.

LiquidAF curve and AMM reject referrals and cashback spending; cashback earning is supported. AMM quotes must be USDC or WSOL, with classic or basic Token-2022 base tokens. Tiered fees require a caller-supplied verified SOL/USD oracle observation no more than 30 seconds old, including USDC pools. Native AMM fee splitting computes the LP share before waiving it for exact-input buys and exact-output sells; exact-input sells retain it. The public adapter rejects exact-output buys because the native program can succeed one base-token atom short. Raw builders expose this native limitation in their contracts.

Sugar's deployment at slot `450795393` contains an entrypoint that returns `Custom(1)` immediately. The Surfpool E2E verifies a correctly encoded instruction fails in two compute units with unchanged pool state. Historical `/instructions/sugar` builders preserve the published interface for inspection; they cannot make the currently disabled program execute. `PROTOCOL_COVERAGE` describes optional adapter status and deployed execution limitations; it does not gate raw instruction construction.

## Package build and imports

TypeScript source uses extensionless relative imports. The ESM build processes all modules together with shared chunks, so root and focused entrypoints use the same classes and error constructors. Solana dependencies remain external package imports. Source-level module outputs are retained alongside public entrypoints for declaration alignment and native validation; only the paths in `package.json` exports form the supported API.

The build embeds Orca's WASM before bundling, emits readable JavaScript and source maps, and generates per-module declarations with TSDoc and declaration maps. Declaration imports are resolved to explicit `.js` paths for native Node ESM consumers. The package includes source files for editor navigation. Installed-package checks validate declarations without `skipLibCheck` under both NodeNext and Bundler resolution, all public runtime entrypoints, and root/subpath class identity.

```ts
import { buildSwapInstructions, SenderClient, HeliusSender } from "celere-protocol-sdk";
```

## Smaller browser bundles

The default export includes all implemented adapters. Consumers can choose a fixed subset without importing the others:

```ts
import { createProtocolSdk } from "celere-protocol-sdk/protocols";
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

For local runs, install the [Surfpool CLI](https://solana.com/docs/tools/surfpool/toolchain/cli) release pinned in [CI](.github/workflows/ci.yml) and put it on `PATH`, then run:

```sh
npm run test:surfpool
```

GitHub Actions also runs the strict native gate on every push and pull request, on manual dispatch, and daily to detect mainnet program changes:

```bash
npm run test:surfpool:ci
```

This gate installs the checksum-pinned Surfpool release defined in [CI](.github/workflows/ci.yml), starts a fresh simulator backed by mainnet RPC, and hydrates every protocol program before running the complete native suite. Before submission, the evidence proxy hydrates static and lookup-table transaction accounts through individual account reads, preserving locally seeded state and marking confirmed-absent accounts offline to avoid Surfpool 1.6 batched remote-fetch timeouts. This does not create or fund absent accounts. It records program addresses, deployment slots, ELF SHA-256 hashes, and confirmed transaction signatures. It rejects attempts to replace those program binaries. For every exported native instruction, the gate requires a successful local confirmed receipt with a native program invocation. Accepted submissions without a confirmed receipt are listed separately in `unconfirmedTransactions` and receive no execution credit. This includes losing durable-nonce fan-out variants; acceptance alone is not confirmation. Test failures, skips, TODOs, receipt lookup errors, and missing confirmed instruction coverage fail the job.

Sugar is an explicit exception: its four historical instructions must produce the checked disabled-program rejection, and are reported as `disabled-program-rejection`, never as successful swaps. Tests also cover native limitations such as clipped output; a successful instruction does not imply an unconditional full-fill guarantee.

The workflow uploads `native-coverage.json`, `results.tap`, stderr and simulator diagnostics as the `native-execution-<commit>` artifact. The report marks a run passed only when the tests and instruction coverage both pass. Program fingerprints identify what was executed; each fresh run loads the current deployment, rather than pinning historical binaries. Mainnet RPC availability is required, and an unavailable program fails the job instead of skipping it. There is no automatic npm publication; this job is the native validation gate for future release workflows.

The runner starts an isolated simulator on available loopback ports, runs the full suite, and stops its own simulator afterward. Diagnostics remain in ignored `outputs/surfpool/` logs. Initial program hydration requires access to public mainnet RPC; offline builders remain free of network operations. To run one native workflow:

```sh
npm run test:surfpool -- tests/e2e/raydium-clmm.surfpool.test.mjs
```

You can also supply an existing disposable simulator. The runner leaves its lifecycle to you:

```sh
CELERE_SURFPOOL_URL=http://127.0.0.1:18999 npm run test:surfpool
```

Native tests create ephemeral test keys, fetch the deployed programs into Surfpool, and submit transactions only to a loopback simulator. Pump creates fresh markets through the real program and qualifies v3 synthetic migration on isolated state; PumpSwap qualifies native migrated and permissionless pools; additional quote assets, retained-fee sweeps, and multi-hop fee allocation use isolated synthetic state with native execution; Raydium AMM v4, CPMM, CLMM, LaunchLab, Meteora, Moonshot/Moonit, Vertigo, Boop, Heaven, Rise Rich, LiquidAF, and MetaDAO use isolated synthetic state; Orca remaps captured public liquidity to isolated addresses. Tests verify balance deltas, fee rounding, and encoded constraints through the real programs. Native workflows cover both directions and supported amount modes, fee rounding, vault share conversions and locked-profit release, crossed liquidity ranges, curve completion, adverse slippage, and depleted liquidity; failed swaps must leave user balances unchanged. They do not demonstrate mainnet delivery or qualify every pool/token variant. Tests mutate simulator state, so do not point them at a simulator whose state must be preserved.

Repository code stays formatted and readable. Adapters own state validation and quotes; individual native instruction files own ordered accounts and binary encoding; caller workflows do not belong in this package. CI checks formatting, lint, strict types, builds, and public consumer workflows.
