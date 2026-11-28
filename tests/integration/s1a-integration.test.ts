import { execFileSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
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
import { hashOpaqueToken, encryptVerifierAes256Gcm } from "@/server/crypto";
import { closeRuntimePool, getRuntimePool, type Queryable } from "@/server/db";
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
  // Clean up any leftover ephemeral S1-B/E2E test fixtures before verifying baseline 3-department state
  const tempStaffSubquery = `SELECT id FROM staff WHERE staff_code LIKE 'SYN-S1B-%' OR staff_code LIKE 'SYN-E2E-%' OR department_id IN (SELECT id FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH'))`;
  await migratorPool.query(
    `DELETE FROM in_app_alerts WHERE owner_staff_id IN (${tempStaffSubquery}) OR escalated_to_staff_id IN (${tempStaffSubquery}) OR resolved_by_staff_id IN (${tempStaffSubquery}) OR department_id IN (SELECT id FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH'))`,
  );
  await migratorPool.query(
    `DELETE FROM audit_events WHERE actor_staff_id IN (${tempStaffSubquery})`,
  );
  await migratorPool.query(
    `DELETE FROM sessions WHERE staff_id IN (${tempStaffSubquery})`,
  );
  await migratorPool.query(
    `UPDATE role_assignment_proposals SET applied_assignment_id = NULL WHERE target_staff_id IN (${tempStaffSubquery}) OR scope_department_id IN (SELECT id FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH'))`,
  );
  await migratorPool.query(
    `DELETE FROM role_assignment_proposals WHERE target_staff_id IN (${tempStaffSubquery}) OR scope_department_id IN (SELECT id FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH'))`,
  );
  await migratorPool.query(
    `DELETE FROM role_assignments WHERE staff_id IN (${tempStaffSubquery}) OR scope_department_id IN (SELECT id FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH'))`,
  );
  await migratorPool.query(
    `DELETE FROM identity_links WHERE staff_id IN (${tempStaffSubquery})`,
  );
  await migratorPool.query(
    `DELETE FROM staff WHERE id IN (${tempStaffSubquery})`,
  );
  await migratorPool.query(
    `DELETE FROM departments WHERE code NOT IN ('KHCN', 'KHDN', 'DVKH')`,
  );
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

    await expect(
      runtimePool.query("SELECT * FROM audit_events"),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      runtimePool.query("CREATE TEMP TABLE unauthorized_runtime_temp (id INT)"),
    ).rejects.toThrow(/permission denied/i);

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
        // Keep GCM ciphertext/AAD valid while deliberately mismatching the S256 challenge.
        const origHash = hashOpaqueToken(start.data.rawTxCookieToken);
        const row = await runtimePool.query<{
          id: string;
          state_value: string;
        }>(
          `SELECT id, state_value FROM auth_transactions WHERE tx_cookie_hash = $1`,
          [origHash],
        );
        const tx = row.rows[0]!;
        const wrong = encryptVerifierAes256Gcm(
          "wrong_pkce_verifier_that_does_not_match_the_real_challenge_123456789",
          cfg.authTxEncryptionKey,
          `${tx.id}|${origHash}|${tx.state_value}`,
        );
        await runtimePool.query(
          `UPDATE auth_transactions SET verifier_ciphertext_b64=$1,
             verifier_iv_b64=$2, verifier_auth_tag_b64=$3 WHERE tx_cookie_hash=$4`,
          [wrong.ciphertextB64, wrong.ivB64, wrong.authTagB64, origHash],
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
    // Negative-test wire seam only: real discovery/form login/code exchange remain in use.
    // Re-sign changed claims and serve that test key via JWKS so claims cannot fail
    // merely because the original signature became invalid. Happy-path proof stays real Keycloak.
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "synthetic-negative-key",
      use: "sig",
      alg: "RS256",
    };
    for (const tamperMode of [
      "valid_control",
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
          if (
            tamperMode !== "tamper_signature" &&
            url.endsWith("/protocol/openid-connect/certs")
          ) {
            return new Response(JSON.stringify({ keys: [jwk] }), {
              headers: { "content-type": "application/json" },
            });
          }
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
              const header = Buffer.from(
                JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }),
              ).toString("base64url");
              const signingInput = Buffer.from(`${header}.${newPayloadB64}`);
              const signature = sign("RSA-SHA256", signingInput, privateKey);
              expect(
                verify("RSA-SHA256", signingInput, publicKey, signature),
              ).toBe(true);
              body.id_token = `${header}.${newPayloadB64}.${signature.toString("base64url")}`;
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

      if (tamperMode === "valid_control") {
        // Calibration of the SAME negative-test JWKS seam, not real-IdP happy-path evidence.
        expect(res.decision).toBe("ALLOW");
        if (res.decision === "ALLOW") {
          await revokeSessionOnLogout({
            rawSessionToken: res.session.rawSessionToken,
            submittedCsrfToken: res.session.csrfToken,
            originHeader: cfg.appOrigin,
          });
        }
      } else {
        expect(res.decision).toBe("DENY"); // Avoid printing token/session data on failure.
        expect(res).toEqual({
          decision: "DENY",
          httpStatus: 401,
          reasonCode: "OIDC_TOKEN_VALIDATION_FAILED",
        });
      }
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
        httpStatus: 401,
        reasonCode: "SESSION_REVOKED",
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
        httpStatus: 401,
        reasonCode: "SESSION_REVOKED",
      });
    } finally {
      await migratorPool.query(
        `UPDATE staff SET department_id = $1 WHERE id = $2`,
        [SYNTHETIC_DEPARTMENTS.KHDN.id, mgrDef.staff!.id],
      );
    }
  });

  it("waits for concurrent mapping changes before reading authority and issuing a session", async () => {
    const user = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const identity = (
      await migratorPool.query<{ id: string; issuer: string; subject: string }>(
        "SELECT id, issuer, subject FROM identity_links WHERE staff_id=$1 AND status='ACTIVE'",
        [user.staff!.id],
      )
    ).rows[0]!;
    const writer = await migratorPool.connect();
    const appName = `s1a_race_${randomUUID()}`;
    const racePool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      application_name: appName,
      max: 1,
    });
    let pending:
      ReturnType<typeof establishSessionFromVerifiedOidcIdentity> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE identity_links SET subject=$1 WHERE id=$2", [
        `changed-${randomUUID()}`,
        identity.id,
      ]);
      pending = establishSessionFromVerifiedOidcIdentity({
        issuer: identity.issuer,
        subject: identity.subject,
        pool: racePool,
      });
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        waiting = (
          await migratorPool.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name=$1 AND l.locktype='advisory' AND NOT l.granted) AS waiting",
            [appName],
          )
        ).rows[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await writer.query("COMMIT");
      const result = await pending;
      expect(result.decision).toBe("DENY");
      if (result.decision === "DENY")
        expect(result.reasonCode).toBe("IDENTITY_UNMAPPED");
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      if (pending) await pending.catch(() => undefined);
      await racePool.end();
      await migratorPool.query(
        "UPDATE identity_links SET subject=$1 WHERE id=$2",
        [identity.subject, identity.id],
      );
    }
  });

  it("revokes existing SELF sessions on same-ID role changes and department transfers", async () => {
    const user = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const staffId = user.staff!.id;
    const original = await migratorPool.query<{ department_id: string }>(
      "SELECT department_id FROM staff WHERE id=$1",
      [staffId],
    );
    const identity = await migratorPool.query<{
      issuer: string;
      subject: string;
    }>(
      "SELECT issuer, subject FROM identity_links WHERE staff_id=$1 AND status='ACTIVE'",
      [staffId],
    );
    const role = user.roleAssignments[0]!;
    const first = await establishSessionFromVerifiedOidcIdentity(
      identity.rows[0]!,
    );
    expect(first.decision).toBe("ALLOW");
    if (first.decision !== "ALLOW")
      throw new Error("Fixture could not establish first session");
    try {
      await migratorPool.query(
        "UPDATE role_assignments SET role_code='EXECUTIVE', scope_type='BRANCH' WHERE id=$1",
        [role.id],
      );
      expect(
        await verifyRequestSession({ rawSessionToken: first.rawSessionToken }),
      ).toEqual({
        authenticated: false,
        httpStatus: 401,
        reasonCode: "SESSION_REVOKED",
      });
    } finally {
      await migratorPool.query(
        "UPDATE role_assignments SET role_code=$1, scope_type=$2, scope_department_id=$3 WHERE id=$4",
        [role.role_code, role.scope_type, role.scope_department_id, role.id],
      );
    }
    const second = await establishSessionFromVerifiedOidcIdentity(
      identity.rows[0]!,
    );
    expect(second.decision).toBe("ALLOW");
    if (second.decision !== "ALLOW")
      throw new Error("Fixture could not establish second session");
    try {
      await migratorPool.query(
        "UPDATE staff SET department_id=$1 WHERE id=$2",
        [SYNTHETIC_DEPARTMENTS.DVKH.id, staffId],
      );
      expect(
        await verifyRequestSession({ rawSessionToken: second.rawSessionToken }),
      ).toEqual({
        authenticated: false,
        httpStatus: 401,
        reasonCode: "SESSION_REVOKED",
      });
    } finally {
      await migratorPool.query(
        "UPDATE staff SET department_id=$1 WHERE id=$2",
        [original.rows[0]!.department_id, staffId],
      );
    }
  });

  it("denies an old cookie if its role changes between the session read and guarded refresh", async () => {
    const user = SYNTHETIC_USERS.find((u) => u.key === "staff_khcn")!;
    const identity = (
      await migratorPool.query<{ issuer: string; subject: string }>(
        "SELECT issuer, subject FROM identity_links WHERE staff_id=$1 AND status='ACTIVE'",
        [user.staff!.id],
      )
    ).rows[0]!;
    const session = await establishSessionFromVerifiedOidcIdentity(identity);
    expect(session.decision).toBe("ALLOW");
    if (session.decision !== "ALLOW")
      throw new Error("Fixture could not establish a session");
    const role = user.roleAssignments[0]!;
    let changed = false;
    const racingDb: Queryable = {
      async query(text, values) {
        if (!changed && text.includes("FROM role_assignments")) {
          changed = true;
          await migratorPool.query(
            "UPDATE role_assignments SET role_code='EXECUTIVE', scope_type='BRANCH' WHERE id=$1",
            [role.id],
          );
        }
        return getRuntimePool().query(text, values);
      },
    };
    try {
      const result = await verifyRequestSession({
        rawSessionToken: session.rawSessionToken,
        db: racingDb,
      });
      expect(changed).toBe(true);
      expect(result.authenticated).toBe(false);
      const audit = await migratorPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE action='auth.session.verify' AND resource_id=$1 AND reason_code='SESSION_REVOKED' AND decision='DENY'",
        [session.sessionId],
      );
      expect(Number(audit.rows[0]!.count)).toBeGreaterThan(0);
      if (!result.authenticated)
        expect(result.reasonCode).toBe("SESSION_REVOKED");
    } finally {
      await migratorPool.query(
        "UPDATE role_assignments SET role_code=$1, scope_type=$2, scope_department_id=$3 WHERE id=$4",
        [role.role_code, role.scope_type, role.scope_department_id, role.id],
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
    const auditDump = await migratorPool.query<{
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

  it("restores a real pg_dump into a new synthetic database and preserves rows/constraints without deleting existing data (AC-10)", async () => {
    const source = process.env.SUPERUSER_DATABASE_URL!;
    const target = validateMigrationTarget({
      appEnv: cfg.appEnv,
      databaseUrl: source,
    });
    const backupDatabase = `s1a_restore_${randomUUID().replaceAll("-", "")}`;
    const restoredUrl = new URL(source);
    restoredUrl.pathname = `/${backupDatabase}`;
    const admin = new pg.Client({ connectionString: source });
    const restored = new pg.Client({
      connectionString: restoredUrl.toString(),
    });
    const context =
      process.env.DOCKER_CONTEXT ??
      (process.platform === "darwin" ? "colima-baocaobanhang" : "default");
    const tool = (args: string[], input?: Buffer): Buffer => {
      try {
        return execFileSync(
          "docker",
          [
            "--context",
            context,
            "exec",
            "-i",
            "baocaobanhang-s1a-postgres",
            ...args,
          ],
          {
            input,
            stdio: ["pipe", "pipe", "pipe"],
            maxBuffer: 32 * 1024 * 1024,
            timeout: 30_000,
          },
        );
      } catch {
        throw new Error(
          "Synthetic backup/restore tool failed; raw dumps and credentials are withheld from logs",
        );
      }
    };
    await admin.connect();
    try {
      expect(
        (
          await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
            backupDatabase,
          ])
        ).rowCount,
      ).toBe(0);
      // Generated identifier contains only a fixed prefix and hexadecimal UUID.
      await admin.query(
        `CREATE DATABASE "${backupDatabase}" TEMPLATE template0`,
      );
      const dump = tool([
        "pg_dump",
        "--username=postgres",
        `--dbname=${target.dbName}`,
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--schema=public",
      ]);
      // template0 already provides public. Skip only its CREATE SCHEMA TOC entry,
      // retaining every function/table/data/constraint and never dropping the existing schema.
      const toc = tool(["pg_restore", "--list"], dump).toString("utf8");
      const schemaEntry = /^\d+;\s+\d+\s+\d+\s+SCHEMA - public(?:\s|$)/;
      const entries = toc.split("\n");
      expect(entries.filter((line) => schemaEntry.test(line)).length).toBe(1);
      const restoreList = entries
        .filter((line) => !schemaEntry.test(line))
        .join("\n");
      const listPath = `/tmp/${backupDatabase}.list`;
      tool(
        ["sh", "-c", 'umask 077; cat > "$1"', "sh", listPath],
        Buffer.from(restoreList),
      );
      tool(
        [
          "pg_restore",
          `--use-list=${listPath}`,
          "--username=postgres",
          `--dbname=${backupDatabase}`,
          "--no-owner",
          "--no-acl",
          "--exit-on-error",
        ],
        dump,
      );
      await restored.connect();
      for (const table of [
        "departments",
        "staff",
        "identity_links",
        "role_assignments",
        "role_assignment_proposals",
        "branch_calendar_days",
        "kpi_definitions",
        "kpi_targets",
        "kpi_target_revisions",
        "sessions",
        "auth_transactions",
        "audit_events",
      ] as const) {
        const orderCol =
          table === "branch_calendar_days" ? "calendar_date" : "id";
        const query = `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${orderCol}), '[]'::jsonb) AS data FROM public.${table} t`;
        const original = await admin.query(query);
        const copy = await restored.query(query);
        const digest = (data: unknown) =>
          createHash("sha256").update(JSON.stringify(data)).digest("hex");
        // Hash comparisons avoid printing session/transaction data on assertion failure.
        expect(digest(copy.rows[0]!.data), `${table} content hash`).toBe(
          digest(original.rows[0]!.data),
        );
      }
      const columns =
        "SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,character_maximum_length,numeric_precision,numeric_scale,datetime_precision FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position";
      expect((await restored.query(columns)).rows).toEqual(
        (await admin.query(columns)).rows,
      );
      const constraints =
        "SELECT t.relname AS table_name, c.conname, c.contype, c.convalidated, c.condeferrable, c.condeferred, c.conkey, c.confkey, c.confupdtype, c.confdeltype, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace='public'::regnamespace ORDER BY t.relname,c.conname";
      const sourceConstraints = (await admin.query(constraints)).rows;
      const copyConstraints = (await restored.query(constraints)).rows;
      const metadata = (rows: typeof sourceConstraints) =>
        rows.map(({ definition: _definition, ...rest }) => {
          void _definition;
          return rest;
        });
      expect(metadata(copyConstraints)).toEqual(metadata(sourceConstraints));
      for (let index = 0; index < sourceConstraints.length; index++) {
        const sourceConstraint = sourceConstraints[index]!;
        const copyConstraint = copyConstraints[index]!;
        if (
          sourceConstraint.contype === "c" &&
          sourceConstraint.definition !== copyConstraint.definition
        ) {
          // pg_dump round-trips equivalent array casts into a different deparse form.
          // Reparse BOTH CHECK definitions with the same PostgreSQL parser before comparing;
          // retain exact comparisons for all other constraint kinds and all metadata above.
          expect(
            new Set([
              "departments",
              "staff",
              "identity_links",
              "role_assignments",
              "role_assignment_proposals",
              "branch_calendar_days",
              "kpi_definitions",
              "kpi_targets",
              "kpi_target_revisions",
              "sales_plans",
              "activity_logs",
              "monday_reviews",
              "directive_tasks",
              "kpi_actual_records",
              "kpi_actual_adjustments",
              "prospects",
              "leads",
              "opportunities",
              "pipeline_stage_transitions",
              "alert_rule_configs",
              "in_app_alerts",
              "customer_references",
              "customer_milestones",
              "sessions",
              "auth_transactions",
              "audit_events",
            ]).has(sourceConstraint.table_name),
          ).toBe(true);
          const scratch = `check_roundtrip_${index}`;
          await restored.query(
            `CREATE TEMP TABLE "${scratch}" (LIKE public."${sourceConstraint.table_name}")`,
          );
          await restored.query(
            `ALTER TABLE "${scratch}" ADD CONSTRAINT source_check ${sourceConstraint.definition}`,
          );
          await restored.query(
            `ALTER TABLE "${scratch}" ADD CONSTRAINT restored_check ${copyConstraint.definition}`,
          );
          const normalized = await restored.query<{ definition: string }>(
            "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname IN ('source_check','restored_check') ORDER BY conname",
            [scratch],
          );
          expect(normalized.rowCount).toBe(2);
          expect(normalized.rows[0]!.definition).toBe(
            normalized.rows[1]!.definition,
          );
        } else {
          expect(copyConstraint.definition).toBe(sourceConstraint.definition);
        }
      }
      // Preserve the new copy for inspection. No DROP/down/reset or overwrite of an existing target.
      console.log(
        `[restore-proof] Created and verified synthetic copy ${backupDatabase}; no existing database/schema was deleted.`,
      );
    } finally {
      await restored.end();
      await admin.end();
    }
  }, 60_000);
});
