import { findAssociatedTokenPda } from "@solana-program/token";
import { LIQUID_AF_PROGRAM } from "../../dist/protocols/liquid-af/constants.js";
import {
  discriminator,
  derive,
  encoder,
  key,
  liquidAfSharedFixture,
  mintData,
  tokenData,
  WSOL,
  PYTH_PRICE_FEED,
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
} from "./liquid-af-common.mjs";
export { LIQUID_AF_PROGRAM };
/** Synthetic active native-SOL bonding curve and its shared state dependencies. */
export async function liquidAfFixture(
  owner,
  {
    reverse = false,
    label = "default",
    creatorBps = 25,
    protocolBps = 50,
    cashbackBps = 0,
    unixTimestamp = 1_800_000_000n,
  } = {},
) {
  const creator = key(`creator:${label}`);
  const mint = key(`mint:${label}`);
  const [pool, bump] = await derive(LIQUID_AF_PROGRAM, "bonding_curve", mint);
  const [solVault] = await derive(LIQUID_AF_PROGRAM, "bonding_curve_sol_vault", pool);
  const [tokenVault] = await findAssociatedTokenPda({
    owner: pool,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const [buybackVault] = await derive(LIQUID_AF_PROGRAM, "buyback_vault", pool);
  const [globalConfig, configBump] = await derive(LIQUID_AF_PROGRAM, "global_config");
  const [cpiAuthority] = await derive(LIQUID_AF_PROGRAM, "cpi_authority");
  const feeRecipient = key(`fee-recipient:${label}`);
  const userToken = key(`user-token:${label}`);
  const shared = await liquidAfSharedFixture({
    owner,
    creator,
    mint,
    quoteMint: WSOL,
    unixTimestamp,
    cashbackBps,
  });
  const { add, accounts } = shared;
  const data = new Uint8Array(147);
  data.set(discriminator("BondingCurve"));
  data.set(encoder.encode(creator), 8);
  data.set(encoder.encode(mint), 40);
  const view = new DataView(data.buffer);
  view.setBigUint64(73, 2_000_000_000n, true);
  view.setBigUint64(81, 3_000_000_000n, true);
  view.setBigUint64(89, 1_000_000_000n, true);
  view.setBigUint64(97, 1_000_000_000n, true);
  view.setBigUint64(105, 4_000_000_000n, true);
  data[114] = bump;
  add(pool, LIQUID_AF_PROGRAM, data);
  const config = new Uint8Array(512);
  config.set(discriminator("GlobalConfiguration"));
  config.set(encoder.encode(creator), 8);
  const cv = new DataView(config.buffer);
  for (const [offset, value] of [
    [40, 150_000_000n],
    [48, 1_000_000_000n],
    [56, 4_000_000_000n],
    [64, 3_000_000_000n],
    [72, 4_000_000_000n],
  ])
    cv.setBigUint64(offset, value, true);
  cv.setUint16(80, creatorBps, true);
  cv.setUint16(86, protocolBps, true);
  for (let index = 0; index < 8; index++)
    config.set(encoder.encode(feeRecipient), 88 + index * 32);
  config.set(encoder.encode(PYTH_PRICE_FEED), 344);
  config[382] = configBump;
  add(globalConfig, LIQUID_AF_PROGRAM, config);
  add(mint, TOKEN_2022_PROGRAM_ADDRESS, mintData(4_000_000_000n));
  add(WSOL, TOKEN_PROGRAM_ADDRESS, mintData(0n, 9));
  add(tokenVault, TOKEN_2022_PROGRAM_ADDRESS, tokenData(mint, pool, 2_000_000_000n));
  add(userToken, TOKEN_2022_PROGRAM_ADDRESS, tokenData(mint, owner, 2_000_000_000n));
  add(solVault, SYSTEM_PROGRAM_ADDRESS, new Uint8Array(), 1_000_890_880n);
  for (const account of [buybackVault, feeRecipient, cpiAuthority])
    add(account, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  return {
    pool,
    creator,
    mint,
    solVault,
    tokenVault,
    buybackVault,
    feeRecipient,
    userToken,
    globalConfig,
    cpiAuthority,
    ...shared,
    instructionAccounts: {
      user: owner,
      feeRecipient,
      bondingCurve: pool,
      bondingCurveSolVault: solVault,
      bondingCurveTokenAccount: tokenVault,
      userTokenAccount: userToken,
      feeVault: shared.feeVault,
      buybackVault,
      globalConfig,
      mint,
      feeConfig: shared.feeConfig,
      creatorUserProperties: shared.creatorUserProperties,
      userProperties: shared.userProperties,
      globalCurveVolume: shared.globalVolume,
      tokenVolume: shared.tokenVolume,
      cashbackConfig: shared.cashbackConfig,
      stateEventsCpiAuthority: shared.stateEventsCpiAuthority,
      pythPriceFeed: PYTH_PRICE_FEED,
      cpiAuthority,
    },
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? mint : WSOL,
      outputMint: reverse ? WSOL : mint,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      tokenAccounts: {
        input: reverse ? userToken : owner,
        output: reverse ? owner : userToken,
      },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp, accounts },
      fillPolicy: reverse ? "requireFull" : "allowPartial",
    },
  };
}
