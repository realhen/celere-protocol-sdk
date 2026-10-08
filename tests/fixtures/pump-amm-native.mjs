import assert from "node:assert/strict";
import { AccountRole, address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { getSwapRequirements, buildSwapInstructions } from "../../dist/index.js";
import {
  createCurveInstruction,
  curveAddress,
  observeRequest,
  rpc,
  submitInstructions,
} from "./pump-helpers.mjs";
import {
  PUMP,
  PUMP_AMM,
  TOKEN,
  TOKEN_2022,
  SOL,
  SYSTEM,
  ATA_PROGRAM,
  ata,
  pda,
  poolAddress,
} from "./pump-amm.mjs";

export { rpc, submitInstructions };
export const ammSdk = { getSwapRequirements, buildSwapInstructions };
const decoder = getAddressDecoder();
const encoder = getAddressEncoder();
const readonly = (value) => ({ address: value, role: AccountRole.READONLY });
const writable = (value) => ({ address: value, role: AccountRole.WRITABLE });

export async function readAccount(url, account) {
  const result = await rpc(url, "getAccountInfo", [
    account,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  return result.value === null
    ? null
    : {
        ...result.value,
        data: Uint8Array.from(Buffer.from(result.value.data[0], "base64")),
      };
}

function createAta(payer, owner, mint, tokenProgram, account) {
  return {
    programAddress: ATA_PROGRAM,
    data: Uint8Array.of(1),
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      writable(account),
      readonly(owner),
      readonly(mint),
      readonly(SYSTEM),
      readonly(tokenProgram),
    ],
  };
}

export async function prepareWrappedSol(url, user, amount = 100_000_000_000n) {
  const account = await ata(user.address, SOL);
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, amount, true);
  await submitInstructions(
    url,
    [
      createAta(user.address, user.address, SOL, TOKEN, account),
      {
        programAddress: SYSTEM,
        data,
        accounts: [
          { address: user.address, role: AccountRole.WRITABLE_SIGNER },
          writable(account),
        ],
      },
      { programAddress: TOKEN, data: Uint8Array.of(17), accounts: [writable(account)] },
    ],
    user,
  );
}

/** Provision a canonical AMM through actual Pump create, complete, and migrate instructions. */
export async function provisionCanonicalPool(url, user, mint, tokenProgram) {
  await rpc(url, "surfnet_setAccount", [user.address, { lamports: 1_000_000_000_000 }]);
  await submitInstructions(
    url,
    [await createCurveInstruction(user.address, mint.address, tokenProgram)],
    user,
    [user, mint],
  );
  const curve = await curveAddress(mint.address);
  const curveData = (await readAccount(url, curve)).data;
  const realTokens = new DataView(
    curveData.buffer,
    curveData.byteOffset,
    curveData.byteLength,
  ).getBigUint64(24, true);
  const finish = await observeRequest(url, {
    pool: curve,
    owner: user.address,
    payer: user.address,
    inputMint: SOL,
    outputMint: mint.address,
    amount: { kind: "exactOut", amountOut: realTokens },
    slippageBps: 50,
  });
  const built = await buildSwapInstructions(finish);
  assert.ok(
    built.ok,
    JSON.stringify(built, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  await submitInstructions(url, built.value.instructions, user);
  const global = await pda(PUMP, "global");
  const globalData = (await readAccount(url, global)).data;
  const withdrawal = decoder.decode(globalData.subarray(113, 145));
  const authority = await pda(PUMP, "pool-authority", mint.address);
  const [pool] = await poolAddress(authority, mint.address);
  const lpMint = await pda(PUMP_AMM, "pool_lp_mint", pool);
  const boostAuthority = await pda(PUMP_AMM, "boost_vault", pool);
  const instruction = {
    programAddress: PUMP,
    data: Uint8Array.from([187, 203, 18, 31, 206, 237, 254, 41]),
    accounts: [
      readonly(global),
      writable(withdrawal),
      readonly(mint.address),
      readonly(SOL),
      writable(curve),
      writable(await ata(curve, mint.address, tokenProgram)),
      writable(await ata(curve, SOL)),
      { address: user.address, role: AccountRole.WRITABLE_SIGNER },
      readonly(SYSTEM),
      readonly(PUMP_AMM),
      writable(pool),
      writable(authority),
      writable(await ata(authority, mint.address, tokenProgram)),
      writable(await ata(authority, SOL)),
      readonly(await pda(PUMP_AMM, "global_config")),
      writable(lpMint),
      writable(await ata(authority, lpMint, TOKEN_2022)),
      writable(await ata(pool, mint.address, tokenProgram)),
      writable(await ata(pool, SOL)),
      readonly(tokenProgram),
      readonly(TOKEN),
      readonly(TOKEN_2022),
      readonly(ATA_PROGRAM),
      readonly(await pda(PUMP_AMM, "__event_authority")),
      readonly(address("SysvarRent111111111111111111111111111111111")),
      readonly(await pda(PUMP, "__event_authority")),
      readonly(PUMP),
      readonly(boostAuthority),
      writable(await ata(boostAuthority, SOL)),
    ],
  };
  const migrationSignature = await submitInstructions(url, [instruction], user);
  await prepareWrappedSol(url, user);
  return { pool, migrationSignature };
}

/** Permissionless pool creation uses real program validation and tokens already owned by the test wallet. */
export async function provisionPermissionlessPool(
  url,
  user,
  mint,
  tokenProgram,
  index = 1,
) {
  const [pool] = await poolAddress(user.address, mint, index),
    lpMint = await pda(PUMP_AMM, "pool_lp_mint", pool);
  const baseVault = await ata(pool, mint, tokenProgram),
    quoteVault = await ata(pool, SOL);
  const data = new Uint8Array(70);
  data.set([233, 146, 209, 142, 207, 104, 64, 188]);
  const view = new DataView(data.buffer);
  view.setUint16(8, index, true);
  view.setBigUint64(10, 100_000_000_000_000n, true);
  view.setBigUint64(18, 10_000_000_000n, true);
  data.set(encoder.encode(SYSTEM), 26);
  const instruction = {
    programAddress: PUMP_AMM,
    data,
    accounts: [
      writable(pool),
      readonly(await pda(PUMP_AMM, "global_config")),
      { address: user.address, role: AccountRole.WRITABLE_SIGNER },
      readonly(mint),
      readonly(SOL),
      writable(lpMint),
      writable(await ata(user.address, mint, tokenProgram)),
      writable(await ata(user.address, SOL)),
      writable(await ata(user.address, lpMint, TOKEN_2022)),
      writable(baseVault),
      writable(quoteVault),
      readonly(SYSTEM),
      readonly(TOKEN_2022),
      readonly(tokenProgram),
      readonly(TOKEN),
      readonly(ATA_PROGRAM),
      readonly(await pda(PUMP_AMM, "__event_authority")),
      readonly(PUMP_AMM),
    ],
  };
  await submitInstructions(
    url,
    [
      createAta(user.address, pool, mint, tokenProgram, baseVault),
      createAta(user.address, pool, SOL, TOKEN, quoteVault),
      instruction,
    ],
    user,
  );
  return pool;
}

export async function observeAmmRequest(url, request) {
  const epoch = await rpc(url, "getEpochInfo", [{ commitment: "confirmed" }]);
  const snapshot = {
    slot: BigInt(epoch.absoluteSlot),
    epoch: BigInt(epoch.epoch),
    unixTimestamp: BigInt(await rpc(url, "getBlockTime", [epoch.absoluteSlot])),
    accounts: {},
  };
  const observed = { ...request, snapshot };
  for (let round = 0; round < 6; round++) {
    const requirements = await ammSdk.getSwapRequirements(observed);
    assert.ok(
      requirements.ok,
      JSON.stringify(requirements, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    if (requirements.value.complete) return observed;
    const missing = requirements.value.missing;
    const response = await rpc(url, "getMultipleAccounts", [
      missing.map((a) => a.address),
      { encoding: "base64", commitment: "confirmed" },
    ]);
    snapshot.slot = BigInt(response.context.slot);
    response.value.forEach((value, index) => {
      const account = missing[index].address;
      snapshot.accounts[account] =
        value === null
          ? null
          : {
              address: account,
              owner: address(value.owner),
              data: Uint8Array.from(Buffer.from(value.data[0], "base64")),
              lamports: BigInt(value.lamports),
              executable: value.executable,
              slot: snapshot.slot,
            };
    });
  }
  assert.fail("Pump AMM discovery did not converge");
}
