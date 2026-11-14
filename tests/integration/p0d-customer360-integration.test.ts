import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNTHETIC_USERS } from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import type { Actor } from "@/server/service-core";
import { establishSessionFromVerifiedOidcIdentity } from "@/server/session";
import {
  createCustomerMilestone,
  createCustomerReference,
  getCustomer360,
  getDashboardDrilldown,
} from "@/server/customers/p0d-service";
import { evaluateP0Alerts } from "@/server/alerts/p0c-alerts-service";

ensureDevtestEnvLoaded();
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

describe("P0D Integration Tests: Scoped Customer 360 & End-to-End Drill-down (TASK-0010)", () => {
  let execActor: Actor;
  let adminActor: Actor;
  let mgrKhdnActor: Actor;
  let staffKhcnActor: Actor;
  let staffKhdnActor: Actor;

  const createdCustomerIds: string[] = [];
  const createdMilestoneIds: string[] = [];
  const createdOppIds: string[] = [];
  const createdAlertIds: string[] = [];

  beforeAll(async () => {
    migratorPool = new pg.Pool({ connectionString: migratorUrl });
    execActor = await makeActorForUserKey("exec01");
    adminActor = await makeActorForUserKey("admin01");
    mgrKhdnActor = await makeActorForUserKey("mgr_khdn");
    staffKhcnActor = await makeActorForUserKey("staff_khcn");
    staffKhdnActor = await makeActorForUserKey("staff_khdn");
  });

  afterAll(async () => {
    if (createdAlertIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM in_app_alerts WHERE id = ANY($1::uuid[])`,
        [createdAlertIds],
      );
    }
    if (createdOppIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM pipeline_stage_transitions WHERE entity_id = ANY($1::uuid[])`,
        [createdOppIds],
      );
      await migratorPool.query(
        `DELETE FROM opportunities WHERE id = ANY($1::uuid[])`,
        [createdOppIds],
      );
    }
    if (createdMilestoneIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM customer_milestones WHERE id = ANY($1::uuid[])`,
        [createdMilestoneIds],
      );
    }
    if (createdCustomerIds.length > 0) {
      await migratorPool.query(
        `DELETE FROM customer_references WHERE id = ANY($1::uuid[])`,
        [createdCustomerIds],
      );
    }
    await migratorPool.end();
    await closeRuntimePool();
  });

  it("enforces ADR-005 PII tamper rejection, 1-N opportunities, scope 404/403, drilldown, and maturity alerts (AC-01..AC-04)", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const refCode = `SYN-CIF-P0D-${suffix}`;

    const piiAttempt = await createCustomerReference(staffKhcnActor, {
      customer_ref_code: refCode,
      segment_code: "KHCN",
      display_name: "KH Synthetic Tamper Test",
      cccd: "001099999999",
    });
    expect(piiAttempt.ok).toBe(false);
    expect(piiAttempt.status).toBe(403);

    const adminCreate = await createCustomerReference(adminActor, {
      customer_ref_code: refCode,
      segment_code: "KHCN",
      display_name: "Admin Forbidden",
    });
    expect(adminCreate.ok).toBe(false);
    expect(adminCreate.status).toBe(403);

    const adminDrill = await getDashboardDrilldown(
      adminActor,
      new URL("http://127.0.0.1:3100/api/dashboard/drilldown?level=BRANCH"),
    );
    expect(adminDrill.ok).toBe(false);
    expect(adminDrill.status).toBe(403);

    const custRes = await createCustomerReference(staffKhcnActor, {
      customer_ref_code: refCode,
      segment_code: "KHCN",
      display_name: "KH Synthetic 360 Test",
      maturity_date: "2026-11-19",
    });
    expect(custRes.ok).toBe(true);
    if (!custRes.ok) return;
    const custId = custRes.data.id;
    createdCustomerIds.push(custId);

    const opp1Id = randomUUID();
    const opp2Id = randomUUID();
    createdOppIds.push(opp1Id, opp2Id);
    await migratorPool.query(
      `INSERT INTO opportunities (
         id, opportunity_ref, customer_ref, customer_reference_id, display_label,
         kpi_group_code, estimated_value, stage, department_id, owner_staff_id
       ) VALUES
         ($1, $2, $3, $4, 'Opp Loan 1', 'LOAN', 500000000, 'PROPOSAL', $5, $6),
         ($7, $8, $3, $4, 'Opp Insurance 2', 'INSURANCE', 25000000, 'NEGOTIATION', $5, $6)`,
      [
        opp1Id,
        `SYN-OPP-1-${suffix}`,
        refCode,
        custId,
        staffKhcnActor.ctx.department.id,
        staffKhcnActor.ctx.staff_id,
        opp2Id,
        `SYN-OPP-2-${suffix}`,
      ],
    );

    const msRes = await createCustomerMilestone(staffKhcnActor, custId, {
      milestone_type: "MATURITY",
      due_date: "2026-11-18",
      title: "Đáo hạn khoản vay Synthetic",
    });
    expect(msRes.ok).toBe(true);
    if (!msRes.ok) return;
    createdMilestoneIds.push(msRes.data.id);

    const evalRes = await evaluateP0Alerts(staffKhcnActor, {
      as_of_date: "2026-11-14",
      period_key: "2026-11",
    });
    expect(evalRes.ok).toBe(true);
    if (!evalRes.ok) return;
    for (const a of evalRes.data.alerts) createdAlertIds.push(a.id);

    const maturityAlert = evalRes.data.alerts.find(
      (a) => a.dedup_key === `CUSTOMER_RENEWAL_CARE:MILESTONE:${msRes.data.id}`,
    );
    expect(maturityAlert).toBeDefined();
    expect(maturityAlert?.title).toContain("CUSTOMER_MATURITY_UPCOMING");

    const bundle = await getCustomer360(staffKhcnActor, custId);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(bundle.data.opportunities.length).toBe(2);
    expect(bundle.data.milestones.length).toBe(1);

    const mgrDenied = await getCustomer360(mgrKhdnActor, custId);
    expect(mgrDenied.ok).toBe(false);
    expect(mgrDenied.status).toBe(404);

    const staffDenied = await getCustomer360(staffKhdnActor, custId);
    expect(staffDenied.ok).toBe(false);
    expect(staffDenied.status).toBe(404);

    const execDrill = await getDashboardDrilldown(
      execActor,
      new URL("http://127.0.0.1:3100/api/dashboard/drilldown?level=BRANCH"),
    );
    expect(execDrill.ok).toBe(true);
    if (!execDrill.ok) return;
    expect(execDrill.data.departments.length).toBeGreaterThanOrEqual(2);

    const crossDrill = await getDashboardDrilldown(
      mgrKhdnActor,
      new URL(
        `http://127.0.0.1:3100/api/dashboard/drilldown?level=DEPARTMENT&department_id=${staffKhcnActor.ctx.department.id}`,
      ),
    );
    expect(crossDrill.ok).toBe(false);
    expect(crossDrill.status).toBe(404);
  });
});
