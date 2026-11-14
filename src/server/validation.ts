import "server-only";

/**
 * Minimal strict input validation for S1-B (no extra dependency; TASK-0004 §4).
 * Every validator returns a discriminated result and never throws on bad input.
 */

export type Validation<T> =
  { ok: true; value: T } | { ok: false; field: string; reason: string };

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys that clients must never be able to supply to override server-derived authority. */
export const TAMPER_KEYS: readonly string[] = [
  "role",
  "role_code_override",
  "scope",
  "scope_type",
  "proposer_staff_id",
  "approver_staff_id",
  "actor_staff_id",
  "decided_at",
  "approval_reference",
];

export function findTamperKey(keys: Iterable<string>): string | null {
  for (const key of keys) {
    if (TAMPER_KEYS.includes(key.toLowerCase())) return key;
  }
  return null;
}

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): Validation<true> {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return { ok: false, field: key, reason: "UNKNOWN_FIELD" };
    }
  }
  return { ok: true, value: true };
}

export function readString(
  obj: Record<string, unknown>,
  field: string,
  opts: { min?: number; max: number; pattern?: RegExp; optional?: boolean },
): Validation<string | undefined> {
  const raw = obj[field];
  if (raw === undefined || raw === null) {
    return opts.optional
      ? { ok: true, value: undefined }
      : { ok: false, field, reason: "REQUIRED" };
  }
  if (typeof raw !== "string") {
    return { ok: false, field, reason: "MUST_BE_STRING" };
  }
  const value = raw.trim();
  if (value.length < (opts.min ?? 1)) {
    return { ok: false, field, reason: "TOO_SHORT" };
  }
  if (value.length > opts.max) {
    return { ok: false, field, reason: "TOO_LONG" };
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    return { ok: false, field, reason: "INVALID_FORMAT" };
  }
  return { ok: true, value };
}

export function readUuid(
  obj: Record<string, unknown>,
  field: string,
  optional = false,
): Validation<string | undefined> {
  const raw = obj[field];
  if (raw === undefined || raw === null) {
    return optional
      ? { ok: true, value: undefined }
      : { ok: false, field, reason: "REQUIRED" };
  }
  if (!isUuid(raw)) return { ok: false, field, reason: "INVALID_UUID" };
  return { ok: true, value: raw.toLowerCase() };
}

export function readExpectedVersion(
  obj: Record<string, unknown>,
): Validation<number> {
  const raw = obj.expected_version;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return { ok: false, field: "expected_version", reason: "INVALID_VERSION" };
  }
  return { ok: true, value: raw };
}

export function readIsoInstant(
  obj: Record<string, unknown>,
  field: string,
  optional = true,
): Validation<Date | undefined> {
  const raw = obj[field];
  if (raw === undefined || raw === null) {
    return optional
      ? { ok: true, value: undefined }
      : { ok: false, field, reason: "REQUIRED" };
  }
  // Strict UTC instant (ends with Z) so stored instants never depend on a session time zone.
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(raw)
  ) {
    return { ok: false, field, reason: "MUST_BE_UTC_ISO_INSTANT" };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, field, reason: "INVALID_DATE" };
  }
  return { ok: true, value: date };
}

export interface PageParams {
  limit: number;
  offset: number;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export function readPageParams(
  params: URLSearchParams,
): Validation<PageParams> {
  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  let limit = DEFAULT_PAGE_LIMIT;
  let offset = 0;
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) {
      return { ok: false, field: "limit", reason: "INVALID_LIMIT" };
    }
    limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_PAGE_LIMIT) {
      return { ok: false, field: "limit", reason: "INVALID_LIMIT" };
    }
  }
  if (offsetRaw !== null) {
    if (!/^\d{1,6}$/.test(offsetRaw)) {
      return { ok: false, field: "offset", reason: "INVALID_OFFSET" };
    }
    offset = Number(offsetRaw);
  }
  return { ok: true, value: { limit, offset } };
}

/** Escapes LIKE wildcards so client search text can never widen a match. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
