import { describe, expect, it } from "vitest";
import {
  evaluateActionAuthorization,
  evaluateIdentityAndRolePolicy,
  isRoleAssignmentEffectiveAt,
  type DepartmentRecord,
  type EffectiveSelfContext,
  type IdentityLinkRecord,
  type PolicyAction,
  type RoleAssignmentRecord,
  type RoleCode,
  type StaffRecord,
} from "@/server/policy";
import {
  findDisallowedTamperKey,
  findTamperHeader,
  validateQueryParams,
} from "@/server/validation";

const DEPT_KHCN: DepartmentRecord = {
  id: "11111111-1111-4111-8111-111111111101",
  code: "KHCN",
  name: "Phòng KHCN (Synthetic)",
  status: "ACTIVE",
};

const DEPT_KHDN: DepartmentRecord = {
  id: "11111111-1111-4111-8111-111111111102",
  code: "KHDN",
  name: "Phòng KHDN (Synthetic)",
  status: "ACTIVE",
};

function makeContext(
  role: RoleCode,
  staffId: string,
  dept = DEPT_KHCN,
): EffectiveSelfContext {
  const scopeType =
    role === "EXECUTIVE" || role === "CONFIG_ADMIN"
      ? "BRANCH"
      : role === "DEPARTMENT_MANAGER"
        ? "DEPARTMENT"
        : "SELF";
  return {
    staff_id: staffId,
    staff_code: `SYN-${role}`,
    display_name: `Synthetic ${role}`,
    status: "ACTIVE",
    department: {
      id: dept.id,
      code: dept.code,
      name: dept.name,
      status: "ACTIVE",
    },
    effective_role: {
      role_code: role,
      scope_type: scopeType,
      scope_department_id: scopeType === "DEPARTMENT" ? dept.id : null,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    },
  };
}

describe("S1-C AC-01: Exhaustive ADR-002 Authorization Matrix (Actor × Action × Resource × Scope)", () => {
  const execCtx = makeContext(
    "EXECUTIVE",
    "22222222-2222-4222-8222-222222222201",
  );
  const adminCtx = makeContext(
    "CONFIG_ADMIN",
    "22222222-2222-4222-8222-222222222202",
  );
  const mgrCtx = makeContext(
    "DEPARTMENT_MANAGER",
    "22222222-2222-4222-8222-222222222203",
    DEPT_KHCN,
  );
  const staffCtx = makeContext(
    "STAFF",
    "22222222-2222-4222-8222-222222222205",
    DEPT_KHCN,
  );
  const otherKhcnStaffId = "22222222-2222-4222-8222-222222222299";

  it("verifies every Action × Role × Scope combination in ADR-002 §3", () => {
    const cases: Array<{
      label: string;
      ctx: EffectiveSelfContext | null;
      action: PolicyAction;
      targetStaffId?: string;
      targetDepartmentId?: string;
      roleWorkflowPhase?: "propose" | "decide";
      proposerStaffId?: string;
      expectedDecision: "ALLOW" | "DENY";
      expectedStatus: 200 | 401 | 403 | 404;
      expectedReason: string;
    }> = [
      // 1. Anonymous caller
      {
        label: "ANONYMOUS -> org.department.read",
        ctx: null,
        action: "org.department.read",
        expectedDecision: "DENY",
        expectedStatus: 401,
        expectedReason: "AUTH_SESSION_REQUIRED",
      },
      // 2. org.department.read: all 4 roles ALLOW
      {
        label: "EXECUTIVE -> org.department.read",
        ctx: execCtx,
        action: "org.department.read",
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_DEPARTMENT_READ_BRANCH",
      },
      {
        label: "CONFIG_ADMIN -> org.department.read",
        ctx: adminCtx,
        action: "org.department.read",
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_DEPARTMENT_READ_BRANCH",
      },
      {
        label: "DEPARTMENT_MANAGER -> org.department.read",
        ctx: mgrCtx,
        action: "org.department.read",
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_DEPARTMENT_READ_BRANCH",
      },
      {
        label: "STAFF -> org.department.read",
        ctx: staffCtx,
        action: "org.department.read",
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_DEPARTMENT_READ_BRANCH",
      },
      // 3. org.department.write & org.staff.write: only CONFIG_ADMIN ALLOW
      {
        label: "CONFIG_ADMIN -> org.department.write",
        ctx: adminCtx,
        action: "org.department.write",
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_ORG_WRITE_CONFIG_ADMIN",
      },
      {
        label: "EXECUTIVE -> org.department.write",
        ctx: execCtx,
        action: "org.department.write",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "ACTION_FORBIDDEN_FOR_ROLE",
      },
      {
        label: "DEPARTMENT_MANAGER -> org.staff.write",
        ctx: mgrCtx,
        action: "org.staff.write",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "ACTION_FORBIDDEN_FOR_ROLE",
      },
      {
        label: "STAFF -> org.staff.write",
        ctx: staffCtx,
        action: "org.staff.write",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "ACTION_FORBIDDEN_FOR_ROLE",
      },
      // 4. org.staff.read & authz.role.read across scopes
      {
        label: "EXECUTIVE -> org.staff.read cross-department",
        ctx: execCtx,
        action: "org.staff.read",
        targetDepartmentId: DEPT_KHDN.id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_BRANCH_SCOPE",
      },
      {
        label: "CONFIG_ADMIN -> authz.role.read cross-department",
        ctx: adminCtx,
        action: "authz.role.read",
        targetDepartmentId: DEPT_KHDN.id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_BRANCH_SCOPE",
      },
      {
        label: "DEPARTMENT_MANAGER -> org.staff.read own department",
        ctx: mgrCtx,
        action: "org.staff.read",
        targetDepartmentId: DEPT_KHCN.id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_DEPARTMENT_SCOPE",
      },
      {
        label:
          "DEPARTMENT_MANAGER -> org.staff.read other department (404 anti-inference)",
        ctx: mgrCtx,
        action: "org.staff.read",
        targetDepartmentId: DEPT_KHDN.id,
        expectedDecision: "DENY",
        expectedStatus: 404,
        expectedReason: "CROSS_DEPARTMENT_DENIED",
      },
      {
        label: "STAFF -> org.staff.read self",
        ctx: staffCtx,
        action: "org.staff.read",
        targetStaffId: staffCtx.staff_id,
        targetDepartmentId: DEPT_KHCN.id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_SELF_SCOPE",
      },
      {
        label:
          "STAFF -> org.staff.read colleague in same department (404 anti-inference)",
        ctx: staffCtx,
        action: "org.staff.read",
        targetStaffId: otherKhcnStaffId,
        targetDepartmentId: DEPT_KHCN.id,
        expectedDecision: "DENY",
        expectedStatus: 404,
        expectedReason: "CROSS_STAFF_SELF_SCOPE_DENIED",
      },
      {
        label: "STAFF -> authz.role.read other department (404 anti-inference)",
        ctx: staffCtx,
        action: "authz.role.read",
        targetDepartmentId: DEPT_KHDN.id,
        expectedDecision: "DENY",
        expectedStatus: 404,
        expectedReason: "CROSS_DEPARTMENT_DENIED",
      },
      // 5. Maker-Checker authz.role.assign (propose vs decide + self-escalation + separation of duties)
      {
        label: "CONFIG_ADMIN -> authz.role.assign propose for another staff",
        ctx: adminCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: staffCtx.staff_id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_ROLE_PROPOSE_CONFIG_ADMIN",
      },
      {
        label:
          "CONFIG_ADMIN -> authz.role.assign self-propose (403 SELF_ESCALATION_FORBIDDEN)",
        ctx: adminCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: adminCtx.staff_id,
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "SELF_ESCALATION_FORBIDDEN",
      },
      {
        label:
          "EXECUTIVE -> authz.role.assign propose (403 ACTION_FORBIDDEN_FOR_ROLE)",
        ctx: execCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: staffCtx.staff_id,
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "ACTION_FORBIDDEN_FOR_ROLE",
      },
      {
        label: "EXECUTIVE -> authz.role.assign decide on CONFIG_ADMIN proposal",
        ctx: execCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: staffCtx.staff_id,
        proposerStaffId: adminCtx.staff_id,
        expectedDecision: "ALLOW",
        expectedStatus: 200,
        expectedReason: "ALLOW_ROLE_DECIDE_EXECUTIVE",
      },
      {
        label:
          "EXECUTIVE -> authz.role.assign decide when proposer === approver (403 SEPARATION_OF_DUTIES_VIOLATION)",
        ctx: execCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: staffCtx.staff_id,
        proposerStaffId: execCtx.staff_id,
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "SEPARATION_OF_DUTIES_VIOLATION",
      },
      {
        label:
          "EXECUTIVE -> authz.role.assign decide when target === approver (403 SELF_ESCALATION_FORBIDDEN)",
        ctx: execCtx,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: execCtx.staff_id,
        proposerStaffId: adminCtx.staff_id,
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "SELF_ESCALATION_FORBIDDEN",
      },
      // 6. Customer & KPI default deny in Sprint 1 (and CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN)
      {
        label:
          "CONFIG_ADMIN -> customer.read (403 CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN)",
        ctx: adminCtx,
        action: "customer.read",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN",
      },
      {
        label:
          "CONFIG_ADMIN -> kpi.write (403 CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN)",
        ctx: adminCtx,
        action: "kpi.write",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN",
      },
      {
        label:
          "EXECUTIVE -> customer.read in Sprint 1 (403 SPRINT_1_RESOURCE_OUT_OF_SCOPE)",
        ctx: execCtx,
        action: "customer.read",
        expectedDecision: "DENY",
        expectedStatus: 403,
        expectedReason: "SPRINT_1_RESOURCE_OUT_OF_SCOPE",
      },
    ];

    for (const c of cases) {
      const res = evaluateActionAuthorization({
        actorContext: c.ctx,
        action: c.action,
        targetStaffId: c.targetStaffId,
        targetDepartmentId: c.targetDepartmentId,
        roleWorkflowPhase: c.roleWorkflowPhase,
        proposerStaffId: c.proposerStaffId,
      });
      expect(res, c.label).toEqual({
        decision: c.expectedDecision,
        httpStatus: c.expectedStatus,
        reasonCode: c.expectedReason,
      });
    }
  });
});

describe("S1-C AC-03 & AC-04: Millisecond Temporal Boundaries, Sequential Handover & Parameter/Header Tamper Detection", () => {
  const baseStaff: StaffRecord = {
    id: "22222222-2222-4222-8222-222222222205",
    staff_code: "SYN-STAFF-01",
    display_name: "Staff 01",
    department_id: DEPT_KHCN.id,
    status: "ACTIVE",
  };
  const baseLink: IdentityLinkRecord = {
    id: "33333333-3333-4333-8333-333333333305",
    issuer: "http://127.0.0.1:8080/realms/branch-sales-dev",
    subject: "sub-staff-01",
    staff_id: baseStaff.id,
    status: "ACTIVE",
  };

  it("enforces exact millisecond half-open boundaries [effective_from, effective_to) and sequential role handover A [t0, t1) -> B [t1, null)", () => {
    const t0 = new Date("2026-11-14T08:00:00.000Z");
    const t1 = new Date("2026-11-14T12:00:00.000Z");

    const assignmentA: RoleAssignmentRecord = {
      id: "44444444-4444-4444-8444-444444444401",
      staff_id: baseStaff.id,
      role_code: "STAFF",
      scope_type: "SELF",
      scope_department_id: null,
      effective_from: t0,
      effective_to: t1,
      status: "ACTIVE",
    };

    const assignmentB: RoleAssignmentRecord = {
      id: "44444444-4444-4444-8444-444444444402",
      staff_id: baseStaff.id,
      role_code: "DEPARTMENT_MANAGER",
      scope_type: "DEPARTMENT",
      scope_department_id: DEPT_KHCN.id,
      effective_from: t1,
      effective_to: null,
      status: "ACTIVE",
    };

    // 1. At t0 - 1ms: neither A nor B is effective -> DENY ROLE_ASSIGNMENT_NONE_EFFECTIVE
    const beforeT0 = new Date(t0.getTime() - 1);
    expect(isRoleAssignmentEffectiveAt(assignmentA, beforeT0)).toBe(false);
    expect(
      evaluateIdentityAndRolePolicy({
        now: beforeT0,
        identityLink: baseLink,
        staff: baseStaff,
        department: DEPT_KHCN,
        roleAssignments: [assignmentA, assignmentB],
      }),
    ).toEqual({
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_NONE_EFFECTIVE",
    });

    // 2. At exact t0: only A is effective -> ALLOW (STAFF)
    expect(isRoleAssignmentEffectiveAt(assignmentA, t0)).toBe(true);
    expect(isRoleAssignmentEffectiveAt(assignmentB, t0)).toBe(false);
    const atT0 = evaluateIdentityAndRolePolicy({
      now: t0,
      identityLink: baseLink,
      staff: baseStaff,
      department: DEPT_KHCN,
      roleAssignments: [assignmentA, assignmentB],
      boundRoleAssignmentId: assignmentA.id,
    });
    expect(atT0.decision).toBe("ALLOW");
    if (atT0.decision === "ALLOW") {
      expect(atT0.selfContext.effective_role.role_code).toBe("STAFF");
    }

    // 3. At t1 - 1ms: only A is effective -> session bound to A still ALLOW
    const beforeT1 = new Date(t1.getTime() - 1);
    const atBeforeT1 = evaluateIdentityAndRolePolicy({
      now: beforeT1,
      identityLink: baseLink,
      staff: baseStaff,
      department: DEPT_KHCN,
      roleAssignments: [assignmentA, assignmentB],
      boundRoleAssignmentId: assignmentA.id,
    });
    expect(atBeforeT1.decision).toBe("ALLOW");

    // 4. At exact t1: A ends, B begins -> session bound to A is rejected with ROLE_ASSIGNMENT_BOUND_MISMATCH
    const atT1OldSession = evaluateIdentityAndRolePolicy({
      now: t1,
      identityLink: baseLink,
      staff: baseStaff,
      department: DEPT_KHCN,
      roleAssignments: [assignmentA, assignmentB],
      boundRoleAssignmentId: assignmentA.id,
    });
    expect(atT1OldSession).toEqual({
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_BOUND_MISMATCH",
    });

    // 5. At exact t1: fresh login (no boundRoleAssignmentId) binds to B (DEPARTMENT_MANAGER)
    const atT1NewLogin = evaluateIdentityAndRolePolicy({
      now: t1,
      identityLink: baseLink,
      staff: baseStaff,
      department: DEPT_KHCN,
      roleAssignments: [assignmentA, assignmentB],
    });
    expect(atT1NewLogin.decision).toBe("ALLOW");
    if (atT1NewLogin.decision === "ALLOW") {
      expect(atT1NewLogin.effectiveAssignment.id).toBe(assignmentB.id);
      expect(atT1NewLogin.selfContext.effective_role.role_code).toBe(
        "DEPARTMENT_MANAGER",
      );
    }

    // 6. If A overlapped B by even 1ms (A.effective_to = t1 + 1ms), at t1 both A and B are effective -> DENY ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE
    const overlappingA: RoleAssignmentRecord = {
      ...assignmentA,
      effective_to: new Date(t1.getTime() + 1),
    };
    expect(
      evaluateIdentityAndRolePolicy({
        now: t1,
        identityLink: baseLink,
        staff: baseStaff,
        department: DEPT_KHCN,
        roleAssignments: [overlappingA, assignmentB],
      }),
    ).toEqual({
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
    });
  });

  it("detects header spoofing, query parameter pollution, and context-sensitive tamper keys", () => {
    const headers = new Headers({ "x-role": "EXECUTIVE" });
    expect(findTamperHeader(headers)).toBe("x-role");

    const cleanHeaders = new Headers({ "content-type": "application/json" });
    expect(findTamperHeader(cleanHeaders)).toBeNull();

    // Disallowed staff_id on listStaff query params -> TAMPER
    const staffIdOnStaffList = validateQueryParams(
      new URLSearchParams("staff_id=22222222-2222-4222-8222-222222222201"),
      ["q", "status", "department_id", "limit", "offset"],
    );
    expect(staffIdOnStaffList).toEqual({
      ok: false,
      kind: "TAMPER",
      field: "staff_id",
      reason: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
    });

    // Duplicate query param -> DUPLICATE_QUERY_PARAM
    const dupStatus = validateQueryParams(
      new URLSearchParams("status=ACTIVE&status=INACTIVE"),
      ["q", "status", "department_id", "limit", "offset"],
    );
    expect(dupStatus).toEqual({
      ok: false,
      kind: "VALIDATION",
      field: "status",
      reason: "DUPLICATE_QUERY_PARAM",
    });

    // Disallowed department_id in body of patchIdentityLink -> detected by findDisallowedTamperKey
    expect(
      findDisallowedTamperKey(
        ["expected_version", "status", "department_id"],
        ["expected_version", "status", "csrf_token"],
      ),
    ).toBe("department_id");
  });
});
