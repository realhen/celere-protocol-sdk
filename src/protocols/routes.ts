import {
  UnsupportedProtocolError,
  MissingAccountsError,
  UnsupportedFillPolicyError,
} from "./errors";
import { InvalidRequestError } from "../shared/errors";
import { AccountRole, type Address } from "@solana/kit";
import { planTokenAccounts, tokenRequirements } from "./accounts/plan";
import { validateRequest } from "./sdk";
import { missingAccounts, requireAccount } from "./accounts/snapshot";
import type {
  RouteAdapter,
  RouteBuild,
  RouteRequest,
  RouteRequirements,
} from "./route-types";
import type { AccountRequirement, ProtocolAdapter, SwapRequest } from "./types";

function validateRoute(request: RouteRequest): void {
  if (!request || !Array.isArray(request.hops) || request.hops.length < 2) {
    throw new InvalidRequestError({
      field: "hops",
      message: "An explicit route requires at least two ordered hops",
    });
  }
  for (const hop of request.hops) {
    if (!hop || typeof hop !== "object") {
      throw new InvalidRequestError({
        field: "hops",
        message: "Every route hop must name a pool and its input and output mints",
      });
    }
    validateRequest({ ...request, ...hop });
  }
  validateRequest(endpointRequest(request));
  if (
    request.inputMint !== request.hops[0]!.inputMint ||
    request.outputMint !== request.hops.at(-1)!.outputMint
  ) {
    throw new InvalidRequestError({
      field: "hops",
      message: "Route endpoints must match the first and last hop",
    });
  }
  const pools = new Set<Address>();
  const mints = new Set<Address>([request.inputMint]);
  for (let index = 0; index < request.hops.length; index++) {
    const hop = request.hops[index]!;
    if (index > 0 && request.hops[index - 1]!.outputMint !== hop.inputMint) {
      throw new InvalidRequestError({
        field: "hops",
        message: "The route must be continuous",
      });
    }
    if (pools.has(hop.pool) || mints.has(hop.outputMint)) {
      throw new InvalidRequestError({
        field: "hops",
        message: "Repeated venues and cyclic mint paths are unsupported",
      });
    }
    pools.add(hop.pool);
    mints.add(hop.outputMint);
  }
}

function endpointRequest(request: RouteRequest): SwapRequest {
  return { ...request, pool: request.hops[0]!.pool };
}

function endpointAdapter(adapter: RouteAdapter): ProtocolAdapter {
  return {
    id: adapter.id,
    programAddresses: adapter.programAddresses,
    requirements: async () => [],
    build: async () => {
      throw new Error("Endpoint account planner cannot build swaps");
    },
  };
}

function selectAdapter(
  request: RouteRequest,
  adapters: readonly RouteAdapter[],
): RouteAdapter {
  const owners = request.hops.map(
    (hop) => requireAccount(request.snapshot, hop.pool, "route pool").owner,
  );
  const adapter = adapters.find((candidate) =>
    owners.every((owner) => candidate.programAddresses.includes(owner)),
  );
  if (!adapter) {
    throw new UnsupportedProtocolError({
      programAddress: owners[0]!,
      message: "No registered native router supports every supplied venue",
    });
  }
  return adapter;
}

async function discover(
  request: RouteRequest,
  adapters: readonly RouteAdapter[],
): Promise<RouteRequirements> {
  const requirements: AccountRequirement[] = request.hops.map((hop) => ({
    address: hop.pool,
    role: "route pool",
  }));
  const unknown = missingAccounts(request.snapshot, requirements);
  if (unknown.length > 0) {
    return { protocol: null, accounts: requirements, missing: unknown, complete: false };
  }
  const adapter = selectAdapter(request, adapters);
  let incomplete = false;
  try {
    requirements.push(...(await adapter.requirements(request)));
    requirements.push(
      ...(await tokenRequirements(endpointRequest(request), endpointAdapter(adapter))),
    );
  } catch (error) {
    if (!(error instanceof MissingAccountsError)) {
      throw error;
    }
    requirements.push(...error.accounts);
    incomplete = true;
  }
  const accounts = [
    ...new Map(requirements.map((account) => [account.address, account])).values(),
  ];
  const missing = missingAccounts(request.snapshot, accounts);
  return {
    protocol: adapter.id,
    accounts,
    missing,
    complete: !incomplete && missing.length === 0,
  };
}

/** Offline native routes have a separate surface from single-pool swaps. */
export interface RouteSdk {
  /**
   * Discover route observations, returning an incomplete list when accounts are missing.
   * @throws A `ProtocolError` subclass or `InvalidRequestError` for invalid input or
   * unsupported state. Unexpected adapter errors propagate unchanged.
   */
  getRouteRequirements(request: RouteRequest): Promise<RouteRequirements>;
  /**
   * Build unsigned native route instructions from a complete caller-owned snapshot.
   * @throws A `ProtocolError` subclass or `InvalidRequestError` for expected failures.
   * `MissingAccountsError.accounts` identifies observations required before retrying.
   * Unexpected adapter errors propagate unchanged.
   */
  buildRouteInstructions(request: RouteRequest): Promise<RouteBuild>;
}

/**
 * Create a native route builder from selected stateless routing adapters.
 * @remarks Endpoints use SPL account planning even when the native router transfers SOL
 * as wallet lamports: those routes still require the WSOL account as a mint-bearing sentinel.
 * No intermediate user accounts, SOL wrapping, signing, sending or fetching are performed.
 * @throws {@link InvalidRequestError} when route adapter identities are duplicated.
 */
export function createRouteSdk(protocols: readonly RouteAdapter[]): RouteSdk {
  const adapters = [...protocols];
  if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
    throw new InvalidRequestError({
      field: "protocols",
      message: "Route registries cannot contain duplicate identities",
    });
  }
  return {
    async getRouteRequirements(request) {
      validateRoute(request);
      return discover(request, adapters);
    },
    async buildRouteInstructions(request) {
      validateRoute(request);
      const requirements = await discover(request, adapters);
      if (!requirements.complete) {
        throw new MissingAccountsError({
          message: "Supply the discovered route observations before building",
          accounts: requirements.missing,
        });
      }
      const adapter = selectAdapter(request, adapters);
      const plan = await planTokenAccounts(
        endpointRequest(request),
        endpointAdapter(adapter),
      );
      const route = await adapter.build(request, plan.accounts);
      if (
        (request.fillPolicy ?? "requireFull") === "requireFull" &&
        route.mayPartiallyFill
      ) {
        throw new UnsupportedFillPolicyError({
          protocol: adapter.id,
          message: "This native route cannot guarantee a complete input fill",
        });
      }
      const setup = [...plan.setup, ...(route.setupInstructions ?? [])];
      const instructions = [...setup, ...route.instructions];
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
      ];
      return {
        protocol: adapter.id,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        hops: route.hops,
        quote: route.quote,
        instructions,
        setupInstructions: setup,
        swapInstructions: route.instructions,
        cleanupInstructions: [],
        requiredSigners,
        context: {
          slot: request.snapshot.slot,
          epoch: request.snapshot.epoch,
          unixTimestamp: request.snapshot.unixTimestamp,
        },
        execution: { mayPartiallyFill: route.mayPartiallyFill },
        assets: route.assets,
      };
    },
  };
}
