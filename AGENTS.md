# Development contracts

- Keep this package strictly offline. Runtime source must not fetch, subscribe, sign, send, manage wallets, or own market caches.
- Protocol decoding, account discovery, quoting, fee handling, and native instruction construction belong in protocol adapters.
- Use atomic bigint amounts and explicit chain context. Exact output requires native on-chain exact-output execution; never substitute inverse exact-input sizing.
- Keep the public API protocol-neutral, strongly typed, and compatible with browser workers. Do not expose third-party SDK runtime objects.
- Return structured errors for expected failures. Reject unsupported protocol versions, token features, and execution guarantees explicitly.
- Keep code readable and formatted; run format:check, lint, typecheck, build, and relevant end-to-end workflows before submission.
- Use TSDoc for public APIs and non-obvious units, trust boundaries, and guarantees. Prefer named pure functions; use classes only to own state or resources.
- Do not add unit tests. Verify public consumer workflows and real program execution through end-to-end tests.
- Do not create design documents or implementation-plan Markdown files. Keep README and capability documentation accurate.
- Never include private keys, user account snapshots, service credentials, or extracted Axiom bundles. Attribute any reused open-source code.
- Use capability status to distinguish implemented behavior from validated execution and planned support.
