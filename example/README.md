# Runnable buy-and-send projects

Copy either folder, install its dependencies, configure `.env`, and run it independently:

| Project                                | Buy flow                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Pump.fun](pumpfun/README.md)          | Derive a bonding curve from a mint, quote a native SOL buy, build, simulate, sign, and send.      |
| [Meteora DLMM](meteora-dlmm/README.md) | Fund WSOL if needed, discover pool/bin accounts, quote and build a buy, simulate, sign, and send. |

Each project owns its package manifest, TypeScript configuration, environment template, and application helpers. There are no sibling-folder imports. Both support RPC-only submission or concurrent Helius/0slot lanes with a caller-provided durable nonce. They report signatures and transport results; chain tracking belongs to the consuming application.

The SDK is not yet on npm, so the examples install a pinned sender revision from GitHub. Their READMEs explain installation and switching to a published release. No wallet keys, RPC credentials, or fixed live trade target are included.

Small examples for every native instruction remain in the public builders' TSDoc. The repository's packed-package workflow independently compiles/builds these copied projects; its Surfpool workflow exercises their actual command-line programs against native program execution.
