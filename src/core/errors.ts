import type { Address } from "@solana/kit";
import type { AccountRequirement, ProtocolId } from "./types.js";

/** Expected failures are stable discriminated values, suitable for worker messages. */
export type BuildError =
  | { readonly code: "INVALID_REQUEST"; readonly message: string; readonly field: string }
  | {
      readonly code: "MISSING_ACCOUNTS";
      readonly message: string;
      readonly accounts: readonly AccountRequirement[];
    }
  | {
      readonly code: "INVALID_ACCOUNT";
      readonly message: string;
      readonly address: Address;
    }
  | { readonly code: "INVALID_SNAPSHOT_CONTEXT"; readonly message: string }
  | {
      readonly code: "UNSUPPORTED_PROTOCOL";
      readonly message: string;
      readonly programAddress: Address;
    }
  | {
      readonly code: "UNSUPPORTED_POOL_FEATURE";
      readonly message: string;
      readonly protocol: ProtocolId;
      readonly feature: string;
    }
  | {
      readonly code: "UNSUPPORTED_SWAP_MODE";
      readonly message: string;
      readonly protocol: ProtocolId;
      readonly mode: "exactIn" | "exactOut";
    }
  | {
      readonly code: "UNSUPPORTED_TOKEN_EXTENSION";
      readonly message: string;
      readonly mint: Address;
      readonly extension: string;
    }
  | {
      readonly code: "INSUFFICIENT_LIQUIDITY";
      readonly message: string;
      readonly protocol: ProtocolId;
    }
  | {
      readonly code: "UNSUPPORTED_FILL_POLICY";
      readonly message: string;
      readonly protocol: ProtocolId;
    }
  | {
      readonly code: "TRANSACTION_TOO_LARGE";
      readonly message: string;
      readonly size: number;
      readonly limit: number;
    }
  | { readonly code: "INTERNAL_ERROR"; readonly message: string };

/** Public APIs return expected errors; no message matching is required. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BuildError };

/** Internal control-flow error, converted into a portable Result at the public boundary. */
export class BuildFailure extends Error {
  constructor(readonly detail: BuildError) {
    super(detail.message);
    this.name = "BuildFailure";
  }
}

/** Raise an expected internal failure without erasing its structured details. */
export function fail(error: BuildError): never {
  throw new BuildFailure(error);
}

/** Convert implementation failures into the documented public error boundary. */
export function failureResult(error: unknown): Result<never> {
  return {
    ok: false,
    error:
      error instanceof BuildFailure
        ? error.detail
        : { code: "INTERNAL_ERROR", message: "Unexpected protocol construction failure" },
  };
}
