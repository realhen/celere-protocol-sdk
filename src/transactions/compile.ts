import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS as COMPUTE_PROGRAM,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { isValidAddress as isAddress } from "../core/addresses.js";
import {
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction as compileKitTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import type {
  Address,
  Instruction,
  Transaction,
  TransactionWithBlockhashLifetime,
} from "@solana/kit";
import { U64_MAX } from "../core/amounts.js";
import { fail, failureResult } from "../core/errors.js";
import type { Result } from "../core/errors.js";

/** Caller-supplied v0 lookup contents. Active/extension-slot checks remain the data provider's responsibility. */
export interface LookupTable {
  readonly address: Address;
  readonly addresses: readonly Address[];
}

/** Every network-derived input is explicit; compiling never samples fees or fetches a blockhash. */
export interface CompileTransactionRequest {
  readonly instructions: readonly Instruction[];
  readonly feePayer: Address;
  readonly lifetime: {
    readonly blockhash: string;
    readonly lastValidBlockHeight: bigint;
  };
  readonly lookupTables?: readonly LookupTable[];
  readonly computeBudget?: { readonly units: number; readonly microLamports?: bigint };
}

/** Unsigned wire bytes include zeroed signature slots and can be signed externally. */
export interface CompiledTransaction {
  readonly transaction: Transaction & TransactionWithBlockhashLifetime;
  readonly wireBytes: Uint8Array;
  readonly requiredSigners: readonly Address[];
  readonly byteLength: number;
}

const V0_PACKET_LIMIT = 1232;

function computeInstructions(
  budget: NonNullable<CompileTransactionRequest["computeBudget"]>,
): readonly Instruction[] {
  if (!Number.isInteger(budget.units) || budget.units <= 0 || budget.units > 1_400_000)
    fail({
      code: "INVALID_REQUEST",
      message: "Compute units must be an integer from 1 through 1400000",
      field: "computeBudget.units",
    });
  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: budget.units }),
  ];
  if (budget.microLamports !== undefined) {
    if (
      typeof budget.microLamports !== "bigint" ||
      budget.microLamports < 0n ||
      budget.microLamports > U64_MAX
    )
      fail({
        code: "INVALID_REQUEST",
        message: "Compute unit price must be a u64 bigint",
        field: "computeBudget.microLamports",
      });
    instructions.push(
      getSetComputeUnitPriceInstruction({ microLamports: budget.microLamports }),
    );
  }
  return instructions;
}

/**
 * Compile a v0 transaction locally with all required signer slots preserved.
 * @remarks This validates wire size, not execution, account liveness, or blockhash freshness.
 * A separate fee payer and additional instruction signers are supported. No keys are accepted.
 */
export function compileTransaction(
  request: CompileTransactionRequest,
): Result<CompiledTransaction> {
  try {
    if (request === null || typeof request !== "object")
      fail({
        code: "INVALID_REQUEST",
        message: "A compilation request object is required",
        field: "request",
      });
    if (!request.lifetime || typeof request.lifetime !== "object")
      fail({
        code: "INVALID_REQUEST",
        message: "A blockhash lifetime is required",
        field: "lifetime",
      });
    if (!Array.isArray(request.instructions))
      fail({
        code: "INVALID_REQUEST",
        message: "An instruction array is required",
        field: "instructions",
      });
    if (!isAddress(request.feePayer))
      fail({ code: "INVALID_REQUEST", message: "Invalid fee payer", field: "feePayer" });
    if (
      !isAddress(request.lifetime.blockhash) ||
      typeof request.lifetime.lastValidBlockHeight !== "bigint" ||
      request.lifetime.lastValidBlockHeight < 0n
    )
      fail({
        code: "INVALID_REQUEST",
        message: "Invalid blockhash lifetime",
        field: "lifetime",
      });
    if (request.instructions.length === 0)
      fail({
        code: "INVALID_REQUEST",
        message: "At least one instruction is required",
        field: "instructions",
      });
    for (const instruction of request.instructions) {
      if (!instruction || typeof instruction !== "object")
        fail({
          code: "INVALID_REQUEST",
          message: "Invalid instruction object",
          field: "instructions",
        });
      if (instruction.accounts !== undefined && !Array.isArray(instruction.accounts))
        fail({
          code: "INVALID_REQUEST",
          message: "Instruction accounts must be an array",
          field: "instructions.accounts",
        });
      if (
        !isAddress(instruction.programAddress) ||
        (instruction.data !== undefined && !(instruction.data instanceof Uint8Array))
      )
        fail({
          code: "INVALID_REQUEST",
          message: "Invalid instruction program or data",
          field: "instructions",
        });
      for (const account of instruction.accounts ?? [])
        if (
          !account ||
          !isAddress(account.address) ||
          ![0, 1, 2, 3].includes(account.role)
        )
          fail({
            code: "INVALID_REQUEST",
            message: "Invalid instruction account",
            field: "instructions.accounts",
          });
    }
    if (
      request.computeBudget !== undefined &&
      request.instructions.some(
        (instruction) => instruction.programAddress === COMPUTE_PROGRAM,
      )
    )
      fail({
        code: "INVALID_REQUEST",
        message: "Supply compute budget either in instructions or options, not both",
        field: "computeBudget",
      });
    const instructions: Instruction[] = [
      ...(request.computeBudget ? computeInstructions(request.computeBudget) : []),
      ...request.instructions,
    ];
    const referencedAccounts = new Set([
      request.feePayer,
      ...instructions.flatMap((instruction) => [
        instruction.programAddress,
        ...(instruction.accounts ?? []).map((account) => account.address),
      ]),
    ]);
    if (referencedAccounts.size > 256)
      fail({
        code: "INVALID_REQUEST",
        message: "Version 0 instructions reference more than 256 unique accounts",
        field: "instructions.accounts",
      });
    if (request.lookupTables !== undefined && !Array.isArray(request.lookupTables))
      fail({
        code: "INVALID_REQUEST",
        message: "Lookup tables must be an array",
        field: "lookupTables",
      });
    const lookupTables: Record<Address, Address[]> = {};
    for (const table of request.lookupTables ?? []) {
      if (!table || typeof table !== "object" || !Array.isArray(table.addresses))
        fail({
          code: "INVALID_REQUEST",
          message: "Invalid lookup table",
          field: "lookupTables",
        });
      if (
        !isAddress(table.address) ||
        table.addresses.length > 256 ||
        table.addresses.some((entry: unknown) => !isAddress(entry)) ||
        lookupTables[table.address] !== undefined
      )
        fail({
          code: "INVALID_REQUEST",
          message: "Invalid or duplicate lookup table",
          field: "lookupTables",
        });
      lookupTables[table.address] = [...table.addresses];
    }
    const message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(request.lifetime.blockhash),
          lastValidBlockHeight: request.lifetime.lastValidBlockHeight,
        },
        setTransactionMessageFeePayer(
          request.feePayer,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );
    const compressed = compressTransactionMessageUsingAddressLookupTables(
      message,
      lookupTables,
    );
    const transaction = compileKitTransaction(compressed);
    const requiredSigners = Object.keys(transaction.signatures) as Address[];
    const wireBytes = Uint8Array.from(getTransactionEncoder().encode(transaction));
    if (wireBytes.length > V0_PACKET_LIMIT)
      fail({
        code: "TRANSACTION_TOO_LARGE",
        message:
          "Transaction exceeds the v0 packet limit; supply lookup tables or fewer instructions",
        size: wireBytes.length,
        limit: V0_PACKET_LIMIT,
      });
    return {
      ok: true,
      value: { transaction, wireBytes, requiredSigners, byteLength: wireBytes.length },
    };
  } catch (error) {
    return failureResult(error);
  }
}
