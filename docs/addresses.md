# Offline protocol addresses and streamed state

The application chooses its account source: gRPC, WebSocket, RPC, a local cache, or another feed. The SDK derives protocol addresses, decodes the supplied account bytes, validates state, quotes swaps, and builds unsigned instructions. Address helpers and offline builders do not fetch accounts, start subscriptions, or own a cache.

## Build from your stream

```ts
import {
  buildSwapInstructions,
  getPumpBondingCurveAddress,
  type AccountSnapshot,
  type Address,
} from "celere-protocol-sdk";

// Supplied by the application's streaming/data layer.
declare const latestSnapshot: AccountSnapshot;
declare const owner: Address;
declare const inputMint: Address;
declare const outputMint: Address;

const pool = await getPumpBondingCurveAddress(outputMint);
const result = await buildSwapInstructions({
  pool,
  owner,
  payer: owner,
  inputMint,
  outputMint,
  amount: { kind: "exactIn", amountIn: 10_000_000n },
  slippageBps: 100,
  fillPolicy: "requireFull",
  snapshot: latestSnapshot,
});

// Pass these instructions to SenderClient with your signer, nonce and fees.
const instructions = result.instructions;
```

A snapshot contains raw account bytes, owners, lamports, executable flags, and observation slots, along with the relevant slot, epoch, and chain timestamp. Keep it immutable during construction. A missing account-map entry means unknown; `null` means your data layer observed absence. Merely deriving an address cannot establish absence or account existence.

`getSwapRequirements(request)` is optional offline dependency discovery for your subscription manager. It returns addresses and roles using the state supplied so far. Your application obtains missing observations and subscribes to updates. Discovery may take several rounds, and required bin/tick arrays can change with market state, swap direction, and amount. Once the snapshot contains the dependencies, call the builder directly. Missing data throws `MissingAccountsError` with an `accounts` field; it never triggers an RPC fallback.

`fetchSwapInstructions` remains a separate opt-in RPC convenience. Stream-driven execution should use `buildSwapInstructions` to avoid those network reads.

## Address helpers

All helpers are exported from the root package and the relevant protocol entrypoint. `get…Address` returns an `Address`; `find…Pda` returns Kit's `[address, bump]` when the bump is useful for native instruction arguments or state validation. Both derive locally. The adapters reuse the same implementations.

```ts
import {
  getMeteoraDlmmBinArrayAddress,
  getMeteoraDlmmBitmapExtensionAddress,
} from "celere-protocol-sdk/protocols/meteora-dlmm";
import { getRaydiumClmmTickArrayAddress } from "celere-protocol-sdk/protocols/raydium-clmm";
import { type Address } from "@solana/kit";

declare const dlmmPool: Address;
declare const clmmPool: Address;

// DLMM takes an array index, not an individual bin ID. Negative indices are valid.
const binArray = await getMeteoraDlmmBinArrayAddress(dlmmPool, -1n);
const bitmap = await getMeteoraDlmmBitmapExtensionAddress(dlmmPool);

// CLMM takes the array's start tick index, not its ordinal number.
const tickArray = await getRaydiumClmmTickArrayAddress(clmmPool, -60);
```

Numeric seeds are range-checked before encoding. Helpers preserve native token ordering rather than silently sorting the inputs, except where a helper explicitly documents protocol-required sorting. Pool configuration, creator, version, and index inputs are documented in the declaration files. A derived address alone does not qualify a pool version or guarantee executable support.

The public surface covers the derivations already used by the supported adapters:

| Protocol entrypoint            | Available address families                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/protocols/pump`              | Bonding curve and auxiliary v2 account, configuration, event authority, creator vault, volume accumulators, canonical pool authority, holder rewards |
| `/protocols/pump-amm`          | Pool and canonical pool, global/fee configuration, event authority, user volume accumulator                                                          |
| `/protocols/raydium-amm-v4`    | Global AMM authority                                                                                                                                 |
| `/protocols/raydium-cpmm`      | Vault/LP authority, AMM configuration, observation                                                                                                   |
| `/protocols/raydium-clmm`      | Configuration, standard pool, vaults, observation, tick arrays, bitmap extension                                                                     |
| `/protocols/raydium-launchlab` | Authority, configuration, pool, vaults, event authority, platform/creator fee vaults                                                                 |
| `/protocols/meteora-damm-v1`   | Underlying vault, token vault, LP mint, pool vault shares, protocol fees                                                                             |
| `/protocols/meteora-damm-v2`   | Token vaults, event authority; exported shared pool authority                                                                                        |
| `/protocols/meteora-dlmm`      | Legacy permissionless pool, reserves, oracle, bitmap extension, bin arrays, event authority                                                          |
| `/protocols/meteora-dbc`       | Pool, token vaults, event authority; exported shared pool authority                                                                                  |
| `/protocols/orca`              | Whirlpool, tick arrays, oracle                                                                                                                       |
| `/protocols/boop`              | Curve, configuration, curve token/SOL vaults, trading-fee vault, vault authority                                                                     |
| `/protocols/moonshot`          | Curve, configuration, curve token vault                                                                                                              |
| `/protocols/heaven`            | Supported pool/configuration, token vaults                                                                                                           |
| `/protocols/metadao`           | DAO, event authority, token vaults                                                                                                                   |
| `/protocols/vertigo`           | Pool and token vaults                                                                                                                                |
| `/protocols/liquid-af`         | Curve, configuration, SOL/buyback/fee vaults, user properties, volume accounts, cashback and CPI authorities                                         |
| `/protocols/liquid-af-amm`     | AMM pool, vaults, configuration, CPI authority and protocol-fee/buyback accounts                                                                     |
| `/protocols/rise-rich`         | Market, tenant, escrows, Mayflower market metadata/liquidity/revenue accounts, event authority                                                       |
| `/protocols/sugar`             | Historical curve, SOL vault, global state and event authority; no swap adapter or current execution guarantee                                        |

Not every required account has a derivation known to this SDK. Some pools and vaults are independently created accounts whose addresses are stored in pool state. The adapters read those addresses from your snapshot; a helper must not invent a mint-to-pool derivation for them. Standard associated token accounts remain available through `findAssociatedTokenPda` from the compatible `@solana-program/token` package; protocol-specific vault helpers use that primitive where appropriate.
