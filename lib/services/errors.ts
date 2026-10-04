import { NotFoundError, SlugTakenError } from "@/lib/db/repositories/shared";
import { SlotUnavailableError } from "@/lib/db/repositories/meetings";

export { NotFoundError, SlotUnavailableError, SlugTakenError };
export { PlanLimitError, isPlanLimitError } from "./plan-limits";

export type ServiceErrorCode = "invalid_input" | "conflict" | "unauthorized" | "rate_limited";

const STATUS: Record<ServiceErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  conflict: 409,
  rate_limited: 429,
};

/**
 * A request the service refuses for a reason the caller can act on (bad
 * input, wrong state, bad token, too many requests). `message` is safe to
 * show in the UI.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  constructor(code: ServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError || (error instanceof Error && error.name === "NotFoundError");
}

export function isSlotUnavailableError(error: unknown): error is SlotUnavailableError {
  return error instanceof SlotUnavailableError || (error instanceof Error && error.name === "SlotUnavailableError");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids reach Postgres `uuid` columns; a malformed one would be a 500, so treat it as not found. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function assertUuid(value: unknown, what: string): asserts value is string {
  if (!isUuid(value)) throw new NotFoundError(what);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
