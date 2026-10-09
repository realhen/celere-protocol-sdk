import { AccountRole, type Address } from "@solana/kit";
import { planTokenAccounts, tokenRequirements } from "../accounts/plan.js";
import { BuildFailure, fail, failureResult, type Result } from "./errors.js";
import { validateRequest } from "./sdk.js";
import { missingAccounts, requireAccount } from "./snapshot.js";
import type {
  RouteAdapter,
  RouteBuild,
  RouteRequest,
  RouteRequirements,
} from "./route-types.js";
import type { AccountRequirement, ProtocolAdapter, SwapRequest } from "./types.js";

function validateRoute(request: RouteRequest): void {
  if (!request || !Array.isArray(request.hops) || request.hops.length < 2)
    fail({
      code: "INVALID_REQUEST",
      field: "hops",
      message: "An explicit route requires at least two ordered hops",
    });
  for (const hop of request.hops) {
    if (!hop || typeof hop !== "object")
      fail({
        code: "INVALID_REQUEST",
        field: "hops",
        message: "Every route hop must name a pool and its input and output mints",
      });
    validateRequest({ ...request, ...hop });
  }
  validateRequest(endpointRequest(request));
  if (
    request.inputMint !== request.hops[0]!.inputMint ||
    request.outputMint !== request.hops.at(-1)!.outputMint
  )
    fail({
      code: "INVALID_REQUEST",
      field: "hops",
      message: "Route endpoints must match the first and last hop",
    });
  const pools = new Set<Address>();
  const mints = new Set<Address>([request.inputMint]);
  for (let index = 0; index < request.hops.length; index++) {
    const hop = request.hops[index]!;
    if (index > 0 && request.hops[index - 1]!.outputMint !== hop.inputMint)
      fail({
        code: "INVALID_REQUEST",
        field: "hops",
        message: "The route must be continuous",
      });
    if (pools.has(hop.pool) || mints.has(hop.outputMint))
      fail({
        code: "INVALID_REQUEST",
        field: "hops",
        message: "Repeated venues and cyclic mint paths are unsupported",
      });
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
  if (!adapter)
    fail({
      code: "UNSUPPORTED_PROTOCOL",
      programAddress: owners[0]!,
      message: "No registered native router supports every supplied venue",
    });
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
  if (unknown.length > 0)
    return { protocol: null, accounts: requirements, missing: unknown, complete: false };
  const adapter = selectAdapter(request, adapters);
  let incomplete = false;
  try {
    requirements.push(...(await adapter.requirements(request)));
    requirements.push(
      ...(await tokenRequirements(endpointRequest(request), endpointAdapter(adapter))),
    );
  } catch (error) {
    if (!(error instanceof BuildFailure) || error.detail.code !== "MISSING_ACCOUNTS")
      throw error;
    requirements.push(...error.detail.accounts);
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
  getRouteRequirements(request: RouteRequest): Promise<Result<RouteRequirements>>;
  buildRouteInstructions(request: RouteRequest): Promise<Result<RouteBuild>>;
}

/**
 * Create a native route builder from selected stateless routing adapters.
 * @remarks Endpoints use SPL account planning even when the native router transfers SOL
 * as wallet lamports: those routes still require the WSOL account as a mint-bearing sentinel.
 * No intermediate user accounts, SOL wrapping, signing, sending or fetching are performed.
 */
export function createRouteSdk(protocols: readonly RouteAdapter[]): RouteSdk {
  const adapters = [...protocols];
  if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length)
    throw new TypeError("Route registries cannot contain duplicate identities");
  return {
    async getRouteRequirements(request) {
      try {
        validateRoute(request);
        return { ok: true, value: await discover(request, adapters) };
      } catch (error) {
        return failureResult(error);
      }
    },
    async buildRouteInstructions(request) {
      try {
        validateRoute(request);
        const requirements = await discover(request, adapters);
        if (!requirements.complete)
          fail({
            code: "MISSING_ACCOUNTS",
            message: "Supply the discovered route observations before building",
            accounts: requirements.missing,
          });
        const adapter = selectAdapter(request, adapters);
        const plan = await planTokenAccounts(
          endpointRequest(request),
          endpointAdapter(adapter),
        );
        const route = await adapter.build(request, plan.accounts);
        if (
          (request.fillPolicy ?? "requireFull") === "requireFull" &&
          route.mayPartiallyFill
        )
          fail({
            code: "UNSUPPORTED_FILL_POLICY",
            protocol: adapter.id,
            message: "This native route cannot guarantee a complete input fill",
          });
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
          ok: true,
          value: {
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
          },
        };
      } catch (error) {
        return failureResult(error);
      }
    },
  };
}
