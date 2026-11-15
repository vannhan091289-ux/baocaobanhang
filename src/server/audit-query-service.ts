import "server-only";
import { sanitizeAuditScopeContext } from "./audit";
import { getRuntimePool } from "./db";
import {
  authorize,
  fail,
  finalizeFailure,
  tamperRejected,
  type Actor,
  type ServiceResult,
} from "./service-core";
import { readPageParams, validateQueryParams } from "./validation";

export interface AuditEventView {
  id: string;
  occurred_at: string;
  actor_staff_id: string | null;
  actor_staff_code: string | null;
  actor_display_name: string | null;
  actor_subject_ref: string;
  action: string;
  resource_type: string;
  resource_id: string;
  scope_context: Record<string, string | number | boolean | null>;
  decision: "ALLOW" | "DENY";
  reason_code: string;
  policy_version: string;
}

export interface AuditEventsPayload {
  items: AuditEventView[];
  privilege_restricted: boolean;
  notice?: string;
}

/**
 * Read-only audit log listing for CONFIG_ADMIN and EXECUTIVE.
 * Rejects DEPARTMENT_MANAGER and STAFF with 403 ACTION_FORBIDDEN_FOR_ROLE.
 * Respects least-privilege DB grant: if app_runtime_role is INSERT-only on
 * audit_events (per migration 0002), returns privilege_restricted=true cleanly.
 */
export async function listAuditEvents(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<AuditEventsPayload>> {
  const qv = validateQueryParams(url.searchParams, [
    "decision",
    "action",
    "resource_type",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("audit.read", "audit_event", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }

  const denied = authorize(
    actor,
    { action: "audit.read" },
    { type: "audit_event", id: "branch" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const decisionParam = url.searchParams.get("decision")?.trim() || null;
  if (decisionParam && decisionParam !== "ALLOW" && decisionParam !== "DENY") {
    return fail(400, "VALIDATION_FAILED", "decision must be ALLOW or DENY");
  }

  const actionParam = url.searchParams.get("action")?.trim() || null;
  const resourceTypeParam =
    url.searchParams.get("resource_type")?.trim() || null;
  const page = readPageParams(url.searchParams);
  if (!page.ok) {
    return fail(400, "VALIDATION_FAILED", page.reason);
  }
  const { limit, offset } = page.value;

  const pool = getRuntimePool();
  try {
    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM audit_events ae
         WHERE ($1::text IS NULL OR ae.decision = $1)
           AND ($2::text IS NULL OR ae.action = $2)
           AND ($3::text IS NULL OR ae.resource_type = $3)`,
        [decisionParam, actionParam, resourceTypeParam],
      ),
      pool.query(
        `SELECT ae.id, ae.occurred_at, ae.actor_staff_id,
                s.staff_code AS actor_staff_code,
                s.display_name AS actor_display_name,
                ae.actor_subject_ref, ae.action, ae.resource_type,
                ae.resource_id, ae.scope_context, ae.decision,
                ae.reason_code, ae.policy_version
         FROM audit_events ae
         LEFT JOIN staff s ON s.id = ae.actor_staff_id
         WHERE ($1::text IS NULL OR ae.decision = $1)
           AND ($2::text IS NULL OR ae.action = $2)
           AND ($3::text IS NULL OR ae.resource_type = $3)
         ORDER BY ae.occurred_at DESC
         LIMIT $4 OFFSET $5`,
        [decisionParam, actionParam, resourceTypeParam, limit, offset],
      ),
    ]);

    const total = Number(countRes.rows[0]?.total ?? 0);
    const items: AuditEventView[] = rowsRes.rows.map((r) => ({
      id: String(r.id),
      occurred_at: new Date(r.occurred_at as string | Date).toISOString(),
      actor_staff_id: r.actor_staff_id ? String(r.actor_staff_id) : null,
      actor_staff_code: r.actor_staff_code ? String(r.actor_staff_code) : null,
      actor_display_name: r.actor_display_name
        ? String(r.actor_display_name)
        : null,
      actor_subject_ref: String(r.actor_subject_ref),
      action: String(r.action),
      resource_type: String(r.resource_type),
      resource_id: String(r.resource_id),
      scope_context: sanitizeAuditScopeContext(
        (r.scope_context as Record<string, string | number | boolean | null>) ??
          {},
      ),
      decision: r.decision === "DENY" ? "DENY" : "ALLOW",
      reason_code: String(r.reason_code),
      policy_version: String(r.policy_version),
    }));

    return {
      ok: true,
      status: 200,
      data: { items, privilege_restricted: false },
      page: { limit, offset, total },
    };
  } catch (err) {
    const pgCode =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (pgCode === "42501") {
      return {
        ok: true,
        status: 200,
        data: {
          items: [],
          privilege_restricted: true,
          notice:
            "app_runtime_role hiện chỉ có quyền INSERT-only trên audit_events (least-privilege theo migration 0002). Cần migration/SECURITY DEFINER view được phê duyệt riêng để bật đọc audit_events trên runtime.",
        },
        page: { limit, offset, total: 0 },
      };
    }
    throw err;
  }
}
