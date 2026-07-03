export const ErrorCode = {
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  ValidationFailed: "VALIDATION_FAILED",
  RateLimited: "RATE_LIMITED",
  Internal: "INTERNAL_ERROR",

  // negocio
  SlotUnavailable: "SLOT_UNAVAILABLE",
  CustomerAlreadyHasAppointment: "CUSTOMER_ALREADY_HAS_APPOINTMENT",
  MfaRequired: "MFA_REQUIRED",
  MfaInvalid: "MFA_INVALID",
  AccountLocked: "ACCOUNT_LOCKED",
  TechSpecsUnlockRequired: "TECH_SPECS_UNLOCK_REQUIRED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
