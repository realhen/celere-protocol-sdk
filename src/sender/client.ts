import {
  SenderConfigurationError,
  SenderRequestError,
  SenderAbortedError,
  PriorityFeeTooLowError,
} from "./errors/index.js";
import type { Transaction } from "@solana/kit";
import { U64_MAX } from "../core/amounts.js";
import { isValidAddress } from "../core/addresses.js";
import { isConfiguredProvider, validateTimeout } from "./providers/configuration.js";
import type { ConfiguredRoute, ValidationResult } from "./providers/configuration.js";
import { RpcSender } from "./providers/rpc.js";
import { sendRouteTransaction } from "./transport.js";
import {
  copyPreparedVariants,
  prepareTransactionVariants,
  signPreparedTransactions,
  serializeSignedTransactions,
} from "./transaction.js";
import { SenderProvider } from "./types.js";
import type {
  PrepareRequest,
  PreparedSubmission,
  PreparedVariant,
  SendRequest,
  SenderClientOptions,
  SenderHttpTransport,
  SenderRoute,
  Submission,
  SubmitSignedOptions,
} from "./types.js";

/**
 * Prepares, signs, and concurrently submits transactions through configured routes.
 *
 * Create a client once and reuse it. Each send supplies its own instructions, signers,
 * nonce, and fees. The client owns route configuration and unsigned preparation records;
 * wallets, nonce selection, and on-chain confirmation remain with the application.
 *
 * @example
 * ```ts
 * import { SenderClient, AstralaneSender, Region } from "celere-protocol-sdk/sender";
 *
 * declare const rpcUrl: string;
 * declare const apiKey: string;
 *
 * const sender = new SenderClient({
 *   defaultRpc: { url: rpcUrl },
 *   routes: [new AstralaneSender({ apiKey, region: Region.Frankfurt })],
 * });
 * ```
 */
export class SenderClient {
  /** Immutable route configuration, including provider credentials, stays private at runtime. */
  readonly #routes: readonly ConfiguredRoute[];
  /** HTTP implementation selected when this client is constructed. */
  readonly #transport: SenderHttpTransport;
  /** Original message buffers; weak keys let unused preparation records be garbage-collected. */
  readonly #preparedSubmissions = new WeakMap<
    PreparedSubmission,
    readonly PreparedVariant[]
  >();

  /**
   * Retain immutable built-in providers or snapshot custom metadata without starting network work.
   *
   * @param options - Default RPC, provider lanes, and optional HTTP transport.
   * @throws {@link SenderConfigurationError} synchronously for invalid routes, duplicate
   * route names, an invalid default RPC URL, or an invalid custom transport.
   */
  constructor(options: SenderClientOptions) {
    this.#routes = configureSenderRoutes(options);
    this.#transport = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /**
   * Compile unsigned transaction variants locally for inspection or external signing.
   *
   * Compatible regional routes share a variant. Distinct tipped variants and the untipped
   * RPC variant must share a durable nonce, with its advance instruction first.
   * A recent blockhash supports an RPC-only client. Missing a nonce never silently
   * disables configured providers, and the client never fetches a lifetime implicitly.
   *
   * @param request - Instructions, payer, fees, lookup contents, and one explicit lifetime.
   * @returns A plan belonging to this client. Keep this exact object for {@link submitSigned}.
   * @throws {@link SenderRequestError} for malformed inputs or conflicting tip recipients.
   * @throws {@link NonceRequiredError} when distinct variants lack a shared durable nonce.
   * @throws {@link TipTooLowError} or {@link PriorityFeeTooLowError} for below-floor fees.
   * @throws {@link SenderCompilationError} if offline message compilation fails.
   * @remarks No RPC reads or signatures are requested. The caller owns nonce freshness and
   * exclusive use. Preparing a transaction does not establish that it can execute.
   *
   * @example
   * ```ts
   * import type { PrepareRequest, SenderClient } from "celere-protocol-sdk/sender";
   *
   * declare const sender: SenderClient;
   * declare const request: PrepareRequest;
   *
   * const prepared = sender.prepare(request);
   * const unsignedTransactions = prepared.variants.map(variant => variant.transaction);
   * ```
   */
  prepare(request: PrepareRequest): PreparedSubmission {
    const validation = validatePreparationRequest(request, this.#routes);
    if (!validation.ok) throw validation.error;
    const variants = copyPreparedVariants(
      prepareTransactionVariants(request, this.#routes),
    );
    const prepared = Object.freeze({ variants: copyPreparedVariants(variants) });
    this.#preparedSubmissions.set(prepared, variants);
    return prepared;
  }

  /**
   * Prepare and batch-sign the variants, verify signatures, then launch all routes.
   *
   * @param request - Preparation inputs, every required Kit partial signer, and send options.
   * @returns Local signatures and a separate promise for all HTTP results. Resolves after
   * requests are launched, without waiting for provider responses or chain confirmation.
   * @throws Rejects with the preparation errors documented on {@link prepare}.
   * @throws {@link SenderSigningError} if a signer fails, signatures are invalid, or messages change.
   * @throws {@link SenderAbortedError} when the client observes cancellation before dispatch.
   * No route has been submitted when this method rejects.
   * @remarks Route failures appear in {@link Submission.results} independently. A provider
   * acknowledgment is not evidence that the transaction executed on chain.
   *
   * @example
   * ```ts
   * import type { SendRequest, SenderClient } from "celere-protocol-sdk/sender";
   *
   * declare const sender: SenderClient;
   * declare const request: SendRequest;
   *
   * const submission = await sender.send(request);
   * const signatures = submission.variants.map(variant => variant.signature);
   * // Await this only when your application needs the HTTP observations.
   * const routeResults = await submission.results;
   * ```
   */
  async send(request: SendRequest): Promise<Submission> {
    if (request.signal?.aborted) {
      throw new SenderAbortedError("Send aborted before signing");
    }
    const prepared = this.prepare(request);
    const signed = await signPreparedTransactions(
      prepared.variants,
      request.signers,
      request.signal,
    );
    return this.submitSigned(prepared, signed, request);
  }

  /**
   * Verify externally signed variants and submit them using their original route assignments.
   *
   * @param prepared - The original object returned by this client's {@link prepare} method.
   * @param transactions - Signed transactions in the same order as `prepared.variants`.
   * Messages must be unchanged and all required signatures must be present and valid.
   * @param options - Optional cancellation signal and per-route result callback.
   * @returns The same dispatch and observation contract as {@link send}.
   * @throws {@link SenderRequestError} if the plan belongs to another client or variant counts differ.
   * @throws {@link SenderSigningError} if messages change or signatures are missing/invalid.
   * @throws {@link SenderAbortedError} if cancellation is observed before dispatch.
   * @remarks Every failure above rejects before any route is dispatched. Reusing a prepared
   * plan does not refresh its nonce or reserve it; the application owns nonce availability.
   *
   * @example
   * ```ts
   * import type { Transaction } from "@solana/kit";
   * import type { PrepareRequest, SenderClient } from "celere-protocol-sdk/sender";
   *
   * declare const sender: SenderClient;
   * declare const request: PrepareRequest;
   * declare function signWithWallet(transactions: readonly Transaction[]): Promise<readonly Transaction[]>;
   *
   * const prepared = sender.prepare(request);
   * const signed = await signWithWallet(prepared.variants.map(variant => variant.transaction));
   * const submission = await sender.submitSigned(prepared, signed);
   * ```
   */
  async submitSigned(
    prepared: PreparedSubmission,
    transactions: readonly Transaction[],
    options: SubmitSignedOptions = {},
  ): Promise<Submission> {
    const variants = this.#preparedSubmissions.get(prepared);
    if (
      !variants ||
      !Array.isArray(transactions) ||
      transactions.length !== variants.length
    ) {
      throw new SenderRequestError(
        "Signed transactions must match a plan from this client",
      );
    }
    if (options.signal?.aborted) {
      throw new SenderAbortedError("Send aborted before dispatch");
    }
    const payloads = await serializeSignedTransactions(variants, transactions);
    // A wallet or signature verifier may finish after the application has cancelled.
    if (options.signal?.aborted) {
      throw new SenderAbortedError("Send aborted before dispatch");
    }
    // Launch every route before returning; only the results promise waits for HTTP responses.
    const results = this.#routes.map((route) => {
      const index = variants.findIndex((variant) => variant.routeIds.includes(route.id));
      return sendRouteTransaction(
        route,
        payloads[index]!,
        this.#transport,
        options.signal,
      ).then((result) => {
        const onRouteResult = options.onRouteResult;
        if (onRouteResult) {
          // Observation is application work: neither slow callbacks nor callback failures
          // should delay the transport results or affect another route's submission.
          void Promise.resolve()
            .then(() => onRouteResult(result))
            .catch(() => {});
        }
        return result;
      });
    });
    return {
      variants: payloads.map((payload, index) => ({
        signature: payload.signature,
        routeIds: [...variants[index]!.routeIds],
        wireBytes: Uint8Array.from(payload.bytes),
      })),
      results: Promise.all(results),
    };
  }
}

/** Built-ins are already validated and immutable. Snapshot metadata for custom implementations. */
function configureRoute(route: SenderRoute): ValidationResult<SenderRoute> {
  if (isConfiguredProvider(route)) return { ok: true, value: route };
  if (
    !route ||
    !Object.values(SenderProvider).includes(route.provider) ||
    route.provider === SenderProvider.Rpc
  )
    return {
      ok: false,
      error: new SenderConfigurationError(
        "Use a provider route; defaultRpc supplies the RPC lane",
      ),
    };
  if (route.name !== undefined && (typeof route.name !== "string" || !route.name.trim()))
    return { ok: false, error: new SenderConfigurationError("Invalid route name") };
  const amounts = [route.minimumTipLamports, route.minimumPriorityFeeLamports];
  if (
    amounts.some((value) => typeof value !== "bigint" || value < 0n || value > U64_MAX) ||
    route.minimumTipLamports === 0n ||
    !Array.isArray(route.tipAccounts) ||
    !route.tipAccounts.length ||
    route.tipAccounts.some((value) => !isValidAddress(value)) ||
    typeof route.createRequest !== "function"
  )
    return {
      ok: false,
      error: new SenderConfigurationError(
        "Invalid provider requirements or request encoder",
      ),
    };
  const timeout = validateTimeout(route.timeoutMs);
  if (!timeout.ok) return timeout;
  return {
    ok: true,
    value: Object.freeze({
      provider: route.provider,
      ...(route.name === undefined ? {} : { name: route.name }),
      timeoutMs: timeout.value,
      minimumTipLamports: route.minimumTipLamports,
      minimumPriorityFeeLamports: route.minimumPriorityFeeLamports,
      tipAccounts: Object.freeze([...route.tipAccounts]),
      createRequest: route.createRequest.bind(route),
    }),
  };
}

/** Configure once, add the default RPC, and assign stable IDs. No network work is performed. */
function configureSenderRoutes(options: SenderClientOptions): readonly ConfiguredRoute[] {
  if (!options?.defaultRpc) throw new SenderConfigurationError("defaultRpc is required");
  if (options.routes !== undefined && !Array.isArray(options.routes))
    throw new SenderConfigurationError("routes must be an array of providers");
  if (options.fetch !== undefined && typeof options.fetch !== "function")
    throw new SenderConfigurationError("fetch must be an HTTP transport function");
  const routes: SenderRoute[] = [];
  const names = new Set<string>();
  for (const route of options.routes ?? []) {
    const result = configureRoute(route);
    if (!result.ok) throw result.error;
    if (result.value.name !== undefined) {
      if (names.has(result.value.name))
        throw new SenderConfigurationError("Explicit route names must be unique");
      names.add(result.value.name);
    }
    routes.push(result.value);
  }
  return [
    { id: "rpc:0", config: new RpcSender(options.defaultRpc) },
    ...routes.map((config, index) => ({ id: `${config.provider}:${index + 1}`, config })),
  ];
}

/** A fee is an atomic, non-negative u64 amount. No coercion or implicit fee adjustment. */
function isFeeAmount(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= U64_MAX;
}

/** Return expected input failures as values; the public preparation boundary decides how to surface them. */
function validatePreparationRequest(
  request: PrepareRequest,
  routes: readonly ConfiguredRoute[],
): ValidationResult<PrepareRequest> {
  if (
    !request ||
    !request.fees ||
    !Array.isArray(request.instructions) ||
    request.instructions.length === 0
  )
    return {
      ok: false,
      error: new SenderRequestError("At least one instruction and fees are required"),
    };
  if (Boolean(request.nonce) === Boolean(request.lifetime))
    return {
      ok: false,
      error: new SenderRequestError("Supply exactly one nonce or blockhash lifetime"),
    };
  const fees = request.fees;
  if (!isFeeAmount(fees.tipLamports) || !isFeeAmount(fees.computeUnitPriceMicroLamports))
    return {
      ok: false,
      error: new SenderRequestError("Fee amounts must be non-negative u64 bigint values"),
    };
  if (
    !Number.isInteger(fees.computeUnitLimit) ||
    fees.computeUnitLimit <= 0 ||
    fees.computeUnitLimit > 1_400_000
  )
    return {
      ok: false,
      error: new SenderRequestError(
        "Compute unit limit must be an integer from 1 through 1400000",
      ),
    };
  // Solana rounds the total priority fee up to whole lamports, not the per-CU price.
  const priorityFeeLamports =
    (BigInt(fees.computeUnitLimit) * fees.computeUnitPriceMicroLamports + 999_999n) /
    1_000_000n;
  for (const route of routes) {
    if (priorityFeeLamports < route.config.minimumPriorityFeeLamports)
      return {
        ok: false,
        error: new PriorityFeeTooLowError(`Priority fee below minimum for ${route.id}`),
      };
  }
  for (const [provider, amount] of Object.entries(fees.tipOverrides ?? {})) {
    if (
      provider === SenderProvider.Rpc ||
      !routes.some((route) => route.config.provider === provider)
    )
      return {
        ok: false,
        error: new SenderRequestError("Tip override refers to an unconfigured provider"),
      };
    if (!isFeeAmount(amount))
      return {
        ok: false,
        error: new SenderRequestError(
          "Tip overrides must be non-negative u64 bigint values",
        ),
      };
  }
  return { ok: true, value: request };
}
