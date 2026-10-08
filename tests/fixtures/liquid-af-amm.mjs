import { address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { LIQUID_AF_AMM_PROGRAM } from "../../dist/protocols/liquid-af-amm/constants.js";
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
export { LIQUID_AF_AMM_PROGRAM };
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/** Synthetic LiquidAF AMM with a single full-range fee tier and earning-mode user. */
export async function liquidAfAmmFixture(
  owner,
  {
    reverse = false,
    label = "default",
    nativeQuote = false,
    base2022 = true,
    lpBps = 25,
    protocolBps = 50,
    creatorBps = 25,
    cashbackBps = 0,
    feeTiers,
    unixTimestamp = 1_800_000_000n,
  } = {},
) {
  const creator = key(`amm-creator:${label}`),
    baseMint = key(`amm-base:${label}`),
    quoteMint = nativeQuote ? WSOL : USDC;
  const baseTokenProgram = base2022 ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS;
  const [pool] = await derive(LIQUID_AF_AMM_PROGRAM, "pool", baseMint, quoteMint);
  const [baseVault] = await derive(LIQUID_AF_AMM_PROGRAM, "pool_vault", pool, baseMint);
  const [quoteVault] = await derive(LIQUID_AF_AMM_PROGRAM, "pool_vault", pool, quoteMint);
  const [lpMint] = await derive(LIQUID_AF_AMM_PROGRAM, "pool_lp_mint", pool);
  const [observationState] = await derive(LIQUID_AF_AMM_PROGRAM, "observation", pool);
  const [authority, authorityBump] = await derive(
    LIQUID_AF_AMM_PROGRAM,
    "vault_and_lp_mint_auth_seed",
  );
  const [globalConfig, configBump] = await derive(LIQUID_AF_AMM_PROGRAM, "global_config");
  const [cpiAuthority] = await derive(LIQUID_AF_AMM_PROGRAM, "cpi_authority");
  const feeRecipient = key(`amm-fee-recipient:${label}`);
  const [protocolFeeVault] = await derive(
    LIQUID_AF_AMM_PROGRAM,
    "global_fee",
    feeRecipient,
    quoteMint,
  );
  const [buybackVault] = await derive(
    LIQUID_AF_AMM_PROGRAM,
    "buyback_vault",
    pool,
    quoteMint,
  );
  const userBase = key(`amm-user-base:${label}`),
    userQuote = key(`amm-user-quote:${label}`);
  const shared = await liquidAfSharedFixture({
    owner,
    creator,
    mint: baseMint,
    quoteMint,
    unixTimestamp,
    amm: true,
    cashbackBps,
  });
  const [feeVaultTokenAccount] = await findAssociatedTokenPda({
    owner: shared.feeVault,
    mint: quoteMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const { add, accounts } = shared;
  const data = new Uint8Array(316);
  data.set(discriminator("PoolState"));
  [
    baseVault,
    quoteVault,
    lpMint,
    baseMint,
    quoteMint,
    baseTokenProgram,
    TOKEN_PROGRAM_ADDRESS,
    observationState,
  ].forEach((key, index) => data.set(encoder.encode(key), 8 + index * 32));
  data[264] = 9;
  data[265] = 6;
  data[266] = nativeQuote ? 9 : 6;
  const view = new DataView(data.buffer);
  view.setBigUint64(267, 1_000_000_000n, true);
  data.set(encoder.encode(creator), 275);
  data[315] = authorityBump;
  add(pool, LIQUID_AF_AMM_PROGRAM, data);
  const config = new Uint8Array(512);
  config.set(discriminator("AmmConfig"));
  config.set(encoder.encode(creator), 8);
  for (let index = 0; index < 8; index++)
    config.set(encoder.encode(feeRecipient), 40 + index * 32);
  const cv = new DataView(config.buffer);
  cv.setUint32(296, 1, true);
  config.set(encoder.encode(quoteMint), 300);
  const tiers = feeTiers ?? [
    { start: 0n, end: (1n << 64n) - 1n, lpBps, protocolBps, creatorBps },
  ];
  cv.setUint32(332, tiers.length, true);
  let offset = 336;
  for (const tier of tiers) {
    cv.setBigUint64(offset, tier.start, true);
    cv.setBigUint64(offset + 8, tier.end, true);
    cv.setUint16(offset + 16, tier.lpBps, true);
    cv.setUint16(offset + 18, tier.protocolBps, true);
    cv.setUint16(offset + 20, tier.creatorBps, true);
    offset += 22;
  }
  config.set(encoder.encode(PYTH_PRICE_FEED), offset);
  config[offset + 33] = configBump;
  add(globalConfig, LIQUID_AF_AMM_PROGRAM, config);
  const observation = new Uint8Array(4075);
  observation.set(discriminator("ObservationState"));
  observation.set(encoder.encode(pool), 11);
  add(observationState, LIQUID_AF_AMM_PROGRAM, observation);
  add(baseMint, baseTokenProgram, mintData(10_000_000_000n));
  add(
    quoteMint,
    TOKEN_PROGRAM_ADDRESS,
    mintData(nativeQuote ? 0n : 20_000_000_000n, nativeQuote ? 9 : 6),
  );
  add(lpMint, TOKEN_PROGRAM_ADDRESS, mintData(1_000_000_000n, 9));
  add(baseVault, baseTokenProgram, tokenData(baseMint, authority, 2_000_000_000n));
  add(userBase, baseTokenProgram, tokenData(baseMint, owner, 3_000_000_000n));
  function addQuote(address, tokenOwner, amount) {
    const data = tokenData(quoteMint, tokenOwner, amount);
    if (nativeQuote) {
      const view = new DataView(data.buffer);
      view.setUint32(109, 1, true);
      view.setBigUint64(113, 2_039_280n, true);
    }
    add(
      address,
      TOKEN_PROGRAM_ADDRESS,
      data,
      nativeQuote ? amount + 2_039_280n : 100_000_000n,
    );
  }
  addQuote(quoteVault, authority, 1_000_000_000n);
  addQuote(userQuote, owner, 3_000_000_000n);
  addQuote(protocolFeeVault, authority, 1_000n);
  addQuote(feeVaultTokenAccount, shared.feeVault, 2_000n);
  addQuote(buybackVault, authority, 0n);
  for (const account of [creator, feeRecipient, authority, cpiAuthority])
    add(account, SYSTEM_PROGRAM_ADDRESS, new Uint8Array());
  return {
    pool,
    creator,
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
    lpMint,
    observationState,
    authority,
    globalConfig,
    cpiAuthority,
    feeRecipient,
    protocolFeeVault,
    buybackVault,
    userBase,
    userQuote,
    feeVaultTokenAccount,
    ...shared,
    instructionAccounts: {
      user: owner,
      pool,
      userBaseAccount: userBase,
      userQuoteAccount: userQuote,
      baseVault,
      quoteVault,
      observationState,
      feeRecipient,
      protocolFeeVault,
      feeVault: shared.feeVault,
      feeVaultTokenAccount,
      buybackVault,
      authority,
      globalConfig,
      creator,
      baseMint,
      quoteMint,
      feeConfig: shared.feeConfig,
      userProperties: shared.userProperties,
      globalAmmVolume: shared.globalVolume,
      tokenVolume: shared.tokenVolume,
      cashbackConfig: shared.cashbackConfig,
      stateEventsCpiAuthority: shared.stateEventsCpiAuthority,
      baseTokenProgram,
      quoteTokenProgram: TOKEN_PROGRAM_ADDRESS,
      cpiAuthority,
      oraclePriceFeed: PYTH_PRICE_FEED,
    },
    request: {
      pool,
      owner,
      payer: owner,
      inputMint: reverse ? baseMint : quoteMint,
      outputMint: reverse ? quoteMint : baseMint,
      amount: { kind: "exactIn", amountIn: 1_000_001n },
      slippageBps: 50,
      tokenAccounts: {
        input: reverse ? userBase : userQuote,
        output: reverse ? userQuote : userBase,
      },
      snapshot: { slot: 100n, epoch: 0n, unixTimestamp, accounts },
      fillPolicy: "requireFull",
    },
  };
}
