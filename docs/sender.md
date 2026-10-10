# Sender client

The optional `celere-protocol-sdk/sender` entrypoint submits instructions built by any protocol. The application owns wallets, nonce accounts, fee estimates, and chain tracking. The client prepares provider-specific transactions, verifies signatures, and launches every configured lane plus the default RPC concurrently.

The package includes this guide, commented TypeScript source, declarations, and a [complete all-provider example](../example/sender.ts). Import public APIs from `celere-protocol-sdk/sender`; source and `dist` internals are implementation details.

## Configure once, send per transaction

Construct providers once and reuse the client. Construction performs no network requests and needs no `start` or `close`. Each provider instance represents one region. Explicit names help associate transport results with application labels; generated route IDs remain available without names.

```ts
import type { Instruction, TransactionPartialSigner } from "@solana/kit";
import type { DurableNonce } from "celere-protocol-sdk/transactions";
import {
  SenderClient,
  AstralaneSender,
  HeliusSender,
  Region,
} from "celere-protocol-sdk/sender";

declare const rpcUrl: string;
declare const astralaneKey: string;
declare const heliusKey: string;
declare const wallet: TransactionPartialSigner;
declare const instructions: readonly Instruction[];
// Created and fetched by the application; authority is wallet.address in this example.
declare const nonce: DurableNonce;

const sender = new SenderClient({
  defaultRpc: { url: rpcUrl },
  routes: [
    new AstralaneSender({
      apiKey: astralaneKey,
      region: Region.Frankfurt,
      name: "astralane-frankfurt",
    }),
    new AstralaneSender({
      apiKey: astralaneKey,
      region: Region.NewYork,
      name: "astralane-new-york",
    }),
    new HeliusSender({ apiKey: heliusKey, region: Region.Frankfurt }),
  ],
});

const submission = await sender.send({
  instructions,
  feePayer: wallet.address,
  signers: [wallet],
  nonce,
  fees: {
    // Illustrative values. Estimate for the complete transaction outside this send.
    computeUnitLimit: 200_000,
    computeUnitPriceMicroLamports: 50_000n,
    tipLamports: 1_000_000n,
  },
});
const signatures = submission.variants.map((variant) => variant.signature);
// All HTTP attempts have started. Chain tracking can start using these signatures.
const observations = await submission.results; // Optional transport reporting.
```

`send` resolves after signing, signature verification, serialization, and dispatch. It does not await provider responses or confirmation. Each partial signer receives all distinct variants in one batch. If the nonce authority differs from the payer, include that authority's signer, plus any instruction signers. Supply each signer address exactly once. The SDK never accepts private keys directly.

The default RPC receives an untipped variant. Provider variants contain a native SOL transfer to one published recipient. Compatible regions share the same recipient, tip, message, and signature. Distinct messages use the same durable nonce and advance it first, so they compete for one nonce value.

## Provider options and fees

All provider options include:

| Option      | Contract                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | Required nonempty credential; remote validity is checked by the provider only upon submission.                                                                                    |
| `region`    | A provider-specific region type. Defaults to Global for Astralane/Helius, Frankfurt otherwise. Unsupported combinations fail at configuration time.                               |
| `endpoint`  | Optional complete HTTP(S) submission URL, including its provider-specific path. Overrides the region's URL without changing its wire format. Userinfo and fragments are rejected. |
| `name`      | Optional nonempty application label, unique within a client. Appears as `routeName`.                                                                                              |
| `timeoutMs` | Integer from 1 to 60,000; default 3,000. Covers the response body as well as response headers.                                                                                    |

Provider catalogs and official references appear in the [README provider table](../README.md#provider-configuration). Region selection does not automatically redirect to another city. For binary Astralane, a custom endpoint must accept `/irisb` wire encoding. In browsers, choose HTTPS endpoints with suitable CORS support and an appropriate credential strategy.

Tips and compute prices are bigint atomic amounts. `tipLamports` sets the per-provider amount; `tipOverrides` replaces it for every lane of a specified `SenderProvider`. Only the winning on-chain variant can execute successfully; multiple send attempts are still separate HTTP requests.

`minimumTipLamports` on a provider is a validation floor. It does not set the transaction's tip. `AstralaneTier` and `HeliusSenderMode` choose provider fee policies; 0slot accepts an eligible plan floor in its constructor. Choosing a tier locally does not upgrade the remote account.

The total priority fee is `ceil(computeUnitLimit × computeUnitPriceMicroLamports / 1_000_000)` lamports. The example requests 200,000 CUs at 50,000 micro-lamports per CU, for a 10,000-lamport priority fee. This is separate from the provider tip. The CU limit must include the entire message, including setup, nonce advancement, and the tip. Simulate or estimate outside the latency-sensitive send call. The client neither samples fees nor automatically raises them.

## Nonces and application ownership

Supply `{ account, authority, value }` using an already-provisioned nonce account. The SDK does no discovery, reservation, refresh, or persistent recovery. Independent trades need different available nonce snapshots. Slot duration or an HTTP timeout does not establish availability. A failed durable-nonce transaction can also consume its nonce and charge fees.

After submission, the application determines whether the trade landed and when the account is safe to reuse. Refresh its value before another trade. RPC-only clients may instead supply `lifetime: { blockhash, lastValidBlockHeight }`; distinct tipped variants require a durable nonce.

## External signing

Use `prepare` when a wallet integration needs to inspect and sign messages separately. Keep the original prepared object and variant order. Every signed message must remain byte-for-byte identical, and all required signatures must be valid. A plan belongs to the client that created it.

```ts
import type { Transaction } from "@solana/kit";
import type { PrepareRequest, SenderClient } from "celere-protocol-sdk/sender";

declare const sender: SenderClient;
declare const request: PrepareRequest;
declare function signWithWallet(
  transactions: readonly Transaction[],
): Promise<readonly Transaction[]>;

const prepared = sender.prepare(request);
const signed = await signWithWallet(
  prepared.variants.map((variant) => variant.transaction),
);
const submission = await sender.submitSigned(prepared, signed);
```

`prepare` is offline and unsigned. `submitSigned` verifies and serializes all variants before dispatch. Neither method verifies that a nonce is still available on chain. Modifying/signing-and-sending wallet APIs need an application adapter; the client accepts partial signers or externally signed transactions.

## Errors and transport observations

Configuration and preparation errors throw synchronously. `send` and `submitSigned` reject on local failures before dispatch. These failures extend `SenderError` and carry a stable `SenderErrorCode`.

| Class                      | Meaning                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `SenderConfigurationError` | Invalid client/provider options, duplicate route labels, endpoint, or deadline.              |
| `SenderRequestError`       | Malformed input, incompatible signer inputs, or a preparation record/variant count mismatch. |
| `NonceRequiredError`       | Multiple distinct variants were requested without a shared nonce.                            |
| `TipTooLowError`           | A per-send tip is below a configured lane's floor.                                           |
| `PriorityFeeTooLowError`   | The total priority fee is below a lane's floor.                                              |
| `SenderCompilationError`   | Offline message compilation failed, for example because of packet size.                      |
| `SenderSigningError`       | Signing failed, messages changed, or required signatures were missing/invalid.               |
| `SenderAbortedError`       | The client observed cancellation before signing or dispatch.                                 |

```ts
import {
  SenderError,
  TipTooLowError,
  type SenderClient,
  type SendRequest,
} from "celere-protocol-sdk/sender";

declare const sender: SenderClient;
declare const request: SendRequest;
try {
  const submission = await sender.send(request);
} catch (error) {
  if (error instanceof TipTooLowError) {
    // No dispatch occurred. Let the application choose an eligible tip explicitly.
  } else if (error instanceof SenderError) {
    const category = error.code;
  } else {
    throw error;
  }
}
```

Once dispatch begins, failures are values in `submission.results`. They do not reject the send because another lane failed.

| `SubmissionStatus` | Meaning                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `Accepted`         | The provider returned the expected local signature. This is not chain confirmation.                                             |
| `Rejected`         | The provider or HTTP endpoint explicitly rejected this attempt. Other lanes may still land.                                     |
| `Unknown`          | Acceptance could not be established, including timeouts, disconnects, or unexpected signatures. The transaction may still land. |
| `NotSubmitted`     | Cancellation was observed before this lane attempted HTTP submission.                                                           |

Results are returned in configured route order. The optional `onRouteResult` callback runs as each lane settles; the client neither awaits its work nor propagates callback failures. It is for application reporting, not confirmation or automatic retry. The SDK makes one bounded HTTP attempt per route; provider-internal retry behavior is independent.

## Cancellation, connections, and custom providers

Pass an `AbortSignal` to `send` or `submitSigned`. Client-observed cancellation before dispatch rejects; a signer that rejects, including for cancellation, is normalized to `SenderSigningError`. Cancellation during HTTP submission produces observations. It cannot retract submitted transactions or release nonces safely.

An injected `SenderHttpTransport` can use an application-managed connection pool or proxy. It must accept the supplied URL, request body, headers, and abort signal. The client bounds its own wait even if the transport ignores cancellation; actual transport resources remain caller-owned. The SDK does not create a background warming service or promise measured landing latency.

Each built-in provider implements `SenderRoute`. Applications can implement the same contract for a different transport adapter for an existing `SenderProvider`. Metadata describes tip and priority-fee requirements; `createRequest` synchronously encodes the supplied signed payload without network work. The shared HTTP layer handles dispatch, deadlines, and observations. Custom implementations are trusted application code and must preserve payload bytes and avoid their own submission side effects. `createRequest` is normally called internally, not used as an alternative public send method.

The package and documentation examples are checked through an installed tarball consumer. HTTP tests verify concurrent dispatch and provider formats; local Surfpool verifies nonce arbitration. These checks do not establish live provider acceptance or a landing-latency guarantee.
