import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNTHETIC_USERS } from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import {
  evaluateP0Alerts,
  listAlertRules,
  listInAppAlerts,
  markAlertRead,
  patchAlertRule,
  resolveInAppAlert,
} from "@/server/alerts/p0c-alerts-service";
import {
  createLead,
  createOpportunity,
  createProspect,
  listProspects,
  patchProspect,
} from "@/server/pipeline/p0c-pipeline-service";
import type { Actor } from "@/server/service-core";
import {
  establishSessionFromVerifiedOidcIdentity,
  SESSION_COOKIE_NAME,
} from "@/server/session";
import { GET as getAuditEventsRoute } from "@/app/api/audit-events/route";
import {
  PATCH as patchProspectsRoute,
  POST as postProspectsRoute,
} from "@/app/api/pipeline/prospects/route";

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

describe("P0C Integration Tests: Pipeline State Machine & 6-Rule In-App Alert Engine (TASK-0009)", () => {
  const createdProspectIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdOppIds: string[] = [];
  const createdAlertIds: string[] = [];
  const createdActualIds: string[] = [];
  const createdTargetIds: string[] = [];
  const createdDefIds: string[] = [];

  let execActor: Actor;
  let adminActor: Actor;
  let mgrKhcnActor: Actor;
  let staffKhcnActor: Actor;
  let staffKhdnActor: Actor;

  beforeAll(async () => {
    migratorPool = new pg.Pool({ connectionString: migratorUrl });
    execActor = await makeActorForUserKey("exec01");
    adminActor = await makeActorForUserKey("admin01");
    mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    staffKhcnActor = await makeActorForUserKey("staff_khcn");
    staffKhdnActor = await makeActorForUserKey("staff_khdn");
  });

  afterAll(async () => {
    const allEntityIds = [
      ...createdProspectIds,
      ...createdLeadIds,
      ...createdOppIds,
    ];
    if (allEntityIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM pipeline_stage_transitions WHERE entity_id = ANY($1::uuid[])`,
        [allEntityIds],
      );
    }
    if (createdOppIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM opportunities WHERE id = ANY($1::uuid[])`,
        [createdOppIds],
      );
    }
    if (createdLeadIds.length > 0) {
      await migratorPool.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [
        createdLeadIds,
      ]);
    }
    if (createdProspectIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM prospects WHERE id = ANY($1::uuid[])`,
        [createdProspectIds],
      );
    }
    if (createdAlertIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM in_app_alerts WHERE id = ANY($1::uuid[])`,
        [createdAlertIds],
      );
    }
    if (createdActualIds.length > 0) {
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

  it("enforces Prospect/Lead/Opportunity state machine, duplicate ref 409, owner handover history, and CONFIG_ADMIN 403 (AC-01, AC-04)", async () => {
    const suffix = randomUUID().slice(0, 6).toUpperCase();
    const prosRef = `SYN-PROS-${suffix}`;

    const pros = await createProspect(staffKhcnActor, {
      prospect_ref: prosRef,
      display_label: "Synthetic Prospect 01",
      segment_code: "RETAIL",
      owner_staff_id: staffKhcnActor.ctx.staff_id,
    });
    expect(pros.ok).toBe(true);
    if (!pros.ok) return;
    createdProspectIds.push(pros.data.id);

    // Duplicate ref rejected 409
    const dup = await createProspect(staffKhcnActor, {
      prospect_ref: prosRef,
      display_label: "Duplicate",
      segment_code: "RETAIL",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);

    // Invalid jump NEW -> CONVERTED rejected 409
    const badJump = await patchProspect(staffKhcnActor, {
      id: pros.data.id,
      expected_version: pros.data.row_version,
      stage: "CONVERTED",
    });
    expect(badJump.ok).toBe(false);
    if (!badJump.ok) {
      expect(badJump.status).toBe(409);
      expect(badJump.code).toBe("INVALID_STAGE_TRANSITION");
    }

    // Valid transition NEW -> QUALIFIED + handover by EXECUTIVE
    const qualified = await patchProspect(execActor, {
      id: pros.data.id,
      expected_version: pros.data.row_version,
      stage: "QUALIFIED",
      owner_staff_id: mgrKhcnActor.ctx.staff_id,
      transition_note: "Handover to KHCN manager",
    });
    expect(qualified.ok).toBe(true);

    const transRes = await migratorPool.query(
      `SELECT COUNT(*)::int AS cnt FROM pipeline_stage_transitions WHERE entity_id = $1`,
      [pros.data.id],
    );
    expect(Number(transRes.rows[0]?.cnt)).toBe(2);

    // Lead + Opportunity creation (prospect is now owned by mgrKhcnActor after handover)
    const lead = await createLead(mgrKhcnActor, {
      lead_ref: `SYN-LEAD-${suffix}`,
      prospect_id: pros.data.id,
      customer_ref: "SYN-CIF-1001",
      display_label: "Synthetic Lead 01",
      need_group_code: "LOAN",
      due_date: "2026-11-10",
      owner_staff_id: staffKhcnActor.ctx.staff_id,
    });
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    createdLeadIds.push(lead.data.id);

    const opp = await createOpportunity(staffKhcnActor, {
      opportunity_ref: `SYN-OPP-${suffix}`,
      lead_id: lead.data.id,
      customer_ref: "SYN-CIF-1001",
      display_label: "Synthetic Opportunity 01",
      kpi_group_code: "LOAN",
      estimated_value: 250000000,
      expected_close_date: "2026-11-18",
    });
    expect(opp.ok).toBe(true);
    if (opp.ok) createdOppIds.push(opp.data.id);

    // CONFIG_ADMIN receives 403 on pipeline
    const adminPros = await listProspects(
      adminActor,
      new URL(`${cfg.appOrigin}/api/pipeline/prospects`),
    );
    expect(adminPros.ok).toBe(false);
    if (!adminPros.ok) expect(adminPros.status).toBe(403);

    // STAFF KHDN cannot see STAFF KHCN's prospect
    const khdnList = await listProspects(
      staffKhdnActor,
      new URL(`${cfg.appOrigin}/api/pipeline/prospects`),
    );
    expect(khdnList.ok).toBe(true);
    if (khdnList.ok) {
      expect(khdnList.data.some((p) => p.id === pros.data.id)).toBe(false);
    }
  });

  it("evaluates 6 P0 alerts with dedup_key, ignores NULL MISSING_DATA KPIs, separates read_at from resolution_status, and isolates CONFIG_ADMIN (AC-02, AC-03, AC-04)", async () => {
    // CONFIG_ADMIN can read/update alert_rule_configs but receives 403 on business alerts
    const rulesRes = await listAlertRules(
      adminActor,
      new URL(`${cfg.appOrigin}/api/alerts/rules`),
    );
    expect(rulesRes.ok).toBe(true);
    if (!rulesRes.ok) return;
    expect(rulesRes.data.length).toBe(6);

    const firstRule = rulesRes.data[0]!;
    const patchedRule = await patchAlertRule(adminActor, {
      id: firstRule.id,
      expected_version: firstRule.row_version,
      threshold_value: firstRule.threshold_value,
    });
    expect(patchedRule.ok).toBe(true);

    const adminAlerts = await listInAppAlerts(
      adminActor,
      new URL(`${cfg.appOrigin}/api/alerts`),
    );
    expect(adminAlerts.ok).toBe(false);
    if (!adminAlerts.ok) expect(adminAlerts.status).toBe(403);

    // Seed 1 NULL actual KPI (must NOT trigger KPI_BEHIND_PACE) and 1 overdue Lead
    const defId = randomUUID();
    const tgtId = randomUUID();
    const actId = randomUUID();
    createdDefIds.push(defId);
    createdTargetIds.push(tgtId);
    createdActualIds.push(actId);
    const suffix = defId.slice(0, 6).toUpperCase();

    await migratorPool.query(
      `INSERT INTO kpi_definitions (
         id, metric_code, metric_name, group_code, unit_code, currency_code,
         metric_type, time_aggregation_rule, staff_aggregation_rule,
         attribution_mode, primary_weight, referrer_weight,
         formula_expression, source_system_code, cutoff_rule, version, status,
         effective_from, approval_reference, created_by_staff_id
       ) VALUES ($1, $2, 'Alert Null Test', 'LOAN', 'VND', 'VND', 'FLOW', 'SUM', 'SUM', 'PRIMARY_ONLY', 1.0000, 0.0000, 'sum', 'SYN_CORE', 'EOD_18_00_ICT', 1, 'ACTIVE', CURRENT_TIMESTAMP, 'SYN-REF-09', $3)`,
      [defId, `SYN_ALN_${suffix}`, adminActor.ctx.staff_id],
    );
    await migratorPool.query(
      `INSERT INTO kpi_targets (
         id, kpi_definition_id, period_type, period_key, scope_type,
         department_id, staff_id, target_value, status, revision_no,
         proposed_by_staff_id, approved_by_staff_id, approved_at, approval_reference
       ) VALUES ($1, $2, 'MONTH', '2026-11', 'SELF', $3, $4, 1000.00, 'APPROVED', 1, $5, $6, CURRENT_TIMESTAMP, 'SYN-TGT-09')`,
      [
        tgtId,
        defId,
        staffKhcnActor.ctx.department.id,
        staffKhcnActor.ctx.staff_id,
        mgrKhcnActor.ctx.staff_id,
        execActor.ctx.staff_id,
      ],
    );
    await migratorPool.query(
      `INSERT INTO kpi_actual_records (
         id, kpi_definition_id, period_type, period_key, as_of_date,
         department_id, primary_staff_id, actual_value, reconciliation_status,
         source_code, recorded_by_staff_id
       ) VALUES ($1, $2, 'MONTH', '2026-11', '2026-11-12', $3, $4, NULL, 'PROVISIONAL', 'SYNTHETIC_DEVTEST', $4)`,
      [
        actId,
        defId,
        staffKhcnActor.ctx.department.id,
        staffKhcnActor.ctx.staff_id,
      ],
    );

    const overdueLead = await createLead(staffKhcnActor, {
      lead_ref: `SYN-OVD-${suffix}`,
      display_label: "Overdue Lead Alert Test",
      need_group_code: "DEPOSIT",
      due_date: "2026-11-01",
    });
    expect(overdueLead.ok).toBe(true);
    if (overdueLead.ok) createdLeadIds.push(overdueLead.data.id);

    // Run evaluation twice -> second run must NOT duplicate alerts (dedup_key)
    const eval1 = await evaluateP0Alerts(staffKhcnActor, {
      as_of_date: "2026-11-14",
      period_key: "2026-11",
    });
    expect(eval1.ok).toBe(true);
    if (!eval1.ok) return;
    for (const a of eval1.data.alerts) createdAlertIds.push(a.id);

    // Verify NULL actual did NOT trigger KPI_BEHIND_PACE
    expect(
      eval1.data.alerts.some(
        (a) => a.rule_code === "KPI_BEHIND_PACE" && a.dedup_key.includes(defId),
      ),
    ).toBe(false);

    // Overdue lead alert MUST exist
    const leadAlert = eval1.data.alerts.find(
      (a) =>
        a.rule_code === "OVERDUE_PIPELINE_FOLLOWUP" &&
        overdueLead.ok &&
        a.dedup_key.includes(overdueLead.data.id),
    );
    expect(leadAlert).toBeDefined();

    // Re-run evaluation -> created_count must be 0 (dedup_key)
    const eval2 = await evaluateP0Alerts(staffKhcnActor, {
      as_of_date: "2026-11-14",
      period_key: "2026-11",
    });
    expect(eval2.ok).toBe(true);
    if (eval2.ok) expect(eval2.data.created_count).toBe(0);

    if (leadAlert) {
      // Mark read -> read_at set, resolution_status stays OPEN
      const readRes = await markAlertRead(staffKhcnActor, leadAlert.id, {
        expected_version: leadAlert.row_version,
      });
      expect(readRes.ok).toBe(true);
      if (!readRes.ok) return;
      expect(readRes.data.read_at).not.toBeNull();
      expect(readRes.data.resolution_status).toBe("OPEN");

      // Resolve without evidence -> 400
      const noEv = await resolveInAppAlert(staffKhcnActor, leadAlert.id, {
        expected_version: readRes.data.row_version,
        resolution_status: "RESOLVED",
      });
      expect(noEv.ok).toBe(false);
      if (!noEv.ok) expect(noEv.status).toBe(400);

      // Resolve with evidence -> RESOLVED
      const resolved = await resolveInAppAlert(staffKhcnActor, leadAlert.id, {
        expected_version: readRes.data.row_version,
        resolution_status: "RESOLVED",
        resolution_evidence_ref: "SYN-CALL-LOG-09",
        resolution_note: "Called synthetic prospect",
      });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.data.resolution_status).toBe("RESOLVED");
    }
  });

  it("enforces parent prospect/lead scope (L-02), 409 VERSION_CONFLICT, 403 CSRF/Origin, and atomic AuditEvent rollback (L-03)", async () => {
    const staffKhdn = await makeActorForUserKey("staff_khdn");
    const mgrKhcn = await makeActorForUserKey("mgr_khcn");

    // 1. staff_khdn creates a prospect & lead in KHDN
    const khdnPros = await createProspect(staffKhdn, {
      prospect_ref: `SYN-L02-PROS-${randomUUID().slice(0, 6).toUpperCase()}`,
      display_label: "L02 KHDN Prospect",
      segment_code: "SME",
    });
    expect(khdnPros.ok).toBe(true);
    if (!khdnPros.ok) return;
    createdProspectIds.push(khdnPros.data.id);

    const khdnLead = await createLead(staffKhdn, {
      lead_ref: `SYN-L02-LEAD-${randomUUID().slice(0, 6).toUpperCase()}`,
      prospect_id: khdnPros.data.id,
      display_label: "L02 KHDN Lead",
      need_group_code: "LOAN",
    });
    expect(khdnLead.ok).toBe(true);
    if (!khdnLead.ok) return;
    createdLeadIds.push(khdnLead.data.id);

    // L-02: staff_khcn & mgr_khcn cannot link parent prospect_id / lead_id from KHDN -> 404
    const crossLead = await createLead(staffKhcnActor, {
      lead_ref: `SYN-L02-XLEAD-${randomUUID().slice(0, 6).toUpperCase()}`,
      prospect_id: khdnPros.data.id,
      display_label: "Cross-dept Lead",
      need_group_code: "LOAN",
    });
    expect(crossLead.ok).toBe(false);
    if (!crossLead.ok) expect(crossLead.status).toBe(404);

    const crossOpp = await createOpportunity(mgrKhcn, {
      opportunity_ref: `SYN-L02-XOPP-${randomUUID().slice(0, 6).toUpperCase()}`,
      lead_id: khdnLead.data.id,
      customer_ref: "SYN-CIF-2001",
      display_label: "Cross-dept Opp",
      kpi_group_code: "LOAN",
      estimated_value: 1000,
      expected_close_date: "2026-11-25",
    });
    expect(crossOpp.ok).toBe(false);
    if (!crossOpp.ok) expect(crossOpp.status).toBe(404);

    // Verify DENY audit_events recorded for cross-scope parent prospect/lead
    const denyParentAudits = await migratorPool.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM audit_events
       WHERE action = 'pipeline.write'
         AND decision = 'DENY'
         AND resource_id IN ($1, $2)`,
      [khdnPros.data.id, khdnLead.data.id],
    );
    expect(Number(denyParentAudits.rows[0]!.c)).toBeGreaterThanOrEqual(2);

    // L-03a: 409 VERSION_CONFLICT on stale expected_version
    const conflictPatch = await patchProspect(staffKhdn, {
      id: khdnPros.data.id,
      expected_version: khdnPros.data.row_version + 99,
      stage: "QUALIFIED",
    });
    expect(conflictPatch.ok).toBe(false);
    if (!conflictPatch.ok) {
      expect(conflictPatch.status).toBe(409);
      expect(conflictPatch.code).toBe("VERSION_CONFLICT");
    }

    // L-03b: 403 on bad CSRF token and bad Origin header via route handler
    const badCsrfReq = new NextRequest(
      `${cfg.appOrigin}/api/pipeline/prospects`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: cfg.appOrigin,
          Cookie: `${SESSION_COOKIE_NAME}=${staffKhdn.rawSessionToken}`,
          "x-csrf-token": "invalid-csrf-token",
        },
        body: JSON.stringify({
          prospect_ref: `SYN-L03-CSRF-${randomUUID().slice(0, 6).toUpperCase()}`,
          display_label: "CSRF Test",
          segment_code: "SME",
        }),
      },
    );
    const badCsrfRes = await postProspectsRoute(badCsrfReq);
    expect(badCsrfRes.status).toBe(403);

    const badOriginReq = new NextRequest(
      `${cfg.appOrigin}/api/pipeline/prospects`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example.com",
          Cookie: `${SESSION_COOKIE_NAME}=${staffKhdn.rawSessionToken}`,
          "x-csrf-token": staffKhdn.csrfToken,
        },
        body: JSON.stringify({
          id: khdnPros.data.id,
          expected_version: khdnPros.data.row_version,
          stage: "QUALIFIED",
        }),
      },
    );
    const badOriginRes = await patchProspectsRoute(badOriginReq);
    expect(badOriginRes.status).toBe(403);

    // L-03c: Atomic AuditEvent rollback when INSERT on audit_events fails
    const beforeCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM prospects`,
        )
      ).rows[0]!.c,
    );
    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const outageReq = new NextRequest(
        `${cfg.appOrigin}/api/pipeline/prospects`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: cfg.appOrigin,
            Cookie: `${SESSION_COOKIE_NAME}=${staffKhdn.rawSessionToken}`,
            "x-csrf-token": staffKhdn.csrfToken,
          },
          body: JSON.stringify({
            prospect_ref: `SYN-L03-OUTAGE-${randomUUID().slice(0, 6).toUpperCase()}`,
            display_label: "Outage Rollback Test",
            segment_code: "SME",
          }),
        },
      );
      const outageRes = await postProspectsRoute(outageReq);
      expect(outageRes.status).toBe(500);
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }
    const afterCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM prospects`,
        )
      ).rows[0]!.c,
    );
    expect(afterCount).toBe(beforeCount);
  });

  it("escalates overdue OPEN alerts to active DEPARTMENT_MANAGER/EXECUTIVE and logs alerts.escalate audit (M-05)", async () => {
    const execActor = await makeActorForUserKey("exec01");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");

    const alertId = randomUUID();
    const dedupKey = `M05-ESC-${randomUUID().slice(0, 8)}`;
    await migratorPool.query(
      `INSERT INTO in_app_alerts (
         id, rule_code, dedup_key, severity, target_scope,
         department_id, owner_staff_id, title, summary,
         created_at, resolution_status
       ) VALUES (
         $1, 'OVERDUE_PIPELINE_FOLLOWUP', $4, 'P0', 'SELF',
         $2, $3, 'M05 Test Overdue Alert', 'Should escalate after SLA',
         TIMESTAMPTZ '2026-11-01 00:00:00+00', 'OPEN'
       )`,
      [
        alertId,
        staffKhcnActor.ctx.department.id,
        staffKhcnActor.ctx.staff_id,
        dedupKey,
      ],
    );
    createdAlertIds.push(alertId);

    const evalRes = await evaluateP0Alerts(execActor, {
      as_of_date: "2026-11-14",
      period_key: "2026-11",
    });
    expect(evalRes.ok).toBe(true);
    if (!evalRes.ok) return;
    expect(evalRes.data.escalated_count).toBeGreaterThanOrEqual(1);

    const updated = await migratorPool.query<{
      escalated_to_staff_id: string | null;
    }>(`SELECT escalated_to_staff_id FROM in_app_alerts WHERE id = $1`, [
      alertId,
    ]);
    expect(updated.rows[0]?.escalated_to_staff_id).toBe(
      mgrKhcnActor.ctx.staff_id,
    );

    const escAudit = await migratorPool.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM audit_events
       WHERE action = 'alerts.escalate'
         AND decision = 'ALLOW'
         AND resource_id = $1`,
      [alertId],
    );
    expect(Number(escAudit.rows[0]!.c)).toBe(1);
  });

  it("enforces read-only audit_events access control on GET /api/audit-events (M-06)", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const execActor = await makeActorForUserKey("exec01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");

    for (const allowedActor of [adminActor, execActor]) {
      const req = new NextRequest(
        `${cfg.appOrigin}/api/audit-events?limit=10`,
        {
          method: "GET",
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${allowedActor.rawSessionToken}`,
          },
        },
      );
      const res = await getAuditEventsRoute(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { items: unknown[]; privilege_restricted: boolean };
        page: { limit: number; offset: number; total: number };
      };
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(body.data.privilege_restricted).toBe(true);
    }

    for (const forbiddenActor of [mgrKhcnActor, staffKhcnActor]) {
      const req = new NextRequest(
        `${cfg.appOrigin}/api/audit-events?limit=10`,
        {
          method: "GET",
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${forbiddenActor.rawSessionToken}`,
          },
        },
      );
      const res = await getAuditEventsRoute(req);
      expect(res.status).toBe(403);
    }

    // Tamper query param -> 403
    const tamperReq = new NextRequest(
      `${cfg.appOrigin}/api/audit-events?actor_staff_id=00000000-0000-4000-8000-000000000001`,
      {
        method: "GET",
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${execActor.rawSessionToken}`,
        },
      },
    );
    const tamperRes = await getAuditEventsRoute(tamperReq);
    expect(tamperRes.status).toBe(403);
  });
});
