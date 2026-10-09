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
  setTransactionMessageLifetimeUsingDurableNonce,
} from "@solana/kit";
import type {
  Address,
  Instruction,
  Transaction,
  TransactionWithBlockhashLifetime,
  TransactionWithLifetime,
  Nonce,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { U64_MAX } from "../core/amounts.js";
import { fail, failureResult } from "../core/errors.js";
import type { Result } from "../core/errors.js";

/** Caller-supplied v0 lookup contents. Active/extension-slot checks remain the data provider's responsibility. */
export interface LookupTable {
  readonly address: Address;
  readonly addresses: readonly Address[];
}

/** Caller-observed nonce state. Ownership, freshness and exclusive use remain caller responsibilities. */
export interface DurableNonce {
  readonly account: Address;
  readonly authority: Address;
  readonly value: string;
}

/** Recent blockhash and its observed expiration height. */
export interface BlockhashLifetime {
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
}

/** Every network-derived input is explicit; compiling never samples fees or fetches a blockhash. */
export interface CompileTransactionRequest {
  readonly instructions: readonly Instruction[];
  readonly feePayer: Address;
  readonly lifetime: BlockhashLifetime | DurableNonce;
  readonly lookupTables?: readonly LookupTable[];
  readonly computeBudget?: { readonly units: number; readonly microLamports?: bigint };
}

/** Unsigned wire bytes include zeroed signature slots and can be signed externally. */
export interface CompiledTransaction<
  TLifetime extends TransactionWithLifetime = TransactionWithLifetime,
> {
  readonly transaction: Transaction & TLifetime;
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
  request: CompileTransactionRequest & { readonly lifetime: BlockhashLifetime },
): Result<CompiledTransaction<TransactionWithBlockhashLifetime>>;
export function compileTransaction(
  request: CompileTransactionRequest,
): Result<CompiledTransaction>;
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
        message: "A blockhash or durable nonce lifetime is required",
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
    const durable = "account" in request.lifetime;
    if (
      durable &&
      (!isAddress(request.lifetime.account) ||
        !isAddress(request.lifetime.authority) ||
        !isAddress(request.lifetime.value) ||
        request.lifetime.account === request.lifetime.authority ||
        request.lifetime.account === request.feePayer ||
        request.lifetime.account === SYSTEM_PROGRAM_ADDRESS ||
        "blockhash" in request.lifetime ||
        "lastValidBlockHeight" in request.lifetime)
    )
      fail({
        code: "INVALID_REQUEST",
        message: "Invalid durable nonce lifetime",
        field: "lifetime",
      });
    if (
      !durable &&
      (!isAddress(request.lifetime.blockhash) ||
        typeof request.lifetime.lastValidBlockHeight !== "bigint" ||
        request.lifetime.lastValidBlockHeight < 0n)
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
    if (
      durable &&
      request.instructions.some(
        (ix) =>
          ix.programAddress === SYSTEM_PROGRAM_ADDRESS &&
          ix.data?.length &&
          ix.data.length >= 4 &&
          new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getUint32(
            0,
            true,
          ) === 4,
      )
    )
      fail({
        code: "INVALID_REQUEST",
        message: "Nonce advance is generated by the compiler; do not supply another",
        field: "instructions",
      });
    const instructions: Instruction[] = [
      ...(request.computeBudget ? computeInstructions(request.computeBudget) : []),
      ...request.instructions,
    ];
    const referencedAccounts = new Set([
      request.feePayer,
      ...(durable
        ? [
            request.lifetime.account,
            request.lifetime.authority,
            SYSTEM_PROGRAM_ADDRESS,
            "SysvarRecentB1ockHashes11111111111111111111",
          ]
        : []),
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
    const base = setTransactionMessageFeePayer(
      request.feePayer,
      createTransactionMessage({ version: 0 }),
    );
    const withLifetime = durable
      ? setTransactionMessageLifetimeUsingDurableNonce(
          {
            nonce: request.lifetime.value as Nonce,
            nonceAccountAddress: request.lifetime.account,
            nonceAuthorityAddress: request.lifetime.authority,
          },
          base,
        )
      : setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash(request.lifetime.blockhash),
            lastValidBlockHeight: request.lifetime.lastValidBlockHeight,
          },
          base,
        );
    const message = appendTransactionMessageInstructions(instructions, withLifetime);
    const compressed = compressTransactionMessageUsingAddressLookupTables(
      message,
      lookupTables,
    );
    // SIMD-0242 requires the nonce account to remain static. Restore only its
    // metadata after compression, preserving every other ALT entry's original index.
    const nonceAccount = durable ? request.lifetime.account : undefined;
    const finalMessage = durable
      ? {
          ...compressed,
          instructions: compressed.instructions.map((ix) => ({
            ...ix,
            ...(ix.accounts === undefined
              ? {}
              : {
                  accounts: ix.accounts.map((account) =>
                    account.address === nonceAccount
                      ? { address: account.address, role: account.role }
                      : account,
                  ),
                }),
          })),
        }
      : compressed;
    const transaction = compileKitTransaction(finalMessage);
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
