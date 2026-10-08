import type { ProtocolId } from "../core/types.js";

/** Registry parity target from the inspected Axiom deployment; support is qualified per variant. */
export const PROTOCOL_COVERAGE: readonly {
  readonly protocol: ProtocolId;
  readonly label: string;
  readonly status: "implemented" | "planned";
}[] = [
  { protocol: "pump", label: "Pump V1", status: "implemented" },
  { protocol: "pump-amm", label: "Pump AMM", status: "implemented" },
  { protocol: "raydium-amm-v4", label: "Raydium V4", status: "planned" },
  { protocol: "raydium-cpmm", label: "Raydium CPMM", status: "implemented" },
  { protocol: "raydium-clmm", label: "Raydium CLMM", status: "planned" },
  { protocol: "meteora-damm-v1", label: "Meteora AMM", status: "planned" },
  { protocol: "meteora-damm-v2", label: "Meteora AMM V2", status: "implemented" },
  { protocol: "meteora-dlmm", label: "Meteora DLMM", status: "planned" },
  { protocol: "boop", label: "Boop", status: "planned" },
  { protocol: "moonshot", label: "Moonshot", status: "planned" },
  { protocol: "orca-whirlpool", label: "Orca", status: "implemented" },
  { protocol: "launchlab", label: "LaunchLab", status: "implemented" },
  { protocol: "virtual-curve", label: "Virtual Curve", status: "planned" },
  { protocol: "vertigo", label: "Vertigo", status: "planned" },
  { protocol: "heaven", label: "Heaven", status: "planned" },
  { protocol: "sugar", label: "Sugar", status: "planned" },
  { protocol: "stable-swap", label: "Stable Swap", status: "planned" },
  { protocol: "liquid-af", label: "LiquidAF", status: "planned" },
  { protocol: "liquid-af-amm", label: "LiquidAF AMM", status: "planned" },
  { protocol: "rise-rich", label: "Rise Rich", status: "planned" },
  { protocol: "metadao", label: "MetaDAO", status: "planned" },
];
