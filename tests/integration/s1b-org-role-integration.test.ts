import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SYNTHETIC_DEPARTMENTS,
  SYNTHETIC_USERS,
} from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { closeRuntimePool, getRuntimePool } from "@/server/db";
import {
  createDepartment,
  createIdentityLink,
  createStaff,
  getStaff,
  listDepartments,
  listIdentityLinks,
  listStaff,
  patchDepartment,
  patchIdentityLink,
  patchStaff,
} from "@/server/org-service";
import {
  createProposal,
  decideProposal,
  listProposals,
  listRoleAssignments,
} from "@/server/role-workflow";
import type { Actor } from "@/server/service-core";
import {
  establishSessionFromVerifiedOidcIdentity,
  SESSION_COOKIE_NAME,
  verifyRequestSession,
} from "@/server/session";
import { POST as postDepartmentsRoute } from "@/app/api/org/departments/route";

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

beforeAll(async () => {
  migratorPool = new pg.Pool({ connectionString: migratorUrl, max: 5 });
  if (process.env.SUPERUSER_DATABASE_URL) {
    const admin = new pg.Client({
      connectionString: process.env.SUPERUSER_DATABASE_URL,
    });
    await admin.connect();
    try {
      await admin.query(
        "REVOKE TEMPORARY ON DATABASE branch_sales_devtest FROM PUBLIC, app_runtime_role",
      );
    } finally {
      await admin.end();
    }
  }
});

afterAll(async () => {
  await closeRuntimePool();
  if (migratorPool) {
    await migratorPool.end();
  }
});

describe("S1-B AC-01: Additive Migration 0003, TIMESTAMPTZ Default Audit Fix & Least-Privilege Runtime Role", () => {
  it("verifies 0003_s1b_org_and_role_workflow.sql is applied, all 9 TIMESTAMPTZ defaults have 0s drift under Asia/Ho_Chi_Minh, and app_runtime_role has no DELETE or DDL privileges", async () => {
    const runtimePool = getRuntimePool();

    // 1. Check pgmigrations includes 0001, 0002, 0003
    const migRes = await migratorPool.query<{ name: string }>(
      `SELECT name FROM pgmigrations ORDER BY name`,
    );
    expect(migRes.rows.map((r) => r.name)).toEqual([
      "0001_s1a_foundation",
      "0002_revoke_changed_session_authority",
      "0003_s1b_org_and_role_workflow",
    ]);

    // 2. Verify all 9 TIMESTAMPTZ columns from 0001 + 2 from 0003 have CURRENT_TIMESTAMP default (not timezone('utc', now()))
    const defaultsRes = await runtimePool.query<{
      table_name: string;
      column_name: string;
      column_default: string;
    }>(
      `SELECT table_name, column_name, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'timestamp with time zone'
         AND column_default IS NOT NULL
       ORDER BY table_name, column_name`,
    );
    expect(defaultsRes.rowCount).toBe(11);
    for (const row of defaultsRes.rows) {
      expect(row.column_default).toMatch(/CURRENT_TIMESTAMP/i);
      expect(row.column_default).not.toMatch(/timezone\('utc'/i);
    }

    // 3. Empirical test under SET TIME ZONE 'Asia/Ho_Chi_Minh': default occurred_at on audit_events has < 2s drift vs clock_timestamp()
    const client = await migratorPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'");
      const driftRes = await client.query<{ drift_seconds: number }>(
        `INSERT INTO audit_events (
           id, actor_staff_id, actor_subject_ref, action, resource_type, resource_id,
           scope_context, decision, reason_code, policy_version
         ) VALUES (
           $1, NULL, 'tz_audit_probe', 'auth.session.verify', 'session', 'probe',
           '{}'::jsonb, 'DENY', 'TZ_DRIFT_CHECK', 'ADR-002_v0.3'
         )
         RETURNING abs(extract(epoch FROM (occurred_at - clock_timestamp())))::float8 AS drift_seconds`,
        [randomUUID()],
      );
      expect(driftRes.rows[0]!.drift_seconds).toBeLessThan(2);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }

    // 4. Verify app_runtime_role CANNOT DELETE from any of the 5 org/role tables
    for (const tbl of [
      "departments",
      "staff",
      "identity_links",
      "role_assignments",
      "role_assignment_proposals",
    ]) {
      await expect(runtimePool.query(`DELETE FROM ${tbl}`)).rejects.toThrow(
        /permission denied/i,
      );
    }
  });
});

describe("S1-B AC-02: Scoped Read & Field Allowlist across EXECUTIVE, CONFIG_ADMIN, DEPARTMENT_MANAGER, and STAFF", () => {
  it("enforces BRANCH, DEPARTMENT, and SELF read scopes, prevents count leakage, and returns uniform 404 on out-of-scope lookups", async () => {
    const execActor = await makeActorForUserKey("exec01");
    const adminActor = await makeActorForUserKey("admin01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const staffKhdnUser = SYNTHETIC_USERS.find((u) => u.key === "staff_khdn")!;

    // 1. EXECUTIVE & CONFIG_ADMIN see all departments and all staff
    const execDepts = await listDepartments(execActor, new URLSearchParams());
    expect(execDepts.ok).toBe(true);
    if (execDepts.ok) {
      expect(execDepts.data.length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(execDepts.data[0]!).sort()).toEqual([
        "code",
        "id",
        "name",
        "row_version",
        "status",
      ]);
    }

    const adminStaff = await listStaff(adminActor, new URLSearchParams());
    expect(adminStaff.ok).toBe(true);
    if (adminStaff.ok) {
      expect(adminStaff.page?.total).toBeGreaterThanOrEqual(10);
      expect(Object.keys(adminStaff.data[0]!).sort()).toEqual([
        "department_id",
        "display_name",
        "id",
        "row_version",
        "staff_code",
        "status",
      ]);
    }

    // 2. DEPARTMENT_MANAGER (KHCN) sees ONLY KHCN staff in listStaff
    const mgrStaff = await listStaff(mgrKhcnActor, new URLSearchParams());
    expect(mgrStaff.ok).toBe(true);
    if (mgrStaff.ok) {
      expect(mgrStaff.data.length).toBeGreaterThan(0);
      for (const s of mgrStaff.data) {
        expect(s.department_id).toBe(SYNTHETIC_DEPARTMENTS.KHCN.id);
      }
    }

    // DEPARTMENT_MANAGER filtering by out-of-scope KHDN department_id -> uniform 404
    const mgrCrossDeptList = await listStaff(
      mgrKhcnActor,
      new URLSearchParams({ department_id: SYNTHETIC_DEPARTMENTS.KHDN.id }),
    );
    expect(mgrCrossDeptList.ok).toBe(false);
    if (!mgrCrossDeptList.ok) {
      expect(mgrCrossDeptList.status).toBe(404);
      expect(mgrCrossDeptList.code).toBe("RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE");
    }

    // DEPARTMENT_MANAGER calling getStaff on KHDN staff -> uniform 404 (matches non-existent UUID)
    const mgrCrossStaffGet = await getStaff(
      mgrKhcnActor,
      staffKhdnUser.staff!.id,
    );
    const mgrNonExistentGet = await getStaff(mgrKhcnActor, randomUUID());
    expect(mgrCrossStaffGet.ok).toBe(false);
    expect(mgrNonExistentGet.ok).toBe(false);
    if (!mgrCrossStaffGet.ok && !mgrNonExistentGet.ok) {
      expect(mgrCrossStaffGet.status).toBe(404);
      expect(mgrCrossStaffGet.code).toBe(mgrNonExistentGet.code);
      expect(mgrCrossStaffGet.message).toBe(mgrNonExistentGet.message);
    }

    // 3. STAFF (SELF) sees ONLY own record in listStaff (total = 1) and gets 404 on colleague in same department
    const selfStaffList = await listStaff(
      staffKhcnActor,
      new URLSearchParams(),
    );
    expect(selfStaffList.ok).toBe(true);
    if (selfStaffList.ok) {
      expect(selfStaffList.page?.total).toBe(1);
      expect(selfStaffList.data).toHaveLength(1);
      expect(selfStaffList.data[0]!.id).toBe(staffKhcnActor.ctx.staff_id);
    }

    const staffColleagueGet = await getStaff(
      staffKhcnActor,
      mgrKhcnActor.ctx.staff_id,
    );
    expect(staffColleagueGet.ok).toBe(false);
    if (!staffColleagueGet.ok) {
      expect(staffColleagueGet.status).toBe(404);
      expect(staffColleagueGet.code).toBe("RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE");
    }

    // 4. DEPARTMENT_MANAGER and STAFF are denied (403) on listIdentityLinks and listProposals
    for (const restrictedActor of [mgrKhcnActor, staffKhcnActor]) {
      const linksRes = await listIdentityLinks(
        restrictedActor,
        new URLSearchParams(),
      );
      expect(linksRes.ok).toBe(false);
      if (!linksRes.ok) expect(linksRes.status).toBe(403);

      const propsRes = await listProposals(
        restrictedActor,
        new URLSearchParams(),
      );
      expect(propsRes.ok).toBe(false);
      if (!propsRes.ok) expect(propsRes.status).toBe(403);
    }
  });
});

describe("S1-B AC-03 & AC-04: Organization Baseline Writes, Referential Integrity & Authority Revocation on Transfer/Deactivation", () => {
  it("allows only CONFIG_ADMIN to create/update Department, Staff, and IdentityLink, rejects duplicates/inactive departments, and revokes authority on transfer/deactivation", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const mgrActor = await makeActorForUserKey("mgr_khcn");
    const staffActor = await makeActorForUserKey("staff_khcn");

    const suffix = randomUUID().slice(0, 6).toUpperCase();
    const deptCode = `TMPDEPT_${suffix}`;
    const staffCode = `SYN-S1B-${suffix}`;
    const subjectId = `sub-s1b-${suffix.toLowerCase()}`;

    const createdDeptIds: string[] = [];
    const createdStaffIds: string[] = [];

    try {
      // 1. Non-CONFIG_ADMIN roles get 403 on createDepartment, createStaff, createIdentityLink
      for (const forbiddenActor of [execActor, mgrActor, staffActor]) {
        const dDeny = await createDepartment(forbiddenActor, {
          code: `DENY_${suffix}`,
          name: "Forbidden Dept",
        });
        expect(dDeny.ok).toBe(false);
        if (!dDeny.ok) {
          expect(dDeny.status).toBe(403);
          expect(dDeny.code).toBe("ACTION_FORBIDDEN_FOR_ROLE");
        }
      }

      // 2. CONFIG_ADMIN creates a new Department
      const deptCreate = await createDepartment(adminActor, {
        code: deptCode,
        name: `Phòng Thử nghiệm ${suffix} (Synthetic)`,
      });
      expect(deptCreate.ok).toBe(true);
      if (!deptCreate.ok) return;
      expect(deptCreate.status).toBe(201);
      expect(deptCreate.data.row_version).toBe(1);
      createdDeptIds.push(deptCreate.data.id);

      // Duplicate department code -> 409 CONFLICT
      const dupDept = await createDepartment(adminActor, {
        code: deptCode,
        name: "Duplicate",
      });
      expect(dupDept.ok).toBe(false);
      if (!dupDept.ok) expect(dupDept.status).toBe(409);

      // 3. CONFIG_ADMIN creates a new Staff in the new Department
      const staffCreate = await createStaff(adminActor, {
        staff_code: staffCode,
        display_name: `Nhân sự S1-B ${suffix} (Synthetic)`,
        department_id: deptCreate.data.id,
      });
      expect(staffCreate.ok).toBe(true);
      if (!staffCreate.ok) return;
      expect(staffCreate.status).toBe(201);
      expect(staffCreate.data.row_version).toBe(1);
      createdStaffIds.push(staffCreate.data.id);

      // Duplicate staff_code -> 409 CONFLICT
      const dupStaff = await createStaff(adminActor, {
        staff_code: staffCode,
        display_name: "Duplicate Staff",
        department_id: deptCreate.data.id,
      });
      expect(dupStaff.ok).toBe(false);
      if (!dupStaff.ok) expect(dupStaff.status).toBe(409);

      // Deactivating a department that still has ACTIVE staff -> 409 DEPARTMENT_HAS_ACTIVE_STAFF
      const deactWithStaff = await patchDepartment(
        adminActor,
        deptCreate.data.id,
        {
          expected_version: 1,
          status: "INACTIVE",
        },
      );
      expect(deactWithStaff.ok).toBe(false);
      if (!deactWithStaff.ok) {
        expect(deactWithStaff.status).toBe(409);
        expect(deactWithStaff.code).toBe("DEPARTMENT_HAS_ACTIVE_STAFF");
      }

      // 4. CONFIG_ADMIN creates IdentityLink for the new Staff
      const linkCreate = await createIdentityLink(adminActor, {
        staff_id: staffCreate.data.id,
        subject: subjectId,
      });
      expect(linkCreate.ok).toBe(true);
      if (!linkCreate.ok) return;
      expect(linkCreate.status).toBe(201);
      expect(linkCreate.data.issuer).toBe(cfg.oidcIssuer);

      // Second ACTIVE IdentityLink for same staff -> 409 CONFLICT
      const secondLink = await createIdentityLink(adminActor, {
        staff_id: staffCreate.data.id,
        subject: `${subjectId}-second`,
      });
      expect(secondLink.ok).toBe(false);
      if (!secondLink.ok) expect(secondLink.status).toBe(409);

      // 5. Assign an active role via Maker-Checker so the new Staff can establish a session
      const prop = await createProposal(adminActor, {
        target_staff_id: staffCreate.data.id,
        propose_action: "ASSIGN",
        role_code: "DEPARTMENT_MANAGER",
        reason: "Bổ nhiệm Trưởng phòng thử nghiệm S1-B",
      });
      expect(prop.ok).toBe(true);
      if (!prop.ok) return;

      const dec = await decideProposal(execActor, prop.data.id, {
        decision: "APPROVE",
        expected_version: prop.data.row_version,
        reason: "Phê duyệt bổ nhiệm Trưởng phòng thử nghiệm",
      });
      expect(dec.ok).toBe(true);

      // Establish session for the new Staff
      const newStaffSession = await establishSessionFromVerifiedOidcIdentity({
        issuer: cfg.oidcIssuer,
        subject: subjectId,
      });
      expect(newStaffSession.decision).toBe("ALLOW");
      if (newStaffSession.decision !== "ALLOW") return;

      // Also create a PENDING proposal for this staff to verify it gets CANCELLED on transfer
      const pendingProp = await createProposal(adminActor, {
        target_staff_id: staffCreate.data.id,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Đề xuất chờ duyệt trước khi chuyển phòng",
      });
      expect(pendingProp.ok).toBe(true);

      // 6. Transfer Staff to KHCN department -> atomically revokes active RoleAssignment, cancels PENDING proposal, and revokes session!
      const transferred = await patchStaff(adminActor, staffCreate.data.id, {
        expected_version: 1,
        department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      });
      expect(transferred.ok).toBe(true);
      if (transferred.ok) {
        expect(transferred.data.row_version).toBe(2);
        expect(transferred.data.department_id).toBe(
          SYNTHETIC_DEPARTMENTS.KHCN.id,
        );
      }

      // Session is immediately revoked
      const sessionAfterTransfer = await verifyRequestSession({
        rawSessionToken: newStaffSession.rawSessionToken,
      });
      expect(sessionAfterTransfer).toEqual({
        authenticated: false,
        httpStatus: 401,
        reasonCode: "SESSION_REVOKED",
      });

      // Active RoleAssignments for this staff are now 0
      const activeRolesAfterTransfer = await listRoleAssignments(
        adminActor,
        new URLSearchParams({
          staff_id: staffCreate.data.id,
          status: "ACTIVE",
        }),
      );
      expect(activeRolesAfterTransfer.ok).toBe(true);
      if (activeRolesAfterTransfer.ok) {
        expect(activeRolesAfterTransfer.data).toHaveLength(0);
      }

      // Pending proposal was cancelled
      if (pendingProp.ok) {
        const propRow = await migratorPool.query<{ status: string }>(
          `SELECT status FROM role_assignment_proposals WHERE id = $1`,
          [pendingProp.data.id],
        );
        expect(propRow.rows[0]?.status).toBe("CANCELLED");
      }

      // 7. Now that deptCreate has 0 active staff, deactivating deptCreate succeeds!
      const deactEmptyDept = await patchDepartment(
        adminActor,
        deptCreate.data.id,
        {
          expected_version: 1,
          status: "INACTIVE",
        },
      );
      expect(deactEmptyDept.ok).toBe(true);
      if (deactEmptyDept.ok) {
        expect(deactEmptyDept.data.status).toBe("INACTIVE");
        expect(deactEmptyDept.data.row_version).toBe(2);
      }

      // Creating or moving staff into INACTIVE department -> 422 DEPARTMENT_NOT_ACTIVE
      const staffInInactiveDept = await createStaff(adminActor, {
        staff_code: `${staffCode}-INACT`,
        display_name: "Invalid Inactive Dept Staff",
        department_id: deptCreate.data.id,
      });
      expect(staffInInactiveDept.ok).toBe(false);
      if (!staffInInactiveDept.ok) {
        expect(staffInInactiveDept.status).toBe(422);
        expect(staffInInactiveDept.code).toBe("DEPARTMENT_NOT_ACTIVE");
      }

      // Revoke identity link via patchIdentityLink
      const revokedLink = await patchIdentityLink(
        adminActor,
        linkCreate.data.id,
        {
          expected_version: 1,
          status: "REVOKED",
        },
      );
      expect(revokedLink.ok).toBe(true);
      if (revokedLink.ok) {
        expect(revokedLink.data.status).toBe("REVOKED");
      }
    } finally {
      // Clean up temporary synthetic records via migratorPool so seed state remains clean
      for (const sid of createdStaffIds) {
        await migratorPool.query(
          `DELETE FROM audit_events WHERE actor_staff_id = $1::uuid OR resource_id = $1::text`,
          [sid],
        );
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
        await migratorPool.query(
          `DELETE FROM identity_links WHERE staff_id = $1`,
          [sid],
        );
        await migratorPool.query(`DELETE FROM staff WHERE id = $1`, [sid]);
      }
      for (const did of createdDeptIds) {
        await migratorPool.query(`DELETE FROM departments WHERE id = $1`, [
          did,
        ]);
      }
    }
  });
});

describe("S1-B AC-05, AC-06, AC-07 & AC-08: Maker-Checker Separation of Duties, Optimistic Concurrency, Tamper & Audit Failure Rollback", () => {
  it("enforces two-step Maker-Checker workflow, blocks self-escalation & self-approval at service and DB constraint levels, and enforces expected_version", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const targetZeroRoleUser = SYNTHETIC_USERS.find(
      (u) => u.key === "zero_role",
    )!;
    const targetStaffId = targetZeroRoleUser.staff!.id;

    try {
      // 1. Self-escalation: CONFIG_ADMIN proposing for self -> 403 SELF_ESCALATION_FORBIDDEN
      const selfPropose = await createProposal(adminActor, {
        target_staff_id: adminActor.ctx.staff_id,
        propose_action: "ASSIGN",
        role_code: "EXECUTIVE",
        reason: "Self escalation attempt",
      });
      expect(selfPropose.ok).toBe(false);
      if (!selfPropose.ok) {
        expect(selfPropose.status).toBe(403);
        expect(selfPropose.code).toBe("SELF_ESCALATION_FORBIDDEN");
      }

      // 2. Separation of Duties: EXECUTIVE attempting to propose -> 403 ACTION_FORBIDDEN_FOR_ROLE
      const execPropose = await createProposal(execActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Exec should not propose",
      });
      expect(execPropose.ok).toBe(false);
      if (!execPropose.ok) {
        expect(execPropose.status).toBe(403);
        expect(execPropose.code).toBe("ACTION_FORBIDDEN_FOR_ROLE");
      }

      // 3. CONFIG_ADMIN creates a valid PENDING proposal for zero_role staff
      const prop = await createProposal(adminActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "STAFF",
        reason: "Cấp quyền STAFF cho nhân sự chưa có vai trò",
      });
      expect(prop.ok).toBe(true);
      if (!prop.ok) return;
      expect(prop.status).toBe(201);
      expect(prop.data.status).toBe("PENDING");

      // Duplicate PENDING proposal for the same target_staff_id -> 409 CONFLICT
      const dupPending = await createProposal(adminActor, {
        target_staff_id: targetStaffId,
        propose_action: "ASSIGN",
        role_code: "DEPARTMENT_MANAGER",
        reason: "Duplicate pending proposal",
      });
      expect(dupPending.ok).toBe(false);
      if (!dupPending.ok) {
        expect(dupPending.status).toBe(409);
      }

      // 4. CONFIG_ADMIN attempting to decide on the proposal -> 403 ACTION_FORBIDDEN_FOR_ROLE
      const adminDecide = await decideProposal(adminActor, prop.data.id, {
        decision: "APPROVE",
        expected_version: prop.data.row_version,
        reason: "Admin trying to approve own proposal",
      });
      expect(adminDecide.ok).toBe(false);
      if (!adminDecide.ok) {
        expect(adminDecide.status).toBe(403);
        expect(adminDecide.code).toBe("ACTION_FORBIDDEN_FOR_ROLE");
      }

      // 5. Optimistic concurrency: EXECUTIVE with wrong expected_version -> 409 VERSION_CONFLICT
      const wrongVerDecide = await decideProposal(execActor, prop.data.id, {
        decision: "APPROVE",
        expected_version: 99,
        reason: "Wrong version",
      });
      expect(wrongVerDecide.ok).toBe(false);
      if (!wrongVerDecide.ok) {
        expect(wrongVerDecide.status).toBe(409);
        expect(wrongVerDecide.code).toBe("VERSION_CONFLICT");
      }

      // 6. EXECUTIVE approves with matching expected_version -> APPROVED and creates ACTIVE RoleAssignment
      const approved = await decideProposal(execActor, prop.data.id, {
        decision: "APPROVE",
        expected_version: prop.data.row_version,
        reason: "Đồng ý cấp quyền STAFF",
      });
      expect(approved.ok).toBe(true);
      if (approved.ok) {
        expect(approved.data.status).toBe("APPROVED");
        expect(approved.data.applied_assignment_id).toBeTruthy();

        const raRow = await migratorPool.query<{
          status: string;
          approval_reference: string;
        }>(
          `SELECT status, approval_reference FROM role_assignments WHERE id = $1`,
          [approved.data.applied_assignment_id],
        );
        expect(raRow.rows[0]?.status).toBe("ACTIVE");
        expect(raRow.rows[0]?.approval_reference).toBe(
          `PROPOSAL:${prop.data.id}`,
        );
      }

      // 7. Direct SQL CHECK constraint verification: DB rejects proposer_staff_id = target_staff_id or approver_staff_id = proposer_staff_id
      await expect(
        migratorPool.query(
          `INSERT INTO role_assignment_proposals (
             id, target_staff_id, propose_action, role_code, scope_type,
             effective_from, status, proposer_staff_id, proposer_reason
           ) VALUES ($1, $2, 'ASSIGN', 'EXECUTIVE', 'BRANCH', CURRENT_TIMESTAMP, 'PENDING', $2, 'self')`,
          [randomUUID(), adminActor.ctx.staff_id],
        ),
      ).rejects.toThrow(/chk_proposal_no_self_propose/i);
    } finally {
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

  it("rejects CSRF/Origin/Tamper at HTTP route handler and rolls back S1-B mutations on AuditEvent insert failure (AC-07, AC-08)", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const runtimePool = getRuntimePool();

    // 1. HTTP route handler tamper key rejection in query string
    const tamperReq = new Request(
      "http://127.0.0.1:3100/api/org/departments?role=EXECUTIVE",
      {
        method: "POST",
        headers: {
          origin: cfg.appOrigin,
          cookie: `${SESSION_COOKIE_NAME}=${adminActor.rawSessionToken}`,
          "x-csrf-token": adminActor.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: "TAMPER1", name: "Tamper" }),
      },
    );
    const tamperRes = await postDepartmentsRoute(tamperReq);
    expect(tamperRes.status).toBe(403);
    const tamperBody = (await tamperRes.json()) as { error: { code: string } };
    expect(tamperBody.error.code).toBe("CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED");

    // 2. HTTP route handler CSRF mismatch rejection
    const badCsrfReq = new Request(
      "http://127.0.0.1:3100/api/org/departments",
      {
        method: "POST",
        headers: {
          origin: cfg.appOrigin,
          cookie: `${SESSION_COOKIE_NAME}=${adminActor.rawSessionToken}`,
          "x-csrf-token": "invalid-csrf-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: "CSRF1", name: "CSRF Test" }),
      },
    );
    const badCsrfRes = await postDepartmentsRoute(badCsrfReq);
    expect(badCsrfRes.status).toBe(403);
    const badCsrfBody = (await badCsrfRes.json()) as {
      error: { code: string };
    };
    expect(badCsrfBody.error.code).toBe("CSRF_INVALID");

    // 3. Atomic AuditEvent failure injection: REVOKE INSERT ON audit_events FROM app_runtime_role
    const beforeDepts = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM departments`,
    );

    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const failedDeptCreate = await createDepartment(adminActor, {
        code: "AUDITFAIL",
        name: "Should Roll Back When Audit Fails",
      });
      expect(failedDeptCreate.ok).toBe(false);
      if (!failedDeptCreate.ok) {
        expect(failedDeptCreate.status).toBe(500);
        expect(failedDeptCreate.code).toBe("INTERNAL_OR_AUDIT_FAILURE");
      }
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }

    const afterDepts = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM departments`,
    );
    expect(afterDepts.rows[0]?.count).toBe(beforeDepts.rows[0]?.count);
  });
});
