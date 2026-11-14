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
  escapeLike,
  findDisallowedTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readPageParams,
  readString,
  validateQueryParams,
} from "@/server/validation";

export const KPI_GROUPS = [
  "LOAN",
  "DEPOSIT",
  "CARD",
  "TTQT",
  "NEW_RETAIL_CIF",
  "BIZ_HOUSEHOLD",
  "INSURANCE",
] as const;
export type KpiGroupCode = (typeof KPI_GROUPS)[number];

export const KPI_UNITS = [
  "VND",
  "USD",
  "CARD",
  "CUSTOMER",
  "CONTRACT",
] as const;
export type KpiUnitCode = (typeof KPI_UNITS)[number];

export const KPI_METRIC_TYPES = [
  "FLOW",
  "STOCK",
  "AVERAGE",
  "NET_CHANGE",
] as const;
export type KpiMetricType = (typeof KPI_METRIC_TYPES)[number];

export const KPI_TIME_AGG_RULES = [
  "SUM",
  "END_OF_PERIOD",
  "AVERAGE",
  "NET_DELTA",
] as const;
export type KpiTimeAggRule = (typeof KPI_TIME_AGG_RULES)[number];

export const KPI_STAFF_AGG_RULES = [
  "SUM",
  "WEIGHTED_ATTRIBUTION",
  "DEDUP_CUSTOMER",
] as const;
export type KpiStaffAggRule = (typeof KPI_STAFF_AGG_RULES)[number];

export const KPI_ATTRIBUTION_MODES = [
  "PRIMARY_ONLY",
  "PRIMARY_AND_REFERRER",
] as const;
export type KpiAttributionMode = (typeof KPI_ATTRIBUTION_MODES)[number];

export const KPI_PERIOD_TYPES = ["YEAR", "MONTH", "WEEK", "DAY"] as const;
export type KpiPeriodType = (typeof KPI_PERIOD_TYPES)[number];

export const KPI_TARGET_SCOPES = ["BRANCH", "DEPARTMENT", "SELF"] as const;
export type KpiTargetScope = (typeof KPI_TARGET_SCOPES)[number];

export const KPI_TARGET_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SUPERSEDED",
] as const;
export type KpiTargetStatus = (typeof KPI_TARGET_STATUSES)[number];

export interface BranchCalendarDayDto {
  calendar_date: string;
  is_working_day: boolean;
  holiday_name: string | null;
  weekly_cutoff_day: "MONDAY" | "SUNDAY";
  daily_report_cutoff_time: string;
  row_version: number;
  updated_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiDefinitionDto {
  id: string;
  metric_code: string;
  metric_name: string;
  group_code: KpiGroupCode;
  unit_code: KpiUnitCode;
  currency_code: "VND" | "USD" | null;
  metric_type: KpiMetricType;
  time_aggregation_rule: KpiTimeAggRule;
  staff_aggregation_rule: KpiStaffAggRule;
  attribution_mode: KpiAttributionMode;
  primary_weight: string;
  referrer_weight: string;
  formula_expression: string;
  source_system_code: string;
  cutoff_rule: string;
  version: number;
  status: "ACTIVE" | "INACTIVE";
  effective_from: string;
  effective_to: string | null;
  approval_reference: string;
  row_version: number;
  created_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiTargetRevisionDto {
  id: string;
  target_id: string;
  revision_no: number;
  previous_target_value: string | null;
  new_target_value: string;
  previous_status: string | null;
  new_status: string;
  change_reason: string;
  changed_by_staff_id: string;
  approved_by_staff_id: string | null;
  created_at: string;
}

export interface KpiTargetDto {
  id: string;
  kpi_definition_id: string;
  metric_code: string;
  metric_name: string;
  group_code: KpiGroupCode;
  unit_code: KpiUnitCode;
  metric_type: KpiMetricType;
  period_type: KpiPeriodType;
  period_key: string;
  scope_type: KpiTargetScope;
  department_id: string | null;
  staff_id: string | null;
  parent_target_id: string | null;
  target_value: string;
  status: KpiTargetStatus;
  revision_no: number;
  proposed_by_staff_id: string;
  approved_by_staff_id: string | null;
  approved_at: string | null;
  approval_reference: string | null;
  notes: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  revisions: KpiTargetRevisionDto[];
}

export interface CalendarListPayload {
  items: BranchCalendarDayDto[];
  summary: {
    total_days: number;
    working_days_count: number;
    non_working_days_count: number;
    timezone: "Asia/Ho_Chi_Minh";
    weekly_cutoff_day: "MONDAY";
    daily_report_cutoff_time: "18:00";
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^[0-2][0-9]:[0-5][0-9]$/;
const METRIC_CODE_RE = /^[A-Z0-9_]{3,64}$/;
const PERIOD_KEY_YEAR_RE = /^\d{4}$/;
const PERIOD_KEY_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_KEY_WEEK_RE = /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/;
const NUMERIC_20_2_RE = /^\d{1,18}(\.\d{1,2})?$/;

const VALIDATION_MESSAGE = "Dữ liệu đầu vào không hợp lệ.";

function validationFailure(field: string, reason: string): ServiceFailure {
  return fail(422, "VALIDATION_FAILED", VALIDATION_MESSAGE, {
    details: { field, reason },
  });
}

function created<T>(
  result: Awaited<ReturnType<typeof runAuthorityTransaction<T>>>,
): ServiceResult<T> {
  return result.ok ? { ...result, status: 201 } : result;
}

export function isValidPeriodKey(
  periodType: KpiPeriodType,
  periodKey: string,
): boolean {
  switch (periodType) {
    case "YEAR":
      return PERIOD_KEY_YEAR_RE.test(periodKey);
    case "MONTH":
      return PERIOD_KEY_MONTH_RE.test(periodKey);
    case "WEEK":
      return PERIOD_KEY_WEEK_RE.test(periodKey);
    case "DAY":
      return DATE_RE.test(periodKey);
    default:
      return false;
  }
}

export function normalizeDecimal2(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    const formatted = raw.toFixed(2);
    if (Math.abs(Number(formatted) - raw) > 1e-9) return null;
    return NUMERIC_20_2_RE.test(formatted) ? formatted : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!NUMERIC_20_2_RE.test(trimmed)) return null;
    const [intPart, fracPart = ""] = trimmed.split(".");
    return `${intPart}.${fracPart.padEnd(2, "0")}`;
  }
  return null;
}

export function summarizeWorkingCalendar(
  days: ReadonlyArray<{ calendar_date: string; is_working_day: boolean }>,
): CalendarListPayload["summary"] {
  let working = 0;
  let nonWorking = 0;
  for (const d of days) {
    if (d.is_working_day) working += 1;
    else nonWorking += 1;
  }
  return {
    total_days: days.length,
    working_days_count: working,
    non_working_days_count: nonWorking,
    timezone: "Asia/Ho_Chi_Minh",
    weekly_cutoff_day: "MONDAY",
    daily_report_cutoff_time: "18:00",
  };
}

function mapCalendarRow(row: Record<string, unknown>): BranchCalendarDayDto {
  const rawDate = row.calendar_date;
  let dateStr: string;
  if (rawDate instanceof Date) {
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, "0");
    const d = String(rawDate.getDate()).padStart(2, "0");
    dateStr = `${y}-${m}-${d}`;
  } else {
    dateStr = String(rawDate).slice(0, 10);
  }
  return {
    calendar_date: dateStr,
    is_working_day: Boolean(row.is_working_day),
    holiday_name: (row.holiday_name as string | null) ?? null,
    weekly_cutoff_day:
      (row.weekly_cutoff_day as "MONDAY" | "SUNDAY") ?? "MONDAY",
    daily_report_cutoff_time:
      (row.daily_report_cutoff_time as string) ?? "18:00",
    row_version: Number(row.row_version),
    updated_by_staff_id: (row.updated_by_staff_id as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapDefinitionRow(row: Record<string, unknown>): KpiDefinitionDto {
  return {
    id: String(row.id),
    metric_code: String(row.metric_code),
    metric_name: String(row.metric_name),
    group_code: row.group_code as KpiGroupCode,
    unit_code: row.unit_code as KpiUnitCode,
    currency_code: (row.currency_code as "VND" | "USD" | null) ?? null,
    metric_type: row.metric_type as KpiMetricType,
    time_aggregation_rule: row.time_aggregation_rule as KpiTimeAggRule,
    staff_aggregation_rule: row.staff_aggregation_rule as KpiStaffAggRule,
    attribution_mode: row.attribution_mode as KpiAttributionMode,
    primary_weight: Number(row.primary_weight).toFixed(4),
    referrer_weight: Number(row.referrer_weight).toFixed(4),
    formula_expression: String(row.formula_expression),
    source_system_code: String(row.source_system_code),
    cutoff_rule: String(row.cutoff_rule),
    version: Number(row.version),
    status: row.status as "ACTIVE" | "INACTIVE",
    effective_from: new Date(row.effective_from as string | Date).toISOString(),
    effective_to: row.effective_to
      ? new Date(row.effective_to as string | Date).toISOString()
      : null,
    approval_reference: String(row.approval_reference),
    row_version: Number(row.row_version),
    created_by_staff_id: (row.created_by_staff_id as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
  };
}

function mapRevisionRow(row: Record<string, unknown>): KpiTargetRevisionDto {
  return {
    id: String(row.id),
    target_id: String(row.target_id),
    revision_no: Number(row.revision_no),
    previous_target_value:
      row.previous_target_value !== null &&
      row.previous_target_value !== undefined
        ? Number(row.previous_target_value).toFixed(2)
        : null,
    new_target_value: Number(row.new_target_value).toFixed(2),
    previous_status: (row.previous_status as string | null) ?? null,
    new_status: String(row.new_status),
    change_reason: String(row.change_reason),
    changed_by_staff_id: String(row.changed_by_staff_id),
    approved_by_staff_id: (row.approved_by_staff_id as string | null) ?? null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

function mapTargetRow(
  row: Record<string, unknown>,
  revisions: KpiTargetRevisionDto[],
): KpiTargetDto {
  return {
    id: String(row.id),
    kpi_definition_id: String(row.kpi_definition_id),
    metric_code: String(row.metric_code),
    metric_name: String(row.metric_name),
    group_code: row.group_code as KpiGroupCode,
    unit_code: row.unit_code as KpiUnitCode,
    metric_type: row.metric_type as KpiMetricType,
    period_type: row.period_type as KpiPeriodType,
    period_key: String(row.period_key),
    scope_type: row.scope_type as KpiTargetScope,
    department_id: (row.department_id as string | null) ?? null,
    staff_id: (row.staff_id as string | null) ?? null,
    parent_target_id: (row.parent_target_id as string | null) ?? null,
    target_value: Number(row.target_value).toFixed(2),
    status: row.status as KpiTargetStatus,
    revision_no: Number(row.revision_no),
    proposed_by_staff_id: String(row.proposed_by_staff_id),
    approved_by_staff_id: (row.approved_by_staff_id as string | null) ?? null,
    approved_at: row.approved_at
      ? new Date(row.approved_at as string | Date).toISOString()
      : null,
    approval_reference: (row.approval_reference as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    row_version: Number(row.row_version),
    created_at: new Date(row.created_at as string | Date).toISOString(),
    updated_at: new Date(row.updated_at as string | Date).toISOString(),
    revisions,
  };
}

function readEnumVal<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  optional = false,
):
  | { ok: true; value: T | undefined }
  | { ok: false; field: string; reason: string } {
  const raw = obj[field];
  if (raw === undefined || raw === null) {
    return optional
      ? { ok: true, value: undefined }
      : { ok: false, field, reason: "REQUIRED" };
  }
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    return { ok: false, field, reason: "INVALID_ENUM" };
  }
  return { ok: true, value: raw as T };
}

// ============================================================================
// 1. Working Calendar (branch_calendar_days, D-03 Option A)
// ============================================================================

export async function listCalendarDays(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<CalendarListPayload>> {
  const denied = authorize(
    actor,
    { action: "kpi.calendar.read" },
    { type: "branch_calendar_day", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "from",
    "to",
    "is_working_day",
    "limit",
    "offset",
  ]);
  if (!queryCheck.ok) {
    if (queryCheck.reason === "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED") {
      return finalizeFailure(
        actor,
        tamperRejected("kpi.calendar.read", "branch_calendar_day"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const from = searchParams.get("from")?.trim() || "2026-11-01";
  const to = searchParams.get("to")?.trim() || "2026-11-30";
  if (!DATE_RE.test(from)) return validationFailure("from", "INVALID_DATE");
  if (!DATE_RE.test(to)) return validationFailure("to", "INVALID_DATE");
  if (from > to) return validationFailure("to", "MUST_BE_AFTER_OR_EQUAL_FROM");

  const isWorkingParam = searchParams.get("is_working_day");
  let isWorkingFilter: boolean | undefined;
  if (isWorkingParam !== null && isWorkingParam !== "") {
    if (isWorkingParam !== "true" && isWorkingParam !== "false") {
      return validationFailure("is_working_day", "INVALID_BOOLEAN");
    }
    isWorkingFilter = isWorkingParam === "true";
  }

  const page = readPageParams(searchParams);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const pool = getRuntimePool();
  const params: unknown[] = [from, to];
  const where: string[] = [
    `calendar_date >= $1::date`,
    `calendar_date <= $2::date`,
  ];
  if (isWorkingFilter !== undefined) {
    params.push(isWorkingFilter);
    where.push(`is_working_day = $${params.length}`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const allWindowRes = await pool.query(
    `SELECT calendar_date, is_working_day, holiday_name, weekly_cutoff_day,
            daily_report_cutoff_time, row_version, updated_by_staff_id,
            created_at, updated_at
     FROM branch_calendar_days
     ${whereSql}
     ORDER BY calendar_date ASC`,
    params,
  );

  const allMapped = allWindowRes.rows.map(mapCalendarRow);
  const summary = summarizeWorkingCalendar(allMapped);
  const sliced = allMapped.slice(
    page.value.offset,
    page.value.offset + page.value.limit,
  );

  return {
    ok: true,
    status: 200,
    data: {
      items: sliced,
      summary,
    },
    page: {
      limit: page.value.limit,
      offset: page.value.offset,
      total: allMapped.length,
    },
  };
}

export async function writeCalendarDay(
  actor: Actor,
  body: unknown,
  mode: "create" | "patch",
): Promise<ServiceResult<BranchCalendarDayDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.calendar.write" },
    { type: "branch_calendar_day", id: mode },
  );
  if (denied) return finalizeFailure(actor, denied);

  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.calendar.write", "branch_calendar_day"),
    );
  }

  const dateV = readString(body, "calendar_date", {
    min: 10,
    max: 10,
    pattern: DATE_RE,
  });
  if (!dateV.ok) return validationFailure(dateV.field, dateV.reason);
  const calendarDate = dateV.value!;

  if (typeof body.is_working_day !== "boolean") {
    return validationFailure("is_working_day", "MUST_BE_BOOLEAN");
  }
  const isWorkingDay = body.is_working_day;

  let holidayName: string | null = null;
  if (body.holiday_name !== undefined && body.holiday_name !== null) {
    const hV = readString(body, "holiday_name", {
      min: 1,
      max: 160,
      optional: true,
    });
    if (!hV.ok) return validationFailure(hV.field, hV.reason);
    holidayName = hV.value ?? null;
  }

  const weeklyV = readEnumVal(
    body,
    "weekly_cutoff_day",
    ["MONDAY", "SUNDAY"] as const,
    true,
  );
  if (!weeklyV.ok) return validationFailure(weeklyV.field, weeklyV.reason);
  const weeklyCutoffDay = weeklyV.value ?? "MONDAY";

  const cutoffTimeV = readString(body, "daily_report_cutoff_time", {
    min: 5,
    max: 5,
    pattern: TIME_RE,
    optional: true,
  });
  if (!cutoffTimeV.ok) {
    return validationFailure(cutoffTimeV.field, cutoffTimeV.reason);
  }
  const dailyCutoffTime = cutoffTimeV.value ?? "18:00";

  let expectedVersion: number | undefined;
  if (mode === "patch" || body.expected_version !== undefined) {
    const verV = readExpectedVersion(body);
    if (!verV.ok) return validationFailure(verV.field, verV.reason);
    expectedVersion = verV.value;
  }

  const txResult = await runAuthorityTransaction(
    actor,
    async (client: PoolClient, current) => {
      const existing = await client.query(
        `SELECT calendar_date, row_version
         FROM branch_calendar_days
         WHERE calendar_date = $1::date
         FOR UPDATE`,
        [calendarDate],
      );

      if (existing.rowCount === 0) {
        if (mode === "patch") {
          abort(
            404,
            "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            "Không tìm thấy ngày làm việc yêu cầu.",
            {
              denyAudit: {
                action: "kpi.calendar.write",
                resourceType: "branch_calendar_day",
                resourceId: calendarDate,
                scopeContext: { reason: "CALENDAR_DAY_NOT_FOUND" },
                reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
              },
            },
          );
        }

        const ins = await client.query(
          `INSERT INTO branch_calendar_days (
             calendar_date, is_working_day, holiday_name,
             weekly_cutoff_day, daily_report_cutoff_time, updated_by_staff_id
           ) VALUES ($1::date, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            calendarDate,
            isWorkingDay,
            holidayName,
            weeklyCutoffDay,
            dailyCutoffTime,
            current.staff_id,
          ],
        );
        const item = mapCalendarRow(ins.rows[0]!);
        await appendAuditEvent(client, {
          actorStaffId: current.staff_id,
          actorSubjectRef: `staff:${current.staff_id}`,
          action: "kpi.calendar.write",
          resourceType: "branch_calendar_day",
          resourceId: calendarDate,
          scopeContext: {
            calendar_date: calendarDate,
            is_working_day: isWorkingDay,
            row_version: item.row_version,
          },
          decision: "ALLOW",
          reasonCode: "CALENDAR_DAY_CREATED",
        });
        return item;
      }

      const currentRowVersion = Number(existing.rows[0]!.row_version);
      if (
        expectedVersion !== undefined &&
        currentRowVersion !== expectedVersion
      ) {
        abort(
          409,
          "VERSION_CONFLICT",
          "Xung đột phiên bản trên lịch làm việc.",
          {
            denyAudit: {
              action: "kpi.calendar.write",
              resourceType: "branch_calendar_day",
              resourceId: calendarDate,
              scopeContext: {
                expected_version: expectedVersion,
                actual_version: currentRowVersion,
              },
              reasonCode: "VERSION_CONFLICT",
            },
          },
        );
      }

      const upd = await client.query(
        `UPDATE branch_calendar_days
         SET is_working_day = $2,
             holiday_name = $3,
             weekly_cutoff_day = $4,
             daily_report_cutoff_time = $5,
             updated_by_staff_id = $6
         WHERE calendar_date = $1::date
         RETURNING *`,
        [
          calendarDate,
          isWorkingDay,
          holidayName,
          weeklyCutoffDay,
          dailyCutoffTime,
          current.staff_id,
        ],
      );
      const item = mapCalendarRow(upd.rows[0]!);
      await appendAuditEvent(client, {
        actorStaffId: current.staff_id,
        actorSubjectRef: `staff:${current.staff_id}`,
        action: "kpi.calendar.write",
        resourceType: "branch_calendar_day",
        resourceId: calendarDate,
        scopeContext: {
          calendar_date: calendarDate,
          is_working_day: isWorkingDay,
          row_version: item.row_version,
        },
        decision: "ALLOW",
        reasonCode: "CALENDAR_DAY_UPDATED",
      });
      return item;
    },
  );

  if (mode === "create" && txResult.ok && txResult.data.row_version === 1) {
    return created(txResult);
  }
  return txResult;
}

// ============================================================================
// 2. 7-Group KPI Dictionary (kpi_definitions, D-01 & ADR-003 Option A)
// ============================================================================

export async function listKpiDefinitions(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<KpiDefinitionDto[]>> {
  const denied = authorize(
    actor,
    { action: "kpi.dictionary.read" },
    { type: "kpi_definition", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "q",
    "group_code",
    "status",
    "metric_type",
    "limit",
    "offset",
  ]);
  if (!queryCheck.ok) {
    if (queryCheck.reason === "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED") {
      return finalizeFailure(
        actor,
        tamperRejected("kpi.dictionary.read", "kpi_definition"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length > 120) return validationFailure("q", "TOO_LONG");

  const groupCode = searchParams.get("group_code")?.trim() ?? "";
  if (groupCode && !KPI_GROUPS.includes(groupCode as KpiGroupCode)) {
    return validationFailure("group_code", "INVALID_ENUM");
  }

  const statusFilter = searchParams.get("status")?.trim() ?? "";
  if (
    statusFilter &&
    statusFilter !== "ACTIVE" &&
    statusFilter !== "INACTIVE"
  ) {
    return validationFailure("status", "INVALID_ENUM");
  }

  const metricTypeFilter = searchParams.get("metric_type")?.trim() ?? "";
  if (
    metricTypeFilter &&
    !KPI_METRIC_TYPES.includes(metricTypeFilter as KpiMetricType)
  ) {
    return validationFailure("metric_type", "INVALID_ENUM");
  }

  const page = readPageParams(searchParams);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const pool = getRuntimePool();
  const params: unknown[] = [];
  const where: string[] = [];

  if (groupCode) {
    params.push(groupCode);
    where.push(`group_code = $${params.length}`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    where.push(`status = $${params.length}`);
  }
  if (metricTypeFilter) {
    params.push(metricTypeFilter);
    where.push(`metric_type = $${params.length}`);
  }
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(metric_code ILIKE $${params.length} ESCAPE '\\' OR metric_name ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM kpi_definitions ${whereSql}`,
    params,
  );
  params.push(page.value.limit, page.value.offset);
  const rowsRes = await pool.query(
    `SELECT *
     FROM kpi_definitions
     ${whereSql}
     ORDER BY group_code ASC, metric_code ASC, version DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    ok: true,
    status: 200,
    data: rowsRes.rows.map(mapDefinitionRow),
    page: {
      limit: page.value.limit,
      offset: page.value.offset,
      total: Number(countRes.rows[0]?.total ?? 0),
    },
  };
}

export async function createKpiDefinition(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiDefinitionDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.dictionary.write" },
    { type: "kpi_definition", id: "create" },
  );
  if (denied) return finalizeFailure(actor, denied);

  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.dictionary.write", "kpi_definition"),
    );
  }

  const codeV = readString(body, "metric_code", {
    min: 3,
    max: 64,
    pattern: METRIC_CODE_RE,
  });
  if (!codeV.ok) return validationFailure(codeV.field, codeV.reason);

  const nameV = readString(body, "metric_name", { min: 2, max: 160 });
  if (!nameV.ok) return validationFailure(nameV.field, nameV.reason);

  const groupV = readEnumVal(body, "group_code", KPI_GROUPS);
  if (!groupV.ok) return validationFailure(groupV.field, groupV.reason);

  const unitV = readEnumVal(body, "unit_code", KPI_UNITS);
  if (!unitV.ok) return validationFailure(unitV.field, unitV.reason);

  let currencyCode: "VND" | "USD" | null = null;
  if (body.currency_code !== undefined && body.currency_code !== null) {
    const currV = readEnumVal(body, "currency_code", ["VND", "USD"] as const);
    if (!currV.ok) return validationFailure(currV.field, currV.reason);
    currencyCode = currV.value!;
  }

  const metricTypeV = readEnumVal(body, "metric_type", KPI_METRIC_TYPES);
  if (!metricTypeV.ok) {
    return validationFailure(metricTypeV.field, metricTypeV.reason);
  }

  const timeAggV = readEnumVal(
    body,
    "time_aggregation_rule",
    KPI_TIME_AGG_RULES,
  );
  if (!timeAggV.ok) return validationFailure(timeAggV.field, timeAggV.reason);

  // AC-01: Never allow STOCK metrics to use SUM time aggregation
  if (metricTypeV.value === "STOCK" && timeAggV.value === "SUM") {
    return finalizeFailure(
      actor,
      fail(
        422,
        "STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN",
        "Chỉ số số dư (STOCK) không được phép cộng dồn (SUM) theo thời gian.",
        {
          denyAudit: {
            action: "kpi.dictionary.write",
            resourceType: "kpi_definition",
            resourceId: codeV.value!,
            scopeContext: {
              metric_type: metricTypeV.value,
              time_aggregation_rule: timeAggV.value,
            },
            reasonCode: "STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN",
          },
        },
      ),
    );
  }

  const staffAggV = readEnumVal(
    body,
    "staff_aggregation_rule",
    KPI_STAFF_AGG_RULES,
    true,
  );
  if (!staffAggV.ok) {
    return validationFailure(staffAggV.field, staffAggV.reason);
  }
  const staffAggRule = staffAggV.value ?? "SUM";

  const attrModeV = readEnumVal(
    body,
    "attribution_mode",
    KPI_ATTRIBUTION_MODES,
    true,
  );
  if (!attrModeV.ok) {
    return validationFailure(attrModeV.field, attrModeV.reason);
  }
  const attributionMode = attrModeV.value ?? "PRIMARY_ONLY";

  const primaryWeight =
    body.primary_weight !== undefined ? Number(body.primary_weight) : 1.0;
  const referrerWeight =
    body.referrer_weight !== undefined ? Number(body.referrer_weight) : 0.0;
  if (
    !Number.isFinite(primaryWeight) ||
    !Number.isFinite(referrerWeight) ||
    primaryWeight < 0 ||
    referrerWeight < 0 ||
    Math.abs(primaryWeight + referrerWeight - 1.0) > 1e-6
  ) {
    return validationFailure("primary_weight", "WEIGHTS_MUST_SUM_TO_ONE");
  }

  const formulaV = readString(body, "formula_expression", {
    min: 3,
    max: 255,
  });
  if (!formulaV.ok) return validationFailure(formulaV.field, formulaV.reason);

  const approvalRefV = readString(body, "governance_ref", {
    min: 3,
    max: 128,
  });
  if (!approvalRefV.ok) {
    return validationFailure(approvalRefV.field, approvalRefV.reason);
  }

  const effectiveFromRaw =
    typeof body.effective_from === "string"
      ? body.effective_from
      : "2026-01-01T00:00:00.000Z";
  const effectiveFromDate = new Date(effectiveFromRaw);
  if (Number.isNaN(effectiveFromDate.getTime())) {
    return validationFailure("effective_from", "INVALID_TIMESTAMP");
  }

  let effectiveToIso: string | null = null;
  if (body.effective_to !== undefined && body.effective_to !== null) {
    const d = new Date(String(body.effective_to));
    if (
      Number.isNaN(d.getTime()) ||
      d.getTime() <= effectiveFromDate.getTime()
    ) {
      return validationFailure("effective_to", "INVALID_EFFECTIVE_TO");
    }
    effectiveToIso = d.toISOString();
  }

  const version = body.version !== undefined ? Number(body.version) : 1;
  if (!Number.isInteger(version) || version < 1) {
    return validationFailure("version", "INVALID_VERSION");
  }

  const id = randomUUID();
  return created(
    await runAuthorityTransaction(
      actor,
      async (client: PoolClient, current) => {
        const dup = await client.query(
          `SELECT id FROM kpi_definitions WHERE metric_code = $1 AND version = $2`,
          [codeV.value!, version],
        );
        if ((dup.rowCount ?? 0) > 0) {
          abort(
            409,
            "DUPLICATE_KPI_DEFINITION",
            "Mã KPI và phiên bản đã tồn tại.",
            {
              denyAudit: {
                action: "kpi.dictionary.write",
                resourceType: "kpi_definition",
                resourceId: codeV.value!,
                scopeContext: { metric_code: codeV.value!, version },
                reasonCode: "DUPLICATE_KPI_DEFINITION",
              },
            },
          );
        }

        const ins = await client.query(
          `INSERT INTO kpi_definitions (
             id, metric_code, metric_name, group_code, unit_code, currency_code,
             metric_type, time_aggregation_rule, staff_aggregation_rule,
             attribution_mode, primary_weight, referrer_weight,
             formula_expression, version, status, effective_from, effective_to,
             approval_reference, created_by_staff_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9,
             $10, $11, $12,
             $13, $14, 'ACTIVE', $15, $16,
             $17, $18
           ) RETURNING *`,
          [
            id,
            codeV.value!,
            nameV.value!,
            groupV.value!,
            unitV.value!,
            currencyCode,
            metricTypeV.value!,
            timeAggV.value!,
            staffAggRule,
            attributionMode,
            primaryWeight.toFixed(4),
            referrerWeight.toFixed(4),
            formulaV.value!,
            version,
            effectiveFromDate.toISOString(),
            effectiveToIso,
            approvalRefV.value!,
            current.staff_id,
          ],
        );

        const item = mapDefinitionRow(ins.rows[0]!);
        await appendAuditEvent(client, {
          actorStaffId: current.staff_id,
          actorSubjectRef: `staff:${current.staff_id}`,
          action: "kpi.dictionary.write",
          resourceType: "kpi_definition",
          resourceId: item.id,
          scopeContext: {
            metric_code: item.metric_code,
            group_code: item.group_code,
            metric_type: item.metric_type,
            time_aggregation_rule: item.time_aggregation_rule,
            row_version: item.row_version,
          },
          decision: "ALLOW",
          reasonCode: "KPI_DEFINITION_CREATED",
        });
        return item;
      },
    ),
  );
}

export async function patchKpiDefinition(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiDefinitionDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.dictionary.write" },
    { type: "kpi_definition", id: "patch" },
  );
  if (denied) return finalizeFailure(actor, denied);

  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.dictionary.write", "kpi_definition"),
    );
  }

  if (typeof body.id !== "string" || !isUuid(body.id)) {
    return validationFailure("id", "INVALID_UUID");
  }
  const id = body.id;

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);
  const expectedVersion = verV.value;

  const nameV = readString(body, "metric_name", {
    min: 2,
    max: 160,
    optional: true,
  });
  if (!nameV.ok) return validationFailure(nameV.field, nameV.reason);

  const formulaV = readString(body, "formula_expression", {
    min: 3,
    max: 255,
    optional: true,
  });
  if (!formulaV.ok) return validationFailure(formulaV.field, formulaV.reason);

  const statusV = readEnumVal(
    body,
    "status",
    ["ACTIVE", "INACTIVE"] as const,
    true,
  );
  if (!statusV.ok) return validationFailure(statusV.field, statusV.reason);

  const timeAggV = readEnumVal(
    body,
    "time_aggregation_rule",
    KPI_TIME_AGG_RULES,
    true,
  );
  if (!timeAggV.ok) return validationFailure(timeAggV.field, timeAggV.reason);

  return runAuthorityTransaction(actor, async (client: PoolClient, current) => {
    const existingRes = await client.query(
      `SELECT * FROM kpi_definitions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existingRes.rowCount === 0) {
      abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy định nghĩa KPI.",
        {
          denyAudit: {
            action: "kpi.dictionary.write",
            resourceType: "kpi_definition",
            resourceId: id,
            scopeContext: { reason: "NOT_FOUND" },
            reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          },
        },
      );
    }

    const row = existingRes.rows[0]!;
    if (Number(row.row_version) !== expectedVersion) {
      abort(409, "VERSION_CONFLICT", "Xung đột phiên bản định nghĩa KPI.", {
        denyAudit: {
          action: "kpi.dictionary.write",
          resourceType: "kpi_definition",
          resourceId: id,
          scopeContext: {
            expected_version: expectedVersion,
            actual_version: Number(row.row_version),
          },
          reasonCode: "VERSION_CONFLICT",
        },
      });
    }

    const nextTimeAgg =
      timeAggV.value ?? (row.time_aggregation_rule as KpiTimeAggRule);
    if (row.metric_type === "STOCK" && nextTimeAgg === "SUM") {
      abort(
        422,
        "STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN",
        "Chỉ số STOCK không được phép dùng quy tắc SUM.",
        {
          denyAudit: {
            action: "kpi.dictionary.write",
            resourceType: "kpi_definition",
            resourceId: id,
            scopeContext: {
              metric_type: "STOCK",
              time_aggregation_rule: "SUM",
            },
            reasonCode: "STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN",
          },
        },
      );
    }

    const upd = await client.query(
      `UPDATE kpi_definitions
         SET metric_name = $2,
             formula_expression = $3,
             status = $4,
             time_aggregation_rule = $5
         WHERE id = $1
         RETURNING *`,
      [
        id,
        nameV.value ?? row.metric_name,
        formulaV.value ?? row.formula_expression,
        statusV.value ?? row.status,
        nextTimeAgg,
      ],
    );
    const item = mapDefinitionRow(upd.rows[0]!);
    await appendAuditEvent(client, {
      actorStaffId: current.staff_id,
      actorSubjectRef: `staff:${current.staff_id}`,
      action: "kpi.dictionary.write",
      resourceType: "kpi_definition",
      resourceId: id,
      scopeContext: {
        metric_code: item.metric_code,
        status: item.status,
        row_version: item.row_version,
      },
      decision: "ALLOW",
      reasonCode: "KPI_DEFINITION_UPDATED",
    });
    return item;
  });
}

// ============================================================================
// 3. KPI Target Allocation, Revision History & Approval (kpi_targets)
// ============================================================================

async function loadRevisionsByTargetIds(
  clientOrPool: { query: PoolClient["query"] },
  targetIds: string[],
): Promise<Map<string, KpiTargetRevisionDto[]>> {
  const map = new Map<string, KpiTargetRevisionDto[]>();
  if (targetIds.length === 0) return map;
  const res = await clientOrPool.query(
    `SELECT * FROM kpi_target_revisions
     WHERE target_id = ANY($1::uuid[])
     ORDER BY target_id ASC, revision_no ASC`,
    [targetIds],
  );
  for (const r of res.rows) {
    const dto = mapRevisionRow(r);
    const list = map.get(dto.target_id) ?? [];
    list.push(dto);
    map.set(dto.target_id, list);
  }
  return map;
}

export async function listKpiTargets(
  actor: Actor,
  searchParams: URLSearchParams,
): Promise<ServiceResult<KpiTargetDto[]>> {
  const denied = authorize(
    actor,
    { action: "kpi.target.read" },
    { type: "kpi_target", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const queryCheck = validateQueryParams(searchParams, [
    "q",
    "kpi_definition_id",
    "group_code",
    "period_type",
    "period_key",
    "target_scope",
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
        tamperRejected("kpi.target.read", "kpi_target"),
      );
    }
    return validationFailure(queryCheck.field, queryCheck.reason);
  }

  const actorRole = actor.ctx.effective_role.role_code;
  const actorDeptId = actor.ctx.department.id;
  const actorStaffId = actor.ctx.staff_id;

  const deptFilter = searchParams.get("department_id")?.trim() ?? "";
  if (deptFilter) {
    if (!isUuid(deptFilter)) {
      return finalizeFailure(
        actor,
        notFound("kpi_target", deptFilter, "kpi.target.read"),
      );
    }
    if (
      (actorRole === "DEPARTMENT_MANAGER" || actorRole === "STAFF") &&
      deptFilter !== actorDeptId
    ) {
      return finalizeFailure(
        actor,
        notFound("kpi_target", deptFilter, "kpi.target.read"),
      );
    }
  }

  const staffFilter = searchParams.get("staff_id")?.trim() ?? "";
  const pool = getRuntimePool();
  if (staffFilter) {
    if (!isUuid(staffFilter)) {
      return finalizeFailure(
        actor,
        notFound("kpi_target", staffFilter, "kpi.target.read"),
      );
    }
    if (actorRole === "STAFF" && staffFilter !== actorStaffId) {
      return finalizeFailure(
        actor,
        notFound("kpi_target", staffFilter, "kpi.target.read"),
      );
    }
    if (actorRole === "DEPARTMENT_MANAGER") {
      const sCheck = await pool.query<{ department_id: string }>(
        `SELECT department_id FROM staff WHERE id = $1`,
        [staffFilter],
      );
      if (
        sCheck.rowCount === 0 ||
        sCheck.rows[0]!.department_id !== actorDeptId
      ) {
        return finalizeFailure(
          actor,
          notFound("kpi_target", staffFilter, "kpi.target.read"),
        );
      }
    }
  }

  const defFilter = searchParams.get("kpi_definition_id")?.trim() ?? "";
  if (defFilter && !isUuid(defFilter)) {
    return validationFailure("kpi_definition_id", "INVALID_UUID");
  }

  const groupFilter = searchParams.get("group_code")?.trim() ?? "";
  if (groupFilter && !KPI_GROUPS.includes(groupFilter as KpiGroupCode)) {
    return validationFailure("group_code", "INVALID_ENUM");
  }

  const periodTypeFilter = searchParams.get("period_type")?.trim() ?? "";
  if (
    periodTypeFilter &&
    !KPI_PERIOD_TYPES.includes(periodTypeFilter as KpiPeriodType)
  ) {
    return validationFailure("period_type", "INVALID_ENUM");
  }

  const periodKeyFilter = searchParams.get("period_key")?.trim() ?? "";
  const scopeTypeFilter = searchParams.get("target_scope")?.trim() ?? "";
  if (
    scopeTypeFilter &&
    !KPI_TARGET_SCOPES.includes(scopeTypeFilter as KpiTargetScope)
  ) {
    return validationFailure("target_scope", "INVALID_ENUM");
  }

  const statusFilter = searchParams.get("status")?.trim() ?? "";
  if (
    statusFilter &&
    !KPI_TARGET_STATUSES.includes(statusFilter as KpiTargetStatus)
  ) {
    return validationFailure("status", "INVALID_ENUM");
  }

  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length > 120) return validationFailure("q", "TOO_LONG");

  const page = readPageParams(searchParams);
  if (!page.ok) return validationFailure(page.field, page.reason);

  // Bind mandatory server-side scope filter BEFORE any user filters (AC-02/AC-03)
  const params: unknown[] = [];
  const where: string[] = [];

  if (actorRole === "DEPARTMENT_MANAGER") {
    params.push(actorDeptId);
    where.push(`t.department_id = $${params.length}`);
  } else if (actorRole === "STAFF") {
    params.push(actorStaffId);
    where.push(`t.staff_id = $${params.length}`);
  }

  if (deptFilter) {
    params.push(deptFilter);
    where.push(`t.department_id = $${params.length}`);
  }
  if (staffFilter) {
    params.push(staffFilter);
    where.push(`t.staff_id = $${params.length}`);
  }
  if (defFilter) {
    params.push(defFilter);
    where.push(`t.kpi_definition_id = $${params.length}`);
  }
  if (groupFilter) {
    params.push(groupFilter);
    where.push(`d.group_code = $${params.length}`);
  }
  if (periodTypeFilter) {
    params.push(periodTypeFilter);
    where.push(`t.period_type = $${params.length}`);
  }
  if (periodKeyFilter) {
    params.push(periodKeyFilter);
    where.push(`t.period_key = $${params.length}`);
  }
  if (scopeTypeFilter) {
    params.push(scopeTypeFilter);
    where.push(`t.scope_type = $${params.length}`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    where.push(`t.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(d.metric_code ILIKE $${params.length} ESCAPE '\\' OR d.metric_name ILIKE $${params.length} ESCAPE '\\' OR t.period_key ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM kpi_targets t
     JOIN kpi_definitions d ON d.id = t.kpi_definition_id
     ${whereSql}`,
    params,
  );

  params.push(page.value.limit, page.value.offset);
  const rowsRes = await pool.query(
    `SELECT t.*,
            d.metric_code,
            d.metric_name,
            d.group_code,
            d.unit_code,
            d.metric_type
     FROM kpi_targets t
     JOIN kpi_definitions d ON d.id = t.kpi_definition_id
     ${whereSql}
     ORDER BY t.period_key DESC, d.group_code ASC, d.metric_code ASC, t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const targetIds = rowsRes.rows.map((r) => String(r.id));
  const revMap = await loadRevisionsByTargetIds(pool, targetIds);
  const items = rowsRes.rows.map((r) =>
    mapTargetRow(r, revMap.get(String(r.id)) ?? []),
  );

  return {
    ok: true,
    status: 200,
    data: items,
    page: {
      limit: page.value.limit,
      offset: page.value.offset,
      total: Number(countRes.rows[0]?.total ?? 0),
    },
  };
}

export async function createKpiTarget(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiTargetDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.target.write" },
    { type: "kpi_target", id: "create" },
  );
  if (denied) return finalizeFailure(actor, denied);

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
      tamperRejected("kpi.target.write", "kpi_target"),
    );
  }

  if (
    typeof body.kpi_definition_id !== "string" ||
    !isUuid(body.kpi_definition_id)
  ) {
    return validationFailure("kpi_definition_id", "INVALID_UUID");
  }
  const kpiDefinitionId = body.kpi_definition_id;

  const periodTypeV = readEnumVal(body, "period_type", KPI_PERIOD_TYPES);
  if (!periodTypeV.ok) {
    return validationFailure(periodTypeV.field, periodTypeV.reason);
  }
  const periodType = periodTypeV.value!;

  const periodKeyV = readString(body, "period_key", { min: 4, max: 32 });
  if (!periodKeyV.ok || !isValidPeriodKey(periodType, periodKeyV.value!)) {
    return validationFailure("period_key", "INVALID_PERIOD_KEY");
  }
  const periodKey = periodKeyV.value!;

  const scopeTypeV = readEnumVal(body, "target_scope", KPI_TARGET_SCOPES);
  if (!scopeTypeV.ok) {
    return validationFailure(scopeTypeV.field, scopeTypeV.reason);
  }
  const scopeType = scopeTypeV.value!;

  let departmentId: string | null = null;
  if (body.department_id !== undefined && body.department_id !== null) {
    if (typeof body.department_id !== "string" || !isUuid(body.department_id)) {
      return validationFailure("department_id", "INVALID_UUID");
    }
    departmentId = body.department_id;
  }

  let staffId: string | null = null;
  if (body.staff_id !== undefined && body.staff_id !== null) {
    if (typeof body.staff_id !== "string" || !isUuid(body.staff_id)) {
      return validationFailure("staff_id", "INVALID_UUID");
    }
    staffId = body.staff_id;
  }

  if (scopeType === "BRANCH" && (departmentId !== null || staffId !== null)) {
    return validationFailure(
      "target_scope",
      "BRANCH_SCOPE_FORBIDS_DEPT_OR_STAFF",
    );
  }
  if (
    scopeType === "DEPARTMENT" &&
    (departmentId === null || staffId !== null)
  ) {
    return validationFailure(
      "target_scope",
      "DEPARTMENT_SCOPE_REQUIRES_DEPT_ONLY",
    );
  }
  if (scopeType === "SELF" && (departmentId === null || staffId === null)) {
    return validationFailure(
      "target_scope",
      "SELF_SCOPE_REQUIRES_DEPT_AND_STAFF",
    );
  }

  const actorRole = actor.ctx.effective_role.role_code;
  const actorDeptId = actor.ctx.department.id;
  const actorStaffId = actor.ctx.staff_id;

  if (actorRole === "STAFF") {
    if (
      scopeType !== "SELF" ||
      staffId !== actorStaffId ||
      departmentId !== actorDeptId
    ) {
      return finalizeFailure(
        actor,
        notFound(
          "kpi_target",
          staffId ?? departmentId ?? "create",
          "kpi.target.write",
        ),
      );
    }
    if (periodType === "YEAR" || periodType === "MONTH") {
      return finalizeFailure(
        actor,
        fail(
          403,
          "STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN",
          "Nhân viên chỉ được lập dự phóng Tuần/Ngày, không tự giao chỉ tiêu Năm/Tháng.",
          {
            denyAudit: {
              action: "kpi.target.write",
              resourceType: "kpi_target",
              resourceId: "create",
              scopeContext: { period_type: periodType },
              reasonCode: "STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN",
            },
          },
        ),
      );
    }
  } else if (actorRole === "DEPARTMENT_MANAGER") {
    if (scopeType === "BRANCH") {
      return finalizeFailure(
        actor,
        fail(
          403,
          "ACTION_FORBIDDEN_FOR_ROLE",
          "Trưởng phòng không có quyền giao chỉ tiêu cấp Chi nhánh.",
          {
            denyAudit: {
              action: "kpi.target.write",
              resourceType: "kpi_target",
              resourceId: "create",
              scopeContext: { scope_type: "BRANCH" },
              reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
            },
          },
        ),
      );
    }
    if (departmentId !== actorDeptId) {
      return finalizeFailure(
        actor,
        notFound("kpi_target", departmentId ?? "create", "kpi.target.write"),
      );
    }
  }

  const targetValue = normalizeDecimal2(body.target_value);
  if (targetValue === null) {
    return validationFailure("target_value", "INVALID_NUMERIC_20_2");
  }

  let parentTargetId: string | null = null;
  if (body.parent_target_id !== undefined && body.parent_target_id !== null) {
    if (
      typeof body.parent_target_id !== "string" ||
      !isUuid(body.parent_target_id)
    ) {
      return validationFailure("parent_target_id", "INVALID_UUID");
    }
    parentTargetId = body.parent_target_id;
  }

  const notesV = readString(body, "notes", {
    min: 1,
    max: 500,
    optional: true,
  });
  if (!notesV.ok) return validationFailure(notesV.field, notesV.reason);

  const approvalRefV = readString(body, "governance_ref", {
    min: 3,
    max: 128,
    optional: true,
  });
  if (!approvalRefV.ok) {
    return validationFailure(approvalRefV.field, approvalRefV.reason);
  }

  return created(
    await runAuthorityTransaction(
      actor,
      async (client: PoolClient, current) => {
        const defRes = await client.query(
          `SELECT * FROM kpi_definitions WHERE id = $1 AND status = 'ACTIVE'`,
          [kpiDefinitionId],
        );
        if (defRes.rowCount === 0) {
          abort(
            404,
            "KPI_DEFINITION_NOT_FOUND_OR_INACTIVE",
            "Không tìm thấy định nghĩa KPI đang hoạt động.",
            {
              denyAudit: {
                action: "kpi.target.write",
                resourceType: "kpi_target",
                resourceId: kpiDefinitionId,
                scopeContext: { reason: "KPI_DEFINITION_NOT_FOUND" },
                reasonCode: "KPI_DEFINITION_NOT_FOUND_OR_INACTIVE",
              },
            },
          );
        }

        if (departmentId) {
          const deptRes = await client.query(
            `SELECT id, status FROM departments WHERE id = $1`,
            [departmentId],
          );
          if (deptRes.rowCount === 0 || deptRes.rows[0]!.status !== "ACTIVE") {
            abort(
              404,
              "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
              "Phòng ban không tồn tại hoặc ngừng hoạt động.",
              {
                denyAudit: {
                  action: "kpi.target.write",
                  resourceType: "kpi_target",
                  resourceId: departmentId,
                  scopeContext: { reason: "DEPARTMENT_NOT_FOUND_OR_INACTIVE" },
                  reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
                },
              },
            );
          }
        }

        if (staffId) {
          const staffRes = await client.query(
            `SELECT id, department_id, status FROM staff WHERE id = $1`,
            [staffId],
          );
          if (
            staffRes.rowCount === 0 ||
            staffRes.rows[0]!.status !== "ACTIVE" ||
            staffRes.rows[0]!.department_id !== departmentId
          ) {
            abort(
              404,
              "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
              "Nhân sự không tồn tại hoặc không thuộc phòng ban.",
              {
                denyAudit: {
                  action: "kpi.target.write",
                  resourceType: "kpi_target",
                  resourceId: staffId,
                  scopeContext: { reason: "STAFF_NOT_FOUND_OR_MISMATCH" },
                  reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
                },
              },
            );
          }
        }

        if (parentTargetId) {
          const parentRes = await client.query(
            `SELECT id, kpi_definition_id FROM kpi_targets WHERE id = $1`,
            [parentTargetId],
          );
          if (
            parentRes.rowCount === 0 ||
            parentRes.rows[0]!.kpi_definition_id !== kpiDefinitionId
          ) {
            abort(
              404,
              "PARENT_TARGET_NOT_FOUND_OR_MISMATCH",
              "Chỉ tiêu mẹ không tồn tại hoặc khác mã KPI.",
              {
                denyAudit: {
                  action: "kpi.target.write",
                  resourceType: "kpi_target",
                  resourceId: parentTargetId,
                  scopeContext: { reason: "PARENT_MISMATCH" },
                  reasonCode: "PARENT_TARGET_NOT_FOUND_OR_MISMATCH",
                },
              },
            );
          }
        }

        const currentRole = current.effective_role.role_code;
        let status: KpiTargetStatus = "PENDING_APPROVAL";
        let approvedByStaffId: string | null = null;
        let approvedAt: string | null = null;
        let approvalRef: string | null = approvalRefV.value ?? null;

        if (currentRole === "EXECUTIVE" && approvalRef) {
          status = "APPROVED";
          approvedByStaffId = current.staff_id;
          approvedAt = new Date().toISOString();
        } else if (
          currentRole === "DEPARTMENT_MANAGER" &&
          scopeType === "SELF" &&
          staffId !== current.staff_id &&
          approvalRef
        ) {
          status = "APPROVED";
          approvedByStaffId = current.staff_id;
          approvedAt = new Date().toISOString();
        } else if (periodType === "WEEK" || periodType === "DAY") {
          status = "DRAFT";
          approvalRef = null;
        }

        const id = randomUUID();
        const ins = await client.query(
          `INSERT INTO kpi_targets (
             id, kpi_definition_id, period_type, period_key, scope_type,
             department_id, staff_id, parent_target_id, target_value,
             status, revision_no, proposed_by_staff_id, approved_by_staff_id,
             approved_at, approval_reference, notes
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9,
             $10, 1, $11, $12,
             $13, $14, $15
           ) RETURNING *`,
          [
            id,
            kpiDefinitionId,
            periodType,
            periodKey,
            scopeType,
            departmentId,
            staffId,
            parentTargetId,
            targetValue,
            status,
            current.staff_id,
            approvedByStaffId,
            approvedAt,
            approvalRef,
            notesV.value ?? null,
          ],
        );

        const revId = randomUUID();
        const changeReason =
          notesV.value ??
          `Initial ${periodType} ${scopeType} target allocation`;
        const revIns = await client.query(
          `INSERT INTO kpi_target_revisions (
             id, target_id, revision_no, previous_target_value, new_target_value,
             previous_status, new_status, change_reason, changed_by_staff_id,
             approved_by_staff_id
           ) VALUES ($1, $2, 1, NULL, $3, NULL, $4, $5, $6, $7)
           RETURNING *`,
          [
            revId,
            id,
            targetValue,
            status,
            changeReason,
            current.staff_id,
            approvedByStaffId,
          ],
        );

        const defRow = defRes.rows[0]!;
        const item = mapTargetRow(
          {
            ...ins.rows[0]!,
            metric_code: defRow.metric_code,
            metric_name: defRow.metric_name,
            group_code: defRow.group_code,
            unit_code: defRow.unit_code,
            metric_type: defRow.metric_type,
          },
          [mapRevisionRow(revIns.rows[0]!)],
        );

        await appendAuditEvent(client, {
          actorStaffId: current.staff_id,
          actorSubjectRef: `staff:${current.staff_id}`,
          action: "kpi.target.write",
          resourceType: "kpi_target",
          resourceId: id,
          scopeContext: {
            kpi_definition_id: kpiDefinitionId,
            period_type: periodType,
            period_key: periodKey,
            scope_type: scopeType,
            target_value: targetValue,
            status,
            revision_no: 1,
          },
          decision: "ALLOW",
          reasonCode: "KPI_TARGET_CREATED",
        });

        return item;
      },
    ),
  );
}

export async function patchKpiTarget(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<KpiTargetDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.target.write" },
    { type: "kpi_target", id: "patch" },
  );
  if (denied) return finalizeFailure(actor, denied);

  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.target.write", "kpi_target"),
    );
  }

  if (typeof body.id !== "string" || !isUuid(body.id)) {
    return validationFailure("id", "INVALID_UUID");
  }
  const targetId = body.id;

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);
  const expectedVersion = verV.value;

  const targetValue = normalizeDecimal2(body.target_value);
  if (targetValue === null) {
    return validationFailure("target_value", "INVALID_NUMERIC_20_2");
  }

  const reasonV = readString(body, "change_reason", { min: 3, max: 500 });
  if (!reasonV.ok) return validationFailure(reasonV.field, reasonV.reason);
  const changeReason = reasonV.value!;

  const approvalRefV = readString(body, "governance_ref", {
    min: 3,
    max: 128,
    optional: true,
  });
  if (!approvalRefV.ok) {
    return validationFailure(approvalRefV.field, approvalRefV.reason);
  }

  const notesV = readString(body, "notes", {
    min: 1,
    max: 500,
    optional: true,
  });
  if (!notesV.ok) return validationFailure(notesV.field, notesV.reason);

  return runAuthorityTransaction(actor, async (client: PoolClient, current) => {
    const existingRes = await client.query(
      `SELECT t.*,
                d.metric_code,
                d.metric_name,
                d.group_code,
                d.unit_code,
                d.metric_type
         FROM kpi_targets t
         JOIN kpi_definitions d ON d.id = t.kpi_definition_id
         WHERE t.id = $1
         FOR UPDATE OF t`,
      [targetId],
    );

    if (existingRes.rowCount === 0) {
      abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy chỉ tiêu KPI.",
        {
          denyAudit: {
            action: "kpi.target.write",
            resourceType: "kpi_target",
            resourceId: targetId,
            scopeContext: { reason: "NOT_FOUND" },
            reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          },
        },
      );
    }

    const row = existingRes.rows[0]!;
    const currentRole = current.effective_role.role_code;
    if (
      currentRole === "DEPARTMENT_MANAGER" &&
      row.department_id !== current.department.id
    ) {
      abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy chỉ tiêu KPI trong phạm vi phòng.",
        {
          denyAudit: {
            action: "kpi.target.write",
            resourceType: "kpi_target",
            resourceId: targetId,
            scopeContext: { reason: "CROSS_DEPARTMENT_DENIED" },
            reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          },
        },
      );
    }

    if (currentRole === "STAFF") {
      if (row.staff_id !== current.staff_id) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy chỉ tiêu KPI cá nhân.",
          {
            denyAudit: {
              action: "kpi.target.write",
              resourceType: "kpi_target",
              resourceId: targetId,
              scopeContext: { reason: "CROSS_STAFF_SELF_SCOPE_DENIED" },
              reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            },
          },
        );
      }
      if (row.period_type === "YEAR" || row.period_type === "MONTH") {
        abort(
          403,
          "STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN",
          "Nhân viên không được sửa chỉ tiêu Năm/Tháng chính thức.",
          {
            denyAudit: {
              action: "kpi.target.write",
              resourceType: "kpi_target",
              resourceId: targetId,
              scopeContext: { period_type: row.period_type },
              reasonCode: "STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN",
            },
          },
        );
      }
    }

    if (Number(row.row_version) !== expectedVersion) {
      abort(409, "VERSION_CONFLICT", "Xung đột phiên bản chỉ tiêu KPI.", {
        denyAudit: {
          action: "kpi.target.write",
          resourceType: "kpi_target",
          resourceId: targetId,
          scopeContext: {
            expected_version: expectedVersion,
            actual_version: Number(row.row_version),
          },
          reasonCode: "VERSION_CONFLICT",
        },
      });
    }

    const nextRevisionNo = Number(row.revision_no) + 1;
    let nextStatus = row.status as KpiTargetStatus;
    let nextApprovedBy = (row.approved_by_staff_id as string | null) ?? null;
    let nextApprovedAt = row.approved_at
      ? new Date(row.approved_at as string | Date).toISOString()
      : null;
    let nextApprovalRef = (row.approval_reference as string | null) ?? null;

    if (row.period_type === "YEAR" || row.period_type === "MONTH") {
      if (currentRole === "EXECUTIVE" && approvalRefV.value) {
        nextStatus = "APPROVED";
        nextApprovedBy = current.staff_id;
        nextApprovedAt = new Date().toISOString();
        nextApprovalRef = approvalRefV.value;
      } else {
        nextStatus = "PENDING_APPROVAL";
        nextApprovedBy = null;
        nextApprovedAt = null;
      }
    }

    const upd = await client.query(
      `UPDATE kpi_targets
         SET target_value = $2,
             status = $3,
             revision_no = $4,
             proposed_by_staff_id = $5,
             approved_by_staff_id = $6,
             approved_at = $7,
             approval_reference = $8,
             notes = $9
         WHERE id = $1
         RETURNING *`,
      [
        targetId,
        targetValue,
        nextStatus,
        nextRevisionNo,
        current.staff_id,
        nextApprovedBy,
        nextApprovedAt,
        nextApprovalRef,
        notesV.value ?? row.notes,
      ],
    );

    const revId = randomUUID();
    await client.query(
      `INSERT INTO kpi_target_revisions (
           id, target_id, revision_no, previous_target_value, new_target_value,
           previous_status, new_status, change_reason, changed_by_staff_id,
           approved_by_staff_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        revId,
        targetId,
        nextRevisionNo,
        Number(row.target_value).toFixed(2),
        targetValue,
        row.status,
        nextStatus,
        changeReason,
        current.staff_id,
        nextApprovedBy,
      ],
    );

    const revMap = await loadRevisionsByTargetIds(client, [targetId]);
    const item = mapTargetRow(
      {
        ...upd.rows[0]!,
        metric_code: row.metric_code,
        metric_name: row.metric_name,
        group_code: row.group_code,
        unit_code: row.unit_code,
        metric_type: row.metric_type,
      },
      revMap.get(targetId) ?? [],
    );

    await appendAuditEvent(client, {
      actorStaffId: current.staff_id,
      actorSubjectRef: `staff:${current.staff_id}`,
      action: "kpi.target.write",
      resourceType: "kpi_target",
      resourceId: targetId,
      scopeContext: {
        previous_target_value: Number(row.target_value).toFixed(2),
        new_target_value: targetValue,
        revision_no: nextRevisionNo,
        status: nextStatus,
        row_version: item.row_version,
      },
      decision: "ALLOW",
      reasonCode: "KPI_TARGET_REVISED",
    });

    return item;
  });
}

export async function approveKpiTarget(
  actor: Actor,
  targetId: string,
  body: unknown,
): Promise<ServiceResult<KpiTargetDto>> {
  const denied = authorize(
    actor,
    { action: "kpi.target.approve" },
    { type: "kpi_target", id: targetId },
  );
  if (denied) return finalizeFailure(actor, denied);

  if (!isUuid(targetId)) {
    return finalizeFailure(
      actor,
      notFound("kpi_target", targetId, "kpi.target.approve"),
    );
  }

  if (!isPlainObject(body)) {
    return validationFailure("body", "INVALID_JSON_OBJECT");
  }

  const tamper = findDisallowedTamperKey(Object.keys(body), []);
  if (tamper) {
    return finalizeFailure(
      actor,
      tamperRejected("kpi.target.approve", "kpi_target", targetId),
    );
  }

  const verV = readExpectedVersion(body);
  if (!verV.ok) return validationFailure(verV.field, verV.reason);
  const expectedVersion = verV.value;

  const approvalRefV = readString(body, "governance_ref", {
    min: 3,
    max: 128,
  });
  if (!approvalRefV.ok) {
    return validationFailure(approvalRefV.field, approvalRefV.reason);
  }

  const reasonV = readString(body, "decision_reason", {
    min: 3,
    max: 500,
    optional: true,
  });
  if (!reasonV.ok) return validationFailure(reasonV.field, reasonV.reason);
  const decisionReason = reasonV.value ?? `Approved via ${approvalRefV.value!}`;

  return runAuthorityTransaction(actor, async (client: PoolClient, current) => {
    const existingRes = await client.query(
      `SELECT t.*,
                d.metric_code,
                d.metric_name,
                d.group_code,
                d.unit_code,
                d.metric_type
         FROM kpi_targets t
         JOIN kpi_definitions d ON d.id = t.kpi_definition_id
         WHERE t.id = $1
         FOR UPDATE OF t`,
      [targetId],
    );

    if (existingRes.rowCount === 0) {
      abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy chỉ tiêu KPI.",
        {
          denyAudit: {
            action: "kpi.target.approve",
            resourceType: "kpi_target",
            resourceId: targetId,
            scopeContext: { reason: "NOT_FOUND" },
            reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          },
        },
      );
    }

    const row = existingRes.rows[0]!;
    const currentRole = current.effective_role.role_code;
    if (currentRole === "DEPARTMENT_MANAGER") {
      if (row.department_id !== current.department.id) {
        abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy chỉ tiêu KPI trong phạm vi phòng.",
          {
            denyAudit: {
              action: "kpi.target.approve",
              resourceType: "kpi_target",
              resourceId: targetId,
              scopeContext: { reason: "CROSS_DEPARTMENT_DENIED" },
              reasonCode: "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
            },
          },
        );
      }
      if (row.scope_type !== "SELF") {
        abort(
          403,
          "EXECUTIVE_APPROVAL_REQUIRED",
          "Chỉ tiêu cấp Chi nhánh và Phòng ban cần Ban Giám đốc (EXECUTIVE) phê duyệt.",
          {
            denyAudit: {
              action: "kpi.target.approve",
              resourceType: "kpi_target",
              resourceId: targetId,
              scopeContext: { scope_type: row.scope_type },
              reasonCode: "EXECUTIVE_APPROVAL_REQUIRED",
            },
          },
        );
      }
      if (row.proposed_by_staff_id === current.staff_id) {
        abort(
          403,
          "SEPARATION_OF_DUTIES_VIOLATION",
          "Không được tự phê duyệt chỉ tiêu do chính mình đề xuất.",
          {
            denyAudit: {
              action: "kpi.target.approve",
              resourceType: "kpi_target",
              resourceId: targetId,
              scopeContext: { proposed_by_staff_id: row.proposed_by_staff_id },
              reasonCode: "SEPARATION_OF_DUTIES_VIOLATION",
            },
          },
        );
      }
    }

    if (Number(row.row_version) !== expectedVersion) {
      abort(409, "VERSION_CONFLICT", "Xung đột phiên bản chỉ tiêu KPI.", {
        denyAudit: {
          action: "kpi.target.approve",
          resourceType: "kpi_target",
          resourceId: targetId,
          scopeContext: {
            expected_version: expectedVersion,
            actual_version: Number(row.row_version),
          },
          reasonCode: "VERSION_CONFLICT",
        },
      });
    }

    const nextRevisionNo = Number(row.revision_no) + 1;
    const approvedAtIso = new Date().toISOString();
    const upd = await client.query(
      `UPDATE kpi_targets
         SET status = 'APPROVED',
             revision_no = $2,
             approved_by_staff_id = $3,
             approved_at = $4,
             approval_reference = $5
         WHERE id = $1
         RETURNING *`,
      [
        targetId,
        nextRevisionNo,
        current.staff_id,
        approvedAtIso,
        approvalRefV.value!,
      ],
    );

    const revId = randomUUID();
    await client.query(
      `INSERT INTO kpi_target_revisions (
           id, target_id, revision_no, previous_target_value, new_target_value,
           previous_status, new_status, change_reason, changed_by_staff_id,
           approved_by_staff_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7, $8, $9)`,
      [
        revId,
        targetId,
        nextRevisionNo,
        Number(row.target_value).toFixed(2),
        Number(row.target_value).toFixed(2),
        row.status,
        decisionReason,
        current.staff_id,
        current.staff_id,
      ],
    );

    const revMap = await loadRevisionsByTargetIds(client, [targetId]);
    const item = mapTargetRow(
      {
        ...upd.rows[0]!,
        metric_code: row.metric_code,
        metric_name: row.metric_name,
        group_code: row.group_code,
        unit_code: row.unit_code,
        metric_type: row.metric_type,
      },
      revMap.get(targetId) ?? [],
    );

    await appendAuditEvent(client, {
      actorStaffId: current.staff_id,
      actorSubjectRef: `staff:${current.staff_id}`,
      action: "kpi.target.approve",
      resourceType: "kpi_target",
      resourceId: targetId,
      scopeContext: {
        approval_reference: approvalRefV.value!,
        revision_no: nextRevisionNo,
        row_version: item.row_version,
      },
      decision: "ALLOW",
      reasonCode: "KPI_TARGET_APPROVED",
    });

    return item;
  });
}
