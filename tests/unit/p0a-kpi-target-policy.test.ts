import { describe, expect, it } from "vitest";
import {
  type EffectiveSelfContext,
  type RoleCode,
  type DataScopeType,
  evaluateActionAuthorization,
} from "@/server/policy";
import {
  isValidPeriodKey,
  normalizeDecimal2,
  summarizeWorkingCalendar,
} from "@/server/kpi/p0a-service";

const DEPT_KHCN_ID = "11111111-1111-4111-8111-111111111101";
const DEPT_KHDN_ID = "11111111-1111-4111-8111-111111111102";
const STAFF_EXEC_ID = "22222222-2222-4222-8222-222222222201";
const STAFF_ADMIN_ID = "22222222-2222-4222-8222-222222222202";
const STAFF_MGR_KHCN_ID = "22222222-2222-4222-8222-222222222203";
const STAFF_KHCN_ID = "22222222-2222-4222-8222-222222222205";
const STAFF_KHDN_ID = "22222222-2222-4222-8222-222222222206";

function makeContext(
  role: RoleCode,
  scope: DataScopeType,
  staffId: string,
  deptId: string = DEPT_KHCN_ID,
): EffectiveSelfContext {
  return {
    staff_id: staffId,
    staff_code: `SYN-${role}`,
    display_name: `Synthetic ${role}`,
    status: "ACTIVE",
    department: {
      id: deptId,
      code: deptId === DEPT_KHCN_ID ? "KHCN" : "KHDN",
      name: "Synthetic Department",
      status: "ACTIVE",
    },
    effective_role: {
      role_code: role,
      scope_type: scope,
      scope_department_id: scope === "DEPARTMENT" ? deptId : null,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    },
  };
}

describe("P0A Unit Tests: KPI Dictionary, Working Calendar & Target Policy (TASK-0006)", () => {
  it("enforces ADR-002 + ADR-003 authorization on kpi.calendar.*, kpi.dictionary.*, and kpi.target.*", () => {
    const execCtx = makeContext("EXECUTIVE", "BRANCH", STAFF_EXEC_ID);
    const adminCtx = makeContext("CONFIG_ADMIN", "BRANCH", STAFF_ADMIN_ID);
    const mgrKhcnCtx = makeContext(
      "DEPARTMENT_MANAGER",
      "DEPARTMENT",
      STAFF_MGR_KHCN_ID,
      DEPT_KHCN_ID,
    );
    const staffKhcnCtx = makeContext(
      "STAFF",
      "SELF",
      STAFF_KHCN_ID,
      DEPT_KHCN_ID,
    );

    // 1. Metadata read (kpi.calendar.read, kpi.dictionary.read): allowed for all 4 roles
    for (const ctx of [execCtx, adminCtx, mgrKhcnCtx, staffKhcnCtx]) {
      expect(
        evaluateActionAuthorization({
          actorContext: ctx,
          action: "kpi.calendar.read",
        }).decision,
      ).toBe("ALLOW");
      expect(
        evaluateActionAuthorization({
          actorContext: ctx,
          action: "kpi.dictionary.read",
        }).decision,
      ).toBe("ALLOW");
    }

    // 2. Metadata write (kpi.calendar.write, kpi.dictionary.write): CONFIG_ADMIN only
    expect(
      evaluateActionAuthorization({
        actorContext: adminCtx,
        action: "kpi.calendar.write",
      }).decision,
    ).toBe("ALLOW");
    expect(
      evaluateActionAuthorization({
        actorContext: adminCtx,
        action: "kpi.dictionary.write",
      }).decision,
    ).toBe("ALLOW");

    for (const ctx of [execCtx, mgrKhcnCtx, staffKhcnCtx]) {
      expect(
        evaluateActionAuthorization({
          actorContext: ctx,
          action: "kpi.calendar.write",
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      });
      expect(
        evaluateActionAuthorization({
          actorContext: ctx,
          action: "kpi.dictionary.write",
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      });
    }

    // 3. CONFIG_ADMIN is strictly forbidden from reading, writing, or approving KPI targets (AC-03)
    for (const action of [
      "kpi.target.read",
      "kpi.target.write",
      "kpi.target.approve",
    ] as const) {
      expect(
        evaluateActionAuthorization({
          actorContext: adminCtx,
          action,
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      });
    }

    // 4. EXECUTIVE has BRANCH scope on kpi.target.read, kpi.target.write, kpi.target.approve
    expect(
      evaluateActionAuthorization({
        actorContext: execCtx,
        action: "kpi.target.read",
        targetDepartmentId: DEPT_KHDN_ID,
      }).decision,
    ).toBe("ALLOW");
    expect(
      evaluateActionAuthorization({
        actorContext: execCtx,
        action: "kpi.target.write",
        targetDepartmentId: DEPT_KHDN_ID,
      }).decision,
    ).toBe("ALLOW");
    expect(
      evaluateActionAuthorization({
        actorContext: execCtx,
        action: "kpi.target.approve",
        proposerStaffId: STAFF_MGR_KHCN_ID,
      }).decision,
    ).toBe("ALLOW");

    // Separation of duties on target approval
    expect(
      evaluateActionAuthorization({
        actorContext: mgrKhcnCtx,
        action: "kpi.target.approve",
        targetDepartmentId: DEPT_KHCN_ID,
        proposerStaffId: STAFF_MGR_KHCN_ID,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "SEPARATION_OF_DUTIES_VIOLATION",
    });

    // Cross-department denial for DEPARTMENT_MANAGER and STAFF
    expect(
      evaluateActionAuthorization({
        actorContext: mgrKhcnCtx,
        action: "kpi.target.read",
        targetDepartmentId: DEPT_KHDN_ID,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 404,
      reasonCode: "CROSS_DEPARTMENT_DENIED",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: staffKhcnCtx,
        action: "kpi.target.read",
        targetStaffId: STAFF_KHDN_ID,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 404,
      reasonCode: "CROSS_STAFF_SELF_SCOPE_DENIED",
    });
  });

  it("validates period_key formats, NUMERIC(20, 2) precision, and working calendar summary (AC-01, AC-04)", () => {
    expect(isValidPeriodKey("YEAR", "2026")).toBe(true);
    expect(isValidPeriodKey("YEAR", "2026-11")).toBe(false);
    expect(isValidPeriodKey("MONTH", "2026-11")).toBe(true);
    expect(isValidPeriodKey("MONTH", "2026-13")).toBe(false);
    expect(isValidPeriodKey("WEEK", "2026-W46")).toBe(true);
    expect(isValidPeriodKey("WEEK", "2026-W00")).toBe(false);
    expect(isValidPeriodKey("DAY", "2026-11-14")).toBe(true);
    expect(isValidPeriodKey("DAY", "2026/11/14")).toBe(false);

    expect(normalizeDecimal2("15000000000.5")).toBe("15000000000.50");
    expect(normalizeDecimal2(250000)).toBe("250000.00");
    expect(normalizeDecimal2("-10.00")).toBeNull();
    expect(normalizeDecimal2("10.123")).toBeNull();
    expect(normalizeDecimal2(Number.NaN)).toBeNull();

    const summary = summarizeWorkingCalendar([
      { calendar_date: "2026-11-09", is_working_day: true },
      { calendar_date: "2026-11-10", is_working_day: true },
      { calendar_date: "2026-11-14", is_working_day: false },
    ]);
    expect(summary).toEqual({
      total_days: 3,
      working_days_count: 2,
      non_working_days_count: 1,
      timezone: "Asia/Ho_Chi_Minh",
      weekly_cutoff_day: "MONDAY",
      daily_report_cutoff_time: "18:00",
    });
  });
});
