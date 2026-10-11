import process from "node:process";
import { address, getBase64EncodedWireTransaction, isWritableRole } from "@solana/kit";
import type { Instruction, TransactionPartialSigner } from "@solana/kit";
import { fetchNonce } from "@solana-program/system";
import {
  SenderClient,
  HeliusSender,
  ZeroSlotSender,
  Region,
  SubmissionStatus,
  type PrepareRequest,
  type SenderRoute,
} from "celere-protocol-sdk";
import type { Rpc } from "./rpc";

/** Configure long-lived routes once. Add further providers or regional lanes here. */
export function configureSender(rpcUrl: string) {
  const routes: SenderRoute[] = [];
  if (process.env.HELIUS_API_KEY)
    routes.push(
      new HeliusSender({
        apiKey: process.env.HELIUS_API_KEY,
        region: Region.Frankfurt,
      }),
    );
  if (process.env.ZERO_SLOT_API_KEY)
    routes.push(
      new ZeroSlotSender({
        apiKey: process.env.ZERO_SLOT_API_KEY,
        ...(process.env.ZERO_SLOT_ENDPOINT
          ? { endpoint: process.env.ZERO_SLOT_ENDPOINT }
          : {}),
        region: Region.Frankfurt,
      }),
    );
  if (routes.length && !process.env.NONCE_ACCOUNT) {
    throw new Error(
      "Provider fan-out requires NONCE_ACCOUNT; use an existing nonce authorized by this wallet.",
    );
  }
  return { client: new SenderClient({ defaultRpc: { url: rpcUrl }, routes }), routes };
}

/**
 * Fetch fees/lifetime, simulate every complete variant, then sign and fan out.
 * This is application-side preparation; the SDK's dispatch path performs no RPC reads.
 * The one-shot example exclusively uses its nonce and never automatically retries a buy.
 */
export async function sendBuy(
  rpc: Rpc,
  sender: ReturnType<typeof configureSender>,
  wallet: TransactionPartialSigner,
  instructions: readonly Instruction[],
  simulateOnly: boolean,
) {
  const writable = [
    ...new Set(
      instructions.flatMap(
        (instruction) =>
          instruction.accounts
            ?.filter((account) => isWritableRole(account.role))
            .map((account) => account.address) ?? [],
      ),
    ),
  ];
  const samples = process.env.CU_PRICE_MICROLAMPORTS
    ? []
    : await rpc.getRecentPrioritizationFees(writable).send();
  // The RPC reports recent per-slot minimum fees, not a guarantee of inclusion.
  const average = samples.length
    ? (samples.reduce((sum, sample) => sum + sample.prioritizationFee, 0n) +
        BigInt(samples.length) -
        1n) /
      BigInt(samples.length)
    : 0n;
  const observedPrice = process.env.CU_PRICE_MICROLAMPORTS
    ? BigInt(process.env.CU_PRICE_MICROLAMPORTS)
    : average;
  const minimumPriorityFee = sender.routes.reduce(
    (max, route) =>
      route.minimumPriorityFeeLamports > max ? route.minimumPriorityFeeLamports : max,
    0n,
  );
  const tipLamports = BigInt(process.env.TIP_LAMPORTS ?? "1000000");

  let lifetime: Pick<PrepareRequest, "nonce" | "lifetime">;
  if (process.env.NONCE_ACCOUNT) {
    const nonce = await fetchNonce(rpc, address(process.env.NONCE_ACCOUNT), {
      commitment: "confirmed",
    });
    if (nonce.data.authority !== wallet.address)
      throw new Error("The configured wallet must be the nonce authority.");
    lifetime = {
      nonce: {
        account: nonce.address,
        authority: nonce.data.authority,
        value: nonce.data.blockhash,
      },
    };
  } else {
    lifetime = {
      lifetime: (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
    };
  }
  const requestAtLimit = (computeUnitLimit: number): PrepareRequest => {
    const providerFloor =
      (minimumPriorityFee * 1_000_000n + BigInt(computeUnitLimit) - 1n) /
      BigInt(computeUnitLimit);
    const fees = {
      computeUnitLimit,
      tipLamports,
      computeUnitPriceMicroLamports:
        observedPrice > providerFloor ? observedPrice : providerFloor,
    };
    return lifetime.nonce
      ? { instructions, feePayer: wallet.address, nonce: lifetime.nonce, fees }
      : { instructions, feePayer: wallet.address, lifetime: lifetime.lifetime!, fees };
  };
  // Simulate nonce advance, account setup, swap, and provider tip together. Simulation
  // does not consume a durable nonce. Do not replace its blockhash during simulation.
  const prepared = sender.client.prepare(requestAtLimit(1_400_000));
  const simulations = await Promise.all(
    prepared.variants.map(async (variant) => {
      const result = await rpc
        .simulateTransaction(getBase64EncodedWireTransaction(variant.transaction), {
          encoding: "base64",
          commitment: "confirmed",
          sigVerify: false,
        })
        .send();
      if (result.value.err) {
        throw new Error(
          `Simulation failed: ${JSON.stringify(result.value.err)}\n${result.value.logs?.join("\n") ?? ""}`,
        );
      }
      if (!result.value.unitsConsumed)
        throw new Error("RPC did not report simulated compute units");
      return Number(result.value.unitsConsumed);
    }),
  );
  // Leave 10% headroom for changing state. Refuse an estimate beyond Solana's cap.
  const computeUnitLimit = Math.ceil(Math.max(...simulations) * 1.1);
  if (computeUnitLimit > 1_400_000)
    throw new Error("Simulated buy leaves no compute headroom; reduce its size.");
  const request = requestAtLimit(computeUnitLimit);
  console.log("Fees", {
    computeUnitLimit,
    microLamportsPerCu: String(request.fees.computeUnitPriceMicroLamports),
    tipLamports: String(tipLamports),
  });
  if (simulateOnly) {
    console.log("Simulation succeeded; nothing was signed or submitted.");
    return;
  }
  const submission = await sender.client.send({ ...request, signers: [wallet] });
  // These signatures exist locally before HTTP results settle. Track them in your application.
  for (const variant of submission.variants)
    console.log("Submitted signature:", variant.signature);
  const results = await submission.results;
  for (const result of results)
    console.log("Route", result.routeId, result.status, `${result.elapsedMs}ms`);
  if (!results.some((result) => result.status === SubmissionStatus.Accepted)) {
    throw new Error(
      "No route acknowledged this buy. Check its signatures before retrying; it may still land.",
    );
  }
  console.log(
    "HTTP acceptance is not chain confirmation; check the signatures in your application.",
  );
}
