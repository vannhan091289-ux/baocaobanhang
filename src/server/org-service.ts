import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { appendAuditEvent } from "./audit";
import { getRuntimeConfig } from "./config";
import { getRuntimePool, type Queryable } from "./db";
import {
  abort,
  authorize,
  fail,
  finalizeFailure,
  notFound,
  runAuthorityTransaction,
  ServiceAbort,
  tamperRejected,
  type Actor,
  type ServiceFailure,
  type ServiceResult,
  validationFailure,
  created,
} from "./service-core";
import {
  escapeLike,
  findDisallowedTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readPageParams,
  readString,
  readUuid,
  rejectUnknownKeys,
  validateQueryParams,
} from "./validation";

export interface DepartmentView {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  row_version: number;
}

export interface StaffView {
  id: string;
  staff_code: string;
  display_name: string;
  department_id: string;
  status: "ACTIVE" | "INACTIVE";
  row_version: number;
}

export interface IdentityLinkView {
  id: string;
  staff_id: string;
  issuer: string;
  subject: string;
  status: "ACTIVE" | "REVOKED";
  row_version: number;
}

const DEPARTMENT_COLUMNS = "id, code, name, status, row_version";
const STAFF_COLUMNS =
  "id, staff_code, display_name, department_id, status, row_version";
const IDENTITY_COLUMNS = "id, staff_id, issuer, subject, status, row_version";

/* -------------------------------------------------------------------------- */
/* Scope helper: server-derived WHERE for staff-shaped tables                  */
/* -------------------------------------------------------------------------- */

interface ScopeClause {
  sql: string;
  values: unknown[];
}

/** Scope is bound from the verified session before any client filter (ADR-002 §3). */
function staffScopeClause(actor: Actor, alias = "s"): ScopeClause {
  const scope = actor.ctx.effective_role.scope_type;
  if (scope === "BRANCH") return { sql: "TRUE", values: [] };
  if (scope === "DEPARTMENT") {
    return {
      sql: `${alias}.department_id = $1`,
      values: [actor.ctx.department.id],
    };
  }
  return { sql: `${alias}.id = $1`, values: [actor.ctx.staff_id] };
}

function requireBranchRole(
  actor: Actor,
  action: "org.staff.read" | "authz.role.read",
  resource: { type: string; id: string },
): ServiceFailure | null {
  const role = actor.ctx.effective_role.role_code;
  if (role === "EXECUTIVE" || role === "CONFIG_ADMIN") return null;
  return fail(
    403,
    "ACTION_FORBIDDEN_FOR_ROLE",
    "Không có quyền thực hiện thao tác này.",
    {
      denyAudit: {
        action,
        resourceType: resource.type,
        resourceId: resource.id,
        scopeContext: { reason: "ACTION_FORBIDDEN_FOR_ROLE" },
        reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const DEPT_QUERY_KEYS = [
  "q",
  "status",
  "department_id",
  "limit",
  "offset",
] as const;
const STAFF_QUERY_KEYS = [
  "q",
  "status",
  "department_id",
  "limit",
  "offset",
] as const;
const IDENTITY_QUERY_KEYS = [
  "q",
  "status",
  "staff_id",
  "limit",
  "offset",
] as const;

export async function listDepartments(
  actor: Actor,
  params: URLSearchParams,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<DepartmentView[]>> {
  const denied = authorize(
    actor,
    { action: "org.department.read" },
    { type: "department", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);
  const qCheck = validateQueryParams(params, DEPT_QUERY_KEYS);
  if (!qCheck.ok) {
    if (qCheck.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("org.department.read", "department", "list"),
      );
    }
    return validationFailure(qCheck.field, qCheck.reason);
  }
  const page = readPageParams(params);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const clauses: string[] = ["TRUE"];
  const values: unknown[] = [];

  const departmentId = params.get("department_id");
  if (departmentId !== null) {
    if (!isUuid(departmentId)) {
      return finalizeFailure(
        actor,
        notFound("department", "invalid-reference", "org.department.read"),
      );
    }
    values.push(departmentId.toLowerCase());
    clauses.push(`id = $${values.length}`);
  }
  const status = params.get("status");
  if (status !== null) {
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      return validationFailure("status", "INVALID_STATUS");
    }
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }
  const q = params.get("q");
  if (q !== null) {
    const text = q.trim();
    if (text.length < 1 || text.length > 64) {
      return validationFailure("q", "INVALID_LENGTH");
    }
    values.push(`%${escapeLike(text)}%`);
    clauses.push(
      `(code ILIKE $${values.length} OR name ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM departments ${where}`,
    values,
  );
  const rows = await db.query<DepartmentView>(
    `SELECT ${DEPARTMENT_COLUMNS} FROM departments ${where}
     ORDER BY code LIMIT ${page.value.limit} OFFSET ${page.value.offset}`,
    values,
  );
  return {
    ok: true,
    status: 200,
    data: rows.rows,
    page: { ...page.value, total: Number(total.rows[0]!.n) },
  };
}

export async function listStaff(
  actor: Actor,
  params: URLSearchParams,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<StaffView[]>> {
  const denied = authorize(
    actor,
    { action: "org.staff.read" },
    { type: "staff", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);
  const qCheck = validateQueryParams(params, STAFF_QUERY_KEYS);
  if (!qCheck.ok) {
    if (qCheck.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("org.staff.read", "staff", "list"),
      );
    }
    return validationFailure(qCheck.field, qCheck.reason);
  }
  const page = readPageParams(params);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const scope = staffScopeClause(actor);
  const clauses = [scope.sql];
  const values = [...scope.values];

  const departmentId = params.get("department_id");
  if (departmentId !== null) {
    if (!isUuid(departmentId))
      return finalizeFailure(
        actor,
        notFound("department", "invalid-reference"),
      );
    if (
      actor.ctx.effective_role.scope_type !== "BRANCH" &&
      departmentId.toLowerCase() !== actor.ctx.department.id
    ) {
      return finalizeFailure(
        actor,
        notFound("department", departmentId.toLowerCase()),
      );
    }
    values.push(departmentId.toLowerCase());
    clauses.push(`s.department_id = $${values.length}`);
  }
  const status = params.get("status");
  if (status !== null) {
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      return validationFailure("status", "INVALID_STATUS");
    }
    values.push(status);
    clauses.push(`s.status = $${values.length}`);
  }
  const q = params.get("q");
  if (q !== null) {
    const text = q.trim();
    if (text.length < 1 || text.length > 64)
      return validationFailure("q", "INVALID_LENGTH");
    values.push(`%${escapeLike(text)}%`);
    clauses.push(
      `(s.staff_code ILIKE $${values.length} OR s.display_name ILIKE $${values.length})`,
    );
  }
  const where = clauses.join(" AND ");
  const total = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM staff s WHERE ${where}`,
    values,
  );
  const rows = await db.query<StaffView>(
    `SELECT s.id, s.staff_code, s.display_name, s.department_id, s.status, s.row_version
     FROM staff s WHERE ${where}
     ORDER BY s.staff_code LIMIT ${page.value.limit} OFFSET ${page.value.offset}`,
    values,
  );
  return {
    ok: true,
    status: 200,
    data: rows.rows,
    page: { ...page.value, total: Number(total.rows[0]!.n) },
  };
}

export async function getStaff(
  actor: Actor,
  id: string,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<StaffView>> {
  const denied = authorize(
    actor,
    { action: "org.staff.read" },
    { type: "staff", id },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isUuid(id))
    return finalizeFailure(actor, notFound("staff", "invalid-reference"));
  const scope = staffScopeClause(actor);
  const res = await db.query<StaffView>(
    `SELECT s.id, s.staff_code, s.display_name, s.department_id, s.status, s.row_version
     FROM staff s WHERE s.id = $${scope.values.length + 1} AND ${scope.sql}`,
    [...scope.values, id.toLowerCase()],
  );
  if (res.rowCount === 0)
    return finalizeFailure(actor, notFound("staff", id.toLowerCase()));
  return { ok: true, status: 200, data: res.rows[0]! };
}

export async function listIdentityLinks(
  actor: Actor,
  params: URLSearchParams,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<IdentityLinkView[]>> {
  const denied = requireBranchRole(actor, "org.staff.read", {
    type: "identity_link",
    id: "list",
  });
  if (denied) return finalizeFailure(actor, denied);
  const qCheck = validateQueryParams(params, IDENTITY_QUERY_KEYS);
  if (!qCheck.ok) {
    if (qCheck.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("org.staff.read", "identity_link", "list"),
      );
    }
    return validationFailure(qCheck.field, qCheck.reason);
  }
  const page = readPageParams(params);
  if (!page.ok) return validationFailure(page.field, page.reason);
  const clauses: string[] = ["TRUE"];
  const values: unknown[] = [];
  const staffId = params.get("staff_id");
  if (staffId !== null) {
    if (!isUuid(staffId)) {
      return finalizeFailure(
        actor,
        notFound("staff", "invalid-reference", "org.staff.read"),
      );
    }
    values.push(staffId.toLowerCase());
    clauses.push(`staff_id = $${values.length}`);
  }
  const status = params.get("status");
  if (status !== null) {
    if (status !== "ACTIVE" && status !== "REVOKED") {
      return validationFailure("status", "INVALID_STATUS");
    }
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }
  const q = params.get("q");
  if (q !== null) {
    const text = q.trim();
    if (text.length < 1 || text.length > 64) {
      return validationFailure("q", "INVALID_LENGTH");
    }
    values.push(`%${escapeLike(text)}%`);
    clauses.push(`subject ILIKE $${values.length}`);
  }
  const where = clauses.join(" AND ");
  const total = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM identity_links WHERE ${where}`,
    values,
  );
  const rows = await db.query<IdentityLinkView>(
    `SELECT ${IDENTITY_COLUMNS} FROM identity_links WHERE ${where}
     ORDER BY created_at, id LIMIT ${page.value.limit} OFFSET ${page.value.offset}`,
    values,
  );
  return {
    ok: true,
    status: 200,
    data: rows.rows,
    page: { ...page.value, total: Number(total.rows[0]!.n) },
  };
}

/* -------------------------------------------------------------------------- */
/* Writes: Department                                                          */
/* -------------------------------------------------------------------------- */

const DEPARTMENT_CREATE_KEYS = ["code", "name", "csrf_token"] as const;
const DEPARTMENT_PATCH_KEYS = [
  "expected_version",
  "name",
  "status",
  "csrf_token",
] as const;

async function auditAllow(
  client: PoolClient,
  actor: Actor,
  action: string,
  resourceType: string,
  resourceId: string,
  reasonCode: string,
  scopeContext: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await appendAuditEvent(client, {
    actorStaffId: actor.ctx.staff_id,
    actorSubjectRef: `staff:${actor.ctx.staff_id}`,
    action,
    resourceType,
    resourceId,
    scopeContext,
    decision: "ALLOW",
    reasonCode,
  });
}

export async function createDepartment(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<DepartmentView>> {
  const denied = authorize(
    actor,
    { action: "org.department.write" },
    { type: "department", id: "new" },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), DEPARTMENT_CREATE_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.department.write", "department", "new"),
    );
  }
  const unknown = rejectUnknownKeys(body, DEPARTMENT_CREATE_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const code = readString(body, "code", { max: 32, pattern: /^[A-Z0-9_]+$/ });
  if (!code.ok) return validationFailure(code.field, code.reason);
  const name = readString(body, "name", { max: 160 });
  if (!name.ok) return validationFailure(name.field, name.reason);

  return created(
    await runAuthorityTransaction(actor, async (client) => {
      const id = randomUUID();
      const res = await client.query<DepartmentView>(
        `INSERT INTO departments (id, code, name, status) VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING ${DEPARTMENT_COLUMNS}`,
        [id, code.value, name.value],
      );
      await auditAllow(
        client,
        actor,
        "org.department.write",
        "department",
        id,
        "ALLOW_ORG_WRITE_CONFIG_ADMIN",
        {
          operation: "create",
        },
      );
      return res.rows[0]!;
    }),
  );
}

export async function patchDepartment(
  actor: Actor,
  id: string,
  body: unknown,
): Promise<ServiceResult<DepartmentView>> {
  const denied = authorize(
    actor,
    { action: "org.department.write" },
    { type: "department", id },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isUuid(id))
    return finalizeFailure(
      actor,
      notFound("department", "invalid-reference", "org.department.write"),
    );
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), DEPARTMENT_PATCH_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.department.write", "department", id.toLowerCase()),
    );
  }
  const unknown = rejectUnknownKeys(body, DEPARTMENT_PATCH_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const version = readExpectedVersion(body);
  if (!version.ok) return validationFailure(version.field, version.reason);
  const name = readString(body, "name", { max: 160, optional: true });
  if (!name.ok) return validationFailure(name.field, name.reason);
  const status = readString(body, "status", {
    max: 16,
    pattern: /^(ACTIVE|INACTIVE)$/,
    optional: true,
  });
  if (!status.ok) return validationFailure(status.field, status.reason);
  if (name.value === undefined && status.value === undefined) {
    return validationFailure("body", "NO_CHANGES");
  }

  const deptId = id.toLowerCase();
  return runAuthorityTransaction(actor, async (client) => {
    const cur = await client.query<DepartmentView>(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments WHERE id = $1 FOR UPDATE`,
      [deptId],
    );
    if (cur.rowCount === 0) {
      throw new ServiceAbort(
        notFound("department", deptId, "org.department.write"),
      );
    }
    if (cur.rows[0]!.row_version !== version.value) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    if (status.value === "INACTIVE" && cur.rows[0]!.status === "ACTIVE") {
      const active = await client.query(
        "SELECT 1 FROM staff WHERE department_id = $1 AND status = 'ACTIVE' LIMIT 1",
        [deptId],
      );
      if (active.rowCount! > 0) {
        abort(
          409,
          "DEPARTMENT_HAS_ACTIVE_STAFF",
          "Phòng còn nhân sự đang hoạt động.",
        );
      }
    }
    const res = await client.query<DepartmentView>(
      `UPDATE departments SET name = COALESCE($3, name), status = COALESCE($4, status)
       WHERE id = $1 AND row_version = $2 RETURNING ${DEPARTMENT_COLUMNS}`,
      [deptId, version.value, name.value ?? null, status.value ?? null],
    );
    if (res.rowCount === 0) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    await auditAllow(
      client,
      actor,
      "org.department.write",
      "department",
      deptId,
      "ALLOW_ORG_WRITE_CONFIG_ADMIN",
      {
        operation: "update",
      },
    );
    return res.rows[0]!;
  });
}

/* -------------------------------------------------------------------------- */
/* Writes: Staff                                                               */
/* -------------------------------------------------------------------------- */

const STAFF_CREATE_KEYS = [
  "staff_code",
  "display_name",
  "department_id",
  "csrf_token",
] as const;
const STAFF_PATCH_KEYS = [
  "expected_version",
  "display_name",
  "department_id",
  "status",
  "csrf_token",
] as const;

export async function createStaff(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<StaffView>> {
  const denied = authorize(
    actor,
    { action: "org.staff.write" },
    { type: "staff", id: "new" },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), STAFF_CREATE_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.staff.write", "staff", "new"),
    );
  }
  const unknown = rejectUnknownKeys(body, STAFF_CREATE_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const staffCode = readString(body, "staff_code", {
    max: 64,
    pattern: /^[A-Z0-9_-]+$/,
  });
  if (!staffCode.ok)
    return validationFailure(staffCode.field, staffCode.reason);
  const displayName = readString(body, "display_name", { max: 160 });
  if (!displayName.ok)
    return validationFailure(displayName.field, displayName.reason);
  const departmentId = readUuid(body, "department_id");
  if (!departmentId.ok)
    return validationFailure(departmentId.field, departmentId.reason);

  return created(
    await runAuthorityTransaction(actor, async (client) => {
      const dept = await client.query<{ status: string }>(
        "SELECT status FROM departments WHERE id = $1 FOR SHARE",
        [departmentId.value],
      );
      if (dept.rowCount === 0)
        abort(422, "DEPARTMENT_NOT_FOUND", "Phòng không tồn tại.");
      if (dept.rows[0]!.status !== "ACTIVE") {
        abort(
          422,
          "DEPARTMENT_NOT_ACTIVE",
          "Không thể gán nhân sự vào phòng ngừng hoạt động.",
        );
      }
      const id = randomUUID();
      const res = await client.query<StaffView>(
        `INSERT INTO staff (id, staff_code, display_name, department_id, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING ${STAFF_COLUMNS}`,
        [id, staffCode.value, displayName.value, departmentId.value],
      );
      await auditAllow(
        client,
        actor,
        "org.staff.write",
        "staff",
        id,
        "ALLOW_ORG_WRITE_CONFIG_ADMIN",
        {
          operation: "create",
        },
      );
      return res.rows[0]!;
    }),
  );
}

/** Ends effective authority of a Staff inside the current transaction (history is kept). */
async function endStaffAuthority(
  client: PoolClient,
  staffId: string,
  now: Date,
  reason: string,
): Promise<{ revokedAssignments: number; cancelledProposals: number }> {
  const revoked = await client.query(
    `UPDATE role_assignments
        SET status = 'REVOKED',
            effective_to = CASE WHEN effective_from < $2::timestamptz THEN $2::timestamptz ELSE effective_to END
      WHERE staff_id = $1 AND status = 'ACTIVE'`,
    [staffId, now.toISOString()],
  );
  const cancelled = await client.query(
    "UPDATE role_assignment_proposals SET status = 'CANCELLED' WHERE target_staff_id = $1 AND status = 'PENDING'",
    [staffId],
  );
  await client.query(
    `UPDATE sessions SET revoked_at = $2::timestamptz, revoked_reason = $3
      WHERE staff_id = $1 AND revoked_at IS NULL`,
    [staffId, now.toISOString(), reason],
  );
  return {
    revokedAssignments: revoked.rowCount ?? 0,
    cancelledProposals: cancelled.rowCount ?? 0,
  };
}

export async function patchStaff(
  actor: Actor,
  id: string,
  body: unknown,
): Promise<ServiceResult<StaffView>> {
  const denied = authorize(
    actor,
    { action: "org.staff.write" },
    { type: "staff", id },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isUuid(id))
    return finalizeFailure(
      actor,
      notFound("staff", "invalid-reference", "org.staff.write"),
    );
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), STAFF_PATCH_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.staff.write", "staff", id.toLowerCase()),
    );
  }
  const unknown = rejectUnknownKeys(body, STAFF_PATCH_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const version = readExpectedVersion(body);
  if (!version.ok) return validationFailure(version.field, version.reason);
  const displayName = readString(body, "display_name", {
    max: 160,
    optional: true,
  });
  if (!displayName.ok)
    return validationFailure(displayName.field, displayName.reason);
  const departmentId = readUuid(body, "department_id", true);
  if (!departmentId.ok)
    return validationFailure(departmentId.field, departmentId.reason);
  const status = readString(body, "status", {
    max: 16,
    pattern: /^(ACTIVE|INACTIVE)$/,
    optional: true,
  });
  if (!status.ok) return validationFailure(status.field, status.reason);
  if (
    displayName.value === undefined &&
    departmentId.value === undefined &&
    status.value === undefined
  ) {
    return validationFailure("body", "NO_CHANGES");
  }
  const staffId = id.toLowerCase();
  const touchesAuthority =
    departmentId.value !== undefined || status.value !== undefined;
  if (touchesAuthority && staffId === actor.ctx.staff_id) {
    return finalizeFailure(
      actor,
      fail(
        403,
        "SELF_AUTHORITY_MUTATION_FORBIDDEN",
        "Không thể tự thay đổi phòng/trạng thái của chính mình.",
        {
          denyAudit: {
            action: "org.staff.write",
            resourceType: "staff",
            resourceId: staffId,
            scopeContext: { reason: "SELF_AUTHORITY_MUTATION_FORBIDDEN" },
            reasonCode: "SELF_AUTHORITY_MUTATION_FORBIDDEN",
          },
        },
      ),
    );
  }

  return runAuthorityTransaction(actor, async (client) => {
    const cur = await client.query<StaffView>(
      `SELECT ${STAFF_COLUMNS} FROM staff WHERE id = $1 FOR UPDATE`,
      [staffId],
    );
    if (cur.rowCount === 0) {
      throw new ServiceAbort(notFound("staff", staffId, "org.staff.write"));
    }
    const before = cur.rows[0]!;
    if (before.row_version !== version.value) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    const nextDepartment = departmentId.value ?? before.department_id;
    const nextStatus =
      (status.value as "ACTIVE" | "INACTIVE" | undefined) ?? before.status;
    if (
      (nextDepartment !== before.department_id || nextStatus === "ACTIVE") &&
      touchesAuthority
    ) {
      const dept = await client.query<{ status: string }>(
        "SELECT status FROM departments WHERE id = $1 FOR SHARE",
        [nextDepartment],
      );
      if (dept.rowCount === 0)
        abort(422, "DEPARTMENT_NOT_FOUND", "Phòng không tồn tại.");
      if (dept.rows[0]!.status !== "ACTIVE") {
        abort(
          422,
          "DEPARTMENT_NOT_ACTIVE",
          "Không thể gán nhân sự vào phòng ngừng hoạt động.",
        );
      }
    }
    const res = await client.query<StaffView>(
      `UPDATE staff
          SET display_name = COALESCE($3, display_name), department_id = $4, status = $5
        WHERE id = $1 AND row_version = $2 RETURNING ${STAFF_COLUMNS}`,
      [
        staffId,
        version.value,
        displayName.value ?? null,
        nextDepartment,
        nextStatus,
      ],
    );
    if (res.rowCount === 0) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    const authorityChanged =
      nextDepartment !== before.department_id ||
      (nextStatus === "INACTIVE" && before.status === "ACTIVE");
    let effects = { revokedAssignments: 0, cancelledProposals: 0 };
    if (authorityChanged) {
      effects = await endStaffAuthority(
        client,
        staffId,
        new Date(),
        nextStatus === "INACTIVE"
          ? "STAFF_DEACTIVATED"
          : "STAFF_DEPARTMENT_CHANGED",
      );
    }
    await auditAllow(
      client,
      actor,
      "org.staff.write",
      "staff",
      staffId,
      "ALLOW_ORG_WRITE_CONFIG_ADMIN",
      {
        operation: "update",
        authority_changed: authorityChanged,
        revoked_assignments: effects.revokedAssignments,
        cancelled_proposals: effects.cancelledProposals,
      },
    );
    return res.rows[0]!;
  });
}

/* -------------------------------------------------------------------------- */
/* Writes: IdentityLink                                                        */
/* -------------------------------------------------------------------------- */

const IDENTITY_CREATE_KEYS = ["staff_id", "subject", "csrf_token"] as const;
const IDENTITY_PATCH_KEYS = [
  "expected_version",
  "status",
  "csrf_token",
] as const;

function selfIdentityDenied(actor: Actor, resourceId: string): ServiceFailure {
  return fail(
    403,
    "SELF_IDENTITY_MUTATION_FORBIDDEN",
    "Không thể tự thay đổi liên kết định danh của chính mình.",
    {
      denyAudit: {
        action: "org.staff.write",
        resourceType: "identity_link",
        resourceId,
        scopeContext: { reason: "SELF_IDENTITY_MUTATION_FORBIDDEN" },
        reasonCode: "SELF_IDENTITY_MUTATION_FORBIDDEN",
      },
    },
  );
}

export async function createIdentityLink(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<IdentityLinkView>> {
  const denied = authorize(
    actor,
    { action: "org.staff.write" },
    { type: "identity_link", id: "new" },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), IDENTITY_CREATE_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.staff.write", "identity_link", "new"),
    );
  }
  const unknown = rejectUnknownKeys(body, IDENTITY_CREATE_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const staffId = readUuid(body, "staff_id");
  if (!staffId.ok) return validationFailure(staffId.field, staffId.reason);
  const subject = readString(body, "subject", { max: 255 });
  if (!subject.ok) return validationFailure(subject.field, subject.reason);
  if (staffId.value === actor.ctx.staff_id) {
    return finalizeFailure(actor, selfIdentityDenied(actor, staffId.value!));
  }
  // Issuer is bound to the server allowlist, never taken from the client (D-08).
  const issuer = getRuntimeConfig().oidcIssuer;

  return created(
    await runAuthorityTransaction(actor, async (client) => {
      const staff = await client.query<{ status: string }>(
        "SELECT status FROM staff WHERE id = $1 FOR SHARE",
        [staffId.value],
      );
      if (staff.rowCount === 0)
        abort(422, "STAFF_NOT_FOUND", "Nhân sự không tồn tại.");
      if (staff.rows[0]!.status !== "ACTIVE") {
        abort(
          422,
          "STAFF_NOT_ACTIVE",
          "Chỉ liên kết định danh cho nhân sự đang hoạt động.",
        );
      }
      const id = randomUUID();
      const res = await client.query<IdentityLinkView>(
        `INSERT INTO identity_links (id, issuer, subject, staff_id, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING ${IDENTITY_COLUMNS}`,
        [id, issuer, subject.value, staffId.value],
      );
      await auditAllow(
        client,
        actor,
        "org.staff.write",
        "identity_link",
        id,
        "ALLOW_ORG_WRITE_CONFIG_ADMIN",
        {
          operation: "create",
          staff_id: staffId.value!,
        },
      );
      return res.rows[0]!;
    }),
  );
}

export async function patchIdentityLink(
  actor: Actor,
  id: string,
  body: unknown,
): Promise<ServiceResult<IdentityLinkView>> {
  const denied = authorize(
    actor,
    { action: "org.staff.write" },
    { type: "identity_link", id },
  );
  if (denied) return finalizeFailure(actor, denied);
  if (!isUuid(id))
    return finalizeFailure(
      actor,
      notFound("identity_link", "invalid-reference", "org.staff.write"),
    );
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  if (findDisallowedTamperKey(Object.keys(body), IDENTITY_PATCH_KEYS)) {
    return finalizeFailure(
      actor,
      tamperRejected("org.staff.write", "identity_link", id.toLowerCase()),
    );
  }
  const unknown = rejectUnknownKeys(body, IDENTITY_PATCH_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const version = readExpectedVersion(body);
  if (!version.ok) return validationFailure(version.field, version.reason);
  const status = readString(body, "status", { max: 16, pattern: /^REVOKED$/ });
  if (!status.ok) return validationFailure(status.field, status.reason);
  const linkId = id.toLowerCase();

  return runAuthorityTransaction(actor, async (client) => {
    const cur = await client.query<IdentityLinkView>(
      `SELECT ${IDENTITY_COLUMNS} FROM identity_links WHERE id = $1 FOR UPDATE`,
      [linkId],
    );
    if (cur.rowCount === 0) {
      throw new ServiceAbort(
        notFound("identity_link", linkId, "org.staff.write"),
      );
    }
    const link = cur.rows[0]!;
    if (link.staff_id === actor.ctx.staff_id) {
      abort(
        403,
        "SELF_IDENTITY_MUTATION_FORBIDDEN",
        "Không thể tự thay đổi liên kết định danh của chính mình.",
        {
          denyAudit: {
            action: "org.staff.write",
            resourceType: "identity_link",
            resourceId: linkId,
            scopeContext: { reason: "SELF_IDENTITY_MUTATION_FORBIDDEN" },
            reasonCode: "SELF_IDENTITY_MUTATION_FORBIDDEN",
          },
        },
      );
    }
    if (link.row_version !== version.value) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    if (link.status === "REVOKED") {
      abort(
        409,
        "IDENTITY_LINK_ALREADY_REVOKED",
        "Liên kết định danh đã bị thu hồi.",
      );
    }
    const res = await client.query<IdentityLinkView>(
      `UPDATE identity_links SET status = 'REVOKED'
        WHERE id = $1 AND row_version = $2 RETURNING ${IDENTITY_COLUMNS}`,
      [linkId, version.value],
    );
    if (res.rowCount === 0) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Bản ghi đã được cập nhật bởi thao tác khác.",
      );
    }
    await client.query(
      `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'IDENTITY_LINK_REVOKED'
        WHERE identity_link_id = $1 AND revoked_at IS NULL`,
      [linkId],
    );
    await auditAllow(
      client,
      actor,
      "org.staff.write",
      "identity_link",
      linkId,
      "ALLOW_ORG_WRITE_CONFIG_ADMIN",
      {
        operation: "revoke",
      },
    );
    return res.rows[0]!;
  });
}
