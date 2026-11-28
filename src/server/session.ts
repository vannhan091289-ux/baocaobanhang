import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, recordDenyAuditSafely } from "./audit";
import { getRuntimeConfig } from "./config";
import {
  constantTimeEqual,
  createSafeSubjectRef,
  decryptVerifierAes256Gcm,
  encryptVerifierAes256Gcm,
  generateOpaqueToken,
  hashOpaqueToken,
} from "./crypto";
import { getRuntimePool, withTransaction, type Queryable } from "./db";
import {
  evaluateIdentityAndRolePolicy,
  type DepartmentRecord,
  type EffectiveSelfContext,
  type IdentityLinkRecord,
  type RoleAssignmentRecord,
  type StaffRecord,
} from "./policy";

export const SESSION_COOKIE_NAME = "bsos_s1a_session";
export const AUTH_TX_COOKIE_NAME = "bsos_s1a_auth_tx";

export const AUTH_TX_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

export function buildCookieHeaderValue(attr: CookieAttributes): string {
  // Per D-08 §2: Cookie HttpOnly, SameSite=Lax, Path=/, no Domain; Secure when HTTPS,
  // Secure=false only for loopback HTTP in DEVTEST; never use __Host- when not Secure.
  const parts = [
    `${attr.name}=${attr.value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${attr.maxAge}`,
  ];
  if (attr.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearCookieHeaderValue(
  name: string,
  secure: boolean,
): string {
  return buildCookieHeaderValue({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 0,
  });
}

/**
 * Half-open interval [start, end) timeout check in UTC:
 * Valid when startMs <= nowMs && nowMs < endMs.
 * Expired at nowMs >= endMs.
 */
export function isWithinHalfOpenWindow(
  startMs: number,
  endMs: number,
  nowMs: number,
): boolean {
  return nowMs >= startMs && nowMs < endMs;
}

export function isSessionActiveUnderTimeouts(params: {
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  now: Date;
}): {
  active: boolean;
  reasonCode:
    | "ACTIVE"
    | "SESSION_REVOKED"
    | "SESSION_CLOCK_INVALID"
    | "SESSION_ABSOLUTE_EXPIRED"
    | "SESSION_IDLE_EXPIRED";
} {
  const { createdAt, lastSeenAt, absoluteExpiresAt, revokedAt, now } = params;
  if (revokedAt !== null) {
    return { active: false, reasonCode: "SESSION_REVOKED" };
  }
  const nowMs = now.getTime();
  const createdMs = createdAt.getTime();
  const lastSeenMs = lastSeenAt.getTime();
  const absExpMs = absoluteExpiresAt.getTime();

  if (nowMs < createdMs || nowMs < lastSeenMs) {
    return { active: false, reasonCode: "SESSION_CLOCK_INVALID" };
  }
  if (!isWithinHalfOpenWindow(createdMs, absExpMs, nowMs)) {
    return { active: false, reasonCode: "SESSION_ABSOLUTE_EXPIRED" };
  }
  const idleExpMs = lastSeenMs + SESSION_IDLE_TIMEOUT_MS;
  if (!isWithinHalfOpenWindow(lastSeenMs, idleExpMs, nowMs)) {
    return { active: false, reasonCode: "SESSION_IDLE_EXPIRED" };
  }
  return { active: true, reasonCode: "ACTIVE" };
}

export async function createAuthTransaction(params: {
  state: string;
  nonce: string;
  codeVerifier: string;
  now?: Date;
  db?: Queryable;
}): Promise<{ txId: string; rawTxCookieToken: string; expiresAt: Date }> {
  const cfg = getRuntimeConfig();
  const db = params.db ?? getRuntimePool();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + AUTH_TX_TTL_MS);

  // Clean up expired or already-consumed auth transactions first
  await db.query(
    `DELETE FROM auth_transactions
     WHERE consumed_at IS NOT NULL OR expires_at <= $1`,
    [now.toISOString()],
  );

  const txId = randomUUID();
  const rawTxCookieToken = generateOpaqueToken(32);
  const txCookieHash = hashOpaqueToken(rawTxCookieToken);

  // Bind state + txCookieHash as AAD in AES-256-GCM encryption
  const aad = `${txId}|${txCookieHash}|${params.state}`;
  const encrypted = encryptVerifierAes256Gcm(
    params.codeVerifier,
    cfg.authTxEncryptionKey,
    aad,
  );

  await db.query(
    `INSERT INTO auth_transactions (
       id, tx_cookie_hash, state_value, nonce_value,
       verifier_ciphertext_b64, verifier_iv_b64, verifier_auth_tag_b64,
       created_at, expires_at, consumed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
    [
      txId,
      txCookieHash,
      params.state,
      params.nonce,
      encrypted.ciphertextB64,
      encrypted.ivB64,
      encrypted.authTagB64,
      now.toISOString(),
      expiresAt.toISOString(),
    ],
  );

  return { txId, rawTxCookieToken, expiresAt };
}

export type ConsumeAuthTransactionResult =
  | {
      ok: true;
      txId: string;
      state: string;
      nonce: string;
      codeVerifier: string;
    }
  | {
      ok: false;
      reasonCode:
        | "AUTH_TX_COOKIE_MISSING"
        | "AUTH_TX_STATE_MISSING"
        | "AUTH_TX_NOT_FOUND_OR_REPLAYED"
        | "AUTH_TX_EXPIRED"
        | "AUTH_TX_STATE_MISMATCH"
        | "AUTH_TX_VERIFIER_DECRYPT_FAILED";
    };

/**
 * Atomically consumes a one-use AuthTransaction within its 5-minute [created_at, expires_at) window.
 */
export async function consumeAuthTransaction(params: {
  rawTxCookieToken: string | undefined;
  returnedState: string | undefined;
  now?: Date;
  db?: Queryable;
}): Promise<ConsumeAuthTransactionResult> {
  const cfg = getRuntimeConfig();
  const db = params.db ?? getRuntimePool();
  const now = params.now ?? new Date();

  if (!params.rawTxCookieToken) {
    return { ok: false, reasonCode: "AUTH_TX_COOKIE_MISSING" };
  }
  if (!params.returnedState) {
    return { ok: false, reasonCode: "AUTH_TX_STATE_MISSING" };
  }

  const txCookieHash = hashOpaqueToken(params.rawTxCookieToken);

  // Atomically mark consumed_at = now WHERE tx_cookie_hash matches and consumed_at IS NULL
  const res = await db.query<{
    id: string;
    tx_cookie_hash: string;
    state_value: string;
    nonce_value: string;
    verifier_ciphertext_b64: string;
    verifier_iv_b64: string;
    verifier_auth_tag_b64: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `UPDATE auth_transactions
     SET consumed_at = $1
     WHERE tx_cookie_hash = $2
       AND consumed_at IS NULL
     RETURNING
       id, tx_cookie_hash, state_value, nonce_value,
       verifier_ciphertext_b64, verifier_iv_b64, verifier_auth_tag_b64,
       created_at, expires_at`,
    [now.toISOString(), txCookieHash],
  );

  // Best-effort cleanup of expired transactions
  await db
    .query(`DELETE FROM auth_transactions WHERE expires_at <= $1`, [
      now.toISOString(),
    ])
    .catch(() => undefined);

  if (res.rowCount === 0) {
    return { ok: false, reasonCode: "AUTH_TX_NOT_FOUND_OR_REPLAYED" };
  }

  const row = res.rows[0]!;
  const createdMs = new Date(row.created_at).getTime();
  const expiresMs = new Date(row.expires_at).getTime();
  const nowMs = now.getTime();

  if (!isWithinHalfOpenWindow(createdMs, expiresMs, nowMs)) {
    return { ok: false, reasonCode: "AUTH_TX_EXPIRED" };
  }

  if (!constantTimeEqual(row.state_value, params.returnedState)) {
    return { ok: false, reasonCode: "AUTH_TX_STATE_MISMATCH" };
  }

  const aad = `${row.id}|${row.tx_cookie_hash.trim()}|${row.state_value}`;
  let codeVerifier: string;
  try {
    codeVerifier = decryptVerifierAes256Gcm(
      {
        ciphertextB64: row.verifier_ciphertext_b64,
        ivB64: row.verifier_iv_b64,
        authTagB64: row.verifier_auth_tag_b64,
      },
      cfg.authTxEncryptionKey,
      aad,
    );
  } catch {
    return { ok: false, reasonCode: "AUTH_TX_VERIFIER_DECRYPT_FAILED" };
  }

  return {
    ok: true,
    txId: row.id,
    state: row.state_value,
    nonce: row.nonce_value,
    codeVerifier,
  };
}

async function loadIdentityGraphByIssuerSubject(
  db: Queryable,
  issuer: string,
  subject: string,
): Promise<{
  identityLink: IdentityLinkRecord | null;
  staff: StaffRecord | null;
  department: DepartmentRecord | null;
  roleAssignments: RoleAssignmentRecord[];
}> {
  const linkRes = await db.query<IdentityLinkRecord>(
    `SELECT id, issuer, subject, staff_id, status
     FROM identity_links
     WHERE issuer = $1 AND subject = $2
     LIMIT 1`,
    [issuer, subject],
  );

  if (linkRes.rowCount === 0) {
    return {
      identityLink: null,
      staff: null,
      department: null,
      roleAssignments: [],
    };
  }

  const identityLink = linkRes.rows[0]!;
  const staffRes = await db.query<StaffRecord>(
    `SELECT id, staff_code, display_name, department_id, status
     FROM staff
     WHERE id = $1
     LIMIT 1`,
    [identityLink.staff_id],
  );
  const staff = staffRes.rows[0] ?? null;

  let department: DepartmentRecord | null = null;
  if (staff) {
    const deptRes = await db.query<DepartmentRecord>(
      `SELECT id, code, name, status
       FROM departments
       WHERE id = $1
       LIMIT 1`,
      [staff.department_id],
    );
    department = deptRes.rows[0] ?? null;
  }

  const rolesRes = await db.query<RoleAssignmentRecord>(
    `SELECT
       id, staff_id, role_code, scope_type, scope_department_id,
       effective_from, effective_to, status
     FROM role_assignments
     WHERE staff_id = $1`,
    [identityLink.staff_id],
  );

  return {
    identityLink,
    staff,
    department,
    roleAssignments: rolesRes.rows,
  };
}

export type EstablishSessionResult =
  | {
      decision: "ALLOW";
      sessionId: string;
      rawSessionToken: string;
      csrfToken: string;
      selfContext: EffectiveSelfContext;
      absoluteExpiresAt: Date;
    }
  | {
      decision: "DENY";
      httpStatus: 403 | 500;
      reasonCode: string;
    };

/**
 * Evaluates OIDC identity (issuer + subject) against DB mapping and role policy.
 * - If policy denies: records DENY AuditEvent safely (never turning DENY into ALLOW if audit fails) and returns DENY.
 * - If policy allows: creates Session + ALLOW AuditEvent inside a single atomic DB transaction.
 *   If AuditEvent insert fails, the transaction rolls back and NO session is issued (SPRINT-1-APPROVAL.md §3).
 */
export async function establishSessionFromVerifiedOidcIdentity(params: {
  issuer: string;
  subject: string;
  now?: Date;
  pool?: pg.Pool;
}): Promise<EstablishSessionResult> {
  const pool = params.pool ?? getRuntimePool();
  const now = params.now ?? new Date();
  const safeSubjectRef = createSafeSubjectRef(params.issuer, params.subject);

  let denialAudit: Parameters<typeof recordDenyAuditSafely>[1] | undefined;
  try {
    const result = await withTransaction<EstablishSessionResult>(
      async (client) => {
        // Same transaction-scoped lock used by BEFORE STATEMENT authority triggers.
        // No UPDATE privilege on organization/role tables is granted to the runtime.
        await client.query("SELECT lock_s1a_authority()");
        const graph = await loadIdentityGraphByIssuerSubject(
          client,
          params.issuer,
          params.subject,
        );
        const evalResult = evaluateIdentityAndRolePolicy({ now, ...graph });
        if (evalResult.decision === "DENY") {
          denialAudit = {
            occurredAt: now,
            actorStaffId: graph.staff?.id ?? null,
            actorSubjectRef: safeSubjectRef,
            action: "auth.login.callback",
            resourceType: "session",
            resourceId: "unissued",
            scopeContext: { reason: evalResult.reasonCode },
            reasonCode: evalResult.reasonCode,
          };
          return {
            decision: "DENY",
            httpStatus: 403,
            reasonCode: evalResult.reasonCode,
          };
        }
        const rawSessionToken = generateOpaqueToken(32);
        const csrfToken = generateOpaqueToken(32);
        const sessionId = randomUUID();
        const absoluteExpiresAt = new Date(
          now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS,
        );
        await client.query(
          `INSERT INTO sessions (id, token_hash, staff_id, identity_link_id, role_assignment_id,
           csrf_token, created_at, last_seen_at, absolute_expires_at, revoked_at, revoked_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL)`,
          [
            sessionId,
            hashOpaqueToken(rawSessionToken),
            evalResult.selfContext.staff_id,
            graph.identityLink!.id,
            evalResult.effectiveAssignment.id,
            csrfToken,
            now.toISOString(),
            now.toISOString(),
            absoluteExpiresAt.toISOString(),
          ],
        );
        await appendAuditEvent(client, {
          occurredAt: now,
          actorStaffId: evalResult.selfContext.staff_id,
          actorSubjectRef: safeSubjectRef,
          action: "auth.login.success",
          resourceType: "session",
          resourceId: sessionId,
          scopeContext: {
            role_code: evalResult.selfContext.effective_role.role_code,
            scope_type: evalResult.selfContext.effective_role.scope_type,
            department_code: evalResult.selfContext.department.code,
          },
          decision: "ALLOW",
          reasonCode: evalResult.reasonCode,
        });
        return {
          decision: "ALLOW",
          sessionId,
          rawSessionToken,
          csrfToken,
          selfContext: evalResult.selfContext,
          absoluteExpiresAt,
        };
      },
      pool,
    );
    // A failed DENY audit must not poison a transaction and turn a policy DENY into success.
    if (denialAudit) await recordDenyAuditSafely(pool, denialAudit);
    return result;
  } catch {
    return {
      decision: "DENY",
      httpStatus: 500,
      reasonCode: "SESSION_OR_AUDIT_COMMIT_FAILED",
    };
  }
}

export type VerifySessionResult =
  | {
      authenticated: true;
      sessionId: string;
      csrfToken: string;
      selfContext: EffectiveSelfContext;
    }
  | {
      authenticated: false;
      httpStatus: 401 | 403;
      reasonCode: string;
    };

/**
 * Re-evaluates session, identity link, staff, department, and bound role assignment directly
 * from the database on EVERY protected request (no caching ALLOW).
 * Also enforces 15m idle and 8h absolute timeouts in UTC [start, end) without extending absolute_expires_at.
 */
export async function verifyRequestSession(params: {
  rawSessionToken: string | undefined;
  now?: Date;
  db?: Queryable;
}): Promise<VerifySessionResult> {
  const db = params.db ?? getRuntimePool();
  const now = params.now ?? new Date();

  if (!params.rawSessionToken) {
    return {
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_COOKIE_MISSING",
    };
  }

  let tokenHash: string;
  try {
    tokenHash = hashOpaqueToken(params.rawSessionToken);
  } catch {
    return {
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_TOKEN_MALFORMED",
    };
  }

  const sessRes = await db.query<{
    id: string;
    token_hash: string;
    staff_id: string;
    identity_link_id: string;
    role_assignment_id: string;
    csrf_token: string;
    created_at: Date;
    last_seen_at: Date;
    absolute_expires_at: Date;
    revoked_at: Date | null;
    revoked_reason: string | null;
  }>(
    `SELECT
       id, token_hash, staff_id, identity_link_id, role_assignment_id,
       csrf_token, created_at, last_seen_at, absolute_expires_at,
       revoked_at, revoked_reason
     FROM sessions
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (sessRes.rowCount === 0) {
    return {
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_NOT_FOUND",
    };
  }

  const session = sessRes.rows[0]!;
  const sessionLastSeenMs = new Date(session.last_seen_at).getTime();
  // Under concurrent requests on the same session, another handler may commit a
  // slightly newer last_seen_at after this request captured `now`. Tolerate sub-5s
  // concurrency skew when `params.now` is not explicitly injected, while still
  // rejecting real clock skew (>5s) or explicit test clocks.
  const effectiveNow =
    params.now === undefined &&
    sessionLastSeenMs > now.getTime() &&
    sessionLastSeenMs - now.getTime() <= 5_000
      ? new Date(sessionLastSeenMs)
      : now;

  const timeoutCheck = isSessionActiveUnderTimeouts({
    createdAt: new Date(session.created_at),
    lastSeenAt: new Date(session.last_seen_at),
    absoluteExpiresAt: new Date(session.absolute_expires_at),
    revokedAt: session.revoked_at ? new Date(session.revoked_at) : null,
    now: effectiveNow,
  });

  if (!timeoutCheck.active) {
    if (session.revoked_at === null) {
      await db
        .query(
          `UPDATE sessions
           SET revoked_at = $1, revoked_reason = $2
           WHERE id = $3 AND revoked_at IS NULL`,
          [effectiveNow.toISOString(), timeoutCheck.reasonCode, session.id],
        )
        .catch(() => undefined);
    }
    return {
      authenticated: false,
      httpStatus: 401,
      reasonCode: timeoutCheck.reasonCode,
    };
  }

  // Re-read IdentityLink, Staff, Department, and RoleAssignments from DB
  const linkRes = await db.query<IdentityLinkRecord>(
    `SELECT id, issuer, subject, staff_id, status
     FROM identity_links
     WHERE id = $1
     LIMIT 1`,
    [session.identity_link_id],
  );
  const identityLink = linkRes.rows[0] ?? null;

  const staffRes = await db.query<StaffRecord>(
    `SELECT id, staff_code, display_name, department_id, status
     FROM staff
     WHERE id = $1
     LIMIT 1`,
    [session.staff_id],
  );
  const staff = staffRes.rows[0] ?? null;

  let department: DepartmentRecord | null = null;
  if (staff) {
    const deptRes = await db.query<DepartmentRecord>(
      `SELECT id, code, name, status
       FROM departments
       WHERE id = $1
       LIMIT 1`,
      [staff.department_id],
    );
    department = deptRes.rows[0] ?? null;
  }

  const rolesRes = await db.query<RoleAssignmentRecord>(
    `SELECT
       id, staff_id, role_code, scope_type, scope_department_id,
       effective_from, effective_to, status
     FROM role_assignments
     WHERE staff_id = $1`,
    [session.staff_id],
  );

  const policyCheck = evaluateIdentityAndRolePolicy({
    now: effectiveNow,
    identityLink,
    staff,
    department,
    roleAssignments: rolesRes.rows,
    boundRoleAssignmentId: session.role_assignment_id,
  });

  if (policyCheck.decision === "DENY") {
    // Immediately revoke the session in DB so it cannot be reused
    await db
      .query(
        `UPDATE sessions
         SET revoked_at = $1, revoked_reason = $2
         WHERE id = $3 AND revoked_at IS NULL`,
        [effectiveNow.toISOString(), policyCheck.reasonCode, session.id],
      )
      .catch(() => undefined);

    await recordDenyAuditSafely(db, {
      occurredAt: effectiveNow,
      actorStaffId: session.staff_id,
      actorSubjectRef: identityLink
        ? createSafeSubjectRef(identityLink.issuer, identityLink.subject)
        : `staff:${session.staff_id}`,
      action: "auth.session.verify",
      resourceType: "session",
      resourceId: session.id,
      scopeContext: { reason: policyCheck.reasonCode },
      reasonCode: policyCheck.reasonCode,
    });

    return {
      authenticated: false,
      httpStatus: 403,
      reasonCode: policyCheck.reasonCode,
    };
  }

  // Refresh last_seen_at monotonically without extending absolute_expires_at
  const refreshed = await db.query(
    `UPDATE sessions
     SET last_seen_at = GREATEST(last_seen_at, $1::timestamptz)
     WHERE id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [effectiveNow.toISOString(), session.id],
  );

  // A concurrent authority mutation can revoke after our initial read. Never
  // authorize with freshly-read authority if this old cookie could not refresh.
  if (refreshed.rowCount !== 1) {
    await recordDenyAuditSafely(db, {
      occurredAt: effectiveNow,
      actorStaffId: session.staff_id,
      actorSubjectRef: identityLink
        ? createSafeSubjectRef(identityLink.issuer, identityLink.subject)
        : `staff:${session.staff_id}`,
      action: "auth.session.verify",
      resourceType: "session",
      resourceId: session.id,
      scopeContext: { reason: "SESSION_REVOKED" },
      reasonCode: "SESSION_REVOKED",
    });
    return {
      authenticated: false,
      httpStatus: 401,
      reasonCode: "SESSION_REVOKED",
    };
  }

  return {
    authenticated: true,
    sessionId: session.id,
    csrfToken: session.csrf_token,
    selfContext: policyCheck.selfContext,
  };
}

export interface LogoutSessionResult {
  revoked: boolean;
  auditRecorded: boolean;
  httpStatus: 200 | 400 | 401 | 403 | 500;
  code:
    | "LOGOUT_OK"
    | "ORIGIN_MISMATCH"
    | "CSRF_INVALID"
    | "SESSION_MISSING_OR_INVALID"
    | "LOGOUT_REVOKED_AUDIT_DEGRADED";
}

/**
 * Executes POST /auth/logout with Origin + CSRF validation.
 * Commits session revocation sustainably BEFORE writing AuditEvent:
 * If AuditEvent insert fails, the session remains revoked and a safe trace error code is returned
 * without falsely claiming audit succeeded (SPRINT-1-APPROVAL.md §3).
 */
export async function revokeSessionOnLogout(params: {
  rawSessionToken: string | undefined;
  submittedCsrfToken: string | undefined;
  originHeader: string | null;
  now?: Date;
  db?: Queryable;
}): Promise<LogoutSessionResult> {
  const cfg = getRuntimeConfig();
  const db = params.db ?? getRuntimePool();
  const now = params.now ?? new Date();

  if (!params.originHeader || params.originHeader !== cfg.appOrigin) {
    await recordDenyAuditSafely(db, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous_or_unverified",
      action: "auth.logout",
      resourceType: "session",
      resourceId: "unknown",
      scopeContext: { reason: "ORIGIN_MISMATCH" },
      reasonCode: "ORIGIN_MISMATCH",
    });
    return {
      revoked: false,
      auditRecorded: true,
      httpStatus: 403,
      code: "ORIGIN_MISMATCH",
    };
  }

  if (!params.rawSessionToken) {
    return {
      revoked: false,
      auditRecorded: false,
      httpStatus: 401,
      code: "SESSION_MISSING_OR_INVALID",
    };
  }

  let tokenHash: string;
  try {
    tokenHash = hashOpaqueToken(params.rawSessionToken);
  } catch {
    return {
      revoked: false,
      auditRecorded: false,
      httpStatus: 401,
      code: "SESSION_MISSING_OR_INVALID",
    };
  }

  const sessRes = await db.query<{
    id: string;
    staff_id: string;
    csrf_token: string;
    revoked_at: Date | null;
  }>(
    `SELECT id, staff_id, csrf_token, revoked_at
     FROM sessions
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (sessRes.rowCount === 0) {
    return {
      revoked: false,
      auditRecorded: false,
      httpStatus: 401,
      code: "SESSION_MISSING_OR_INVALID",
    };
  }

  const session = sessRes.rows[0]!;
  if (
    !params.submittedCsrfToken ||
    !constantTimeEqual(session.csrf_token, params.submittedCsrfToken)
  ) {
    await recordDenyAuditSafely(db, {
      occurredAt: now,
      actorStaffId: session.staff_id,
      actorSubjectRef: `staff:${session.staff_id}`,
      action: "auth.logout",
      resourceType: "session",
      resourceId: session.id,
      scopeContext: { reason: "CSRF_INVALID" },
      reasonCode: "CSRF_INVALID",
    });
    return {
      revoked: false,
      auditRecorded: true,
      httpStatus: 403,
      code: "CSRF_INVALID",
    };
  }

  // Step 1: Commit session revocation sustainably FIRST
  await db.query(
    `UPDATE sessions
     SET revoked_at = COALESCE(revoked_at, $1),
         revoked_reason = COALESCE(revoked_reason, 'USER_LOGOUT')
     WHERE id = $2`,
    [now.toISOString(), session.id],
  );

  // Step 2: Write AuditEvent after revocation is committed
  try {
    await appendAuditEvent(db, {
      occurredAt: now,
      actorStaffId: session.staff_id,
      actorSubjectRef: `staff:${session.staff_id}`,
      action: "auth.logout",
      resourceType: "session",
      resourceId: session.id,
      scopeContext: { revoked_reason: "USER_LOGOUT" },
      decision: "ALLOW",
      reasonCode: "USER_LOGOUT_REVOKED",
    });
  } catch {
    // Session remains sustainably revoked in DB, but we report safe trace code without claiming audit succeeded
    return {
      revoked: true,
      auditRecorded: false,
      httpStatus: 500,
      code: "LOGOUT_REVOKED_AUDIT_DEGRADED",
    };
  }

  return {
    revoked: true,
    auditRecorded: true,
    httpStatus: 200,
    code: "LOGOUT_OK",
  };
}
