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
  | "kpi.write"
  | "kpi.calendar.read"
  | "kpi.calendar.write"
  | "kpi.dictionary.read"
  | "kpi.dictionary.write"
  | "kpi.target.read"
  | "kpi.target.write"
  | "kpi.target.approve"
  | "planning.plan.read"
  | "planning.plan.write"
  | "planning.activity.read"
  | "planning.activity.write"
  | "planning.review.read"
  | "planning.review.write"
  | "planning.directive.write"
  | "kpi.actual.read"
  | "kpi.actual.write"
  | "kpi.actual.reconcile"
  | "kpi.actual.adjust_final"
  | "dashboard.overview.read";

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
  /** authz.role.assign only: maker (propose) or checker (decide). Defaults to propose. */
  roleWorkflowPhase?: "propose" | "decide";
  /** authz.role.assign decide only: staff who created the proposal. */
  proposerStaffId?: string;
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
  const {
    actorContext,
    action,
    targetStaffId,
    targetDepartmentId,
    roleWorkflowPhase,
    proposerStaffId,
  } = req;

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

  // Maker-Checker role workflow (ADR-002 §6.1): CONFIG_ADMIN proposes, EXECUTIVE decides.
  // Proposer, approver and target Staff must be three different people; no self-escalation.
  if (action === "authz.role.assign") {
    if (targetStaffId && targetStaffId === actorStaffId) {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "SELF_ESCALATION_FORBIDDEN",
      };
    }
    const phase = roleWorkflowPhase ?? "propose";
    if (phase === "propose") {
      if (role !== "CONFIG_ADMIN") {
        return {
          decision: "DENY",
          httpStatus: 403,
          reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
        };
      }
      return {
        decision: "ALLOW",
        httpStatus: 200,
        reasonCode: "ALLOW_ROLE_PROPOSE_CONFIG_ADMIN",
      };
    }
    if (role !== "EXECUTIVE") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      };
    }
    if (proposerStaffId && proposerStaffId === actorStaffId) {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "SEPARATION_OF_DUTIES_VIOLATION",
      };
    }
    return {
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ROLE_DECIDE_EXECUTIVE",
    };
  }

  // Organization writes (S1-B): CONFIG_ADMIN only, BRANCH scope.
  if (action === "org.department.write" || action === "org.staff.write") {
    if (role !== "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      };
    }
    return {
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ORG_WRITE_CONFIG_ADMIN",
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

  // P0A: Working Calendar & 7-Group KPI Dictionary metadata (ADR-002 + ADR-003):
  // All authenticated roles may read calendar & dictionary definitions; only CONFIG_ADMIN may write.
  if (action === "kpi.calendar.read" || action === "kpi.dictionary.read") {
    return {
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_KPI_METADATA_READ",
    };
  }

  if (action === "kpi.calendar.write" || action === "kpi.dictionary.write") {
    if (role !== "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      };
    }
    return {
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_KPI_METADATA_WRITE_CONFIG_ADMIN",
    };
  }

  // P0A: KPI Target Allocation & Approval (ADR-002 + ADR-003):
  // CONFIG_ADMIN is strictly forbidden from reading or writing business/staff KPI targets.
  if (
    action === "kpi.target.read" ||
    action === "kpi.target.write" ||
    action === "kpi.target.approve"
  ) {
    if (role === "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      };
    }

    if (action === "kpi.target.approve") {
      if (role !== "EXECUTIVE" && role !== "DEPARTMENT_MANAGER") {
        return {
          decision: "DENY",
          httpStatus: 403,
          reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
        };
      }
      if (
        role === "DEPARTMENT_MANAGER" &&
        targetDepartmentId &&
        targetDepartmentId !== actorDeptId
      ) {
        return {
          decision: "DENY",
          httpStatus: 404,
          reasonCode: "CROSS_DEPARTMENT_DENIED",
        };
      }
      if (proposerStaffId && proposerStaffId === actorStaffId) {
        return {
          decision: "DENY",
          httpStatus: 403,
          reasonCode: "SEPARATION_OF_DUTIES_VIOLATION",
        };
      }
      return {
        decision: "ALLOW",
        httpStatus: 200,
        reasonCode:
          role === "EXECUTIVE"
            ? "ALLOW_KPI_TARGET_APPROVE_BRANCH"
            : "ALLOW_KPI_TARGET_APPROVE_DEPARTMENT",
      };
    }

    if (role === "EXECUTIVE") {
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

  // P0B-1: Weekly/Daily Sales Plans, Single-Source Activity Log & Monday Review
  if (
    action === "planning.plan.read" ||
    action === "planning.plan.write" ||
    action === "planning.activity.read" ||
    action === "planning.activity.write" ||
    action === "planning.review.read" ||
    action === "planning.review.write" ||
    action === "planning.directive.write"
  ) {
    if (role === "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      };
    }

    if (action === "planning.review.write" && role === "STAFF") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "STAFF_MONDAY_REVIEW_WRITE_FORBIDDEN",
      };
    }

    if (role === "EXECUTIVE") {
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

  // P0B-2 KPI Actuals, Reconciliation & Multi-layer Dashboard (TASK-0008):
  // - CONFIG_ADMIN has no business-data access -> 403.
  // - STAFF has SELF read/write on actuals & dashboard, but CANNOT reconcile or adjust FINAL -> 403.
  // - DEPARTMENT_MANAGER has DEPARTMENT scope (+ maker-checker on FINAL adjustment).
  // - EXECUTIVE has BRANCH scope (+ maker-checker on FINAL adjustment).
  if (
    action === "kpi.actual.read" ||
    action === "kpi.actual.write" ||
    action === "kpi.actual.reconcile" ||
    action === "kpi.actual.adjust_final" ||
    action === "dashboard.overview.read"
  ) {
    if (role === "CONFIG_ADMIN") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      };
    }

    if (action === "kpi.actual.reconcile" && role === "STAFF") {
      return {
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "STAFF_ACTUAL_RECONCILE_FORBIDDEN",
      };
    }

    if (action === "kpi.actual.adjust_final") {
      if (role === "STAFF") {
        return {
          decision: "DENY",
          httpStatus: 403,
          reasonCode: "STAFF_FINAL_ADJUSTMENT_FORBIDDEN",
        };
      }
      if (proposerStaffId && proposerStaffId === actorStaffId) {
        return {
          decision: "DENY",
          httpStatus: 403,
          reasonCode: "MAKER_CHECKER_SELF_APPROVAL_FORBIDDEN",
        };
      }
    }

    if (role === "EXECUTIVE") {
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
