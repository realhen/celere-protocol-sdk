import { isValidAddress as isAddress } from "./addresses.js";
import { AccountRole } from "@solana/kit";
import type { Address } from "@solana/kit";
import { planTokenAccounts, tokenRequirements } from "../accounts/plan.js";
import { assertAmount, basisPoints } from "./amounts.js";
import { BuildFailure, fail, failureResult } from "./errors.js";
import type { Result } from "./errors.js";
import { missingAccounts, requireAccount } from "./snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  SwapBuild,
  SwapRequest,
  SwapRequirements,
} from "./types.js";

function validateRequest(request: SwapRequest): void {
  if (request === null || typeof request !== "object")
    fail({
      code: "INVALID_REQUEST",
      message: "A swap request object is required",
      field: "request",
    });
  for (const field of ["pool", "owner", "payer", "inputMint", "outputMint"] as const) {
    if (!isAddress(request[field]))
      fail({
        code: "INVALID_REQUEST",
        message: "Expected a valid Solana address",
        field,
      });
  }
  if (request.inputMint === request.outputMint)
    fail({
      code: "INVALID_REQUEST",
      message: "Input and output mints must differ",
      field: "outputMint",
    });
  if (request.amount?.kind === "exactIn")
    assertAmount(request.amount.amountIn, "amountIn");
  else if (request.amount?.kind === "exactOut")
    assertAmount(request.amount.amountOut, "amountOut");
  else
    fail({
      code: "INVALID_REQUEST",
      message: "Unknown swap amount mode",
      field: "amount.kind",
    });
  basisPoints(request.slippageBps);
  if (
    request.fillPolicy !== undefined &&
    request.fillPolicy !== "requireFull" &&
    request.fillPolicy !== "allowPartial"
  )
    fail({
      code: "INVALID_REQUEST",
      message: "Unknown fill policy",
      field: "fillPolicy",
    });
  if (request.tokenAccounts)
    for (const field of ["input", "output"] as const) {
      if (!isAddress(request.tokenAccounts[field]))
        fail({
          code: "INVALID_REQUEST",
          message: "Invalid token account address",
          field: `tokenAccounts.${field}`,
        });
    }
  if (
    request.maxAccountAgeSlots !== undefined &&
    (typeof request.maxAccountAgeSlots !== "bigint" || request.maxAccountAgeSlots < 0n)
  )
    fail({
      code: "INVALID_REQUEST",
      message: "Account age must be a nonnegative bigint",
      field: "maxAccountAgeSlots",
    });
  const snapshot = request.snapshot;
  for (const field of ["slot", "epoch", "unixTimestamp"] as const) {
    if (typeof snapshot?.[field] !== "bigint" || snapshot[field] < 0n)
      fail({
        code: "INVALID_SNAPSHOT_CONTEXT",
        message: `A nonnegative chain ${field} is required`,
      });
  }
  if (!snapshot.accounts || typeof snapshot.accounts !== "object")
    fail({
      code: "INVALID_SNAPSHOT_CONTEXT",
      message: "An account observation map is required",
    });
  for (const [key, account] of Object.entries(snapshot.accounts)) {
    if (!isAddress(key))
      fail({
        code: "INVALID_REQUEST",
        message: "Invalid snapshot map address",
        field: "snapshot.accounts",
      });
    if (account === null || account === undefined) continue;
    if (
      account.address !== key ||
      !isAddress(account.owner) ||
      !(account.data instanceof Uint8Array) ||
      typeof account.lamports !== "bigint" ||
      account.lamports < 0n ||
      typeof account.executable !== "boolean"
    )
      fail({
        code: "INVALID_ACCOUNT",
        address: key,
        message: "Malformed account observation",
      });
    if (
      typeof account.slot !== "bigint" ||
      account.slot < 0n ||
      account.slot > snapshot.slot ||
      (request.maxAccountAgeSlots !== undefined &&
        snapshot.slot - account.slot > request.maxAccountAgeSlots)
    )
      fail({
        code: "INVALID_SNAPSHOT_CONTEXT",
        message:
          "Account observation is future-dated or older than the supplied age policy",
      });
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
  if (!adapter)
    fail({
      code: "UNSUPPORTED_PROTOCOL",
      message: "No native adapter is registered for this pool owner",
      programAddress: pool.owner,
    });
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
  if (request.snapshot.accounts[request.pool] === undefined)
    return {
      protocol: null,
      accounts: [poolRequirement],
      missing: [poolRequirement],
      complete: false,
    };
  const adapter = selectAdapter(request, adapters);
  const requirements: AccountRequirement[] = [poolRequirement];
  try {
    requirements.push(...(await adapter.requirements(request)));
    requirements.push(...(await tokenRequirements(request, adapter)));
  } catch (error) {
    if (!(error instanceof BuildFailure) || error.detail.code !== "MISSING_ACCOUNTS")
      throw error;
    requirements.push(...error.detail.accounts);
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
  getSwapRequirements(request: SwapRequest): Promise<Result<SwapRequirements>>;
  buildSwapInstructions(request: SwapRequest): Promise<Result<SwapBuild>>;
}

/**
 * Create an offline SDK from selected adapters, allowing browser consumers to trim dependencies.
 * @remarks Adapter promises perform local computation only. Caller-owned snapshots must remain
 * immutable while an operation is running. Results contain no private state or object identity tokens.
 */
export function createProtocolSdk(protocols: readonly ProtocolAdapter[]): ProtocolSdk {
  const adapters = [...protocols];
  const programs = adapters.flatMap((adapter) => adapter.programAddresses);
  if (
    new Set(programs).size !== programs.length ||
    new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length
  )
    throw new TypeError(
      "Protocol registries cannot contain duplicate programs or identities",
    );
  return {
    async getSwapRequirements(request) {
      try {
        validateRequest(request);
        return { ok: true, value: await discover(request, adapters) };
      } catch (error) {
        return failureResult(error);
      }
    },
    async buildSwapInstructions(request) {
      try {
        validateRequest(request);
        const requirements = await discover(request, adapters);
        if (!requirements.complete)
          fail({
            code: "MISSING_ACCOUNTS",
            message: "Supply the discovered account observations before building",
            accounts: requirements.missing,
          });
        const adapter = selectAdapter(request, adapters);
        const tokenPlan = await planTokenAccounts(request, adapter);
        const swap = await adapter.build(request, tokenPlan.accounts);
        if (
          (request.fillPolicy ?? "requireFull") === "requireFull" &&
          swap.mayPartiallyFill
        )
          fail({
            code: "UNSUPPORTED_FILL_POLICY",
            message: "This native instruction cannot guarantee a complete fill",
            protocol: adapter.id,
          });
        const instructions = [...tokenPlan.setup, ...swap.instructions];
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
          ok: true,
          value: {
            protocol: adapter.id,
            pool: request.pool,
            inputMint: request.inputMint,
            outputMint: request.outputMint,
            quote: swap.quote,
            instructions,
            setupInstructions: tokenPlan.setup,
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
          },
        };
      } catch (error) {
        return failureResult(error);
      }
    },
  };
}
