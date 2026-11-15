import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { appendAuditEvent } from "@/server/audit";
import { getRuntimePool } from "@/server/db";
import { KPI_GROUPS, type KpiGroupCode } from "@/server/kpi/p0a-service";
import {
  abort,
  authorize,
  fail,
  finalizeFailure,
  notFound,
  runAuthorityTransaction,
  tamperRejected,
  type Actor,
  type ServiceResult,
} from "@/server/service-core";
import {
  findDisallowedTamperKey,
  isPlainObject,
  isUuid,
  readExpectedVersion,
  readPageParams,
  readString,
  validateQueryParams,
  isValidIsoDate,
} from "@/server/validation";
import {
  isValidLeadTransition,
  isValidOpportunityTransition,
  isValidProspectTransition,
  LEAD_STAGES,
  OPPORTUNITY_STAGES,
  PROSPECT_STAGES,
  type LeadStage,
  type OpportunityStage,
  type ProspectStage,
} from "./state-machine";

export const SEGMENTS = ["RETAIL", "SME", "CORP"] as const;
export type SegmentCode = (typeof SEGMENTS)[number];

export interface ProspectRow {
  id: string;
  prospect_ref: string;
  display_label: string;
  segment_code: SegmentCode;
  department_id: string;
  department_code: string;
  owner_staff_id: string;
  owner_staff_code: string;
  stage: ProspectStage;
  notes: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface LeadRow {
  id: string;
  lead_ref: string;
  prospect_id: string | null;
  customer_ref: string | null;
  display_label: string;
  need_group_code: KpiGroupCode;
  department_id: string;
  department_code: string;
  owner_staff_id: string;
  owner_staff_code: string;
  stage: LeadStage;
  due_date: string | null;
  last_contacted_at: string | null;
  notes: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRow {
  id: string;
  opportunity_ref: string;
  lead_id: string | null;
  customer_ref: string;
  display_label: string;
  kpi_group_code: KpiGroupCode;
  estimated_value: number;
  department_id: string;
  department_code: string;
  owner_staff_id: string;
  owner_staff_code: string;
  stage: OpportunityStage;
  expected_close_date: string | null;
  notes: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

function formatPgDate(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function mapProspect(r: Record<string, unknown>): ProspectRow {
  return {
    id: String(r.id),
    prospect_ref: String(r.prospect_ref),
    display_label: String(r.display_label),
    segment_code: String(r.segment_code) as SegmentCode,
    department_id: String(r.department_id),
    department_code: String(r.department_code),
    owner_staff_id: String(r.owner_staff_id),
    owner_staff_code: String(r.owner_staff_code),
    stage: String(r.stage) as ProspectStage,
    notes: r.notes ? String(r.notes) : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

function mapLead(r: Record<string, unknown>): LeadRow {
  return {
    id: String(r.id),
    lead_ref: String(r.lead_ref),
    prospect_id: r.prospect_id ? String(r.prospect_id) : null,
    customer_ref: r.customer_ref ? String(r.customer_ref) : null,
    display_label: String(r.display_label),
    need_group_code: String(r.need_group_code) as KpiGroupCode,
    department_id: String(r.department_id),
    department_code: String(r.department_code),
    owner_staff_id: String(r.owner_staff_id),
    owner_staff_code: String(r.owner_staff_code),
    stage: String(r.stage) as LeadStage,
    due_date: formatPgDate(r.due_date),
    last_contacted_at: r.last_contacted_at
      ? new Date(String(r.last_contacted_at)).toISOString()
      : null,
    notes: r.notes ? String(r.notes) : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

function mapOpportunity(r: Record<string, unknown>): OpportunityRow {
  return {
    id: String(r.id),
    opportunity_ref: String(r.opportunity_ref),
    lead_id: r.lead_id ? String(r.lead_id) : null,
    customer_ref: String(r.customer_ref),
    display_label: String(r.display_label),
    kpi_group_code: String(r.kpi_group_code) as KpiGroupCode,
    estimated_value: Number(r.estimated_value),
    department_id: String(r.department_id),
    department_code: String(r.department_code),
    owner_staff_id: String(r.owner_staff_id),
    owner_staff_code: String(r.owner_staff_code),
    stage: String(r.stage) as OpportunityStage,
    expected_close_date: formatPgDate(r.expected_close_date),
    notes: r.notes ? String(r.notes) : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

async function recordTransition(
  client: PoolClient,
  input: {
    entityType: "PROSPECT" | "LEAD" | "OPPORTUNITY";
    entityId: string;
    fromStage: string | null;
    toStage: string;
    fromOwnerStaffId: string | null;
    toOwnerStaffId: string;
    note: string | null;
    changedByStaffId: string;
  },
) {
  await client.query(
    `INSERT INTO pipeline_stage_transitions (
       id, entity_type, entity_id, from_stage, to_stage,
       from_owner_staff_id, to_owner_staff_id, transition_note, changed_by_staff_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.entityType,
      input.entityId,
      input.fromStage,
      input.toStage,
      input.fromOwnerStaffId,
      input.toOwnerStaffId,
      input.note,
      input.changedByStaffId,
    ],
  );
}

// ============================================================================
// PROSPECTS
// ============================================================================

export async function listProspects(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<ProspectRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "stage",
    "department_id",
    "owner_staff_id",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("pipeline.read", "prospect", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }
  const page = readPageParams(url.searchParams);
  if (!page.ok) return fail(400, "VALIDATION_FAILED", page.reason);

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  const ownerParam = url.searchParams.get("owner_staff_id") ?? undefined;
  const stageParam = url.searchParams.get("stage") ?? undefined;
  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }
  if (ownerParam && !isUuid(ownerParam)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (stageParam && !PROSPECT_STAGES.includes(stageParam as ProspectStage)) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }

  const denied = authorize(
    actor,
    {
      action: "pipeline.read",
      targetDepartmentId: deptParam,
      targetStaffId: ownerParam,
    },
    { type: "prospect", id: ownerParam ?? deptParam ?? "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const where: string[] = [];
  const params: unknown[] = [];
  const roleCode = actor.ctx.effective_role.role_code;
  if (roleCode === "STAFF") {
    params.push(actor.ctx.staff_id);
    where.push(`p.owner_staff_id = $${params.length}`);
  } else if (roleCode === "DEPARTMENT_MANAGER") {
    params.push(actor.ctx.department.id);
    where.push(`p.department_id = $${params.length}`);
  }
  if (deptParam) {
    params.push(deptParam);
    where.push(`p.department_id = $${params.length}`);
  }
  if (ownerParam) {
    params.push(ownerParam);
    where.push(`p.owner_staff_id = $${params.length}`);
  }
  if (stageParam) {
    params.push(stageParam);
    where.push(`p.stage = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();
  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM prospects p ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  params.push(page.value.limit, page.value.offset);

  const res = await pool.query(
    `SELECT p.*, d.code AS department_code, s.staff_code AS owner_staff_code
     FROM prospects p
     JOIN departments d ON d.id = p.department_id
     JOIN staff s ON s.id = p.owner_staff_id
     ${whereSql}
     ORDER BY p.created_at DESC, p.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapProspect),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function createProspect(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<ProspectRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "prospect_ref",
    "display_label",
    "segment_code",
    "owner_staff_id",
    "notes",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "prospect", tamperKey),
    );
  }

  const refCheck = readString(body, "prospect_ref", {
    max: 64,
    pattern: /^SYN-[A-Z0-9_-]{3,60}$/,
  });
  const labelCheck = readString(body, "display_label", { max: 160 });
  const segCheck = readString(body, "segment_code", { max: 16 });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });

  for (const r of [refCheck, labelCheck, segCheck, ownerCheck, notesCheck]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (!segCheck.ok || !SEGMENTS.includes(segCheck.value as SegmentCode)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "segment_code must be RETAIL, SME, or CORP",
    );
  }
  const ownerId =
    ownerCheck.ok && ownerCheck.value ? ownerCheck.value : actor.ctx.staff_id;
  if (!isUuid(ownerId)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }

  const refVal = refCheck.ok ? refCheck.value! : "";
  const labelVal = labelCheck.ok ? labelCheck.value! : "";
  const segVal = segCheck.value!;
  const notesVal = notesCheck.ok ? notesCheck.value : null;

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const ownerRes = await client.query(
      `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
      [ownerId],
    );
    if ((ownerRes.rowCount ?? 0) === 0) {
      return abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy nhân sự.",
      );
    }
    const deptId = String(ownerRes.rows[0]?.department_id);
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: deptId,
        targetStaffId: ownerId,
      },
      { type: "prospect", id: refVal },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    const dup = await client.query(
      `SELECT id FROM prospects WHERE prospect_ref = $1`,
      [refVal],
    );
    if ((dup.rowCount ?? 0) > 0) {
      return abort(
        409,
        "DUPLICATE_PIPELINE_REF",
        "prospect_ref already exists",
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO prospects (
         id, prospect_ref, display_label, segment_code, department_id, owner_staff_id, stage, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7)`,
      [id, refVal, labelVal, segVal, deptId, ownerId, notesVal],
    );

    await recordTransition(client, {
      entityType: "PROSPECT",
      entityId: id,
      fromStage: null,
      toStage: "NEW",
      fromOwnerStaffId: null,
      toOwnerStaffId: ownerId,
      note: "Created synthetic prospect",
      changedByStaffId: actor.ctx.staff_id,
    });

    const rowRes = await client.query(
      `SELECT p.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM prospects p
       JOIN departments d ON d.id = p.department_id
       JOIN staff s ON s.id = p.owner_staff_id
       WHERE p.id = $1`,
      [id],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "prospect",
      resourceId: id,
      decision: "ALLOW",
      reasonCode: "PROSPECT_CREATED",
      scopeContext: { prospect_ref: refVal, stage: "NEW" },
    });

    return mapProspect(rowRes.rows[0]!);
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function patchProspect(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<ProspectRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "id",
    "expected_version",
    "stage",
    "owner_staff_id",
    "notes",
    "transition_note",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "prospect", tamperKey),
    );
  }
  const idCheck = readString(body, "id", { max: 64 });
  if (!idCheck.ok || !idCheck.value || !isUuid(idCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "id must be a valid UUID");
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  const stageCheck = readString(body, "stage", { max: 24, optional: true });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });
  const tNoteCheck = readString(body, "transition_note", {
    max: 500,
    optional: true,
  });
  for (const r of [stageCheck, ownerCheck, notesCheck, tNoteCheck]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (
    stageCheck.ok &&
    stageCheck.value &&
    !PROSPECT_STAGES.includes(stageCheck.value as ProspectStage)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }
  if (ownerCheck.ok && ownerCheck.value && !isUuid(ownerCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }

  const recordId = idCheck.value;
  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM prospects WHERE id = $1 FOR UPDATE`,
      [recordId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("prospect", recordId, "pipeline.write");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.owner_staff_id),
      },
      { type: "prospect", id: recordId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(409, "VERSION_CONFLICT", "prospect version conflict");
    }

    const fromStage = String(existing.stage) as ProspectStage;
    const toStage =
      stageCheck.ok && stageCheck.value
        ? (stageCheck.value as ProspectStage)
        : fromStage;
    if (!isValidProspectTransition(fromStage, toStage)) {
      return abort(
        409,
        "INVALID_STAGE_TRANSITION",
        `Invalid prospect transition ${fromStage} -> ${toStage}`,
      );
    }

    const fromOwner = String(existing.owner_staff_id);
    let toOwner = fromOwner;
    let toDept = String(existing.department_id);
    if (ownerCheck.ok && ownerCheck.value && ownerCheck.value !== fromOwner) {
      const newOwnerRes = await client.query(
        `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
        [ownerCheck.value],
      );
      if ((newOwnerRes.rowCount ?? 0) === 0) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhân sự bàn giao.",
        );
      }
      const newDept = String(newOwnerRes.rows[0]?.department_id);
      const handoverDenied = authorize(
        actor,
        {
          action: "pipeline.write",
          targetDepartmentId: newDept,
          targetStaffId: ownerCheck.value,
        },
        { type: "prospect", id: recordId },
      );
      if (handoverDenied) {
        return abort(
          handoverDenied.status,
          handoverDenied.code,
          handoverDenied.message,
          { denyAudit: handoverDenied.denyAudit },
        );
      }
      toOwner = ownerCheck.value;
      toDept = newDept;
    }

    const nextNotes =
      body.notes !== undefined
        ? notesCheck.ok
          ? notesCheck.value
          : null
        : (existing.notes as string | null);

    await client.query(
      `UPDATE prospects
       SET stage = $1, owner_staff_id = $2, department_id = $3, notes = $4
       WHERE id = $5`,
      [toStage, toOwner, toDept, nextNotes, recordId],
    );

    if (fromStage !== toStage || fromOwner !== toOwner) {
      await recordTransition(client, {
        entityType: "PROSPECT",
        entityId: recordId,
        fromStage,
        toStage,
        fromOwnerStaffId: fromOwner,
        toOwnerStaffId: toOwner,
        note: tNoteCheck.ok ? (tNoteCheck.value ?? null) : null,
        changedByStaffId: actor.ctx.staff_id,
      });
    }

    const rowRes = await client.query(
      `SELECT p.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM prospects p
       JOIN departments d ON d.id = p.department_id
       JOIN staff s ON s.id = p.owner_staff_id
       WHERE p.id = $1`,
      [recordId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "prospect",
      resourceId: recordId,
      decision: "ALLOW",
      reasonCode: "PROSPECT_UPDATED",
      scopeContext: { from_stage: fromStage, to_stage: toStage },
    });

    return mapProspect(rowRes.rows[0]!);
  });
}

// ============================================================================
// LEADS
// ============================================================================

export async function listLeads(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<LeadRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "stage",
    "department_id",
    "owner_staff_id",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("pipeline.read", "lead", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }
  const page = readPageParams(url.searchParams);
  if (!page.ok) return fail(400, "VALIDATION_FAILED", page.reason);

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  const ownerParam = url.searchParams.get("owner_staff_id") ?? undefined;
  const stageParam = url.searchParams.get("stage") ?? undefined;
  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }
  if (ownerParam && !isUuid(ownerParam)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (stageParam && !LEAD_STAGES.includes(stageParam as LeadStage)) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }

  const denied = authorize(
    actor,
    {
      action: "pipeline.read",
      targetDepartmentId: deptParam,
      targetStaffId: ownerParam,
    },
    { type: "lead", id: ownerParam ?? deptParam ?? "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const where: string[] = [];
  const params: unknown[] = [];
  const roleCode = actor.ctx.effective_role.role_code;
  if (roleCode === "STAFF") {
    params.push(actor.ctx.staff_id);
    where.push(`l.owner_staff_id = $${params.length}`);
  } else if (roleCode === "DEPARTMENT_MANAGER") {
    params.push(actor.ctx.department.id);
    where.push(`l.department_id = $${params.length}`);
  }
  if (deptParam) {
    params.push(deptParam);
    where.push(`l.department_id = $${params.length}`);
  }
  if (ownerParam) {
    params.push(ownerParam);
    where.push(`l.owner_staff_id = $${params.length}`);
  }
  if (stageParam) {
    params.push(stageParam);
    where.push(`l.stage = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();
  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM leads l ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  params.push(page.value.limit, page.value.offset);

  const res = await pool.query(
    `SELECT l.*, d.code AS department_code, s.staff_code AS owner_staff_code
     FROM leads l
     JOIN departments d ON d.id = l.department_id
     JOIN staff s ON s.id = l.owner_staff_id
     ${whereSql}
     ORDER BY l.created_at DESC, l.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapLead),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function createLead(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<LeadRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "lead_ref",
    "prospect_id",
    "customer_ref",
    "display_label",
    "need_group_code",
    "owner_staff_id",
    "due_date",
    "notes",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "lead", tamperKey),
    );
  }

  const refCheck = readString(body, "lead_ref", {
    max: 64,
    pattern: /^SYN-[A-Z0-9_-]{3,60}$/,
  });
  const prosCheck = readString(body, "prospect_id", {
    max: 64,
    optional: true,
  });
  const custCheck = readString(body, "customer_ref", {
    max: 64,
    optional: true,
    pattern: /^SYN-CIF-[A-Z0-9_-]+$/,
  });
  const labelCheck = readString(body, "display_label", { max: 160 });
  const grpCheck = readString(body, "need_group_code", { max: 32 });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const dueCheck = readString(body, "due_date", { max: 16, optional: true });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });

  for (const r of [
    refCheck,
    prosCheck,
    custCheck,
    labelCheck,
    grpCheck,
    ownerCheck,
    dueCheck,
    notesCheck,
  ]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (!grpCheck.ok || !KPI_GROUPS.includes(grpCheck.value as KpiGroupCode)) {
    return fail(400, "VALIDATION_FAILED", "Invalid need_group_code");
  }
  if (prosCheck.ok && prosCheck.value && !isUuid(prosCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "prospect_id must be a valid UUID");
  }
  if (dueCheck.ok && dueCheck.value && !isValidIsoDate(dueCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "due_date must be YYYY-MM-DD");
  }
  const ownerId =
    ownerCheck.ok && ownerCheck.value ? ownerCheck.value : actor.ctx.staff_id;
  if (!isUuid(ownerId)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }

  const refVal = refCheck.ok ? refCheck.value! : "";
  const prosVal = prosCheck.ok ? prosCheck.value : null;
  const custVal = custCheck.ok ? custCheck.value : null;
  const labelVal = labelCheck.ok ? labelCheck.value! : "";
  const grpVal = grpCheck.value!;
  const dueVal = dueCheck.ok ? dueCheck.value : null;
  const notesVal = notesCheck.ok ? notesCheck.value : null;

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const ownerRes = await client.query(
      `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
      [ownerId],
    );
    if ((ownerRes.rowCount ?? 0) === 0) {
      return abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy nhân sự.",
      );
    }
    const deptId = String(ownerRes.rows[0]?.department_id);
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: deptId,
        targetStaffId: ownerId,
      },
      { type: "lead", id: refVal },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    const dup = await client.query(`SELECT id FROM leads WHERE lead_ref = $1`, [
      refVal,
    ]);
    if ((dup.rowCount ?? 0) > 0) {
      return abort(409, "DUPLICATE_PIPELINE_REF", "lead_ref already exists");
    }

    if (prosVal) {
      const parentProspect = await client.query<{
        id: string;
        department_id: string;
        owner_staff_id: string;
      }>(
        `SELECT id, department_id, owner_staff_id FROM prospects WHERE id = $1`,
        [prosVal],
      );
      const pRow = parentProspect.rows[0];
      const actorRole = actor.ctx.effective_role.role_code;
      const outOfScope =
        !pRow ||
        (actorRole === "DEPARTMENT_MANAGER" &&
          pRow.department_id !== actor.ctx.department.id) ||
        (actorRole === "STAFF" &&
          (pRow.department_id !== actor.ctx.department.id ||
            pRow.owner_staff_id !== actor.ctx.staff_id));
      if (outOfScope) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy prospect trong phạm vi quyền.",
        );
      }
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO leads (
         id, lead_ref, prospect_id, customer_ref, display_label, need_group_code,
         department_id, owner_staff_id, stage, due_date, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW', $9, $10)`,
      [
        id,
        refVal,
        prosVal,
        custVal,
        labelVal,
        grpVal,
        deptId,
        ownerId,
        dueVal,
        notesVal,
      ],
    );

    await recordTransition(client, {
      entityType: "LEAD",
      entityId: id,
      fromStage: null,
      toStage: "NEW",
      fromOwnerStaffId: null,
      toOwnerStaffId: ownerId,
      note: "Created synthetic lead",
      changedByStaffId: actor.ctx.staff_id,
    });

    const rowRes = await client.query(
      `SELECT l.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM leads l
       JOIN departments d ON d.id = l.department_id
       JOIN staff s ON s.id = l.owner_staff_id
       WHERE l.id = $1`,
      [id],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "lead",
      resourceId: id,
      decision: "ALLOW",
      reasonCode: "LEAD_CREATED",
      scopeContext: { lead_ref: refVal, stage: "NEW" },
    });

    return mapLead(rowRes.rows[0]!);
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function patchLead(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<LeadRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "id",
    "expected_version",
    "stage",
    "owner_staff_id",
    "due_date",
    "notes",
    "transition_note",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "lead", tamperKey),
    );
  }
  const idCheck = readString(body, "id", { max: 64 });
  if (!idCheck.ok || !idCheck.value || !isUuid(idCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "id must be a valid UUID");
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  const stageCheck = readString(body, "stage", { max: 24, optional: true });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const dueCheck = readString(body, "due_date", { max: 16, optional: true });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });
  const tNoteCheck = readString(body, "transition_note", {
    max: 500,
    optional: true,
  });
  for (const r of [stageCheck, ownerCheck, dueCheck, notesCheck, tNoteCheck]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (
    stageCheck.ok &&
    stageCheck.value &&
    !LEAD_STAGES.includes(stageCheck.value as LeadStage)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }
  if (ownerCheck.ok && ownerCheck.value && !isUuid(ownerCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (dueCheck.ok && dueCheck.value && !isValidIsoDate(dueCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "due_date must be YYYY-MM-DD");
  }

  const recordId = idCheck.value;
  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM leads WHERE id = $1 FOR UPDATE`,
      [recordId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("lead", recordId, "pipeline.write");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.owner_staff_id),
      },
      { type: "lead", id: recordId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(409, "VERSION_CONFLICT", "lead version conflict");
    }

    const fromStage = String(existing.stage) as LeadStage;
    const toStage =
      stageCheck.ok && stageCheck.value
        ? (stageCheck.value as LeadStage)
        : fromStage;
    if (!isValidLeadTransition(fromStage, toStage)) {
      return abort(
        409,
        "INVALID_STAGE_TRANSITION",
        `Invalid lead transition ${fromStage} -> ${toStage}`,
      );
    }

    const fromOwner = String(existing.owner_staff_id);
    let toOwner = fromOwner;
    let toDept = String(existing.department_id);
    if (ownerCheck.ok && ownerCheck.value && ownerCheck.value !== fromOwner) {
      const newOwnerRes = await client.query(
        `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
        [ownerCheck.value],
      );
      if ((newOwnerRes.rowCount ?? 0) === 0) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhân sự bàn giao.",
        );
      }
      const newDept = String(newOwnerRes.rows[0]?.department_id);
      const handoverDenied = authorize(
        actor,
        {
          action: "pipeline.write",
          targetDepartmentId: newDept,
          targetStaffId: ownerCheck.value,
        },
        { type: "lead", id: recordId },
      );
      if (handoverDenied) {
        return abort(
          handoverDenied.status,
          handoverDenied.code,
          handoverDenied.message,
          { denyAudit: handoverDenied.denyAudit },
        );
      }
      toOwner = ownerCheck.value;
      toDept = newDept;
    }

    const nextDue =
      body.due_date !== undefined
        ? dueCheck.ok
          ? dueCheck.value
          : null
        : formatPgDate(existing.due_date);
    const nextNotes =
      body.notes !== undefined
        ? notesCheck.ok
          ? notesCheck.value
          : null
        : (existing.notes as string | null);

    await client.query(
      `UPDATE leads
       SET stage = $1, owner_staff_id = $2, department_id = $3, due_date = $4, notes = $5,
           last_contacted_at = CASE WHEN $1 = 'CONTACTED' THEN CURRENT_TIMESTAMP ELSE last_contacted_at END
       WHERE id = $6`,
      [toStage, toOwner, toDept, nextDue, nextNotes, recordId],
    );

    if (fromStage !== toStage || fromOwner !== toOwner) {
      await recordTransition(client, {
        entityType: "LEAD",
        entityId: recordId,
        fromStage,
        toStage,
        fromOwnerStaffId: fromOwner,
        toOwnerStaffId: toOwner,
        note: tNoteCheck.ok ? (tNoteCheck.value ?? null) : null,
        changedByStaffId: actor.ctx.staff_id,
      });
    }

    const rowRes = await client.query(
      `SELECT l.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM leads l
       JOIN departments d ON d.id = l.department_id
       JOIN staff s ON s.id = l.owner_staff_id
       WHERE l.id = $1`,
      [recordId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "lead",
      resourceId: recordId,
      decision: "ALLOW",
      reasonCode: "LEAD_UPDATED",
      scopeContext: { from_stage: fromStage, to_stage: toStage },
    });

    return mapLead(rowRes.rows[0]!);
  });
}

// ============================================================================
// OPPORTUNITIES
// ============================================================================

export async function listOpportunities(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<OpportunityRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "stage",
    "department_id",
    "owner_staff_id",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("pipeline.read", "opportunity", qv.field),
      );
    }
    return fail(400, "VALIDATION_FAILED", qv.reason);
  }
  const page = readPageParams(url.searchParams);
  if (!page.ok) return fail(400, "VALIDATION_FAILED", page.reason);

  const deptParam = url.searchParams.get("department_id") ?? undefined;
  const ownerParam = url.searchParams.get("owner_staff_id") ?? undefined;
  const stageParam = url.searchParams.get("stage") ?? undefined;
  if (deptParam && !isUuid(deptParam)) {
    return fail(400, "VALIDATION_FAILED", "department_id must be a valid UUID");
  }
  if (ownerParam && !isUuid(ownerParam)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (
    stageParam &&
    !OPPORTUNITY_STAGES.includes(stageParam as OpportunityStage)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }

  const denied = authorize(
    actor,
    {
      action: "pipeline.read",
      targetDepartmentId: deptParam,
      targetStaffId: ownerParam,
    },
    { type: "opportunity", id: ownerParam ?? deptParam ?? "list" },
  );
  if (denied) return finalizeFailure(actor, denied);

  const where: string[] = [];
  const params: unknown[] = [];
  const roleCode = actor.ctx.effective_role.role_code;
  if (roleCode === "STAFF") {
    params.push(actor.ctx.staff_id);
    where.push(`o.owner_staff_id = $${params.length}`);
  } else if (roleCode === "DEPARTMENT_MANAGER") {
    params.push(actor.ctx.department.id);
    where.push(`o.department_id = $${params.length}`);
  }
  if (deptParam) {
    params.push(deptParam);
    where.push(`o.department_id = $${params.length}`);
  }
  if (ownerParam) {
    params.push(ownerParam);
    where.push(`o.owner_staff_id = $${params.length}`);
  }
  if (stageParam) {
    params.push(stageParam);
    where.push(`o.stage = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getRuntimePool();
  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM opportunities o ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  params.push(page.value.limit, page.value.offset);

  const res = await pool.query(
    `SELECT o.*, d.code AS department_code, s.staff_code AS owner_staff_code
     FROM opportunities o
     JOIN departments d ON d.id = o.department_id
     JOIN staff s ON s.id = o.owner_staff_id
     ${whereSql}
     ORDER BY o.created_at DESC, o.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapOpportunity),
    page: { limit: page.value.limit, offset: page.value.offset, total },
  };
}

export async function createOpportunity(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<OpportunityRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "opportunity_ref",
    "lead_id",
    "customer_ref",
    "display_label",
    "kpi_group_code",
    "estimated_value",
    "owner_staff_id",
    "expected_close_date",
    "notes",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "opportunity", tamperKey),
    );
  }

  const refCheck = readString(body, "opportunity_ref", {
    max: 64,
    pattern: /^SYN-[A-Z0-9_-]{3,60}$/,
  });
  const leadCheck = readString(body, "lead_id", { max: 64, optional: true });
  const custCheck = readString(body, "customer_ref", {
    max: 64,
    pattern: /^SYN-CIF-[A-Z0-9_-]+$/,
  });
  const labelCheck = readString(body, "display_label", { max: 160 });
  const grpCheck = readString(body, "kpi_group_code", { max: 32 });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const closeCheck = readString(body, "expected_close_date", {
    max: 16,
    optional: true,
  });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });

  for (const r of [
    refCheck,
    leadCheck,
    custCheck,
    labelCheck,
    grpCheck,
    ownerCheck,
    closeCheck,
    notesCheck,
  ]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (!grpCheck.ok || !KPI_GROUPS.includes(grpCheck.value as KpiGroupCode)) {
    return fail(400, "VALIDATION_FAILED", "Invalid kpi_group_code");
  }
  if (leadCheck.ok && leadCheck.value && !isUuid(leadCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "lead_id must be a valid UUID");
  }
  if (closeCheck.ok && closeCheck.value && !isValidIsoDate(closeCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "expected_close_date must be YYYY-MM-DD",
    );
  }
  if (
    typeof body.estimated_value !== "number" ||
    !Number.isFinite(body.estimated_value) ||
    body.estimated_value < 0
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "estimated_value must be a non-negative finite number",
    );
  }

  const ownerId =
    ownerCheck.ok && ownerCheck.value ? ownerCheck.value : actor.ctx.staff_id;
  if (!isUuid(ownerId)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }

  const refVal = refCheck.ok ? refCheck.value! : "";
  const leadVal = leadCheck.ok ? leadCheck.value : null;
  const custVal = custCheck.ok ? custCheck.value! : "";
  const labelVal = labelCheck.ok ? labelCheck.value! : "";
  const grpVal = grpCheck.value!;
  const estVal =
    Math.round((body.estimated_value + Number.EPSILON) * 100) / 100;
  const closeVal = closeCheck.ok ? closeCheck.value : null;
  const notesVal = notesCheck.ok ? notesCheck.value : null;

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const ownerRes = await client.query(
      `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
      [ownerId],
    );
    if ((ownerRes.rowCount ?? 0) === 0) {
      return abort(
        404,
        "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
        "Không tìm thấy nhân sự.",
      );
    }
    const deptId = String(ownerRes.rows[0]?.department_id);
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: deptId,
        targetStaffId: ownerId,
      },
      { type: "opportunity", id: refVal },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }

    const dup = await client.query(
      `SELECT id FROM opportunities WHERE opportunity_ref = $1`,
      [refVal],
    );
    if ((dup.rowCount ?? 0) > 0) {
      return abort(
        409,
        "DUPLICATE_PIPELINE_REF",
        "opportunity_ref already exists",
      );
    }

    if (leadVal) {
      const parentLead = await client.query<{
        id: string;
        department_id: string;
        owner_staff_id: string;
      }>(`SELECT id, department_id, owner_staff_id FROM leads WHERE id = $1`, [
        leadVal,
      ]);
      const lRow = parentLead.rows[0];
      const actorRole = actor.ctx.effective_role.role_code;
      const outOfScope =
        !lRow ||
        (actorRole === "DEPARTMENT_MANAGER" &&
          lRow.department_id !== actor.ctx.department.id) ||
        (actorRole === "STAFF" &&
          (lRow.department_id !== actor.ctx.department.id ||
            lRow.owner_staff_id !== actor.ctx.staff_id));
      if (outOfScope) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy lead trong phạm vi quyền.",
        );
      }
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO opportunities (
         id, opportunity_ref, lead_id, customer_ref, display_label, kpi_group_code,
         estimated_value, department_id, owner_staff_id, stage, expected_close_date, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PROPOSAL', $10, $11)`,
      [
        id,
        refVal,
        leadVal,
        custVal,
        labelVal,
        grpVal,
        estVal,
        deptId,
        ownerId,
        closeVal,
        notesVal,
      ],
    );

    await recordTransition(client, {
      entityType: "OPPORTUNITY",
      entityId: id,
      fromStage: null,
      toStage: "PROPOSAL",
      fromOwnerStaffId: null,
      toOwnerStaffId: ownerId,
      note: "Created synthetic opportunity",
      changedByStaffId: actor.ctx.staff_id,
    });

    const rowRes = await client.query(
      `SELECT o.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM opportunities o
       JOIN departments d ON d.id = o.department_id
       JOIN staff s ON s.id = o.owner_staff_id
       WHERE o.id = $1`,
      [id],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "opportunity",
      resourceId: id,
      decision: "ALLOW",
      reasonCode: "OPPORTUNITY_CREATED",
      scopeContext: { opportunity_ref: refVal, stage: "PROPOSAL" },
    });

    return mapOpportunity(rowRes.rows[0]!);
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function patchOpportunity(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<OpportunityRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "id",
    "expected_version",
    "stage",
    "owner_staff_id",
    "estimated_value",
    "expected_close_date",
    "notes",
    "transition_note",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("pipeline.write", "opportunity", tamperKey),
    );
  }
  const idCheck = readString(body, "id", { max: 64 });
  if (!idCheck.ok || !idCheck.value || !isUuid(idCheck.value)) {
    return fail(400, "VALIDATION_FAILED", "id must be a valid UUID");
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok)
    return fail(400, "VALIDATION_FAILED", expectedVer.reason);

  const stageCheck = readString(body, "stage", { max: 24, optional: true });
  const ownerCheck = readString(body, "owner_staff_id", {
    max: 64,
    optional: true,
  });
  const closeCheck = readString(body, "expected_close_date", {
    max: 16,
    optional: true,
  });
  const notesCheck = readString(body, "notes", { max: 500, optional: true });
  const tNoteCheck = readString(body, "transition_note", {
    max: 500,
    optional: true,
  });
  for (const r of [
    stageCheck,
    ownerCheck,
    closeCheck,
    notesCheck,
    tNoteCheck,
  ]) {
    if (!r.ok) return fail(400, "VALIDATION_FAILED", r.reason);
  }
  if (
    stageCheck.ok &&
    stageCheck.value &&
    !OPPORTUNITY_STAGES.includes(stageCheck.value as OpportunityStage)
  ) {
    return fail(400, "VALIDATION_FAILED", "Invalid stage");
  }
  if (ownerCheck.ok && ownerCheck.value && !isUuid(ownerCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "owner_staff_id must be a valid UUID",
    );
  }
  if (closeCheck.ok && closeCheck.value && !isValidIsoDate(closeCheck.value)) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "expected_close_date must be YYYY-MM-DD",
    );
  }
  if (
    body.estimated_value !== undefined &&
    (typeof body.estimated_value !== "number" ||
      !Number.isFinite(body.estimated_value) ||
      body.estimated_value < 0)
  ) {
    return fail(
      400,
      "VALIDATION_FAILED",
      "estimated_value must be a non-negative finite number",
    );
  }

  const recordId = idCheck.value;
  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM opportunities WHERE id = $1 FOR UPDATE`,
      [recordId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound("opportunity", recordId, "pipeline.write");
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const denied = authorize(
      actor,
      {
        action: "pipeline.write",
        targetDepartmentId: String(existing.department_id),
        targetStaffId: String(existing.owner_staff_id),
      },
      { type: "opportunity", id: recordId },
    );
    if (denied) {
      return abort(denied.status, denied.code, denied.message, {
        denyAudit: denied.denyAudit,
      });
    }
    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(409, "VERSION_CONFLICT", "opportunity version conflict");
    }

    const fromStage = String(existing.stage) as OpportunityStage;
    const toStage =
      stageCheck.ok && stageCheck.value
        ? (stageCheck.value as OpportunityStage)
        : fromStage;
    if (!isValidOpportunityTransition(fromStage, toStage)) {
      return abort(
        409,
        "INVALID_STAGE_TRANSITION",
        `Invalid opportunity transition ${fromStage} -> ${toStage}`,
      );
    }

    const fromOwner = String(existing.owner_staff_id);
    let toOwner = fromOwner;
    let toDept = String(existing.department_id);
    if (ownerCheck.ok && ownerCheck.value && ownerCheck.value !== fromOwner) {
      const newOwnerRes = await client.query(
        `SELECT id, department_id FROM staff WHERE id = $1 AND status = 'ACTIVE'`,
        [ownerCheck.value],
      );
      if ((newOwnerRes.rowCount ?? 0) === 0) {
        return abort(
          404,
          "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE",
          "Không tìm thấy nhân sự bàn giao.",
        );
      }
      const newDept = String(newOwnerRes.rows[0]?.department_id);
      const handoverDenied = authorize(
        actor,
        {
          action: "pipeline.write",
          targetDepartmentId: newDept,
          targetStaffId: ownerCheck.value,
        },
        { type: "opportunity", id: recordId },
      );
      if (handoverDenied) {
        return abort(
          handoverDenied.status,
          handoverDenied.code,
          handoverDenied.message,
          { denyAudit: handoverDenied.denyAudit },
        );
      }
      toOwner = ownerCheck.value;
      toDept = newDept;
    }

    const nextEst =
      body.estimated_value !== undefined
        ? Math.round((Number(body.estimated_value) + Number.EPSILON) * 100) /
          100
        : Number(existing.estimated_value);
    const nextClose =
      body.expected_close_date !== undefined
        ? closeCheck.ok
          ? closeCheck.value
          : null
        : formatPgDate(existing.expected_close_date);
    const nextNotes =
      body.notes !== undefined
        ? notesCheck.ok
          ? notesCheck.value
          : null
        : (existing.notes as string | null);

    await client.query(
      `UPDATE opportunities
       SET stage = $1, owner_staff_id = $2, department_id = $3,
           estimated_value = $4, expected_close_date = $5, notes = $6
       WHERE id = $7`,
      [toStage, toOwner, toDept, nextEst, nextClose, nextNotes, recordId],
    );

    if (fromStage !== toStage || fromOwner !== toOwner) {
      await recordTransition(client, {
        entityType: "OPPORTUNITY",
        entityId: recordId,
        fromStage,
        toStage,
        fromOwnerStaffId: fromOwner,
        toOwnerStaffId: toOwner,
        note: tNoteCheck.ok ? (tNoteCheck.value ?? null) : null,
        changedByStaffId: actor.ctx.staff_id,
      });
    }

    const rowRes = await client.query(
      `SELECT o.*, d.code AS department_code, s.staff_code AS owner_staff_code
       FROM opportunities o
       JOIN departments d ON d.id = o.department_id
       JOIN staff s ON s.id = o.owner_staff_id
       WHERE o.id = $1`,
      [recordId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "pipeline.write",
      resourceType: "opportunity",
      resourceId: recordId,
      decision: "ALLOW",
      reasonCode: "OPPORTUNITY_UPDATED",
      scopeContext: { from_stage: fromStage, to_stage: toStage },
    });

    return mapOpportunity(rowRes.rows[0]!);
  });
}
