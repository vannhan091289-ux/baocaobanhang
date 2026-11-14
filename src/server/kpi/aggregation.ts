import type {
  KpiAttributionMode,
  KpiGroupCode,
  KpiMetricType,
  KpiPeriodType,
  KpiTimeAggRule,
} from "./p0a-service";

export type DataStatus = "OK" | "MISSING_DATA" | "TARGET_NON_POSITIVE";

export type ReconciliationStatus = "PROVISIONAL" | "RECONCILED" | "FINAL";

export interface KpiProgressResult {
  data_status: DataStatus;
  target_value: number | null;
  actual_value: number | null;
  gap: number | null;
  completion_pct: number | null;
  expected_progress_pct: number | null;
  variance_vs_expected_pct: number | null;
}

export interface ActualSliceRecord {
  as_of_date: string;
  actual_value: number | null;
  department_id: string;
  primary_staff_id: string;
  referrer_staff_id: string | null;
  reconciliation_status: ReconciliationStatus;
}

export interface AttributionConfig {
  attribution_mode: KpiAttributionMode;
  primary_weight: number;
  referrer_weight: number;
}

export type ViewerScopeLevel = "BRANCH" | "DEPARTMENT" | "SELF";

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes gap, completion_pct, and data_status per TASK-0008 AC-01:
 * - actualValue === null => MISSING_DATA, gap = null, completion_pct = null (never 0 or -100%).
 * - actualValue === 0 => valid zero, computed normally if targetValue > 0.
 * - targetValue === null || targetValue <= 0 => TARGET_NON_POSITIVE, completion_pct = null.
 */
export function computeKpiProgress(input: {
  targetValue: number | null;
  actualValue: number | null;
  expectedProgressPct: number | null;
}): KpiProgressResult {
  const { targetValue, actualValue, expectedProgressPct } = input;

  if (actualValue === null) {
    return {
      data_status: "MISSING_DATA",
      target_value: targetValue,
      actual_value: null,
      gap: null,
      completion_pct: null,
      expected_progress_pct: expectedProgressPct,
      variance_vs_expected_pct: null,
    };
  }

  if (targetValue === null || targetValue <= 0) {
    return {
      data_status: "TARGET_NON_POSITIVE",
      target_value: targetValue,
      actual_value: round2(actualValue),
      gap: targetValue !== null ? round2(actualValue - targetValue) : null,
      completion_pct: null,
      expected_progress_pct: expectedProgressPct,
      variance_vs_expected_pct: null,
    };
  }

  const gap = round2(actualValue - targetValue);
  const completionPct = round2((actualValue / targetValue) * 100);
  const varianceVsExpectedPct =
    expectedProgressPct !== null
      ? round2(completionPct - expectedProgressPct)
      : null;

  return {
    data_status: "OK",
    target_value: round2(targetValue),
    actual_value: round2(actualValue),
    gap,
    completion_pct: completionPct,
    expected_progress_pct: expectedProgressPct,
    variance_vs_expected_pct: varianceVsExpectedPct,
  };
}

/**
 * Computes D-02 Option A attributed value for a single actual record at a given viewer scope:
 * - BRANCH: primary_weight + referrer_weight = 1.0 => always 100% of actual_value (no double counting).
 * - DEPARTMENT: primary portion counts toward primary's department; referrer portion counts toward
 *   referrer's department (if both in same dept, dept receives 100%).
 * - SELF: primary_staff_id receives primary_weight; referrer_staff_id receives referrer_weight.
 * Returns null if record.actual_value is null or record has 0 attribution for the requested viewer.
 */
export function computeAttributedValue(
  record: Pick<
    ActualSliceRecord,
    "actual_value" | "department_id" | "primary_staff_id" | "referrer_staff_id"
  >,
  config: AttributionConfig,
  scope: {
    level: ViewerScopeLevel;
    departmentId?: string | null;
    staffId?: string | null;
    staffDepartmentMap?: ReadonlyMap<string, string>;
  },
): number | null {
  if (record.actual_value === null) {
    return null;
  }

  const hasReferrer =
    config.attribution_mode === "PRIMARY_AND_REFERRER" &&
    record.referrer_staff_id !== null &&
    record.referrer_staff_id !== record.primary_staff_id;

  const primaryWeight = hasReferrer ? config.primary_weight : 1;
  const referrerWeight = hasReferrer ? config.referrer_weight : 0;

  if (scope.level === "BRANCH") {
    return round2(record.actual_value * (primaryWeight + referrerWeight));
  }

  if (scope.level === "DEPARTMENT") {
    const targetDept = scope.departmentId ?? null;
    if (!targetDept) return null;
    let weight = 0;
    if (record.department_id === targetDept) {
      weight += primaryWeight;
    }
    if (hasReferrer && record.referrer_staff_id) {
      const refDept =
        scope.staffDepartmentMap?.get(record.referrer_staff_id) ??
        record.department_id;
      if (refDept === targetDept) {
        weight += referrerWeight;
      }
    }
    if (weight === 0) return null;
    return round2(record.actual_value * weight);
  }

  // SELF
  const targetStaff = scope.staffId ?? null;
  if (!targetStaff) return null;
  let weight = 0;
  if (record.primary_staff_id === targetStaff) {
    weight += primaryWeight;
  }
  if (hasReferrer && record.referrer_staff_id === targetStaff) {
    weight += referrerWeight;
  }
  if (weight === 0) return null;
  return round2(record.actual_value * weight);
}

/**
 * Aggregates attributed values across dates according to metric_type & time_aggregation_rule (AC-02):
 * - STOCK / END_OF_PERIOD: NEVER sum across multiple dates! Takes only the latest as_of_date
 *   and sums attributed values recorded on that single latest date.
 * - AVERAGE: arithmetic mean across distinct dates that have non-null values.
 * - FLOW / SUM / NET_CHANGE / NET_DELTA: sum of attributed values across records.
 * - If no contributing records or all contributing records have actual_value === null => returns null (MISSING_DATA).
 */
export function aggregateAttributedValuesByTimeRule(
  metricType: KpiMetricType,
  timeAggRule: KpiTimeAggRule,
  datedValues: Array<{ as_of_date: string; value: number | null }>,
): number | null {
  if (datedValues.length === 0) {
    return null;
  }

  const nonNull = datedValues.filter(
    (entry): entry is { as_of_date: string; value: number } =>
      entry.value !== null,
  );
  if (nonNull.length === 0) {
    return null;
  }

  if (metricType === "STOCK" || timeAggRule === "END_OF_PERIOD") {
    let maxDate = datedValues[0]?.as_of_date ?? "";
    for (const item of datedValues) {
      if (item.as_of_date > maxDate) {
        maxDate = item.as_of_date;
      }
    }
    const latestDateEntries = datedValues.filter(
      (item) => item.as_of_date === maxDate,
    );
    const latestNonNull = latestDateEntries.filter(
      (entry): entry is { as_of_date: string; value: number } =>
        entry.value !== null,
    );
    if (latestNonNull.length === 0) {
      return null;
    }
    return round2(latestNonNull.reduce((sum, item) => sum + item.value, 0));
  }

  if (metricType === "AVERAGE" || timeAggRule === "AVERAGE") {
    const byDate = new Map<string, number>();
    for (const item of nonNull) {
      byDate.set(
        item.as_of_date,
        (byDate.get(item.as_of_date) ?? 0) + item.value,
      );
    }
    const total = Array.from(byDate.values()).reduce((sum, v) => sum + v, 0);
    return round2(total / byDate.size);
  }

  // FLOW / SUM or NET_CHANGE / NET_DELTA
  return round2(nonNull.reduce((sum, item) => sum + item.value, 0));
}

/**
 * Derives aggregate reconciliation status across contributing records.
 * - No records or any missing actual_value when no non-null records => MISSING_DATA.
 * - Otherwise lowest maturity among contributing records: PROVISIONAL < RECONCILED < FINAL.
 */
export function deriveAggregateReconciliationStatus(
  statuses: ReconciliationStatus[],
  hasNonNullValue: boolean,
): ReconciliationStatus | "MISSING_DATA" {
  if (!hasNonNullValue || statuses.length === 0) {
    return "MISSING_DATA";
  }
  if (statuses.includes("PROVISIONAL")) return "PROVISIONAL";
  if (statuses.includes("RECONCILED")) return "RECONCILED";
  return "FINAL";
}

/**
 * Computes D-03 working-day expected progress % for a period.
 * Returns null if no calendar days exist for the period.
 */
export function computeExpectedProgressPct(
  periodType: KpiPeriodType,
  asOfDate: string,
  calendarDays: Array<{ calendar_date: string; is_working_day: boolean }>,
): number | null {
  if (periodType === "DAY") {
    return 100;
  }
  const workingDays = calendarDays.filter((d) => d.is_working_day);
  if (workingDays.length === 0) {
    return null;
  }
  const elapsed = workingDays.filter((d) => d.calendar_date <= asOfDate).length;
  return round2((elapsed / workingDays.length) * 100);
}

/**
 * Computes period date bounds [startDate, endDate] in YYYY-MM-DD for DAY/WEEK/MONTH/YEAR.
 */
export function resolvePeriodDateRange(
  periodType: KpiPeriodType,
  periodKey: string,
): { startDate: string; endDate: string } | null {
  if (periodType === "DAY") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return null;
    return { startDate: periodKey, endDate: periodKey };
  }

  if (periodType === "MONTH") {
    const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      startDate: `${match[1]}-${match[2]}-01`,
      endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (periodType === "YEAR") {
    if (!/^\d{4}$/.test(periodKey)) return null;
    return { startDate: `${periodKey}-01-01`, endDate: `${periodKey}-12-31` };
  }

  // WEEK: YYYY-Www (ISO week Mon..Sun)
  const weekMatch = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!weekMatch) return null;
  const year = Number(weekMatch[1]);
  const week = Number(weekMatch[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  const targetMonday = new Date(
    week1Monday.getTime() + (week - 1) * 7 * 86400000,
  );
  const targetSunday = new Date(targetMonday.getTime() + 6 * 86400000);
  return {
    startDate: targetMonday.toISOString().slice(0, 10),
    endDate: targetSunday.toISOString().slice(0, 10),
  };
}

export const ALL_SEVEN_KPI_GROUPS: KpiGroupCode[] = [
  "LOAN",
  "DEPOSIT",
  "CARD",
  "TTQT",
  "NEW_RETAIL_CIF",
  "BIZ_HOUSEHOLD",
  "INSURANCE",
];
