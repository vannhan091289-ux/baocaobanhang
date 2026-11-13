import "server-only";

export type RoleCode =
  "EXECUTIVE" | "CONFIG_ADMIN" | "DEPARTMENT_MANAGER" | "STAFF";

export type DataScopeType = "BRANCH" | "DEPARTMENT" | "SELF";

export type PolicyAction =
  | "auth.session.establish"
  | "org.department.read"
  | "org.staff.read"
  | "org.department.write"
  | "org.staff.write"
  | "authz.role.read"
  | "authz.role.assign"
  | "customer.read"
  | "customer.write"
  | "kpi.read"
  | "kpi.write";

export interface DepartmentRecord {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface StaffRecord {
  id: string;
  staff_code: string;
  display_name: string;
  department_id: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface IdentityLinkRecord {
  id: string;
  issuer: string;
  subject: string;
  staff_id: string;
  status: "ACTIVE" | "REVOKED";
}

export interface RoleAssignmentRecord {
  id: string;
  staff_id: string;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: Date | string;
  effective_to: Date | string | null;
  status: "ACTIVE" | "REVOKED";
}

export interface EffectiveSelfContext {
  staff_id: string;
  staff_code: string;
  display_name: string;
  status: "ACTIVE";
  department: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE";
  };
  effective_role: {
    role_code: RoleCode;
    scope_type: DataScopeType;
    scope_department_id: string | null;
    effective_from: string;
    effective_to: string | null;
  };
}

export interface IdentityPolicyEvaluationInput {
  now: Date;
  identityLink: IdentityLinkRecord | null;
  staff: StaffRecord | null;
  department: DepartmentRecord | null;
  roleAssignments: RoleAssignmentRecord[];
  boundRoleAssignmentId?: string;
}

export type IdentityPolicyEvaluationResult =
  | {
      decision: "ALLOW";
      reasonCode: "POLICY_ALLOW_SINGLE_EFFECTIVE_ROLE";
      effectiveAssignment: RoleAssignmentRecord;
      selfContext: EffectiveSelfContext;
    }
  | {
      decision: "DENY";
      reasonCode:
        | "IDENTITY_UNMAPPED"
        | "IDENTITY_LINK_REVOKED"
        | "STAFF_NOT_FOUND"
        | "STAFF_INACTIVE"
        | "DEPARTMENT_NOT_FOUND"
        | "DEPARTMENT_INACTIVE"
        | "ROLE_ASSIGNMENT_NONE_EFFECTIVE"
        | "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE"
        | "ROLE_ASSIGNMENT_BOUND_MISMATCH"
        | "ROLE_SCOPE_INVALID";
    };

/**
 * Half-open UTC interval check: [effective_from, effective_to)
 * effective_from <= now && (effective_to === null || now < effective_to)
 */
export function isRoleAssignmentEffectiveAt(
  assignment: RoleAssignmentRecord,
  now: Date,
): boolean {
  if (assignment.status !== "ACTIVE") {
    return false;
  }
  const nowMs = now.getTime();
  const fromMs = new Date(assignment.effective_from).getTime();
  if (Number.isNaN(fromMs) || nowMs < fromMs) {
    return false;
  }
  if (assignment.effective_to !== null) {
    const toMs = new Date(assignment.effective_to).getTime();
    if (Number.isNaN(toMs) || nowMs >= toMs) {
      return false;
    }
  }
  return true;
}

/**
 * Validates role_code and scope_type pairing per ADR-002 §2.5:
 * - EXECUTIVE -> BRANCH (scope_department_id === null)
 * - CONFIG_ADMIN -> BRANCH (scope_department_id === null)
 * - DEPARTMENT_MANAGER -> DEPARTMENT (scope_department_id === staff.department_id, and department is ACTIVE)
 * - STAFF -> SELF (scope_department_id === null)
 */
export function isValidRoleScopePair(
  assignment: RoleAssignmentRecord,
  staff: StaffRecord,
  department: DepartmentRecord,
): boolean {
  if (department.status !== "ACTIVE" || department.id !== staff.department_id) {
    return false;
  }

  switch (assignment.role_code) {
    case "EXECUTIVE":
    case "CONFIG_ADMIN":
      return (
        assignment.scope_type === "BRANCH" &&
        assignment.scope_department_id === null
      );
    case "DEPARTMENT_MANAGER":
      return (
        assignment.scope_type === "DEPARTMENT" &&
        assignment.scope_department_id === staff.department_id
      );
    case "STAFF":
      return (
        assignment.scope_type === "SELF" &&
        assignment.scope_department_id === null
      );
    default:
      return false;
  }
}

/**
 * Evaluates whether an authenticated OIDC identity or active session has a valid
 * Staff mapping and strictly ONE effective RoleAssignment (ADR-002 v0.3).
 */
export function evaluateIdentityAndRolePolicy(
  input: IdentityPolicyEvaluationInput,
): IdentityPolicyEvaluationResult {
  const {
    now,
    identityLink,
    staff,
    department,
    roleAssignments,
    boundRoleAssignmentId,
  } = input;

  if (!identityLink) {
    return { decision: "DENY", reasonCode: "IDENTITY_UNMAPPED" };
  }
  if (identityLink.status !== "ACTIVE") {
    return { decision: "DENY", reasonCode: "IDENTITY_LINK_REVOKED" };
  }
  if (!staff || staff.id !== identityLink.staff_id) {
    return { decision: "DENY", reasonCode: "STAFF_NOT_FOUND" };
  }
  if (staff.status !== "ACTIVE") {
    return { decision: "DENY", reasonCode: "STAFF_INACTIVE" };
  }
  if (!department || department.id !== staff.department_id) {
    return { decision: "DENY", reasonCode: "DEPARTMENT_NOT_FOUND" };
  }
  if (department.status !== "ACTIVE") {
    return { decision: "DENY", reasonCode: "DEPARTMENT_INACTIVE" };
  }

  const effectiveAssignments = roleAssignments.filter((ra) =>
    isRoleAssignmentEffectiveAt(ra, now),
  );

  if (effectiveAssignments.length === 0) {
    return { decision: "DENY", reasonCode: "ROLE_ASSIGNMENT_NONE_EFFECTIVE" };
  }
  if (effectiveAssignments.length > 1) {
    return {
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
    };
  }

  const effectiveAssignment = effectiveAssignments[0]!;

  if (
    boundRoleAssignmentId !== undefined &&
    effectiveAssignment.id !== boundRoleAssignmentId
  ) {
    return {
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_BOUND_MISMATCH",
    };
  }

  if (!isValidRoleScopePair(effectiveAssignment, staff, department)) {
    return { decision: "DENY", reasonCode: "ROLE_SCOPE_INVALID" };
  }

  const effectiveFromIso = new Date(
    effectiveAssignment.effective_from,
  ).toISOString();
  const effectiveToIso =
    effectiveAssignment.effective_to !== null
      ? new Date(effectiveAssignment.effective_to).toISOString()
      : null;

  // Construct strictly allowlisted self-context (ADR-002 §3.1)
  const selfContext: EffectiveSelfContext = {
    staff_id: staff.id,
    staff_code: staff.staff_code,
    display_name: staff.display_name,
    status: "ACTIVE",
    department: {
      id: department.id,
      code: department.code,
      name: department.name,
      status: "ACTIVE",
    },
    effective_role: {
      role_code: effectiveAssignment.role_code,
      scope_type: effectiveAssignment.scope_type,
      scope_department_id: effectiveAssignment.scope_department_id,
      effective_from: effectiveFromIso,
      effective_to: effectiveToIso,
    },
  };

  return {
    decision: "ALLOW",
    reasonCode: "POLICY_ALLOW_SINGLE_EFFECTIVE_ROLE",
    effectiveAssignment,
    selfContext,
  };
}

export interface ActionEvaluationRequest {
  actorContext: EffectiveSelfContext | null;
  action: PolicyAction;
  targetStaffId?: string;
  targetDepartmentId?: string;
}

export interface ActionEvaluationResult {
  decision: "ALLOW" | "DENY";
  httpStatus: 200 | 401 | 403 | 404;
  reasonCode: string;
}

/**
 * Evaluates the 5-tuple authorization matrix from ADR-002 §3 & §4:
 * Subject (Staff + Role) + Action + Resource + Data Scope + Effective Time.
 * Note: Any client-supplied role/scope overrides are ignored; only server-verified actorContext is used.
 */
export function evaluateActionAuthorization(
  req: ActionEvaluationRequest,
): ActionEvaluationResult {
  const { actorContext, action, targetStaffId, targetDepartmentId } = req;

  if (!actorContext) {
    return {
      decision: "DENY",
      httpStatus: 401,
      reasonCode: "AUTH_SESSION_REQUIRED",
    };
  }

  const role = actorContext.effective_role.role_code;
  const actorStaffId = actorContext.staff_id;
  const actorDeptId = actorContext.department.id;

  // Customer / KPI / Lead resources are default-deny in Sprint 1 (and strictly forbidden for CONFIG_ADMIN)
  if (
    action === "customer.read" ||
    action === "customer.write" ||
    action === "kpi.read" ||
    action === "kpi.write"
  ) {
    return {
      decision: "DENY",
      httpStatus: 403,
      reasonCode:
        role === "CONFIG_ADMIN"
          ? "CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN"
          : "SPRINT_1_RESOURCE_OUT_OF_SCOPE",
    };
  }

  // Role assignment / mutation workflow is not exposed in S1-A, and self-escalation is strictly forbidden
  if (action === "authz.role.assign") {
    if (targetStaffId && targetStaffId === actorStaffId) {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "SELF_ESCALATION_FORBIDDEN",
      };
    }
    return {
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "S1A_ROLE_ASSIGN_ENDPOINT_NOT_ENABLED",
    };
  }

  // Organization writes are not exposed in S1-A
  if (action === "org.department.write" || action === "org.staff.write") {
    if (role !== "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      };
    }
    return {
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "S1A_ORG_WRITE_ENDPOINT_NOT_ENABLED",
    };
  }

  if (action === "org.department.read") {
    return {
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_DEPARTMENT_READ_BRANCH",
    };
  }

  if (action === "org.staff.read" || action === "authz.role.read") {
    if (role === "EXECUTIVE" || role === "CONFIG_ADMIN") {
      return {
        decision: "ALLOW",
        httpStatus: 200,
        reasonCode: "ALLOW_BRANCH_SCOPE",
      };
    }

    if (role === "DEPARTMENT_MANAGER") {
      if (targetDepartmentId && targetDepartmentId !== actorDeptId) {
        return {
          decision: "DENY",
          httpStatus: 404,
          reasonCode: "CROSS_DEPARTMENT_DENIED",
        };
      }
      return {
        decision: "ALLOW",
        httpStatus: 200,
        reasonCode: "ALLOW_DEPARTMENT_SCOPE",
      };
    }

    if (role === "STAFF") {
      if (targetStaffId && targetStaffId !== actorStaffId) {
        return {
          decision: "DENY",
          httpStatus: 404,
          reasonCode: "CROSS_STAFF_SELF_SCOPE_DENIED",
        };
      }
      if (targetDepartmentId && targetDepartmentId !== actorDeptId) {
        return {
          decision: "DENY",
          httpStatus: 404,
          reasonCode: "CROSS_DEPARTMENT_DENIED",
        };
      }
      return {
        decision: "ALLOW",
        httpStatus: 200,
        reasonCode: "ALLOW_SELF_SCOPE",
      };
    }
  }

  return {
    decision: "DENY",
    httpStatus: 403,
    reasonCode: "DEFAULT_DENY",
  };
}
