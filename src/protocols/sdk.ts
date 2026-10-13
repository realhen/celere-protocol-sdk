import {
  InvalidSnapshotContextError,
  InvalidAccountError,
  UnsupportedProtocolError,
  MissingAccountsError,
  UnsupportedFillPolicyError,
} from "./errors";
import { InvalidRequestError } from "../shared/errors";
import { isValidAddress as isAddress } from "../shared/addresses";
import { AccountRole } from "@solana/kit";
import type { Address } from "@solana/kit";
import { planTokenAccounts, tokenRequirements } from "./accounts/plan";
import { assertAmount, basisPoints } from "./amounts";
import { missingAccounts, requireAccount } from "./accounts/snapshot";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolId,
  SwapBuild,
  SwapRequest,
} from "./types";

/** Discovery can need multiple rounds as newly supplied state reveals dependencies. */
export interface SwapRequirements {
  readonly protocol: ProtocolId | null;
  readonly accounts: readonly AccountRequirement[];
  readonly missing: readonly AccountRequirement[];
  readonly complete: boolean;
}

/** Validate caller intent and immutable observation metadata without performing I/O. */
export function validateRequest(request: SwapRequest): void {
  if (request === null || typeof request !== "object") {
    throw new InvalidRequestError({
      message: "A swap request object is required",
      field: "request",
    });
  }
  for (const field of ["pool", "owner", "payer", "inputMint", "outputMint"] as const) {
    if (!isAddress(request[field])) {
      throw new InvalidRequestError({
        message: "Expected a valid Solana address",
        field,
      });
    }
  }
  if (request.inputMint === request.outputMint) {
    throw new InvalidRequestError({
      message: "Input and output mints must differ",
      field: "outputMint",
    });
  }
  if (request.amount?.kind === "exactIn") {
    assertAmount(request.amount.amountIn, "amountIn");
  } else if (request.amount?.kind === "exactOut") {
    assertAmount(request.amount.amountOut, "amountOut");
  } else {
    throw new InvalidRequestError({
      message: "Unknown swap amount mode",
      field: "amount.kind",
    });
  }
  basisPoints(request.slippageBps);
  if (
    request.fillPolicy !== undefined &&
    request.fillPolicy !== "requireFull" &&
    request.fillPolicy !== "allowPartial"
  ) {
    throw new InvalidRequestError({
      message: "Unknown fill policy",
      field: "fillPolicy",
    });
  }
  if (request.tokenAccounts) {
    for (const field of ["input", "output"] as const) {
      if (!isAddress(request.tokenAccounts[field])) {
        throw new InvalidRequestError({
          message: "Invalid token account address",
          field: `tokenAccounts.${field}`,
        });
      }
    }
  }
  if (
    request.maxAccountAgeSlots !== undefined &&
    (typeof request.maxAccountAgeSlots !== "bigint" || request.maxAccountAgeSlots < 0n)
  ) {
    throw new InvalidRequestError({
      message: "Account age must be a nonnegative bigint",
      field: "maxAccountAgeSlots",
    });
  }
  const snapshot = request.snapshot;
  for (const field of ["slot", "epoch", "unixTimestamp"] as const) {
    if (typeof snapshot?.[field] !== "bigint" || snapshot[field] < 0n) {
      throw new InvalidSnapshotContextError({
        message: `A nonnegative chain ${field} is required`,
      });
    }
  }
  if (!snapshot.accounts || typeof snapshot.accounts !== "object") {
    throw new InvalidSnapshotContextError({
      message: "An account observation map is required",
    });
  }
  for (const [key, account] of Object.entries(snapshot.accounts)) {
    if (!isAddress(key)) {
      throw new InvalidRequestError({
        message: "Invalid snapshot map address",
        field: "snapshot.accounts",
      });
    }
    if (account === null || account === undefined) {
      continue;
    }
    if (
      account.address !== key ||
      !isAddress(account.owner) ||
      !(account.data instanceof Uint8Array) ||
      typeof account.lamports !== "bigint" ||
      account.lamports < 0n ||
      typeof account.executable !== "boolean"
    ) {
      throw new InvalidAccountError({
        address: key,
        message: "Malformed account observation",
      });
    }
    if (
      typeof account.slot !== "bigint" ||
      account.slot < 0n ||
      account.slot > snapshot.slot ||
      (request.maxAccountAgeSlots !== undefined &&
        snapshot.slot - account.slot > request.maxAccountAgeSlots)
    ) {
      throw new InvalidSnapshotContextError({
        message:
          "Account observation is future-dated or older than the supplied age policy",
      });
    }
  }
}

function selectAdapter(
  request: SwapRequest,
  adapters: readonly ProtocolAdapter[],
): ProtocolAdapter {
  const pool = requireAccount(request.snapshot, request.pool, "pool");
  const adapter = adapters.find((candidate) =>
    candidate.programAddresses.includes(pool.owner),
  );
  if (!adapter) {
    throw new UnsupportedProtocolError({
      message: "No native adapter is registered for this pool owner",
      programAddress: pool.owner,
    });
  }
  return adapter;
}

function uniqueRequirements(
  requirements: readonly AccountRequirement[],
): readonly AccountRequirement[] {
  return [
    ...new Map(
      requirements.map((requirement) => [requirement.address, requirement]),
    ).values(),
  ];
}

async function discover(
  request: SwapRequest,
  adapters: readonly ProtocolAdapter[],
): Promise<SwapRequirements> {
  const poolRequirement = { address: request.pool, role: "pool" };
  if (request.snapshot.accounts[request.pool] === undefined) {
    return {
      protocol: null,
      accounts: [poolRequirement],
      missing: [poolRequirement],
      complete: false,
    };
  }
  const adapter = selectAdapter(request, adapters);
  const requirements: AccountRequirement[] = [poolRequirement];
  try {
    requirements.push(...(await adapter.requirements(request)));
    requirements.push(
      ...(await tokenRequirements(request, adapter.tokenAccountKinds?.(request))),
    );
  } catch (error) {
    if (!(error instanceof MissingAccountsError)) {
      throw error;
    }
    requirements.push(...error.accounts);
    const accounts = uniqueRequirements(requirements);
    return {
      protocol: adapter.id,
      accounts,
      missing: missingAccounts(request.snapshot, accounts),
      complete: false,
    };
  }
  const accounts = uniqueRequirements(requirements);
  const missing = missingAccounts(request.snapshot, accounts);
  return { protocol: adapter.id, accounts, missing, complete: missing.length === 0 };
}

/** Public build-only surface. Its registry is fixed at creation and owns no account cache. */
export interface ProtocolSdk {
  /**
   * Discover required observations, returning an incomplete list when accounts are missing.
   * @throws A `ProtocolError` subclass or `InvalidRequestError` for invalid input or
   * unsupported state. Unexpected adapter errors propagate unchanged.
   */
  getSwapRequirements(request: SwapRequest): Promise<SwapRequirements>;
  /**
   * Build unsigned swap instructions from a complete caller-owned snapshot.
   * @throws A `ProtocolError` subclass or `InvalidRequestError` for expected failures.
   * `MissingAccountsError.accounts` identifies observations required before retrying.
   * Unexpected adapter errors propagate unchanged.
   */
  buildSwapInstructions(request: SwapRequest): Promise<SwapBuild>;
}

/**
 * Create an offline SDK from selected adapters, allowing browser consumers to trim dependencies.
 * @remarks Adapter promises perform local computation only. Caller-owned snapshots must remain
 * immutable while an operation is running. Builds contain no private state or object identity tokens.
 * @throws {@link InvalidRequestError} when protocol programs or identities are duplicated.
 */
export function createProtocolSdk(protocols: readonly ProtocolAdapter[]): ProtocolSdk {
  const adapters = [...protocols];
  const programs = adapters.flatMap((adapter) => adapter.programAddresses);
  if (
    new Set(programs).size !== programs.length ||
    new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length
  ) {
    throw new InvalidRequestError({
      field: "protocols",
      message: "Protocol registries cannot contain duplicate programs or identities",
    });
  }
  return {
    async getSwapRequirements(request) {
      validateRequest(request);
      return discover(request, adapters);
    },
    async buildSwapInstructions(request) {
      validateRequest(request);
      const requirements = await discover(request, adapters);
      if (!requirements.complete) {
        throw new MissingAccountsError({
          message: "Supply the discovered account observations before building",
          accounts: requirements.missing,
        });
      }
      const adapter = selectAdapter(request, adapters);
      const tokenPlan = await planTokenAccounts(
        request,
        adapter.tokenAccountKinds?.(request),
      );
      const swap = await adapter.build(request, tokenPlan.accounts);
      if (
        (request.fillPolicy ?? "requireFull") === "requireFull" &&
        swap.mayPartiallyFill
      ) {
        throw new UnsupportedFillPolicyError({
          message: "This native instruction cannot guarantee a complete fill",
          protocol: adapter.id,
        });
      }
      const setupInstructions = [...tokenPlan.setup, ...(swap.setupInstructions ?? [])];
      const instructions = [...setupInstructions, ...swap.instructions];
      const requiredSigners = [
        ...new Set(
          instructions.flatMap(
            (instruction) =>
              instruction.accounts
                ?.filter(
                  (account) =>
                    account.role === AccountRole.READONLY_SIGNER ||
                    account.role === AccountRole.WRITABLE_SIGNER,
                )
                .map((account) => account.address) ?? [],
          ),
        ),
      ] as Address[];
      return {
        protocol: adapter.id,
        pool: request.pool,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        quote: swap.quote,
        instructions,
        setupInstructions,
        swapInstructions: swap.instructions,
        cleanupInstructions: [],
        requiredSigners,
        context: {
          slot: request.snapshot.slot,
          epoch: request.snapshot.epoch,
          unixTimestamp: request.snapshot.unixTimestamp,
        },
        execution: { mayPartiallyFill: swap.mayPartiallyFill },
        assets: adapter.tokenAccountKinds?.(request) ?? {
          input: "spl",
          output: "spl",
        },
      };
    },
  };
}
