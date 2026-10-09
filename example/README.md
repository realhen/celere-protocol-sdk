# Native instruction examples

Each file imports a native builder and its types through the public package entrypoint. It exports `buildExample`, which takes account addresses resolved by your application and returns an unsigned Solana Kit instruction.

The amounts and quotes are **hypothetical**. Replace them with values for your market and its mint decimals before using the instruction. The 1% tolerance demonstrates caller-owned slippage arithmetic; the SDK does not choose that tolerance. Examples perform no account fetching, wallet management, signing, or sending.

| Protocol          | Example                                      | Native instruction       |
| ----------------- | -------------------------------------------- | ------------------------ |
| boop              | [boop.ts](boop.ts)                           | `buy_token`              |
| heaven            | [heaven.ts](heaven.ts)                       | `buy`                    |
| liquid-af-amm     | [liquid-af-amm.ts](liquid-af-amm.ts)         | `buy_exact_in`           |
| liquid-af         | [liquid-af.ts](liquid-af.ts)                 | `buy_exact_in_native`    |
| metadao           | [metadao.ts](metadao.ts)                     | `spot_swap`              |
| meteora-damm-v1   | [meteora-damm-v1.ts](meteora-damm-v1.ts)     | `swap`                   |
| meteora-damm-v2   | [meteora-damm-v2.ts](meteora-damm-v2.ts)     | `swap2`                  |
| meteora-dbc       | [meteora-dbc.ts](meteora-dbc.ts)             | `swap2`                  |
| meteora-dlmm      | [meteora-dlmm.ts](meteora-dlmm.ts)           | `swap2`                  |
| moonshot          | [moonshot.ts](moonshot.ts)                   | `buy`                    |
| orca              | [orca.ts](orca.ts)                           | `swap_v2`                |
| pump-amm          | [pump-amm.ts](pump-amm.ts)                   | `buy_exact_quote_in_v2`  |
| pump              | [pump.ts](pump.ts)                           | `buy_exact_quote_in_v3`  |
| raydium-amm-v4    | [raydium-amm-v4.ts](raydium-amm-v4.ts)       | `swap_base_in_v2`        |
| raydium-clmm      | [raydium-clmm.ts](raydium-clmm.ts)           | `swap`                   |
| raydium-cpmm      | [raydium-cpmm.ts](raydium-cpmm.ts)           | `swap_base_input`        |
| raydium-launchlab | [raydium-launchlab.ts](raydium-launchlab.ts) | `buy_exact_in`           |
| rise-rich         | [rise-rich.ts](rise-rich.ts)                 | `buy_with_exact_cash_in` |
| sugar             | [sugar.ts](sugar.ts)                         | `buy_exact_in`           |
| vertigo           | [vertigo.ts](vertigo.ts)                     | `buy`                    |

For other instructions, including exact-output variants, fee sweeps and routes, open the relevant builder’s TSDoc example. Every native instruction has its own example alongside its argument documentation.

## Using an example

For a CPMM market with wrapped SOL input and a six-decimal output token, start from [raydium-cpmm.ts](raydium-cpmm.ts). Supply the pool’s actual accounts, replace the illustrative input and quote, and include the returned instruction in a transaction:

```ts
import type { RaydiumCpmmSwapBaseInputAccounts } from "celere-protocol-sdk/instructions/raydium-cpmm";
import { buildExample } from "./raydium-cpmm.js";

declare const accounts: RaydiumCpmmSwapBaseInputAccounts;
const instruction = buildExample(accounts);
```

SOL examples distinguish native lamport transfers from wrapped SOL token-account debits. Wrapped SOL must be funded by the caller. Sugar’s example preserves a historical interface; the deployment checked by this repository rejects its instructions. Rise Rich’s example disables the optional floor raise.

Run `npm test` to build the package and run consumer checks, including strict typechecking of all these files and every instruction’s TSDoc snippet after installation from the package tarball. Typechecking verifies API compatibility, not on-chain execution. Real program execution coverage remains in the Surfpool end-to-end suite.
