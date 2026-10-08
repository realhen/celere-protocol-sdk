import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type { ProtocolId, SnapshotAccount, SwapRequest } from "../../core/types.js";
import {
  LIQUID_AF_FEES_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_PYTH_RECEIVER_PROGRAM,
} from "./constants.js";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
/** Derive documented LiquidAF PDAs entirely offline. */
export function deriveLiquidAddress(
  programAddress: Address,
  seed: string,
  ...addresses: readonly Address[]
) {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [
      new TextEncoder().encode(seed),
      ...addresses.map((value) => addressEncoder.encode(value)),
    ],
  });
}
export function invalidLiquidAccount(account: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address: account, message });
}
export function unsupportedLiquidFeature(
  protocol: ProtocolId,
  feature: string,
  message: string,
): never {
  fail({ code: "UNSUPPORTED_POOL_FEATURE", protocol, feature, message });
}
export function readLiquidAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}
export function liquidAccount(
  request: SwapRequest,
  account: Address,
  owner: Address,
  discriminator: readonly number[],
  minimumLength: number,
  role: string,
): SnapshotAccount {
  const observation = requireAccount(request.snapshot, account, role, owner);
  if (
    observation.data.length < minimumLength ||
    discriminator.some((byte, index) => observation.data[index] !== byte)
  )
    invalidLiquidAccount(account, `Invalid or truncated ${role}`);
  return observation;
}
export async function liquidSharedAddresses(
  owner: Address,
  creator: Address,
  mint: Address,
  quoteMint: Address,
  amm: boolean,
) {
  const [
    [feeConfig, feeBump],
    [creatorUserProperties],
    [userProperties],
    [globalVolume],
    [tokenVolume],
    [cashbackConfig],
    [stateEventsCpiAuthority],
  ] = await Promise.all([
    deriveLiquidAddress(LIQUID_AF_FEES_PROGRAM, "fee_config", mint, quoteMint),
    deriveLiquidAddress(LIQUID_AF_STATE_PROGRAM, "user_properties", creator),
    deriveLiquidAddress(LIQUID_AF_STATE_PROGRAM, "user_properties", owner),
    deriveLiquidAddress(
      LIQUID_AF_STATE_PROGRAM,
      amm ? "global_amm_volume" : "global_curve_volume",
    ),
    deriveLiquidAddress(LIQUID_AF_STATE_PROGRAM, "token_volume", mint),
    deriveLiquidAddress(LIQUID_AF_STATE_PROGRAM, "cashback_config"),
    deriveLiquidAddress(LIQUID_AF_STATE_PROGRAM, "cpi_authority"),
  ]);
  const [feeVault] = await deriveLiquidAddress(
    LIQUID_AF_FEES_PROGRAM,
    "fee_vault",
    feeConfig,
  );
  return {
    feeConfig,
    feeBump,
    feeVault,
    creatorUserProperties,
    userProperties,
    globalVolume,
    tokenVolume,
    cashbackConfig,
    stateEventsCpiAuthority,
  };
}
export type LiquidSharedAddresses = Awaited<ReturnType<typeof liquidSharedAddresses>>;

/** Validate fee destinations and earning-mode user state; cashback never funds a quoted swap. */
export function validateLiquidSharedState(
  request: SwapRequest,
  protocol: ProtocolId,
  addresses: LiquidSharedAddresses,
  creator: Address,
  mint: Address,
  quoteMint: Address,
  amm: boolean,
): void {
  const fee = liquidAccount(
    request,
    addresses.feeConfig,
    LIQUID_AF_FEES_PROGRAM,
    [88, 134, 79, 0, 82, 145, 69, 108],
    539,
    "LiquidAF fee configuration",
  );
  if (
    fee.data.length !== 539 ||
    readLiquidAddress(fee.data, 8) !== creator ||
    readLiquidAddress(fee.data, 40) !== mint ||
    readLiquidAddress(fee.data, 72) !== quoteMint ||
    fee.data[538] !== addresses.feeBump
  )
    invalidLiquidAccount(
      fee.address,
      "LiquidAF fee configuration does not match its pool or PDA",
    );
  if (fee.data[104] !== 0)
    unsupportedLiquidFeature(
      protocol,
      "revoked-fees",
      "Only LiquidAF recipient fee mode is qualified",
    );
  const recipients = fee.data[105]!;
  if (recipients === 0 || recipients > 10)
    invalidLiquidAccount(fee.address, "Invalid LiquidAF fee-recipient count");
  const fv = new DataView(fee.data.buffer, fee.data.byteOffset, fee.data.byteLength);
  let shares = 0;
  for (let index = 0; index < recipients; index++)
    shares += fv.getUint16(138 + index * 40, true);
  if (shares !== 10_000)
    invalidLiquidAccount(
      fee.address,
      "LiquidAF creator fee shares must total 10000 basis points",
    );
  for (const account of amm
    ? [addresses.userProperties]
    : [addresses.userProperties, addresses.creatorUserProperties]) {
    const user = liquidAccount(
      request,
      account,
      LIQUID_AF_STATE_PROGRAM,
      [131, 46, 56, 35, 119, 24, 76, 66],
      119,
      "LiquidAF user properties",
    );
    if (user.data[8] === 1)
      unsupportedLiquidFeature(
        protocol,
        "referrals",
        "LiquidAF referred users and creators are not qualified",
      );
    if (
      user.data[8] !== 0 ||
      user.data[49]! > 1 ||
      user.data[118]! > 1 ||
      (user.data[118] === 1 && user.data.length < 151)
    )
      invalidLiquidAccount(account, "Invalid LiquidAF user-state option or boolean");
    if (account === addresses.userProperties && user.data[49] === 1)
      unsupportedLiquidFeature(
        protocol,
        "cashback-spending",
        "LiquidAF cashback-funded swaps are not qualified",
      );
  }
  const globalDiscriminator = amm
    ? [248, 251, 192, 145, 91, 181, 97, 143]
    : [50, 23, 212, 197, 184, 191, 247, 112];
  liquidAccount(
    request,
    addresses.globalVolume,
    LIQUID_AF_STATE_PROGRAM,
    globalDiscriminator,
    40,
    "LiquidAF global volume",
  );
  const volume = liquidAccount(
    request,
    addresses.tokenVolume,
    LIQUID_AF_STATE_PROGRAM,
    [255, 176, 53, 212, 121, 72, 64, 57],
    104,
    "LiquidAF token volume",
  );
  if (readLiquidAddress(volume.data, 8) !== mint)
    invalidLiquidAccount(volume.address, "LiquidAF volume mint does not match the pool");
  const cashback = liquidAccount(
    request,
    addresses.cashbackConfig,
    LIQUID_AF_STATE_PROGRAM,
    [85, 221, 143, 214, 41, 44, 50, 22],
    47,
    "LiquidAF cashback configuration",
  );
  const cv = new DataView(
    cashback.data.buffer,
    cashback.data.byteOffset,
    cashback.data.byteLength,
  );
  const ranges = cv.getUint32(40, true);
  const end = 44 + ranges * 18;
  if (ranges === 0 || end + 3 > cashback.data.length || cv.getUint16(end, true) > 10_000)
    invalidLiquidAccount(cashback.address, "Invalid LiquidAF cashback ranges or rate");
  let previousEnd = 0n;
  for (let index = 0; index < ranges; index++) {
    const start = cv.getBigUint64(44 + index * 18, true);
    const finish = cv.getBigUint64(52 + index * 18, true);
    if (start !== previousEnd || finish <= start)
      invalidLiquidAccount(
        cashback.address,
        "LiquidAF cashback ranges must be contiguous and increasing",
      );
    previousEnd = finish;
  }
  const pending = cashback.data[end + 2];
  if (pending !== 0 && (pending !== 1 || end + 35 > cashback.data.length))
    invalidLiquidAccount(
      cashback.address,
      "Invalid LiquidAF cashback pending-admin option",
    );
}

/** Validate fully verified SOL/USD Pyth data and return USD with six decimal places. */
export function readLiquidSolPrice(request: SwapRequest, account: Address): bigint {
  const oracle = liquidAccount(
    request,
    account,
    LIQUID_AF_PYTH_RECEIVER_PROGRAM,
    [34, 241, 35, 99, 157, 126, 244, 205],
    133,
    "Pyth PriceUpdateV2",
  );
  const feed = [
    239, 13, 139, 111, 218, 44, 235, 164, 29, 161, 93, 64, 149, 209, 218, 57, 42, 13, 47,
    142, 208, 198, 199, 188, 15, 76, 250, 200, 194, 128, 181, 109,
  ];
  if (
    oracle.data[40] !== 1 ||
    feed.some((byte, index) => oracle.data[41 + index] !== byte)
  )
    invalidLiquidAccount(
      account,
      "LiquidAF requires a fully verified SOL/USD Pyth price",
    );
  const view = new DataView(
    oracle.data.buffer,
    oracle.data.byteOffset,
    oracle.data.byteLength,
  );
  const price = view.getBigInt64(73, true);
  const publishedAt = view.getBigInt64(93, true);
  if (
    view.getInt32(89, true) !== -8 ||
    price <= 0n ||
    view.getBigUint64(81, true) >= price ||
    publishedAt < 0n ||
    publishedAt > request.snapshot.unixTimestamp ||
    request.snapshot.unixTimestamp - publishedAt > 30n
  )
    invalidLiquidAccount(
      account,
      "LiquidAF requires a positive SOL/USD price with exponent -8 and age at most 30 seconds",
    );
  return price / 100n;
}
