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
  validationFailure,
  type Actor,
  type ServiceResult,
} from "@/server/service-core";
import {
  escapeLike,
  findDisallowedTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readPageParams,
  readString,
  validateQueryParams,
  readEnumVal,
} from "@/server/validation";

export const PLAN_PERIOD_TYPES = ["WEEK", "DAY"] as const;
export type PlanPeriodType = (typeof PLAN_PERIOD_TYPES)[number];

export const PLAN_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "REVIEWED",
  "CLOSED",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "CUSTOMER_VISIT",
  "CALL",
  "CONSULTATION",
  "LOAN_APP_INTAKE",
  "DEPOSIT_PITCH",
  "CARD_CROSS_SELL",
  "INSURANCE_PITCH",
  "FOLLOW_UP",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_STATUSES = [
  "PLANNED",
  "COMPLETED",
  "CANCELLED",
  "FOLLOW_UP_NEEDED",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const REVIEW_STATUSES = ["OPEN", "COMPLETED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const DIRECTIVE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "OVERDUE",
] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export interface ActivitySummaryDto {
  total_count: number;
  planned_count: number;
  completed_count: number;
  cancelled_count: number;
  follow_up_needed_count: number;
}

export interface SalesPlanDto {
  id: string;
  staff_id: string;
  staff_code: string;
  staff_name: string;
  department_id: string;
  department_code: string;
  period_type: PlanPeriodType;
  period_key: string;
  kpi_target_id: string | null;
  title: string;
  focus_notes: string | null;
  status: PlanStatus;
  submitted_at: string | null;
  reviewed_by_staff_id: string | null;
  reviewed_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  activity_summary: ActivitySummaryDto;
}

export interface ActivityLogDto {
  id: string;
  actor_staff_id: string;
  actor_staff_code: string;
  actor_staff_name: string;
  department_id: string;
  department_code: string;
  sales_plan_id: string | null;
  kpi_definition_id: string | null;
  kpi_metric_code: string | null;
  synthetic_customer_ref: string | null;
  activity_type: ActivityType;
  occurred_at: string;
  occurred_date_vn: string;
  is_after_daily_cutoff: boolean;
  status: ActivityStatus;
  outcome_summary: string;
  next_step: string | null;
  next_action_due_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface MondayReviewDto {
  id: string;
  week_period_key: string;
  scope_type: "BRANCH" | "DEPARTMENT";
  department_id: string | null;
  department_code: string | null;
  conducted_by_staff_id: string;
  conducted_by_name: string;
  review_date: string;
  summary_notes: string;
  status: ReviewStatus;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface DirectiveTaskDto {
  id: string;
  monday_review_id: string;
  week_period_key: string;
  department_id: string;
  department_code: string;
  assignee_staff_id: string;
  assignee_staff_code: string;
  assignee_name: string;
  issued_by_staff_id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: DirectiveStatus;
  completion_note: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface WeeklyStaffRollupDto {
  staff_id: string;
  staff_code: string;
  staff_name: string;
  department_id: string;
  department_code: string;
  plans_count: number;
  activities_total: number;
  activities_completed: number;
  activities_follow_up_needed: number;
  activities_planned: number;
  activities_cancelled: number;
  weekly_target_count: number;
}

export interface MondayReviewBundleDto {
  week_period_key: string;
  week_start_vn: string;
  week_end_vn: string;
  reviews: MondayReviewDto[];
  directives: DirectiveTaskDto[];
  weekly_activity_rollup: WeeklyStaffRollupDto[];
}

export function isValidPlanPeriodKey(
  periodType: PlanPeriodType,
  key: string,
): boolean {
  if (periodType === "WEEK") {
    return /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(key);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/**
 * Resolves an ISO week key (e.g. `2026-W46`) into exact Monday..Sunday bounds
 * in `Asia/Ho_Chi_Minh` (`UTC+7`, no DST), per `D-03` Option A.
 */
export function resolveWeekBoundsVn(weekKey: string): {
  mondayDate: string;
  sundayDate: string;
  startIsoUtc: string;
  endIsoUtc: string;
} | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;

  // ISO week 1 always contains Jan 4
  const jan4Utc = new Date(Date.UTC(year, 0, 4));
  const jan4IsoDow = jan4Utc.getUTCDay() === 0 ? 7 : jan4Utc.getUTCDay();
  const week1MondayUtcMs =
    jan4Utc.getTime() - (jan4IsoDow - 1) * 24 * 60 * 60 * 1000;
  const targetMondayUtcMs =
    week1MondayUtcMs + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  const targetSundayUtcMs = targetMondayUtcMs + 6 * 24 * 60 * 60 * 1000;
  const nextMondayUtcMs = targetMondayUtcMs + 7 * 24 * 60 * 60 * 1000;

  const mon = new Date(targetMondayUtcMs);
  const sun = new Date(targetSundayUtcMs);
  const nextMon = new Date(nextMondayUtcMs);
  const mondayDate = mon.toISOString().slice(0, 10);
  const sundayDate = sun.toISOString().slice(0, 10);
  const nextMondayDate = nextMon.toISOString().slice(0, 10);

  // Half-open interval [Monday 00:00:00.000+07:00, next Monday 00:00:00.000+07:00)
  const startUtc = new Date(`${mondayDate}T00:00:00.000+07:00`).toISOString();
  const endUtc = new Date(`${nextMondayDate}T00:00:00.000+07:00`).toISOString();

  return {
    mondayDate,
    sundayDate,
    startIsoUtc: startUtc,
    endIsoUtc: endUtc,
  };
}

/**
 * Formats an instant into `YYYY-MM-DD` and `HH:MM` in `Asia/Ho_Chi_Minh` (`UTC+7`).
 */
export function getVnDateAndCutoffStatus(
  instant: Date,
  cutoffHhMm = "18:00",
): { dateVn: string; isAfterCutoff: boolean } {
  const vnMs = instant.getTime() + 7 * 60 * 60 * 1000;
  const vnDate = new Date(vnMs);
  const dateVn = vnDate.toISOString().slice(0, 10);
  const hhmm = vnDate.toISOString().slice(11, 16);
  return {
    dateVn,
    isAfterCutoff: hhmm > cutoffHhMm,
  };
}

function readOptionalIsoTimestamp(
  obj: Record<string, unknown>,
  field: string,
  required = false,
):
  | { ok: true; value: string | null }
  | { ok: false; field: string; reason: string } {
  const raw = obj[field];
  if (raw === undefined || raw === null || raw === "") {
    return required
      ? { ok: false, field, reason: "REQUIRED" }
      : { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, field, reason: "INVALID_TIMESTAMP" };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, field, reason: "INVALID_TIMESTAMP" };
  }
  return { ok: true, value: d.toISOString() };
}

function mapDateCol(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

function mapSalesPlanRow(row: Record<string, unknown>): SalesPlanDto {
  return {
    id: String(row.id),
    staff_id: String(row.staff_id),
    staff_code: String(row.staff_code ?? ""),
    staff_name: String(row.staff_name ?? ""),
    department_id: String(row.department_id),
    department_code: String(row.department_code ?? ""),
    period_type: row.period_type as PlanPeriodType,
    period_key: String(row.period_key),
    kpi_target_id: (row.kpi_target_id as string | null) ?? null,
    title: String(row.title),
    focus_notes: (row.focus_notes as string | null) ?? null,
    status: row.status as PlanStatus,
    submitted_at: row.submitted_at
      ? new Date(row.submitted_at as string | Date).toISOString()
      : null,
    reviewed_by_staff_id: (row.reviewed_by_staff_id as string | null) ?? null,
    reviewed_at: row.reviewed_at
      ? new Date(row.reviewed_at as string | Date).toISOString()
      : null,
    row_version: Number(row.row_version),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
    activity_summary: {
      total_count: Number(row.total_count ?? 0),
      planned_count: Number(row.planned_count ?? 0),
      completed_count: Number(row.completed_count ?? 0),
      cancelled_count: Number(row.cancelled_count ?? 0),
      follow_up_needed_count: Number(row.follow_up_needed_count ?? 0),
    },
  };
}

function mapActivityRow(
  row: Record<string, unknown>,
  cutoffHhMm = "18:00",
): ActivityLogDto {
  const occurredDate = new Date(row.occurred_at as string | Date);
  const { dateVn, isAfterCutoff } = getVnDateAndCutoffStatus(
    occurredDate,
    cutoffHhMm,
  );
  return {
    id: String(row.id),
    actor_staff_id: String(row.actor_staff_id),
    actor_staff_code: String(row.actor_staff_code ?? ""),
    actor_staff_name: String(row.actor_staff_name ?? ""),
    department_id: String(row.department_id),
    department_code: String(row.department_code ?? ""),
    sales_plan_id: (row.sales_plan_id as string | null) ?? null,
    kpi_definition_id: (row.kpi_definition_id as string | null) ?? null,
    kpi_metric_code: (row.kpi_metric_code as string | null) ?? null,
    synthetic_customer_ref:
      (row.synthetic_customer_ref as string | null) ?? null,
    activity_type: row.activity_type as ActivityType,
    occurred_at: occurredDate.toISOString(),
    occurred_date_vn: dateVn,
    is_after_daily_cutoff: isAfterCutoff,
    status: row.status as ActivityStatus,
    outcome_summary: String(row.outcome_summary),
    next_step: (row.next_step as string | null) ?? null,
    next_action_due_at: row.next_action_due_at
      ? new Date(row.next_action_due_at as string | Date).toISOString()
      : null,
    row_version: Number(row.row_version),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapMondayReviewRow(row: Record<string, unknown>): MondayReviewDto {
  return {
    id: String(row.id),
    week_period_key: String(row.week_period_key),
    scope_type: row.scope_type as "BRANCH" | "DEPARTMENT",
    department_id: (row.department_id as string | null) ?? null,
    department_code: (row.department_code as string | null) ?? null,
    conducted_by_staff_id: String(row.conducted_by_staff_id),
    conducted_by_name: String(row.conducted_by_name ?? ""),
    review_date: mapDateCol(row.review_date),
    summary_notes: String(row.summary_notes),
    status: row.status as ReviewStatus,
    row_version: Number(row.row_version),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapDirectiveRow(row: Record<string, unknown>): DirectiveTaskDto {
  return {
    id: String(row.id),
    monday_review_id: String(row.monday_review_id),
    week_period_key: String(row.week_period_key ?? ""),
    department_id: String(row.department_id),
    department_code: String(row.department_code ?? ""),
    assignee_staff_id: String(row.assignee_staff_id),
    assignee_staff_code: String(row.assignee_staff_code ?? ""),
    assignee_name: String(row.assignee_name ?? ""),
    issued_by_staff_id: String(row.issued_by_staff_id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    due_at: new Date(row.due_at as string | Date).toISOString(),
    status: row.status as DirectiveStatus,
    completion_note: (row.completion_note as string | null) ?? null,
    row_version: Number(row.row_version),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

// ============================================================================
// 1. Sales Plans (sales_plans + Single-Source Activity Aggregation)
// ============================================================================

export async function listSalesPlans(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<SalesPlanDto[]>> {
  const denied = authorize(
    actor,
    { action: "planning.plan.read" },
    { type: "sales_plan", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "q",
    "period_type",
    "period_key",
    "department_id",
    "staff_id",
    "status",
    "limit",
    "offset",
  ]);
  if (!queryCheck.ok) {
    if (queryCheck.reason === "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED") {
      return finalizeFailure(
        actor,
        tamperRejected("planning.plan.read", "sales_plan"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const page = readPageParams(searchParams);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const deptParam = searchParams.get("department_id")?.trim() ?? "";
  if (deptParam && !isUuid(deptParam)) {
    return validationFailure("department_id", "INVALID_UUID");
  }
  const staffParam = searchParams.get("staff_id")?.trim() ?? "";
  if (staffParam && !isUuid(staffParam)) {
    return validationFailure("staff_id", "INVALID_UUID");
  }

  const periodTypeFilter = searchParams.get("period_type")?.trim() ?? "";
  if (
    periodTypeFilter &&
    !PLAN_PERIOD_TYPES.includes(periodTypeFilter as PlanPeriodType)
  ) {
    return validationFailure("period_type", "INVALID_ENUM");
  }
  const periodKeyFilter = searchParams.get("period_key")?.trim() ?? "";
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  if (statusFilter && !PLAN_STATUSES.includes(statusFilter as PlanStatus)) {
    return validationFailure("status", "INVALID_ENUM");
  }
  const q = searchParams.get("q")?.trim() ?? "";

  const scope = actor.ctx.effective_role.scope_type;
  if (
    scope === "DEPARTMENT" &&
    deptParam &&
    deptParam !== actor.ctx.department.id
  ) {
    return finalizeFailure(
      actor,
      notFound("planning.plan.read", "sales_plan", deptParam),
    );
  }
  if (scope === "SELF") {
    if (deptParam && deptParam !== actor.ctx.department.id) {
      return finalizeFailure(
        actor,
        notFound("planning.plan.read", "sales_plan", deptParam),
      );
    }
    if (staffParam && staffParam !== actor.ctx.staff_id) {
      return finalizeFailure(
        actor,
        notFound("planning.plan.read", "sales_plan", staffParam),
      );
    }
  }

  const where: string[] = [];
  const params: unknown[] = [];

  if (scope === "DEPARTMENT") {
    params.push(actor.ctx.department.id);
    where.push(`p.department_id = $${params.length}`);
  } else if (scope === "SELF") {
    params.push(actor.ctx.staff_id);
    where.push(`p.staff_id = $${params.length}`);
  }

  if (deptParam && scope === "BRANCH") {
    params.push(deptParam);
    where.push(`p.department_id = $${params.length}`);
  }
  if (staffParam && scope !== "SELF") {
    params.push(staffParam);
    where.push(`p.staff_id = $${params.length}`);
  }
  if (periodTypeFilter) {
    params.push(periodTypeFilter);
    where.push(`p.period_type = $${params.length}`);
  }
  if (periodKeyFilter) {
    params.push(periodKeyFilter);
    where.push(`p.period_key = $${params.length}`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    where.push(`p.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(p.title ILIKE $${params.length} ESCAPE '\\' OR COALESCE(p.focus_notes, '') ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();

  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM sales_plans p ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? "0");

  const listParams = [...params, page.value.limit, page.value.offset];
  const rowsRes = await pool.query(
    `SELECT p.*,
            s.staff_code,
            s.display_name AS staff_name,
            d.code AS department_code,
            COALESCE(agg.total_count, 0) AS total_count,
            COALESCE(agg.planned_count, 0) AS planned_count,
            COALESCE(agg.completed_count, 0) AS completed_count,
            COALESCE(agg.cancelled_count, 0) AS cancelled_count,
            COALESCE(agg.follow_up_needed_count, 0) AS follow_up_needed_count
     FROM sales_plans p
     JOIN staff s ON s.id = p.staff_id
     JOIN departments d ON d.id = p.department_id
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS total_count,
         count(*) FILTER (WHERE a.status = 'PLANNED')::int AS planned_count,
         count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed_count,
         count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled_count,
         count(*) FILTER (WHERE a.status = 'FOLLOW_UP_NEEDED')::int AS follow_up_needed_count
       FROM activity_logs a
       WHERE a.sales_plan_id = p.id
     ) agg ON TRUE
     ${whereSql}
     ORDER BY p.period_key DESC, p.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  return {
    ok: true,
    status: 200,
    data: rowsRes.rows.map(mapSalesPlanRow),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function createSalesPlan(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<SalesPlanDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), [
    "department_id",
    "staff_id",
  ]);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.plan.write", "sales_plan"),
    );
  }

  const periodTypeV = readEnumVal(body, "period_type", PLAN_PERIOD_TYPES);
  if (!periodTypeV.ok)
    return validationFailure(periodTypeV.field, periodTypeV.reason);
  const periodType = periodTypeV.value!;

  const periodKeyV = readString(body, "period_key", { min: 4, max: 16 });
  if (!periodKeyV.ok || !isValidPlanPeriodKey(periodType, periodKeyV.value!)) {
    return validationFailure("period_key", "INVALID_PERIOD_KEY");
  }
  const periodKey = periodKeyV.value!;

  const titleV = readString(body, "title", { min: 3, max: 160 });
  if (!titleV.ok) return validationFailure(titleV.field, titleV.reason);

  const focusNotesV = readString(body, "focus_notes", {
    min: 1,
    max: 1000,
    optional: true,
  });
  if (!focusNotesV.ok)
    return validationFailure(focusNotesV.field, focusNotesV.reason);

  let kpiTargetId: string | null = null;
  if (
    body.kpi_target_id !== undefined &&
    body.kpi_target_id !== null &&
    body.kpi_target_id !== ""
  ) {
    if (typeof body.kpi_target_id !== "string" || !isUuid(body.kpi_target_id)) {
      return validationFailure("kpi_target_id", "INVALID_UUID");
    }
    kpiTargetId = body.kpi_target_id;
  }

  const requestedStaffId =
    typeof body.staff_id === "string" && body.staff_id
      ? body.staff_id
      : actor.ctx.staff_id;
  if (!isUuid(requestedStaffId)) {
    return validationFailure("staff_id", "INVALID_UUID");
  }

  const requestedDeptId =
    typeof body.department_id === "string" && body.department_id
      ? body.department_id
      : actor.ctx.department.id;
  if (!isUuid(requestedDeptId)) {
    return validationFailure("department_id", "INVALID_UUID");
  }

  const denied = authorize(
    actor,
    {
      action: "planning.plan.write",
      targetDepartmentId: requestedDeptId,
      targetStaffId: requestedStaffId,
    },
    {
      type: "sales_plan",
      id: "new",
    },
  );
  if (denied) return finalizeFailure(actor, denied);

  const statusV = readEnumVal(
    body,
    "status",
    ["DRAFT", "SUBMITTED"] as const,
    true,
  );
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);
  const initialStatus: PlanStatus = statusV.value ?? "DRAFT";

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const staffRes = await client.query<{
        id: string;
        department_id: string;
        status: string;
        staff_code: string;
        display_name: string;
        department_code: string;
      }>(
        `SELECT s.id, s.department_id, s.status, s.staff_code, s.display_name,
                d.code AS department_code
         FROM staff s
         JOIN departments d ON d.id = s.department_id
         WHERE s.id = $1`,
        [requestedStaffId],
      );
      if (staffRes.rowCount === 0) {
        abort(422, "VALIDATION_FAILED", "Nhân sự không tồn tại.");
      }
      const targetStaff = staffRes.rows[0]!;
      if (targetStaff.status !== "ACTIVE") {
        abort(
          422,
          "VALIDATION_FAILED",
          "Không thể lập kế hoạch cho nhân sự đã ngừng hoạt động.",
        );
      }
      if (targetStaff.department_id !== requestedDeptId) {
        abort(
          422,
          "VALIDATION_FAILED",
          "Nhân sự không thuộc phòng ban đã chọn.",
        );
      }

      if (kpiTargetId) {
        const tRes = await client.query(
          `SELECT id FROM kpi_targets WHERE id = $1`,
          [kpiTargetId],
        );
        if (tRes.rowCount === 0) {
          abort(
            422,
            "VALIDATION_FAILED",
            "Chỉ tiêu KPI tham chiếu không tồn tại.",
          );
        }
      }

      const planId = randomUUID();
      const ins = await client.query(
        `INSERT INTO sales_plans (
           id, staff_id, department_id, period_type, period_key, kpi_target_id,
           title, focus_notes, status, submitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          planId,
          requestedStaffId,
          requestedDeptId,
          periodType,
          periodKey,
          kpiTargetId,
          titleV.value!,
          focusNotesV.value ?? null,
          initialStatus,
          initialStatus === "SUBMITTED" ? new Date().toISOString() : null,
        ],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.plan.write",
        resourceType: "sales_plan",
        resourceId: planId,
        scopeContext: {
          period_type: periodType,
          period_key: periodKey,
          staff_id: requestedStaffId,
          department_id: requestedDeptId,
          status: initialStatus,
        },
        decision: "ALLOW",
        reasonCode: "SALES_PLAN_CREATED",
      });

      return mapSalesPlanRow({
        ...ins.rows[0]!,
        staff_code: targetStaff.staff_code,
        staff_name: targetStaff.display_name,
        department_code: targetStaff.department_code,
        total_count: 0,
        planned_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        follow_up_needed_count: 0,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 201, data: txResult.data };
}

export async function patchSalesPlan(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<SalesPlanDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.plan.write", "sales_plan"),
    );
  }

  const idV = readString(body, "id", { min: 36, max: 36 });
  if (!idV.ok || !isUuid(idV.value)) {
    return validationFailure("id", "INVALID_UUID");
  }
  const planId = idV.value!;

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);

  const titleV = readString(body, "title", {
    min: 3,
    max: 160,
    optional: true,
  });
  if (!titleV.ok) return validationFailure(titleV.field, titleV.reason);

  const focusNotesV = readString(body, "focus_notes", {
    min: 1,
    max: 1000,
    optional: true,
  });
  if (!focusNotesV.ok)
    return validationFailure(focusNotesV.field, focusNotesV.reason);

  const statusV = readEnumVal(body, "status", PLAN_STATUSES, true);
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

  const preCheck = authorize(
    actor,
    { action: "planning.plan.write" },
    { type: "sales_plan", id: planId },
  );
  if (preCheck) return finalizeFailure(actor, preCheck);

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const curRes = await client.query(
        `SELECT p.*, s.staff_code, s.display_name AS staff_name, d.code AS department_code
         FROM sales_plans p
         JOIN staff s ON s.id = p.staff_id
         JOIN departments d ON d.id = p.department_id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [planId],
      );
      if (curRes.rowCount === 0) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy kế hoạch bán hàng.",
        );
      }
      const existing = curRes.rows[0]!;

      const rowDenied = authorize(
        actor,
        {
          action: "planning.plan.write",
          targetDepartmentId: String(existing.department_id),
          targetStaffId: String(existing.staff_id),
        },
        {
          type: "sales_plan",
          id: planId,
        },
      );
      if (rowDenied) {
        abort(rowDenied.status, rowDenied.code, rowDenied.message, {
          denyAudit: {
            action: "planning.plan.write",
            resourceType: "sales_plan",
            resourceId: planId,
            scopeContext: { reason: rowDenied.code },
            reasonCode: rowDenied.code,
          },
        });
      }

      if (Number(existing.row_version) !== verV.value) {
        abort(409, "VERSION_CONFLICT", "Xung đột phiên bản kế hoạch bán hàng.");
      }

      const nextStatus = statusV.value ?? (existing.status as PlanStatus);
      if (
        nextStatus === "REVIEWED" &&
        current.effective_role.role_code === "STAFF"
      ) {
        abort(
          403,
          "STAFF_PLAN_REVIEW_FORBIDDEN",
          "Nhân viên không thể tự đánh dấu kế hoạch đã review.",
        );
      }

      const nextTitle = titleV.value ?? String(existing.title);
      const nextNotes =
        focusNotesV.value !== undefined
          ? focusNotesV.value
          : (existing.focus_notes as string | null);
      const nextSubmittedAt =
        nextStatus === "SUBMITTED" && !existing.submitted_at
          ? new Date().toISOString()
          : (existing.submitted_at as string | null);
      const nextReviewedBy =
        nextStatus === "REVIEWED"
          ? current.staff_id
          : (existing.reviewed_by_staff_id as string | null);
      const nextReviewedAt =
        nextStatus === "REVIEWED"
          ? new Date().toISOString()
          : (existing.reviewed_at as string | null);

      const upd = await client.query(
        `UPDATE sales_plans
         SET title = $2,
             focus_notes = $3,
             status = $4,
             submitted_at = $5,
             reviewed_by_staff_id = $6,
             reviewed_at = $7
         WHERE id = $1
         RETURNING *`,
        [
          planId,
          nextTitle,
          nextNotes,
          nextStatus,
          nextSubmittedAt,
          nextReviewedBy,
          nextReviewedAt,
        ],
      );

      const aggRes = await client.query(
        `SELECT
           count(*)::int AS total_count,
           count(*) FILTER (WHERE status = 'PLANNED')::int AS planned_count,
           count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count,
           count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_count,
           count(*) FILTER (WHERE status = 'FOLLOW_UP_NEEDED')::int AS follow_up_needed_count
         FROM activity_logs
         WHERE sales_plan_id = $1`,
        [planId],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.plan.write",
        resourceType: "sales_plan",
        resourceId: planId,
        scopeContext: {
          previous_status: existing.status,
          new_status: nextStatus,
          new_version: upd.rows[0]!.row_version,
        },
        decision: "ALLOW",
        reasonCode: "SALES_PLAN_UPDATED",
      });

      return mapSalesPlanRow({
        ...upd.rows[0]!,
        staff_code: existing.staff_code,
        staff_name: existing.staff_name,
        department_code: existing.department_code,
        ...aggRes.rows[0]!,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 200, data: txResult.data };
}

// ============================================================================
// 2. Single-Source Activity Log (activity_logs)
// ============================================================================

export async function listActivities(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<ActivityLogDto[]>> {
  const denied = authorize(
    actor,
    { action: "planning.activity.read" },
    { type: "activity_log", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "q",
    "sales_plan_id",
    "week_period_key",
    "date",
    "department_id",
    "staff_id",
    "status",
    "activity_type",
    "limit",
    "offset",
  ]);
  if (!queryCheck.ok) {
    if (queryCheck.reason === "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED") {
      return finalizeFailure(
        actor,
        tamperRejected("planning.activity.read", "activity_log"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const page = readPageParams(searchParams);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const deptParam = searchParams.get("department_id")?.trim() ?? "";
  if (deptParam && !isUuid(deptParam)) {
    return validationFailure("department_id", "INVALID_UUID");
  }
  const staffParam = searchParams.get("staff_id")?.trim() ?? "";
  if (staffParam && !isUuid(staffParam)) {
    return validationFailure("staff_id", "INVALID_UUID");
  }
  const planParam = searchParams.get("sales_plan_id")?.trim() ?? "";
  if (planParam && !isUuid(planParam)) {
    return validationFailure("sales_plan_id", "INVALID_UUID");
  }

  const weekKey = searchParams.get("week_period_key")?.trim() ?? "";
  let weekBounds: ReturnType<typeof resolveWeekBoundsVn> = null;
  if (weekKey) {
    weekBounds = resolveWeekBoundsVn(weekKey);
    if (!weekBounds) {
      return validationFailure("week_period_key", "INVALID_WEEK_KEY");
    }
  }

  const dateFilter = searchParams.get("date")?.trim() ?? "";
  if (dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    return validationFailure("date", "INVALID_DATE");
  }

  const statusFilter = searchParams.get("status")?.trim() ?? "";
  if (
    statusFilter &&
    !ACTIVITY_STATUSES.includes(statusFilter as ActivityStatus)
  ) {
    return validationFailure("status", "INVALID_ENUM");
  }

  const typeFilter = searchParams.get("activity_type")?.trim() ?? "";
  if (typeFilter && !ACTIVITY_TYPES.includes(typeFilter as ActivityType)) {
    return validationFailure("activity_type", "INVALID_ENUM");
  }

  const q = searchParams.get("q")?.trim() ?? "";
  const scope = actor.ctx.effective_role.scope_type;

  if (
    scope === "DEPARTMENT" &&
    deptParam &&
    deptParam !== actor.ctx.department.id
  ) {
    return finalizeFailure(
      actor,
      notFound("planning.activity.read", "activity_log", deptParam),
    );
  }
  if (scope === "SELF") {
    if (deptParam && deptParam !== actor.ctx.department.id) {
      return finalizeFailure(
        actor,
        notFound("planning.activity.read", "activity_log", deptParam),
      );
    }
    if (staffParam && staffParam !== actor.ctx.staff_id) {
      return finalizeFailure(
        actor,
        notFound("planning.activity.read", "activity_log", staffParam),
      );
    }
  }

  const where: string[] = [];
  const params: unknown[] = [];

  if (scope === "DEPARTMENT") {
    params.push(actor.ctx.department.id);
    where.push(`a.department_id = $${params.length}`);
  } else if (scope === "SELF") {
    params.push(actor.ctx.staff_id);
    where.push(`a.actor_staff_id = $${params.length}`);
  }

  if (deptParam && scope === "BRANCH") {
    params.push(deptParam);
    where.push(`a.department_id = $${params.length}`);
  }
  if (staffParam && scope !== "SELF") {
    params.push(staffParam);
    where.push(`a.actor_staff_id = $${params.length}`);
  }
  if (planParam) {
    params.push(planParam);
    where.push(`a.sales_plan_id = $${params.length}`);
  }
  if (weekBounds) {
    params.push(weekBounds.startIsoUtc, weekBounds.endIsoUtc);
    where.push(
      `a.occurred_at >= $${params.length - 1}::timestamptz AND a.occurred_at < $${params.length}::timestamptz`,
    );
  }
  if (dateFilter) {
    params.push(
      new Date(`${dateFilter}T00:00:00.000+07:00`).toISOString(),
      new Date(`${dateFilter}T23:59:59.999+07:00`).toISOString(),
    );
    where.push(
      `a.occurred_at >= $${params.length - 1}::timestamptz AND a.occurred_at <= $${params.length}::timestamptz`,
    );
  }
  if (statusFilter) {
    params.push(statusFilter);
    where.push(`a.status = $${params.length}`);
  }
  if (typeFilter) {
    params.push(typeFilter);
    where.push(`a.activity_type = $${params.length}`);
  }
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(a.outcome_summary ILIKE $${params.length} ESCAPE '\\' OR COALESCE(a.synthetic_customer_ref, '') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(a.next_step, '') ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();

  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM activity_logs a ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? "0");

  const listParams = [...params, page.value.limit, page.value.offset];
  const rowsRes = await pool.query(
    `SELECT a.*,
            s.staff_code AS actor_staff_code,
            s.display_name AS actor_staff_name,
            d.code AS department_code,
            kd.metric_code AS kpi_metric_code
     FROM activity_logs a
     JOIN staff s ON s.id = a.actor_staff_id
     JOIN departments d ON d.id = a.department_id
     LEFT JOIN kpi_definitions kd ON kd.id = a.kpi_definition_id
     ${whereSql}
     ORDER BY a.occurred_at DESC, a.created_at DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  return {
    ok: true,
    status: 200,
    data: rowsRes.rows.map((r) => mapActivityRow(r)),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function createActivity(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<ActivityLogDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.activity.write", "activity_log"),
    );
  }

  const typeV = readEnumVal(body, "activity_type", ACTIVITY_TYPES);
  if (!typeV.ok) return validationFailure(typeV.field, typeV.reason);

  const statusV = readEnumVal(body, "status", ACTIVITY_STATUSES);
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

  const occurredV = readOptionalIsoTimestamp(body, "occurred_at", true);
  if (!occurredV.ok)
    return validationFailure(occurredV.field, occurredV.reason);

  const outcomeV = readString(body, "outcome_summary", { min: 3, max: 1000 });
  if (!outcomeV.ok) return validationFailure(outcomeV.field, outcomeV.reason);

  const nextStepV = readString(body, "next_step", {
    min: 1,
    max: 500,
    optional: true,
  });
  if (!nextStepV.ok)
    return validationFailure(nextStepV.field, nextStepV.reason);

  const nextDueV = readOptionalIsoTimestamp(body, "next_action_due_at", false);
  if (!nextDueV.ok) return validationFailure(nextDueV.field, nextDueV.reason);

  const custRefV = readString(body, "synthetic_customer_ref", {
    min: 2,
    max: 64,
    optional: true,
  });
  if (!custRefV.ok) return validationFailure(custRefV.field, custRefV.reason);

  let salesPlanId: string | null = null;
  if (
    body.sales_plan_id !== undefined &&
    body.sales_plan_id !== null &&
    body.sales_plan_id !== ""
  ) {
    if (typeof body.sales_plan_id !== "string" || !isUuid(body.sales_plan_id)) {
      return validationFailure("sales_plan_id", "INVALID_UUID");
    }
    salesPlanId = body.sales_plan_id;
  }

  let kpiDefId: string | null = null;
  if (
    body.kpi_definition_id !== undefined &&
    body.kpi_definition_id !== null &&
    body.kpi_definition_id !== ""
  ) {
    if (
      typeof body.kpi_definition_id !== "string" ||
      !isUuid(body.kpi_definition_id)
    ) {
      return validationFailure("kpi_definition_id", "INVALID_UUID");
    }
    kpiDefId = body.kpi_definition_id;
  }

  // Single-source activity log is recorded by the authenticated actor for themselves
  const denied = authorize(
    actor,
    {
      action: "planning.activity.write",
      targetDepartmentId: actor.ctx.department.id,
      targetStaffId: actor.ctx.staff_id,
    },
    {
      type: "activity_log",
      id: "new",
    },
  );
  if (denied) return finalizeFailure(actor, denied);

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      if (salesPlanId) {
        const planRes = await client.query<{
          id: string;
          staff_id: string;
          department_id: string;
        }>(
          `SELECT id, staff_id, department_id FROM sales_plans WHERE id = $1`,
          [salesPlanId],
        );
        if (planRes.rowCount === 0) {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy kế hoạch bán hàng.",
          );
        }
        const plan = planRes.rows[0]!;
        if (
          current.effective_role.scope_type === "SELF" &&
          plan.staff_id !== current.staff_id
        ) {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy kế hoạch bán hàng.",
          );
        }
        if (
          current.effective_role.scope_type === "DEPARTMENT" &&
          plan.department_id !== current.department.id
        ) {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy kế hoạch bán hàng.",
          );
        }
      }

      let kpiMetricCode: string | null = null;
      if (kpiDefId) {
        const kdRes = await client.query<{ metric_code: string }>(
          `SELECT metric_code FROM kpi_definitions WHERE id = $1`,
          [kpiDefId],
        );
        if (kdRes.rowCount === 0) {
          abort(
            422,
            "VALIDATION_FAILED",
            "Chỉ số KPI tham chiếu không tồn tại.",
          );
        }
        kpiMetricCode = kdRes.rows[0]!.metric_code;
      }

      const actId = randomUUID();
      const ins = await client.query(
        `INSERT INTO activity_logs (
           id, actor_staff_id, department_id, sales_plan_id, kpi_definition_id,
           synthetic_customer_ref, activity_type, occurred_at, status,
           outcome_summary, next_step, next_action_due_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          actId,
          current.staff_id,
          current.department.id,
          salesPlanId,
          kpiDefId,
          custRefV.value ?? null,
          typeV.value!,
          occurredV.value!,
          statusV.value!,
          outcomeV.value!,
          nextStepV.value ?? null,
          nextDueV.value,
        ],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.activity.write",
        resourceType: "activity_log",
        resourceId: actId,
        scopeContext: {
          activity_type: typeV.value!,
          status: statusV.value!,
          sales_plan_id: salesPlanId,
        },
        decision: "ALLOW",
        reasonCode: "ACTIVITY_LOG_CREATED",
      });

      return mapActivityRow({
        ...ins.rows[0]!,
        actor_staff_code: current.staff_code,
        actor_staff_name: current.display_name,
        department_code: current.department.code,
        kpi_metric_code: kpiMetricCode,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 201, data: txResult.data };
}

export async function patchActivity(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<ActivityLogDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.activity.write", "activity_log"),
    );
  }

  const idV = readString(body, "id", { min: 36, max: 36 });
  if (!idV.ok || !isUuid(idV.value)) {
    return validationFailure("id", "INVALID_UUID");
  }
  const actId = idV.value!;

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);

  const statusV = readEnumVal(body, "status", ACTIVITY_STATUSES, true);
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

  const outcomeV = readString(body, "outcome_summary", {
    min: 3,
    max: 1000,
    optional: true,
  });
  if (!outcomeV.ok) return validationFailure(outcomeV.field, outcomeV.reason);

  const nextStepV = readString(body, "next_step", {
    min: 1,
    max: 500,
    optional: true,
  });
  if (!nextStepV.ok)
    return validationFailure(nextStepV.field, nextStepV.reason);

  const nextDueV = readOptionalIsoTimestamp(body, "next_action_due_at", false);
  if (!nextDueV.ok) return validationFailure(nextDueV.field, nextDueV.reason);

  const preCheck = authorize(
    actor,
    { action: "planning.activity.write" },
    { type: "activity_log", id: actId },
  );
  if (preCheck) return finalizeFailure(actor, preCheck);

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const curRes = await client.query(
        `SELECT a.*, s.staff_code AS actor_staff_code, s.display_name AS actor_staff_name,
                d.code AS department_code, kd.metric_code AS kpi_metric_code
         FROM activity_logs a
         JOIN staff s ON s.id = a.actor_staff_id
         JOIN departments d ON d.id = a.department_id
         LEFT JOIN kpi_definitions kd ON kd.id = a.kpi_definition_id
         WHERE a.id = $1
         FOR UPDATE OF a`,
        [actId],
      );
      if (curRes.rowCount === 0) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhật ký hoạt động.",
        );
      }
      const existing = curRes.rows[0]!;

      const rowDenied = authorize(
        actor,
        {
          action: "planning.activity.write",
          targetDepartmentId: String(existing.department_id),
          targetStaffId: String(existing.actor_staff_id),
        },
        {
          type: "activity_log",
          id: actId,
        },
      );
      if (rowDenied) {
        abort(rowDenied.status, rowDenied.code, rowDenied.message, {
          denyAudit: {
            action: "planning.activity.write",
            resourceType: "activity_log",
            resourceId: actId,
            scopeContext: { reason: rowDenied.code },
            reasonCode: rowDenied.code,
          },
        });
      }

      if (Number(existing.row_version) !== verV.value) {
        abort(409, "VERSION_CONFLICT", "Xung đột phiên bản nhật ký hoạt động.");
      }

      const nextStatus = statusV.value ?? (existing.status as ActivityStatus);
      const nextOutcome = outcomeV.value ?? String(existing.outcome_summary);
      const nextStep =
        nextStepV.value !== undefined
          ? nextStepV.value
          : (existing.next_step as string | null);
      const nextDue =
        body.next_action_due_at !== undefined
          ? nextDueV.value
          : (existing.next_action_due_at as string | null);

      const upd = await client.query(
        `UPDATE activity_logs
         SET status = $2,
             outcome_summary = $3,
             next_step = $4,
             next_action_due_at = $5
         WHERE id = $1
         RETURNING *`,
        [actId, nextStatus, nextOutcome, nextStep, nextDue],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.activity.write",
        resourceType: "activity_log",
        resourceId: actId,
        scopeContext: {
          previous_status: existing.status,
          new_status: nextStatus,
          new_version: upd.rows[0]!.row_version,
        },
        decision: "ALLOW",
        reasonCode: "ACTIVITY_LOG_UPDATED",
      });

      return mapActivityRow({
        ...upd.rows[0]!,
        actor_staff_code: existing.actor_staff_code,
        actor_staff_name: existing.actor_staff_name,
        department_code: existing.department_code,
        kpi_metric_code: existing.kpi_metric_code,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 200, data: txResult.data };
}

// ============================================================================
// 3. Monday Reviews & Directive Tasks (monday_reviews, directive_tasks)
// ============================================================================

export async function listMondayReviews(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<MondayReviewBundleDto>> {
  const denied = authorize(
    actor,
    { action: "planning.review.read" },
    { type: "monday_review", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "week_period_key",
    "department_id",
  ]);
  if (!queryCheck.ok) {
    if (queryCheck.reason === "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED") {
      return finalizeFailure(
        actor,
        tamperRejected("planning.review.read", "monday_review"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const weekKey = searchParams.get("week_period_key")?.trim() || "2026-W46";
  const weekBounds = resolveWeekBoundsVn(weekKey);
  if (!weekBounds) {
    return validationFailure("week_period_key", "INVALID_WEEK_KEY");
  }

  const deptParam = searchParams.get("department_id")?.trim() ?? "";
  if (deptParam && !isUuid(deptParam)) {
    return validationFailure("department_id", "INVALID_UUID");
  }

  const scope = actor.ctx.effective_role.scope_type;
  if (
    scope !== "BRANCH" &&
    deptParam &&
    deptParam !== actor.ctx.department.id
  ) {
    return finalizeFailure(
      actor,
      notFound("planning.review.read", "monday_review", deptParam),
    );
  }

  const pool = getRuntimePool();

  // 1. Monday Reviews within scope
  const revWhere: string[] = [`r.week_period_key = $1`];
  const revParams: unknown[] = [weekKey];
  if (scope === "DEPARTMENT" || scope === "SELF") {
    revParams.push(actor.ctx.department.id);
    revWhere.push(
      `(r.department_id = $${revParams.length} OR r.scope_type = 'BRANCH')`,
    );
  } else if (deptParam) {
    revParams.push(deptParam);
    revWhere.push(`r.department_id = $${revParams.length}`);
  }

  const reviewsRes = await pool.query(
    `SELECT r.*, d.code AS department_code, s.display_name AS conducted_by_name
     FROM monday_reviews r
     LEFT JOIN departments d ON d.id = r.department_id
     JOIN staff s ON s.id = r.conducted_by_staff_id
     WHERE ${revWhere.join(" AND ")}
     ORDER BY r.scope_type ASC, r.created_at DESC`,
    revParams,
  );

  // 2. Directive Tasks within scope
  const dirWhere: string[] = [`mr.week_period_key = $1`];
  const dirParams: unknown[] = [weekKey];
  if (scope === "DEPARTMENT") {
    dirParams.push(actor.ctx.department.id);
    dirWhere.push(`dt.department_id = $${dirParams.length}`);
  } else if (scope === "SELF") {
    dirParams.push(actor.ctx.staff_id);
    dirWhere.push(`dt.assignee_staff_id = $${dirParams.length}`);
  } else if (deptParam) {
    dirParams.push(deptParam);
    dirWhere.push(`dt.department_id = $${dirParams.length}`);
  }

  const directivesRes = await pool.query(
    `SELECT dt.*,
            mr.week_period_key,
            d.code AS department_code,
            s.staff_code AS assignee_staff_code,
            s.display_name AS assignee_name
     FROM directive_tasks dt
     JOIN monday_reviews mr ON mr.id = dt.monday_review_id
     JOIN departments d ON d.id = dt.department_id
     JOIN staff s ON s.id = dt.assignee_staff_id
     WHERE ${dirWhere.join(" AND ")}
     ORDER BY dt.due_at ASC, dt.created_at DESC`,
    dirParams,
  );

  // 3. Live Single-Source Weekly Activity Rollup (no manual Actual entry!)
  const rollupWhere: string[] = [`s.status = 'ACTIVE'`];
  const rollupParams: unknown[] = [
    weekKey,
    weekBounds.startIsoUtc,
    weekBounds.endIsoUtc,
  ];
  if (scope === "DEPARTMENT") {
    rollupParams.push(actor.ctx.department.id);
    rollupWhere.push(`s.department_id = $${rollupParams.length}`);
  } else if (scope === "SELF") {
    rollupParams.push(actor.ctx.staff_id);
    rollupWhere.push(`s.id = $${rollupParams.length}`);
  } else if (deptParam) {
    rollupParams.push(deptParam);
    rollupWhere.push(`s.department_id = $${rollupParams.length}`);
  }

  const rollupRes = await pool.query(
    `SELECT s.id AS staff_id,
            s.staff_code,
            s.display_name AS staff_name,
            s.department_id,
            d.code AS department_code,
            COALESCE(p_agg.plans_count, 0) AS plans_count,
            COALESCE(a_agg.activities_total, 0) AS activities_total,
            COALESCE(a_agg.activities_completed, 0) AS activities_completed,
            COALESCE(a_agg.activities_follow_up_needed, 0) AS activities_follow_up_needed,
            COALESCE(a_agg.activities_planned, 0) AS activities_planned,
            COALESCE(a_agg.activities_cancelled, 0) AS activities_cancelled,
            COALESCE(t_agg.weekly_target_count, 0) AS weekly_target_count
     FROM staff s
     JOIN departments d ON d.id = s.department_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS plans_count
       FROM sales_plans sp
       WHERE sp.staff_id = s.id AND sp.period_key = $1
     ) p_agg ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         count(*)::int AS activities_total,
         count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS activities_completed,
         count(*) FILTER (WHERE a.status = 'FOLLOW_UP_NEEDED')::int AS activities_follow_up_needed,
         count(*) FILTER (WHERE a.status = 'PLANNED')::int AS activities_planned,
         count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS activities_cancelled
       FROM activity_logs a
       WHERE a.actor_staff_id = s.id
         AND a.occurred_at >= $2::timestamptz
         AND a.occurred_at < $3::timestamptz
     ) a_agg ON TRUE
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS weekly_target_count
       FROM kpi_targets kt
       WHERE kt.staff_id = s.id AND kt.period_type = 'WEEK' AND kt.period_key = $1
     ) t_agg ON TRUE
     WHERE ${rollupWhere.join(" AND ")}
     ORDER BY d.code ASC, s.staff_code ASC`,
    rollupParams,
  );

  return {
    ok: true,
    status: 200,
    data: {
      week_period_key: weekKey,
      week_start_vn: weekBounds.mondayDate,
      week_end_vn: weekBounds.sundayDate,
      reviews: reviewsRes.rows.map(mapMondayReviewRow),
      directives: directivesRes.rows.map(mapDirectiveRow),
      weekly_activity_rollup: rollupRes.rows.map((r) => ({
        staff_id: String(r.staff_id),
        staff_code: String(r.staff_code),
        staff_name: String(r.staff_name),
        department_id: String(r.department_id),
        department_code: String(r.department_code),
        plans_count: Number(r.plans_count ?? 0),
        activities_total: Number(r.activities_total ?? 0),
        activities_completed: Number(r.activities_completed ?? 0),
        activities_follow_up_needed: Number(r.activities_follow_up_needed ?? 0),
        activities_planned: Number(r.activities_planned ?? 0),
        activities_cancelled: Number(r.activities_cancelled ?? 0),
        weekly_target_count: Number(r.weekly_target_count ?? 0),
      })),
    },
  };
}

export async function createMondayReviewOrDirective(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<MondayReviewDto | DirectiveTaskDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const actionKind =
    typeof body.action === "string" ? body.action.trim() : "create_review";
  if (actionKind !== "create_review" && actionKind !== "create_directive") {
    return validationFailure("action", "INVALID_ENUM");
  }

  if (actionKind === "create_review") {
    const tamper = findDisallowedTamperKey(Object.keys(body), [
      "department_id",
    ]);
    if (tamper) {
      return finalizeFailure(
        actor,
        tamperRejected("planning.review.write", "monday_review"),
      );
    }

    const weekV = readString(body, "week_period_key", { min: 6, max: 12 });
    if (!weekV.ok || !resolveWeekBoundsVn(weekV.value!)) {
      return validationFailure("week_period_key", "INVALID_WEEK_KEY");
    }

    const reviewScopeV = readEnumVal(body, "review_scope", [
      "BRANCH",
      "DEPARTMENT",
    ] as const);
    if (!reviewScopeV.ok) {
      return validationFailure(reviewScopeV.field, reviewScopeV.reason);
    }
    const reviewScope = reviewScopeV.value!;

    let departmentId: string | null = null;
    if (reviewScope === "DEPARTMENT") {
      if (
        typeof body.department_id !== "string" ||
        !isUuid(body.department_id)
      ) {
        return validationFailure("department_id", "REQUIRED_UUID");
      }
      departmentId = body.department_id;
    } else if (
      body.department_id !== undefined &&
      body.department_id !== null
    ) {
      return validationFailure("department_id", "BRANCH_REVIEW_FORBIDS_DEPT");
    }

    const reviewDateV = readString(body, "review_date", { min: 10, max: 10 });
    if (!reviewDateV.ok || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDateV.value!)) {
      return validationFailure("review_date", "INVALID_DATE");
    }

    const summaryV = readString(body, "summary_notes", { min: 3, max: 2000 });
    if (!summaryV.ok) return validationFailure(summaryV.field, summaryV.reason);

    const denied = authorize(
      actor,
      {
        action: "planning.review.write",
        targetDepartmentId: departmentId ?? undefined,
      },
      {
        type: "monday_review",
        id: "new",
      },
    );
    if (denied) return finalizeFailure(actor, denied);

    if (
      reviewScope === "BRANCH" &&
      actor.ctx.effective_role.role_code !== "EXECUTIVE"
    ) {
      return finalizeFailure(
        actor,
        fail(
          403,
          "EXECUTIVE_BRANCH_REVIEW_REQUIRED",
          "Chỉ Ban Giám đốc (EXECUTIVE) được tạo biên bản Review cấp toàn chi nhánh.",
          {
            denyAudit: {
              action: "planning.review.write",
              resourceType: "monday_review",
              resourceId: weekV.value!,
              scopeContext: { review_scope: "BRANCH" },
              reasonCode: "EXECUTIVE_BRANCH_REVIEW_REQUIRED",
            },
          },
        ),
      );
    }

    const txResult = await runAuthorityTransaction(
      actor,
      async (client: PoolClient, current) => {
        let deptCode: string | null = null;
        if (departmentId) {
          const dRes = await client.query<{ code: string }>(
            `SELECT code FROM departments WHERE id = $1`,
            [departmentId],
          );
          if (dRes.rowCount === 0) {
            abort(422, "VALIDATION_FAILED", "Phòng ban không tồn tại.");
          }
          deptCode = dRes.rows[0]!.code;
        }

        const revId = randomUUID();
        let ins;
        try {
          ins = await client.query(
            `INSERT INTO monday_reviews (
               id, week_period_key, scope_type, department_id,
               conducted_by_staff_id, review_date, summary_notes, status
             ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, 'OPEN')
             RETURNING *`,
            [
              revId,
              weekV.value!,
              reviewScope,
              departmentId,
              current.staff_id,
              reviewDateV.value!,
              summaryV.value!,
            ],
          );
        } catch (err) {
          if ((err as { code?: string }).code === "23505") {
            abort(
              409,
              "MONDAY_REVIEW_ALREADY_EXISTS",
              "Biên bản Review tuần này cho phạm vi đã tồn tại.",
            );
          }
          throw err;
        }

        await appendAuditEvent(client, {
          actorStaffId: current.staff_id,
          actorSubjectRef: `staff:${current.staff_id}`,
          action: "planning.review.write",
          resourceType: "monday_review",
          resourceId: revId,
          scopeContext: {
            week_period_key: weekV.value!,
            review_scope: reviewScope,
            department_id: departmentId,
          },
          decision: "ALLOW",
          reasonCode: "MONDAY_REVIEW_CREATED",
        });

        return mapMondayReviewRow({
          ...ins.rows[0]!,
          department_code: deptCode,
          conducted_by_name: current.display_name,
        });
      },
    );

    if (!txResult.ok) return finalizeFailure(actor, txResult);
    return { ok: true, status: 201, data: txResult.data };
  }

  // actionKind === "create_directive"
  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.review.write", "directive_task"),
    );
  }

  const reviewIdV = readString(body, "monday_review_id", { min: 36, max: 36 });
  if (!reviewIdV.ok || !isUuid(reviewIdV.value)) {
    return validationFailure("monday_review_id", "INVALID_UUID");
  }
  const assigneeV = readString(body, "assignee_staff_id", { min: 36, max: 36 });
  if (!assigneeV.ok || !isUuid(assigneeV.value)) {
    return validationFailure("assignee_staff_id", "INVALID_UUID");
  }
  const titleV = readString(body, "title", { min: 3, max: 200 });
  if (!titleV.ok) return validationFailure(titleV.field, titleV.reason);

  const descV = readString(body, "description", {
    min: 1,
    max: 1000,
    optional: true,
  });
  if (!descV.ok) return validationFailure(descV.field, descV.reason);

  const dueV = readOptionalIsoTimestamp(body, "due_at", true);
  if (!dueV.ok) return validationFailure(dueV.field, dueV.reason);

  const denied = authorize(
    actor,
    { action: "planning.review.write" },
    { type: "directive_task", id: "new" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const mrRes = await client.query<{
        id: string;
        week_period_key: string;
        department_id: string | null;
      }>(
        `SELECT id, week_period_key, department_id FROM monday_reviews WHERE id = $1`,
        [reviewIdV.value!],
      );
      if (mrRes.rowCount === 0) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy phiên Review Thứ Hai.",
        );
      }
      const review = mrRes.rows[0]!;
      if (
        current.effective_role.role_code === "DEPARTMENT_MANAGER" &&
        review.department_id !== current.department.id
      ) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy phiên Review Thứ Hai trong phạm vi phòng.",
          {
            denyAudit: {
              action: "planning.directive.write",
              resourceType: "monday_review",
              resourceId: review.id,
              scopeContext: {
                review_department_id: review.department_id,
                actor_department_id: current.department.id,
              },
              reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            },
          },
        );
      }

      const staffRes = await client.query<{
        id: string;
        department_id: string;
        staff_code: string;
        display_name: string;
        department_code: string;
        status: string;
      }>(
        `SELECT s.id, s.department_id, s.staff_code, s.display_name,
                d.code AS department_code, s.status
         FROM staff s
         JOIN departments d ON d.id = s.department_id
         WHERE s.id = $1`,
        [assigneeV.value!],
      );
      if (staffRes.rowCount === 0) {
        abort(
          422,
          "VALIDATION_FAILED",
          "Nhân sự được giao việc không tồn tại.",
        );
      }
      const assignee = staffRes.rows[0]!;
      if (assignee.status !== "ACTIVE") {
        abort(
          422,
          "VALIDATION_FAILED",
          "Không thể giao chỉ đạo cho nhân sự đã ngừng hoạt động.",
        );
      }

      if (
        current.effective_role.role_code === "DEPARTMENT_MANAGER" &&
        assignee.department_id !== current.department.id
      ) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhân sự trong phạm vi phòng ban.",
          {
            denyAudit: {
              action: "planning.review.write",
              resourceType: "directive_task",
              resourceId: assignee.id,
              scopeContext: { assignee_dept: assignee.department_id },
              reasonCode: "CROSS_DEPARTMENT_DENIED",
            },
          },
        );
      }

      const dirId = randomUUID();
      const ins = await client.query(
        `INSERT INTO directive_tasks (
           id, monday_review_id, department_id, assignee_staff_id,
           issued_by_staff_id, title, description, due_at, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN')
         RETURNING *`,
        [
          dirId,
          review.id,
          assignee.department_id,
          assignee.id,
          current.staff_id,
          titleV.value!,
          descV.value ?? null,
          dueV.value!,
        ],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.review.write",
        resourceType: "directive_task",
        resourceId: dirId,
        scopeContext: {
          monday_review_id: review.id,
          assignee_staff_id: assignee.id,
          department_id: assignee.department_id,
        },
        decision: "ALLOW",
        reasonCode: "DIRECTIVE_TASK_CREATED",
      });

      return mapDirectiveRow({
        ...ins.rows[0]!,
        week_period_key: review.week_period_key,
        department_code: assignee.department_code,
        assignee_staff_code: assignee.staff_code,
        assignee_name: assignee.display_name,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 201, data: txResult.data };
}

export async function patchMondayReviewOrDirective(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<MondayReviewDto | DirectiveTaskDto>> {
  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("planning.directive.write", "monday_review"),
    );
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : "review";
  if (kind !== "review" && kind !== "directive") {
    return validationFailure("kind", "INVALID_ENUM");
  }

  const idV = readString(body, "id", { min: 36, max: 36 });
  if (!idV.ok || !isUuid(idV.value)) {
    return validationFailure("id", "INVALID_UUID");
  }
  const id = idV.value!;

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);

  if (kind === "review") {
    const summaryV = readString(body, "summary_notes", {
      min: 3,
      max: 2000,
      optional: true,
    });
    if (!summaryV.ok) return validationFailure(summaryV.field, summaryV.reason);

    const statusV = readEnumVal(body, "status", REVIEW_STATUSES, true);
    if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

    const denied = authorize(
      actor,
      { action: "planning.review.write" },
      { type: "monday_review", id },
    );
    if (denied) return finalizeFailure(actor, denied);

    const txResult = await runAuthorityTransaction(
      actor,
      async (client: PoolClient, current) => {
        const curRes = await client.query(
          `SELECT r.*, d.code AS department_code, s.display_name AS conducted_by_name
           FROM monday_reviews r
           LEFT JOIN departments d ON d.id = r.department_id
           JOIN staff s ON s.id = r.conducted_by_staff_id
           WHERE r.id = $1
           FOR UPDATE OF r`,
          [id],
        );
        if (curRes.rowCount === 0) {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy biên bản Review.",
          );
        }
        const existing = curRes.rows[0]!;

        if (
          current.effective_role.role_code === "DEPARTMENT_MANAGER" &&
          existing.department_id !== current.department.id
        ) {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy biên bản Review.",
          );
        }

        if (Number(existing.row_version) !== verV.value) {
          abort(409, "VERSION_CONFLICT", "Xung đột phiên bản biên bản Review.");
        }

        const upd = await client.query(
          `UPDATE monday_reviews
           SET summary_notes = $2, status = $3
           WHERE id = $1
           RETURNING *`,
          [
            id,
            summaryV.value ?? String(existing.summary_notes),
            statusV.value ?? String(existing.status),
          ],
        );

        await appendAuditEvent(client, {
          actorStaffId: current.staff_id,
          actorSubjectRef: `staff:${current.staff_id}`,
          action: "planning.review.write",
          resourceType: "monday_review",
          resourceId: id,
          scopeContext: {
            new_status: upd.rows[0]!.status,
            new_version: upd.rows[0]!.row_version,
          },
          decision: "ALLOW",
          reasonCode: "MONDAY_REVIEW_UPDATED",
        });

        return mapMondayReviewRow({
          ...upd.rows[0]!,
          department_code: existing.department_code,
          conducted_by_name: existing.conducted_by_name,
        });
      },
    );

    if (!txResult.ok) return finalizeFailure(actor, txResult);
    return { ok: true, status: 200, data: txResult.data };
  }

  // kind === "directive"
  const statusV = readEnumVal(body, "status", DIRECTIVE_STATUSES, true);
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

  const noteV = readString(body, "completion_note", {
    min: 1,
    max: 1000,
    optional: true,
  });
  if (!noteV.ok) return validationFailure(noteV.field, noteV.reason);

  const preDenied = authorize(
    actor,
    { action: "planning.directive.write" },
    { type: "directive_task", id },
  );
  if (preDenied) return finalizeFailure(actor, preDenied);

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const curRes = await client.query(
        `SELECT dt.*, mr.week_period_key, d.code AS department_code,
                s.staff_code AS assignee_staff_code, s.display_name AS assignee_name
         FROM directive_tasks dt
         JOIN monday_reviews mr ON mr.id = dt.monday_review_id
         JOIN departments d ON d.id = dt.department_id
         JOIN staff s ON s.id = dt.assignee_staff_id
         WHERE dt.id = $1
         FOR UPDATE OF dt`,
        [id],
      );
      if (curRes.rowCount === 0) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy công việc chỉ đạo.",
        );
      }
      const existing = curRes.rows[0]!;

      const rowDenied = authorize(
        actor,
        {
          action: "planning.directive.write",
          targetDepartmentId: String(existing.department_id),
          targetStaffId: String(existing.assignee_staff_id),
        },
        {
          type: "directive_task",
          id,
        },
      );
      if (rowDenied) {
        abort(rowDenied.status, rowDenied.code, rowDenied.message, {
          denyAudit: {
            action: "planning.directive.write",
            resourceType: "directive_task",
            resourceId: id,
            scopeContext: { reason: rowDenied.code },
            reasonCode: rowDenied.code,
          },
        });
      }

      if (Number(existing.row_version) !== verV.value) {
        abort(409, "VERSION_CONFLICT", "Xung đột phiên bản công việc chỉ đạo.");
      }

      const upd = await client.query(
        `UPDATE directive_tasks
         SET status = $2, completion_note = $3
         WHERE id = $1
         RETURNING *`,
        [
          id,
          statusV.value ?? String(existing.status),
          noteV.value !== undefined
            ? noteV.value
            : (existing.completion_note as string | null),
        ],
      );

      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "planning.directive.write",
        resourceType: "directive_task",
        resourceId: id,
        scopeContext: {
          previous_status: existing.status,
          new_status: upd.rows[0]!.status,
          new_version: upd.rows[0]!.row_version,
        },
        decision: "ALLOW",
        reasonCode: "DIRECTIVE_TASK_UPDATED",
      });

      return mapDirectiveRow({
        ...upd.rows[0]!,
        week_period_key: existing.week_period_key,
        department_code: existing.department_code,
        assignee_staff_code: existing.assignee_staff_code,
        assignee_name: existing.assignee_name,
      });
    },
  );

  if (!txResult.ok) return finalizeFailure(actor, txResult);
  return { ok: true, status: 200, data: txResult.data };
}
