# Development contracts

- Name public protocol identities, subpaths, and modules after the native protocol. Do not introduce trading-terminal aliases or activity-based availability policies. Direct instruction builders must remain independent of optional quote and execution-policy helpers.
- Keep protocol builders and transaction compilation strictly offline. Root imports and client construction perform no I/O. The sender is available through both the root and `/sender` entrypoints and may perform explicit caller-requested signing/submission. Applications supply nonce snapshots; nonce discovery is outside this SDK. They must not own wallets, background subscriptions, confirmation, recovery, or persistent storage.
- Protocol decoding, account discovery, quoting, fee handling, and native instruction construction belong in protocol adapters.
- Keep implementations and their types at the lowest level that owns them. Component-specific types belong with their component; protocol-specific helpers belong inside that protocol. Move code up only when multiple actual consumers need it, placing it at their nearest shared owner. Group related protocol variants under their native family when they share implementation. Public entrypoints may re-export APIs without changing implementation ownership; hypothetical future reuse is not a reason to introduce a shared abstraction.
- Use atomic bigint amounts and explicit chain context. Exact output requires native on-chain exact-output execution; never substitute inverse exact-input sizing.
- Keep the high-level swap API protocol-neutral, strongly typed, and compatible with browser workers. Expose raw native instruction builders through dedicated instruction subpaths. Do not expose third-party SDK runtime objects.
- Import standard Solana program addresses and reusable instruction/PDA primitives from compatible official `@solana-program/*` packages instead of duplicating their constants. Keep instruction outputs portable; do not attach signer objects or callbacks.
- Before implementing Solana account decoding, extension handling, instruction construction, or other standard primitives, inspect the installed official Solana SDKs and reuse their compatible APIs. Do not rebuild functionality they already provide. Keep only SDK-specific support policy and validation locally, and verify the pinned library's behavior rather than assuming its enums or codecs are interchangeable.
- Throw documented custom Error subclasses for expected failures and return successful values directly. Preserve typed failure context on the errors; never mask unexpected exceptions. Reject unsupported protocol versions, token features, and execution guarantees explicitly.
- Keep each distinct native instruction in its own file. Match the filename and exported function to the full native instruction name, preserving version suffixes (for example, `buy_v3.ts` exports `buy_v3`). Use typed accounts and arguments, explicit ordered account roles, and a named instruction-data encoder that makes the native layout readable. Keep quoting and state validation in the adapter.
- Keep code readable and formatted; complete the required CI verification below before every PR push.
- Use TSDoc for public APIs and non-obvious units, trust boundaries, and guarantees. Document every instruction argument with its meaning, units, limits, and concrete values. Give every instruction function a typed usage example, parameters, return contract, synchronous failures, and native execution caveats. Keep account-interface descriptions concise; do not repeat byte offsets or layouts in prose. Maintain standalone buy-and-send projects for Pump.fun and Meteora DLMM in `example/`; each project must run when copied independently. Prefer named pure functions; use classes only to own state or resources.
- Do not add unit tests. Verify public consumer workflows and real program execution through end-to-end tests.
- Do not create design documents or implementation-plan Markdown files. Keep README and capability documentation accurate.
- Never include private keys, user account snapshots, service credentials, or extracted Axiom bundles. Attribute any reused open-source code.
- Use capability status to distinguish implemented behavior from validated execution and planned support.

## Repository workflow

- Submit and update PRs as `realhen-agent[bot]` through `/Users/henryho/.local/bin/agent-github --repo realhen/celere-protocol-sdk`; verify the helper identity before submission. Preserve the human's GitHub login and global Git identity.
- Use PRs for review. `realhen` reviews and merges; agents must not push directly to `main`, merge, enable auto-merge, approve their own PRs, or resolve human review threads.

## Required CI verification before every PR push

- Read `.github/workflows/ci.yml` before verification. It is the source of truth for the runtime versions, Surfpool release and checksum, and exact CI commands. These requirements apply to both initial PR submissions and every subsequent push to a PR branch.
- Use the Node.js version configured in CI (currently Node.js 22) and the exact pinned Surfpool release (currently 1.6.0). Verify `node --version` and `surfpool --version` in the same environment used to run the checks. Never assume the default Surfpool on `PATH` matches CI or substitute an older or newer release.
- When installing Surfpool, use the official release asset for the host platform and verify its checksum. On Linux x64, use the asset and checksum pinned in CI; on other platforms, use the matching official asset for the same release and its published checksum. A task-local installation added to `PATH` is sufficient.
- Run all of the following from the repository root against the final tree intended for the push. If the workflow changes, follow its updated commands and update this list accordingly:

  ```sh
  npm ci --ignore-scripts
  npm run check
  npm run test:surfpool:ci
  ```

- `npm run check` covers formatting, lint, typechecking, the build, and the regular end-to-end suite. The separate `test:surfpool:ci` command is mandatory: it runs real native execution with `--require-coverage`. The non-strict `test:surfpool` command, filtered tests, or a passing regular suite are not substitutes.
- Require successful exits from every command. The strict native run must have no failed, skipped, or TODO tests, and its execution report must show full native instruction coverage, `passed: true`, `complete: true`, and no audit errors. Inspect the evidence under `outputs/surfpool/`; transaction acceptance alone does not prove execution.
- Record the verified Node.js and Surfpool versions, commands, and results in the PR validation notes. Re-run the checks after changes to the candidate tree; results from an earlier revision do not validate a later push.
- If the pinned tools or required checks are unavailable, fail, or cannot complete, do not push or claim the PR is ready. Report the blocker instead of weakening the gate or relying on GitHub Actions to discover it after pushing.
