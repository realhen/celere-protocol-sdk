import { getAddressDecoder, type Address } from "@solana/kit";
import { fail } from "../../core/errors";

const addressDecoder = getAddressDecoder();

/** Reject a caller-supplied account with the protocol decoder's specific failure reason. */
export function invalidAccount(address: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address, message });
}

/**
 * View exactly the supplied account bytes, including snapshots backed by a subarray.
 * Protocol decoders remain responsible for validating the account owner and layout
 * before reading fields. These helpers do not fetch accounts or interpret schemas.
 */
export function accountDataView(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Read a 32-byte Solana address at a byte offset in validated account data. */
export function readAddress(data: Uint8Array, offset: number): Address {
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

/** Read an unsigned little-endian 64-bit field from validated account data. */
export function readU64(data: Uint8Array, offset: number): bigint {
  return accountDataView(data).getBigUint64(offset, true);
}

/** Read an unsigned little-endian 128-bit field, reusing the decoder's account view. */
export function readU128(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true) | (view.getBigUint64(offset + 8, true) << 64n);
}

/** Compare the leading account bytes; size and version checks belong to the protocol. */
export function matchesDiscriminator(
  data: Uint8Array,
  expected: readonly number[] | Uint8Array,
): boolean {
  return expected.every((byte, index) => data[index] === byte);
}
