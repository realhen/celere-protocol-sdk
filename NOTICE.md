# Third-party notices

Celere-authored code is licensed under MIT. Components adapted or redistributed from other projects retain their own licenses.

## Raydium CPMM

The native account layout, instruction layout, and integer fee/swap arithmetic in `src/protocols/raydium/cpmm.ts` were adapted to a stateless TypeScript interface from [raydium-io/raydium-cp-swap](https://github.com/raydium-io/raydium-cp-swap/tree/b3187ae53a1b95a201f855a59024a12ca8f5b51a), revision `b3187ae53a1b95a201f855a59024a12ca8f5b51a`. This component remains subject to Apache-2.0; see `licenses/RAYDIUM-LICENSE`. Changes include caller-owned snapshots, structured errors, protocol-neutral requests, and portable instruction output.

## Raydium AMM v4 and CLMM

The raw layouts and integer arithmetic in `src/protocols/raydium/amm-v4.ts` were adapted from [raydium-io/raydium-amm](https://github.com/raydium-io/raydium-amm/tree/d26944bfb76fb5fa8f91e5d440c2050ed358ef81), revision `d26944bfb76fb5fa8f91e5d440c2050ed358ef81`. `src/protocols/raydium/clmm.ts` and `clmm-math.ts` were adapted from the official Rust program in [raydium-io/raydium-clmm](https://github.com/raydium-io/raydium-clmm/tree/ed1eb41519d5355755f7df52b43fa9610938b60b), revision `ed1eb41519d5355755f7df52b43fa9610938b60b`. Both components remain subject to Apache-2.0; see `licenses/RAYDIUM-LICENSE`. Changes include stateless TypeScript bigint calculations, caller-supplied account observations, staged liquidity discovery, structured validation, and portable instruction output. No GPL-licensed Raydium SDK implementation or dependency is included. Source revisions identify implementation references, not the provenance of the deployed binaries used by Surfpool tests.

## Raydium LaunchLab

The LaunchLab adapter is independently authored from the public native program interface documented in [raydium-io/raydium-idl](https://github.com/raydium-io/raydium-idl) and qualified through local execution of the deployed program. No LaunchLab SDK implementation or full IDL is redistributed, and the GPL-licensed Raydium SDK is not a dependency.

## Meteora DAMM v2

The native layout and integer formulas in `src/protocols/meteora/damm-v2.ts` are adapted from [MeteoraAg/damm-v2-sdk](https://github.com/MeteoraAg/damm-v2-sdk/tree/79ebbfe59a225e641a2f37cd03404f26de1b0c8e), revision `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`, under MIT. See `licenses/METEORA-LICENSE`. Changes include bigint arithmetic, stateless raw-account decoding, portable instructions, structured errors, and explicit rejection of unqualified fee models. The SDK is not a runtime dependency; no code from the separately licensed on-chain program is redistributed.

## Meteora DLMM

The account layouts, bin traversal, integer prices, and fee formulas in `src/protocols/meteora/dlmm.ts` are adapted from [MeteoraAg/dlmm-sdk](https://github.com/MeteoraAg/dlmm-sdk/tree/576919e3e4368e542c402f000b4264724f7f23ec), revision `576919e3e4368e542c402f000b4264724f7f23ec`, corresponding to `@meteora-ag/dlmm` version `1.9.14`. Its package metadata declares ISC and names McSam as author. No standalone license file was provided in the reviewed source or package; `licenses/METEORA-DLMM-LICENSE` records that attribution and the standard ISC terms. Changes include native bigint arithmetic, strict raw-account validation, caller-supplied time and snapshots, staged bitmap/bin discovery, and explicit rejection of unqualified pool variants. The upstream SDK is not a runtime dependency, and no separately licensed on-chain Rust implementation is redistributed.

## Pump

Pump account/instruction layouts and fee arithmetic were implemented using the official `@pump-fun/pump-sdk` version `4.0.0`, whose package metadata declares MIT, and [Pump's public protocol documentation](https://github.com/pump-fun/pump-public-docs). Copyright belongs to the original Pump authors for any adapted portions. PumpSwap uses the native v2 layouts and fee arithmetic documented by the MIT `@pump-fun/pump-swap-sdk` version `2.1.0`. Neither Pump package is a runtime dependency. Celere adds offline validation, deterministic account selection, structured errors, and native amount-mode handling.

## Orca

The package embeds the official `@orca-so/whirlpools-core` version `1.0.3` WebAssembly math implementation at build time. This version was published under Apache-2.0, before the later license change; source revision `fa6429d1e413893b34dc38cbbd009984b6bc5f28`. See `licenses/ORCA-LICENSE`. The build wrapper embeds the upstream bytes so consumers need no runtime file access or network initialization. The initial adapter qualifies static-fee pools and rejects newer unsupported features explicitly.

## Solana

Solana Kit, the official `@solana-program/system`, `token`, `token-2022`, `memo`, and `compute-budget` clients, and their transitive packages retain their published licenses. Celere uses their address, instruction, and transaction primitives without exposing RPC, wallet, signing, or sending operations in its API.

No extracted Axiom JavaScript is included in this repository or package.
