import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { appendAuditEvent } from "./audit";
import { getRuntimePool, type Queryable } from "./db";
import type { DataScopeType, RoleCode } from "./policy";
import {
  abort,
  authorize,
  fail,
  finalizeFailure,
  runAuthorityTransaction,
  ServiceAbort,
  type Actor,
  type ServiceFailure,
  type ServiceResult,
} from "./service-core";
import {
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readIsoInstant,
  readPageParams,
  readString,
  readUuid,
  rejectUnknownKeys,
} from "./validation";

export interface RoleAssignmentView {
  id: string;
  staff_id: string;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "ACTIVE" | "REVOKED";
  row_version: number;
}

export interface ProposalView {
  id: string;
  target_staff_id: string;
  propose_action: "ASSIGN" | "REVOKE";
  target_assignment_id: string | null;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  proposer_staff_id: string;
  proposer_reason: string;
  approver_staff_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  applied_assignment_id: string | null;
  row_version: number;
}

const ASSIGNMENT_COLUMNS = `ra.id, ra.staff_id, ra.role_code, ra.scope_type, ra.scope_department_id,
  to_char(ra.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_from,
  CASE WHEN ra.effective_to IS NULL THEN NULL
       ELSE to_char(ra.effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS effective_to,
  ra.status, ra.row_version`;

const PROPOSAL_COLUMNS = `p.id, p.target_staff_id, p.propose_action, p.target_assignment_id, p.role_code,
  p.scope_type, p.scope_department_id,
  to_char(p.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_from,
  CASE WHEN p.effective_to IS NULL THEN NULL
       ELSE to_char(p.effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS effective_to,
  p.status, p.proposer_staff_id, p.proposer_reason, p.approver_staff_id, p.decision_reason,
  CASE WHEN p.decided_at IS NULL THEN NULL
       ELSE to_char(p.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS decided_at,
  p.applied_assignment_id, p.row_version`;

const VALIDATION_MESSAGE = "Dữ liệu đầu vào không hợp lệ.";

function validationFailure(field: string, reason: string): ServiceFailure {
  return fail(422, "VALIDATION_FAILED", VALIDATION_MESSAGE, {
    details: { field, reason },
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listRoleAssignments(
  actor: Actor,
  params: URLSearchParams,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<RoleAssignmentView[]>> {
  const denied = authorize(
    actor,
    { action: "authz.role.read" },
    { type: "role_assignment", id: "list" },
  );
  if (denied) return finalizeFailure(actor, denied);
  const page = readPageParams(params);
  if (!page.ok) return validationFailure(page.field, page.reason);

  const scope = actor.ctx.effective_role.scope_type;
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (scope === "DEPARTMENT") {
    values.push(actor.ctx.department.id);
    clauses.push(`s.department_id = $${values.length}`);
  } else if (scope === "SELF") {
    values.push(actor.ctx.staff_id);
    clauses.push(`ra.staff_id = $${values.length}`);
  }
  const staffId = params.get("staff_id");
  if (staffId !== null) {
    if (!isUuid(staffId)) return validationFailure("staff_id", "INVALID_UUID");
    values.push(staffId.toLowerCase());
    clauses.push(`ra.staff_id = $${values.length}`);
  }
  const status = params.get("status");
  if (status !== null) {
    if (status !== "ACTIVE" && status !== "REVOKED") {
      return validationFailure("status", "INVALID_STATUS");
    }
    values.push(status);
    clauses.push(`ra.status = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM role_assignments ra JOIN staff s ON s.id = ra.staff_id ${where}`,
    values,
  );
  const rows = await db.query<RoleAssignmentView>(
    `SELECT ${ASSIGNMENT_COLUMNS}
       FROM role_assignments ra JOIN staff s ON s.id = ra.staff_id ${where}
      ORDER BY ra.effective_from DESC, ra.id
      LIMIT ${page.value.limit} OFFSET ${page.value.offset}`,
    values,
  );
  return {
    ok: true,
    status: 200,
    data: rows.rows,
    page: { ...page.value, total: Number(total.rows[0]!.n) },
  };
}

export async function listProposals(
  actor: Actor,
  params: URLSearchParams,
  db: Queryable = getRuntimePool(),
): Promise<ServiceResult<ProposalView[]>> {
  const role = actor.ctx.effective_role.role_code;
  if (role !== "EXECUTIVE" && role !== "CONFIG_ADMIN") {
    return finalizeFailure(
      actor,
      fail(
        403,
        "ACTION_FORBIDDEN_FOR_ROLE",
        "Không có quyền thực hiện thao tác này.",
        {
          denyAudit: {
            action: "authz.role.read",
            resourceType: "role_assignment_proposal",
            resourceId: "list",
            scopeContext: { reason: "ACTION_FORBIDDEN_FOR_ROLE" },
            reasonCode: "ACTION_FORBIDDEN_FOR_ROLE",
          },
        },
      ),
    );
  }
  const page = readPageParams(params);
  if (!page.ok) return validationFailure(page.field, page.reason);
  const clauses: string[] = [];
  const values: unknown[] = [];
  const status = params.get("status");
  if (status !== null) {
    if (!["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) {
      return validationFailure("status", "INVALID_STATUS");
    }
    values.push(status);
    clauses.push(`p.status = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM role_assignment_proposals p ${where}`,
    values,
  );
  const rows = await db.query<ProposalView>(
    `SELECT ${PROPOSAL_COLUMNS} FROM role_assignment_proposals p ${where}
      ORDER BY p.created_at DESC, p.id LIMIT ${page.value.limit} OFFSET ${page.value.offset}`,
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
/* Propose (maker = CONFIG_ADMIN)                                              */
/* -------------------------------------------------------------------------- */

const PROPOSE_KEYS = [
  "target_staff_id",
  "propose_action",
  "target_assignment_id",
  "role_code",
  "effective_from",
  "effective_to",
  "reason",
  "csrf_token",
] as const;

const PAST_TOLERANCE_MS = 5 * 60 * 1000;

function scopeForRole(
  role: RoleCode,
  staffDepartmentId: string,
): { scope_type: DataScopeType; scope_department_id: string | null } {
  if (role === "DEPARTMENT_MANAGER") {
    return { scope_type: "DEPARTMENT", scope_department_id: staffDepartmentId };
  }
  if (role === "STAFF")
    return { scope_type: "SELF", scope_department_id: null };
  return { scope_type: "BRANCH", scope_department_id: null };
}

export async function createProposal(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<ProposalView>> {
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  const unknown = rejectUnknownKeys(body, PROPOSE_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const targetStaffId = readUuid(body, "target_staff_id");
  if (!targetStaffId.ok)
    return validationFailure(targetStaffId.field, targetStaffId.reason);

  // Policy first so self-escalation / non-maker roles are DENY-audited before any DB work.
  const denied = authorize(
    actor,
    {
      action: "authz.role.assign",
      roleWorkflowPhase: "propose",
      targetStaffId: targetStaffId.value,
    },
    { type: "role_assignment_proposal", id: targetStaffId.value! },
  );
  if (denied) return finalizeFailure(actor, denied);

  const action = readString(body, "propose_action", {
    max: 16,
    pattern: /^(ASSIGN|REVOKE)$/,
  });
  if (!action.ok) return validationFailure(action.field, action.reason);
  const reason = readString(body, "reason", { max: 280 });
  if (!reason.ok) return validationFailure(reason.field, reason.reason);
  const roleCode = readString(body, "role_code", {
    max: 32,
    pattern: /^(EXECUTIVE|CONFIG_ADMIN|DEPARTMENT_MANAGER|STAFF)$/,
    optional: action.value === "REVOKE",
  });
  if (!roleCode.ok) return validationFailure(roleCode.field, roleCode.reason);
  const targetAssignmentId = readUuid(
    body,
    "target_assignment_id",
    action.value === "ASSIGN",
  );
  if (!targetAssignmentId.ok) {
    return validationFailure(
      targetAssignmentId.field,
      targetAssignmentId.reason,
    );
  }
  if (action.value === "ASSIGN" && body.target_assignment_id !== undefined) {
    return validationFailure("target_assignment_id", "NOT_ALLOWED_FOR_ASSIGN");
  }
  const from = readIsoInstant(body, "effective_from");
  if (!from.ok) return validationFailure(from.field, from.reason);
  const to = readIsoInstant(body, "effective_to");
  if (!to.ok) return validationFailure(to.field, to.reason);
  const now = new Date();
  const effectiveFrom = from.value ?? now;
  if (effectiveFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return validationFailure("effective_from", "IN_PAST");
  }
  if (to.value && to.value.getTime() <= effectiveFrom.getTime()) {
    return validationFailure("effective_to", "MUST_BE_AFTER_EFFECTIVE_FROM");
  }

  return runAuthorityTransaction(actor, async (client) => {
    const staff = await client.query<{ department_id: string; status: string }>(
      "SELECT department_id, status FROM staff WHERE id = $1 FOR SHARE",
      [targetStaffId.value],
    );
    if (staff.rowCount === 0)
      abort(422, "TARGET_STAFF_NOT_FOUND", "Nhân sự đích không tồn tại.");
    const target = staff.rows[0]!;
    if (target.status !== "ACTIVE") {
      abort(
        422,
        "TARGET_STAFF_NOT_ACTIVE",
        "Nhân sự đích không còn hoạt động.",
      );
    }

    let role = roleCode.value as RoleCode | undefined;
    let scope = role
      ? scopeForRole(role, target.department_id)
      : {
          scope_type: "BRANCH" as DataScopeType,
          scope_department_id: null as string | null,
        };

    if (action.value === "REVOKE") {
      const asg = await client.query<{
        staff_id: string;
        role_code: RoleCode;
        scope_type: DataScopeType;
        scope_department_id: string | null;
        status: string;
      }>(
        `SELECT staff_id, role_code, scope_type, scope_department_id, status
           FROM role_assignments WHERE id = $1 FOR SHARE`,
        [targetAssignmentId.value],
      );
      if (asg.rowCount === 0 || asg.rows[0]!.staff_id !== targetStaffId.value) {
        abort(
          422,
          "TARGET_ASSIGNMENT_NOT_FOUND",
          "Phân quyền cần thu hồi không thuộc nhân sự đích.",
        );
      }
      if (asg.rows[0]!.status !== "ACTIVE") {
        abort(
          422,
          "TARGET_ASSIGNMENT_NOT_ACTIVE",
          "Phân quyền cần thu hồi không còn hiệu lực.",
        );
      }
      role = asg.rows[0]!.role_code;
      scope = {
        scope_type: asg.rows[0]!.scope_type,
        scope_department_id: asg.rows[0]!.scope_department_id,
      };
    } else if (scope.scope_department_id) {
      const dept = await client.query<{ status: string }>(
        "SELECT status FROM departments WHERE id = $1 FOR SHARE",
        [scope.scope_department_id],
      );
      if (dept.rows[0]?.status !== "ACTIVE") {
        abort(
          422,
          "DEPARTMENT_NOT_ACTIVE",
          "Phòng của nhân sự đích không hoạt động.",
        );
      }
    }

    const id = randomUUID();
    const res = await client.query<ProposalView>(
      `WITH ins AS (
         INSERT INTO role_assignment_proposals (
           id, target_staff_id, propose_action, target_assignment_id, role_code, scope_type,
           scope_department_id, effective_from, effective_to, status, proposer_staff_id, proposer_reason
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,'PENDING',$10,$11)
         RETURNING *)
       SELECT ${PROPOSAL_COLUMNS} FROM ins p`,
      [
        id,
        targetStaffId.value,
        action.value,
        targetAssignmentId.value ?? null,
        role,
        scope.scope_type,
        scope.scope_department_id,
        effectiveFrom.toISOString(),
        to.value ? to.value.toISOString() : null,
        actor.ctx.staff_id,
        reason.value,
      ],
    );
    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "authz.role.assign",
      resourceType: "role_assignment_proposal",
      resourceId: id,
      scopeContext: {
        phase: "propose",
        propose_action: action.value!,
        role_code: role!,
        target_staff_id: targetStaffId.value!,
      },
      decision: "ALLOW",
      reasonCode: "ALLOW_ROLE_PROPOSE_CONFIG_ADMIN",
    });
    return res.rows[0]!;
  }).then((r) => (r.ok ? { ...r, status: 201 as const } : r));
}

/* -------------------------------------------------------------------------- */
/* Decide (checker = EXECUTIVE)                                                */
/* -------------------------------------------------------------------------- */

const DECISION_KEYS = [
  "decision",
  "expected_version",
  "reason",
  "csrf_token",
] as const;

interface ProposalRow {
  id: string;
  target_staff_id: string;
  propose_action: "ASSIGN" | "REVOKE";
  target_assignment_id: string | null;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
  status: string;
  proposer_staff_id: string;
  row_version: number;
}

async function applyAssign(
  client: PoolClient,
  proposal: ProposalRow,
  now: Date,
): Promise<string> {
  const staff = await client.query<{ department_id: string; status: string }>(
    "SELECT department_id, status FROM staff WHERE id = $1 FOR UPDATE",
    [proposal.target_staff_id],
  );
  const target = staff.rows[0];
  if (!target || target.status !== "ACTIVE") {
    abort(
      409,
      "TARGET_STAFF_NOT_ELIGIBLE",
      "Nhân sự đích không còn đủ điều kiện nhận quyền.",
    );
  }
  const dept = await client.query<{ status: string }>(
    "SELECT status FROM departments WHERE id = $1 FOR SHARE",
    [target.department_id],
  );
  if (dept.rows[0]?.status !== "ACTIVE") {
    abort(
      409,
      "TARGET_STAFF_NOT_ELIGIBLE",
      "Phòng của nhân sự đích không còn hoạt động.",
    );
  }
  if (
    proposal.role_code === "DEPARTMENT_MANAGER" &&
    proposal.scope_department_id !== target.department_id
  ) {
    abort(
      409,
      "PROPOSAL_SCOPE_STALE",
      "Phòng của nhân sự đã thay đổi; đề nghị không còn hợp lệ.",
    );
  }

  // New assignment never starts in the past: it takes effect at approval time at the earliest.
  const newFrom =
    proposal.effective_from.getTime() > now.getTime()
      ? proposal.effective_from
      : now;
  if (
    proposal.effective_to &&
    proposal.effective_to.getTime() <= newFrom.getTime()
  ) {
    abort(
      409,
      "PROPOSAL_EXPIRED",
      "Khoảng hiệu lực đề nghị đã hết trước thời điểm phê duyệt.",
    );
  }

  const existing = await client.query<{
    id: string;
    effective_from: Date;
    effective_to: Date | null;
  }>(
    `SELECT id, effective_from, effective_to FROM role_assignments
      WHERE staff_id = $1 AND status = 'ACTIVE' FOR UPDATE`,
    [proposal.target_staff_id],
  );
  for (const old of existing.rows) {
    const handover =
      newFrom.getTime() > now.getTime() &&
      old.effective_from.getTime() < newFrom.getTime();
    if (handover) {
      // Future start: old role stays valid until exactly newFrom (half-open, no gap, no overlap).
      await client.query(
        `UPDATE role_assignments
            SET effective_to = CASE WHEN effective_to IS NULL OR effective_to > $2::timestamptz
                                    THEN $2::timestamptz ELSE effective_to END
          WHERE id = $1`,
        [old.id, newFrom.toISOString()],
      );
    } else {
      await client.query(
        `UPDATE role_assignments
            SET status = 'REVOKED',
                effective_to = CASE WHEN effective_from < $2::timestamptz THEN $2::timestamptz ELSE effective_to END
          WHERE id = $1`,
        [old.id, now.toISOString()],
      );
    }
  }

  const id = randomUUID();
  await client.query(
    `INSERT INTO role_assignments (
       id, staff_id, role_code, scope_type, scope_department_id,
       effective_from, effective_to, status, approval_reference
     ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,'ACTIVE',$8)`,
    [
      id,
      proposal.target_staff_id,
      proposal.role_code,
      proposal.scope_type,
      proposal.scope_department_id,
      newFrom.toISOString(),
      proposal.effective_to ? proposal.effective_to.toISOString() : null,
      `PROPOSAL:${proposal.id}`,
    ],
  );
  return id;
}

async function applyRevoke(
  client: PoolClient,
  proposal: ProposalRow,
  now: Date,
): Promise<string> {
  const res = await client.query(
    `UPDATE role_assignments
        SET status = 'REVOKED',
            effective_to = CASE WHEN effective_from < $3::timestamptz THEN $3::timestamptz ELSE effective_to END
      WHERE id = $1 AND staff_id = $2 AND status = 'ACTIVE'`,
    [
      proposal.target_assignment_id,
      proposal.target_staff_id,
      now.toISOString(),
    ],
  );
  if (res.rowCount === 0) {
    abort(
      409,
      "TARGET_ASSIGNMENT_NOT_ACTIVE",
      "Phân quyền cần thu hồi không còn hiệu lực.",
    );
  }
  return proposal.target_assignment_id!;
}

export async function decideProposal(
  actor: Actor,
  id: string,
  body: unknown,
): Promise<ServiceResult<ProposalView>> {
  if (!isUuid(id)) {
    return finalizeFailure(
      actor,
      fail(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy tài nguyên yêu cầu trong phạm vi được phép.",
        {
          denyAudit: {
            action: "authz.role.assign",
            resourceType: "role_assignment_proposal",
            resourceId: "invalid-reference",
            scopeContext: { reason: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND" },
            reasonCode: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND",
          },
        },
      ),
    );
  }
  // Role gate before touching the body: only EXECUTIVE may decide.
  const roleGate = authorize(
    actor,
    { action: "authz.role.assign", roleWorkflowPhase: "decide" },
    { type: "role_assignment_proposal", id },
  );
  if (roleGate) return finalizeFailure(actor, roleGate);
  if (!isPlainObject(body)) return validationFailure("body", "MUST_BE_OBJECT");
  const unknown = rejectUnknownKeys(body, DECISION_KEYS);
  if (!unknown.ok) return validationFailure(unknown.field, unknown.reason);
  const decision = readString(body, "decision", {
    max: 8,
    pattern: /^(APPROVE|REJECT)$/,
  });
  if (!decision.ok) return validationFailure(decision.field, decision.reason);
  const version = readExpectedVersion(body);
  if (!version.ok) return validationFailure(version.field, version.reason);
  const reason = readString(body, "reason", {
    max: 280,
    optional: decision.value === "APPROVE",
  });
  if (!reason.ok) return validationFailure(reason.field, reason.reason);
  const proposalId = id.toLowerCase();

  return runAuthorityTransaction(actor, async (client) => {
    const cur = await client.query<ProposalRow>(
      `SELECT id, target_staff_id, propose_action, target_assignment_id, role_code, scope_type,
              scope_department_id, effective_from, effective_to, status, proposer_staff_id, row_version
         FROM role_assignment_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    if (cur.rowCount === 0) {
      abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy tài nguyên yêu cầu trong phạm vi được phép.",
      );
    }
    const proposal = cur.rows[0]!;

    // Maker-checker: approver != proposer and approver != target (re-evaluated under lock).
    const authz = authorize(
      actor,
      {
        action: "authz.role.assign",
        roleWorkflowPhase: "decide",
        targetStaffId: proposal.target_staff_id,
        proposerStaffId: proposal.proposer_staff_id,
      },
      { type: "role_assignment_proposal", id: proposalId },
    );
    if (authz) throw new ServiceAbort(authz);

    if (proposal.status !== "PENDING") {
      abort(
        409,
        "PROPOSAL_NOT_PENDING",
        "Đề nghị không còn ở trạng thái chờ duyệt.",
      );
    }
    if (proposal.row_version !== version.value) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Đề nghị đã được cập nhật bởi thao tác khác.",
      );
    }

    const now = new Date();
    let appliedId: string | null = null;
    let nextStatus: "APPROVED" | "REJECTED" = "REJECTED";
    if (decision.value === "APPROVE") {
      appliedId =
        proposal.propose_action === "ASSIGN"
          ? await applyAssign(client, proposal, now)
          : await applyRevoke(client, proposal, now);
      nextStatus = "APPROVED";
      await client.query(
        `UPDATE sessions SET revoked_at = $2::timestamptz, revoked_reason = 'ROLE_PROPOSAL_APPLIED'
          WHERE staff_id = $1 AND revoked_at IS NULL`,
        [proposal.target_staff_id, now.toISOString()],
      );
    }

    const res = await client.query<ProposalView>(
      `WITH upd AS (
         UPDATE role_assignment_proposals
            SET status = $3, approver_staff_id = $4, decided_at = $5::timestamptz,
                decision_reason = $6, applied_assignment_id = $7
          WHERE id = $1 AND row_version = $2
          RETURNING *)
       SELECT ${PROPOSAL_COLUMNS} FROM upd p`,
      [
        proposalId,
        version.value,
        nextStatus,
        actor.ctx.staff_id,
        now.toISOString(),
        reason.value ?? null,
        appliedId,
      ],
    );
    if (res.rowCount === 0) {
      abort(
        409,
        "VERSION_CONFLICT",
        "Đề nghị đã được cập nhật bởi thao tác khác.",
      );
    }
    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "authz.role.assign",
      resourceType: "role_assignment_proposal",
      resourceId: proposalId,
      scopeContext: {
        phase: "decide",
        decision: nextStatus,
        propose_action: proposal.propose_action,
        target_staff_id: proposal.target_staff_id,
      },
      decision: "ALLOW",
      reasonCode: "ALLOW_ROLE_DECIDE_EXECUTIVE",
    });
    return res.rows[0]!;
  });
}
