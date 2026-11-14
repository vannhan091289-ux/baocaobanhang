import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYNTHETIC_USERS } from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import { listInAppAlerts } from "@/server/alerts/p0c-alerts-service";
import { getDashboardDrilldown } from "@/server/customers/p0d-service";
import { getDashboardOverview } from "@/server/kpi/p0b2-service";
import type { Actor } from "@/server/service-core";
import { establishSessionFromVerifiedOidcIdentity } from "@/server/session";

ensureDevtestEnvLoaded();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;
const runtimeUrl = process.env.DATABASE_URL!;

let migratorPool: pg.Pool;
let runtimePool: pg.Pool;

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

describe("TASK-0011 UAT & Hardening: Least-Privilege, RBAC & Latency Bounds", () => {
  let execActor: Actor;
  let mgrKhcnActor: Actor;
  let adminActor: Actor;

  beforeAll(async () => {
    migratorPool = new pg.Pool({ connectionString: migratorUrl });
    runtimePool = new pg.Pool({ connectionString: runtimeUrl });
    execActor = await makeActorForUserKey("exec01");
    mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    adminActor = await makeActorForUserKey("admin01");
  });

  afterAll(async () => {
    await migratorPool?.end();
    await runtimePool?.end();
    await closeRuntimePool();
  });

  it("enforces least-privilege on app_runtime_role (no superuser, append-only audit/transitions)", async () => {
    const roleRes = await migratorPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       FROM pg_roles
       WHERE rolname = 'app_runtime_role'`,
    );
    expect(roleRes.rows.length).toBe(1);
    expect(roleRes.rows[0]!.rolsuper).toBe(false);
    expect(roleRes.rows[0]!.rolbypassrls).toBe(false);
    expect(roleRes.rows[0]!.rolcreaterole).toBe(false);
    expect(roleRes.rows[0]!.rolcreatedb).toBe(false);

    const privRes = await migratorPool.query<{
      table_name: string;
      privilege_type: string;
    }>(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'app_runtime_role'
         AND table_schema = 'public'
         AND table_name IN ('audit_events', 'pipeline_stage_transitions')`,
    );

    const auditPrivs = privRes.rows
      .filter((r) => r.table_name === "audit_events")
      .map((r) => r.privilege_type);
    expect(auditPrivs).toContain("INSERT");
    expect(auditPrivs).not.toContain("DELETE");
    expect(auditPrivs).not.toContain("UPDATE");
    expect(auditPrivs).not.toContain("TRUNCATE");

    const transitionPrivs = privRes.rows
      .filter((r) => r.table_name === "pipeline_stage_transitions")
      .map((r) => r.privilege_type);
    expect(transitionPrivs).toContain("SELECT");
    expect(transitionPrivs).toContain("INSERT");
    expect(transitionPrivs).not.toContain("DELETE");
    expect(transitionPrivs).not.toContain("TRUNCATE");

    // Live SQL check: app_runtime_role must fail with 42501 on DELETE FROM audit_events
    await expect(
      runtimePool.query(`DELETE FROM audit_events WHERE 1 = 0`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("denies CONFIG_ADMIN (403) across Dashboard, Drilldown, and Alerts services", async () => {
    const dashRes = await getDashboardOverview(
      adminActor,
      new URL("http://127.0.0.1:3100/api/dashboard/overview?period_type=MONTH"),
    );
    expect(dashRes.ok).toBe(false);
    if (!dashRes.ok) expect(dashRes.status).toBe(403);

    const drillRes = await getDashboardDrilldown(
      adminActor,
      new URL("http://127.0.0.1:3100/api/dashboard/drilldown?level=BRANCH"),
    );
    expect(drillRes.ok).toBe(false);
    if (!drillRes.ok) expect(drillRes.status).toBe(403);

    const alertRes = await listInAppAlerts(
      adminActor,
      new URL("http://127.0.0.1:3100/api/alerts"),
    );
    expect(alertRes.ok).toBe(false);
    if (!alertRes.ok) expect(alertRes.status).toBe(403);
  });

  it("meets basic latency bounds (<1000ms) for Dashboard Overview, Drilldown, and Alerts", async () => {
    const t0 = performance.now();
    const dashExec = await getDashboardOverview(
      execActor,
      new URL("http://127.0.0.1:3100/api/dashboard/overview?period_type=MONTH"),
    );
    const dashMs = performance.now() - t0;
    expect(dashExec.ok).toBe(true);
    expect(dashMs).toBeLessThan(1000);

    const t1 = performance.now();
    const drillExec = await getDashboardDrilldown(
      execActor,
      new URL("http://127.0.0.1:3100/api/dashboard/drilldown?level=BRANCH"),
    );
    const drillMs = performance.now() - t1;
    expect(drillExec.ok).toBe(true);
    expect(drillMs).toBeLessThan(1000);

    const t2 = performance.now();
    const alertsMgr = await listInAppAlerts(
      mgrKhcnActor,
      new URL("http://127.0.0.1:3100/api/alerts?limit=50"),
    );
    const alertsMs = performance.now() - t2;
    expect(alertsMgr.ok).toBe(true);
    expect(alertsMs).toBeLessThan(1000);
  });
});
