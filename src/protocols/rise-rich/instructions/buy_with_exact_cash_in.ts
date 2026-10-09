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
const DISCRIMINATOR = new Uint8Array([53, 248, 95, 20, 54, 162, 146, 247]);
const instructionDataEncoder = getStructEncoder([
  ["discriminator", fixEncoderSize(getBytesEncoder(), 8)],
  ["cashIn", getU64Encoder()],
  ["minTokenOut", getU64Encoder()],
  ["newShoulderEnd", getU64Encoder()],
  ["floorIncreaseRatio", fixEncoderSize(getBytesEncoder(), 16)],
  ["maxNewFloor", fixEncoderSize(getBytesEncoder(), 16)],
  ["maxAreaShrinkageToleranceUnits", getU64Encoder()],
  ["minLiqRatio", fixEncoderSize(getBytesEncoder(), 16)],
]);

/** Ordered native `buy_with_exact_cash_in` account addresses. */
export interface RiseRichBuyExactCashInAccounts {
  readonly buyer: Address;
  readonly tenant: Address;
  readonly market: Address;
  readonly cashEscrow: Address;
  readonly mayTenant: Address;
  readonly mayMarketGroup: Address;
  readonly marketMeta: Address;
  readonly mayMarket: Address;
  readonly tenantSeed: Address;
  readonly mintToken: Address;
  readonly mintMain: Address;
  readonly tokenDst: Address;
  readonly mainSrc: Address;
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

/** Atomic native amounts and raw control fields. Decimal byte arrays must contain exactly 16 bytes. */
export interface RiseRichBuyExactCashInArgs {
  readonly cashIn: bigint;
  readonly minTokenOut: bigint;
  readonly newShoulderEnd: bigint;
  readonly floorIncreaseRatio: Uint8Array;
  readonly maxNewFloor: Uint8Array;
  readonly maxAreaShrinkageToleranceUnits: bigint;
  readonly minLiqRatio: Uint8Array;
}

/**
 * Build native `buy_with_exact_cash_in` without validating caller state.
 * @remarks Bytes 0–7 contain the discriminator.
 * - Bytes 8–15: `cashIn` (u64 LE).
 * - Bytes 16–23: `minTokenOut` (u64 LE).
 * - Bytes 24–31: `newShoulderEnd` (u64 LE).
 * - Bytes 32–47: `floorIncreaseRatio` (serialized Rust Decimal).
 * - Bytes 48–63: `maxNewFloor` (serialized Rust Decimal).
 * - Bytes 64–71: `maxAreaShrinkageToleranceUnits` (u64 LE).
 * - Bytes 72–87: `minLiqRatio` (serialized Rust Decimal).
 * Total data length: 88 bytes. The caller validates account identities, state, arithmetic and limits.
 * @throws RangeError for Decimal fields that are not exactly 16 bytes; synchronous codec errors for other unencodable arguments.
 */
export function buy_with_exact_cash_in(
  accounts: RiseRichBuyExactCashInAccounts,
  args: RiseRichBuyExactCashInArgs,
): Instruction {
  if (args.floorIncreaseRatio.length !== 16)
    throw new RangeError("floorIncreaseRatio must contain exactly 16 bytes");
  if (args.maxNewFloor.length !== 16)
    throw new RangeError("maxNewFloor must contain exactly 16 bytes");
  if (args.minLiqRatio.length !== 16)
    throw new RangeError("minLiqRatio must contain exactly 16 bytes");
  const data = instructionDataEncoder.encode({
    discriminator: DISCRIMINATOR,
    cashIn: args.cashIn,
    minTokenOut: args.minTokenOut,
    newShoulderEnd: args.newShoulderEnd,
    floorIncreaseRatio: args.floorIncreaseRatio,
    maxNewFloor: args.maxNewFloor,
    maxAreaShrinkageToleranceUnits: args.maxAreaShrinkageToleranceUnits,
    minLiqRatio: args.minLiqRatio,
  });
  return {
    programAddress: RISE_RICH_PROGRAM,
    accounts: [
      { address: accounts.buyer, role: AccountRole.WRITABLE_SIGNER },
      { address: accounts.tenant, role: AccountRole.WRITABLE },
      { address: accounts.market, role: AccountRole.WRITABLE },
      { address: accounts.cashEscrow, role: AccountRole.WRITABLE },
      { address: accounts.mayTenant, role: AccountRole.READONLY },
      { address: accounts.mayMarketGroup, role: AccountRole.READONLY },
      { address: accounts.marketMeta, role: AccountRole.READONLY },
      { address: accounts.mayMarket, role: AccountRole.WRITABLE },
      { address: accounts.tenantSeed, role: AccountRole.READONLY },
      { address: accounts.mintToken, role: AccountRole.WRITABLE },
      { address: accounts.mintMain, role: AccountRole.READONLY },
      { address: accounts.tokenDst, role: AccountRole.WRITABLE },
      { address: accounts.mainSrc, role: AccountRole.WRITABLE },
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
