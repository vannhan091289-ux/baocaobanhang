import { describe, expect, it } from "vitest";
import {
  evaluateActionAuthorization,
  type DataScopeType,
  type EffectiveSelfContext,
  type RoleCode,
} from "@/server/policy";
import {
  escapeLike,
  findTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readIsoInstant,
  readPageParams,
  readString,
  readUuid,
  rejectUnknownKeys,
} from "@/server/validation";

const DEPT_A = "11111111-1111-4111-8111-111111111101";
const DEPT_B = "11111111-1111-4111-8111-111111111102";

const STAFF_EXEC = "22222222-2222-4222-8222-222222222201";
const STAFF_ADMIN = "22222222-2222-4222-8222-222222222202";
const STAFF_MGR_A = "22222222-2222-4222-8222-222222222203";
const STAFF_USER_A = "22222222-2222-4222-8222-222222222205";

function makeActor(
  staffId: string,
  roleCode: RoleCode,
  scopeType: DataScopeType,
  scopeDeptId: string | null = null,
): EffectiveSelfContext {
  return {
    staff_id: staffId,
    staff_code: `CODE-${roleCode}`,
    display_name: `Synthetic ${roleCode}`,
    status: "ACTIVE",
    department: {
      id: DEPT_A,
      code: "KHCN",
      name: "Phòng KHCN (Synthetic)",
      status: "ACTIVE",
    },
    effective_role: {
      role_code: roleCode,
      scope_type: scopeType,
      scope_department_id: scopeDeptId,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    },
  };
}

describe("S1-B Org Baseline & Maker-Checker Role Policy Matrix (AC-02, AC-03, AC-05, AC-06)", () => {
  const execActor = makeActor(STAFF_EXEC, "EXECUTIVE", "BRANCH");
  const adminActor = makeActor(STAFF_ADMIN, "CONFIG_ADMIN", "BRANCH");
  const mgrActor = makeActor(
    STAFF_MGR_A,
    "DEPARTMENT_MANAGER",
    "DEPARTMENT",
    DEPT_A,
  );
  const staffActor = makeActor(STAFF_USER_A, "STAFF", "SELF");

  it("permits org.department.write and org.staff.write ONLY to CONFIG_ADMIN and denies EXECUTIVE, DEPARTMENT_MANAGER, STAFF with 403", () => {
    expect(
      evaluateActionAuthorization({
        actorContext: adminActor,
        action: "org.department.write",
      }),
    ).toEqual({
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ORG_WRITE_CONFIG_ADMIN",
    });

    expect(
      evaluateActionAuthorization({
        actorContext: adminActor,
        action: "org.staff.write",
        targetStaffId: STAFF_USER_A,
      }),
    ).toEqual({
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ORG_WRITE_CONFIG_ADMIN",
    });

    for (const actor of [execActor, mgrActor, staffActor]) {
      expect(
        evaluateActionAuthorization({
          actorContext: actor,
          action: "org.department.write",
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      });

      expect(
        evaluateActionAuthorization({
          actorContext: actor,
          action: "org.staff.write",
          targetStaffId: STAFF_USER_A,
        }),
      ).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      });
    }
  });

  it("enforces two-step Maker-Checker (D-09) on authz.role.assign: CONFIG_ADMIN proposes, EXECUTIVE decides, no self-escalation, no self-decision", () => {
    // 1. CONFIG_ADMIN proposes for another staff -> ALLOW
    expect(
      evaluateActionAuthorization({
        actorContext: adminActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: STAFF_USER_A,
      }),
    ).toEqual({
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ROLE_PROPOSE_CONFIG_ADMIN",
    });

    // 2. CONFIG_ADMIN proposes for self -> 403 SELF_ESCALATION_FORBIDDEN
    expect(
      evaluateActionAuthorization({
        actorContext: adminActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: STAFF_ADMIN,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "SELF_ESCALATION_FORBIDDEN",
    });

    // 3. CONFIG_ADMIN attempts to decide -> 403 ACTION_FORBIDDEN_FOR_ROLE
    expect(
      evaluateActionAuthorization({
        actorContext: adminActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: STAFF_USER_A,
        proposerStaffId: STAFF_EXEC,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
    });

    // 4. EXECUTIVE attempts to propose -> 403 ACTION_FORBIDDEN_FOR_ROLE
    expect(
      evaluateActionAuthorization({
        actorContext: execActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "propose",
        targetStaffId: STAFF_USER_A,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
    });

    // 5. EXECUTIVE decides on proposal made by CONFIG_ADMIN for another staff -> ALLOW
    expect(
      evaluateActionAuthorization({
        actorContext: execActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: STAFF_USER_A,
        proposerStaffId: STAFF_ADMIN,
      }),
    ).toEqual({
      decision: "ALLOW",
      httpStatus: 200,
      reasonCode: "ALLOW_ROLE_DECIDE_EXECUTIVE",
    });

    // 6. EXECUTIVE attempts to decide on own proposal -> 403 SEPARATION_OF_DUTIES_VIOLATION
    expect(
      evaluateActionAuthorization({
        actorContext: execActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: STAFF_USER_A,
        proposerStaffId: STAFF_EXEC,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "SEPARATION_OF_DUTIES_VIOLATION",
    });

    // 7. EXECUTIVE attempts to decide on proposal targeting EXECUTIVE self -> 403 SELF_ESCALATION_FORBIDDEN
    expect(
      evaluateActionAuthorization({
        actorContext: execActor,
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: STAFF_EXEC,
        proposerStaffId: STAFF_ADMIN,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "SELF_ESCALATION_FORBIDDEN",
    });
  });

  it("enforces department and self scope boundaries on org.staff.read with uniform 404 on out-of-scope resources", () => {
    // DEPARTMENT_MANAGER reading own department -> ALLOW
    expect(
      evaluateActionAuthorization({
        actorContext: mgrActor,
        action: "org.staff.read",
        targetDepartmentId: DEPT_A,
      }).decision,
    ).toBe("ALLOW");

    // DEPARTMENT_MANAGER reading other department -> 404 CROSS_DEPARTMENT_DENIED
    expect(
      evaluateActionAuthorization({
        actorContext: mgrActor,
        action: "org.staff.read",
        targetDepartmentId: DEPT_B,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 404,
      reasonCode: "CROSS_DEPARTMENT_DENIED",
    });

    // STAFF reading other department -> 404 CROSS_DEPARTMENT_DENIED
    expect(
      evaluateActionAuthorization({
        actorContext: staffActor,
        action: "org.staff.read",
        targetDepartmentId: DEPT_B,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 404,
      reasonCode: "CROSS_DEPARTMENT_DENIED",
    });
  });
});

describe("S1-B Input Validation & Anti-Tampering Helpers", () => {
  it("validates plain objects, unknown keys, tamper keys, UUIDs, strings, versions, UTC instants, pagination, and LIKE escaping", () => {
    expect(isPlainObject({ code: "KHCN" })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(["a"])).toBe(false);

    expect(
      rejectUnknownKeys({ code: "KHCN", expected_version: 2 }, [
        "code",
        "expected_version",
      ]),
    ).toEqual({ ok: true, value: true });

    expect(rejectUnknownKeys({ code: "KHCN", extra: 1 }, ["code"])).toEqual({
      ok: false,
      field: "extra",
      reason: "UNKNOWN_FIELD",
    });

    expect(findTamperKey(["code", "role_code_override"])).toBe(
      "role_code_override",
    );
    expect(findTamperKey(["code", "name"])).toBeNull();

    expect(isUuid(DEPT_A)).toBe(true);
    expect(readUuid({ id: DEPT_A }, "id")).toEqual({
      ok: true,
      value: DEPT_A.toLowerCase(),
    });
    expect(readUuid({ id: "not-a-uuid" }, "id")).toEqual({
      ok: false,
      field: "id",
      reason: "INVALID_UUID",
    });
    expect(readUuid({ id: null }, "id", true)).toEqual({
      ok: true,
      value: undefined,
    });

    expect(
      readString({ code: "  KHCN_01  " }, "code", {
        max: 32,
        pattern: /^[A-Z0-9_]+$/,
      }),
    ).toEqual({ ok: true, value: "KHCN_01" });

    expect(readExpectedVersion({ expected_version: 3 })).toEqual({
      ok: true,
      value: 3,
    });
    expect(readExpectedVersion({ expected_version: 0 })).toEqual({
      ok: false,
      field: "expected_version",
      reason: "INVALID_VERSION",
    });

    const iso = readIsoInstant(
      { effective_from: "2026-01-01T00:00:00Z" },
      "effective_from",
      false,
    );
    expect(iso.ok).toBe(true);
    if (iso.ok) {
      expect(iso.value?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    }

    expect(
      readIsoInstant(
        { effective_from: "2026-01-01 00:00:00" },
        "effective_from",
        false,
      ),
    ).toEqual({
      ok: false,
      field: "effective_from",
      reason: "MUST_BE_UTC_ISO_INSTANT",
    });

    const url = new URL(
      "http://127.0.0.1:3100/api/org/staff?limit=25&offset=10",
    );
    expect(readPageParams(url.searchParams)).toEqual({
      ok: true,
      value: { limit: 25, offset: 10 },
    });

    const badUrl = new URL("http://127.0.0.1:3100/api/org/staff?limit=999");
    expect(readPageParams(badUrl.searchParams)).toEqual({
      ok: false,
      field: "limit",
      reason: "INVALID_LIMIT",
    });

    expect(escapeLike("100%_test\\value")).toBe("100\\%\\_test\\\\value");
  });
});
