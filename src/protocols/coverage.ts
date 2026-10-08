import type { ProtocolId } from "../core/types.js";

/** A coverage entry distinguishes executable adapters from routing labels and disabled deployments. */
export type ProtocolCoverage = {
  readonly protocol: ProtocolId;
  readonly label: string;
} & (
  | { readonly status: "implemented" | "planned" }
  | {
      readonly status: "alias";
      readonly canonicalProtocols: readonly ProtocolId[];
      readonly note: string;
    }
  | { readonly status: "disabled"; readonly note: string }
);

/** Registry parity target from the inspected Axiom deployment; support is qualified per variant. */
export const PROTOCOL_COVERAGE: readonly ProtocolCoverage[] = [
  { protocol: "pump", label: "Pump V1", status: "implemented" },
  { protocol: "pump-amm", label: "Pump AMM", status: "implemented" },
  { protocol: "raydium-amm-v4", label: "Raydium V4", status: "implemented" },
  { protocol: "raydium-cpmm", label: "Raydium CPMM", status: "implemented" },
  { protocol: "raydium-clmm", label: "Raydium CLMM", status: "implemented" },
  { protocol: "meteora-damm-v1", label: "Meteora AMM", status: "implemented" },
  { protocol: "meteora-damm-v2", label: "Meteora AMM V2", status: "implemented" },
  { protocol: "meteora-dlmm", label: "Meteora DLMM", status: "implemented" },
  { protocol: "boop", label: "Boop", status: "implemented" },
  { protocol: "moonshot", label: "Moonshot", status: "implemented" },
  { protocol: "orca-whirlpool", label: "Orca", status: "implemented" },
  { protocol: "launchlab", label: "LaunchLab", status: "implemented" },
  { protocol: "virtual-curve", label: "Virtual Curve", status: "implemented" },
  { protocol: "vertigo", label: "Vertigo", status: "implemented" },
  { protocol: "heaven", label: "Heaven", status: "implemented" },
  {
    protocol: "sugar",
    label: "Sugar",
    status: "disabled",
    note: "Current native deployment immediately returns Custom(1); historical instruction builders only.",
  },
  {
    protocol: "stable-swap",
    label: "Stable Swap",
    status: "alias",
    canonicalProtocols: ["raydium-amm-v4", "raydium-clmm"],
    note: "Qualified Raydium variants only; active CLMM limit orders and the optional Poseidon route are unsupported.",
  },
  { protocol: "liquid-af", label: "LiquidAF", status: "implemented" },
  { protocol: "liquid-af-amm", label: "LiquidAF AMM", status: "implemented" },
  { protocol: "rise-rich", label: "Rise Rich", status: "implemented" },
  { protocol: "metadao", label: "MetaDAO", status: "implemented" },
];
