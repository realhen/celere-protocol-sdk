# Third-party notices

Celere-authored code is licensed under MIT. Components adapted or redistributed from other projects retain their own licenses. The provenance below also covers the native instruction files extracted into each protocol's `instructions/` directory and its shared program constants.

## Raydium CPMM

The native account layout, instruction layout, and integer fee/swap arithmetic in `src/protocols/raydium/cpmm.ts` were adapted to a stateless TypeScript interface from [raydium-io/raydium-cp-swap](https://github.com/raydium-io/raydium-cp-swap/tree/b3187ae53a1b95a201f855a59024a12ca8f5b51a), revision `b3187ae53a1b95a201f855a59024a12ca8f5b51a`. This component remains subject to Apache-2.0; see `licenses/RAYDIUM-LICENSE`. Changes include caller-owned snapshots, structured errors, protocol-neutral requests, and portable instruction output.

## Raydium AMM v4 and CLMM

The raw layouts and integer arithmetic in `src/protocols/raydium/amm-v4.ts` were adapted from [raydium-io/raydium-amm](https://github.com/raydium-io/raydium-amm/tree/d26944bfb76fb5fa8f91e5d440c2050ed358ef81), revision `d26944bfb76fb5fa8f91e5d440c2050ed358ef81`. `src/protocols/raydium/clmm.ts` and `clmm-math.ts` were adapted from the official Rust program in [raydium-io/raydium-clmm](https://github.com/raydium-io/raydium-clmm/tree/ed1eb41519d5355755f7df52b43fa9610938b60b), revision `ed1eb41519d5355755f7df52b43fa9610938b60b`. Both components remain subject to Apache-2.0; see `licenses/RAYDIUM-LICENSE`. Changes include stateless TypeScript bigint calculations, caller-supplied account observations, staged liquidity discovery, structured validation, and portable instruction output. No GPL-licensed Raydium SDK implementation or dependency is included. Source revisions identify implementation references, not the provenance of the deployed binaries used by Surfpool tests.

## Raydium LaunchLab

The LaunchLab adapter is independently authored from the public native program interface documented in [raydium-io/raydium-idl](https://github.com/raydium-io/raydium-idl) and qualified through local execution of the deployed program. No LaunchLab SDK implementation or full IDL is redistributed, and the GPL-licensed Raydium SDK is not a dependency.

## Meteora DAMM v1

The layouts, vault share conversions, locked-profit accounting, and constant-product quote logic in `src/protocols/meteora/damm-v1.ts` are adapted from the MIT-declared TypeScript packages `@meteora-ag/dynamic-amm-sdk` version `1.4.1`, source [MeteoraAg/damm-v1-sdk](https://github.com/MeteoraAg/damm-v1-sdk/tree/02c66a3c13ebabdf71eb29d87996aaa7a06a7c29), and `@meteora-ag/vault-sdk` version `2.3.1`, source [MeteoraAg/vault-sdk](https://github.com/MeteoraAg/vault-sdk/tree/c774c30f64b17fe1d2c3c9fe733a3cbc252803f9). Changes include native bigint calculations, staged account discovery, caller-owned chain context, and rejection of unqualified vault strategies. Neither reviewed source includes a standalone license file; `licenses/METEORA-DAMM-V1-LICENSE` records attribution and standard MIT terms. No unlicensed AMM Rust implementation or upstream runtime dependency is redistributed.

## Meteora DAMM v2

The native layout and integer formulas in `src/protocols/meteora/damm-v2.ts` are adapted from [MeteoraAg/damm-v2-sdk](https://github.com/MeteoraAg/damm-v2-sdk/tree/79ebbfe59a225e641a2f37cd03404f26de1b0c8e), revision `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`, under MIT. See `licenses/METEORA-LICENSE`. Changes include bigint arithmetic, stateless raw-account decoding, portable instructions, structured errors, and explicit rejection of unqualified fee models. The SDK is not a runtime dependency; no code from the separately licensed on-chain program is redistributed.

## Meteora DLMM

The account layouts, bin traversal, integer prices, and fee formulas in `src/protocols/meteora/dlmm.ts` are adapted from [MeteoraAg/dlmm-sdk](https://github.com/MeteoraAg/dlmm-sdk/tree/576919e3e4368e542c402f000b4264724f7f23ec), revision `576919e3e4368e542c402f000b4264724f7f23ec`, corresponding to `@meteora-ag/dlmm` version `1.9.14`. Its package metadata declares ISC and names McSam as author. No standalone license file was provided in the reviewed source or package; `licenses/METEORA-DLMM-LICENSE` records that attribution and the standard ISC terms. Changes include native bigint arithmetic, strict raw-account validation, caller-supplied time and snapshots, staged bitmap/bin discovery, and explicit rejection of unqualified pool variants. The upstream SDK is not a runtime dependency, and no separately licensed on-chain Rust implementation is redistributed.

## Pump

Pump account/instruction layouts and fee arithmetic were implemented using the official `@pump-fun/pump-sdk` version `4.0.0`, whose package metadata declares MIT, and [Pump's public protocol documentation](https://github.com/pump-fun/pump-public-docs). Copyright belongs to the original Pump authors for any adapted portions. PumpSwap uses the native v2 layouts and fee arithmetic documented by the MIT `@pump-fun/pump-swap-sdk` version `2.1.0`. Neither Pump package is a runtime dependency. Celere adds offline validation, deterministic account selection, structured errors, and native amount-mode handling.

## Moonshot / Moonit

The native interface in `src/protocols/moonshot/curve.ts` references the MIT-declared [gomoonit/moonit-sdk](https://github.com/gomoonit/moonit-sdk/tree/87debaf79ef1178bcf17b3351015ff677eef35a0), version `1.5.0`, which uses the deployed Moonshot program. Constant-product arithmetic is adapted from the ISC-declared `@heliofi/launchpad-common` version `1.7.27` (package gitHead `3045f545a7e60b72da56dad9dcf2f9e63acb3c20`). Changes include stateless bigint quoting, raw caller-supplied accounts, native SOL semantics, structured validation, and native amount-mode handling. Neither reviewed package includes a standalone license file; attribution and standard MIT/ISC terms are recorded in `licenses/MOONSHOT-LICENSE`. Neither package is a runtime dependency.

## Vertigo

The Vertigo account and instruction interfaces in `src/protocols/vertigo/amm.ts` reference the official `@vertigo-amm/vertigo-sdk` version `2.0.6`, whose package metadata declares MIT and names Vertigo Protocol as author. The upstream quote API uses simulation; Celere's offline integer quote arithmetic is independently implemented and validated through native execution. The reviewed tarball has SHA256 `ce36367640768a4edeea4f2b5befd2bc9aacec277dc39fd42955a8cbba86b09e` and contains no standalone license file. `licenses/VERTIGO-LICENSE` records the attribution and standard MIT terms. The upstream SDK is not a runtime dependency.

## Orca

The package embeds the official `@orca-so/whirlpools-core` version `1.0.3` WebAssembly math implementation at build time. This version was published under Apache-2.0, before the later license change; source revision `fa6429d1e413893b34dc38cbbd009984b6bc5f28`. See `licenses/ORCA-LICENSE`. The build wrapper embeds the upstream bytes so consumers need no runtime file access or network initialization. The initial adapter qualifies static-fee pools and rejects newer unsupported features explicitly.

## Solana

Solana Kit, the official `@solana-program/system`, `token`, `token-2022`, `memo`, and `compute-budget` clients, and their transitive packages retain their published licenses. Celere uses their address, instruction, and transaction primitives without exposing RPC, wallet, signing, or sending operations in its API.

No extracted Axiom JavaScript is included in this repository or package.
