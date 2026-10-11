import type { Address } from "@solana/kit";
import type { AccountRequirement, ProtocolId } from "./types";

/** Stable error codes shared by native protocol builders. */
export enum ProtocolErrorCode {
  MissingAccounts = "MISSING_ACCOUNTS",
  InvalidAccount = "INVALID_ACCOUNT",
  InvalidSnapshotContext = "INVALID_SNAPSHOT_CONTEXT",
  UnsupportedProtocol = "UNSUPPORTED_PROTOCOL",
  UnsupportedPoolFeature = "UNSUPPORTED_POOL_FEATURE",
  UnsupportedSwapMode = "UNSUPPORTED_SWAP_MODE",
  UnsupportedTokenExtension = "UNSUPPORTED_TOKEN_EXTENSION",
  InsufficientLiquidity = "INSUFFICIENT_LIQUIDITY",
  UnsupportedFillPolicy = "UNSUPPORTED_FILL_POLICY",
}

/** Base class for expected protocol construction failures. No network operation is implied. */
export abstract class ProtocolError<
  TCode extends ProtocolErrorCode = ProtocolErrorCode,
> extends Error {
  protected constructor(
    readonly code: TCode,
    message: string,
  ) {
    super(message);
  }
}

/** The supplied snapshot is missing observations required to build the swap. */
export class MissingAccountsError extends ProtocolError<ProtocolErrorCode.MissingAccounts> {
  /** Unknown accounts that the application must obtain before retrying. */
  readonly accounts: readonly AccountRequirement[];

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: {
    readonly message: string;
    readonly accounts: readonly AccountRequirement[];
  }) {
    super(ProtocolErrorCode.MissingAccounts, options.message);
    this.name = "MissingAccountsError";
    this.accounts = options.accounts;
  }
}

/** An observed account has an invalid identity, owner, layout, or state. */
export class InvalidAccountError extends ProtocolError<ProtocolErrorCode.InvalidAccount> {
  /** Address of the invalid observed account. */
  readonly address: Address;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: { readonly message: string; readonly address: Address }) {
    super(ProtocolErrorCode.InvalidAccount, options.message);
    this.name = "InvalidAccountError";
    this.address = options.address;
  }
}

/** Snapshot chain metadata or observation freshness is invalid. */
export class InvalidSnapshotContextError extends ProtocolError<ProtocolErrorCode.InvalidSnapshotContext> {
  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: { readonly message: string }) {
    super(ProtocolErrorCode.InvalidSnapshotContext, options.message);
    this.name = "InvalidSnapshotContextError";
  }
}

/** No registered adapter supports the observed pool program. */
export class UnsupportedProtocolError extends ProtocolError<ProtocolErrorCode.UnsupportedProtocol> {
  /** Pool owner for which no supported adapter was found. */
  readonly programAddress: Address;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: { readonly message: string; readonly programAddress: Address }) {
    super(ProtocolErrorCode.UnsupportedProtocol, options.message);
    this.name = "UnsupportedProtocolError";
    this.programAddress = options.programAddress;
  }
}

/** The selected protocol state requires an unsupported feature. */
export class UnsupportedPoolFeatureError extends ProtocolError<ProtocolErrorCode.UnsupportedPoolFeature> {
  /** Native protocol that rejected the feature. */
  readonly protocol: ProtocolId;
  /** Protocol-specific feature that prevents construction. */
  readonly feature: string;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: {
    readonly message: string;
    readonly protocol: ProtocolId;
    readonly feature: string;
  }) {
    super(ProtocolErrorCode.UnsupportedPoolFeature, options.message);
    this.name = "UnsupportedPoolFeatureError";
    this.protocol = options.protocol;
    this.feature = options.feature;
  }
}

/** The protocol has no supported native instruction for the requested amount mode. */
export class UnsupportedSwapModeError extends ProtocolError<ProtocolErrorCode.UnsupportedSwapMode> {
  /** Native protocol that rejected the mode. */
  readonly protocol: ProtocolId;
  /** Requested native amount mode. */
  readonly mode: "exactIn" | "exactOut";

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: {
    readonly message: string;
    readonly protocol: ProtocolId;
    readonly mode: "exactIn" | "exactOut";
  }) {
    super(ProtocolErrorCode.UnsupportedSwapMode, options.message);
    this.name = "UnsupportedSwapModeError";
    this.protocol = options.protocol;
    this.mode = options.mode;
  }
}

/** A mint extension is not supported by the requested swap. */
export class UnsupportedTokenExtensionError extends ProtocolError<ProtocolErrorCode.UnsupportedTokenExtension> {
  /** Mint containing the unsupported extension. */
  readonly mint: Address;
  /** Name of the extension that prevents construction. */
  readonly extension: string;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: {
    readonly message: string;
    readonly mint: Address;
    readonly extension: string;
  }) {
    super(ProtocolErrorCode.UnsupportedTokenExtension, options.message);
    this.name = "UnsupportedTokenExtensionError";
    this.mint = options.mint;
    this.extension = options.extension;
  }
}

/** The requested swap exceeds usable liquidity or rounds to zero output. */
export class InsufficientLiquidityError extends ProtocolError<ProtocolErrorCode.InsufficientLiquidity> {
  /** Native protocol whose liquidity is insufficient. */
  readonly protocol: ProtocolId;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: { readonly message: string; readonly protocol: ProtocolId }) {
    super(ProtocolErrorCode.InsufficientLiquidity, options.message);
    this.name = "InsufficientLiquidityError";
    this.protocol = options.protocol;
  }
}

/** The native instruction cannot satisfy the requested fill guarantee. */
export class UnsupportedFillPolicyError extends ProtocolError<ProtocolErrorCode.UnsupportedFillPolicy> {
  /** Native protocol that cannot satisfy the fill policy. */
  readonly protocol: ProtocolId;

  /** @param options - Failure context and the protocol-specific explanation. */
  constructor(options: { readonly message: string; readonly protocol: ProtocolId }) {
    super(ProtocolErrorCode.UnsupportedFillPolicy, options.message);
    this.name = "UnsupportedFillPolicyError";
    this.protocol = options.protocol;
  }
}
