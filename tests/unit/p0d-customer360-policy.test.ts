import { describe, expect, it } from "vitest";
import {
  evaluateActionAuthorization,
  type EffectiveSelfContext,
} from "@/server/policy";

function makeCtx(
  roleCode: "EXECUTIVE" | "CONFIG_ADMIN" | "DEPARTMENT_MANAGER" | "STAFF",
  deptId: string,
  staffId: string,
): EffectiveSelfContext {
  return {
    staff_id: staffId,
    staff_code: `SYN-${roleCode}`,
    display_name: `Synthetic ${roleCode}`,
    status: "ACTIVE",
    department: {
      id: deptId,
      code: deptId === "dept-khcn" ? "KHCN" : "KHDN",
      name: "Synthetic Dept",
      status: "ACTIVE",
    },
    effective_role: {
      role_code: roleCode,
      scope_type:
        roleCode === "EXECUTIVE" || roleCode === "CONFIG_ADMIN"
          ? "BRANCH"
          : roleCode === "DEPARTMENT_MANAGER"
            ? "DEPARTMENT"
            : "SELF",
      scope_department_id: roleCode === "DEPARTMENT_MANAGER" ? deptId : null,
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
    },
  };
}

describe("P0D Unit Tests: Customer 360 & Drill-down Policy (TASK-0010)", () => {
  it("blocks CONFIG_ADMIN with 403 on all customer360 and drilldown actions (AC-02)", () => {
    const admin = makeCtx("CONFIG_ADMIN", "dept-dvkh", "staff-admin");
    for (const action of [
      "customer360.read",
      "customer360.write",
      "dashboard.drilldown.read",
    ] as const) {
      const dec = evaluateActionAuthorization({ actorContext: admin, action });
      expect(dec.decision).toBe("DENY");
      expect(dec.httpStatus).toBe(403);
      expect(dec.reasonCode).toBe("CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN");
    }
  });

  it("enforces BRANCH / DEPARTMENT / SELF scope isolation on customer360 and drilldown (AC-02, AC-03)", () => {
    const exec = makeCtx("EXECUTIVE", "dept-khcn", "staff-exec");
    const mgr = makeCtx("DEPARTMENT_MANAGER", "dept-khcn", "staff-mgr");
    const staff = makeCtx("STAFF", "dept-khcn", "staff-1");

    expect(
      evaluateActionAuthorization({
        actorContext: exec,
        action: "customer360.read",
        targetDepartmentId: "dept-khdn",
        targetStaffId: "staff-2",
      }).decision,
    ).toBe("ALLOW");

    expect(
      evaluateActionAuthorization({
        actorContext: mgr,
        action: "customer360.read",
        targetDepartmentId: "dept-khcn",
        targetStaffId: "staff-1",
      }).decision,
    ).toBe("ALLOW");

    const mgrCrossDept = evaluateActionAuthorization({
      actorContext: mgr,
      action: "dashboard.drilldown.read",
      targetDepartmentId: "dept-khdn",
    });
    expect(mgrCrossDept.decision).toBe("DENY");
    expect(mgrCrossDept.httpStatus).toBe(404);

    const staffCrossStaff = evaluateActionAuthorization({
      actorContext: staff,
      action: "customer360.read",
      targetDepartmentId: "dept-khcn",
      targetStaffId: "staff-2",
    });
    expect(staffCrossStaff.decision).toBe("DENY");
    expect(staffCrossStaff.httpStatus).toBe(404);
  });
});
