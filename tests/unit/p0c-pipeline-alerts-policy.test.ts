import { describe, expect, it } from "vitest";
import {
  isValidLeadTransition,
  isValidOpportunityTransition,
  isValidProspectTransition,
} from "@/server/pipeline/state-machine";
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

describe("P0C Unit Tests: Pipeline State Machine & Alert Policy (TASK-0009)", () => {
  it("enforces valid and invalid transitions for Prospect, Lead, and Opportunity (AC-01)", () => {
    expect(isValidProspectTransition("NEW", "QUALIFIED")).toBe(true);
    expect(isValidProspectTransition("NEW", "CONVERTED")).toBe(false);
    expect(isValidProspectTransition("CONVERTED", "NEW")).toBe(false);

    expect(isValidLeadTransition("NEW", "CONTACTED")).toBe(true);
    expect(isValidLeadTransition("QUALIFIED", "CONVERTED")).toBe(true);
    expect(isValidLeadTransition("LOST", "QUALIFIED")).toBe(false);

    expect(isValidOpportunityTransition("PROPOSAL", "NEGOTIATION")).toBe(true);
    expect(isValidOpportunityTransition("WON", "LOST")).toBe(false);
  });

  it("enforces CONFIG_ADMIN rule-only access and 403 on business pipeline & alerts (AC-04)", () => {
    const admin = makeCtx("CONFIG_ADMIN");
    const exec = makeCtx("EXECUTIVE");
    const mgr = makeCtx("DEPARTMENT_MANAGER");
    const staff = makeCtx("STAFF");

    expect(
      evaluateActionAuthorization({
        actorContext: admin,
        action: "alerts.rule.write",
      }).decision,
    ).toBe("ALLOW");

    for (const deniedAction of [
      "pipeline.read",
      "pipeline.write",
      "alerts.read",
      "alerts.resolve",
    ] as const) {
      expect(
        evaluateActionAuthorization({
          actorContext: admin,
          action: deniedAction,
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      });
    }

    expect(
      evaluateActionAuthorization({
        actorContext: exec,
        action: "alerts.rule.write",
      }).httpStatus,
    ).toBe(403);

    expect(
      evaluateActionAuthorization({
        actorContext: mgr,
        action: "pipeline.write",
        targetDepartmentId: mgr.department.id,
      }).decision,
    ).toBe("ALLOW");

    expect(
      evaluateActionAuthorization({
        actorContext: staff,
        action: "alerts.resolve",
        targetDepartmentId: staff.department.id,
        targetStaffId: "99999999-9999-4999-8999-999999999999",
      }).httpStatus,
    ).toBe(404);
  });
});
