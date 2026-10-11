import { setTimeout as delay } from "node:timers/promises";
import {
  address,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransaction,
} from "@solana/kit";
import type { Address, KeyPairSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { compileTransaction } from "celere-protocol-sdk";
import { unwrap, type Rpc } from "./rpc";

const wrappedSolMint = address("So11111111111111111111111111111111111111112");

/**
 * Fund the wallet's WSOL ATA before the SDK observes its input token account.
 * This is a separate transaction; a failed buy leaves WSOL available to the wallet.
 * Other input mints must already have a funded ATA. No existing account is closed.
 */
export async function ensureWrappedSol(
  rpc: Rpc,
  wallet: KeyPairSigner,
  inputMint: Address,
  amountIn: bigint,
  simulateOnly: boolean,
): Promise<void> {
  if (inputMint !== wrappedSolMint) return;
  const [ata] = await findAssociatedTokenPda({
    owner: wallet.address,
    mint: wrappedSolMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const account = await fetchMaybeToken(rpc, ata, { commitment: "confirmed" });
  const balance = account.exists ? account.data.amount : 0n;
  if (balance >= amountIn) return;
  if (simulateOnly)
    throw new Error(
      "Fund your WSOL ATA before simulation, or run npm start to wrap the missing SOL and buy.",
    );
  const topUp = amountIn - balance;
  const instructions = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: wallet,
      ata,
      owner: wallet.address,
      mint: wrappedSolMint,
    }),
    getTransferSolInstruction({ source: wallet, destination: ata, amount: topUp }),
    getSyncNativeInstruction({ account: ata }),
  ];
  const lifetime = (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send())
    .value;
  const compiled = unwrap(
    compileTransaction({
      instructions,
      feePayer: wallet.address,
      lifetime,
      computeBudget: { units: 100_000 },
    }),
  );
  const signed = await signTransaction([wallet.keyPair], compiled.transaction);
  const signature = getSignatureFromTransaction(signed);
  console.log("WSOL funding signature:", signature);
  try {
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 0n,
      })
      .send();
  } catch {
    // A lost HTTP response cannot prove that this funding transaction was rejected.
    throw new Error(
      `WSOL funding was not acknowledged. Check ${signature} before running again.`,
    );
  }
  // Only this prerequisite is confirmed here: the buy must observe its resulting balance.
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = (await rpc.getSignatureStatuses([signature]).send()).value[0];
    if (status?.err)
      throw new Error(`WSOL funding failed: ${JSON.stringify(status.err)}`);
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return;
    await delay(500);
  }
  throw new Error(
    `WSOL funding is still unconfirmed. Check ${signature} before running again.`,
  );
}
