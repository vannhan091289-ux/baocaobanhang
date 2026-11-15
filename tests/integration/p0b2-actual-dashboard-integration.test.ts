import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNTHETIC_USERS } from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import {
  createKpiActual,
  getDashboardOverview,
  listKpiActuals,
  patchKpiActual,
  reconcileKpiActual,
} from "@/server/kpi/p0b2-service";
import type { Actor } from "@/server/service-core";
import { establishSessionFromVerifiedOidcIdentity } from "@/server/session";

ensureDevtestEnvLoaded();
const cfg = getRuntimeConfig();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;

let migratorPool: pg.Pool;

async function makeActorForUserKey(key: string): Promise<Actor> {
  const userDef = SYNTHETIC_USERS.find((u) => u.key === key)!;
  const linkRes = await migratorPool.query<{
    issuer: string;
    subject: string;
  }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
    userDef.staff!.id,
  ]);
  const link = linkRes.rows[0]!;
  const session = await establishSessionFromVerifiedOidcIdentity({
    issuer: link.issuer,
    subject: link.subject,
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

describe("P0B-2 Integration Tests: KPI Actuals, Reconciliation & Dashboard (TASK-0008)", () => {
  const createdActualIds: string[] = [];
  const createdDefIds: string[] = [];
  const createdTargetIds: string[] = [];

  let execActor: Actor;
  let adminActor: Actor;
  let mgrKhcnActor: Actor;
  let staffKhcnActor: Actor;
  let staffKhdnActor: Actor;

  let stockDefId: string;
  let crossSellFlowDefId: string;
  let missingDefId: string;

  beforeAll(async () => {
    migratorPool = new pg.Pool({ connectionString: migratorUrl });
    execActor = await makeActorForUserKey("exec01");
    adminActor = await makeActorForUserKey("admin01");
    mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    staffKhcnActor = await makeActorForUserKey("staff_khcn");
    staffKhdnActor = await makeActorForUserKey("staff_khdn");

    stockDefId = randomUUID();
    crossSellFlowDefId = randomUUID();
    missingDefId = randomUUID();
    createdDefIds.push(stockDefId, crossSellFlowDefId, missingDefId);

    const suffix = stockDefId.slice(0, 6).toUpperCase();
    await migratorPool.query(
      `INSERT INTO kpi_definitions (
         id, metric_code, metric_name, group_code, unit_code, currency_code,
         metric_type, time_aggregation_rule, staff_aggregation_rule,
         attribution_mode, primary_weight, referrer_weight,
         formula_expression, source_system_code, cutoff_rule, version, status,
         effective_from, approval_reference, created_by_staff_id
       ) VALUES
       ($1, $4, 'Test Stock Loan', 'LOAN', 'VND', 'VND', 'STOCK', 'END_OF_PERIOD', 'SUM', 'PRIMARY_ONLY', 1.0000, 0.0000, 'balance', 'SYN_CORE', 'EOD_18_00_ICT', 1, 'ACTIVE', CURRENT_TIMESTAMP, 'SYN-REF-08', $7),
       ($2, $5, 'Test CrossSell Card', 'CARD', 'CARD', NULL, 'FLOW', 'SUM', 'WEIGHTED_ATTRIBUTION', 'PRIMARY_AND_REFERRER', 0.7000, 0.3000, 'count', 'SYN_CARD', 'EOD_18_00_ICT', 1, 'ACTIVE', CURRENT_TIMESTAMP, 'SYN-REF-08', $7),
       ($3, $6, 'Test Missing Deposit', 'DEPOSIT', 'VND', 'VND', 'FLOW', 'SUM', 'SUM', 'PRIMARY_ONLY', 1.0000, 0.0000, 'net_flow', 'SYN_CORE', 'EOD_18_00_ICT', 1, 'ACTIVE', CURRENT_TIMESTAMP, 'SYN-REF-08', $7)`,
      [
        stockDefId,
        crossSellFlowDefId,
        missingDefId,
        `SYN_STK_${suffix}`,
        `SYN_CSL_${suffix}`,
        `SYN_MIS_${suffix}`,
        adminActor.ctx.staff_id,
      ],
    );

    for (const defId of [stockDefId, crossSellFlowDefId, missingDefId]) {
      const tid = randomUUID();
      createdTargetIds.push(tid);
      await migratorPool.query(
        `INSERT INTO kpi_targets (
           id, kpi_definition_id, period_type, period_key, scope_type,
           target_value, status, revision_no, proposed_by_staff_id, approved_by_staff_id,
           approved_at, approval_reference
         ) VALUES ($1, $2, 'MONTH', '2026-11', 'BRANCH', 1000.00, 'APPROVED', 1, $3, $4, CURRENT_TIMESTAMP, 'SYN-TGT-08')`,
        [tid, defId, mgrKhcnActor.ctx.staff_id, execActor.ctx.staff_id],
      );
    }
  });

  afterAll(async () => {
    if (createdActualIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM kpi_actual_adjustments WHERE actual_record_id = ANY($1::uuid[])`,
        [createdActualIds],
      );
      await migratorPool.query(
        `DELETE FROM kpi_actual_records WHERE id = ANY($1::uuid[])`,
        [createdActualIds],
      );
    }
    if (createdTargetIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM kpi_targets WHERE id = ANY($1::uuid[])`,
        [createdTargetIds],
      );
    }
    if (createdDefIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM kpi_definitions WHERE id = ANY($1::uuid[])`,
        [createdDefIds],
      );
    }
    await migratorPool.end();
    await closeRuntimePool();
  });

  it("enforces PROVISIONAL -> RECONCILED -> FINAL lifecycle, 409 on direct FINAL edit, and maker-checker ADJUST_FINAL (AC-03)", async () => {
    const created = await createKpiActual(staffKhcnActor, {
      kpi_definition_id: stockDefId,
      period_type: "MONTH",
      period_key: "2026-11",
      as_of_date: "2026-11-10",
      primary_staff_id: staffKhcnActor.ctx.staff_id,
      actual_value: 400,
      source_ref: "SYN-DAY10",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdActualIds.push(created.data.id);
    expect(created.data.reconciliation_status).toBe("PROVISIONAL");

    const staffReconcile = await reconcileKpiActual(
      staffKhcnActor,
      created.data.id,
      {
        reconcile_action: "RECONCILE",
        expected_version: created.data.row_version,
      },
    );
    expect(staffReconcile.ok).toBe(false);
    if (!staffReconcile.ok) expect(staffReconcile.status).toBe(403);

    const reconciled = await reconcileKpiActual(mgrKhcnActor, created.data.id, {
      reconcile_action: "RECONCILE",
      expected_version: created.data.row_version,
      actual_value: 450,
    });
    expect(reconciled.ok).toBe(true);
    if (!reconciled.ok) return;
    expect(reconciled.data.reconciliation_status).toBe("RECONCILED");
    expect(reconciled.data.actual_value).toBe(450);

    const finalized = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "FINALIZE",
      expected_version: reconciled.data.row_version,
    });
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(finalized.data.reconciliation_status).toBe("FINAL");

    const directPatch = await patchKpiActual(execActor, {
      id: created.data.id,
      expected_version: finalized.data.row_version,
      actual_value: 999,
    });
    expect(directPatch.ok).toBe(false);
    if (!directPatch.ok) {
      expect(directPatch.status).toBe(409);
      expect(directPatch.code).toBe("FINAL_RECORD_REQUIRES_ADJUSTMENT");
    }

    const selfAdjust = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "ADJUST_FINAL",
      expected_version: finalized.data.row_version,
      actual_value: 500,
      adjustment_reason: "Self approve test",
      approved_by_staff_id: execActor.ctx.staff_id,
    });
    expect(selfAdjust.ok).toBe(false);
    if (!selfAdjust.ok) expect(selfAdjust.status).toBe(403);

    const adjusted = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "ADJUST_FINAL",
      expected_version: finalized.data.row_version,
      actual_value: 500,
      adjustment_reason: "Synthetic post-cutoff correction",
      approved_by_staff_id: mgrKhcnActor.ctx.staff_id,
    });
    expect(adjusted.ok).toBe(true);
    if (!adjusted.ok) return;
    expect(adjusted.data.actual_value).toBe(500);
    expect(adjusted.data.adjustments_count).toBe(1);
  });

  it("enforces STOCK non-summing, MISSING_DATA null preservation, D-02 cross-sell no double counting, D-07 7 groups, and RBAC scopes (AC-01, AC-02, AC-04, AC-05)", async () => {
    const stockDay2 = await createKpiActual(execActor, {
      kpi_definition_id: stockDefId,
      period_type: "MONTH",
      period_key: "2026-11",
      as_of_date: "2026-11-12",
      primary_staff_id: staffKhcnActor.ctx.staff_id,
      actual_value: 750,
    });
    expect(stockDay2.ok).toBe(true);
    if (stockDay2.ok) createdActualIds.push(stockDay2.data.id);

    const crossSell = await createKpiActual(execActor, {
      kpi_definition_id: crossSellFlowDefId,
      period_type: "MONTH",
      period_key: "2026-11",
      as_of_date: "2026-11-12",
      primary_staff_id: staffKhcnActor.ctx.staff_id,
      referrer_staff_id: staffKhdnActor.ctx.staff_id,
      actual_value: 200,
    });
    expect(crossSell.ok).toBe(true);
    if (crossSell.ok) createdActualIds.push(crossSell.data.id);

    const missingRec = await createKpiActual(execActor, {
      kpi_definition_id: missingDefId,
      period_type: "MONTH",
      period_key: "2026-11",
      as_of_date: "2026-11-12",
      primary_staff_id: staffKhcnActor.ctx.staff_id,
      actual_value: null,
    });
    expect(missingRec.ok).toBe(true);
    if (missingRec.ok) createdActualIds.push(missingRec.data.id);

    const adminDash = await getDashboardOverview(
      adminActor,
      new URL(
        `${cfg.appOrigin}/api/dashboard/overview?period_type=MONTH&period_key=2026-11&as_of_date=2026-11-14`,
      ),
    );
    expect(adminDash.ok).toBe(false);
    if (!adminDash.ok) expect(adminDash.status).toBe(403);

    const adminList = await listKpiActuals(
      adminActor,
      new URL(`${cfg.appOrigin}/api/kpi/actuals`),
    );
    expect(adminList.ok).toBe(false);
    if (!adminList.ok) expect(adminList.status).toBe(403);

    const execDash = await getDashboardOverview(
      execActor,
      new URL(
        `${cfg.appOrigin}/api/dashboard/overview?period_type=MONTH&period_key=2026-11&as_of_date=2026-11-14`,
      ),
    );
    expect(execDash.ok).toBe(true);
    if (!execDash.ok) return;
    expect(execDash.data.no_composite_score).toBe(true);
    expect(execDash.data.groups).toHaveLength(7);

    const allMetrics = execDash.data.groups.flatMap((g) => g.metrics);
    const stkMetric = allMetrics.find(
      (m) => m.kpi_definition_id === stockDefId,
    );
    const cslMetric = allMetrics.find(
      (m) => m.kpi_definition_id === crossSellFlowDefId,
    );
    const misMetric = allMetrics.find(
      (m) => m.kpi_definition_id === missingDefId,
    );

    expect(stkMetric?.actual_value).toBe(750);
    expect(stkMetric?.completion_pct).toBe(75);
    expect(cslMetric?.actual_value).toBe(200);
    expect(misMetric?.data_status).toBe("MISSING_DATA");
    expect(misMetric?.actual_value).toBeNull();
    expect(misMetric?.gap).toBeNull();
    expect(misMetric?.completion_pct).toBeNull();

    const khdnDash = await getDashboardOverview(
      staffKhdnActor,
      new URL(
        `${cfg.appOrigin}/api/dashboard/overview?period_type=MONTH&period_key=2026-11&as_of_date=2026-11-14`,
      ),
    );
    expect(khdnDash.ok).toBe(true);
    if (!khdnDash.ok) return;
    expect(khdnDash.data.drilldown_departments).toHaveLength(0);
    expect(khdnDash.data.drilldown_staff).toHaveLength(1);
    const khdnCsl = khdnDash.data.groups
      .flatMap((g) => g.metrics)
      .find((m) => m.kpi_definition_id === crossSellFlowDefId);
    expect(khdnCsl?.actual_value).toBe(60);

    const mgrCrossDept = await getDashboardOverview(
      mgrKhcnActor,
      new URL(
        `${cfg.appOrigin}/api/dashboard/overview?department_id=${staffKhdnActor.ctx.department.id}`,
      ),
    );
    expect(mgrCrossDept.ok).toBe(false);
    if (!mgrCrossDept.ok) expect(mgrCrossDept.status).toBe(404);
  });

  it("enforces ACTIVE, effective window, and same-department checks on ADJUST_FINAL approver (H-02)", async () => {
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const mgrKhdnActor = await makeActorForUserKey("mgr_khdn");
    const execActor = await makeActorForUserKey("exec01");

    // Create, reconcile, and finalize a KHCN actual record
    const created = await createKpiActual(staffKhcnActor, {
      kpi_definition_id: "55555555-5555-4555-8555-555555555501",
      period_type: "MONTH",
      period_key: "2026-10",
      as_of_date: "2026-10-31",
      primary_staff_id: staffKhcnActor.ctx.staff_id,
      actual_value: 150,
      source_code: "SYNTHETIC_DEVTEST",
      source_ref: "SYN-H02-001",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdActualIds.push(created.data.id);

    const rec = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "RECONCILE",
      expected_version: created.data.row_version,
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;

    const fin = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "FINALIZE",
      expected_version: rec.data.row_version,
    });
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;

    // 1. Different-department DEPARTMENT_MANAGER (mgr_khdn) -> 403 INVALID_ADJUSTMENT_APPROVER
    const crossDeptAdj = await reconcileKpiActual(execActor, created.data.id, {
      reconcile_action: "ADJUST_FINAL",
      actual_value: 155,
      approved_by_staff_id: mgrKhdnActor.ctx.staff_id,
      adjustment_reason: "Cross-dept manager should be rejected",
      expected_version: fin.data.row_version,
    });
    expect(crossDeptAdj.ok).toBe(false);
    if (!crossDeptAdj.ok) {
      expect(crossDeptAdj.status).toBe(403);
      expect(crossDeptAdj.code).toBe("INVALID_ADJUSTMENT_APPROVER");
    }

    // 2. Temporary synthetic staff with REVOKED, future-effective, and expired roles -> all rejected
    const tempStaffId = randomUUID();
    const khcnDeptId = mgrKhcnActor.ctx.department.id;
    await migratorPool.query(
      `INSERT INTO staff (id, staff_code, display_name, department_id, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [tempStaffId, `SYN_H02_${tempStaffId.slice(0, 6).toUpperCase()}`, "H02 Temp Approver", khcnDeptId],
    );

    const roleId = randomUUID();
    try {
      // 2a. REVOKED role (even with effective_to IS NULL)
      await migratorPool.query(
        `INSERT INTO role_assignments (id, staff_id, role_code, scope_type, scope_department_id, effective_from, effective_to, status, approval_reference)
         VALUES ($1, $2, 'DEPARTMENT_MANAGER', 'DEPARTMENT', $3, CURRENT_TIMESTAMP - interval '1 day', NULL, 'REVOKED', 'SYN-H02-REF')`,
        [roleId, tempStaffId, khcnDeptId],
      );
      const revokedAdj = await reconcileKpiActual(execActor, created.data.id, {
        reconcile_action: "ADJUST_FINAL",
        actual_value: 156,
        approved_by_staff_id: tempStaffId,
        adjustment_reason: "Revoked role must be rejected",
        expected_version: fin.data.row_version,
      });
      expect(revokedAdj.ok).toBe(false);
      if (!revokedAdj.ok) expect(revokedAdj.status).toBe(404);

      // 2b. Future effective_from
      await migratorPool.query(
        `UPDATE role_assignments
         SET status = 'ACTIVE', effective_from = CURRENT_TIMESTAMP + interval '1 day', effective_to = NULL
         WHERE id = $1`,
        [roleId],
      );
      const futureAdj = await reconcileKpiActual(execActor, created.data.id, {
        reconcile_action: "ADJUST_FINAL",
        actual_value: 157,
        approved_by_staff_id: tempStaffId,
        adjustment_reason: "Future role must be rejected",
        expected_version: fin.data.row_version,
      });
      expect(futureAdj.ok).toBe(false);
      if (!futureAdj.ok) expect(futureAdj.status).toBe(404);

      // 2c. Expired effective_to
      await migratorPool.query(
        `UPDATE role_assignments
         SET status = 'ACTIVE', effective_from = CURRENT_TIMESTAMP - interval '2 days', effective_to = CURRENT_TIMESTAMP - interval '1 hour'
         WHERE id = $1`,
        [roleId],
      );
      const expiredAdj = await reconcileKpiActual(execActor, created.data.id, {
        reconcile_action: "ADJUST_FINAL",
        actual_value: 158,
        approved_by_staff_id: tempStaffId,
        adjustment_reason: "Expired role must be rejected",
        expected_version: fin.data.row_version,
      });
      expect(expiredAdj.ok).toBe(false);
      if (!expiredAdj.ok) expect(expiredAdj.status).toBe(404);

      // 3. Valid same-department ACTIVE approver (mgr_khcn) -> 200 OK
      const validAdj = await reconcileKpiActual(execActor, created.data.id, {
        reconcile_action: "ADJUST_FINAL",
        actual_value: 160,
        approved_by_staff_id: mgrKhcnActor.ctx.staff_id,
        adjustment_reason: "Valid active same-dept manager approval",
        expected_version: fin.data.row_version,
      });
      expect(validAdj.ok).toBe(true);
      if (validAdj.ok) expect(validAdj.data.actual_value).toBe(160);
    } finally {
      await migratorPool.query(`DELETE FROM role_assignments WHERE id = $1`, [roleId]);
      await migratorPool.query(`DELETE FROM staff WHERE id = $1`, [tempStaffId]);
    }
  });
});
