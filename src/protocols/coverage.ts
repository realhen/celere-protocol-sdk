import type { ProtocolId } from "../core/types.js";

/** Native protocol coverage; adapter status does not restrict access to instruction builders. */
export type ProtocolCoverage = {
  readonly protocol: ProtocolId;
  readonly label: string;
} & (
  | { readonly status: "implemented" | "planned" }
  | { readonly status: "disabled"; readonly note: string }
);

/** Native protocol inventory; optional quote adapters are qualified per variant. */
export const PROTOCOL_COVERAGE: readonly ProtocolCoverage[] = [
  { protocol: "pump", label: "Pump", status: "implemented" },
  { protocol: "pump-amm", label: "PumpSwap", status: "implemented" },
  { protocol: "raydium-amm-v4", label: "Raydium AMM v4", status: "implemented" },
  { protocol: "raydium-cpmm", label: "Raydium CPMM", status: "implemented" },
  { protocol: "raydium-clmm", label: "Raydium CLMM", status: "implemented" },
  { protocol: "meteora-damm-v1", label: "Meteora DAMM v1", status: "implemented" },
  { protocol: "meteora-damm-v2", label: "Meteora DAMM v2", status: "implemented" },
  { protocol: "meteora-dlmm", label: "Meteora DLMM", status: "implemented" },
  { protocol: "boop", label: "Boop", status: "implemented" },
  { protocol: "moonshot", label: "Moonshot / Moonit", status: "implemented" },
  { protocol: "orca-whirlpool", label: "Orca Whirlpool", status: "implemented" },
  { protocol: "launchlab", label: "Raydium LaunchLab", status: "implemented" },
  { protocol: "meteora-dbc", label: "Meteora DBC", status: "implemented" },
  { protocol: "vertigo", label: "Vertigo", status: "implemented" },
  { protocol: "heaven", label: "Heaven", status: "implemented" },
  {
    protocol: "sugar",
    label: "Sugar",
    status: "disabled",
    note: "Current native deployment immediately returns Custom(1); historical instruction builders only.",
  },
  { protocol: "liquid-af", label: "LiquidAF", status: "implemented" },
  { protocol: "liquid-af-amm", label: "LiquidAF AMM", status: "implemented" },
  { protocol: "rise-rich", label: "Rise Rich", status: "implemented" },
  { protocol: "metadao", label: "MetaDAO Futarchy", status: "implemented" },
];
