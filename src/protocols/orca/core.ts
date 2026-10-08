import * as core from "./offline-core.js";

/**
 * Initialize the official Orca math core from embedded package bytes on first use.
 * @remarks WebAssembly instance state is module-local; no market or wallet state is retained.
 */
export function orcaCore(): typeof core {
  core.initialize();
  return core;
}
