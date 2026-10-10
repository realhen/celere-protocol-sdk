import type { SenderError } from "./errors/index.js";

/** Internal validation result. Public methods preserve their documented throw/reject boundary. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SenderError };
