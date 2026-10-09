# Development contracts

- Name public protocol identities, subpaths, and modules after the native protocol. Do not introduce trading-terminal aliases or activity-based availability policies. Direct instruction builders must remain independent of optional quote and execution-policy helpers.
- Keep this package strictly offline. Runtime source must not fetch, subscribe, sign, send, manage wallets, or own market caches.
- Protocol decoding, account discovery, quoting, fee handling, and native instruction construction belong in protocol adapters.
- Use atomic bigint amounts and explicit chain context. Exact output requires native on-chain exact-output execution; never substitute inverse exact-input sizing.
- Keep the high-level swap API protocol-neutral, strongly typed, and compatible with browser workers. Expose raw native instruction builders through dedicated instruction subpaths. Do not expose third-party SDK runtime objects.
- Import standard Solana program addresses and reusable instruction/PDA primitives from compatible official `@solana-program/*` packages instead of duplicating their constants. Keep instruction outputs portable; do not attach signer objects or callbacks.
- Return structured errors for expected failures. Reject unsupported protocol versions, token features, and execution guarantees explicitly.
- Keep each distinct native instruction in its own file. Match the filename and exported function to the full native instruction name, preserving version suffixes (for example, `buy_v3.ts` exports `buy_v3`). Use typed accounts and arguments, explicit ordered account roles, and a named binary layout documenting field byte ranges and endianness. Keep quoting and state validation in the adapter.
- Keep code readable and formatted; run format:check, lint, typecheck, build, and relevant end-to-end workflows before submission.
- Use TSDoc for public APIs and non-obvious units, trust boundaries, and guarantees. Prefer named pure functions; use classes only to own state or resources.
- Do not add unit tests. Verify public consumer workflows and real program execution through end-to-end tests.
- Do not create design documents or implementation-plan Markdown files. Keep README and capability documentation accurate.
- Never include private keys, user account snapshots, service credentials, or extracted Axiom bundles. Attribute any reused open-source code.
- Use capability status to distinguish implemented behavior from validated execution and planned support.

## Repository workflow

- The user authorizes the local `gh` CLI acting as `realhen` for this repository. Preserve the global Git identity.
- Commit and push verified changes directly to `main`; do not create pull requests for this repository. This repository-specific instruction supersedes the general agent-PR and manual-merge workflow.
