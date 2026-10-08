import { isAddress } from "@solana/kit";
import type { Address } from "@solana/kit";

/** Validate untyped JavaScript inputs before calling Kit's string-only address guard. */
export function isValidAddress(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}
