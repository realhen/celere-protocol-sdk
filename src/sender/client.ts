import {
  assertIsTransactionWithinSizeLimit,
  getBase64Decoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  verifySignature,
} from "@solana/kit";
import type {
  Address,
  Transaction,
  TransactionWithLifetime,
  TransactionPartialSigner,
  ReadonlyUint8Array,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { compileTransaction } from "../transactions/index.js";
import { U64_MAX } from "../core/amounts.js";
import { isValidAddress } from "../core/addresses.js";
import { dispatch } from "./http.js";
import type { DispatchRoute, Payload } from "./http.js";
import { validateEndpoint, validateTimeout } from "./providers.js";
import {
  HeliusSenderMode,
  SenderError,
  SenderErrorCode,
  SenderProvider,
} from "./types.js";
import type {
  PrepareRequest,
  PreparedSubmission,
  PreparedVariant,
  SendRequest,
  SenderClientOptions,
  SenderRoute,
  Submission,
} from "./types.js";

type ReadyTransaction = Transaction & TransactionWithLifetime;
interface Plan {
  readonly variants: readonly PreparedVariant[];
  readonly routes: readonly DispatchRoute[];
}
function invalid(message: string): never {
  throw new SenderError(SenderErrorCode.InvalidRequest, message);
}
function amount(value: unknown): asserts value is bigint {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX)
    invalid("Fee amounts must be non-negative u64 bigint values");
}
function cloneTransaction(tx: ReadyTransaction): ReadyTransaction {
  return {
    ...tx,
    messageBytes: Uint8Array.from(tx.messageBytes) as unknown as typeof tx.messageBytes,
    lifetimeConstraint: { ...tx.lifetimeConstraint },
    signatures: Object.fromEntries(
      Object.entries(tx.signatures).map(([key, sig]) => [
        key,
        sig ? Uint8Array.from(sig) : null,
      ]),
    ) as typeof tx.signatures,
  };
}
function sameBytes(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function snapshotRoute(route: SenderRoute): SenderRoute {
  if (
    !Object.values(SenderProvider).includes(route.provider) ||
    route.provider === SenderProvider.Rpc
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Use defaultRpc for RPC submission",
    );
  if (!route.apiKey || /[\r\n]/.test(route.apiKey))
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid API key");
  if (route.name !== undefined && (typeof route.name !== "string" || !route.name.trim()))
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid route name");
  if (
    typeof route.minimumTipLamports !== "bigint" ||
    route.minimumTipLamports <= 0n ||
    route.minimumTipLamports > U64_MAX ||
    !route.tipAccounts?.length ||
    route.tipAccounts.some((a) => !isValidAddress(a))
  )
    throw new SenderError(
      SenderErrorCode.InvalidConfiguration,
      "Invalid route tip requirements",
    );
  if (
    route.provider === SenderProvider.Helius &&
    !Object.values(HeliusSenderMode).includes(route.mode!)
  )
    throw new SenderError(SenderErrorCode.InvalidConfiguration, "Invalid Helius tier");
  return Object.freeze({
    ...route,
    endpoint: validateEndpoint(route.endpoint),
    timeoutMs: validateTimeout(route.timeoutMs),
    tipAccounts: Object.freeze([...route.tipAccounts]),
  });
}

/** Owns immutable route configuration. No subscriptions, retries, recovery, or background timers. */
export class SenderClient {
  readonly #routes: readonly DispatchRoute[];
  readonly #fetch: typeof globalThis.fetch;
  readonly #plans = new WeakMap<PreparedSubmission, Plan>();
  constructor(options: SenderClientOptions) {
    if (!options?.defaultRpc)
      throw new SenderError(
        SenderErrorCode.InvalidConfiguration,
        "defaultRpc is required",
      );
    const routes = (options.routes ?? []).map(snapshotRoute);
    const names = routes.flatMap((r) => (r.name === undefined ? [] : [r.name]));
    if (new Set(names).size !== names.length)
      throw new SenderError(
        SenderErrorCode.InvalidConfiguration,
        "Explicit route names must be unique",
      );
    this.#routes = [
      {
        id: "rpc:0",
        config: {
          provider: SenderProvider.Rpc,
          endpoint: validateEndpoint(options.defaultRpc.url),
          apiKey: "",
          timeoutMs: validateTimeout(options.defaultRpc.timeoutMs),
          minimumTipLamports: 0n,
          tipAccounts: [],
        },
      },
      ...routes.map((config, i) => ({ id: `${config.provider}:${i + 1}`, config })),
    ];
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Compile locally. No chain reads, signatures, or submissions occur. Throws SenderError on invalid input. */
  prepare(request: PrepareRequest): PreparedSubmission {
    if (!request || !request.fees || !Array.isArray(request.instructions))
      invalid("Instructions and fees are required");
    if (Boolean(request.nonce) === Boolean(request.lifetime))
      invalid("Supply exactly one nonce or blockhash lifetime");
    const fees = request.fees;
    amount(fees.tipLamports);
    amount(fees.computeUnitPriceMicroLamports);
    if (
      !Number.isInteger(fees.computeUnitLimit) ||
      fees.computeUnitLimit <= 0 ||
      fees.computeUnitLimit > 1_400_000
    )
      invalid("Compute unit limit must be an integer from 1 through 1400000");
    if (
      this.#routes.some(
        (r) =>
          r.config.provider === SenderProvider.Helius &&
          r.config.mode === HeliusSenderMode.Max,
      ) &&
      (BigInt(fees.computeUnitLimit) * fees.computeUnitPriceMicroLamports + 999_999n) /
        1_000_000n <
        5_000n
    )
      throw new SenderError(
        SenderErrorCode.PriorityFeeTooLow,
        "Helius Sender Max requires at least 5000 lamports of priority fee",
      );
    for (const [provider, tip] of Object.entries(fees.tipOverrides ?? {})) {
      if (
        !Object.values(SenderProvider).includes(provider as SenderProvider) ||
        provider === SenderProvider.Rpc ||
        !this.#routes.some((r) => r.config.provider === provider)
      )
        invalid("Tip override refers to an unconfigured provider");
      amount(tip);
    }
    const variants: PreparedVariant[] = [];
    const byTip = new Map<
      string,
      { transaction: ReadyTransaction; routeIds: string[] }
    >();
    const recipients = new Map<SenderProvider, Address>();
    for (const route of this.#routes) {
      const config = route.config;
      const tip =
        config.provider === SenderProvider.Rpc
          ? 0n
          : (fees.tipOverrides?.[config.provider] ?? fees.tipLamports);
      if (tip < config.minimumTipLamports)
        throw new SenderError(
          SenderErrorCode.TipTooLow,
          `Tip below minimum for ${route.id}`,
        );
      let recipient: Address | undefined;
      if (config.provider !== SenderProvider.Rpc) {
        recipient = recipients.get(config.provider);
        if (!recipient || !config.tipAccounts.includes(recipient)) {
          recipient =
            config.tipAccounts[Math.floor(Math.random() * config.tipAccounts.length)]!;
          recipients.set(config.provider, recipient);
        }
        if (
          recipient === request.feePayer ||
          recipient === request.nonce?.account ||
          recipient === request.nonce?.authority
        )
          invalid("Tip recipient conflicts with payer or nonce");
      }
      const key = `${recipient ?? "rpc"}:${tip}`;
      const existing = byTip.get(key);
      if (existing) {
        existing.routeIds.push(route.id);
        continue;
      }
      const instructions = [...request.instructions];
      if (recipient) {
        // The official builder only uses the signer to supply account metadata. No signer object escapes.
        const ix = getTransferSolInstruction({
          source: { address: request.feePayer, signTransactions: async () => [] },
          destination: recipient,
          amount: tip,
        });
        instructions.push({
          programAddress: ix.programAddress,
          data: ix.data,
          accounts: ix.accounts.map(({ address, role }) => ({ address, role })),
        });
      }
      const compiled = compileTransaction({
        instructions,
        feePayer: request.feePayer,
        lifetime: request.nonce ?? request.lifetime!,
        computeBudget: {
          units: fees.computeUnitLimit,
          microLamports: fees.computeUnitPriceMicroLamports,
        },
        ...(request.lookupTables === undefined
          ? {}
          : { lookupTables: request.lookupTables }),
      });
      if (!compiled.ok)
        throw new SenderError(SenderErrorCode.CompilationFailed, compiled.error.message);
      const variant = { transaction: compiled.value.transaction, routeIds: [route.id] };
      byTip.set(key, variant);
      variants.push(variant);
    }
    if (variants.length > 1 && !request.nonce)
      throw new SenderError(
        SenderErrorCode.NonceRequired,
        "Distinct variants, including the RPC variant, require a shared durable nonce",
      );
    const internal = variants.map((v) => ({
      transaction: cloneTransaction(v.transaction),
      routeIds: Object.freeze([...v.routeIds]),
    }));
    const prepared = Object.freeze({
      variants: Object.freeze(
        internal.map((v) =>
          Object.freeze({
            transaction: cloneTransaction(v.transaction),
            routeIds: v.routeIds,
          }),
        ),
      ),
    });
    this.#plans.set(prepared, { variants: internal, routes: this.#routes });
    return prepared;
  }

  /** Batch-sign every variant using Kit partial signers, verify signatures, then launch all routes. */
  async send(request: SendRequest): Promise<Submission> {
    if (request.signal?.aborted)
      throw new SenderError(SenderErrorCode.Aborted, "Send aborted before signing");
    const prepared = this.prepare(request);
    if (!Array.isArray(request.signers)) invalid("Supply transaction partial signers");
    const signers: TransactionPartialSigner[] = [...request.signers];
    const required = Object.keys(prepared.variants[0]!.transaction.signatures);
    if (
      new Set(signers.map((s) => s.address)).size !== signers.length ||
      required.some((a) => !signers.some((s) => s.address === a)) ||
      signers.some(
        (s) => !required.includes(s.address) || typeof s.signTransactions !== "function",
      )
    )
      throw new SenderError(
        SenderErrorCode.SigningFailed,
        "Supply exactly the required transaction partial signers",
      );
    const signed = prepared.variants.map((v) => cloneTransaction(v.transaction));
    try {
      await Promise.all(
        signers.map(async (signer) => {
          const inputs = prepared.variants.map((v) => {
            const tx = cloneTransaction(v.transaction);
            assertIsTransactionWithinSizeLimit(tx);
            return tx;
          });
          const dictionaries = await signer.signTransactions(
            inputs,
            request.signal ? { abortSignal: request.signal } : undefined,
          );
          if (dictionaries.length !== signed.length) throw new Error();
          dictionaries.forEach((dictionary, i) => {
            const signature = dictionary[signer.address];
            if (
              !signature ||
              signature.length !== 64 ||
              Object.keys(dictionary).some((key) => key !== signer.address)
            )
              throw new Error();
            signed[i] = {
              ...signed[i]!,
              signatures: {
                ...signed[i]!.signatures,
                [signer.address]: Uint8Array.from(signature) as typeof signature,
              },
            };
          });
        }),
      );
    } catch {
      throw new SenderError(
        SenderErrorCode.SigningFailed,
        "Signer failed to return the required signatures",
      );
    }
    return this.submitSigned(prepared, signed, request);
  }

  /** Verify externally signed variants against the original plan before any network write. */
  async submitSigned(
    prepared: PreparedSubmission,
    transactions: readonly Transaction[],
    options: Pick<SendRequest, "signal" | "onRouteResult"> = {},
  ): Promise<Submission> {
    const plan = this.#plans.get(prepared);
    if (
      !plan ||
      !Array.isArray(transactions) ||
      transactions.length !== plan.variants.length
    )
      invalid("Signed transactions must match a plan from this client");
    if (options.signal?.aborted)
      throw new SenderError(SenderErrorCode.Aborted, "Send aborted before dispatch");
    const payloads: Payload[] = [];
    try {
      const keys = new Map<Address, Promise<CryptoKey>>();
      await Promise.all(
        plan.variants.map(async (variant, index) => {
          const tx = transactions[index]!;
          if (
            !sameBytes(tx.messageBytes, variant.transaction.messageBytes) ||
            Object.keys(tx.signatures).length !==
              Object.keys(variant.transaction.signatures).length
          )
            throw new Error();
          // Snapshot before any await so the caller cannot change the bytes after verification.
          const snapshot = cloneTransaction({
            ...tx,
            // Wire signatures must follow message signer order, never object insertion order
            // supplied by an external wallet.
            signatures: Object.fromEntries(
              Object.keys(variant.transaction.signatures).map((key) => [
                key,
                tx.signatures[key as Address],
              ]),
            ),
            lifetimeConstraint: variant.transaction.lifetimeConstraint,
          });
          await Promise.all(
            Object.keys(variant.transaction.signatures).map(async (key) => {
              const signer = key as Address;
              const sig = snapshot.signatures[signer];
              if (!sig || sig.length !== 64) throw new Error();
              let publicKey = keys.get(signer);
              if (!publicKey) {
                publicKey = getPublicKeyFromAddress(signer);
                keys.set(signer, publicKey);
              }
              if (!(await verifySignature(await publicKey, sig, snapshot.messageBytes)))
                throw new Error();
            }),
          );
          const bytes = Uint8Array.from(getTransactionEncoder().encode(snapshot));
          payloads[index] = {
            bytes,
            base64: getBase64Decoder().decode(bytes),
            signature: getSignatureFromTransaction(snapshot),
          };
        }),
      );
    } catch {
      throw new SenderError(
        SenderErrorCode.SigningFailed,
        "Signed variants must preserve the prepared messages and contain valid signatures",
      );
    }
    if (options.signal?.aborted)
      throw new SenderError(SenderErrorCode.Aborted, "Send aborted before dispatch");
    const results = plan.routes.map((route) => {
      const index = plan.variants.findIndex((v) => v.routeIds.includes(route.id));
      return dispatch(route, payloads[index]!, this.#fetch, options.signal).then(
        (result) => {
          if (options.onRouteResult)
            void Promise.resolve()
              .then(() => options.onRouteResult!(result))
              .catch(() => {});
          return result;
        },
      );
    });
    return {
      variants: payloads.map((p, i) => ({
        signature: p.signature,
        routeIds: [...plan.variants[i]!.routeIds],
        wireBytes: Uint8Array.from(p.bytes),
      })),
      results: Promise.all(results),
    };
  }
}

/** Immutable fluent configuration; build creates a resource-free SenderClient. */
export class SenderClientBuilder {
  readonly #options: SenderClientOptions;
  constructor(options: SenderClientOptions) {
    this.#options = {
      ...options,
      defaultRpc: { ...options.defaultRpc },
      routes: (options.routes ?? []).map(snapshotRoute),
    };
  }
  /** Return a new builder; existing builders and clients remain unchanged. */
  addRoute(route: SenderRoute): SenderClientBuilder {
    return this.addRoutes([route]);
  }
  /** Append configured lanes, including multiple regions of the same provider. */
  addRoutes(routes: readonly SenderRoute[]): SenderClientBuilder {
    return new SenderClientBuilder({
      ...this.#options,
      routes: [...this.#options.routes!, ...routes],
    });
  }
  /** Validate routes and return a runtime. Does not fetch, subscribe, or sign. */
  build(): SenderClient {
    return new SenderClient(this.#options);
  }
}
/** Start fluent route configuration. Transactions and fees are supplied per send. */
export function createSenderClient(options: SenderClientOptions): SenderClientBuilder {
  return new SenderClientBuilder(options);
}
