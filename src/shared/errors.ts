/** Request-validation codes shared by protocol builders and transaction compilation. */
export enum ValidationErrorCode {
  InvalidRequest = "INVALID_REQUEST",
}

/** A caller supplied an invalid value for a named request field. */
export class InvalidRequestError extends Error {
  readonly code = ValidationErrorCode.InvalidRequest;
  /** Field or property path the caller should correct. */
  readonly field: string;

  /** @param options - Invalid field and a human-readable explanation of the requirement. */
  constructor(options: { readonly field: string; readonly message: string }) {
    super(options.message);
    this.name = "InvalidRequestError";
    this.field = options.field;
  }
}
