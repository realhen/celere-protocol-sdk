import {
  SenderConfigurationError,
  SenderRequestError,
  SenderAbortedError,
} from "./errors/index.js";
import type { Transaction } from "@solana/kit";
import { configureSenderRoutes } from "./configuration.js";
import type { ConfiguredRoute } from "./configuration.js";
import { prepareTransactionVariants } from "./prepare-submission.js";
import {
  signPreparedTransactions,
  serializeSignedTransactions,
} from "./sign-submission.js";
import { submitTransactionVariants } from "./submit-submission.js";
import { copyPreparedVariants } from "./transaction.js";
import type {
  PrepareRequest,
  PreparedSubmission,
  PreparedVariant,
  SendRequest,
  SenderClientOptions,
  SenderHttpTransport,
  Submission,
  SubmitSignedOptions,
} from "./types.js";

/** Configuration and preparation records retained for one client. */
interface SenderClientState {
  readonly routes: readonly ConfiguredRoute[];
  readonly transport: SenderHttpTransport;
  readonly preparedSubmissions: WeakMap<PreparedSubmission, readonly PreparedVariant[]>;
}

// Keep credentials and original message buffers outside the public client object. A
// module-private WeakMap preserves runtime privacy without JavaScript #field syntax,
// and releases state when the application no longer retains its client.
const clientStates = new WeakMap<SenderClient, SenderClientState>();

function getClientState(client: SenderClient): SenderClientState {
  const state = clientStates.get(client);
  if (!state)
    throw new SenderConfigurationError(
      "Sender methods require their original client instance",
    );
  return state;
}

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
  /**
   * Retain immutable built-in providers or snapshot custom metadata without starting network work.
   *
   * @param options - Default RPC, provider lanes, and optional HTTP transport.
   * @throws {@link SenderConfigurationError} synchronously for invalid routes, duplicate
   * route names, an invalid default RPC URL, or an invalid custom transport.
   */
  constructor(options: SenderClientOptions) {
    clientStates.set(this, {
      routes: configureSenderRoutes(options),
      transport: options.fetch ?? ((url, init) => fetch(url, init)),
      // Weak plan keys do not retain unused preparation records indefinitely.
      preparedSubmissions: new WeakMap(),
    });
  }

  /**
   * Compile unsigned transaction variants locally for inspection or external signing.
   *
   * Compatible regional routes share a variant. Distinct tipped variants and the untipped
   * RPC variant must share a durable nonce, with its advance instruction first.
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
    const { routes, preparedSubmissions } = getClientState(this);
    const variants = copyPreparedVariants(prepareTransactionVariants(request, routes));
    const prepared = Object.freeze({ variants: copyPreparedVariants(variants) });
    preparedSubmissions.set(prepared, variants);
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
    const { routes, transport, preparedSubmissions } = getClientState(this);
    const variants = preparedSubmissions.get(prepared);
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
    return submitTransactionVariants(routes, variants, payloads, transport, options);
  }
}
