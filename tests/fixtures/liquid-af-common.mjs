import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  LIQUID_AF_FEES_PROGRAM,
  LIQUID_AF_STATE_PROGRAM,
  LIQUID_AF_PYTH_RECEIVER_PROGRAM,
} from "../../dist/protocols/liquid-af/constants.js";
export const WSOL = address("So11111111111111111111111111111111111111112");
export const PYTH_PRICE_FEED = address("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const encoder = getAddressEncoder();
const decoder = getAddressDecoder();
export function key(label) {
  return decoder.decode(
    createHash("sha256").update(`celere-liquid-af:${label}`).digest(),
  );
}
export function discriminator(name) {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}
export function tokenData(mint, authority, amount) {
  const data = new Uint8Array(165);
  data.set(encoder.encode(mint));
  data.set(encoder.encode(authority), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  return data;
}
export function mintData(supply, decimals = 6) {
  const data = new Uint8Array(82);
  new DataView(data.buffer).setBigUint64(36, supply, true);
  data[44] = decimals;
  data[45] = 1;
  return data;
}
export function derive(programAddress, seed, ...addresses) {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode(seed), ...addresses.map((a) => encoder.encode(a))],
  });
}
/** Shared synthetic state; no live user data or signing keys are retained. */
export async function liquidAfSharedFixture({
  owner,
  creator,
  mint,
  quoteMint,
  unixTimestamp,
  amm = false,
  cashbackBps = 0,
}) {
  const [feeConfig, feeBump] = await derive(
    LIQUID_AF_FEES_PROGRAM,
    "fee_config",
    mint,
    quoteMint,
  );
  const [feeVault] = await derive(LIQUID_AF_FEES_PROGRAM, "fee_vault", feeConfig);
  const [creatorUserProperties] = await derive(
    LIQUID_AF_STATE_PROGRAM,
    "user_properties",
    creator,
  );
  const [userProperties] = await derive(
    LIQUID_AF_STATE_PROGRAM,
    "user_properties",
    owner,
  );
  const [globalVolume] = await derive(
    LIQUID_AF_STATE_PROGRAM,
    amm ? "global_amm_volume" : "global_curve_volume",
  );
  const [tokenVolume] = await derive(LIQUID_AF_STATE_PROGRAM, "token_volume", mint);
  const [cashbackConfig] = await derive(LIQUID_AF_STATE_PROGRAM, "cashback_config");
  const [stateEventsCpiAuthority] = await derive(
    LIQUID_AF_STATE_PROGRAM,
    "cpi_authority",
  );
  const accounts = {};
  function add(address, owner, data, lamports = 100_000_000n) {
    accounts[address] = { address, owner, data, lamports, executable: false, slot: 100n };
  }
  const config = new Uint8Array(539);
  config.set(discriminator("UnifiedFeeConfiguration"));
  config.set(encoder.encode(creator), 8);
  config.set(encoder.encode(mint), 40);
  config.set(encoder.encode(quoteMint), 72);
  config[104] = 0;
  config[105] = 1;
  config.set(encoder.encode(creator), 106);
  new DataView(config.buffer).setUint16(138, 10_000, true);
  config.set(encoder.encode(creator), 506);
  config[538] = feeBump;
  add(feeConfig, LIQUID_AF_FEES_PROGRAM, config);
  for (const account of [creatorUserProperties, userProperties]) {
    const data = new Uint8Array(256);
    data.set(discriminator("UserProperties"));
    add(account, LIQUID_AF_STATE_PROGRAM, data);
  }
  const globalData = new Uint8Array(40);
  globalData.set(
    discriminator(amm ? "GlobalAmmVolumeAccumulator" : "GlobalCurveVolumeAccumulator"),
  );
  add(globalVolume, LIQUID_AF_STATE_PROGRAM, globalData);
  const tokenVolumeData = new Uint8Array(104);
  tokenVolumeData.set(discriminator("TokenVolumeAccumulator"));
  tokenVolumeData.set(encoder.encode(mint), 8);
  add(tokenVolume, LIQUID_AF_STATE_PROGRAM, tokenVolumeData);
  const cashback = new Uint8Array(128);
  cashback.set(discriminator("CashbackConfiguration"));
  cashback.set(encoder.encode(creator), 8);
  const cv = new DataView(cashback.buffer);
  cv.setUint32(40, 1, true);
  cv.setBigUint64(52, (1n << 64n) - 1n, true);
  cv.setUint16(60, 10_000, true);
  cv.setUint16(62, cashbackBps, true);
  add(cashbackConfig, LIQUID_AF_STATE_PROGRAM, cashback);
  const oracle = new Uint8Array(134);
  oracle.set(discriminator("PriceUpdateV2"));
  oracle.set(encoder.encode(creator), 8);
  oracle[40] = 1;
  oracle.set(
    Buffer.from(
      "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
      "hex",
    ),
    41,
  );
  const ov = new DataView(oracle.buffer);
  ov.setBigInt64(73, 15_000_000_000n, true);
  ov.setBigUint64(81, 1_000_000n, true);
  ov.setInt32(89, -8, true);
  ov.setBigInt64(93, unixTimestamp, true);
  ov.setBigInt64(101, unixTimestamp - 1n, true);
  ov.setBigInt64(109, 15_000_000_000n, true);
  ov.setBigUint64(117, 1_000_000n, true);
  ov.setBigUint64(125, 100n, true);
  add(PYTH_PRICE_FEED, LIQUID_AF_PYTH_RECEIVER_PROGRAM, oracle);
  add(feeVault, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  add(stateEventsCpiAuthority, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  return {
    accounts,
    add,
    feeConfig,
    feeVault,
    creatorUserProperties,
    userProperties,
    globalVolume,
    tokenVolume,
    cashbackConfig,
    stateEventsCpiAuthority,
  };
}
export { TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS };
