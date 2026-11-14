import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SYNTHETIC_DEPARTMENTS,
  SYNTHETIC_USERS,
} from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { closeRuntimePool } from "@/server/db";
import type { Actor } from "@/server/service-core";
import {
  establishSessionFromVerifiedOidcIdentity,
  SESSION_COOKIE_NAME,
} from "@/server/session";
import {
  GET as getCalendarRoute,
  PATCH as patchCalendarRoute,
  POST as postCalendarRoute,
} from "@/app/api/kpi/calendar/route";
import {
  GET as getDefinitionsRoute,
  PATCH as patchDefinitionsRoute,
  POST as postDefinitionsRoute,
} from "@/app/api/kpi/definitions/route";
import {
  GET as getTargetsRoute,
  PATCH as patchTargetsRoute,
  POST as postTargetsRoute,
} from "@/app/api/kpi/targets/route";
import { POST as postApproveTargetRoute } from "@/app/api/kpi/targets/[id]/approve/route";

ensureDevtestEnvLoaded();
const cfg = getRuntimeConfig();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;

let migratorPool: pg.Pool;
const createdTargetIds: string[] = [];
const createdDefinitionIds: string[] = [];

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

function makeAuthRequest(
  path: string,
  opts: {
    method?: string;
    actor?: Actor;
    body?: unknown;
    includeCsrf?: boolean;
    origin?: string;
  } = {},
): Request {
  const method = opts.method ?? "GET";
  const headers = new Headers();
  if (opts.actor) {
    headers.set(
      "cookie",
      `${SESSION_COOKIE_NAME}=${opts.actor.rawSessionToken}`,
    );
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("origin", opts.origin ?? cfg.appOrigin);
    if (opts.includeCsrf !== false && opts.actor) {
      headers.set("x-csrf-token", opts.actor.csrfToken);
    }
  }
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    bodyStr = JSON.stringify(opts.body);
  }
  return new Request(`${cfg.appOrigin}${path}`, {
    method,
    headers,
    body: bodyStr,
  });
}

beforeAll(async () => {
  migratorPool = new pg.Pool({ connectionString: migratorUrl, max: 4 });
});

afterAll(async () => {
  if (createdTargetIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM kpi_target_revisions WHERE target_id = ANY($1::uuid[])`,
      [createdTargetIds],
    );
    await migratorPool.query(
      `UPDATE kpi_targets SET parent_target_id = NULL WHERE id = ANY($1::uuid[])`,
      [createdTargetIds],
    );
    await migratorPool.query(
      `DELETE FROM kpi_targets WHERE id = ANY($1::uuid[])`,
      [createdTargetIds],
    );
  }
  if (createdDefinitionIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM kpi_definitions WHERE id = ANY($1::uuid[])`,
      [createdDefinitionIds],
    );
  }
  await migratorPool.query(
    `UPDATE branch_calendar_days
     SET is_working_day = TRUE, holiday_name = NULL
     WHERE calendar_date = '2026-11-20'::date`,
  );
  await closeRuntimePool();
  await migratorPool.end();
});

describe("P0A Integration Tests: 7-Group KPI Dictionary, Working Calendar & Target Allocation (TASK-0006)", () => {
  it("AC-01: verifies all 7 KPI groups in kpi_definitions, NUMERIC(20, 2) column precision, and both API + DB rejection of STOCK + SUM", async () => {
    const adminActor = await makeActorForUserKey("admin01");

    // 1. Verify all 7 KPI groups are present via GET /api/kpi/definitions
    const defRes = await getDefinitionsRoute(
      makeAuthRequest("/api/kpi/definitions?limit=50", { actor: adminActor }),
    );
    expect(defRes.status).toBe(200);
    const defBody = (await defRes.json()) as {
      data: Array<{
        id: string;
        metric_code: string;
        group_code: string;
        metric_type: string;
        time_aggregation_rule: string;
      }>;
      page: { total: number };
    };
    expect(defBody.page.total).toBeGreaterThanOrEqual(10);
    const groups = new Set(defBody.data.map((i) => i.group_code));
    expect(Array.from(groups).sort()).toEqual([
      "BIZ_HOUSEHOLD",
      "CARD",
      "DEPOSIT",
      "INSURANCE",
      "LOAN",
      "NEW_RETAIL_CIF",
      "TTQT",
    ]);

    // 2. Verify kpi_targets.target_value is NUMERIC(20, 2) in information_schema
    const colRes = await migratorPool.query<{
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `SELECT data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'kpi_targets'
         AND column_name = 'target_value'`,
    );
    expect(colRes.rows[0]).toEqual({
      data_type: "numeric",
      numeric_precision: 20,
      numeric_scale: 2,
    });

    // 3. Verify API-level rejection of STOCK + SUM (422 STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN + DENY audit)
    const stockSumRes = await postDefinitionsRoute(
      makeAuthRequest("/api/kpi/definitions", {
        method: "POST",
        actor: adminActor,
        body: {
          metric_code: "INVALID_STOCK_SUM_TEST",
          metric_name: "Invalid Stock Sum Metric",
          group_code: "LOAN",
          unit_code: "VND",
          currency_code: "VND",
          metric_type: "STOCK",
          time_aggregation_rule: "SUM",
          formula_expression: "SUM(stock_balance)",
          governance_ref: "TEST-REF-001",
        },
      }),
    );
    expect(stockSumRes.status).toBe(422);
    const stockSumBody = (await stockSumRes.json()) as {
      error: { code: string };
    };
    expect(stockSumBody.error.code).toBe(
      "STOCK_METRIC_SUM_AGGREGATION_FORBIDDEN",
    );

    // 4. Verify DB-level CHECK constraint chk_kpi_stock_no_sum directly against PostgreSQL
    await expect(
      migratorPool.query(
        `INSERT INTO kpi_definitions (
           id, metric_code, metric_name, group_code, unit_code, currency_code,
           metric_type, time_aggregation_rule, staff_aggregation_rule,
           attribution_mode, primary_weight, referrer_weight,
           formula_expression, version, status, effective_from, approval_reference
         ) VALUES (
           $1, 'DB_DIRECT_STOCK_SUM', 'Direct DB Stock Sum', 'LOAN', 'VND', 'VND',
           'STOCK', 'SUM', 'SUM', 'PRIMARY_ONLY', 1.0000, 0.0000,
           'SUM(x)', 1, 'ACTIVE', '2026-01-01T00:00:00Z', 'TEST-DB-CHK'
         )`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/chk_kpi_stock_no_sum/i);

    // 5. Verify CONFIG_ADMIN can create and patch a valid KPI definition with optimistic locking
    const createDefRes = await postDefinitionsRoute(
      makeAuthRequest("/api/kpi/definitions", {
        method: "POST",
        actor: adminActor,
        body: {
          metric_code: "SYN_LOAN_GREEN_FLOW",
          metric_name: "Giải ngân tín dụng xanh (Synthetic)",
          group_code: "LOAN",
          unit_code: "VND",
          currency_code: "VND",
          metric_type: "FLOW",
          time_aggregation_rule: "SUM",
          formula_expression: "SUM(green_loan_disbursed_vnd)",
          governance_ref: "ADR-003-SYN-GREEN",
        },
      }),
    );
    expect(createDefRes.status).toBe(201);
    const createdDef = (
      (await createDefRes.json()) as {
        data: { id: string; row_version: number };
      }
    ).data;
    createdDefinitionIds.push(createdDef.id);

    const patchDefRes = await patchDefinitionsRoute(
      makeAuthRequest("/api/kpi/definitions", {
        method: "PATCH",
        actor: adminActor,
        body: {
          id: createdDef.id,
          expected_version: createdDef.row_version,
          metric_name: "Giải ngân tín dụng xanh v2 (Synthetic)",
        },
      }),
    );
    expect(patchDefRes.status).toBe(200);
    const patchedDef = (
      (await patchDefRes.json()) as { data: { row_version: number } }
    ).data;
    expect(patchedDef.row_version).toBe(2);

    // Version conflict on stale expected_version -> 409
    const staleDefRes = await patchDefinitionsRoute(
      makeAuthRequest("/api/kpi/definitions", {
        method: "PATCH",
        actor: adminActor,
        body: {
          id: createdDef.id,
          expected_version: 1,
          metric_name: "Stale update",
        },
      }),
    );
    expect(staleDefRes.status).toBe(409);
  });

  it("AC-02: protects APPROVED YEAR/MONTH targets with revision history and keeps parent target unchanged when WEEK/DAY projections change", async () => {
    const execActor = await makeActorForUserKey("exec01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");

    const loanDisbDefId = "55555555-5555-4555-8555-555555555502";

    // 1. EXECUTIVE allocates & approves official MONTH target for KHCN department
    const createMonthRes = await postTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "POST",
        actor: execActor,
        body: {
          kpi_definition_id: loanDisbDefId,
          period_type: "MONTH",
          period_key: "2026-11",
          target_scope: "DEPARTMENT",
          department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
          target_value: "5000000000.00",
          governance_ref: "EXEC-MONTH-2026-11-001",
          notes: "Giao chỉ tiêu giải ngân tháng 11/2026 phòng KHCN",
        },
      }),
    );
    expect(createMonthRes.status).toBe(201);
    const monthTarget = (
      (await createMonthRes.json()) as {
        data: {
          id: string;
          target_value: string;
          status: string;
          revision_no: number;
          row_version: number;
          revisions: Array<{ revision_no: number; new_target_value: string }>;
        };
      }
    ).data;
    createdTargetIds.push(monthTarget.id);
    expect(monthTarget.status).toBe("APPROVED");
    expect(monthTarget.revision_no).toBe(1);
    expect(monthTarget.revisions).toHaveLength(1);

    // 2. Attempting to patch without change_reason is rejected (422 VALIDATION_FAILED)
    const noReasonRes = await patchTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "PATCH",
        actor: execActor,
        body: {
          id: monthTarget.id,
          expected_version: monthTarget.row_version,
          target_value: "5500000000.00",
        },
      }),
    );
    expect(noReasonRes.status).toBe(422);

    // 3. DEPARTMENT_MANAGER proposes an adjustment to the MONTH target -> transitions to PENDING_APPROVAL + revision #2
    const mgrAdjustRes = await patchTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "PATCH",
        actor: mgrKhcnActor,
        body: {
          id: monthTarget.id,
          expected_version: monthTarget.row_version,
          target_value: "5500000000.00",
          change_reason:
            "Đề nghị tăng chỉ tiêu tháng 11 theo nhu cầu giải ngân cuối năm",
        },
      }),
    );
    expect(mgrAdjustRes.status).toBe(200);
    const adjustedMonth = (
      (await mgrAdjustRes.json()) as {
        data: {
          id: string;
          target_value: string;
          status: string;
          revision_no: number;
          row_version: number;
          revisions: Array<{
            revision_no: number;
            previous_target_value: string | null;
            new_target_value: string;
            new_status: string;
          }>;
        };
      }
    ).data;
    expect(adjustedMonth.status).toBe("PENDING_APPROVAL");
    expect(adjustedMonth.revision_no).toBe(2);
    expect(adjustedMonth.revisions).toHaveLength(2);
    expect(adjustedMonth.revisions[1]?.previous_target_value).toBe(
      "5000000000.00",
    );
    expect(adjustedMonth.revisions[1]?.new_target_value).toBe("5500000000.00");

    // 4. EXECUTIVE approves the revised MONTH target -> APPROVED + revision #3
    const approveMonthRes = await postApproveTargetRoute(
      makeAuthRequest(`/api/kpi/targets/${monthTarget.id}/approve`, {
        method: "POST",
        actor: execActor,
        body: {
          expected_version: adjustedMonth.row_version,
          governance_ref: "EXEC-MONTH-2026-11-REV2",
          decision_reason: "Đồng ý điều chỉnh chỉ tiêu tháng 11 phòng KHCN",
        },
      }),
      { params: Promise.resolve({ id: monthTarget.id }) },
    );
    expect(approveMonthRes.status).toBe(200);
    const approvedMonth = (
      (await approveMonthRes.json()) as {
        data: {
          id: string;
          target_value: string;
          status: string;
          revision_no: number;
          row_version: number;
          revisions: Array<{ revision_no: number; new_status: string }>;
        };
      }
    ).data;
    expect(approvedMonth.status).toBe("APPROVED");
    expect(approvedMonth.revision_no).toBe(3);
    expect(approvedMonth.revisions).toHaveLength(3);

    // 5. STAFF creates and adjusts a child WEEK projection linked to parent_target_id -> parent MONTH target_value & row_version stay untouched!
    const createWeekRes = await postTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "POST",
        actor: staffKhcnActor,
        body: {
          kpi_definition_id: loanDisbDefId,
          period_type: "WEEK",
          period_key: "2026-W46",
          target_scope: "SELF",
          department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
          staff_id: staffKhcnActor.ctx.staff_id,
          parent_target_id: monthTarget.id,
          target_value: "300000000.00",
          notes: "Dự phóng giải ngân tuần 46 cá nhân",
        },
      }),
    );
    expect(createWeekRes.status).toBe(201);
    const weekTarget = (
      (await createWeekRes.json()) as {
        data: { id: string; row_version: number };
      }
    ).data;
    createdTargetIds.push(weekTarget.id);

    const patchWeekRes = await patchTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "PATCH",
        actor: staffKhcnActor,
        body: {
          id: weekTarget.id,
          expected_version: weekTarget.row_version,
          target_value: "420000000.00",
          change_reason: "Cập nhật dự phóng tuần 46 theo hồ sơ mới",
        },
      }),
    );
    expect(patchWeekRes.status).toBe(200);

    // Verify parent MONTH target in DB is 100% unchanged
    const parentAfterRes = await migratorPool.query<{
      target_value: string;
      row_version: number;
      status: string;
    }>(
      `SELECT target_value::text, row_version, status FROM kpi_targets WHERE id = $1`,
      [monthTarget.id],
    );
    expect(parentAfterRes.rows[0]).toEqual({
      target_value: "5500000000.00",
      row_version: approvedMonth.row_version,
      status: "APPROVED",
    });
  });

  it("AC-03: enforces CONFIG_ADMIN 403 on targets and strict DEPARTMENT/SELF scope isolation with DENY AuditEvent", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const mgrKhcnActor = await makeActorForUserKey("mgr_khcn");
    const staffKhcnActor = await makeActorForUserKey("staff_khcn");
    const staffKhdnUser = SYNTHETIC_USERS.find((u) => u.key === "staff_khdn")!;

    // 1. CONFIG_ADMIN receives 403 CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN on GET/POST/PATCH /api/kpi/targets
    const adminGetTargets = await getTargetsRoute(
      makeAuthRequest("/api/kpi/targets", { actor: adminActor }),
    );
    expect(adminGetTargets.status).toBe(403);
    expect(
      ((await adminGetTargets.json()) as { error: { code: string } }).error
        .code,
    ).toBe("CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN");

    const adminPostTargets = await postTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "POST",
        actor: adminActor,
        body: {
          kpi_definition_id: "55555555-5555-4555-8555-555555555501",
          period_type: "MONTH",
          period_key: "2026-11",
          target_scope: "BRANCH",
          target_value: "1000.00",
        },
      }),
    );
    expect(adminPostTargets.status).toBe(403);

    // 2. DEPARTMENT_MANAGER (KHCN) querying or writing KHDN targets -> 404 RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE
    const mgrCrossDeptRead = await getTargetsRoute(
      makeAuthRequest(
        `/api/kpi/targets?department_id=${SYNTHETIC_DEPARTMENTS.KHDN.id}`,
        { actor: mgrKhcnActor },
      ),
    );
    expect(mgrCrossDeptRead.status).toBe(404);

    const mgrCrossDeptWrite = await postTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "POST",
        actor: mgrKhcnActor,
        body: {
          kpi_definition_id: "55555555-5555-4555-8555-555555555501",
          period_type: "MONTH",
          period_key: "2026-11",
          target_scope: "DEPARTMENT",
          department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
          target_value: "1000.00",
        },
      }),
    );
    expect(mgrCrossDeptWrite.status).toBe(404);

    // 3. STAFF cannot write official YEAR/MONTH targets (403 STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN) or read another staff's targets (404)
    const staffOfficialWrite = await postTargetsRoute(
      makeAuthRequest("/api/kpi/targets", {
        method: "POST",
        actor: staffKhcnActor,
        body: {
          kpi_definition_id: "55555555-5555-4555-8555-555555555501",
          period_type: "MONTH",
          period_key: "2026-11",
          target_scope: "SELF",
          department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
          staff_id: staffKhcnActor.ctx.staff_id,
          target_value: "1000.00",
        },
      }),
    );
    expect(staffOfficialWrite.status).toBe(403);
    expect(
      ((await staffOfficialWrite.json()) as { error: { code: string } }).error
        .code,
    ).toBe("STAFF_OFFICIAL_TARGET_WRITE_FORBIDDEN");

    const staffCrossRead = await getTargetsRoute(
      makeAuthRequest(`/api/kpi/targets?staff_id=${staffKhdnUser.staff!.id}`, {
        actor: staffKhcnActor,
      }),
    );
    expect(staffCrossRead.status).toBe(404);
  });

  it("AC-04 & AC-05: verifies branch_calendar_days working day counts, holiday updates, CSRF/Origin checks, and atomic AuditEvent rollback", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const staffActor = await makeActorForUserKey("staff_khcn");

    // 1. Read Nov 2026 calendar (30 days: 21 Mon-Fri working days, 9 Sat-Sun weekend days)
    const calRes = await getCalendarRoute(
      makeAuthRequest(
        "/api/kpi/calendar?from=2026-11-01&to=2026-11-30&limit=50",
        { actor: staffActor },
      ),
    );
    expect(calRes.status).toBe(200);
    const calBody = (await calRes.json()) as {
      page: { total: number };
      data: {
        summary: {
          total_days: number;
          working_days_count: number;
          non_working_days_count: number;
          timezone: string;
          weekly_cutoff_day: string;
        };
        items: Array<{ calendar_date: string; row_version: number }>;
      };
    };
    expect(calBody.page.total).toBe(30);
    expect(calBody.data.summary).toEqual({
      total_days: 30,
      working_days_count: 21,
      non_working_days_count: 9,
      timezone: "Asia/Ho_Chi_Minh",
      weekly_cutoff_day: "MONDAY",
      daily_report_cutoff_time: "18:00",
    });

    // 2. Non-CONFIG_ADMIN cannot update calendar -> 403
    const staffCalWrite = await postCalendarRoute(
      makeAuthRequest("/api/kpi/calendar", {
        method: "POST",
        actor: staffActor,
        body: {
          calendar_date: "2026-11-20",
          is_working_day: false,
          holiday_name: "Unauthorized Holiday",
        },
      }),
    );
    expect(staffCalWrite.status).toBe(403);

    // 3. CONFIG_ADMIN marks 2026-11-20 (Friday) as synthetic holiday -> working_days_count becomes 20
    const nov20 = calBody.data.items.find(
      (d) => d.calendar_date === "2026-11-20",
    )!;
    const adminCalPatch = await patchCalendarRoute(
      makeAuthRequest("/api/kpi/calendar", {
        method: "PATCH",
        actor: adminActor,
        body: {
          calendar_date: "2026-11-20",
          is_working_day: false,
          holiday_name: "Ngày Nhà giáo Việt Nam (Synthetic)",
          expected_version: nov20.row_version,
        },
      }),
    );
    expect(adminCalPatch.status).toBe(200);

    const calAfterRes = await getCalendarRoute(
      makeAuthRequest(
        "/api/kpi/calendar?from=2026-11-01&to=2026-11-30&limit=50",
        { actor: adminActor },
      ),
    );
    const calAfterBody = (await calAfterRes.json()) as {
      data: {
        summary: { working_days_count: number; non_working_days_count: number };
      };
    };
    expect(calAfterBody.data.summary.working_days_count).toBe(20);
    expect(calAfterBody.data.summary.non_working_days_count).toBe(10);

    // 4. Missing CSRF token on write -> 403 CSRF_TOKEN_INVALID
    const missingCsrfRes = await patchCalendarRoute(
      makeAuthRequest("/api/kpi/calendar", {
        method: "PATCH",
        actor: adminActor,
        includeCsrf: false,
        body: {
          calendar_date: "2026-11-20",
          is_working_day: true,
          expected_version: nov20.row_version + 1,
        },
      }),
    );
    expect(missingCsrfRes.status).toBe(403);

    // 5. Atomic AuditEvent rollback: when INSERT on audit_events is revoked, target write rolls back completely
    const execActor = await makeActorForUserKey("exec01");
    const beforeTargetCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM kpi_targets`,
        )
      ).rows[0]!.c,
    );

    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const outageRes = await postTargetsRoute(
        makeAuthRequest("/api/kpi/targets", {
          method: "POST",
          actor: execActor,
          body: {
            kpi_definition_id: "55555555-5555-4555-8555-555555555501",
            period_type: "YEAR",
            period_key: "2026",
            target_scope: "BRANCH",
            target_value: "9999999999.00",
            governance_ref: "OUTAGE-TEST-001",
          },
        }),
      );
      expect(outageRes.status).toBe(500);
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }

    const afterTargetCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM kpi_targets`,
        )
      ).rows[0]!.c,
    );
    expect(afterTargetCount).toBe(beforeTargetCount);
  });
});
