import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  findMoonshotCurvePda,
  getMoonshotCurveAddresses,
  getMoonshotTokenVaultAddress,
} from "celere-protocol-sdk/protocols/moonshot";
import {
  findMetaDaoDaoPda,
  getMetaDaoDaoAddress,
  getMetaDaoTokenVaultAddress,
  getMetaDaoEventAuthorityAddress,
} from "celere-protocol-sdk/protocols/metadao";

type Addresses<Names extends string> = Readonly<Record<Names, Address>>;

/** Derive subscription targets from caller-owned stream fields without constructing a swap request. */
export async function otherProtocolSubscriptionAddresses(input: {
  readonly baseMint: Address;
  readonly creator: Address;
  readonly daoNonce: bigint;
}): Promise<readonly Address[]> {
  const pdas: readonly ProgramDerivedAddress[] = await Promise.all([
    findMoonshotCurvePda(input.baseMint),
    findMetaDaoDaoPda(input.creator, input.daoNonce),
  ]);
  const moonshot: Addresses<"curve" | "config"> & {
    readonly curveBump: number;
    readonly configBump: number;
  } = await getMoonshotCurveAddresses(input.baseMint);
  const dao: Address = await getMetaDaoDaoAddress(input.creator, input.daoNonce);
  const addresses: readonly Address[] = await Promise.all([
    getMoonshotTokenVaultAddress(moonshot.curve, input.baseMint),
    getMetaDaoTokenVaultAddress(dao, input.baseMint),
    getMetaDaoEventAuthorityAddress(),
  ]);
  const bumps: readonly number[] = [
    ...pdas.map(([, bump]) => bump),
    moonshot.curveBump,
    moonshot.configBump,
  ];
  void bumps;
  return [...pdas.map(([address]) => address), moonshot.config, ...addresses];
}
