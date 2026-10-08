import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  AccountRole,
  getStructEncoder,
  getU64Encoder,
  fixEncoderSize,
  getBytesEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RAYDIUM_LAUNCHLAB_PROGRAM } from "../../constants.js";

/** Named native accounts for LaunchLab sell_exact_in; caller supplies and validates every address. */
export interface RaydiumLaunchlabSellExactInAccounts {
  readonly owner: Address;
  readonly authority: Address;
  readonly config: Address;
  readonly platform: Address;
  readonly pool: Address;
  readonly userBase: Address;
  readonly userQuote: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseTokenProgram: Address;
  readonly quoteTokenProgram: Address;
  readonly eventAuthority: Address;
  readonly platformFeeVault: Address;
  readonly creatorFeeVault: Address;
}

/** Native LaunchLab sell_exact_in arguments; token amounts use atomic bigint units. */
export interface RaydiumLaunchlabSellExactInArgs {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
}

const dataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["amountIn", getU64Encoder()],
  ["minimumAmountOut", getU64Encoder()],
  ["shareFeeRate", getU64Encoder()],
]);

/**
 * Build the native LaunchLab sell_exact_in instruction without network or signer access.
 * @remarks Data layout: 0–7 discriminator; 8–15 amountIn (u64 LE);
 * 16–23 minimumAmountOut (u64 LE); 24–31 shareFeeRate (u64 LE). Total: 32 bytes.
 * The caller validates accounts, PDAs, pool state, and slippage before signing.
 * shareFeeRate is fixed at zero. Referral/share-fee recipients are unsupported.
 * @throws Synchronously when numeric arguments exceed their codec ranges.
 */
export function getRaydiumLaunchlabSellExactInInstruction(
  accounts: RaydiumLaunchlabSellExactInAccounts,
  args: RaydiumLaunchlabSellExactInArgs,
): Instruction {
  const data = dataEncoder.encode({
    discriminator: new Uint8Array([149, 39, 222, 155, 211, 124, 152, 26]),
    amountIn: args.amountIn,
    minimumAmountOut: args.minimumAmountOut,
    shareFeeRate: 0n,
  });
  return {
    programAddress: RAYDIUM_LAUNCHLAB_PROGRAM,
    accounts: [
      { address: accounts.owner, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.authority, role: AccountRole.READONLY },
      { address: accounts.config, role: AccountRole.READONLY },
      { address: accounts.platform, role: AccountRole.READONLY },
      { address: accounts.pool, role: AccountRole.WRITABLE },
      { address: accounts.userBase, role: AccountRole.WRITABLE },
      { address: accounts.userQuote, role: AccountRole.WRITABLE },
      { address: accounts.baseVault, role: AccountRole.WRITABLE },
      { address: accounts.quoteVault, role: AccountRole.WRITABLE },
      { address: accounts.baseMint, role: AccountRole.READONLY },
      { address: accounts.quoteMint, role: AccountRole.READONLY },
      { address: accounts.baseTokenProgram, role: AccountRole.READONLY },
      { address: accounts.quoteTokenProgram, role: AccountRole.READONLY },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: RAYDIUM_LAUNCHLAB_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: accounts.platformFeeVault, role: AccountRole.WRITABLE },
      { address: accounts.creatorFeeVault, role: AccountRole.WRITABLE },
    ],
    data,
  };
}
