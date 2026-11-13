import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeAuditScopeContext } from "@/server/audit";
import { validateAndBuildRuntimeConfig } from "@/server/config";
import {
  constantTimeEqual,
  createSafeSubjectRef,
  decryptVerifierAes256Gcm,
  encryptVerifierAes256Gcm,
  generateOpaqueToken,
  hashOpaqueToken,
} from "@/server/crypto";
import {
  evaluateActionAuthorization,
  evaluateIdentityAndRolePolicy,
  isRoleAssignmentEffectiveAt,
  isValidRoleScopePair,
  type DepartmentRecord,
  type IdentityLinkRecord,
  type RoleAssignmentRecord,
  type StaffRecord,
} from "@/server/policy";
import {
  AUTH_START_RATE_LIMIT_MAX_REQUESTS,
  AUTH_START_RATE_LIMIT_WINDOW_MS,
  checkAuthStartRateLimit,
  resetAuthStartRateLimitBuckets,
} from "@/server/rate-limit";
import {
  AUTH_TX_TTL_MS,
  buildCookieHeaderValue,
  isSessionActiveUnderTimeouts,
  isWithinHalfOpenWindow,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "@/server/session";

const DEPT_KHCN: DepartmentRecord = {
  id: "11111111-1111-4111-8111-111111111101",
  code: "KHCN",
  name: "Phòng Khách hàng Cá nhân (Synthetic)",
  status: "ACTIVE",
};

const DEPT_KHDN: DepartmentRecord = {
  id: "11111111-1111-4111-8111-111111111102",
  code: "KHDN",
  name: "Phòng Khách hàng Doanh nghiệp (Synthetic)",
  status: "ACTIVE",
};

const STAFF_KHCN: StaffRecord = {
  id: "22222222-2222-4222-8222-222222222205",
  staff_code: "SYN-STAFF-KHCN-01",
  display_name: "Chuyên viên KHCN Synthetic 01",
  department_id: DEPT_KHCN.id,
  status: "ACTIVE",
};

const LINK_KHCN: IdentityLinkRecord = {
  id: "33333333-3333-4333-8333-333333333305",
  issuer: "http://127.0.0.1:8080/realms/branch-sales-dev",
  subject: "sub-staff-khcn-01",
  staff_id: STAFF_KHCN.id,
  status: "ACTIVE",
};

const ROLE_STAFF_ACTIVE: RoleAssignmentRecord = {
  id: "44444444-4444-4444-8444-444444444405",
  staff_id: STAFF_KHCN.id,
  role_code: "STAFF",
  scope_type: "SELF",
  scope_department_id: null,
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: "2027-01-01T00:00:00.000Z",
  status: "ACTIVE",
};

describe("S1-A Crypto & Token Security Primitives (AC-04, AC-05)", () => {
  it("generates >= 256-bit opaque tokens and hashes them with SHA-256 without storing plaintext", () => {
    const token = generateOpaqueToken(32);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const hash = hashOpaqueToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(() => generateOpaqueToken(16)).toThrow(/at least 32 bytes/i);
  });

  it("encrypts and decrypts PKCE code_verifier with AES-256-GCM and rejects any tampering", () => {
    const key = randomBytes(32);
    const verifier = "pkce_verifier_random_value_with_high_entropy_1234567890";
    const aad = "tx-1|cookie-hash|state-1";

    const encrypted = encryptVerifierAes256Gcm(verifier, key, aad);
    expect(encrypted.ciphertextB64).not.toContain(verifier);

    const decrypted = decryptVerifierAes256Gcm(encrypted, key, aad);
    expect(decrypted).toBe(verifier);

    // Tamper with AAD
    expect(() =>
      decryptVerifierAes256Gcm(
        encrypted,
        key,
        "tx-1|cookie-hash|state-tampered",
      ),
    ).toThrow();

    // Tamper with authTag
    const badTag = Buffer.from(encrypted.authTagB64, "base64");
    badTag[0] = (badTag[0]! ^ 0xff) & 0xff;
    expect(() =>
      decryptVerifierAes256Gcm(
        { ...encrypted, authTagB64: badTag.toString("base64") },
        key,
        aad,
      ),
    ).toThrow();

    // Tamper with ciphertext
    const badCipher = Buffer.from(encrypted.ciphertextB64, "base64");
    badCipher[0] = (badCipher[0]! ^ 0xff) & 0xff;
    expect(() =>
      decryptVerifierAes256Gcm(
        { ...encrypted, ciphertextB64: badCipher.toString("base64") },
        key,
        aad,
      ),
    ).toThrow();
  });

  it("compares CSRF/state strings in constant time and redacts secrets from audit scope context", () => {
    expect(constantTimeEqual("abc123xyz", "abc123xyz")).toBe(true);
    expect(constantTimeEqual("abc123xyz", "abc123xy0")).toBe(false);
    expect(constantTimeEqual("short", "longer_string")).toBe(false);

    const safeRef = createSafeSubjectRef(
      "http://127.0.0.1:8080/realms/branch-sales-dev",
      "user-uuid-123",
    );
    expect(safeRef).toMatch(/^oidc_sub_sha256:[0-9a-f]{24}$/);

    const mockHeaderPayload = [
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0",
      "eyJzdWIiOiIxMjMifQ",
    ].join(".");
    const sanitized = sanitizeAuditScopeContext({
      role_code: "STAFF",
      access_token: "synthetic_access_value",
      id_token: `${mockHeaderPayload}.sig`,
      raw_jwt_value: mockHeaderPayload,
      customer_email: "khachhang@example.com",
    });
    expect(sanitized.role_code).toBe("STAFF");
    expect(sanitized.access_token).toBe("[REDACTED]");
    expect(sanitized.id_token).toBe("[REDACTED]");
    expect(sanitized.raw_jwt_value).toBe("[REDACTED]");
    expect(sanitized.customer_email).toBe("[REDACTED]");
  });
});

describe("S1-A Clock-Boundary & Session Cookie Contract (AC-05)", () => {
  it("enforces exact half-open interval [start, end) for 15m idle, 8h absolute, and 5m transaction timeouts", () => {
    const t0 = Date.UTC(2026, 10, 13, 10, 0, 0, 0);
    const txEnd = t0 + AUTH_TX_TTL_MS;

    // Start inclusive, end exclusive
    expect(isWithinHalfOpenWindow(t0, txEnd, t0)).toBe(true);
    expect(isWithinHalfOpenWindow(t0, txEnd, txEnd - 1)).toBe(true);
    expect(isWithinHalfOpenWindow(t0, txEnd, txEnd)).toBe(false);
    expect(isWithinHalfOpenWindow(t0, txEnd, t0 - 1)).toBe(false);

    const createdAt = new Date(t0);
    const absoluteExpiresAt = new Date(t0 + SESSION_ABSOLUTE_TIMEOUT_MS);

    // Exactly at start -> active
    expect(
      isSessionActiveUnderTimeouts({
        createdAt,
        lastSeenAt: createdAt,
        absoluteExpiresAt,
        revokedAt: null,
        now: new Date(t0),
      }),
    ).toEqual({ active: true, reasonCode: "ACTIVE" });

    // 1ms before 15m idle expiry -> active
    expect(
      isSessionActiveUnderTimeouts({
        createdAt,
        lastSeenAt: createdAt,
        absoluteExpiresAt,
        revokedAt: null,
        now: new Date(t0 + SESSION_IDLE_TIMEOUT_MS - 1),
      }),
    ).toEqual({ active: true, reasonCode: "ACTIVE" });

    // Exactly at 15m idle boundary -> expired (half-open [start, end))
    expect(
      isSessionActiveUnderTimeouts({
        createdAt,
        lastSeenAt: createdAt,
        absoluteExpiresAt,
        revokedAt: null,
        now: new Date(t0 + SESSION_IDLE_TIMEOUT_MS),
      }),
    ).toEqual({ active: false, reasonCode: "SESSION_IDLE_EXPIRED" });

    // 1ms before 8h absolute expiry (with recent lastSeenAt) -> active
    const lastSeenNearEnd = new Date(
      t0 + SESSION_ABSOLUTE_TIMEOUT_MS - 5 * 60 * 1000,
    );
    expect(
      isSessionActiveUnderTimeouts({
        createdAt,
        lastSeenAt: lastSeenNearEnd,
        absoluteExpiresAt,
        revokedAt: null,
        now: new Date(t0 + SESSION_ABSOLUTE_TIMEOUT_MS - 1),
      }),
    ).toEqual({ active: true, reasonCode: "ACTIVE" });

    // Exactly at 8h absolute boundary -> expired even if recently active
    expect(
      isSessionActiveUnderTimeouts({
        createdAt,
        lastSeenAt: lastSeenNearEnd,
        absoluteExpiresAt,
        revokedAt: null,
        now: new Date(t0 + SESSION_ABSOLUTE_TIMEOUT_MS),
      }),
    ).toEqual({ active: false, reasonCode: "SESSION_ABSOLUTE_EXPIRED" });
  });

  it("formats cookies with HttpOnly, SameSite=Lax, Path=/, no Domain, and no __Host- prefix on HTTP loopback", () => {
    const httpCookie = buildCookieHeaderValue({
      name: "bsos_s1a_session",
      value: "token123",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 28800,
    });
    expect(httpCookie).toBe(
      "bsos_s1a_session=token123; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800",
    );
    expect(httpCookie).not.toContain("Domain=");
    expect(httpCookie).not.toContain("__Host-");
    expect(httpCookie).not.toContain("Secure");
  });
});

describe("S1-A Role, Scope, and Temporal Policy Matrix (AC-02, AC-03, AC-06)", () => {
  it("enforces half-open interval [effective_from, effective_to) on RoleAssignment", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2027-01-01T00:00:00.000Z");

    expect(
      isRoleAssignmentEffectiveAt(
        ROLE_STAFF_ACTIVE,
        new Date(start.getTime() - 1),
      ),
    ).toBe(false);
    expect(isRoleAssignmentEffectiveAt(ROLE_STAFF_ACTIVE, start)).toBe(true);
    expect(
      isRoleAssignmentEffectiveAt(
        ROLE_STAFF_ACTIVE,
        new Date(end.getTime() - 1),
      ),
    ).toBe(true);
    expect(isRoleAssignmentEffectiveAt(ROLE_STAFF_ACTIVE, end)).toBe(false);
  });

  it("allows only when IdentityLink, Staff, Department are ACTIVE and exactly ONE valid RoleAssignment is effective", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");

    const ok = evaluateIdentityAndRolePolicy({
      now,
      identityLink: LINK_KHCN,
      staff: STAFF_KHCN,
      department: DEPT_KHCN,
      roleAssignments: [ROLE_STAFF_ACTIVE],
    });
    expect(ok.decision).toBe("ALLOW");
    if (ok.decision === "ALLOW") {
      expect(ok.selfContext.staff_code).toBe("SYN-STAFF-KHCN-01");
      expect(ok.selfContext.effective_role.role_code).toBe("STAFF");
      expect(ok.selfContext.effective_role.scope_type).toBe("SELF");
      // Ensure field allowlist (no approval_reference, no subject/issuer leaked)
      expect(Object.keys(ok.selfContext).sort()).toEqual([
        "department",
        "display_name",
        "effective_role",
        "staff_code",
        "staff_id",
        "status",
      ]);
    }

    // Unmapped identity -> DENY
    expect(
      evaluateIdentityAndRolePolicy({
        now,
        identityLink: null,
        staff: null,
        department: null,
        roleAssignments: [],
      }),
    ).toEqual({ decision: "DENY", reasonCode: "IDENTITY_UNMAPPED" });

    // Inactive staff -> DENY
    expect(
      evaluateIdentityAndRolePolicy({
        now,
        identityLink: LINK_KHCN,
        staff: { ...STAFF_KHCN, status: "INACTIVE" },
        department: DEPT_KHCN,
        roleAssignments: [ROLE_STAFF_ACTIVE],
      }),
    ).toEqual({ decision: "DENY", reasonCode: "STAFF_INACTIVE" });

    // Zero effective roles -> DENY
    expect(
      evaluateIdentityAndRolePolicy({
        now,
        identityLink: LINK_KHCN,
        staff: STAFF_KHCN,
        department: DEPT_KHCN,
        roleAssignments: [],
      }),
    ).toEqual({
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_NONE_EFFECTIVE",
    });

    // Multiple overlapping effective roles -> DENY (no union or arbitrary pick)
    const secondRole: RoleAssignmentRecord = {
      ...ROLE_STAFF_ACTIVE,
      id: "44444444-4444-4444-8444-444444444499",
      role_code: "DEPARTMENT_MANAGER",
      scope_type: "DEPARTMENT",
      scope_department_id: DEPT_KHCN.id,
    };
    expect(
      evaluateIdentityAndRolePolicy({
        now,
        identityLink: LINK_KHCN,
        staff: STAFF_KHCN,
        department: DEPT_KHCN,
        roleAssignments: [ROLE_STAFF_ACTIVE, secondRole],
      }),
    ).toEqual({
      decision: "DENY",
      reasonCode: "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
    });

    // Department manager with mismatched scope_department_id -> DENY
    const mismatchedMgr: RoleAssignmentRecord = {
      ...ROLE_STAFF_ACTIVE,
      role_code: "DEPARTMENT_MANAGER",
      scope_type: "DEPARTMENT",
      scope_department_id: DEPT_KHDN.id,
    };
    expect(isValidRoleScopePair(mismatchedMgr, STAFF_KHCN, DEPT_KHCN)).toBe(
      false,
    );
    expect(
      evaluateIdentityAndRolePolicy({
        now,
        identityLink: LINK_KHCN,
        staff: STAFF_KHCN,
        department: DEPT_KHCN,
        roleAssignments: [mismatchedMgr],
      }),
    ).toEqual({ decision: "DENY", reasonCode: "ROLE_SCOPE_INVALID" });
  });

  it("enforces ADR-002 action matrix: denies self-escalation, customer/KPI access for CONFIG_ADMIN, and cross-scope access", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const staffEval = evaluateIdentityAndRolePolicy({
      now,
      identityLink: LINK_KHCN,
      staff: STAFF_KHCN,
      department: DEPT_KHCN,
      roleAssignments: [ROLE_STAFF_ACTIVE],
    });
    expect(staffEval.decision).toBe("ALLOW");
    if (staffEval.decision !== "ALLOW") return;

    // STAFF reading own profile -> ALLOW
    expect(
      evaluateActionAuthorization({
        actorContext: staffEval.selfContext,
        action: "org.staff.read",
        targetStaffId: STAFF_KHCN.id,
      }).decision,
    ).toBe("ALLOW");

    // STAFF reading another staff profile -> DENY 404
    expect(
      evaluateActionAuthorization({
        actorContext: staffEval.selfContext,
        action: "org.staff.read",
        targetStaffId: "22222222-2222-4222-8222-222222222299",
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 404,
      reasonCode: "CROSS_STAFF_SELF_SCOPE_DENIED",
    });

    // CONFIG_ADMIN context
    const adminContext = {
      ...staffEval.selfContext,
      effective_role: {
        ...staffEval.selfContext.effective_role,
        role_code: "CONFIG_ADMIN" as const,
        scope_type: "BRANCH" as const,
      },
    };

    // CONFIG_ADMIN attempting self-escalation -> DENY 403
    expect(
      evaluateActionAuthorization({
        actorContext: adminContext,
        action: "authz.role.assign",
        targetStaffId: adminContext.staff_id,
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "SELF_ESCALATION_FORBIDDEN",
    });

    // CONFIG_ADMIN attempting customer/KPI read -> DENY 403
    expect(
      evaluateActionAuthorization({
        actorContext: adminContext,
        action: "customer.read",
      }),
    ).toEqual({
      decision: "DENY",
      httpStatus: 403,
      reasonCode: "CONFIG_ADMIN_CUSTOMER_KPI_FORBIDDEN",
    });
  });
});

describe("S1-A Runtime Config Refusals & Rate Limit (AC-02, AC-04)", () => {
  const validEnv = {
    APP_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3100",
    OIDC_ISSUER: "http://127.0.0.1:8080/realms/branch-sales-dev",
    OIDC_CLIENT_ID: "branch-sales-web",
    OIDC_CLIENT_SECRET: "ephemeral-secret-value-at-least-16-chars",
    OIDC_REDIRECT_URI: "http://127.0.0.1:3100/auth/callback",
    AUTH_TX_ENCRYPTION_KEY_HEX: "a1".repeat(32),
    DATABASE_URL:
      "postgresql://app_runtime_role:ephemeral_pass@127.0.0.1:55432/branch_sales_devtest",
  };

  it("accepts valid DEVTEST loopback config and refuses invalid APP_ENV, non-loopback origin/issuer, or superuser/migrator DB role", () => {
    const cfg = validateAndBuildRuntimeConfig(validEnv);
    expect(cfg.appEnv).toBe("test");
    expect(cfg.cookieSecure).toBe(false);

    expect(() =>
      validateAndBuildRuntimeConfig({ ...validEnv, APP_ENV: "production" }),
    ).toThrow(/APP_ENV/i);

    expect(() =>
      validateAndBuildRuntimeConfig({
        ...validEnv,
        APP_ORIGIN: "http://0.0.0.0:3100",
      }),
    ).toThrow(/APP_ORIGIN/i);

    expect(() =>
      validateAndBuildRuntimeConfig({
        ...validEnv,
        OIDC_ISSUER: "https://evil.example.com/realms/branch-sales-dev",
      }),
    ).toThrow(/OIDC_ISSUER/i);

    expect(() =>
      validateAndBuildRuntimeConfig({
        ...validEnv,
        DATABASE_URL:
          "postgresql://postgres:secret@127.0.0.1:55432/branch_sales_devtest",
      }),
    ).toThrow(/forbidden at runtime/i);

    expect(() =>
      validateAndBuildRuntimeConfig({
        ...validEnv,
        DATABASE_URL:
          "postgresql://app_runtime_role:secret@127.0.0.1:55432/production_db",
      }),
    ).toThrow(/not in the synthetic allowlist/i);
  });

  it("throttles /auth/login at 30 requests per minute per direct IP", () => {
    resetAuthStartRateLimitBuckets();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < AUTH_START_RATE_LIMIT_MAX_REQUESTS; i++) {
      const res = checkAuthStartRateLimit("127.0.0.1", t0 + i * 10);
      expect(res.allowed).toBe(true);
    }
    const blocked = checkAuthStartRateLimit("127.0.0.1", t0 + 500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // After 60s window expires, requests are allowed again
    const afterWindow = checkAuthStartRateLimit(
      "127.0.0.1",
      t0 + AUTH_START_RATE_LIMIT_WINDOW_MS + 1,
    );
    expect(afterWindow.allowed).toBe(true);
  });
});
