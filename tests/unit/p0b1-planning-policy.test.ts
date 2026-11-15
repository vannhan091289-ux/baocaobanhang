import { describe, expect, it } from "vitest";
import {
  evaluateActionAuthorization,
  type EffectiveSelfContext,
} from "@/server/policy";
import {
  getVnDateAndCutoffStatus,
  isValidPlanPeriodKey,
  resolveWeekBoundsVn,
} from "@/server/planning/p0b1-service";

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

describe("P0B-1 Unit Tests: Sales Plan, Single-Source Activity & Monday Review Policy (TASK-0007)", () => {
  it("enforces ADR-002 authorization across EXECUTIVE, CONFIG_ADMIN, DEPARTMENT_MANAGER, and STAFF (AC-02)", () => {
    const khcnDept = "11111111-1111-4111-8111-111111111101";
    const khdnDept = "11111111-1111-4111-8111-111111111102";
    const execCtx = makeCtx("EXECUTIVE", khcnDept);
    const adminCtx = makeCtx("CONFIG_ADMIN", khcnDept);
    const mgrCtx = makeCtx("DEPARTMENT_MANAGER", khcnDept);
    const staffCtx = makeCtx(
      "STAFF",
      khcnDept,
      "22222222-2222-4222-8222-222222222204",
    );

    // CONFIG_ADMIN is strictly denied on all planning.* business actions
    for (const action of [
      "planning.plan.read",
      "planning.plan.write",
      "planning.activity.read",
      "planning.activity.write",
      "planning.review.read",
      "planning.review.write",
      "planning.directive.write",
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

    // STAFF cannot write Monday Reviews, but can write own plans/activities/directives
    expect(
      evaluateActionAuthorization({
        actorContext: staffCtx,
        action: "planning.review.write",
        targetDepartmentId: khcnDept,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "STAFF_MONDAY_REVIEW_WRITE_FORBIDDEN",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: staffCtx,
        action: "planning.activity.write",
        targetDepartmentId: khcnDept,
        targetStaffId: staffCtx.staff_id,
      }).decision,
    ).toBe("ALLOW");

    // STAFF cannot access another staff's plan (404)
    expect(
      evaluateActionAuthorization({
        actorContext: staffCtx,
        action: "planning.plan.read",
        targetDepartmentId: khcnDept,
        targetStaffId: "22222222-2222-4222-8222-222222222299",
      }).httpStatus,
    ).toBe(404);

    // DEPARTMENT_MANAGER cannot access KHDN department
    expect(
      evaluateActionAuthorization({
        actorContext: mgrCtx,
        action: "planning.review.read",
        targetDepartmentId: khdnDept,
      }).httpStatus,
    ).toBe(404);

    // EXECUTIVE has BRANCH scope
    expect(
      evaluateActionAuthorization({
        actorContext: execCtx,
        action: "planning.review.write",
        targetDepartmentId: khdnDept,
      }).decision,
    ).toBe("ALLOW");
  });

  it("resolves Monday..Sunday bounds and 18:00 daily cut-off in Asia/Ho_Chi_Minh (AC-03)", () => {
    expect(isValidPlanPeriodKey("WEEK", "2026-W46")).toBe(true);
    expect(isValidPlanPeriodKey("WEEK", "2026-W99")).toBe(false);
    expect(isValidPlanPeriodKey("DAY", "2026-11-10")).toBe(true);

    // ISO week 2026-W46 is Monday 2026-11-09 .. Sunday 2026-11-15 (half-open [Mon 00:00+07:00, next Mon 00:00+07:00))
    const bounds = resolveWeekBoundsVn("2026-W46");
    expect(bounds).not.toBeNull();
    expect(bounds?.mondayDate).toBe("2026-11-09");
    expect(bounds?.sundayDate).toBe("2026-11-15");
    expect(bounds?.startIsoUtc).toBe("2026-11-08T17:00:00.000Z");
    expect(bounds?.endIsoUtc).toBe("2026-11-15T17:00:00.000Z");

    const beforeCutoff = getVnDateAndCutoffStatus(
      new Date("2026-11-10T17:45:00.000+07:00"),
    );
    expect(beforeCutoff).toEqual({
      dateVn: "2026-11-10",
      isAfterCutoff: false,
    });

    const afterCutoff = getVnDateAndCutoffStatus(
      new Date("2026-11-10T18:05:00.000+07:00"),
    );
    expect(afterCutoff).toEqual({
      dateVn: "2026-11-10",
      isAfterCutoff: true,
    });
  });
});
