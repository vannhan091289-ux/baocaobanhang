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
  DELETE as deletePlansRoute,
  GET as getPlansRoute,
  PATCH as patchPlansRoute,
  POST as postPlansRoute,
} from "@/app/api/planning/plans/route";
import {
  DELETE as deleteActivitiesRoute,
  GET as getActivitiesRoute,
  PATCH as patchActivitiesRoute,
  POST as postActivitiesRoute,
} from "@/app/api/planning/activities/route";
import {
  DELETE as deleteReviewsRoute,
  GET as getReviewsRoute,
  PATCH as patchReviewsRoute,
  POST as postReviewsRoute,
} from "@/app/api/planning/monday-reviews/route";

ensureDevtestEnvLoaded();
const cfg = getRuntimeConfig();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;

let migratorPool: pg.Pool;
const createdPlanIds: string[] = [];
const createdActivityIds: string[] = [];
const createdReviewIds: string[] = [];
const createdDirectiveIds: string[] = [];

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
  if (createdDirectiveIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM directive_tasks WHERE id = ANY($1::uuid[])`,
      [createdDirectiveIds],
    );
  }
  if (createdReviewIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM monday_reviews WHERE id = ANY($1::uuid[])`,
      [createdReviewIds],
    );
  }
  if (createdActivityIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM activity_logs WHERE id = ANY($1::uuid[])`,
      [createdActivityIds],
    );
  }
  if (createdPlanIds.length > 0) {
    await migratorPool.query(
      `DELETE FROM sales_plans WHERE id = ANY($1::uuid[])`,
      [createdPlanIds],
    );
  }
  await closeRuntimePool();
  await migratorPool.end();
});

describe("P0B-1 Integration Tests: Sales Plans, Single-Source Activity Log & Monday Review (TASK-0007)", () => {
  it("AC-01 & AC-03: Single-Source Activity Log automatically aggregates into Sales Plan & Monday Review without duplicate entry, respecting VN week bounds and 18:00 cut-off", async () => {
    const staffKhcn = await makeActorForUserKey("staff_khcn");
    const mgrKhcn = await makeActorForUserKey("mgr_khcn");
    const execActor = await makeActorForUserKey("exec01");

    // 1. STAFF creates a weekly sales plan for 2026-W46
    const planRes = await postPlansRoute(
      makeAuthRequest("/api/planning/plans", {
        method: "POST",
        actor: staffKhcn,
        body: {
          period_type: "WEEK",
          period_key: "2026-W46",
          title: "Kế hoạch tuần 46 KHCN (Integration)",
          focus_notes: "Tập trung khách hàng vay tiêu dùng",
          status: "SUBMITTED",
        },
      }),
    );
    expect(planRes.status).toBe(201);
    const plan = (
      (await planRes.json()) as {
        data: {
          id: string;
          row_version: number;
          activity_summary: { total_count: number };
        };
      }
    ).data;
    createdPlanIds.push(plan.id);
    expect(plan.activity_summary.total_count).toBe(0);

    // 2. STAFF records 2 activities into activity_logs (one before 18:00 VN, one after 18:00 VN)
    const act1Res = await postActivitiesRoute(
      makeAuthRequest("/api/planning/activities", {
        method: "POST",
        actor: staffKhcn,
        body: {
          sales_plan_id: plan.id,
          synthetic_customer_ref: "SYN-CIF-101",
          activity_type: "CUSTOMER_VISIT",
          status: "COMPLETED",
          occurred_at: "2026-11-10T10:15:00.000+07:00",
          outcome_summary: "Đã tư vấn gói vay mua nhà synthetic",
          next_step: "Thu thập chứng từ thu nhập",
        },
      }),
    );
    expect(act1Res.status).toBe(201);
    const act1 = (
      (await act1Res.json()) as {
        data: {
          id: string;
          occurred_date_vn: string;
          is_after_daily_cutoff: boolean;
          row_version: number;
        };
      }
    ).data;
    createdActivityIds.push(act1.id);
    expect(act1.occurred_date_vn).toBe("2026-11-10");
    expect(act1.is_after_daily_cutoff).toBe(false);

    const act2Res = await postActivitiesRoute(
      makeAuthRequest("/api/planning/activities", {
        method: "POST",
        actor: staffKhcn,
        body: {
          sales_plan_id: plan.id,
          synthetic_customer_ref: "SYN-CIF-102",
          activity_type: "CALL",
          status: "FOLLOW_UP_NEEDED",
          occurred_at: "2026-11-10T18:30:00.000+07:00",
          outcome_summary: "KH hẹn gọi lại sau 18h30",
        },
      }),
    );
    expect(act2Res.status).toBe(201);
    const act2 = (
      (await act2Res.json()) as {
        data: {
          id: string;
          is_after_daily_cutoff: boolean;
          row_version: number;
        };
      }
    ).data;
    createdActivityIds.push(act2.id);
    expect(act2.is_after_daily_cutoff).toBe(true);

    // 3. Verify GET /api/planning/plans reflects the exact counts from activity_logs
    const plansListRes = await getPlansRoute(
      makeAuthRequest("/api/planning/plans?period_key=2026-W46", {
        actor: staffKhcn,
      }),
    );
    expect(plansListRes.status).toBe(200);
    const plansList = (
      (await plansListRes.json()) as {
        data: Array<{
          id: string;
          activity_summary: {
            total_count: number;
            completed_count: number;
            follow_up_needed_count: number;
          };
        }>;
      }
    ).data;
    const foundPlan = plansList.find((p) => p.id === plan.id)!;
    expect(foundPlan.activity_summary.total_count).toBe(2);
    expect(foundPlan.activity_summary.completed_count).toBe(1);
    expect(foundPlan.activity_summary.follow_up_needed_count).toBe(1);

    // 4. DEPARTMENT_MANAGER creates a Monday Review & EXECUTIVE issues a directive; rollup matches activity_logs
    const revRes = await postReviewsRoute(
      makeAuthRequest("/api/planning/monday-reviews", {
        method: "POST",
        actor: mgrKhcn,
        body: {
          action: "create_review",
          week_period_key: "2026-W46",
          review_scope: "DEPARTMENT",
          department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
          review_date: "2026-11-16",
          summary_notes: "Review đầu tuần phòng KHCN (Integration)",
        },
      }),
    );
    expect(revRes.status).toBe(201);
    const review = (
      (await revRes.json()) as { data: { id: string; row_version: number } }
    ).data;
    createdReviewIds.push(review.id);

    const dirRes = await postReviewsRoute(
      makeAuthRequest("/api/planning/monday-reviews", {
        method: "POST",
        actor: execActor,
        body: {
          action: "create_directive",
          monday_review_id: review.id,
          assignee_staff_id: staffKhcn.ctx.staff_id,
          title: "Hoàn tất hồ sơ SYN-CIF-102 trước Thứ Tư",
          due_at: "2026-11-18T17:00:00.000+07:00",
        },
      }),
    );
    expect(dirRes.status).toBe(201);
    const directive = (
      (await dirRes.json()) as { data: { id: string; row_version: number } }
    ).data;
    createdDirectiveIds.push(directive.id);

    // STAFF updates own directive status to DONE with expected_version
    const patchDirRes = await patchReviewsRoute(
      makeAuthRequest("/api/planning/monday-reviews", {
        method: "PATCH",
        actor: staffKhcn,
        body: {
          kind: "directive",
          id: directive.id,
          expected_version: directive.row_version,
          status: "DONE",
          completion_note: "Đã hoàn tất liên hệ KH SYN-CIF-102",
        },
      }),
    );
    expect(patchDirRes.status).toBe(200);

    // Verify Monday Review bundle rollup reflects the 2 activities automatically
    const bundleRes = await getReviewsRoute(
      makeAuthRequest("/api/planning/monday-reviews?week_period_key=2026-W46", {
        actor: mgrKhcn,
      }),
    );
    expect(bundleRes.status).toBe(200);
    const bundle = (
      (await bundleRes.json()) as {
        data: {
          week_start_vn: string;
          week_end_vn: string;
          weekly_activity_rollup: Array<{
            staff_id: string;
            activities_total: number;
            activities_completed: number;
          }>;
        };
      }
    ).data;
    expect(bundle.week_start_vn).toBe("2026-11-09");
    expect(bundle.week_end_vn).toBe("2026-11-15");
    const staffRollup = bundle.weekly_activity_rollup.find(
      (r) => r.staff_id === staffKhcn.ctx.staff_id,
    )!;
    expect(staffRollup.activities_total).toBeGreaterThanOrEqual(2);
    expect(staffRollup.activities_completed).toBeGreaterThanOrEqual(1);
  });

  it("AC-02 & AC-04: enforces CONFIG_ADMIN 403, scope isolation, 405 on DELETE, expected_version conflict, and atomic AuditEvent rollback", async () => {
    const adminActor = await makeActorForUserKey("admin01");
    const staffKhcn = await makeActorForUserKey("staff_khcn");
    const mgrKhcn = await makeActorForUserKey("mgr_khcn");
    const staffKhdnUser = SYNTHETIC_USERS.find((u) => u.key === "staff_khdn")!;

    // 1. CONFIG_ADMIN receives 403 CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN on all 3 P0B-1 endpoints
    for (const r of [
      await getPlansRoute(
        makeAuthRequest("/api/planning/plans", { actor: adminActor }),
      ),
      await getActivitiesRoute(
        makeAuthRequest("/api/planning/activities", { actor: adminActor }),
      ),
      await getReviewsRoute(
        makeAuthRequest("/api/planning/monday-reviews", { actor: adminActor }),
      ),
    ]) {
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
        "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      );
    }

    // 2. Cross-department & cross-staff reads return 404
    expect(
      (
        await getPlansRoute(
          makeAuthRequest(
            `/api/planning/plans?staff_id=${staffKhdnUser.staff!.id}`,
            {
              actor: staffKhcn,
            },
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await getActivitiesRoute(
          makeAuthRequest(
            `/api/planning/activities?department_id=${SYNTHETIC_DEPARTMENTS.KHDN.id}`,
            { actor: mgrKhcn },
          ),
        )
      ).status,
    ).toBe(404);

    // 3. Physical DELETE is strictly blocked (405 METHOD_NOT_ALLOWED)
    expect(deletePlansRoute().status).toBe(405);
    expect(deleteActivitiesRoute().status).toBe(405);
    expect(deleteReviewsRoute().status).toBe(405);

    // 4. Optimistic locking (409 VERSION_CONFLICT) & AuditEvent outage rollback
    const actRes = await postActivitiesRoute(
      makeAuthRequest("/api/planning/activities", {
        method: "POST",
        actor: staffKhcn,
        body: {
          activity_type: "CALL",
          status: "PLANNED",
          occurred_at: "2026-11-11T09:00:00.000+07:00",
          outcome_summary: "Kiểm thử optimistic locking",
        },
      }),
    );
    const act = (
      (await actRes.json()) as { data: { id: string; row_version: number } }
    ).data;
    createdActivityIds.push(act.id);

    const stalePatch = await patchActivitiesRoute(
      makeAuthRequest("/api/planning/activities", {
        method: "PATCH",
        actor: staffKhcn,
        body: {
          id: act.id,
          expected_version: 999,
          status: "COMPLETED",
        },
      }),
    );
    expect(stalePatch.status).toBe(409);

    const beforeCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM activity_logs`,
        )
      ).rows[0]!.c,
    );
    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const outageRes = await postActivitiesRoute(
        makeAuthRequest("/api/planning/activities", {
          method: "POST",
          actor: staffKhcn,
          body: {
            activity_type: "CALL",
            status: "PLANNED",
            occurred_at: "2026-11-11T10:00:00.000+07:00",
            outcome_summary: "Outage rollback test",
          },
        }),
      );
      expect(outageRes.status).toBe(500);
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }
    const afterCount = Number(
      (
        await migratorPool.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM activity_logs`,
        )
      ).rows[0]!.c,
    );
    expect(afterCount).toBe(beforeCount);

    // Ensure patchPlansRoute is exercised with valid expected_version
    const planCreate = await postPlansRoute(
      makeAuthRequest("/api/planning/plans", {
        method: "POST",
        actor: staffKhcn,
        body: {
          period_type: "DAY",
          period_key: "2026-11-11",
          title: "Kế hoạch ngày 11/11",
        },
      }),
    );
    const dayPlan = (
      (await planCreate.json()) as { data: { id: string; row_version: number } }
    ).data;
    createdPlanIds.push(dayPlan.id);

    const dayPatch = await patchPlansRoute(
      makeAuthRequest("/api/planning/plans", {
        method: "PATCH",
        actor: staffKhcn,
        body: {
          id: dayPlan.id,
          expected_version: dayPlan.row_version,
          status: "SUBMITTED",
        },
      }),
    );
    expect(dayPatch.status).toBe(200);
  });
});
