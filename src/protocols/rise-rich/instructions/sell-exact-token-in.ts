import {
  AccountRole,
  fixEncoderSize,
  getBytesEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { RISE_RICH_PROGRAM } from "../constants.js";
const DISCRIMINATOR = new Uint8Array([27, 141, 98, 109, 197, 168, 104, 84]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["tokenIn", getU64Encoder()],
  ["minCashOut", getU64Encoder()],
]);

/** Ordered native `sell_with_exact_token_in` account addresses. */
export interface RiseRichSellExactTokenInAccounts {
  readonly seller: Address;
  readonly tenant: Address;
  readonly market: Address;
  readonly cashEscrow: Address;
  readonly mayTenant: Address;
  readonly mayMarketGroup: Address;
  readonly marketMeta: Address;
  readonly mayMarket: Address;
  readonly mintToken: Address;
  readonly mintMain: Address;
  readonly tokenSrc: Address;
  readonly mainDst: Address;
  readonly liqVaultMain: Address;
  readonly revEscrowGroup: Address;
  readonly revEscrowTenant: Address;
  readonly tokenProgramMain: Address;
  readonly tokenProgram: Address;
  readonly mayflowerProgram: Address;
  readonly mayLogAccount: Address;
  readonly creatorEscrow: Address;
  readonly teamEscrow: Address;
  readonly eventAuthority: Address;
  readonly program: Address;
}

/** Atomic native token input and minimum collateral output amounts. */
export interface RiseRichSellExactTokenInArgs {
  readonly tokenIn: bigint;
  readonly minCashOut: bigint;
}

/**
 * Build native `sell_with_exact_token_in` without validating caller state.
 * @remarks Bytes 0–7 contain the discriminator.
 * - Bytes 8–15: `tokenIn` (u64 LE).
 * - Bytes 16–23: `minCashOut` (u64 LE).
 * Total data length: 24 bytes. The caller validates account identities, state, arithmetic and limits.
 * @throws Synchronous codec errors for unencodable arguments.
 */
export function getRiseRichSellExactTokenInInstruction(
  accounts: RiseRichSellExactTokenInAccounts,
  args: RiseRichSellExactTokenInArgs,
): Instruction {
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    tokenIn: args.tokenIn,
    minCashOut: args.minCashOut,
  });
  return {
    programAddress: RISE_RICH_PROGRAM,
    accounts: [
      { address: accounts.seller, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tenant, role: AccountRole.WRITABLE },
      { address: accounts.market, role: AccountRole.WRITABLE },
      { address: accounts.cashEscrow, role: AccountRole.WRITABLE },
      { address: accounts.mayTenant, role: AccountRole.READONLY },
      { address: accounts.mayMarketGroup, role: AccountRole.READONLY },
      { address: accounts.marketMeta, role: AccountRole.READONLY },
      { address: accounts.mayMarket, role: AccountRole.WRITABLE },
      { address: accounts.mintToken, role: AccountRole.WRITABLE },
      { address: accounts.mintMain, role: AccountRole.READONLY },
      { address: accounts.tokenSrc, role: AccountRole.WRITABLE },
      { address: accounts.mainDst, role: AccountRole.WRITABLE },
      { address: accounts.liqVaultMain, role: AccountRole.WRITABLE },
      { address: accounts.revEscrowGroup, role: AccountRole.WRITABLE },
      { address: accounts.revEscrowTenant, role: AccountRole.WRITABLE },
      { address: accounts.tokenProgramMain, role: AccountRole.READONLY },
      { address: accounts.tokenProgram, role: AccountRole.READONLY },
      { address: accounts.mayflowerProgram, role: AccountRole.READONLY },
      { address: accounts.mayLogAccount, role: AccountRole.WRITABLE },
      { address: accounts.creatorEscrow, role: AccountRole.WRITABLE },
      { address: accounts.teamEscrow, role: AccountRole.WRITABLE },
      { address: accounts.eventAuthority, role: AccountRole.READONLY },
      { address: accounts.program, role: AccountRole.READONLY },
    ],
    data,
  };
}
