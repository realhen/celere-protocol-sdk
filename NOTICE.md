# Third-party notices

Celere-authored code is licensed under MIT. Components adapted or redistributed from other projects retain their own licenses.

## Raydium CPMM

The native account layout, instruction layout, and integer fee/swap arithmetic in `src/protocols/raydium/cpmm.ts` were adapted to a stateless TypeScript interface from [raydium-io/raydium-cp-swap](https://github.com/raydium-io/raydium-cp-swap/tree/b3187ae53a1b95a201f855a59024a12ca8f5b51a), revision `b3187ae53a1b95a201f855a59024a12ca8f5b51a`. This component remains subject to Apache-2.0; see `licenses/RAYDIUM-LICENSE`. Changes include caller-owned snapshots, structured errors, protocol-neutral requests, and portable instruction output.

## Pump

Pump account/instruction layouts and fee arithmetic were implemented using the official `@pump-fun/pump-sdk` version `4.0.0`, whose package metadata declares MIT, and [Pump's public protocol documentation](https://github.com/pump-fun/pump-public-docs). Copyright belongs to the original Pump authors for any adapted portions. Pump's package is not a runtime dependency. Celere adds offline validation, deterministic account selection, structured errors, and native amount-mode handling.

## Orca

The package embeds the official `@orca-so/whirlpools-core` version `1.0.3` WebAssembly math implementation at build time. This version was published under Apache-2.0, before the later license change; source revision `fa6429d1e413893b34dc38cbbd009984b6bc5f28`. See `licenses/ORCA-LICENSE`. The build wrapper embeds the upstream bytes so consumers need no runtime file access or network initialization. The initial adapter qualifies static-fee pools and rejects newer unsupported features explicitly.

## Solana

Solana Kit and its transitive packages retain their published licenses. Celere uses their address, instruction, and transaction primitives without exposing RPC, wallet, signing, or sending operations in its API.

No extracted Axiom JavaScript is included in this repository or package.
