import "server-only";
import { randomUUID } from "node:crypto";
import type { Queryable } from "./db";

export const POLICY_VERSION = "ADR-002-v0.3-DEVTEST";

export type AuditDecision = "ALLOW" | "DENY";

export interface AuditEventInput {
  occurredAt?: Date;
  actorStaffId: string | null;
  actorSubjectRef: string;
  action: string;
  resourceType: string;
  resourceId: string;
  scopeContext?: Record<string, string | number | boolean | null>;
  decision: AuditDecision;
  reasonCode: string;
  policyVersion?: string;
}

const FORBIDDEN_SECRET_KEY_PATTERN =
  /password|secret|token|cookie|verifier|authorization|claim|email|phone|cccd|cmnd/i;

const JWT_LIKE_VALUE_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/**
 * Sanitizes scopeContext to guarantee that no tokens, secrets, cookies, raw claims,
 * or PII ever enter the audit_events table (ADR-002 §5 Redaction Contract).
 */
export function sanitizeAuditScopeContext(
  raw?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_SECRET_KEY_PATTERN.test(k)) {
      clean[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") {
      if (JWT_LIKE_VALUE_PATTERN.test(v) || v.length > 160) {
        clean[k] = "[REDACTED]";
      } else {
        clean[k] = v;
      }
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      clean[k] = v;
    }
  }
  return clean;
}

/**
 * Appends an immutable AuditEvent row using a parameterized INSERT.
 * Throws if the database insert fails so callers can enforce exact failure semantics:
 * - Login ALLOW: called inside the same DB transaction as session creation; failure rolls back session creation.
 * - DENY: caller catches audit error and still returns DENY (never turns DENY into ALLOW).
 * - Logout/Revoke: caller commits session revocation first, then calls appendAuditEvent; if it throws, session stays revoked and caller reports safe audit error code.
 */
export async function appendAuditEvent(
  db: Queryable,
  input: AuditEventInput,
): Promise<string> {
  const id = randomUUID();
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const safeScope = sanitizeAuditScopeContext(input.scopeContext);
  const safeSubjectRef =
    JWT_LIKE_VALUE_PATTERN.test(input.actorSubjectRef) ||
    input.actorSubjectRef.length > 160
      ? "[REDACTED_SUBJECT_REF]"
      : input.actorSubjectRef;

  await db.query(
    `INSERT INTO audit_events (
       id, occurred_at, actor_staff_id, actor_subject_ref,
       action, resource_type, resource_id, scope_context,
       decision, reason_code, policy_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
    [
      id,
      occurredAt,
      input.actorStaffId,
      safeSubjectRef,
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify(safeScope),
      input.decision,
      input.reasonCode,
      input.policyVersion ?? POLICY_VERSION,
    ],
  );

  return id;
}

/**
 * Best-effort wrapper for recording DENY audit events without ever turning a DENY into an ALLOW
 * if the audit store experiences an error.
 */
export async function recordDenyAuditSafely(
  db: Queryable,
  input: Omit<AuditEventInput, "decision">,
): Promise<{ auditRecorded: boolean; auditEventId?: string }> {
  try {
    const auditEventId = await appendAuditEvent(db, {
      ...input,
      decision: "DENY",
    });
    return { auditRecorded: true, auditEventId };
  } catch {
    return { auditRecorded: false };
  }
}
