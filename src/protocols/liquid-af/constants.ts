import { address } from "@solana/kit";

/** LiquidAF's bonding-curve deployment. */
export const LIQUID_AF_PROGRAM = address("LiquidsqH2a9gsPRf1M2QFhFqfLXWYTDZGzbsNQCDux");
/** Shared LiquidAF fee configuration owner. */
export const LIQUID_AF_FEES_PROGRAM = address(
  "FeesZQLb1xTeZbvaFRGnqzrZYzzmQtwhTYKQphbNGQru",
);
/** Shared LiquidAF user, cashback and volume state owner. */
export const LIQUID_AF_STATE_PROGRAM = address(
  "State3HtEfi7cXdsTpAtRoBvrij8zSFCiGTAVWmYH2d",
);
/** Shared LiquidAF event emission program. */
export const LIQUID_AF_EVENTS_PROGRAM = address(
  "EventsQeXA43nLKR69DhHwNsJ6aM512AweMCgG3wG8zG",
);
/** Pyth receiver owning the SOL/USD pull price account. */
export const LIQUID_AF_PYTH_RECEIVER_PROGRAM = address(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);
