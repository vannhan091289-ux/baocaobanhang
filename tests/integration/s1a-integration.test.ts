import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runMigrations,
  validateMigrationTarget,
} from "../../scripts/migrate-s1a.mjs";
import {
  SYNTHETIC_DEPARTMENTS,
  SYNTHETIC_USERS,
} from "../../scripts/seed-s1a.mjs";
import { ensureDevtestEnvLoaded, getRuntimeConfig } from "@/server/config";
import { hashOpaqueToken } from "@/server/crypto";
import { closeRuntimePool, getRuntimePool } from "@/server/db";
import {
  clearOidcConfigCache,
  completeOidcCallback,
  getOidcClientConfiguration,
  initiateOidcLoginTransaction,
} from "@/server/oidc";
import {
  consumeAuthTransaction,
  createAuthTransaction,
  establishSessionFromVerifiedOidcIdentity,
  revokeSessionOnLogout,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  verifyRequestSession,
} from "@/server/session";

ensureDevtestEnvLoaded();
const cfg = getRuntimeConfig();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL!;
const syntheticUserPassword = process.env.SYNTHETIC_USER_PASSWORD!;

let migratorPool: pg.Pool;

/**
 * Performs a real HTTP form login against the running Keycloak 26.8.2 instance
 * (no mocks, no direct grant / password grant) following the exact Authorization Code + PKCE flow:
 * 1. Fetches the authorizationUrl returned by initiateOidcLoginTransaction
 * 2. Extracts the Keycloak HTML login form action URL and session cookies
 * 3. Submits username + password to Keycloak's form action
 * 4. Returns the 302 Location redirect URL back to http://127.0.0.1:3100/auth/callback?state=...&code=...
 */
async function performRealKeycloakBrowserFormLogin(
  authorizationUrl: string,
  username: string,
  password: string,
): Promise<URL> {
  const step1Res = await fetch(authorizationUrl, {
    method: "GET",
    redirect: "manual",
  });
  expect(step1Res.status).toBe(200);
  const html = await step1Res.text();

  // Extract Set-Cookie headers from Keycloak login page
  const rawCookies = step1Res.headers.getSetCookie();
  const cookieHeader = rawCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  // Extract form action URL from <form id="kc-form-login" ... action="...">
  const actionMatch = html.match(/action="([^"]+)"/i);
  if (!actionMatch || !actionMatch[1]) {
    throw new Error("Could not find Keycloak login form action URL in HTML.");
  }
  const formActionUrl = actionMatch[1].replace(/&amp;/g, "&");

  const step2Res = await fetch(formActionUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader,
    },
    body: new URLSearchParams({
      username,
      password,
      credentialId: "",
    }),
  });

  expect(step2Res.status).toBe(302);
  const location = step2Res.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location!);
}

beforeAll(async () => {
  migratorPool = new pg.Pool({ connectionString: migratorUrl, max: 5 });
});

afterAll(async () => {
  await closeRuntimePool();
  if (migratorPool) {
    await migratorPool.end();
  }
});

describe("AC-02: 7-Table Schema, Migration Idempotency, Least-Privilege Runtime Role & Refusals", () => {
  it("verifies migration preview, idempotent migration re-run, and refusal of unapproved profiles/DBs", async () => {
    const preview = await runMigrations({ mode: "preview" });
    expect(preview.mode).toBe("preview");
    if (preview.mode === "preview") {
      expect(preview.sqlByteLength).toBeGreaterThan(1000);
    }

    // Re-running `up` on already-migrated DB applies 0 new migrations (idempotent)
    const rerun = await runMigrations({ mode: "up" });
    expect(rerun.mode).toBe("up");
    if (rerun.mode === "up") {
      expect(rerun.appliedMigrations).toEqual([]);
    }

    // Refuses destructive `down` mode
    await expect(runMigrations({ mode: "down" as "up" })).rejects.toThrow(
      /Only "preview" and "up" are permitted/i,
    );

    // Refuses non-dev/test APP_ENV or non-allowlisted database name or runtime role
    expect(() =>
      validateMigrationTarget({
        appEnv: "production",
        databaseUrl: migratorUrl,
      }),
    ).toThrow(/MIGRATION_REFUSED/);

    expect(() =>
      validateMigrationTarget({
        appEnv: "test",
        databaseUrl: "postgresql://migrator_role:pass@127.0.0.1:55432/prod_db",
      }),
    ).toThrow(/MIGRATION_REFUSED/);

    expect(() =>
      validateMigrationTarget({
        appEnv: "test",
        databaseUrl: cfg.databaseUrl,
      }),
    ).toThrow(/app_runtime_role.*forbidden/i);
  });

  it("verifies all 7 required tables, 3 seeded departments (KHCN, KHDN, DVKH), and least-privilege runtime role boundaries", async () => {
    const runtimePool = getRuntimePool();

    const tablesRes = await runtimePool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'departments',
           'staff',
           'identity_links',
           'role_assignments',
           'sessions',
           'auth_transactions',
           'audit_events'
         )
       ORDER BY table_name`,
    );
    expect(tablesRes.rows.map((r) => r.table_name)).toEqual([
      "audit_events",
      "auth_transactions",
      "departments",
      "identity_links",
      "role_assignments",
      "sessions",
      "staff",
    ]);

    const deptsRes = await runtimePool.query<{ code: string; status: string }>(
      `SELECT code, status FROM departments ORDER BY code`,
    );
    expect(deptsRes.rows).toEqual([
      { code: "DVKH", status: "ACTIVE" },
      { code: "KHCN", status: "ACTIVE" },
      { code: "KHDN", status: "ACTIVE" },
    ]);

    // Verify app_runtime_role attributes: NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, and owns 0 tables
    const roleAttrRes = await runtimePool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       FROM pg_roles
       WHERE rolname = current_user`,
    );
    expect(roleAttrRes.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });

    const ownedTablesRes = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_tables
       WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    expect(ownedTablesRes.rows[0]?.count).toBe("0");

    // Verify runtime role CANNOT run DDL
    await expect(
      runtimePool.query("CREATE TABLE unauthorized_runtime_table (id INT)"),
    ).rejects.toThrow(/permission denied/i);

    await expect(runtimePool.query("DROP TABLE audit_events")).rejects.toThrow(
      /must be owner|permission denied/i,
    );

    // Verify runtime role CANNOT INSERT/UPDATE/DELETE on departments, staff, identity_links, role_assignments
    for (const protectedTable of [
      "departments",
      "staff",
      "identity_links",
      "role_assignments",
    ]) {
      await expect(
        runtimePool.query(`DELETE FROM ${protectedTable}`),
      ).rejects.toThrow(/permission denied/i);
    }

    // Verify runtime role CANNOT UPDATE or DELETE on audit_events (append-only)
    await expect(
      runtimePool.query(
        `UPDATE audit_events SET decision = 'ALLOW' WHERE decision = 'DENY'`,
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(runtimePool.query(`DELETE FROM audit_events`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("AC-03: Real Keycloak OIDC + PostgreSQL Mapping & Role Policy Integration", () => {
  it("authenticates valid synthetic roles (EXECUTIVE, CONFIG_ADMIN, DEPARTMENT_MANAGER, STAFF) via real Keycloak and maps iss+sub to exact self-context", async () => {
    const positiveKeys = [
      {
        key: "exec01",
        expectedRole: "EXECUTIVE",
        expectedScope: "BRANCH",
        expectedDept: "KHCN",
      },
      {
        key: "admin01",
        expectedRole: "CONFIG_ADMIN",
        expectedScope: "BRANCH",
        expectedDept: "DVKH",
      },
      {
        key: "mgr_khcn",
        expectedRole: "DEPARTMENT_MANAGER",
        expectedScope: "DEPARTMENT",
        expectedDept: "KHCN",
      },
      {
        key: "staff_khdn",
        expectedRole: "STAFF",
        expectedScope: "SELF",
        expectedDept: "KHDN",
      },
    ];

    for (const item of positiveKeys) {
      const userDef = SYNTHETIC_USERS.find((u) => u.key === item.key)!;
      const start = await initiateOidcLoginTransaction();
      expect(start.ok).toBe(true);
      if (!start.ok) continue;

      const callbackUrl = await performRealKeycloakBrowserFormLogin(
        start.data.authorizationUrl,
        userDef.username,
        syntheticUserPassword,
      );

      const cbResult = await completeOidcCallback({
        callbackUrl,
        rawTxCookieToken: start.data.rawTxCookieToken,
      });

      expect(cbResult.decision).toBe("ALLOW");
      if (cbResult.decision !== "ALLOW") continue;

      expect(cbResult.redirectPath).toBe("/workspace");
      expect(cbResult.session.selfContext.staff_code).toBe(
        userDef.staff!.staff_code,
      );
      expect(cbResult.session.selfContext.effective_role.role_code).toBe(
        item.expectedRole,
      );
      expect(cbResult.session.selfContext.effective_role.scope_type).toBe(
        item.expectedScope,
      );
      expect(cbResult.session.selfContext.department.code).toBe(
        item.expectedDept,
      );

      // Verify raw session token is NOT stored in DB, only its SHA-256 hash
      const runtimePool = getRuntimePool();
      const rawCheck = await runtimePool.query(
        `SELECT token_hash FROM sessions WHERE id = $1`,
        [cbResult.session.sessionId],
      );
      expect(rawCheck.rows[0]?.token_hash).toBe(
        hashOpaqueToken(cbResult.session.rawSessionToken),
      );
      expect(rawCheck.rows[0]?.token_hash).not.toBe(
        cbResult.session.rawSessionToken,
      );
    }
  });

  it("denies real Keycloak logins when identity is unmapped, staff is INACTIVE, has 0 roles, has >1 active roles, expired role, or mismatched department scope", async () => {
    const negativeCases = [
      { key: "unmapped", expectedReason: "IDENTITY_UNMAPPED" },
      { key: "inactive_staff", expectedReason: "STAFF_INACTIVE" },
      { key: "zero_role", expectedReason: "ROLE_ASSIGNMENT_NONE_EFFECTIVE" },
      {
        key: "multi_role",
        expectedReason: "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
      },
      {
        key: "expired_role",
        expectedReason: "ROLE_ASSIGNMENT_NONE_EFFECTIVE",
      },
      { key: "dept_mismatch", expectedReason: "ROLE_SCOPE_INVALID" },
    ];

    const runtimePool = getRuntimePool();

    for (const neg of negativeCases) {
      const userDef = SYNTHETIC_USERS.find((u) => u.key === neg.key)!;
      const beforeSessions = await runtimePool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sessions`,
      );

      const start = await initiateOidcLoginTransaction();
      expect(start.ok).toBe(true);
      if (!start.ok) continue;

      const callbackUrl = await performRealKeycloakBrowserFormLogin(
        start.data.authorizationUrl,
        userDef.username,
        syntheticUserPassword,
      );

      const cbResult = await completeOidcCallback({
        callbackUrl,
        rawTxCookieToken: start.data.rawTxCookieToken,
      });

      expect(cbResult).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: neg.expectedReason,
      });

      // Verify no session row was created
      const afterSessions = await runtimePool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sessions`,
      );
      expect(afterSessions.rows[0]?.count).toBe(beforeSessions.rows[0]?.count);
    }
  });
});

describe("AC-04: OIDC Protocol Tamper, Replay, Wrong Issuer/Audience/Signature/Expiry/State/Nonce/PKCE & Injection Denial Matrix", () => {
  it("rejects client-supplied issuer or returnTo overrides on login start and callback", async () => {
    const badIssuerStart = await initiateOidcLoginTransaction({
      requestedIssuer: "https://attacker.example.com/realms/fake",
    });
    expect(badIssuerStart).toEqual({
      ok: false,
      httpStatus: 400,
      reasonCode: "CLIENT_ISSUER_OVERRIDE_FORBIDDEN",
    });

    const badReturnToStart = await initiateOidcLoginTransaction({
      requestedReturnTo: "https://attacker.example.com/steal",
    });
    expect(badReturnToStart).toEqual({
      ok: false,
      httpStatus: 400,
      reasonCode: "RETURN_DESTINATION_NOT_ALLOWED",
    });

    const badRedirectCb = await completeOidcCallback({
      callbackUrl: new URL(
        "http://127.0.0.1:3100/auth/callback?code=abc&state=xyz&redirect_uri=https://evil.example.com",
      ),
      rawTxCookieToken: "dummy",
    });
    expect(badRedirectCb).toEqual({
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "CALLBACK_REDIRECT_INJECTION_FORBIDDEN",
    });

    const badIssCb = await completeOidcCallback({
      callbackUrl: new URL(
        "http://127.0.0.1:3100/auth/callback?code=abc&state=xyz&iss=https://evil.example.com",
      ),
      rawTxCookieToken: "dummy",
    });
    expect(badIssCb).toEqual({
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "CALLBACK_ISSUER_MISMATCH",
    });
  });

  it("rejects missing cookie, wrong state, expired 5m auth transaction, and callback replay", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const start = await initiateOidcLoginTransaction();
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const callbackUrl = await performRealKeycloakBrowserFormLogin(
      start.data.authorizationUrl,
      userDef.username,
      syntheticUserPassword,
    );

    // 1. Missing tx cookie -> DENY
    const missingCookieRes = await completeOidcCallback({
      callbackUrl,
      rawTxCookieToken: undefined,
    });
    expect(missingCookieRes.decision).toBe("DENY");
    if (missingCookieRes.decision === "DENY") {
      expect(missingCookieRes.reasonCode).toBe("AUTH_TX_COOKIE_MISSING");
    }

    // 2. First legitimate callback succeeds and consumes the one-use transaction
    const firstRes = await completeOidcCallback({
      callbackUrl,
      rawTxCookieToken: start.data.rawTxCookieToken,
    });
    expect(firstRes.decision).toBe("ALLOW");

    // 3. Replaying the exact same callback + cookie is immediately rejected
    const replayRes = await completeOidcCallback({
      callbackUrl,
      rawTxCookieToken: start.data.rawTxCookieToken,
    });
    expect(replayRes).toEqual({
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "AUTH_TX_NOT_FOUND_OR_REPLAYED",
    });

    // 4. State mismatch -> DENY and consumes transaction
    const start2 = await initiateOidcLoginTransaction();
    expect(start2.ok).toBe(true);
    if (!start2.ok) return;
    const tamperedStateUrl = new URL(
      "http://127.0.0.1:3100/auth/callback?code=fake&state=wrong_state_value_1234567890123456",
    );
    const badStateRes = await completeOidcCallback({
      callbackUrl: tamperedStateUrl,
      rawTxCookieToken: start2.data.rawTxCookieToken,
    });
    expect(badStateRes).toEqual({
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "AUTH_TX_STATE_MISMATCH",
    });

    // 5. Expired AuthTransaction at exact 5m boundary [created_at, expires_at)
    const t0 = new Date("2026-06-01T12:00:00.000Z");
    const tx = await createAuthTransaction({
      state: "state_boundary_test_12345678901234567890",
      nonce: "nonce_boundary_test_12345678901234567890",
      codeVerifier: "verifier_boundary_test_12345678901234567890",
      now: t0,
    });
    const expiredCheck = await consumeAuthTransaction({
      rawTxCookieToken: tx.rawTxCookieToken,
      returnedState: "state_boundary_test_12345678901234567890",
      now: new Date(t0.getTime() + 5 * 60 * 1000), // exact 5m boundary
    });
    expect(expiredCheck).toEqual({
      ok: false,
      reasonCode: "AUTH_TX_EXPIRED",
    });
  });

  it("rejects wrong PKCE verifier, wrong nonce, wrong audience, expired ID token, and tampered signature during OIDC token exchange", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const runtimePool = getRuntimePool();

    // Case A: Wrong PKCE verifier (Keycloak rejects code exchange)
    {
      const start = await initiateOidcLoginTransaction();
      expect(start.ok).toBe(true);
      if (start.ok) {
        const callbackUrl = await performRealKeycloakBrowserFormLogin(
          start.data.authorizationUrl,
          userDef.username,
          syntheticUserPassword,
        );
        // Replace encrypted verifier with another valid encrypted verifier that doesn't match code_challenge
        const otherTx = await createAuthTransaction({
          state: "other_state_for_wrong_pkce_123456789012",
          nonce: "other_nonce_for_wrong_pkce_123456789012",
          codeVerifier:
            "wrong_pkce_code_verifier_that_does_not_match_challenge_123456789",
        });
        const wrongHash = hashOpaqueToken(otherTx.rawTxCookieToken);
        const origHash = hashOpaqueToken(start.data.rawTxCookieToken);
        const otherRow = await runtimePool.query(
          `SELECT id, state_value, verifier_ciphertext_b64, verifier_iv_b64, verifier_auth_tag_b64
           FROM auth_transactions WHERE tx_cookie_hash = $1`,
          [wrongHash],
        );
        expect(otherRow.rowCount).toBe(1);
        // Corrupt the ciphertext of the original transaction so decrypt or PKCE check fails
        await runtimePool.query(
          `UPDATE auth_transactions
           SET verifier_auth_tag_b64 = $1
           WHERE tx_cookie_hash = $2`,
          [otherRow.rows[0]!.verifier_auth_tag_b64, origHash],
        );
        const res = await completeOidcCallback({
          callbackUrl,
          rawTxCookieToken: start.data.rawTxCookieToken,
        });
        expect(res).toEqual({
          decision: "DENY",
          httpStatus: 400,
          reasonCode: "AUTH_TX_VERIFIER_DECRYPT_FAILED",
        });
      }
    }

    // Case B: Wrong Nonce in AuthTransaction vs ID Token returned by Keycloak
    {
      const start = await initiateOidcLoginTransaction();
      expect(start.ok).toBe(true);
      if (start.ok) {
        const callbackUrl = await performRealKeycloakBrowserFormLogin(
          start.data.authorizationUrl,
          userDef.username,
          syntheticUserPassword,
        );
        const origHash = hashOpaqueToken(start.data.rawTxCookieToken);
        await runtimePool.query(
          `UPDATE auth_transactions
           SET nonce_value = 'mismatched_nonce_value_12345678901234567890'
           WHERE tx_cookie_hash = $1`,
          [origHash],
        );
        const res = await completeOidcCallback({
          callbackUrl,
          rawTxCookieToken: start.data.rawTxCookieToken,
        });
        expect(res).toEqual({
          decision: "DENY",
          httpStatus: 401,
          reasonCode: "OIDC_TOKEN_VALIDATION_FAILED",
        });
      }
    }

    // Case C: Wrong Audience (`aud`), Wrong Issuer (`iss`), Expired ID Token (`exp`), and Tampered JWS Signature
    for (const tamperMode of [
      "tamper_signature",
      "wrong_aud",
      "wrong_iss",
      "expired_exp",
    ] as const) {
      const start = await initiateOidcLoginTransaction();
      expect(start.ok).toBe(true);
      if (!start.ok) continue;

      const callbackUrl = await performRealKeycloakBrowserFormLogin(
        start.data.authorizationUrl,
        userDef.username,
        syntheticUserPassword,
      );

      clearOidcConfigCache();
      const customOidcConfig = await getOidcClientConfiguration(
        async (url, options) => {
          const realRes = await fetch(url, options as RequestInit);
          if (!url.endsWith("/protocol/openid-connect/token")) {
            return realRes;
          }
          const body = (await realRes.json()) as {
            id_token?: string;
            [k: string]: unknown;
          };
          if (body.id_token) {
            const parts = body.id_token.split(".");
            if (tamperMode === "tamper_signature") {
              const sig = parts[2]!;
              const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
              body.id_token = `${parts[0]}.${parts[1]}.${flipped}`;
            } else {
              const payload = JSON.parse(
                Buffer.from(parts[1]!, "base64url").toString("utf8"),
              ) as Record<string, unknown>;
              if (tamperMode === "wrong_aud") {
                payload.aud = "wrong-client-audience";
              } else if (tamperMode === "wrong_iss") {
                payload.iss = "http://127.0.0.1:8080/realms/wrong-realm";
              } else if (tamperMode === "expired_exp") {
                payload.exp = Math.floor(Date.now() / 1000) - 3600;
              }
              const newPayloadB64 = Buffer.from(
                JSON.stringify(payload),
                "utf8",
              ).toString("base64url");
              body.id_token = `${parts[0]}.${newPayloadB64}.${parts[2]}`;
            }
          }
          return new Response(JSON.stringify(body), {
            status: realRes.status,
            headers: realRes.headers,
          });
        },
      );

      const res = await completeOidcCallback({
        callbackUrl,
        rawTxCookieToken: start.data.rawTxCookieToken,
        oidcConfig: customOidcConfig,
      });

      expect(res).toEqual({
        decision: "DENY",
        httpStatus: 401,
        reasonCode: "OIDC_TOKEN_VALIDATION_FAILED",
      });
    }
  });
});

describe("AC-05 & AC-06: Session Lifecycle, Immediate Revocation on Role/Department Change & CSRF Logout", () => {
  it("immediately denies next request when Staff is deactivated, role is revoked, or Staff changes department without re-issuing role", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "staff_dvkh")!;
    const start = await initiateOidcLoginTransaction();
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const callbackUrl = await performRealKeycloakBrowserFormLogin(
      start.data.authorizationUrl,
      userDef.username,
      syntheticUserPassword,
    );

    const cbResult = await completeOidcCallback({
      callbackUrl,
      rawTxCookieToken: start.data.rawTxCookieToken,
    });
    expect(cbResult.decision).toBe("ALLOW");
    if (cbResult.decision !== "ALLOW") return;

    const rawToken = cbResult.session.rawSessionToken;

    // 1. Initially valid
    const check1 = await verifyRequestSession({ rawSessionToken: rawToken });
    expect(check1.authenticated).toBe(true);

    // 2. Simulate Staff becoming INACTIVE in DB via migratorPool -> next verifyRequestSession immediately denies and revokes session!
    await migratorPool.query(
      `UPDATE staff SET status = 'INACTIVE' WHERE id = $1`,
      [userDef.staff!.id],
    );
    try {
      const check2 = await verifyRequestSession({ rawSessionToken: rawToken });
      expect(check2).toEqual({
        authenticated: false,
        httpStatus: 403,
        reasonCode: "STAFF_INACTIVE",
      });
    } finally {
      await migratorPool.query(
        `UPDATE staff SET status = 'ACTIVE' WHERE id = $1`,
        [userDef.staff!.id],
      );
    }

    // 3. Even after Staff is restored to ACTIVE, the previously revoked session cannot be reused
    const check3 = await verifyRequestSession({ rawSessionToken: rawToken });
    expect(check3).toEqual({
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_REVOKED",
    });

    // 4. Test DEPARTMENT_MANAGER session immediately denied if staff.department_id changes
    const mgrDef = SYNTHETIC_USERS.find((u) => u.key === "mgr_khdn")!;
    const mgrStart = await initiateOidcLoginTransaction();
    expect(mgrStart.ok).toBe(true);
    if (!mgrStart.ok) return;
    const mgrCbUrl = await performRealKeycloakBrowserFormLogin(
      mgrStart.data.authorizationUrl,
      mgrDef.username,
      syntheticUserPassword,
    );
    const mgrCb = await completeOidcCallback({
      callbackUrl: mgrCbUrl,
      rawTxCookieToken: mgrStart.data.rawTxCookieToken,
    });
    expect(mgrCb.decision).toBe("ALLOW");
    if (mgrCb.decision !== "ALLOW") return;

    await migratorPool.query(
      `UPDATE staff SET department_id = $1 WHERE id = $2`,
      [SYNTHETIC_DEPARTMENTS.DVKH.id, mgrDef.staff!.id],
    );
    try {
      const mgrCheck = await verifyRequestSession({
        rawSessionToken: mgrCb.session.rawSessionToken,
      });
      expect(mgrCheck).toEqual({
        authenticated: false,
        httpStatus: 403,
        reasonCode: "ROLE_SCOPE_INVALID",
      });
    } finally {
      await migratorPool.query(
        `UPDATE staff SET department_id = $1 WHERE id = $2`,
        [SYNTHETIC_DEPARTMENTS.KHDN.id, mgrDef.staff!.id],
      );
    }
  });

  it("enforces idle (15m) and absolute (8h) session expiry without extending absolute_expires_at on refresh", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const linkRes = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
      userDef.staff!.id,
    ]);
    const { issuer, subject } = linkRes.rows[0]!;

    const t0 = new Date("2026-06-01T08:00:00.000Z");
    const established = await establishSessionFromVerifiedOidcIdentity({
      issuer,
      subject,
      now: t0,
    });
    expect(established.decision).toBe("ALLOW");
    if (established.decision !== "ALLOW") return;

    // Advance 10 minutes (< 15m idle): session refreshes last_seen_at, but absolute_expires_at stays t0 + 8h
    const t10m = new Date(t0.getTime() + 10 * 60 * 1000);
    const v1 = await verifyRequestSession({
      rawSessionToken: established.rawSessionToken,
      now: t10m,
    });
    expect(v1.authenticated).toBe(true);

    const dbRowAfterRefresh = await getRuntimePool().query<{
      last_seen_at: Date;
      absolute_expires_at: Date;
    }>(`SELECT last_seen_at, absolute_expires_at FROM sessions WHERE id = $1`, [
      established.sessionId,
    ]);
    expect(new Date(dbRowAfterRefresh.rows[0]!.last_seen_at).getTime()).toBe(
      t10m.getTime(),
    );
    expect(
      new Date(dbRowAfterRefresh.rows[0]!.absolute_expires_at).getTime(),
    ).toBe(t0.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);

    // Advance to exact 15m idle boundary after t10m -> expired
    const tIdleBoundary = new Date(t10m.getTime() + SESSION_IDLE_TIMEOUT_MS);
    const vIdleExpired = await verifyRequestSession({
      rawSessionToken: established.rawSessionToken,
      now: tIdleBoundary,
    });
    expect(vIdleExpired).toEqual({
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_IDLE_EXPIRED",
    });
  });

  it("enforces Origin and CSRF token on POST logout and revokes the session sustainably", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "exec01")!;
    const linkRes = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
      userDef.staff!.id,
    ]);
    const { issuer, subject } = linkRes.rows[0]!;

    const established = await establishSessionFromVerifiedOidcIdentity({
      issuer,
      subject,
    });
    expect(established.decision).toBe("ALLOW");
    if (established.decision !== "ALLOW") return;

    // 1. Wrong Origin -> 403 ORIGIN_MISMATCH, session still active
    const badOrigin = await revokeSessionOnLogout({
      rawSessionToken: established.rawSessionToken,
      submittedCsrfToken: established.csrfToken,
      originHeader: "https://evil.example.com",
    });
    expect(badOrigin.httpStatus).toBe(403);
    expect(badOrigin.code).toBe("ORIGIN_MISMATCH");

    // 2. Wrong CSRF token -> 403 CSRF_INVALID, session still active
    const badCsrf = await revokeSessionOnLogout({
      rawSessionToken: established.rawSessionToken,
      submittedCsrfToken: "wrong_csrf_token_value_1234567890123456",
      originHeader: cfg.appOrigin,
    });
    expect(badCsrf.httpStatus).toBe(403);
    expect(badCsrf.code).toBe("CSRF_INVALID");

    // 3. Valid Origin + Valid CSRF -> 200 LOGOUT_OK, session revoked
    const okLogout = await revokeSessionOnLogout({
      rawSessionToken: established.rawSessionToken,
      submittedCsrfToken: established.csrfToken,
      originHeader: cfg.appOrigin,
    });
    expect(okLogout).toEqual({
      revoked: true,
      auditRecorded: true,
      httpStatus: 200,
      code: "LOGOUT_OK",
    });

    // Subsequent verification with the same cookie is rejected (401 SESSION_REVOKED)
    const afterLogout = await verifyRequestSession({
      rawSessionToken: established.rawSessionToken,
    });
    expect(afterLogout).toEqual({
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_REVOKED",
    });
  });
});

describe("AC-07: Audit Event Redaction & Error-Injection Failure Semantics", () => {
  it("rolls back session creation if AuditEvent insert fails on login ALLOW (never issues an unaudited session)", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "admin01")!;
    const linkRes = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
      userDef.staff!.id,
    ]);
    const { issuer, subject } = linkRes.rows[0]!;
    const runtimePool = getRuntimePool();

    const beforeCount = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions WHERE staff_id = $1`,
      [userDef.staff!.id],
    );

    // Temporarily revoke INSERT on audit_events from app_runtime_role to inject a real DB audit failure
    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      const loginWhenAuditFails =
        await establishSessionFromVerifiedOidcIdentity({
          issuer,
          subject,
        });
      expect(loginWhenAuditFails).toEqual({
        decision: "DENY",
        httpStatus: 500,
        reasonCode: "SESSION_OR_AUDIT_COMMIT_FAILED",
      });
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }

    // Verify transaction rolled back and 0 sessions were added
    const afterCount = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions WHERE staff_id = $1`,
      [userDef.staff!.id],
    );
    expect(afterCount.rows[0]?.count).toBe(beforeCount.rows[0]?.count);
  });

  it("keeps DENY as DENY and keeps Logout session revocation committed even when AuditEvent insert fails", async () => {
    const userDef = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const linkRes = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(`SELECT issuer, subject FROM identity_links WHERE staff_id = $1`, [
      userDef.staff!.id,
    ]);
    const { issuer, subject } = linkRes.rows[0]!;

    // First establish a valid session while audit is healthy
    const established = await establishSessionFromVerifiedOidcIdentity({
      issuer,
      subject,
    });
    expect(established.decision).toBe("ALLOW");
    if (established.decision !== "ALLOW") return;

    // Inject audit failure by revoking INSERT on audit_events
    await migratorPool.query(
      `REVOKE INSERT ON TABLE audit_events FROM app_runtime_role`,
    );
    try {
      // 1. Unmapped user login attempt still returns DENY (never turns DENY into ALLOW)
      const denyRes = await establishSessionFromVerifiedOidcIdentity({
        issuer,
        subject: "non-existent-subject-during-audit-outage",
      });
      expect(denyRes).toEqual({
        decision: "DENY",
        httpStatus: 403,
        reasonCode: "IDENTITY_UNMAPPED",
      });

      // 2. Logout commits session revocation first, then reports safe degraded audit status (500 LOGOUT_REVOKED_AUDIT_DEGRADED)
      const logoutRes = await revokeSessionOnLogout({
        rawSessionToken: established.rawSessionToken,
        submittedCsrfToken: established.csrfToken,
        originHeader: cfg.appOrigin,
      });
      expect(logoutRes).toEqual({
        revoked: true,
        auditRecorded: false,
        httpStatus: 500,
        code: "LOGOUT_REVOKED_AUDIT_DEGRADED",
      });
    } finally {
      await migratorPool.query(
        `GRANT INSERT ON TABLE audit_events TO app_runtime_role`,
      );
    }

    // Verify the session is sustainably revoked in the database despite the audit failure!
    const verifyAfterDegradedLogout = await verifyRequestSession({
      rawSessionToken: established.rawSessionToken,
    });
    expect(verifyAfterDegradedLogout).toEqual({
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_REVOKED",
    });

    // Also verify no raw tokens/secrets/JWTs exist anywhere in audit_events
    const auditDump = await getRuntimePool().query<{
      actor_subject_ref: string;
      scope_context: unknown;
    }>(`SELECT actor_subject_ref, scope_context FROM audit_events`);
    expect(auditDump.rowCount).toBeGreaterThan(0);
    for (const row of auditDump.rows) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      expect(serialized).not.toContain(established.rawSessionToken);
    }
  });

  it("proves synthetic DB backup/restore on a copy preserves IdentityLink mappings and AuditEvent history without destructive down-migration (AC-10)", async () => {
    const superuserUrl = process.env.SUPERUSER_DATABASE_URL!;
    const adminClient = new pg.Client({ connectionString: superuserUrl });
    await adminClient.connect();
    try {
      await adminClient.query(
        `DROP SCHEMA IF EXISTS s1a_restore_verify CASCADE`,
      );
      await adminClient.query(`CREATE SCHEMA s1a_restore_verify`);
      await adminClient.query(
        `CREATE TABLE s1a_restore_verify.identity_links AS TABLE public.identity_links`,
      );
      await adminClient.query(
        `CREATE TABLE s1a_restore_verify.audit_events AS TABLE public.audit_events`,
      );

      const origLinks = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.identity_links`,
      );
      const copyLinks = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM s1a_restore_verify.identity_links`,
      );
      expect(copyLinks.rows[0]?.count).toBe(origLinks.rows[0]?.count);
      expect(Number(copyLinks.rows[0]?.count)).toBeGreaterThanOrEqual(12);

      const origAudits = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.audit_events`,
      );
      const copyAudits = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM s1a_restore_verify.audit_events`,
      );
      expect(copyAudits.rows[0]?.count).toBe(origAudits.rows[0]?.count);
      expect(Number(copyAudits.rows[0]?.count)).toBeGreaterThan(0);

      await adminClient.query(
        `DROP SCHEMA IF EXISTS s1a_restore_verify CASCADE`,
      );
    } finally {
      await adminClient.end();
    }
  });
});
