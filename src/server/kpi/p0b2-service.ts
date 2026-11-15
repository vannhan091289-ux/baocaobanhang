import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
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
  type ServiceFailure,
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
  isValidIsoDate,
} from "@/server/validation";
import {
  KPI_PERIOD_TYPES,
  type KpiAttributionMode,
  type KpiGroupCode,
  type KpiMetricType,
  type KpiPeriodType,
  type KpiTimeAggRule,
  type KpiUnitCode,
} from "./p0a-service";
import {
  ALL_SEVEN_KPI_GROUPS,
  aggregateAttributedValuesByTimeRule,
  computeAttributedValue,
  computeExpectedProgressPct,
  computeKpiProgress,
  deriveAggregateReconciliationStatus,
  resolvePeriodDateRange,
  round2,
  type DataStatus,
  type ReconciliationStatus,
  type ViewerScopeLevel,
} from "./aggregation";

export const RECONCILIATION_STATUSES = [
  "PROVISIONAL",
  "RECONCILED",
  "FINAL",
] as const;

export interface KpiActualRow {
  id: string;
  kpi_definition_id: string;
  metric_code: string;
  metric_name: string;
  group_code: KpiGroupCode;
  unit_code: KpiUnitCode;
  metric_type: KpiMetricType;
  period_type: KpiPeriodType;
  period_key: string;
  as_of_date: string;
  department_id: string;
  department_code: string;
  primary_staff_id: string;
  primary_staff_code: string;
  referrer_staff_id: string | null;
  referrer_staff_code: string | null;
  actual_value: number | null;
  data_status: "OK" | "MISSING_DATA";
  reconciliation_status: ReconciliationStatus;
  source_code: string;
  source_ref: string | null;
  notes: string | null;
  recorded_by_staff_id: string;
  reconciled_by_staff_id: string | null;
  reconciled_at: string | null;
  finalized_by_staff_id: string | null;
  finalized_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  adjustments_count: number;
}

export interface DashboardKpiItem {
  kpi_definition_id: string;
  metric_code: string;
  metric_name: string;
  group_code: KpiGroupCode;
  unit_code: KpiUnitCode;
  metric_type: KpiMetricType;
  time_aggregation_rule: KpiTimeAggRule;
  attribution_mode: KpiAttributionMode;
  target_value: number | null;
  actual_value: number | null;
  data_status: DataStatus;
  gap: number | null;
  completion_pct: number | null;
  expected_progress_pct: number | null;
  variance_vs_expected_pct: number | null;
  reconciliation_status: ReconciliationStatus | "MISSING_DATA";
  as_of_date: string;
  source_code: string;
  records_count: number;
}

export interface DashboardGroupSummary {
  group_code: KpiGroupCode;
  metrics_count: number;
  ok_count: number;
  missing_data_count: number;
  target_non_positive_count: number;
  metrics: DashboardKpiItem[];
}

export interface DashboardDrilldownEntity {
  entity_type: "DEPARTMENT" | "STAFF";
  entity_id: string;
  entity_code: string;
  entity_name: string;
  department_id: string;
  metrics_with_data: number;
  metrics_missing_data: number;
  items: Array<{
    kpi_definition_id: string;
    metric_code: string;
    group_code: KpiGroupCode;
    target_value: number | null;
    actual_value: number | null;
    data_status: DataStatus;
    gap: number | null;
    completion_pct: number | null;
    reconciliation_status: ReconciliationStatus | "MISSING_DATA";
  }>;
}

export interface DashboardOverviewPayload {
  viewer_role: string;
  viewer_scope: ViewerScopeLevel;
  period_type: KpiPeriodType;
  period_key: string;
  as_of_date: string;
  expected_progress_pct: number | null;
  no_composite_score: true;
  groups: DashboardGroupSummary[];
  drilldown_departments: DashboardDrilldownEntity[];
  drilldown_staff: DashboardDrilldownEntity[];
}

function formatPgDate(val: unknown): string {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function readNullableActualNumber(
  value: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; failure: ServiceFailure } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      failure: fail(
        400,
        "VALIDATION_FAILED",
        `${field} must be a finite number or null (MISSING_DATA)`,
      ),
    };
  }
  return { ok: true, value: round2(value) };
}

function getCurrentVnDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "11";
  const d = parts.find((p) => p.type === "day")?.value ?? "14";
  return `${y}-${m}-${d}`;
}

function getDefaultPeriodKey(
  periodType: KpiPeriodType,
  asOfDate: string,
): string {
  if (periodType === "DAY") return asOfDate;
  if (periodType === "MONTH") return asOfDate.slice(0, 7);
  if (periodType === "YEAR") return asOfDate.slice(0, 4);
  const dt = new Date(`${asOfDate}T00:00:00Z`);
  const dayNum = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function mapActualRow(r: Record<string, unknown>): KpiActualRow {
  const rawVal = r.actual_value;
  const actualValue =
    rawVal === null || rawVal === undefined ? null : Number(rawVal);
  return {
    id: String(r.id),
    kpi_definition_id: String(r.kpi_definition_id),
    metric_code: String(r.metric_code),
    metric_name: String(r.metric_name),
    group_code: String(r.group_code) as KpiGroupCode,
    unit_code: String(r.unit_code) as KpiUnitCode,
    metric_type: String(r.metric_type) as KpiMetricType,
    period_type: String(r.period_type) as KpiPeriodType,
    period_key: String(r.period_key),
    as_of_date: formatPgDate(r.as_of_date),
    department_id: String(r.department_id),
    department_code: String(r.department_code),
    primary_staff_id: String(r.primary_staff_id),
    primary_staff_code: String(r.primary_staff_code),
    referrer_staff_id: r.referrer_staff_id ? String(r.referrer_staff_id) : null,
    referrer_staff_code: r.referrer_staff_code
      ? String(r.referrer_staff_code)
      : null,
    actual_value: actualValue,
    data_status: actualValue === null ? "MISSING_DATA" : "OK",
    reconciliation_status: String(
      r.reconciliation_status,
    ) as ReconciliationStatus,
    source_code: String(r.source_code),
    source_ref: r.source_ref ? String(r.source_ref) : null,
    notes: r.notes ? String(r.notes) : null,
    recorded_by_staff_id: String(r.recorded_by_staff_id),
    reconciled_by_staff_id: r.reconciled_by_staff_id
      ? String(r.reconciled_by_staff_id)
      : null,
    reconciled_at: r.reconciled_at
      ? new Date(String(r.reconciled_at)).toISOString()
      : null,
    finalized_by_staff_id: r.finalized_by_staff_id
      ? String(r.finalized_by_staff_id)
      : null,
    finalized_at: r.finalized_at
      ? new Date(String(r.finalized_at)).toISOString()
      : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
    adjustments_count: Number(r.adjustments_count ?? 0),
  };
}

export async function listKpiActuals(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<KpiActualRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "period_type",
    "period_key",
    "department_id",
    "staff_id",
    "kpi_definition_id",
    "reconciliation_status",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("kpi.actual.read", "kpi_actual_record", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }

  const page = readPageParams(url.searchParams);
  if (!page.ok) {
    return fail(400, "VALIDATION_FAILED", page.reason);
  }

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  const staffParam = url.searchParams.get("staff_id") ?? undefined;
  const defParam = url.searchParams.get("kpi_definition_id") ?? undefined;
  const periodTypeParam = url.searchParams.get("period_type") ?? undefined;
  const periodKeyParam = url.searchParams.get("period_key") ?? undefined;
  const statusParam =
    url.searchParams.get("reconciliation_status") ?? undefined;

  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }
  if (staffParam && !isUuid(staffParam)) {
    return fail(400, "VALIDATION_FAILED", "staff_id must be a valid UUID");
  }
  if (defParam && !isUuid(defParam)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "kpi_definition_id must be a valid UUID",
    );
  }
  if (
    periodTypeParam &&
    !KPI_PERIOD_TYPES.includes(periodTypeParam as KpiPeriodType)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid period_type");
  }
  if (
    statusParam &&
    !RECONCILIATION_STATUSES.includes(statusParam as ReconciliationStatus)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid reconciliation_status");
  }

  const denied = authorize(
    actor,
    {
      action: "kpi.actual.read",
      targetDepartmentId: deptParam,
      targetStaffId: staffParam,
    },
    { type: "kpi_actual_record", id: staffParam ?? deptParam ?? "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const pool = getRuntimePool();
  const where: string[] = [];
  const params: unknown[] = [];

  const roleCode = actor.ctx.effective_role.role_code;
  if (roleCode === "STAFF") {
    params.push(actor.ctx.staff_id);
    where.push(
      `(a.primary_staff_id = $${params.length} OR a.referrer_staff_id = $${params.length})`,
    );
  } else if (roleCode === "DEPARTMENT_MANAGER") {
    params.push(actor.ctx.department.id);
    where.push(
      `(a.department_id = $${params.length} OR ref_s.department_id = $${params.length})`,
    );
  }

  if (deptParam) {
    params.push(deptParam);
    where.push(`a.department_id = $${params.length}`);
  }
  if (staffParam) {
    params.push(staffParam);
    where.push(
      `(a.primary_staff_id = $${params.length} OR a.referrer_staff_id = $${params.length})`,
    );
  }
  if (defParam) {
    params.push(defParam);
    where.push(`a.kpi_definition_id = $${params.length}`);
  }
  if (periodTypeParam) {
    params.push(periodTypeParam);
    where.push(`a.period_type = $${params.length}`);
  }
  if (periodKeyParam) {
    params.push(periodKeyParam);
    where.push(`a.period_key = $${params.length}`);
  }
  if (statusParam) {
    params.push(statusParam);
    where.push(`a.reconciliation_status = $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM kpi_actual_records a
     LEFT JOIN staff ref_s ON ref_s.id = a.referrer_staff_id
     ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  params.push(page.value.limit);
  params.push(page.value.offset);

  const res = await pool.query(
    `SELECT a.*, d.metric_code, d.metric_name, d.group_code, d.unit_code, d.metric_type,
            dept.code AS department_code,
            ps.staff_code AS primary_staff_code,
            ref_s.staff_code AS referrer_staff_code,
            (SELECT COUNT(*)::int FROM kpi_actual_adjustments adj WHERE adj.actual_record_id = a.id) AS adjustments_count
     FROM kpi_actual_records a
     JOIN kpi_definitions d ON d.id = a.kpi_definition_id
     JOIN departments dept ON dept.id = a.department_id
     JOIN staff ps ON ps.id = a.primary_staff_id
     LEFT JOIN staff ref_s ON ref_s.id = a.referrer_staff_id
     ${whereSql}
     ORDER BY a.as_of_date DESC, a.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapActualRow),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

async function fetchSingleActualRow(
  client: PoolClient,
  id: string,
): Promise<KpiActualRow | null> {
  const res = await client.query(
    `SELECT a.*, d.metric_code, d.metric_name, d.group_code, d.unit_code, d.metric_type,
            dept.code AS department_code,
            ps.staff_code AS primary_staff_code,
            ref_s.staff_code AS referrer_staff_code,
            (SELECT COUNT(*)::int FROM kpi_actual_adjustments adj WHERE adj.actual_record_id = a.id) AS adjustments_count
     FROM kpi_actual_records a
     JOIN kpi_definitions d ON d.id = a.kpi_definition_id
     JOIN departments dept ON dept.id = a.department_id
     JOIN staff ps ON ps.id = a.primary_staff_id
     LEFT JOIN staff ref_s ON ref_s.id = a.referrer_staff_id
     WHERE a.id = $1`,
    [id],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  const row = res.rows[0];
  return row ? mapActualRow(row) : null;
}

export async function createKpiActual(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiActualRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "kpi_definition_id",
    "period_type",
    "period_key",
    "as_of_date",
    "primary_staff_id",
    "referrer_staff_id",
    "actual_value",
    "source_code",
    "source_ref",
    "notes",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.actual.write", "kpi_actual_record", tamperKey),
    );
  }

  const defId = readString(body, "kpi_definition_id", { max: 64 });
  const periodType = readString(body, "period_type", { max: 16 });
  const periodKey = readString(body, "period_key", { max: 32 });
  const asOfDate = readString(body, "as_of_date", { max: 16 });
  const primaryStaffId = readString(body, "primary_staff_id", { max: 64 });
  const referrerStaffId = readString(body, "referrer_staff_id", {
    max: 64,
    optional: true,
  });
  const sourceCode = readString(body, "source_code", {
    max: 64,
    optional: true,
  });
  const sourceRef = readString(body, "source_ref", {
    max: 160,
    optional: true,
  });
  const notes = readString(body, "notes", { max: 500, optional: true });

  for (const r of [
    defId,
    periodType,
    periodKey,
    asOfDate,
    primaryStaffId,
    referrerStaffId,
    sourceCode,
    sourceRef,
    notes,
  ]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }

  if (!defId.ok || !defId.value || !isUuid(defId.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "kpi_definition_id must be a valid UUID",
    );
  }
  if (
    !primaryStaffId.ok ||
    !primaryStaffId.value ||
    !isUuid(primaryStaffId.value)
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "primary_staff_id must be a valid UUID",
    );
  }
  if (
    referrerStaffId.ok &&
    referrerStaffId.value &&
    !isUuid(referrerStaffId.value)
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "referrer_staff_id must be a valid UUID",
    );
  }
  if (referrerStaffId.ok && referrerStaffId.value === primaryStaffId.value) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "referrer_staff_id cannot equal primary_staff_id",
    );
  }
  if (
    !periodType.ok ||
    !periodType.value ||
    !KPI_PERIOD_TYPES.includes(periodType.value as KpiPeriodType)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid period_type");
  }
  if (!asOfDate.ok || !asOfDate.value || !isValidIsoDate(asOfDate.value)) {
    return fail(400, "VALIDATION_FAILED", "as_of_date must be YYYY-MM-DD");
  }
  if (
    !periodKey.ok ||
    !periodKey.value ||
    !resolvePeriodDateRange(periodType.value as KpiPeriodType, periodKey.value)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid period_key for period_type");
  }

  const valCheck = readNullableActualNumber(body.actual_value, "actual_value");
  if (!valCheck.ok) return valCheck.failure;

  const defIdVal = defId.value;
  const periodTypeVal = periodType.value;
  const periodKeyVal = periodKey.value;
  const asOfDateVal = asOfDate.value;
  const targetStaffIdVal = primaryStaffId.value;
  const referrerStaffIdVal = referrerStaffId.ok ? referrerStaffId.value : null;
  const sourceCodeVal =
    sourceCode.ok && sourceCode.value ? sourceCode.value : "SYNTHETIC_DEVTEST";
  const sourceRefVal = sourceRef.ok ? sourceRef.value : null;
  const notesVal = notes.ok ? notes.value : null;

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const staffRes = await client.query(
      `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
      [targetStaffIdVal],
    );
    if ((staffRes.rowCount ?? 0) === 0) {
      return abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy nhân sự.",
      );
    }
    const staffDeptId = String(staffRes.rows[0]?.department_id);

    const denied = authorize(
      actor,
      {
        action: "kpi.actual.write",
        targetDepartmentId: staffDeptId,
        targetStaffId: targetStaffIdVal,
      },
      { type: "kpi_actual_record", id: targetStaffIdVal },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    const defRes = await client.query(
      `SELECT id FROM kpi_definitions WHERE id = $1 AND status = 'ACTIVE'`,
      [defIdVal],
    );
    if ((defRes.rowCount ?? 0) === 0) {
      return abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy KPI.",
      );
    }

    if (referrerStaffIdVal) {
      const refRes = await client.query(
        `SELECT id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
        [referrerStaffIdVal],
      );
      if ((refRes.rowCount ?? 0) === 0) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhân sự giới thiệu.",
        );
      }
    }

    const newId = randomUUID();
    await client.query(
      `INSERT INTO kpi_actual_records (
         id, kpi_definition_id, period_type, period_key, as_of_date,
         department_id, primary_staff_id, referrer_staff_id,
         actual_value, reconciliation_status, source_code, source_ref, notes,
         recorded_by_staff_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PROVISIONAL', $10, $11, $12, $13)`,
      [
        newId,
        defIdVal,
        periodTypeVal,
        periodKeyVal,
        asOfDateVal,
        staffDeptId,
        targetStaffIdVal,
        referrerStaffIdVal,
        valCheck.value,
        sourceCodeVal,
        sourceRefVal,
        notesVal,
        actor.ctx.staff_id,
      ],
    );

    const created = await fetchSingleActualRow(client, newId);
    if (!created) {
      return abort(
        500,
        "INTERNAL_ERROR",
        "Failed to load created actual record",
      );
    }

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "kpi.actual.write",
      resourceType: "kpi_actual_record",
      resourceId: newId,
      decision: "ALLOW",
      reasonCode: "ACTUAL_PROVISIONAL_RECORDED",
      scopeContext: {
        period_type: periodTypeVal,
        period_key: periodKeyVal,
        reconciliation_status: "PROVISIONAL",
      },
    });

    return created;
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function patchKpiActual(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiActualRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "id",
    "expected_version",
    "actual_value",
    "notes",
    "source_ref",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.actual.write", "kpi_actual_record", tamperKey),
    );
  }

  const idCheck = readString(body, "id", { max: 64 });
  if (!idCheck.ok || !idCheck.value || !isUuid(idCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "id must be a valid UUID");
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok) {
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);
  }

  const valCheck =
    body.actual_value !== undefined
      ? readNullableActualNumber(body.actual_value, "actual_value")
      : null;
  if (valCheck && !valCheck.ok) return valCheck.failure;

  const notes = readString(body, "notes", { max: 500, optional: true });
  if (!notes.ok) return fail(400, "VALIDATION_FAILED", notes.reason);
  const sourceRef = readString(body, "source_ref", {
    max: 160,
    optional: true,
  });
  if (!sourceRef.ok) return fail(400, "VALIDATION_FAILED", sourceRef.reason);

  const recordId = idCheck.value;

  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM kpi_actual_records WHERE id = $1 FOR UPDATE`,
      [recordId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("kpi_actual_record", recordId, "kpi.actual.write");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "kpi.actual.write",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.primary_staff_id),
      },
      { type: "kpi_actual_record", id: recordId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    if (String(existing.reconciliation_status) === "FINAL") {
      return abort(
        409,
        "FINAL_RECORD_REQUIRES_ADJUSTMENT",
        "FINAL actual record cannot be directly edited; use retrospective adjustment workflow",
      );
    }

    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(
        409,
        "VERSION_CONFLICT",
        "kpi_actual_record version conflict",
      );
    }

    const nextActualValue = valCheck
      ? valCheck.value
      : existing.actual_value === null
        ? null
        : Number(existing.actual_value);
    const nextNotes =
      body.notes !== undefined
        ? notes.value
        : (existing.notes as string | null);
    const nextSourceRef =
      body.source_ref !== undefined
        ? sourceRef.value
        : (existing.source_ref as string | null);

    await client.query(
      `UPDATE kpi_actual_records
       SET actual_value = $1, notes = $2, source_ref = $3
       WHERE id = $4`,
      [nextActualValue, nextNotes, nextSourceRef, recordId],
    );

    const updated = await fetchSingleActualRow(client, recordId);
    if (!updated) {
      return abort(
        500,
        "INTERNAL_ERROR",
        "Failed to load updated actual record",
      );
    }

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "kpi.actual.write",
      resourceType: "kpi_actual_record",
      resourceId: recordId,
      decision: "ALLOW",
      reasonCode: "ACTUAL_RECORD_UPDATED",
      scopeContext: {
        row_version: updated.row_version,
      },
    });

    return updated;
  });
}

export async function reconcileKpiActual(
  actor: Actor,
  actualId: string,
  body: unknown,
): Promise<ServiceResult<KpiActualRow>> {
  if (!isUuid(actualId)) {
    return fail(400, "VALIDATION_FAILED", "actualId must be a valid UUID");
  }
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "reconcile_action",
    "expected_version",
    "actual_value",
    "adjustment_reason",
    "source_ref",
    "approved_by_staff_id",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.actual.reconcile", "kpi_actual_record", tamperKey),
    );
  }

  const actionCheck = readString(body, "reconcile_action", { max: 32 });
  if (!actionCheck.ok || !actionCheck.value) {
    return fail(
      400,
      "VALIDATION_FAILED",
      actionCheck.ok ? "reconcile_action is required" : actionCheck.reason,
    );
  }
  const reconcileAction = actionCheck.value;
  if (
    reconcileAction !== "RECONCILE" &&
    reconcileAction !== "FINALIZE" &&
    reconcileAction !== "ADJUST_FINAL"
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "reconcile_action must be RECONCILE, FINALIZE, or ADJUST_FINAL",
    );
  }

  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok) {
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);
  }

  const reasonCheck = readString(body, "adjustment_reason", {
    max: 500,
    optional: reconcileAction !== "ADJUST_FINAL",
  });
  if (!reasonCheck.ok)
    return fail(400, "VALIDATION_FAILED", reasonCheck.reason);

  const sourceRefCheck = readString(body, "source_ref", {
    max: 160,
    optional: true,
  });
  if (!sourceRefCheck.ok) {
    return fail(400, "VALIDATION_FAILED", sourceRefCheck.reason);
  }

  const approverCheck = readString(body, "approved_by_staff_id", {
    max: 64,
    optional: reconcileAction !== "ADJUST_FINAL",
  });
  if (!approverCheck.ok) {
    return fail(400, "VALIDATION_FAILED", approverCheck.reason);
  }
  if (approverCheck.value && !isUuid(approverCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "approved_by_staff_id must be a valid UUID",
    );
  }

  let newVal: number | null | undefined = undefined;
  if (reconcileAction === "ADJUST_FINAL" || body.actual_value !== undefined) {
    const valCheck = readNullableActualNumber(
      body.actual_value,
      "actual_value",
    );
    if (!valCheck.ok) return valCheck.failure;
    newVal = valCheck.value;
  }

  const approverIdVal = approverCheck.value;
  const reasonVal = reasonCheck.value;
  const sourceRefVal = sourceRefCheck.value;

  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM kpi_actual_records WHERE id = $1 FOR UPDATE`,
      [actualId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound(
        "kpi_actual_record",
        actualId,
        "kpi.actual.reconcile",
      );
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const currentStatus = String(
      existing.reconciliation_status,
    ) as ReconciliationStatus;

    const policyAction =
      reconcileAction === "ADJUST_FINAL"
        ? "kpi.actual.adjust_final"
        : "kpi.actual.reconcile";

    const denied = authorize(
      actor,
      {
        action: policyAction,
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.primary_staff_id),
        proposerStaffId:
          reconcileAction === "ADJUST_FINAL"
            ? (approverIdVal ?? undefined)
            : undefined,
      },
      { type: "kpi_actual_record", id: actualId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(
        409,
        "VERSION_CONFLICT",
        "kpi_actual_record version conflict",
      );
    }

    const prevVal =
      existing.actual_value === null ? null : Number(existing.actual_value);

    if (reconcileAction === "RECONCILE") {
      if (currentStatus !== "PROVISIONAL") {
        return abort(
          409,
          "INVALID_RECONCILE_TRANSITION",
          `Cannot RECONCILE record in status ${currentStatus}`,
        );
      }
      const nextVal = newVal !== undefined ? newVal : prevVal;
      await client.query(
        `UPDATE kpi_actual_records
         SET actual_value = $1,
             reconciliation_status = 'RECONCILED',
             reconciled_by_staff_id = $2,
             reconciled_at = CURRENT_TIMESTAMP,
             source_ref = COALESCE($3, source_ref)
         WHERE id = $4`,
        [nextVal, actor.ctx.staff_id, sourceRefVal, actualId],
      );
    } else if (reconcileAction === "FINALIZE") {
      if (currentStatus !== "RECONCILED") {
        return abort(
          409,
          "INVALID_RECONCILE_TRANSITION",
          `Cannot FINALIZE record in status ${currentStatus}; must be RECONCILED first`,
        );
      }
      await client.query(
        `UPDATE kpi_actual_records
         SET reconciliation_status = 'FINAL',
             finalized_by_staff_id = $1,
             finalized_at = CURRENT_TIMESTAMP,
             source_ref = COALESCE($2, source_ref)
         WHERE id = $3`,
        [actor.ctx.staff_id, sourceRefVal, actualId],
      );
    } else {
      if (currentStatus !== "FINAL") {
        return abort(
          409,
          "INVALID_RECONCILE_TRANSITION",
          "ADJUST_FINAL is only valid for FINAL records",
        );
      }
      if (!approverIdVal || !reasonVal) {
        return abort(
          400,
          "VALIDATION_FAILED",
          "approved_by_staff_id and adjustment_reason are required",
        );
      }
      const approverRes = await client.query<{
        id: string;
        department_id: string;
        role_code: string;
      }>(
        `SELECT s.id, s.department_id, ra.role_code
         FROM staff s
         JOIN role_assignments ra
           ON ra.staff_id = s.id
          AND ra.status = 'ACTIVE'
          AND ra.effective_from <= CURRENT_TIMESTAMP
          AND (ra.effective_to IS NULL OR ra.effective_to > CURRENT_TIMESTAMP)
         WHERE s.id = $1 AND s.status = 'ACTIVE'
         ORDER BY CASE ra.role_code
           WHEN 'EXECUTIVE' THEN 1
           WHEN 'DEPARTMENT_MANAGER' THEN 2
           ELSE 3
         END ASC
         LIMIT 1`,
        [approverIdVal],
      );
      if ((approverRes.rowCount ?? 0) === 0) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy người phê duyệt.",
          {
            denyAudit: {
              action: "kpi.actual.adjust_final",
              resourceType: "kpi_actual_record",
              resourceId: actualId,
              scopeContext: {
                reason: "INVALID_ADJUSTMENT_APPROVER",
                approved_by_staff_id: approverIdVal,
              },
              reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            },
          },
        );
      }
      const approverRow = approverRes.rows[0]!;
      const approverRole = String(approverRow.role_code);
      if (
        approverRole !== "EXECUTIVE" &&
        approverRole !== "DEPARTMENT_MANAGER"
      ) {
        return abort(
          403,
          "INVALID_ADJUSTMENT_APPROVER",
          "Approver must hold EXECUTIVE or DEPARTMENT_MANAGER role",
          {
            denyAudit: {
              action: "kpi.actual.adjust_final",
              resourceType: "kpi_actual_record",
              resourceId: actualId,
              scopeContext: {
                reason: "INVALID_ADJUSTMENT_APPROVER_ROLE",
                approved_by_staff_id: approverIdVal,
                approver_role: approverRole,
              },
              reasonCode: "INVALID_ADJUSTMENT_APPROVER",
            },
          },
        );
      }
      if (
        approverRole === "DEPARTMENT_MANAGER" &&
        String(approverRow.department_id) !== String(existing.department_id)
      ) {
        return abort(
          403,
          "INVALID_ADJUSTMENT_APPROVER",
          "Department manager approver must belong to the same department",
          {
            denyAudit: {
              action: "kpi.actual.adjust_final",
              resourceType: "kpi_actual_record",
              resourceId: actualId,
              scopeContext: {
                reason: "INVALID_ADJUSTMENT_APPROVER_DEPARTMENT",
                approved_by_staff_id: approverIdVal,
                approver_department_id: String(approverRow.department_id),
                record_department_id: String(existing.department_id),
              },
              reasonCode: "INVALID_ADJUSTMENT_APPROVER",
            },
          },
        );
      }

      const nextVal = newVal !== undefined ? newVal : prevVal;
      await client.query(
        `UPDATE kpi_actual_records
         SET actual_value = $1,
             source_ref = COALESCE($2, source_ref)
         WHERE id = $3`,
        [nextVal, sourceRefVal, actualId],
      );

      await client.query(
        `INSERT INTO kpi_actual_adjustments (
           id, actual_record_id, previous_actual_value, new_actual_value,
           previous_status, new_status, adjustment_reason, source_ref,
           adjusted_by_staff_id, approved_by_staff_id
         ) VALUES ($1, $2, $3, $4, 'FINAL', 'FINAL', $5, $6, $7, $8)`,
        [
          randomUUID(),
          actualId,
          prevVal,
          nextVal,
          reasonVal,
          sourceRefVal,
          actor.ctx.staff_id,
          approverIdVal,
        ],
      );
    }

    const updated = await fetchSingleActualRow(client, actualId);
    if (!updated) {
      return abort(
        500,
        "INTERNAL_ERROR",
        "Failed to load reconciled actual record",
      );
    }

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: policyAction,
      resourceType: "kpi_actual_record",
      resourceId: actualId,
      decision: "ALLOW",
      reasonCode: `ACTUAL_${reconcileAction}`,
      scopeContext: {
        previous_status: currentStatus,
        reconciliation_status: updated.reconciliation_status,
        row_version: updated.row_version,
      },
    });

    return updated;
  });
}

export async function getDashboardOverview(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<DashboardOverviewPayload>> {
  const qv = validateQueryParams(url.searchParams, [
    "period_type",
    "period_key",
    "as_of_date",
    "department_id",
    "group_code",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected(
          "dashboard.overview.read",
          "dashboard_overview",
          qv.field,
        ),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }

  const periodTypeRaw = url.searchParams.get("period_type") ?? "MONTH";
  if (!KPI_PERIOD_TYPES.includes(periodTypeRaw as KpiPeriodType)) {
    return fail(400, "VALIDATION_FAILED", "Invalid period_type");
  }
  const periodType = periodTypeRaw as KpiPeriodType;

  const asOfDate = url.searchParams.get("as_of_date") ?? getCurrentVnDate();
  if (!isValidIsoDate(asOfDate)) {
    return fail(400, "VALIDATION_FAILED", "as_of_date must be YYYY-MM-DD");
  }

  const periodKey =
    url.searchParams.get("period_key") ??
    getDefaultPeriodKey(periodType, asOfDate);
  const dateRange = resolvePeriodDateRange(periodType, periodKey);
  if (!dateRange) {
    return fail(400, "VALIDATION_FAILED", "Invalid period_key for period_type");
  }

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }

  const groupParam = url.searchParams.get("group_code") ?? undefined;
  if (
    groupParam &&
    !ALL_SEVEN_KPI_GROUPS.includes(groupParam as KpiGroupCode)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid group_code");
  }

  const denied = authorize(
    actor,
    {
      action: "dashboard.overview.read",
      targetDepartmentId: deptParam,
    },
    { type: "dashboard_overview", id: deptParam ?? actor.ctx.department.id },
  );
  if (denied) return finalizeFailure(actor, denied);

  const roleCode = actor.ctx.effective_role.role_code;
  const viewerScope: ViewerScopeLevel =
    roleCode === "EXECUTIVE"
      ? "BRANCH"
      : roleCode === "DEPARTMENT_MANAGER"
        ? "DEPARTMENT"
        : "SELF";

  const scopedDeptId =
    viewerScope === "DEPARTMENT"
      ? actor.ctx.department.id
      : viewerScope === "BRANCH"
        ? (deptParam ?? null)
        : actor.ctx.department.id;

  const pool = getRuntimePool();

  const calRes = await pool.query(
    `SELECT calendar_date, is_working_day
     FROM branch_calendar_days
     WHERE calendar_date >= $1 AND calendar_date <= $2
     ORDER BY calendar_date ASC`,
    [dateRange.startDate, dateRange.endDate],
  );
  const calendarDays = calRes.rows.map((r) => ({
    calendar_date: formatPgDate(r.calendar_date),
    is_working_day: Boolean(r.is_working_day),
  }));
  const expectedProgressPct = computeExpectedProgressPct(
    periodType,
    asOfDate,
    calendarDays,
  );

  const defWhere = groupParam
    ? `WHERE status = 'ACTIVE' AND group_code = $1`
    : `WHERE status = 'ACTIVE'`;
  const defRes = await pool.query(
    `SELECT id, metric_code, metric_name, group_code, unit_code, metric_type,
            time_aggregation_rule, attribution_mode, primary_weight, referrer_weight,
            source_system_code
     FROM kpi_definitions
     ${defWhere}
     ORDER BY group_code ASC, metric_code ASC`,
    groupParam ? [groupParam] : [],
  );

  const sqlDeptScope = viewerScope === "SELF" ? null : scopedDeptId;
  const sqlStaffScope = viewerScope === "SELF" ? actor.ctx.staff_id : null;
  const sqlDeptRowScope =
    viewerScope === "SELF" ? actor.ctx.department.id : scopedDeptId;

  const tgtRes = await pool.query(
    `SELECT kpi_definition_id, scope_type, department_id, staff_id, target_value, status
     FROM kpi_targets
     WHERE period_type = $1 AND period_key = $2 AND status IN ('APPROVED', 'PENDING_APPROVAL', 'DRAFT')
       AND ($3::uuid IS NULL OR department_id = $3)
       AND ($4::uuid IS NULL OR staff_id = $4)
     ORDER BY CASE status WHEN 'APPROVED' THEN 1 WHEN 'PENDING_APPROVAL' THEN 2 ELSE 3 END ASC, revision_no DESC`,
    [periodType, periodKey, sqlDeptScope, sqlStaffScope],
  );

  const actRes = await pool.query(
    `SELECT a.id, a.kpi_definition_id, a.as_of_date, a.department_id, a.primary_staff_id,
            a.referrer_staff_id, ref_s.department_id AS referrer_department_id,
            a.actual_value, a.reconciliation_status, a.source_code
     FROM kpi_actual_records a
     LEFT JOIN staff ref_s ON ref_s.id = a.referrer_staff_id
     WHERE a.period_type = $1 AND a.period_key = $2 AND a.as_of_date <= $3
       AND ($4::uuid IS NULL OR a.department_id = $4 OR a.referrer_staff_id IN (
         SELECT id FROM staff WHERE department_id = $4 AND status = 'ACTIVE'
       ))
       AND ($5::uuid IS NULL OR a.primary_staff_id = $5 OR a.referrer_staff_id = $5)
     ORDER BY a.as_of_date ASC`,
    [periodType, periodKey, asOfDate, sqlDeptScope, sqlStaffScope],
  );

  const staffRes = await pool.query(
    `SELECT id, staff_code, display_name, department_id
     FROM staff
     WHERE status = 'ACTIVE'
       AND ($1::uuid IS NULL OR department_id = $1)
       AND ($2::uuid IS NULL OR id = $2)
     ORDER BY staff_code ASC`,
    [sqlDeptScope, sqlStaffScope],
  );
  const staffDeptMap = new Map<string, string>();
  const staffList: Array<{
    id: string;
    code: string;
    name: string;
    department_id: string;
  }> = [];
  for (const s of staffRes.rows) {
    const id = String(s.id);
    const deptId = String(s.department_id);
    staffDeptMap.set(id, deptId);
    staffList.push({
      id,
      code: String(s.staff_code),
      name: String(s.display_name),
      department_id: deptId,
    });
  }
  for (const a of actRes.rows) {
    if (a.referrer_staff_id && a.referrer_department_id) {
      staffDeptMap.set(
        String(a.referrer_staff_id),
        String(a.referrer_department_id),
      );
    }
  }

  const deptRes = await pool.query(
    `SELECT id, code, name
     FROM departments
     WHERE status = 'ACTIVE'
       AND ($1::uuid IS NULL OR id = $1)
     ORDER BY code ASC`,
    [sqlDeptRowScope],
  );
  const deptList = deptRes.rows.map((d) => ({
    id: String(d.id),
    code: String(d.code),
    name: String(d.name),
  }));

  function pickTargetForScope(
    defId: string,
    scope: ViewerScopeLevel,
    deptId: string | null,
    staffId: string | null,
  ): number | null {
    const match = tgtRes.rows.find((t) => {
      if (String(t.kpi_definition_id) !== defId) return false;
      if (String(t.scope_type) !== scope) return false;
      if (scope === "DEPARTMENT") return String(t.department_id) === deptId;
      if (scope === "SELF") return String(t.staff_id) === staffId;
      return true;
    });
    return match ? Number(match.target_value) : null;
  }

  function computeItemForScope(
    def: Record<string, unknown>,
    scope: ViewerScopeLevel,
    deptId: string | null,
    staffId: string | null,
  ): DashboardKpiItem {
    const defId = String(def.id);
    const metricType = String(def.metric_type) as KpiMetricType;
    const timeAggRule = String(def.time_aggregation_rule) as KpiTimeAggRule;
    const attrConfig = {
      attribution_mode: String(def.attribution_mode) as KpiAttributionMode,
      primary_weight: Number(def.primary_weight),
      referrer_weight: Number(def.referrer_weight),
    };

    const matchingRecords = actRes.rows.filter(
      (a) => String(a.kpi_definition_id) === defId,
    );

    const datedValues: Array<{ as_of_date: string; value: number | null }> = [];
    const statuses: ReconciliationStatus[] = [];
    let latestRecordDate = asOfDate;
    let sourceCode = String(def.source_system_code);

    for (const r of matchingRecords) {
      const recAsOf = formatPgDate(r.as_of_date);
      const rawActual = r.actual_value === null ? null : Number(r.actual_value);
      const attributed = computeAttributedValue(
        {
          actual_value: rawActual,
          department_id: String(r.department_id),
          primary_staff_id: String(r.primary_staff_id),
          referrer_staff_id: r.referrer_staff_id
            ? String(r.referrer_staff_id)
            : null,
        },
        attrConfig,
        {
          level: scope,
          departmentId: deptId,
          staffId,
          staffDepartmentMap: staffDeptMap,
        },
      );

      const belongsToScope =
        scope === "BRANCH" ||
        (scope === "DEPARTMENT" &&
          (String(r.department_id) === deptId ||
            (r.referrer_staff_id &&
              staffDeptMap.get(String(r.referrer_staff_id)) === deptId))) ||
        (scope === "SELF" &&
          (String(r.primary_staff_id) === staffId ||
            String(r.referrer_staff_id) === staffId));

      if (belongsToScope) {
        datedValues.push({ as_of_date: recAsOf, value: attributed });
        statuses.push(String(r.reconciliation_status) as ReconciliationStatus);
        latestRecordDate = recAsOf;
        sourceCode = String(r.source_code);
      }
    }

    const aggregatedActual = aggregateAttributedValuesByTimeRule(
      metricType,
      timeAggRule,
      datedValues,
    );
    const targetValue = pickTargetForScope(defId, scope, deptId, staffId);
    const progress = computeKpiProgress({
      targetValue,
      actualValue: aggregatedActual,
      expectedProgressPct,
    });

    return {
      kpi_definition_id: defId,
      metric_code: String(def.metric_code),
      metric_name: String(def.metric_name),
      group_code: String(def.group_code) as KpiGroupCode,
      unit_code: String(def.unit_code) as KpiUnitCode,
      metric_type: metricType,
      time_aggregation_rule: timeAggRule,
      attribution_mode: attrConfig.attribution_mode,
      target_value: progress.target_value,
      actual_value: progress.actual_value,
      data_status: progress.data_status,
      gap: progress.gap,
      completion_pct: progress.completion_pct,
      expected_progress_pct: progress.expected_progress_pct,
      variance_vs_expected_pct: progress.variance_vs_expected_pct,
      reconciliation_status: deriveAggregateReconciliationStatus(
        statuses,
        aggregatedActual !== null,
      ),
      as_of_date: latestRecordDate,
      source_code: sourceCode,
      records_count: datedValues.length,
    };
  }

  const effectiveScope: ViewerScopeLevel =
    viewerScope === "BRANCH" && scopedDeptId ? "DEPARTMENT" : viewerScope;
  const topLevelItems = defRes.rows.map((def) =>
    computeItemForScope(
      def,
      effectiveScope,
      scopedDeptId,
      viewerScope === "SELF" ? actor.ctx.staff_id : null,
    ),
  );

  const groupsToEmit = groupParam
    ? [groupParam as KpiGroupCode]
    : ALL_SEVEN_KPI_GROUPS;

  const groups: DashboardGroupSummary[] = groupsToEmit.map((g) => {
    const metrics = topLevelItems.filter((item) => item.group_code === g);
    return {
      group_code: g,
      metrics_count: metrics.length,
      ok_count: metrics.filter((m) => m.data_status === "OK").length,
      missing_data_count: metrics.filter(
        (m) => m.data_status === "MISSING_DATA",
      ).length,
      target_non_positive_count: metrics.filter(
        (m) => m.data_status === "TARGET_NON_POSITIVE",
      ).length,
      metrics,
    };
  });

  const visibleDepts =
    viewerScope === "BRANCH"
      ? deptParam
        ? deptList.filter((d) => d.id === deptParam)
        : deptList
      : viewerScope === "DEPARTMENT"
        ? deptList.filter((d) => d.id === actor.ctx.department.id)
        : [];

  const drilldownDepartments: DashboardDrilldownEntity[] = visibleDepts.map(
    (dept) => {
      const items = defRes.rows.map((def) => {
        const computed = computeItemForScope(def, "DEPARTMENT", dept.id, null);
        return {
          kpi_definition_id: computed.kpi_definition_id,
          metric_code: computed.metric_code,
          group_code: computed.group_code,
          target_value: computed.target_value,
          actual_value: computed.actual_value,
          data_status: computed.data_status,
          gap: computed.gap,
          completion_pct: computed.completion_pct,
          reconciliation_status: computed.reconciliation_status,
        };
      });
      return {
        entity_type: "DEPARTMENT",
        entity_id: dept.id,
        entity_code: dept.code,
        entity_name: dept.name,
        department_id: dept.id,
        metrics_with_data: items.filter((i) => i.data_status === "OK").length,
        metrics_missing_data: items.filter(
          (i) => i.data_status === "MISSING_DATA",
        ).length,
        items,
      };
    },
  );

  const visibleStaff =
    viewerScope === "BRANCH"
      ? deptParam
        ? staffList.filter((s) => s.department_id === deptParam)
        : staffList
      : viewerScope === "DEPARTMENT"
        ? staffList.filter((s) => s.department_id === actor.ctx.department.id)
        : staffList.filter((s) => s.id === actor.ctx.staff_id);

  const drilldownStaff: DashboardDrilldownEntity[] = visibleStaff.map((st) => {
    const items = defRes.rows.map((def) => {
      const computed = computeItemForScope(
        def,
        "SELF",
        st.department_id,
        st.id,
      );
      return {
        kpi_definition_id: computed.kpi_definition_id,
        metric_code: computed.metric_code,
        group_code: computed.group_code,
        target_value: computed.target_value,
        actual_value: computed.actual_value,
        data_status: computed.data_status,
        gap: computed.gap,
        completion_pct: computed.completion_pct,
        reconciliation_status: computed.reconciliation_status,
      };
    });
    return {
      entity_type: "STAFF",
      entity_id: st.id,
      entity_code: st.code,
      entity_name: st.name,
      department_id: st.department_id,
      metrics_with_data: items.filter((i) => i.data_status === "OK").length,
      metrics_missing_data: items.filter(
        (i) => i.data_status === "MISSING_DATA",
      ).length,
      items,
    };
  });

  return {
    ok: true,
    status: 200,
    data: {
      viewer_role: roleCode,
      viewer_scope: viewerScope,
      period_type: periodType,
      period_key: periodKey,
      as_of_date: asOfDate,
      expected_progress_pct: expectedProgressPct,
      no_composite_score: true,
      groups,
      drilldown_departments: drilldownDepartments,
      drilldown_staff: drilldownStaff,
    },
  };
}
