import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { WRAPPED_SOL_MINT } from "../../dist/accounts/tokens.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

const captured = JSON.parse(
  await readFile(new URL("./orca-mainnet.json", import.meta.url), "utf8"),
);
const encodeAddress = getAddressEncoder();
const decodeAddress = getAddressDecoder();
const PROGRAM = address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const WSOL = WRAPPED_SOL_MINT;
function deterministicAddress(label) {
  return decodeAddress.decode(
    createHash("sha256").update(`celere-orca-fixture:${label}`).digest(),
  );
}
function key(data, offset) {
  return decodeAddress.decode(data.subarray(offset, offset + 32));
}
function pda(seeds) {
  return getProgramDerivedAddress({ programAddress: PROGRAM, seeds });
}
function tokenData(mint, authority, amount) {
  const data = new Uint8Array(165);
  data.set(encodeAddress.encode(mint));
  data.set(encodeAddress.encode(authority), 32);
  const writer = new DataView(data.buffer);
  writer.setBigUint64(64, amount, true);
  data[108] = 1;
  if (mint === WSOL) {
    writer.setUint32(109, 1, true);
    writer.setBigUint64(113, 2_039_280n, true);
  }
  return data;
}

/** Public fixed-array liquidity copied to isolated addresses; all wallet accounts are synthetic. */
export async function orcaWhirlpoolFixture(
  owner,
  { reverse = false, adaptive = false, label = "default", timestamp } = {},
) {
  const sourcePool = Buffer.from(captured.accounts[captured.pool].data, "base64");
  const mintA = key(sourcePool, 101);
  const mintB = key(sourcePool, 181);
  const spacing = sourcePool.readUInt16LE(41);
  const config = deterministicAddress(`config:${label}`);
  const feeTier = adaptive ? 128 : spacing;
  const [pool, bump] = await pda([
    "whirlpool",
    encodeAddress.encode(config),
    encodeAddress.encode(mintA),
    encodeAddress.encode(mintB),
    Uint8Array.of(feeTier & 255, feeTier >> 8),
  ]);
  const vaultA = deterministicAddress(`vaultA:${label}`);
  const vaultB = deterministicAddress(`vaultB:${label}`);
  const userA = deterministicAddress(`userA:${label}`);
  const userB = deterministicAddress(`userB:${label}`);
  const slot = BigInt(captured.slot);
  const unixTimestamp = timestamp ?? BigInt(captured.unixTimestamp);
  const accounts = {};
  const observe = (
    accountAddress,
    ownerAddress,
    data,
    accountLamports = 100_000_000n,
  ) => {
    accounts[accountAddress] = {
      address: accountAddress,
      owner: ownerAddress,
      data: Uint8Array.from(data),
      lamports: accountLamports,
      executable: false,
      slot,
    };
  };
  for (const mint of [mintA, mintB]) {
    const account = captured.accounts[mint];
    observe(
      mint,
      address(account.owner),
      Buffer.from(account.data, "base64"),
      BigInt(account.lamports),
    );
  }
  const poolData = Buffer.from(sourcePool);
  poolData.set(encodeAddress.encode(config), 8);
  poolData[40] = bump;
  poolData.writeUInt16LE(feeTier, 43);
  poolData.set(encodeAddress.encode(vaultA), 133);
  poolData.set(encodeAddress.encode(vaultB), 213);
  poolData.writeBigUInt64LE(unixTimestamp, 261);
  observe(pool, PROGRAM, poolData);
  for (const [source, target] of [
    [key(sourcePool, 133), vaultA],
    [key(sourcePool, 213), vaultB],
  ]) {
    const observed = captured.accounts[source];
    const data = Buffer.from(observed.data, "base64");
    data.set(encodeAddress.encode(pool), 32);
    observe(target, address(observed.owner), data, BigInt(observed.lamports));
  }
  const span = spacing * 88;
  const start = Math.floor(sourcePool.readInt32LE(81) / span) * span;
  const tickArrays = [];
  for (const index of [
    start,
    start + span,
    start + span * 2,
    start - span,
    start - span * 2,
  ]) {
    const [original] = await pda([
      "tick_array",
      encodeAddress.encode(address(captured.pool)),
      String(index),
    ]);
    const [derived] = await pda([
      "tick_array",
      encodeAddress.encode(pool),
      String(index),
    ]);
    tickArrays.push(derived);
    const observed = captured.accounts[original];
    if (observed === null) {
      accounts[derived] = null;
      continue;
    }
    const data = Buffer.from(observed.data, "base64");
    if (data.length !== 9988)
      throw new Error("Expected captured fixed tick-array layout");
    data.set(encodeAddress.encode(pool), 9956);
    observe(derived, PROGRAM, data);
  }
  const [oracle] = await pda(["oracle", encodeAddress.encode(pool)]);
  accounts[oracle] = null;
  const amount = 100_000_000_000n;
  observe(userA, TOKEN_PROGRAM, tokenData(mintA, owner, amount), amount + 2_039_280n);
  observe(userB, TOKEN_PROGRAM, tokenData(mintB, owner, amount), amount + 2_039_280n);
  return {
    pool,
    oracle,
    tickArrays,
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mintB : mintA,
      outputMint: reverse ? mintA : mintB,
      amount: { kind: "exactIn", amountIn: 1_000_000n },
      slippageBps: 50,
      fillPolicy: "allowPartial",
      tokenAccounts: { input: reverse ? userB : userA, output: reverse ? userA : userB },
      snapshot: { slot, epoch: BigInt(captured.epoch), unixTimestamp, accounts },
    },
  };
}
