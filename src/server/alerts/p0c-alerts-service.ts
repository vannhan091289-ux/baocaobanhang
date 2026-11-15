import "server-only";
import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "@/server/audit";
import { getRuntimePool } from "@/server/db";
import {
  abort,
  authorize,
  fail,
  finalizeFailure,
  notFound,
  runAuthorityTransaction,
  tamperRejected,
  type Actor,
  type ServiceResult,
} from "@/server/service-core";
import {
  findDisallowedTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readPageParams,
  readString,
  validateQueryParams,
} from "@/server/validation";

export const ALERT_RULE_CODES = [
  "KPI_BEHIND_PACE",
  "MISSING_DAILY_REPORT",
  "OVERDUE_PIPELINE_FOLLOWUP",
  "CUSTOMER_RENEWAL_CARE",
  "OVERDUE_DIRECTIVE_TASK",
  "PENDING_APPROVAL_SLA",
] as const;
export type AlertRuleCode = (typeof ALERT_RULE_CODES)[number];

export const ALERT_RESOLUTION_STATUSES = [
  "OPEN",
  "RESOLVED",
  "DISMISSED",
] as const;
export type AlertResolutionStatus = (typeof ALERT_RESOLUTION_STATUSES)[number];

export interface AlertRuleConfigRow {
  id: string;
  rule_code: AlertRuleCode;
  rule_name: string;
  is_enabled: boolean;
  threshold_value: number;
  sla_working_days: number;
  severity: "P0" | "HIGH" | "MEDIUM";
  escalation_after_working_days: number;
  row_version: number;
  updated_at: string;
}

export interface InAppAlertRow {
  id: string;
  rule_code: AlertRuleCode;
  dedup_key: string;
  severity: "P0" | "HIGH" | "MEDIUM";
  target_scope: "BRANCH" | "DEPARTMENT" | "SELF";
  department_id: string;
  department_code: string;
  owner_staff_id: string;
  owner_staff_code: string;
  escalated_to_staff_id: string | null;
  title: string;
  summary: string;
  due_at: string | null;
  read_at: string | null;
  resolution_status: AlertResolutionStatus;
  resolution_note: string | null;
  resolution_evidence_ref: string | null;
  resolved_by_staff_id: string | null;
  resolved_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

function mapRule(r: Record<string, unknown>): AlertRuleConfigRow {
  return {
    id: String(r.id),
    rule_code: String(r.rule_code) as AlertRuleCode,
    rule_name: String(r.rule_name),
    is_enabled: Boolean(r.is_enabled),
    threshold_value: Number(r.threshold_value),
    sla_working_days: Number(r.sla_working_days),
    severity: String(r.severity) as "P0" | "HIGH" | "MEDIUM",
    escalation_after_working_days: Number(r.escalation_after_working_days),
    row_version: Number(r.row_version),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

function mapAlert(r: Record<string, unknown>): InAppAlertRow {
  return {
    id: String(r.id),
    rule_code: String(r.rule_code) as AlertRuleCode,
    dedup_key: String(r.dedup_key),
    severity: String(r.severity) as "P0" | "HIGH" | "MEDIUM",
    target_scope: String(r.target_scope) as "BRANCH" | "DEPARTMENT" | "SELF",
    department_id: String(r.department_id),
    department_code: String(r.department_code),
    owner_staff_id: String(r.owner_staff_id),
    owner_staff_code: String(r.owner_staff_code),
    escalated_to_staff_id: r.escalated_to_staff_id
      ? String(r.escalated_to_staff_id)
      : null,
    title: String(r.title),
    summary: String(r.summary),
    due_at: r.due_at ? new Date(String(r.due_at)).toISOString() : null,
    read_at: r.read_at ? new Date(String(r.read_at)).toISOString() : null,
    resolution_status: String(r.resolution_status) as AlertResolutionStatus,
    resolution_note: r.resolution_note ? String(r.resolution_note) : null,
    resolution_evidence_ref: r.resolution_evidence_ref
      ? String(r.resolution_evidence_ref)
      : null,
    resolved_by_staff_id: r.resolved_by_staff_id
      ? String(r.resolved_by_staff_id)
      : null,
    resolved_at: r.resolved_at
      ? new Date(String(r.resolved_at)).toISOString()
      : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

export async function listAlertRules(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<AlertRuleConfigRow[]>> {
  const qv = validateQueryParams(url.searchParams, []);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("alerts.rule.read", "alert_rule_config", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }
  const denied = authorize(
    actor,
    { action: "alerts.rule.read" },
    { type: "alert_rule_config", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const pool = getRuntimePool();
  const res = await pool.query(
    `SELECT * FROM alert_rule_configs ORDER BY rule_code ASC`,
  );
  return { ok: true, status: 200, data: res.rows.map(mapRule) };
}

export async function patchAlertRule(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<AlertRuleConfigRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "id",
    "expected_version",
    "is_enabled",
    "threshold_value",
    "sla_working_days",
    "severity",
    "escalation_after_working_days",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("alerts.rule.write", "alert_rule_config", tamperKey),
    );
  }

  const denied = authorize(
    actor,
    { action: "alerts.rule.write" },
    { type: "alert_rule_config", id: String(body.id ?? "rule") },
  );
  if (denied) return finalizeFailure(actor, denied);

  const idCheck = readString(body, "id", { max: 64 });
  if (!idCheck.ok || !idCheck.value || !isUuid(idCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "id must be a valid UUID");
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  const sevCheck = readString(body, "severity", { max: 16, optional: true });
  if (!sevCheck.ok) return fail(400, "VALIDATION_FAILED", sevCheck.reason);
  if (
    sevCheck.value &&
    sevCheck.value !== "P0" &&
    sevCheck.value !== "HIGH" &&
    sevCheck.value !== "MEDIUM"
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "severity must be P0, HIGH, or MEDIUM",
    );
  }
  if (
    body.threshold_value !== undefined &&
    (typeof body.threshold_value !== "number" ||
      !Number.isFinite(body.threshold_value) ||
      body.threshold_value < 0)
  ) {
    return fail(400, "VALIDATION_FAILED", "threshold_value must be >= 0");
  }
  if (
    body.sla_working_days !== undefined &&
    (typeof body.sla_working_days !== "number" ||
      !Number.isInteger(body.sla_working_days) ||
      body.sla_working_days < 0)
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "sla_working_days must be an integer >= 0",
    );
  }
  if (
    body.escalation_after_working_days !== undefined &&
    (typeof body.escalation_after_working_days !== "number" ||
      !Number.isInteger(body.escalation_after_working_days) ||
      body.escalation_after_working_days < 1)
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "escalation_after_working_days must be an integer >= 1",
    );
  }

  const ruleId = idCheck.value;
  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM alert_rule_configs WHERE id = $1 FOR UPDATE`,
      [ruleId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("alert_rule_config", ruleId, "alerts.rule.write");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(
        409,
        "VERSION_CONFLICT",
        "alert_rule_config version conflict",
      );
    }

    const nextEnabled =
      typeof body.is_enabled === "boolean"
        ? body.is_enabled
        : Boolean(existing.is_enabled);
    const nextThreshold =
      typeof body.threshold_value === "number"
        ? body.threshold_value
        : Number(existing.threshold_value);
    const nextSla =
      typeof body.sla_working_days === "number"
        ? body.sla_working_days
        : Number(existing.sla_working_days);
    const nextSev = sevCheck.value ?? String(existing.severity);
    const nextEsc =
      typeof body.escalation_after_working_days === "number"
        ? body.escalation_after_working_days
        : Number(existing.escalation_after_working_days);

    const updatedRes = await client.query(
      `UPDATE alert_rule_configs
       SET is_enabled = $1, threshold_value = $2, sla_working_days = $3,
           severity = $4, escalation_after_working_days = $5, updated_by_staff_id = $6
       WHERE id = $7
       RETURNING *`,
      [
        nextEnabled,
        nextThreshold,
        nextSla,
        nextSev,
        nextEsc,
        actor.ctx.staff_id,
        ruleId,
      ],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "alerts.rule.write",
      resourceType: "alert_rule_config",
      resourceId: ruleId,
      decision: "ALLOW",
      reasonCode: "ALERT_RULE_CONFIG_UPDATED",
      scopeContext: {
        rule_code: String(existing.rule_code),
        is_enabled: nextEnabled,
      },
    });

    return mapRule(updatedRes.rows[0]!);
  });
}

export async function listInAppAlerts(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<InAppAlertRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "rule_code",
    "resolution_status",
    "department_id",
    "owner_staff_id",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("alerts.read", "in_app_alert", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }
  const page = readPageParams(url.searchParams);
  if (!page.ok) return fail(400, "VALIDATION_FAILED", page.reason);

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  const ownerParam = url.searchParams.get("owner_staff_id") ?? undefined;
  const ruleParam = url.searchParams.get("rule_code") ?? undefined;
  const statusParam = url.searchParams.get("resolution_status") ?? undefined;

  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }
  if (ownerParam && !isUuid(ownerParam)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (ruleParam && !ALERT_RULE_CODES.includes(ruleParam as AlertRuleCode)) {
    return fail(400, "VALIDATION_FAILED", "Invalid rule_code");
  }
  if (
    statusParam &&
    !ALERT_RESOLUTION_STATUSES.includes(statusParam as AlertResolutionStatus)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid resolution_status");
  }

  const denied = authorize(
    actor,
    {
      action: "alerts.read",
      targetDepartmentId: deptParam,
      targetStaffId: ownerParam,
    },
    { type: "in_app_alert", id: ownerParam ?? deptParam ?? "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const where: string[] = [];
  const params: unknown[] = [];
  const roleCode = actor.ctx.effective_role.role_code;
  if (roleCode === "STAFF") {
    params.push(actor.ctx.staff_id);
    where.push(`a.owner_staff_id = $${params.length}`);
  } else if (roleCode === "DEPARTMENT_MANAGER") {
    params.push(actor.ctx.department.id);
    where.push(`a.department_id = $${params.length}`);
  }
  if (deptParam) {
    params.push(deptParam);
    where.push(`a.department_id = $${params.length}`);
  }
  if (ownerParam) {
    params.push(ownerParam);
    where.push(`a.owner_staff_id = $${params.length}`);
  }
  if (ruleParam) {
    params.push(ruleParam);
    where.push(`a.rule_code = $${params.length}`);
  }
  if (statusParam) {
    params.push(statusParam);
    where.push(`a.resolution_status = $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();
  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM in_app_alerts a ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  params.push(page.value.limit, page.value.offset);

  const res = await pool.query(
    `SELECT a.*, d.code AS department_code, s.staff_code AS owner_staff_code
     FROM in_app_alerts a
     JOIN departments d ON d.id = a.department_id
     JOIN staff s ON s.id = a.owner_staff_id
     ${whereSql}
     ORDER BY a.created_at DESC, a.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapAlert),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function evaluateP0Alerts(
  actor: Actor,
  body: unknown,
): Promise<
  ServiceResult<{
    created_count: number;
    escalated_count: number;
    alerts: InAppAlertRow[];
  }>
> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "as_of_date",
    "period_key",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("alerts.evaluate", "in_app_alert", tamperKey),
    );
  }

  const denied = authorize(
    actor,
    { action: "alerts.evaluate" },
    { type: "in_app_alert", id: "evaluate" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const asOfCheck = readString(body, "as_of_date", { max: 16, optional: true });
  if (!asOfCheck.ok) return fail(400, "VALIDATION_FAILED", asOfCheck.reason);
  const asOfDate = asOfCheck.value ?? "2026-11-14";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return fail(400, "VALIDATION_FAILED", "as_of_date must be YYYY-MM-DD");
  }

  const periodCheck = readString(body, "period_key", {
    max: 32,
    optional: true,
  });
  if (!periodCheck.ok)
    return fail(400, "VALIDATION_FAILED", periodCheck.reason);
  const periodKey = periodCheck.value ?? asOfDate.slice(0, 7);

  const roleCode = actor.ctx.effective_role.role_code;
  const scopeFilter =
    roleCode === "STAFF"
      ? { staffId: actor.ctx.staff_id, deptId: actor.ctx.department.id }
      : roleCode === "DEPARTMENT_MANAGER"
        ? { staffId: null, deptId: actor.ctx.department.id }
        : { staffId: null, deptId: null };

  return runAuthorityTransaction(actor, async (client) => {
    const rulesRes = await client.query(
      `SELECT * FROM alert_rule_configs WHERE is_enabled = TRUE`,
    );
    const rules = new Map<AlertRuleCode, AlertRuleConfigRow>();
    for (const r of rulesRes.rows) {
      rules.set(String(r.rule_code) as AlertRuleCode, mapRule(r));
    }

    const candidates: Array<{
      rule_code: AlertRuleCode;
      dedup_key: string;
      severity: "P0" | "HIGH" | "MEDIUM";
      target_scope: "BRANCH" | "DEPARTMENT" | "SELF";
      department_id: string;
      owner_staff_id: string;
      title: string;
      summary: string;
    }> = [];

    // 1. KPI_BEHIND_PACE — strictly ignores NULL actual_value (MISSING_DATA) (AC-02)
    const kpiRule = rules.get("KPI_BEHIND_PACE");
    if (kpiRule) {
      const kpiRes = await client.query(
        `SELECT a.kpi_definition_id, d.metric_code, a.department_id, a.primary_staff_id,
                a.actual_value, t.target_value
         FROM kpi_actual_records a
         JOIN kpi_definitions d ON d.id = a.kpi_definition_id
         JOIN kpi_targets t ON t.kpi_definition_id = a.kpi_definition_id
           AND t.period_type = a.period_type
           AND t.period_key = a.period_key
           AND t.status = 'APPROVED'
           AND (
             (t.scope_type = 'SELF' AND t.staff_id = a.primary_staff_id)
             OR (t.scope_type = 'DEPARTMENT' AND t.department_id = a.department_id)
             OR (t.scope_type = 'BRANCH')
           )
         WHERE a.period_key = $1
           AND a.actual_value IS NOT NULL
           AND t.target_value > 0
           AND ($2::uuid IS NULL OR a.department_id = $2)
           AND ($3::uuid IS NULL OR a.primary_staff_id = $3)`,
        [periodKey, scopeFilter.deptId, scopeFilter.staffId],
      );
      for (const row of kpiRes.rows) {
        const pct = (Number(row.actual_value) / Number(row.target_value)) * 100;
        if (pct < kpiRule.threshold_value) {
          candidates.push({
            rule_code: "KPI_BEHIND_PACE",
            dedup_key: `KPI_BEHIND_PACE:${row.kpi_definition_id}:${periodKey}:${row.primary_staff_id}`,
            severity: kpiRule.severity,
            target_scope: "SELF",
            department_id: String(row.department_id),
            owner_staff_id: String(row.primary_staff_id),
            title: `KPI ${row.metric_code} chậm tiến độ (${pct.toFixed(1)}%)`,
            summary: `Kết quả thực hiện kỳ ${periodKey} đang dưới ngưỡng ${kpiRule.threshold_value}%.`,
          });
        }
      }
    }

    // 2. OVERDUE_PIPELINE_FOLLOWUP (Leads past due_date / Opportunities past expected_close_date)
    const pipeRule = rules.get("OVERDUE_PIPELINE_FOLLOWUP");
    if (pipeRule) {
      const leadRes = await client.query(
        `SELECT id, lead_ref, department_id, owner_staff_id, due_date
         FROM leads
         WHERE stage NOT IN ('CONVERTED', 'LOST')
           AND due_date IS NOT NULL
           AND due_date < $1::date
           AND ($2::uuid IS NULL OR department_id = $2)
           AND ($3::uuid IS NULL OR owner_staff_id = $3)`,
        [asOfDate, scopeFilter.deptId, scopeFilter.staffId],
      );
      for (const row of leadRes.rows) {
        candidates.push({
          rule_code: "OVERDUE_PIPELINE_FOLLOWUP",
          dedup_key: `OVERDUE_PIPELINE_FOLLOWUP:LEAD:${row.id}`,
          severity: pipeRule.severity,
          target_scope: "SELF",
          department_id: String(row.department_id),
          owner_staff_id: String(row.owner_staff_id),
          title: `Lead ${row.lead_ref} quá hạn chăm sóc`,
          summary: `Lead chưa chuyển đổi đã quá hạn chăm sóc theo ngày chốt ${asOfDate}.`,
        });
      }
    }

    // 3. OVERDUE_DIRECTIVE_TASK
    const dirRule = rules.get("OVERDUE_DIRECTIVE_TASK");
    if (dirRule) {
      const dirRes = await client.query(
        `SELECT id, title, department_id, assignee_staff_id
         FROM directive_tasks
         WHERE status IN ('OPEN', 'IN_PROGRESS', 'OVERDUE')
           AND due_at IS NOT NULL
           AND (due_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < $1::date
           AND ($2::uuid IS NULL OR department_id = $2)
           AND ($3::uuid IS NULL OR assignee_staff_id = $3)`,
        [asOfDate, scopeFilter.deptId, scopeFilter.staffId],
      );
      for (const row of dirRes.rows) {
        candidates.push({
          rule_code: "OVERDUE_DIRECTIVE_TASK",
          dedup_key: `OVERDUE_DIRECTIVE_TASK:${row.id}`,
          severity: dirRule.severity,
          target_scope: "SELF",
          department_id: String(row.department_id),
          owner_staff_id: String(row.assignee_staff_id),
          title: `Chỉ đạo quá hạn: ${row.title}`,
          summary: `Công việc từ Review Thứ Hai đã quá hạn xử lý tại ngày ${asOfDate}.`,
        });
      }
    }

    // 4. MISSING_DAILY_REPORT
    const missingDailyRule = rules.get("MISSING_DAILY_REPORT");
    if (missingDailyRule) {
      const staffNoActivity = await client.query(
        `SELECT s.id AS staff_id, s.staff_code, s.department_id
         FROM staff s
         JOIN role_assignments ra ON ra.staff_id = s.id AND ra.effective_to IS NULL
         WHERE s.status = 'ACTIVE'
           AND ra.role_code = 'STAFF'
           AND ($1::uuid IS NULL OR s.department_id = $1)
           AND ($2::uuid IS NULL OR s.id = $2)
           AND NOT EXISTS (
             SELECT 1 FROM activity_logs al
             WHERE al.actor_staff_id = s.id
               AND (al.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $3::date
           )`,
        [scopeFilter.deptId, scopeFilter.staffId, asOfDate],
      );
      for (const row of staffNoActivity.rows) {
        candidates.push({
          rule_code: "MISSING_DAILY_REPORT",
          dedup_key: `MISSING_DAILY_REPORT:${row.staff_id}:${asOfDate}`,
          severity: missingDailyRule.severity,
          target_scope: "SELF",
          department_id: String(row.department_id),
          owner_staff_id: String(row.staff_id),
          title: `${row.staff_code} chưa ghi nhận hoạt động ngày ${asOfDate}`,
          summary: `Chưa có bản ghi activity_logs trong ngày làm việc ${asOfDate}.`,
        });
      }
    }

    // 5. PENDING_APPROVAL_SLA
    const pendingRule = rules.get("PENDING_APPROVAL_SLA");
    if (pendingRule) {
      const pendingTargets = await client.query(
        `SELECT id, period_key, department_id, proposed_by_staff_id
         FROM kpi_targets
         WHERE status = 'PENDING_APPROVAL'
           AND created_at < ($1::date - ($2::int * INTERVAL '1 day'))
           AND ($3::uuid IS NULL OR department_id = $3)`,
        [asOfDate, pendingRule.sla_working_days, scopeFilter.deptId],
      );
      for (const row of pendingTargets.rows) {
        if (row.department_id) {
          candidates.push({
            rule_code: "PENDING_APPROVAL_SLA",
            dedup_key: `PENDING_APPROVAL_SLA:TARGET:${row.id}`,
            severity: pendingRule.severity,
            target_scope: "DEPARTMENT",
            department_id: String(row.department_id),
            owner_staff_id: String(row.proposed_by_staff_id),
            title: `Chỉ tiêu KPI kỳ ${row.period_key} chờ duyệt quá SLA`,
            summary: `Hồ sơ chỉ tiêu ở trạng thái PENDING_APPROVAL vượt ngưỡng ${pendingRule.sla_working_days} ngày làm việc.`,
          });
        }
      }
    }

    // 6. CUSTOMER_RENEWAL_CARE (Opportunities approaching expected_close_date within threshold_value days)
    const careRule = rules.get("CUSTOMER_RENEWAL_CARE");
    if (careRule) {
      const careOpps = await client.query(
        `SELECT id, opportunity_ref, customer_ref, department_id, owner_staff_id
         FROM opportunities
         WHERE stage IN ('PROPOSAL', 'NEGOTIATION')
           AND expected_close_date IS NOT NULL
           AND expected_close_date <= ($1::date + ($2::int * INTERVAL '1 day'))
           AND ($3::uuid IS NULL OR department_id = $3)
           AND ($4::uuid IS NULL OR owner_staff_id = $4)`,
        [
          asOfDate,
          Math.floor(careRule.threshold_value),
          scopeFilter.deptId,
          scopeFilter.staffId,
        ],
      );
      for (const row of careOpps.rows) {
        candidates.push({
          rule_code: "CUSTOMER_RENEWAL_CARE",
          dedup_key: `CUSTOMER_RENEWAL_CARE:OPP:${row.id}`,
          severity: careRule.severity,
          target_scope: "SELF",
          department_id: String(row.department_id),
          owner_staff_id: String(row.owner_staff_id),
          title: `Chăm sóc KH ${row.customer_ref} (${row.opportunity_ref})`,
          summary: `Cơ hội sắp tới hạn tái cấp/chốt trong ${Math.floor(careRule.threshold_value)} ngày.`,
        });
      }

      const careMilestones = await client.query(
        `SELECT m.id, m.milestone_type, m.due_date, m.title,
                cr.customer_ref_code, cr.managing_department_id, cr.assigned_staff_id
         FROM customer_milestones m
         JOIN customer_references cr ON cr.id = m.customer_reference_id
         WHERE m.status = 'OPEN'
           AND cr.status = 'ACTIVE'
           AND m.due_date <= ($1::date + ($2::int * INTERVAL '1 day'))
           AND ($3::uuid IS NULL OR cr.managing_department_id = $3)
           AND ($4::uuid IS NULL OR cr.assigned_staff_id = $4)`,
        [
          asOfDate,
          Math.floor(careRule.threshold_value),
          scopeFilter.deptId,
          scopeFilter.staffId,
        ],
      );
      for (const row of careMilestones.rows) {
        const tag =
          row.milestone_type === "MATURITY"
            ? "[CUSTOMER_MATURITY_UPCOMING] "
            : "";
        candidates.push({
          rule_code: "CUSTOMER_RENEWAL_CARE",
          dedup_key: `CUSTOMER_RENEWAL_CARE:MILESTONE:${row.id}`,
          severity: careRule.severity,
          target_scope: "SELF",
          department_id: String(row.managing_department_id),
          owner_staff_id: String(row.assigned_staff_id),
          title: `${tag}Nhắc mốc ${row.milestone_type} KH ${row.customer_ref_code}: ${row.title}`,
          summary: `Mốc ${row.milestone_type} đến hạn trong ${Math.floor(careRule.threshold_value)} ngày tính từ ${asOfDate}.`,
        });
      }
    }

    let createdCount = 0;
    const insertedIds: string[] = [];
    for (const c of candidates) {
      const newId = randomUUID();
      const ins = await client.query(
        `INSERT INTO in_app_alerts (
           id, rule_code, dedup_key, severity, target_scope,
           department_id, owner_staff_id, title, summary
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING id`,
        [
          newId,
          c.rule_code,
          c.dedup_key,
          c.severity,
          c.target_scope,
          c.department_id,
          c.owner_staff_id,
          c.title,
          c.summary,
        ],
      );
      if ((ins.rowCount ?? 0) > 0) {
        createdCount += 1;
        insertedIds.push(newId);
      }
    }

    // 7. Escalate overdue OPEN alerts past escalation_after_working_days (M-05)
    const overdueOpenRes = await client.query<{
      id: string;
      rule_code: string;
      department_id: string;
      owner_staff_id: string;
      escalation_after_working_days: number;
    }>(
      `SELECT a.id, a.rule_code, a.department_id, a.owner_staff_id, r.escalation_after_working_days
       FROM in_app_alerts a
       JOIN alert_rule_configs r ON r.rule_code = a.rule_code
       WHERE a.resolution_status = 'OPEN'
         AND a.escalated_to_staff_id IS NULL
         AND r.is_enabled = TRUE
         AND ($1::uuid IS NULL OR a.department_id = $1)
         AND ($2::uuid IS NULL OR a.owner_staff_id = $2)
         AND (
           CASE
             WHEN EXISTS (
               SELECT 1 FROM branch_calendar_days bcd
               WHERE bcd.calendar_date > (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                 AND bcd.calendar_date <= $3::date
             ) THEN (
               SELECT count(*) FROM branch_calendar_days bcd
               WHERE bcd.calendar_date > (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                 AND bcd.calendar_date <= $3::date
                 AND bcd.is_working_day = TRUE
             ) >= r.escalation_after_working_days
             ELSE ($3::date - (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) >= r.escalation_after_working_days
           END
         )`,
      [scopeFilter.deptId, scopeFilter.staffId, asOfDate],
    );

    let escalatedCount = 0;
    for (const overdue of overdueOpenRes.rows) {
      const targetRes = await client.query<{ id: string }>(
        `SELECT s.id
         FROM staff s
         JOIN role_assignments ra
           ON ra.staff_id = s.id
          AND ra.status = 'ACTIVE'
          AND ra.effective_from <= CURRENT_TIMESTAMP
          AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_TIMESTAMP)
         WHERE s.status = 'ACTIVE'
           AND s.id <> $1
           AND (
             (ra.role_code = 'DEPARTMENT_MANAGER' AND s.department_id = $2)
             OR ra.role_code = 'EXECUTIVE'
           )
         ORDER BY CASE WHEN ra.role_code = 'DEPARTMENT_MANAGER' THEN 1 ELSE 2 END ASC,
                  s.staff_code ASC
         LIMIT 1`,
        [overdue.owner_staff_id, overdue.department_id],
      );
      const escalateToId = targetRes.rows[0]?.id;
      if (escalateToId) {
        await client.query(
          `UPDATE in_app_alerts
           SET escalated_to_staff_id = $1
           WHERE id = $2 AND escalated_to_staff_id IS NULL`,
          [escalateToId, overdue.id],
        );
        escalatedCount += 1;
        await appendAuditEvent(client, {
          actorStaffId: actor.ctx.staff_id,
          actorSubjectRef: `staff:${actor.ctx.staff_id}`,
          action: "alerts.escalate",
          resourceType: "in_app_alert",
          resourceId: overdue.id,
          decision: "ALLOW",
          reasonCode: "P0_ALERT_ESCALATED",
          scopeContext: {
            escalated_to_staff_id: escalateToId,
            rule_code: overdue.rule_code,
            escalation_after_working_days:
              overdue.escalation_after_working_days,
            as_of_date: asOfDate,
          },
        });
      }
    }

    const alertsRes =
      insertedIds.length > 0
        ? await client.query(
            `SELECT a.*, d.code AS department_code, s.staff_code AS owner_staff_code
             FROM in_app_alerts a
             JOIN departments d ON d.id = a.department_id
             JOIN staff s ON s.id = a.owner_staff_id
             WHERE a.id = ANY($1::uuid[])`,
            [insertedIds],
          )
        : { rows: [] };

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "alerts.evaluate",
      resourceType: "in_app_alert",
      resourceId: "evaluate",
      decision: "ALLOW",
      reasonCode: "P0_ALERTS_EVALUATED",
      scopeContext: {
        as_of_date: asOfDate,
        created_count: createdCount,
        escalated_count: escalatedCount,
      },
    });

    return {
      created_count: createdCount,
      escalated_count: escalatedCount,
      alerts: alertsRes.rows.map(mapAlert),
    };
  });
}

export async function markAlertRead(
  actor: Actor,
  alertId: string,
  body: unknown,
): Promise<ServiceResult<InAppAlertRow>> {
  if (!isUuid(alertId)) {
    return fail(400, "VALIDATION_FAILED", "alertId must be a valid UUID");
  }
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "expected_version",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("alerts.read_mark", "in_app_alert", tamperKey),
    );
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM in_app_alerts WHERE id = $1 FOR UPDATE`,
      [alertId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("in_app_alert", alertId, "alerts.read_mark");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "alerts.read_mark",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.owner_staff_id),
      },
      { type: "in_app_alert", id: alertId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(409, "VERSION_CONFLICT", "in_app_alert version conflict");
    }

    // AC-03: read_at does NOT change resolution_status!
    await client.query(
      `UPDATE in_app_alerts
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = $1`,
      [alertId],
    );

    const rowRes = await client.query(
      `SELECT a.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM in_app_alerts a
       JOIN departments d ON d.id = a.department_id
       JOIN staff s ON s.id = a.owner_staff_id
       WHERE a.id = $1`,
      [alertId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "alerts.read_mark",
      resourceType: "in_app_alert",
      resourceId: alertId,
      decision: "ALLOW",
      reasonCode: "ALERT_MARKED_READ",
    });

    return mapAlert(rowRes.rows[0]!);
  });
}

export async function resolveInAppAlert(
  actor: Actor,
  alertId: string,
  body: unknown,
): Promise<ServiceResult<InAppAlertRow>> {
  if (!isUuid(alertId)) {
    return fail(400, "VALIDATION_FAILED", "alertId must be a valid UUID");
  }
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "expected_version",
    "resolution_status",
    "resolution_note",
    "resolution_evidence_ref",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("alerts.resolve", "in_app_alert", tamperKey),
    );
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  const statusCheck = readString(body, "resolution_status", { max: 16 });
  if (!statusCheck.ok || !statusCheck.value) {
    return fail(400, "VALIDATION_FAILED", "resolution_status is required");
  }
  if (statusCheck.value !== "RESOLVED" && statusCheck.value !== "DISMISSED") {
    return fail(
      400,
      "VALIDATION_FAILED",
      "resolution_status must be RESOLVED or DISMISSED",
    );
  }

  const noteCheck = readString(body, "resolution_note", {
    max: 500,
    optional: true,
  });
  const evCheck = readString(body, "resolution_evidence_ref", {
    max: 160,
    optional: true,
  });
  if (!noteCheck.ok) return fail(400, "VALIDATION_FAILED", noteCheck.reason);
  if (!evCheck.ok) return fail(400, "VALIDATION_FAILED", evCheck.reason);

  if (!noteCheck.value && !evCheck.value) {
    return fail(
      400,
      "RESOLUTION_EVIDENCE_REQUIRED",
      "resolution_evidence_ref or resolution_note is required to close an alert",
    );
  }

  const nextStatus = statusCheck.value;
  const noteVal = noteCheck.value ?? null;
  const evVal = evCheck.value ?? null;

  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM in_app_alerts WHERE id = $1 FOR UPDATE`,
      [alertId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("in_app_alert", alertId, "alerts.resolve");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "alerts.resolve",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.owner_staff_id),
      },
      { type: "in_app_alert", id: alertId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(409, "VERSION_CONFLICT", "in_app_alert version conflict");
    }

    await client.query(
      `UPDATE in_app_alerts
       SET resolution_status = $1,
           resolution_note = $2,
           resolution_evidence_ref = $3,
           resolved_by_staff_id = $4,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [nextStatus, noteVal, evVal, actor.ctx.staff_id, alertId],
    );

    const rowRes = await client.query(
      `SELECT a.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM in_app_alerts a
       JOIN departments d ON d.id = a.department_id
       JOIN staff s ON s.id = a.owner_staff_id
       WHERE a.id = $1`,
      [alertId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "alerts.resolve",
      resourceType: "in_app_alert",
      resourceId: alertId,
      decision: "ALLOW",
      reasonCode: `ALERT_${nextStatus}`,
      scopeContext: {
        resolution_status: nextStatus,
        has_evidence_ref: Boolean(evVal),
      },
    });

    return mapAlert(rowRes.rows[0]!);
  });
}
