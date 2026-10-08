import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { readMint, readTokenAccount, WRAPPED_SOL_MINT } from "../../accounts/tokens.js";
import { minimumOutput, U64_MAX } from "../../core/amounts.js";
import { fail } from "../../core/errors.js";
import { requireAccount } from "../../core/snapshot.js";
import type {
  AccountRequirement,
  ProtocolAdapter,
  ProtocolSwap,
  ResolvedTokenAccounts,
  SwapRequest,
} from "../../core/types.js";
import { BOOP_PROGRAM } from "./constants.js";
import {
  getBoopBuyTokenInstruction,
  getBoopSellTokenInstruction,
} from "./instructions/index.js";
export { BOOP_PROGRAM } from "./constants.js";
const decoder = getAddressDecoder(),
  encoder = getAddressEncoder();
const INITIAL_TOKEN_SUPPLY = 1_000_000_000_000_000_000n;
const BASIS_POINTS = 10_000n;
interface Curve {
  readonly mint: Address;
  readonly virtualSol: bigint;
  readonly target: bigint;
  readonly sol: bigint;
  readonly tokens: bigint;
  readonly feeBps: bigint;
}
function invalid(address: Address, message: string): never {
  fail({ code: "INVALID_ACCOUNT", address, message });
}
function unsupported(feature: string): never {
  fail({
    code: "UNSUPPORTED_POOL_FEATURE",
    protocol: "boop",
    feature,
    message: `Boop ${feature} is not qualified`,
  });
}
function insufficient(message: string): never {
  fail({ code: "INSUFFICIENT_LIQUIDITY", protocol: "boop", message });
}
function direction(request: SwapRequest): {
  readonly isBuy: boolean;
  readonly mint: Address;
} {
  const isBuy = request.inputMint === WRAPPED_SOL_MINT;
  if (isBuy === (request.outputMint === WRAPPED_SOL_MINT))
    fail({
      code: "INVALID_REQUEST",
      field: "inputMint",
      message: "Boop curves require one native SOL side",
    });
  return { isBuy, mint: isBuy ? request.outputMint : request.inputMint };
}
function readCurve(request: SwapRequest): Curve {
  const data = requireAccount(
    request.snapshot,
    request.pool,
    "Boop bonding curve",
    BOOP_PROGRAM,
  ).data;
  if (
    data.length < 125 ||
    ![23, 183, 248, 55, 96, 216, 172, 96].every((byte, index) => data[index] === byte) ||
    data.subarray(125).some((byte) => byte !== 0)
  )
    invalid(request.pool, "Unknown Boop curve layout");
  if (data[124] !== 0) invalid(request.pool, "Boop curve has graduated or migrated");
  if (data[120] !== 31) unsupported(`curve selector ${data[120]}`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const curve = {
    mint: decoder.decode(data.subarray(40, 72)),
    virtualSol: v.getBigUint64(72, true),
    target: v.getBigUint64(88, true),
    sol: v.getBigUint64(104, true),
    tokens: v.getBigUint64(112, true),
    feeBps: BigInt(data[121]!),
  };
  if (curve.mint !== direction(request).mint)
    invalid(request.pool, "Boop curve mint mismatch");
  if (
    curve.virtualSol === 0n ||
    curve.virtualSol + curve.sol > U64_MAX ||
    curve.tokens === 0n ||
    curve.tokens > INITIAL_TOKEN_SUPPLY ||
    curve.target <= curve.sol ||
    v.getBigUint64(96, true) > curve.target ||
    v.getUint16(122, true) > 10000
  )
    invalid(request.pool, "Invalid Boop reserve or graduation state");
  return curve;
}
async function pda(seed: string, mint?: Address): Promise<Address> {
  return (
    await getProgramDerivedAddress({
      programAddress: BOOP_PROGRAM,
      seeds: mint ? [seed, encoder.encode(mint)] : [seed],
    })
  )[0];
}
async function deriveAccounts(mint: Address) {
  const [pool, config, tokenVault, solVault, feesVault, authority] = await Promise.all([
    pda("bonding_curve", mint),
    pda("config"),
    pda("bonding_curve_vault", mint),
    pda("bonding_curve_sol_vault", mint),
    pda("trading_fees_vault", mint),
    pda("vault_authority"),
  ]);
  return { pool, config, tokenVault, solVault, feesVault, authority };
}
async function requirements(
  request: SwapRequest,
): Promise<readonly AccountRequirement[]> {
  const curve = readCurve(request),
    derived = await deriveAccounts(curve.mint);
  return [
    { address: request.pool, role: "Boop bonding curve" },
    { address: derived.config, role: "Boop configuration" },
    { address: curve.mint, role: "base mint" },
    { address: WRAPPED_SOL_MINT, role: "native fee mint" },
    { address: derived.tokenVault, role: "base vault" },
    { address: derived.solVault, role: "native SOL vault" },
    { address: derived.feesVault, role: "WSOL fee vault" },
  ];
}
function readConfig(request: SwapRequest, config: Address): void {
  const data = requireAccount(
    request.snapshot,
    config,
    "Boop configuration",
    BOOP_PROGRAM,
  ).data;
  if (
    data.length < 189 ||
    ![155, 12, 170, 224, 30, 250, 204, 130].every((byte, index) => data[index] === byte)
  )
    invalid(config, "Unknown Boop configuration layout");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength),
    end = 189 + v.getUint32(73, true) * 32;
  if (end > data.length || data.subarray(end).some((byte) => byte !== 0) || data[8]! > 1)
    invalid(config, "Malformed Boop configuration");
  if (data[8] !== 0) invalid(config, "Boop swaps are paused");
}
/**
 * Independently derived from Boop's deployed selector-31 behavior.
 * @remarks The invariant uses the fixed initial supply, not the deprecated virtual
 * token reserve. Native execution floors the new reserve before taking the difference.
 * SOL fees are floored; buys clamp net SOL input at the remaining graduation target.
 */
function quoteAmounts(curve: Curve, amount: bigint, isBuy: boolean) {
  const invariant = INITIAL_TOKEN_SUPPLY * curve.virtualSol;
  const solWithVirtual = curve.sol + curve.virtualSol;
  let fee: bigint,
    input = amount,
    output: bigint;
  if (isBuy) {
    fee = (amount * curve.feeBps) / BASIS_POINTS;
    let net = amount - fee;
    const remaining = curve.target - curve.sol;
    if (net > remaining) {
      net = remaining;
      fee = (net * curve.feeBps) / (BASIS_POINTS - curve.feeBps);
      input = net + fee;
    }
    if (net === 0n || solWithVirtual + net > U64_MAX)
      insufficient("Boop input cannot settle within native arithmetic");
    output = curve.tokens - invariant / (solWithVirtual + net);
    if (output > curve.tokens) insufficient("Boop output exceeds its token reserve");
  } else {
    if (curve.tokens + amount > INITIAL_TOKEN_SUPPLY)
      insufficient("Boop sell exhausts real SOL backing");
    const gross = solWithVirtual - invariant / (curve.tokens + amount);
    if (gross <= 0n || gross > curve.sol)
      insufficient("Boop sell exhausts real SOL backing");
    fee = (gross * curve.feeBps) / BASIS_POINTS;
    output = gross - fee;
  }
  if (output <= 0n || output > U64_MAX)
    insufficient("Boop swap has no positive native output");
  return { input, output, fee };
}
async function build(
  request: SwapRequest,
  accounts: ResolvedTokenAccounts,
): Promise<ProtocolSwap> {
  if (request.amount.kind !== "exactIn")
    fail({
      code: "UNSUPPORTED_SWAP_MODE",
      protocol: "boop",
      mode: request.amount.kind,
      message: "Boop exposes native exact-input swaps only",
    });
  const { isBuy } = direction(request),
    curve = readCurve(request),
    derived = await deriveAccounts(curve.mint);
  if (derived.pool !== request.pool) invalid(request.pool, "Boop curve PDA mismatch");
  readConfig(request, derived.config);
  const mint = readMint(request.snapshot, curve.mint),
    nativeMint = readMint(request.snapshot, WRAPPED_SOL_MINT);
  if (
    mint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    mint.decimals !== 9 ||
    mint.supply > INITIAL_TOKEN_SUPPLY ||
    nativeMint.tokenProgram !== TOKEN_PROGRAM_ADDRESS ||
    nativeMint.decimals !== 9
  )
    unsupported("mint program, supply or decimal variant");
  const tokenBalance = readTokenAccount(
    request.snapshot,
    derived.tokenVault,
    curve.mint,
    TOKEN_PROGRAM_ADDRESS,
    derived.authority,
  ).amount;
  const feeBalance = readTokenAccount(
    request.snapshot,
    derived.feesVault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ADDRESS,
    derived.authority,
  ).amount;
  const feeVault = requireAccount(
    request.snapshot,
    derived.feesVault,
    "Boop fee vault",
    TOKEN_PROGRAM_ADDRESS,
  );
  const feeData = new DataView(
    feeVault.data.buffer,
    feeVault.data.byteOffset,
    feeVault.data.byteLength,
  );
  if (
    feeData.getUint32(109, true) !== 1 ||
    feeVault.lamports !== feeBalance + feeData.getBigUint64(113, true)
  )
    invalid(derived.feesVault, "Boop fee vault must contain synchronized native WSOL");
  const solVault = requireAccount(
    request.snapshot,
    derived.solVault,
    "Boop native SOL vault",
    SYSTEM_PROGRAM_ADDRESS,
  );
  if (
    solVault.data.length !== 0 ||
    solVault.lamports < curve.sol ||
    tokenBalance < curve.tokens ||
    mint.supply < curve.tokens
  )
    invalid(request.pool, "Boop reserves exceed observed backing");
  const userToken = isBuy ? accounts.output : accounts.input;
  if ([derived.tokenVault, derived.feesVault].includes(userToken))
    invalid(userToken, "User token account aliases a Boop vault");
  if (!isBuy) {
    const [ata] = await findAssociatedTokenPda({
      owner: request.owner,
      mint: curve.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    if (accounts.input !== ata)
      invalid(accounts.input, "Boop sells require the owner's associated token account");
  }
  const amounts = quoteAmounts(curve, request.amount.amountIn, isBuy);
  if (
    feeBalance + amounts.fee > U64_MAX ||
    (!isBuy && tokenBalance + amounts.input > U64_MAX)
  )
    insufficient("Boop destination balance exceeds native u64 arithmetic");
  const quote = {
    kind: "exactIn" as const,
    amountIn: request.amount.amountIn,
    minimumAmountOut: minimumOutput(amounts.output, request.slippageBps),
    expectedAmountIn: amounts.input,
    expectedAmountOut: amounts.output,
    fees: [{ kind: "trade" as const, mint: WRAPPED_SOL_MINT, amount: amounts.fee }],
  };
  const common = {
    mint: curve.mint,
    bondingCurve: request.pool,
    tradingFeesVault: derived.feesVault,
    bondingCurveVault: derived.tokenVault,
    bondingCurveSolVault: derived.solVault,
    config: derived.config,
  };
  const instruction = isBuy
    ? getBoopBuyTokenInstruction(
        {
          ...common,
          recipientTokenAccount: accounts.output,
          buyer: request.owner,
          vaultAuthority: derived.authority,
        },
        { buyAmount: quote.amountIn, amountOutMin: quote.minimumAmountOut },
      )
    : getBoopSellTokenInstruction(
        {
          ...common,
          sellerTokenAccount: accounts.input,
          seller: request.owner,
          recipient: request.owner,
        },
        { sellAmount: quote.amountIn, amountOutMin: quote.minimumAmountOut },
      );
  return { instructions: [instruction], quote, mayPartiallyFill: isBuy };
}
/**
 * Offline Boop selector-31 native SOL swaps with classic nine-decimal SPL tokens.
 * @remarks Buy instructions can clamp input at graduation, so callers must explicitly
 * allow partial fills. Sells enforce full input. Exact output and legacy selector 30
 * are unsupported. WSOL identifies native wallet lamports at the public swap boundary;
 * the protocol fee vault must already exist as synchronized native WSOL.
 */
export const boopAdapter: ProtocolAdapter = {
  id: "boop",
  programAddresses: [BOOP_PROGRAM],
  requirements,
  build,
  tokenAccountKinds(request) {
    return direction(request).isBuy
      ? { input: "nativeSol", output: "spl" }
      : { input: "spl", output: "nativeSol" };
  },
};
