import type { Instruction, TransactionPartialSigner } from "@solana/kit";
import type { DurableNonce } from "celere-protocol-sdk/transactions";
import {
  SenderClient,
  AstralaneSender,
  BlockRazorSender,
  ZeroSlotSender,
  NextBlockSender,
  HeliusSender,
  Region,
  SenderProvider,
} from "celere-protocol-sdk/sender";

/** Call once with your own endpoints and credentials. Construction does no I/O. */
export function configureSender(config: {
  rpcUrl: string;
  astralaneKey: string;
  blockRazorKey: string;
  zeroSlotKey: string;
  nextBlockKey: string;
  heliusKey: string;
}) {
  return new SenderClient({
    defaultRpc: { url: config.rpcUrl },
    routes: [
      new AstralaneSender({ apiKey: config.astralaneKey, region: Region.Frankfurt }),
      new AstralaneSender({ apiKey: config.astralaneKey, region: Region.NewYork }),
      new BlockRazorSender({ apiKey: config.blockRazorKey, region: Region.Frankfurt }),
      new ZeroSlotSender({ apiKey: config.zeroSlotKey, region: Region.Frankfurt }),
      new NextBlockSender({ apiKey: config.nextBlockKey, region: Region.Frankfurt }),
      new HeliusSender({ apiKey: config.heliusKey, region: Region.Frankfurt }),
    ],
  });
}

/** Instructions can come from any native protocol builder, or any Kit-compatible source. */
export async function sendTrade(
  sender: ReturnType<typeof configureSender>,
  instructions: readonly Instruction[],
  wallet: TransactionPartialSigner,
  nonce: DurableNonce,
  nonceAuthority: TransactionPartialSigner = wallet,
) {
  // The caller supplies a current nonce exclusively selected for this logical trade.
  // Do not select the same nonce snapshot for another independent trade.
  const submission = await sender.send({
    instructions,
    feePayer: wallet.address,
    signers:
      nonceAuthority.address === wallet.address ? [wallet] : [wallet, nonceAuthority],
    nonce,
    fees: {
      // Example values: select a CU limit for the complete transaction and current fee conditions.
      computeUnitLimit: 200_000,
      computeUnitPriceMicroLamports: 50_000n,
      tipLamports: 1_000_000n,
      tipOverrides: {
        [SenderProvider.BlockRazor]: 100_000n,
        [SenderProvider.NextBlock]: 100_000n,
      },
    },
  });
  // All routes have been launched. The caller can immediately track these local signatures.
  // Await submission.results only when the application's transport reporting needs them.
  return submission;
}
