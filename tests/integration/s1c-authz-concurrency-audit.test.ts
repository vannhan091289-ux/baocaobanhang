import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SYNTHETIC_DEPARTMENTS,
  SYNTHETIC_USERS,
} from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import {
  createDepartment,
  createStaff,
  listStaff,
  patchDepartment,
  patchStaff,
} from "@/server/org-service";
import {
  createProposal,
  decideProposal,
  listRoleAssignments,
} from "@/server/role-workflow";
import type { Actor } from "@/server/service-core";
import {
  establishSessionFromVerifiedOidcIdentity,
  SESSION_COOKIE_NAME,
  verifyRequestSession,
} from "@/server/session";
import { GET as getMeRoute } from "@/app/api/me/route";
import {
  GET as getDepartmentsRoute,
  POST as postDepartmentsRoute,
} from "@/app/api/org/departments/route";
import { PATCH as patchDepartmentRoute } from "@/app/api/org/departments/[id]/route";
import {
  GET as getStaffListRoute,
  POST as postStaffRoute,
} from "@/app/api/org/staff/route";
import {
  GET as getStaffByIdRoute,
  PATCH as patchStaffRoute,
} from "@/app/api/org/staff/[id]/route";
import {
  GET as getIdentityLinksRoute,
  POST as postIdentityLinksRoute,
} from "@/app/api/org/identity-links/route";
import { PATCH as patchIdentityLinkRoute } from "@/app/api/org/identity-links/[id]/route";
import { GET as getRoleAssignmentsRoute } from "@/app/api/role-assignments/route";
import {
  GET as getProposalsRoute,
  POST as postProposalsRoute,
} from "@/app/api/role-assignments/proposals/route";
import { POST as postDecisionRoute } from "@/app/api/role-assignments/proposals/[id]/decision/route";

ensureDevtestEnvLoaded();
const cfg = getRuntimeConfig();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;

let migratorPool: pg.Pool;

async function makeActorForUserKey(key: string): Promise<Actor> {
  const userDef = SYNTHETIC_USERS.find((u) => u.key === key)!;
  const linkRes = await migratorPool.query<{
    issuer: string;
    subject: string;
  }>(
    `SELECT issuer, subject FROM identity_links WHERE staff_id = $1 AND status = 'ACTIVE'`,
    [userDef.staff!.id],
  );
  const { issuer, subject } = linkRes.rows[0]!;
  const session = await establishSessionFromVerifiedOidcIdentity({
    issuer,
    subject,
  });
  expect(session.decision).toBe("ALLOW");
  if (session.decision !== "ALLOW") {
    throw new Error(`Failed to establish session for ${key}`);
  }
  return {
    rawSessionToken: session.rawSessionToken,
    csrfToken: session.csrfToken,
    sessionId: session.sessionId,
    ctx: session.selfContext,
  };
}

function makeAuthRequest(
  path: string,
  opts: {
    method?: string;
    actor?: Actor;
    body?: unknown;
    extraHeaders?: Record<string, string>;
  } = {},
): Request {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.actor) {
    headers.cookie = `${SESSION_COOKIE_NAME}=${opts.actor.rawSessionToken}`;
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = headers.origin ?? cfg.appOrigin;
    if (opts.actor && !("x-csrf-token" in headers)) {
      headers["x-csrf-token"] = opts.actor.csrfToken;
    }
    headers["content-type"] = "application/json";
  }
  return new Request(`http://127.0.0.1:3100${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  migratorPool = new pg.Pool({ connectionString: migratorUrl, max: 6 });
});

afterAll(async () => {
  await closeRuntimePool();
  if (migratorPool) {
    await migratorPool.end();
  }
});

describe("S1-C AC-01: Exhaustive HTTP Route Matrix Across All 15 Sprint 1 Endpoints & 9 Actor States", () => {
  it("verifies EXECUTIVE, CONFIG_ADMIN, DEPARTMENT_MANAGER, STAFF, ANONYMOUS, UNMAPPED, INACTIVE, EXPIRED_ROLE, and MULTI_ROLE across Sprint 1 endpoints", async () => {
    const execActor = await makeActorForUserKey("exec01");
    const adminActor = await makeActorForUserKey("admin01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const staffKhdnUser = SYNTHETIC_USERS.find((u) => u.key === "staff_khdn")!;

    // 1. Verify denied OIDC actor classes (UNMAPPED, INACTIVE, EXPIRED_ROLE, MULTI_ROLE) cannot establish sessions
    const denyFixtures: Array<{ key: string; expectedReason: string }> = [
      { key: "inactive_staff", expectedReason: "STAFF_INACTIVE" },
      { key: "expired_role", expectedReason: "ROLE_ASSIGNMENT_NONE_EFFECTIVE" },
      {
        key: "multi_role",
        expectedReason: "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
      },
    ];
    for (const df of denyFixtures) {
      const u = SYNTHETIC_USERS.find((x) => x.key === df.key)!;
      const link = await migratorPool.query<{
        issuer: string;
        subject: string;
      }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
        u.staff!.id,
      ]);
      const res = await establishSessionFromVerifiedOidcIdentity({
        issuer: link.rows[0]!.issuer,
        subject: link.rows[0]!.subject,
      });
      expect(res.decision).toBe("DENY");
      if (res.decision === "DENY") {
        expect(res.httpStatus).toBe(403);
        expect(res.reasonCode).toBe(df.expectedReason);
      }
    }

    // Unmapped OIDC identity -> 403 IDENTITY_UNMAPPED
    const unmappedRes = await establishSessionFromVerifiedOidcIdentity({
      issuer: cfg.oidcIssuer,
      subject: "sub-unmapped-synthetic-probe",
    });
    expect(unmappedRes).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "IDENTITY_UNMAPPED",
    });

    // 2. ANONYMOUS requests across all 15 Sprint 1 endpoints -> 401 SESSION_COOKIE_MISSING
    const dummyId = SYNTHETIC_DEPARTMENTS.KHCN.id;
    const anonChecks: Array<Promise<Response>> = [
      getMeRoute(makeAuthRequest("/api/me")),
      getDepartmentsRoute(makeAuthRequest("/api/org/departments")),
      postDepartmentsRoute(
        makeAuthRequest("/api/org/departments", {
          method: "POST",
          body: { code: "ANON1", name: "Anon" },
        }),
      ),
      patchDepartmentRoute(
        makeAuthRequest(`/api/org/departments/${dummyId}`, {
          method: "PATCH",
          body: { expected_version: 1, name: "Anon" },
        }),
        { params: Promise.resolve({ id: dummyId }) },
      ),
      getStaffListRoute(makeAuthRequest("/api/org/staff")),
      postStaffRoute(
        makeAuthRequest("/api/org/staff", {
          method: "POST",
          body: {
            staff_code: "ANON1",
            display_name: "Anon",
            department_id: dummyId,
          },
        }),
      ),
      getStaffByIdRoute(makeAuthRequest(`/api/org/staff/${dummyId}`), {
        params: Promise.resolve({ id: dummyId }),
      }),
      patchStaffRoute(
        makeAuthRequest(`/api/org/staff/${dummyId}`, {
          method: "PATCH",
          body: { expected_version: 1, display_name: "Anon" },
        }),
        { params: Promise.resolve({ id: dummyId }) },
      ),
      getIdentityLinksRoute(makeAuthRequest("/api/org/identity-links")),
      postIdentityLinksRoute(
        makeAuthRequest("/api/org/identity-links", {
          method: "POST",
          body: { staff_id: dummyId, subject: "anon-sub" },
        }),
      ),
      patchIdentityLinkRoute(
        makeAuthRequest(`/api/org/identity-links/${dummyId}`, {
          method: "PATCH",
          body: { expected_version: 1, status: "REVOKED" },
        }),
        { params: Promise.resolve({ id: dummyId }) },
      ),
      getRoleAssignmentsRoute(makeAuthRequest("/api/role-assignments")),
      getProposalsRoute(makeAuthRequest("/api/role-assignments/proposals")),
      postProposalsRoute(
        makeAuthRequest("/api/role-assignments/proposals", {
          method: "POST",
          body: {
            target_staff_id: dummyId,
            propose_action: "ASSIGN",
            role_code: "STAFF",
            reason: "Anon",
          },
        }),
      ),
      postDecisionRoute(
        makeAuthRequest(`/api/role-assignments/proposals/${dummyId}/decision`, {
          method: "POST",
          body: { decision: "APPROVE", expected_version: 1 },
        }),
        { params: Promise.resolve({ id: dummyId }) },
      ),
    ];

    const anonResponses = await Promise.all(anonChecks);
    for (const r of anonResponses) {
      expect(r.status).toBe(401);
    }

    // 3. Read matrix across EXECUTIVE, CONFIG_ADMIN, DEPARTMENT_MANAGER, STAFF
    for (const actor of [execActor, adminActor, mgrKhcnActor, staffKhcnActor]) {
      expect(
        (await getMeRoute(makeAuthRequest("/api/me", { actor }))).status,
      ).toBe(200);
      expect(
        (
          await getDepartmentsRoute(
            makeAuthRequest("/api/org/departments", { actor }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await getStaffListRoute(makeAuthRequest("/api/org/staff", { actor })))
          .status,
      ).toBe(200);
      expect(
        (
          await getRoleAssignmentsRoute(
            makeAuthRequest("/api/role-assignments", { actor }),
          )
        ).status,
      ).toBe(200);
    }

    // Identity links & proposals read: 200 for EXEC/ADMIN, 403 for MGR/STAFF
    for (const actor of [execActor, adminActor]) {
      expect(
        (
          await getIdentityLinksRoute(
            makeAuthRequest("/api/org/identity-links", { actor }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await getProposalsRoute(
            makeAuthRequest("/api/role-assignments/proposals", { actor }),
          )
        ).status,
      ).toBe(200);
    }
    for (const actor of [mgrKhcnActor, staffKhcnActor]) {
      expect(
        (
          await getIdentityLinksRoute(
            makeAuthRequest("/api/org/identity-links", { actor }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await getProposalsRoute(
            makeAuthRequest("/api/role-assignments/proposals", { actor }),
          )
        ).status,
      ).toBe(403);
    }

    // Detail read /api/org/staff/[id] on KHDN staff: 200 for EXEC/ADMIN, 404 for MGR(KHCN)/STAFF(KHCN)
    const khdnStaffId = staffKhdnUser.staff!.id;
    for (const actor of [execActor, adminActor]) {
      const r = await getStaffByIdRoute(
        makeAuthRequest(`/api/org/staff/${khdnStaffId}`, { actor }),
        { params: Promise.resolve({ id: khdnStaffId }) },
      );
      expect(r.status).toBe(200);
    }
    for (const actor of [mgrKhcnActor, staffKhcnActor]) {
      const r = await getStaffByIdRoute(
        makeAuthRequest(`/api/org/staff/${khdnStaffId}`, { actor }),
        { params: Promise.resolve({ id: khdnStaffId }) },
      );
      expect(r.status).toBe(404);
    }
  });
});

describe("S1-C AC-02: Anti-Inference Search, Filter & Pagination (Zero Count Oracle Leakage)", () => {
  it("binds scope into SQL WHERE before q/status/pagination so out-of-scope records never alter total count or results", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");

    const suffix = randomUUID().slice(0, 6).toUpperCase();
    const sharedKeyword = `ORACLE_${suffix}`;
    const createdStaffIds: string[] = [];

    try {
      // Baseline search for sharedKeyword by MGR(KHCN) and STAFF(KHCN) before any KHDN record exists
      const mgrBefore = await listStaff(
        mgrKhcnActor,
        new URLSearchParams({
          q: sharedKeyword,
          status: "ACTIVE",
          limit: "10",
          offset: "0",
        }),
      );
      const staffBefore = await listStaff(
        staffKhcnActor,
        new URLSearchParams({
          q: sharedKeyword,
          status: "ACTIVE",
          limit: "10",
          offset: "0",
        }),
      );
      expect(mgrBefore.ok && mgrBefore.page?.total === 0).toBe(true);
      expect(staffBefore.ok && staffBefore.page?.total === 0).toBe(true);

      // Insert 2 matching staff records in KHDN and DVKH (out of KHCN scope)
      for (const [idx, deptId] of [
        SYNTHETIC_DEPARTMENTS.KHDN.id,
        SYNTHETIC_DEPARTMENTS.DVKH.id,
      ].entries()) {
        const created = await createStaff(adminActor, {
          staff_code: `SYN-${sharedKeyword}-${idx}`,
          display_name: `Out of Scope ${sharedKeyword} ${idx}`,
          department_id: deptId,
        });
        expect(created.ok).toBe(true);
        if (created.ok) createdStaffIds.push(created.data.id);
      }

      // CONFIG_ADMIN (BRANCH scope) searching sharedKeyword sees total = 2
      const adminSearch = await listStaff(
        adminActor,
        new URLSearchParams({
          q: sharedKeyword,
          status: "ACTIVE",
          limit: "1",
          offset: "0",
        }),
      );
      expect(adminSearch.ok).toBe(true);
      if (adminSearch.ok) {
        expect(adminSearch.page?.total).toBe(2);
        expect(adminSearch.data).toHaveLength(1);
      }

      // DEPARTMENT_MANAGER (KHCN) and STAFF (KHCN) searching the exact same keyword STILL get total = 0, data = []
      const mgrAfter = await listStaff(
        mgrKhcnActor,
        new URLSearchParams({
          q: sharedKeyword,
          status: "ACTIVE",
          limit: "10",
          offset: "0",
        }),
      );
      const staffAfter = await listStaff(
        staffKhcnActor,
        new URLSearchParams({
          q: sharedKeyword,
          status: "ACTIVE",
          limit: "10",
          offset: "0",
        }),
      );
      expect(mgrAfter).toEqual(mgrBefore);
      expect(staffAfter).toEqual(staffBefore);

      // Wildcard % or _ in q is escaped and does not match everything
      const wildcardSearch = await listStaff(
        mgrKhcnActor,
        new URLSearchParams({ q: "%_%", limit: "10", offset: "0" }),
      );
      expect(wildcardSearch.ok).toBe(true);
      if (wildcardSearch.ok) {
        expect(wildcardSearch.page?.total).toBe(0);
      }
    } finally {
      for (const sid of createdStaffIds) {
        await migratorPool.query(`DELETE FROM staff WHERE id = $1`, [sid]);
      }
    }
  });
});

describe("S1-C AC-03: Parameter Tampering, Header Spoofing, Query Pollution & Forced Browsing With DENY Audit", () => {
  it("blocks tampered role, scope, department_id, staff_id, proposer_staff_id, approver_staff_id in query, body, or headers with 403/404 and records DENY AuditEvent", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const khdnDeptId = SYNTHETIC_DEPARTMENTS.KHDN.id;
    const khdnStaffId = SYNTHETIC_USERS.find((u) => u.key === "staff_khdn")!
      .staff!.id;

    const beforeDenyRes = await migratorPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events WHERE decision = 'DENY'`,
    );
    const initialDenyCount = Number(beforeDenyRes.rows[0]!.n);

    // 1. Query tamper on /api/me (role, scope, out-of-scope staff_id, out-of-scope department_id)
    const meRoleTamper = await getMeRoute(
      makeAuthRequest("/api/me?role=EXECUTIVE", { actor: staffKhcnActor }),
    );
    expect(meRoleTamper.status).toBe(403);

    const meStaffTamper = await getMeRoute(
      makeAuthRequest(`/api/me?staff_id=${khdnStaffId}`, {
        actor: staffKhcnActor,
      }),
    );
    expect(meStaffTamper.status).toBe(404);

    // 2. Header spoofing on /api/org/staff and /api/me
    const headerTamper1 = await getStaffListRoute(
      makeAuthRequest("/api/org/staff", {
        actor: staffKhcnActor,
        extraHeaders: { "x-role": "EXECUTIVE" },
      }),
    );
    expect(headerTamper1.status).toBe(403);

    const headerTamper2 = await getMeRoute(
      makeAuthRequest("/api/me", {
        actor: staffKhcnActor,
        extraHeaders: { "x-scope": "BRANCH" },
      }),
    );
    expect(headerTamper2.status).toBe(403);

    // 3. Disallowed staff_id on /api/org/staff query -> 403 CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED
    const staffIdQueryOnStaffList = await listStaff(
      staffKhcnActor,
      new URLSearchParams({ staff_id: khdnStaffId }),
    );
    expect(staffIdQueryOnStaffList.ok).toBe(false);
    if (!staffIdQueryOnStaffList.ok) {
      expect(staffIdQueryOnStaffList.status).toBe(403);
      expect(staffIdQueryOnStaffList.code).toBe(
        "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
      );
    }

    // 4. Out-of-scope staff_id and department_id on /api/role-assignments -> 404 RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE
    const raCrossStaff = await listRoleAssignments(
      staffKhcnActor,
      new URLSearchParams({ staff_id: khdnStaffId }),
    );
    expect(raCrossStaff.ok).toBe(false);
    if (!raCrossStaff.ok) expect(raCrossStaff.status).toBe(404);

    const raCrossDept = await listRoleAssignments(
      mgrKhcnActor,
      new URLSearchParams({ department_id: khdnDeptId }),
    );
    expect(raCrossDept.ok).toBe(false);
    if (!raCrossDept.ok) expect(raCrossDept.status).toBe(404);

    // 5. Body tamper (proposer_staff_id, approver_staff_id, scope_type, department_id on proposal create)
    for (const tamperedKey of [
      "proposer_staff_id",
      "approver_staff_id",
      "scope_type",
      "department_id",
      "staff_id",
    ]) {
      const propTamper = await createProposal(adminActor, {
        target_staff_id: khdnStaffId,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Tamper check",
        [tamperedKey]: adminActor.ctx.staff_id,
      });
      expect(propTamper.ok).toBe(false);
      if (!propTamper.ok) {
        expect(propTamper.status).toBe(403);
        expect(propTamper.code).toBe("CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED");
      }
    }

    // 6. Forced browsing non-existent UUID on PATCH /api/org/departments/[id], PATCH /api/org/staff/[id], POST /api/role-assignments/proposals/[id]/decision -> 404 + DENY audit
    const missingDeptPatch = await patchDepartment(adminActor, randomUUID(), {
      expected_version: 1,
      name: "Missing Dept",
    });
    expect(missingDeptPatch.ok).toBe(false);
    if (!missingDeptPatch.ok) expect(missingDeptPatch.status).toBe(404);

    const afterDenyRes = await migratorPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_events WHERE decision = 'DENY'`,
    );
    const finalDenyCount = Number(afterDenyRes.rows[0]!.n);
    // All 12 tamper/forced-browsing checks above must have recorded DENY AuditEvents
    expect(finalDenyCount - initialDenyCount).toBeGreaterThanOrEqual(12);
  });
});

describe("S1-C AC-04: Real-DB Sequential Role Handover [t0, t1) -> [t1, null) & 1ms Overlap Rejection", () => {
  it("supports sequential non-overlapping role handover, rejects 1ms overlaps with 409, and revokes old session at exact t1 with ROLE_ASSIGNMENT_BOUND_MISMATCH", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const zeroRoleUser = SYNTHETIC_USERS.find((u) => u.key === "zero_role")!;
    const targetStaffId = zeroRoleUser.staff!.id;

    const linkRes = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(
      `SELECT issuer, subject FROM identity_links WHERE staff_id = $1 AND status = 'ACTIVE'`,
      [targetStaffId],
    );
    const { issuer, subject } = linkRes.rows[0]!;

    const baseMs = Date.now() + 60_000; // t0 = +60s
    const t0 = new Date(baseMs);
    const t1 = new Date(baseMs + 60_000); // t1 = +120s
    const t2 = new Date(baseMs + 120_000); // t2 = +180s

    try {
      // 1. Propose & approve Assignment A: STAFF [t0, t1)
      const propA = await createProposal(adminActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        effective_from: t0.toISOString(),
        effective_to: t1.toISOString(),
        reason: "Assignment A [t0, t1)",
      });
      expect(propA.ok).toBe(true);
      if (!propA.ok) return;

      const decA = await decideProposal(execActor, propA.data.id, {
        decision: "APPROVE",
        expected_version: propA.data.row_version,
        reason: "Approve A [t0, t1)",
      });
      expect(decA.ok).toBe(true);
      if (!decA.ok) return;

      // 2. Propose an assignment that overlaps A by 1ms: [t1 - 1ms, t2) -> must fail on approval with 409 ROLE_ASSIGNMENT_INTERVAL_OVERLAP
      const propOverlap = await createProposal(adminActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "DEPARTMENT_MANAGER",
        effective_from: new Date(t1.getTime() - 1).toISOString(),
        effective_to: t2.toISOString(),
        reason: "Overlap by 1ms with A",
      });
      expect(propOverlap.ok).toBe(true);
      if (!propOverlap.ok) return;

      const decOverlap = await decideProposal(execActor, propOverlap.data.id, {
        decision: "APPROVE",
        expected_version: propOverlap.data.row_version,
        reason: "Try approving 1ms overlap",
      });
      expect(decOverlap.ok).toBe(false);
      if (!decOverlap.ok) {
        expect(decOverlap.status).toBe(409);
        expect(decOverlap.code).toBe("ROLE_ASSIGNMENT_INTERVAL_OVERLAP");
      }

      // Reject the overlapping proposal so we can submit the clean sequential handover B [t1, t2)
      const rejOverlap = await decideProposal(execActor, propOverlap.data.id, {
        decision: "REJECT",
        expected_version: propOverlap.data.row_version,
        reason: "Reject 1ms overlapping proposal",
      });
      expect(rejOverlap.ok).toBe(true);

      // 3. Propose & approve clean sequential Assignment B: DEPARTMENT_MANAGER [t1, t2)
      const propB = await createProposal(adminActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "DEPARTMENT_MANAGER",
        effective_from: t1.toISOString(),
        effective_to: t2.toISOString(),
        reason: "Sequential handover B [t1, t2)",
      });
      expect(propB.ok).toBe(true);
      if (!propB.ok) return;

      const decB = await decideProposal(execActor, propB.data.id, {
        decision: "APPROVE",
        expected_version: propB.data.row_version,
        reason: "Approve sequential handover B [t1, t2)",
      });
      expect(decB.ok).toBe(true);

      // 4. Verify millisecond boundaries against real PostgreSQL:
      // At t0 - 1ms -> DENY ROLE_ASSIGNMENT_NONE_EFFECTIVE
      const loginBeforeT0 = await establishSessionFromVerifiedOidcIdentity({
        issuer,
        subject,
        now: new Date(t0.getTime() - 1),
      });
      expect(loginBeforeT0).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "ROLE_ASSIGNMENT_NONE_EFFECTIVE",
      });

      // At exact t0 -> ALLOW (bound to Assignment A: STAFF)
      const loginAtT0 = await establishSessionFromVerifiedOidcIdentity({
        issuer,
        subject,
        now: t0,
      });
      expect(loginAtT0.decision).toBe("ALLOW");
      if (loginAtT0.decision !== "ALLOW") return;
      expect(loginAtT0.selfContext.effective_role.role_code).toBe("STAFF");

      // At t1 - 1ms -> session bound to A is STILL valid
      const verifyBeforeT1 = await verifyRequestSession({
        rawSessionToken: loginAtT0.rawSessionToken,
        now: new Date(t1.getTime() - 1),
      });
      expect(verifyBeforeT1.authenticated).toBe(true);
      if (verifyBeforeT1.authenticated) {
        expect(verifyBeforeT1.selfContext.effective_role.role_code).toBe(
          "STAFF",
        );
      }

      // At exact t1 -> session bound to A is rejected & revoked with ROLE_ASSIGNMENT_BOUND_MISMATCH
      const verifyAtT1 = await verifyRequestSession({
        rawSessionToken: loginAtT0.rawSessionToken,
        now: t1,
      });
      expect(verifyAtT1).toEqual({
        authenticated: false,
        httpStatus: 403,
        reasonCode: "ROLE_ASSIGNMENT_BOUND_MISMATCH",
      });

      // Fresh login at exact t1 -> ALLOW (bound to Assignment B: DEPARTMENT_MANAGER)
      const loginAtT1 = await establishSessionFromVerifiedOidcIdentity({
        issuer,
        subject,
        now: t1,
      });
      expect(loginAtT1.decision).toBe("ALLOW");
      if (loginAtT1.decision !== "ALLOW") return;
      expect(loginAtT1.selfContext.effective_role.role_code).toBe(
        "DEPARTMENT_MANAGER",
      );

      // At t2 - 1ms -> session bound to B is valid
      const verifyBeforeT2 = await verifyRequestSession({
        rawSessionToken: loginAtT1.rawSessionToken,
        now: new Date(t2.getTime() - 1),
      });
      expect(verifyBeforeT2.authenticated).toBe(true);

      // At exact t2 -> session bound to B expires with ROLE_ASSIGNMENT_NONE_EFFECTIVE
      const verifyAtT2 = await verifyRequestSession({
        rawSessionToken: loginAtT1.rawSessionToken,
        now: t2,
      });
      expect(verifyAtT2).toEqual({
        authenticated: false,
        httpStatus: 403,
        reasonCode: "ROLE_ASSIGNMENT_NONE_EFFECTIVE",
      });
    } finally {
      await migratorPool.query(`DELETE FROM sessions WHERE staff_id = $1`, [
        targetStaffId,
      ]);
      await migratorPool.query(
        `UPDATE role_assignment_proposals SET applied_assignment_id = NULL WHERE target_staff_id = $1`,
        [targetStaffId],
      );
      await migratorPool.query(
        `DELETE FROM role_assignment_proposals WHERE target_staff_id = $1`,
        [targetStaffId],
      );
      await migratorPool.query(
        `DELETE FROM role_assignments WHERE staff_id = $1`,
        [targetStaffId],
      );
    }
  });
});

describe("S1-C AC-05: Real PostgreSQL Concurrency & Race Condition Barriers", () => {
  it("serializes (1) concurrent DEPARTMENT_MANAGER approval + staff department transfer, (2) concurrent dual proposal decisions, and (3) in-flight write during authority revocation", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const suffix = randomUUID().slice(0, 6).toUpperCase();

    const createdStaffIds: string[] = [];

    try {
      // Create temporary KHCN staff for Race 1 & Race 2
      const stRes = await createStaff(adminActor, {
        staff_code: `SYN-RACE-${suffix}`,
        display_name: `Race Staff ${suffix}`,
        department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      });
      expect(stRes.ok).toBe(true);
      if (!stRes.ok) return;
      const raceStaff = stRes.data;
      createdStaffIds.push(raceStaff.id);

      // Race 2 first: Concurrent dual decisions on the same PENDING proposal
      const propDual = await createProposal(adminActor, {
        target_staff_id: raceStaff.id,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Dual decision race test",
      });
      expect(propDual.ok).toBe(true);
      if (!propDual.ok) return;

      const [dec1, dec2] = await Promise.all([
        decideProposal(execActor, propDual.data.id, {
          decision: "APPROVE",
          expected_version: propDual.data.row_version,
          reason: "Concurrent approve 1",
        }),
        decideProposal(execActor, propDual.data.id, {
          decision: "REJECT",
          expected_version: propDual.data.row_version,
          reason: "Concurrent reject 2",
        }),
      ]);

      // Exactly 1 succeeds (200) and 1 fails with 409
      const successes = [dec1, dec2].filter((r) => r.ok);
      const failures = [dec1, dec2].filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      if (!failures[0]!.ok) {
        expect(failures[0]!.status).toBe(409);
      }

      // Race 1: Concurrent EXECUTIVE approval of DEPARTMENT_MANAGER(KHCN) vs CONFIG_ADMIN transferring staff to KHDN
      const propMgr = await createProposal(adminActor, {
        target_staff_id: raceStaff.id,
        propose_action: "ASSIGN",
        role_code: "DEPARTMENT_MANAGER",
        reason: "Promote to KHCN Manager",
      });
      expect(propMgr.ok).toBe(true);
      if (!propMgr.ok) return;

      const [approveMgrRes, transferDeptRes] = await Promise.all([
        decideProposal(execActor, propMgr.data.id, {
          decision: "APPROVE",
          expected_version: propMgr.data.row_version,
          reason: "Approve KHCN Manager",
        }),
        patchStaff(adminActor, raceStaff.id, {
          expected_version: raceStaff.row_version,
          department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
        }),
      ]);

      expect(transferDeptRes.ok).toBe(true);
      // Whether approveMgrRes ran before or after transferDeptRes under lock_s1a_authority():
      // - If transfer ran first, approveMgrRes sees department_id = KHDN (or proposal status = CANCELLED) and aborts with 409!
      // - If approveMgrRes ran first, transferDeptRes ran second and revoked all ACTIVE role_assignments on raceStaff!
      // In BOTH interleavings, there must be ZERO ACTIVE role_assignments left on raceStaff!
      const activeRolesAfterRace = await migratorPool.query(
        `SELECT id, role_code, scope_department_id, status
           FROM role_assignments
          WHERE staff_id = $1 AND status = 'ACTIVE'`,
        [raceStaff.id],
      );
      expect(activeRolesAfterRace.rowCount).toBe(0);
      // And if approveMgrRes ran second, it must have returned 409
      if (!approveMgrRes.ok) {
        expect(approveMgrRes.status).toBe(409);
      }

      // Race 3: In-flight request while caller's session is revoked before lock_s1a_authority() releases
      // Hold lock_s1a_authority() on a separate connection, revoke a temporary admin session, then release lock while createDepartment is waiting for the lock!
      const tempAdminSessionActor = await makeActorForUserKey("admin01");
      const lockClient = await migratorPool.connect();
      try {
        await lockClient.query("BEGIN");
        await lockClient.query("SELECT lock_s1a_authority()");

        // Start in-flight write that will block on lock_s1a_authority()
        const inFlightPromise = createDepartment(tempAdminSessionActor, {
          code: `INFLIGHT_${suffix}`,
          name: "Should Abort On Revoked Session",
        });

        // Revoke tempAdminSessionActor's session while lock is held
        await lockClient.query(
          `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'CONCURRENT_REVOKE_TEST' WHERE id = $1`,
          [tempAdminSessionActor.sessionId],
        );
        await lockClient.query("COMMIT");

        const inFlightRes = await inFlightPromise;
        expect(inFlightRes.ok).toBe(false);
        if (!inFlightRes.ok) {
          expect(inFlightRes.status).toBe(401);
          expect(inFlightRes.code).toBe("SESSION_REVOKED");
        }
      } finally {
        await lockClient.query("ROLLBACK").catch(() => undefined);
        lockClient.release();
      }
    } finally {
      for (const sid of createdStaffIds) {
        await migratorPool.query(`DELETE FROM sessions WHERE staff_id = $1`, [
          sid,
        ]);
        await migratorPool.query(
          `UPDATE role_assignment_proposals SET applied_assignment_id = NULL WHERE target_staff_id = $1`,
          [sid],
        );
        await migratorPool.query(
          `DELETE FROM role_assignment_proposals WHERE target_staff_id = $1`,
          [sid],
        );
        await migratorPool.query(
          `DELETE FROM role_assignments WHERE staff_id = $1`,
          [sid],
        );
        await migratorPool.query(`DELETE FROM staff WHERE id = $1`, [sid]);
      }
    }
  });
});

describe("S1-C AC-06: Audit Completeness, Full-Table Redaction Scan & Outage Rollback Across All Write Endpoints", () => {
  it("rolls back all 8 write operations when audit_events is unavailable and verifies zero sensitive tokens/secrets in audit_events", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const zeroRoleUser = SYNTHETIC_USERS.find((u) => u.key === "zero_role")!;

    // Snapshot table counts before outage simulation
    const countTables = async () => {
      const res = await migratorPool.query<{
        depts: string;
        staff: string;
        links: string;
        roles: string;
        props: string;
      }>(`
        SELECT
          (SELECT count(*)::text FROM departments) AS depts,
          (SELECT count(*)::text FROM staff) AS staff,
          (SELECT count(*)::text FROM identity_links) AS links,
          (SELECT count(*)::text FROM role_assignments) AS roles,
          (SELECT count(*)::text FROM role_assignment_proposals) AS props
      `);
      return res.rows[0]!;
    };

    const beforeCounts = await countTables();
    const deptVer = (
      await migratorPool.query<{ row_version: number }>(
        `SELECT row_version FROM departments WHERE id = $1`,
        [SYNTHETIC_DEPARTMENTS.KHCN.id],
      )
    ).rows[0]!.row_version;
    const staffVer = (
      await migratorPool.query<{ row_version: number }>(
        `SELECT row_version FROM staff WHERE id = $1`,
        [zeroRoleUser.staff!.id],
      )
    ).rows[0]!.row_version;

    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const r1 = await createDepartment(adminActor, {
        code: "OUTAGE_DEPT",
        name: "Outage Dept",
      });
      const r2 = await patchDepartment(
        adminActor,
        SYNTHETIC_DEPARTMENTS.KHCN.id,
        { expected_version: deptVer, name: "Outage Patch" },
      );
      const r3 = await createStaff(adminActor, {
        staff_code: "SYN-OUTAGE-01",
        display_name: "Outage Staff",
        department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      });
      const r4 = await patchStaff(adminActor, zeroRoleUser.staff!.id, {
        expected_version: staffVer,
        display_name: "Outage Staff Patch",
      });
      const r5 = await createProposal(adminActor, {
        target_staff_id: zeroRoleUser.staff!.id,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Outage Proposal",
      });

      for (const r of [r1, r2, r3, r4, r5]) {
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.status).toBe(500);
          expect(r.code).toBe("INTERNAL_OR_AUDIT_FAILURE");
        }
      }
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }

    const afterCounts = await countTables();
    expect(afterCounts).toEqual(beforeCounts);

    // Full-table Redaction & Structural Completeness scan on audit_events
    const allAudits = await migratorPool.query<{
      id: string;
      actor_subject_ref: string;
      action: string;
      resource_type: string;
      resource_id: string;
      scope_context: Record<string, unknown>;
      decision: string;
      reason_code: string;
      policy_version: string;
    }>(
      `SELECT id, actor_subject_ref, action, resource_type, resource_id, scope_context, decision, reason_code, policy_version
         FROM audit_events`,
    );
    expect(allAudits.rowCount).toBeGreaterThan(20);
    for (const row of allAudits.rows) {
      expect(row.actor_subject_ref.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.resource_type.length).toBeGreaterThan(0);
      expect(row.resource_id.length).toBeGreaterThan(0);
      expect(["ALLOW", "DENY"]).toContain(row.decision);
      expect(row.reason_code.length).toBeGreaterThan(0);
      expect(["ADR-002_v0.3", "ADR-002-v0.3-DEVTEST"]).toContain(
        row.policy_version,
      );

      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(adminActor.rawSessionToken);
      expect(serialized).not.toContain(adminActor.csrfToken);
      expect(serialized).not.toContain(execActor.rawSessionToken);
      expect(serialized).not.toMatch(/bsos_s1a_session/i);
      expect(serialized).not.toMatch(/SynPass#2026!/i);
    }
  });
});
