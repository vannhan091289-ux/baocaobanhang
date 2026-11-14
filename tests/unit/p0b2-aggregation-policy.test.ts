import { describe, expect, it } from "vitest";
import {
  aggregateAttributedValuesByTimeRule,
  computeAttributedValue,
  computeExpectedProgressPct,
  computeKpiProgress,
  deriveAggregateReconciliationStatus,
} from "@/server/kpi/aggregation";
import {
  evaluateActionAuthorization,
  type EffectiveSelfContext,
} from "@/server/policy";

function makeCtx(
  roleCode: "EXECUTIVE" | "CONFIG_ADMIN" | "DEPARTMENT_MANAGER" | "STAFF",
  deptId = "11111111-1111-4111-8111-111111111101",
  staffId = "22222222-2222-4222-8222-222222222201",
): EffectiveSelfContext {
  const scopeType =
    roleCode === "EXECUTIVE" || roleCode === "CONFIG_ADMIN"
      ? "BRANCH"
      : roleCode === "DEPARTMENT_MANAGER"
        ? "DEPARTMENT"
        : "SELF";
  return {
    staff_id: staffId,
    staff_code: `SYN-${roleCode}`,
    display_name: `Synthetic ${roleCode}`,
    status: "ACTIVE",
    department: {
      id: deptId,
      code: "KHCN",
      name: "Khách hàng cá nhân",
      status: "ACTIVE",
    },
    effective_role: {
      role_code: roleCode,
      scope_type: scopeType,
      scope_department_id: roleCode === "DEPARTMENT_MANAGER" ? deptId : null,
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
    },
  };
}

describe("P0B-2 Unit Tests: Aggregation Math, Attribution & Policy (TASK-0008)", () => {
  it("treats NULL actual_value as MISSING_DATA (never 0 or -100%) while computing 0 normally (AC-01)", () => {
    const missing = computeKpiProgress({
      targetValue: 1000,
      actualValue: null,
      expectedProgressPct: 50,
    });
    expect(missing).toEqual({
      data_status: "MISSING_DATA",
      target_value: 1000,
      actual_value: null,
      gap: null,
      completion_pct: null,
      expected_progress_pct: 50,
      variance_vs_expected_pct: null,
    });

    const confirmedZero = computeKpiProgress({
      targetValue: 1000,
      actualValue: 0,
      expectedProgressPct: 50,
    });
    expect(confirmedZero).toEqual({
      data_status: "OK",
      target_value: 1000,
      actual_value: 0,
      gap: -1000,
      completion_pct: 0,
      expected_progress_pct: 50,
      variance_vs_expected_pct: -50,
    });

    const nonPositiveTarget = computeKpiProgress({
      targetValue: 0,
      actualValue: 200,
      expectedProgressPct: 50,
    });
    expect(nonPositiveTarget.data_status).toBe("TARGET_NON_POSITIVE");
    expect(nonPositiveTarget.completion_pct).toBeNull();
  });

  it("never sums STOCK metrics across multiple dates (takes latest as_of_date only) (AC-02)", () => {
    const stockTotal = aggregateAttributedValuesByTimeRule(
      "STOCK",
      "END_OF_PERIOD",
      [
        { as_of_date: "2026-11-10", value: 100 },
        { as_of_date: "2026-11-11", value: 120 },
        { as_of_date: "2026-11-12", value: 150 },
      ],
    );
    expect(stockTotal).toBe(150);

    const flowTotal = aggregateAttributedValuesByTimeRule("FLOW", "SUM", [
      { as_of_date: "2026-11-10", value: 100 },
      { as_of_date: "2026-11-11", value: 120 },
      { as_of_date: "2026-11-12", value: 150 },
    ]);
    expect(flowTotal).toBe(370);
  });

  it("computes D-02 cross-sell attribution across SELF, DEPARTMENT, and BRANCH without double counting (AC-04)", () => {
    const deptA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deptB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const staffPrimary = "11111111-1111-4111-8111-111111111111";
    const staffReferrer = "33333333-3333-4333-8333-333333333333";
    const staffDeptMap = new Map<string, string>([
      [staffPrimary, deptA],
      [staffReferrer, deptB],
    ]);

    const record = {
      actual_value: 1000,
      department_id: deptA,
      primary_staff_id: staffPrimary,
      referrer_staff_id: staffReferrer,
    };
    const cfg = {
      attribution_mode: "PRIMARY_AND_REFERRER" as const,
      primary_weight: 0.7,
      referrer_weight: 0.3,
    };

    expect(
      computeAttributedValue(record, cfg, {
        level: "SELF",
        staffId: staffPrimary,
      }),
    ).toBe(700);
    expect(
      computeAttributedValue(record, cfg, {
        level: "SELF",
        staffId: staffReferrer,
      }),
    ).toBe(300);
    expect(
      computeAttributedValue(record, cfg, {
        level: "DEPARTMENT",
        departmentId: deptA,
        staffDepartmentMap: staffDeptMap,
      }),
    ).toBe(700);
    expect(
      computeAttributedValue(record, cfg, {
        level: "DEPARTMENT",
        departmentId: deptB,
        staffDepartmentMap: staffDeptMap,
      }),
    ).toBe(300);
    expect(
      computeAttributedValue(record, cfg, {
        level: "BRANCH",
      }),
    ).toBe(1000);
  });

  it("computes working-day expected progress and aggregate reconciliation status", () => {
    const pct = computeExpectedProgressPct("MONTH", "2026-11-04", [
      { calendar_date: "2026-11-02", is_working_day: true },
      { calendar_date: "2026-11-03", is_working_day: true },
      { calendar_date: "2026-11-04", is_working_day: true },
      { calendar_date: "2026-11-05", is_working_day: true },
      { calendar_date: "2026-11-06", is_working_day: true },
      { calendar_date: "2026-11-07", is_working_day: false },
    ]);
    expect(pct).toBe(60);

    expect(
      deriveAggregateReconciliationStatus(["FINAL", "RECONCILED"], true),
    ).toBe("RECONCILED");
    expect(deriveAggregateReconciliationStatus(["FINAL"], false)).toBe(
      "MISSING_DATA",
    );
  });

  it("enforces ADR-002 authorization for P0B-2 actions across roles (AC-05)", () => {
    const admin = makeCtx("CONFIG_ADMIN");
    const staff = makeCtx("STAFF");
    const mgr = makeCtx("DEPARTMENT_MANAGER");
    const exec = makeCtx("EXECUTIVE");

    expect(
      evaluateActionAuthorization({
        actorContext: admin,
        action: "dashboard.overview.read",
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: staff,
        action: "kpi.actual.reconcile",
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "STAFF_ACTUAL_RECONCILE_FORBIDDEN",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: mgr,
        action: "kpi.actual.adjust_final",
        targetDepartmentId: mgr.department.id,
        proposerStaffId: mgr.staff_id,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "MAKER_CHECKER_SELF_APPROVAL_FORBIDDEN",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: exec,
        action: "kpi.actual.reconcile",
      }).decision,
    ).toBe("ALLOW");
  });
});
