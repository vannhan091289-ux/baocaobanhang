import { randomUUID } from "node:crypto";
import { appendAuditEvent } from "@/server/audit";
import { getRuntimePool } from "@/server/db";
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
  readExpectedVersion,
  readPageParams,
  readString,
  readUuid,
  validateQueryParams,
} from "@/server/validation";

function readEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  opts?: { optional?: boolean },
): { ok: true; value: T | undefined } | { ok: false; reason: string } {
  const s = readString(body, field, { max: 64, optional: opts?.optional });
  if (!s.ok) return s;
  if (s.value === undefined) return { ok: true, value: undefined };
  if (!allowed.includes(s.value as T)) {
    return {
      ok: false,
      reason: `${field} must be one of ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: s.value as T };
}

const REF_CODE_PATTERN = /^SYN-CIF-[A-Z0-9_-]{3,56}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEGMENT_CODES = ["KHCN", "KHDN", "HKD"] as const;
const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
const MILESTONE_TYPES = ["MATURITY", "RENEWAL", "REVIEW"] as const;
const MILESTONE_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;
const DRILLDOWN_LEVELS = ["BRANCH", "DEPARTMENT", "STAFF", "ITEM"] as const;

export interface CustomerReferenceRow {
  id: string;
  customer_ref_code: string;
  segment_code: "KHCN" | "KHDN" | "HKD";
  display_name: string;
  managing_department_id: string;
  managing_department_code: string;
  assigned_staff_id: string;
  assigned_staff_code: string;
  status: "ACTIVE" | "INACTIVE";
  maturity_date: string | null;
  renewal_date: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerMilestoneRow {
  id: string;
  customer_reference_id: string;
  milestone_type: "MATURITY" | "RENEWAL" | "REVIEW";
  due_date: string;
  title: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  note: string | null;
  row_version: number;
  created_at: string;
}

export interface Customer360Bundle {
  customer: CustomerReferenceRow;
  milestones: CustomerMilestoneRow[];
  opportunities: Array<{
    id: string;
    opportunity_ref: string;
    display_label: string;
    kpi_group_code: string;
    stage: string;
    estimated_value: number;
    expected_close_date: string | null;
    owner_staff_code: string;
  }>;
  activity_logs: Array<{
    id: string;
    activity_type: string;
    status: string;
    occurred_at: string;
    outcome_note: string | null;
    actor_staff_code: string;
  }>;
  alerts: Array<{
    id: string;
    rule_code: string;
    severity: string;
    title: string;
    resolution_status: string;
    read_at: string | null;
  }>;
}

export interface DashboardDrilldownResult {
  level: "BRANCH" | "DEPARTMENT" | "STAFF" | "ITEM";
  period_key: string;
  departments: Array<{
    id: string;
    code: string;
    name: string;
    staff_count: number;
    customer_count: number;
    opportunity_count: number;
    open_alert_count: number;
  }>;
  staff_nodes: Array<{
    id: string;
    staff_code: string;
    display_name: string;
    department_id: string;
    department_code: string;
    customer_count: number;
    activity_count: number;
    opportunity_count: number;
  }>;
  items: {
    customers: Array<{
      id: string;
      customer_ref_code: string;
      display_name: string;
      segment_code: string;
      maturity_date: string | null;
      renewal_date: string | null;
    }>;
    opportunities: Array<{
      id: string;
      opportunity_ref: string;
      display_label: string;
      stage: string;
      estimated_value: number;
      customer_reference_id: string | null;
    }>;
    kpi_actuals: Array<{
      id: string;
      metric_code: string;
      actual_value: number | null;
      data_state: string;
      reconciliation_status: string;
    }>;
  };
}

function toDateStr(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function mapCustomerRow(r: Record<string, unknown>): CustomerReferenceRow {
  return {
    id: String(r.id),
    customer_ref_code: String(r.customer_ref_code),
    segment_code: String(
      r.segment_code,
    ) as CustomerReferenceRow["segment_code"],
    display_name: String(r.display_name),
    managing_department_id: String(r.managing_department_id),
    managing_department_code: String(r.managing_department_code ?? ""),
    assigned_staff_id: String(r.assigned_staff_id),
    assigned_staff_code: String(r.assigned_staff_code ?? ""),
    status: String(r.status) as CustomerReferenceRow["status"],
    maturity_date: toDateStr(r.maturity_date),
    renewal_date: toDateStr(r.renewal_date),
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
    updated_at: new Date(String(r.updated_at)).toISOString(),
  };
}

function mapMilestoneRow(r: Record<string, unknown>): CustomerMilestoneRow {
  return {
    id: String(r.id),
    customer_reference_id: String(r.customer_reference_id),
    milestone_type: String(
      r.milestone_type,
    ) as CustomerMilestoneRow["milestone_type"],
    due_date: toDateStr(r.due_date) ?? "",
    title: String(r.title),
    status: String(r.status) as CustomerMilestoneRow["status"],
    note: r.note ? String(r.note) : null,
    row_version: Number(r.row_version),
    created_at: new Date(String(r.created_at)).toISOString(),
  };
}

export async function listCustomerReferences(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<CustomerReferenceRow[]>> {
  const qv = validateQueryParams(url.searchParams, [
    "segment_code",
    "status",
    "department_id",
    "assigned_staff_id",
    "limit",
    "offset",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected("customer360.read", "customer_reference", qv.field),
      );
    }
    return fail(400, "VALIDATION_ERROR", qv.reason);
  }

  const page = readPageParams(url.searchParams);
  if (!page.ok) return fail(400, "VALIDATION_ERROR", page.reason);

  const denied = authorize(
    actor,
    {
      action: "customer360.read",
      targetDepartmentId: url.searchParams.get("department_id") ?? undefined,
      targetStaffId: url.searchParams.get("assigned_staff_id") ?? undefined,
    },
    {
      type: "customer_reference",
      id: "list",
    },
  );
  if (denied) return finalizeFailure(actor, denied);

  const role = actor.ctx.effective_role.role_code;
  const deptFilter =
    role === "EXECUTIVE"
      ? url.searchParams.get("department_id")
      : actor.ctx.department.id;
  const staffFilter =
    role === "STAFF"
      ? actor.ctx.staff_id
      : url.searchParams.get("assigned_staff_id");

  const segFilter = url.searchParams.get("segment_code");
  const statusFilter = url.searchParams.get("status");

  const pool = getRuntimePool();
  const res = await pool.query(
    `SELECT cr.*, d.code AS managing_department_code, s.staff_code AS assigned_staff_code
     FROM customer_references cr
     JOIN departments d ON d.id = cr.managing_department_id
     JOIN staff s ON s.id = cr.assigned_staff_id
     WHERE ($1::uuid IS NULL OR cr.managing_department_id = $1)
       AND ($2::uuid IS NULL OR cr.assigned_staff_id = $2)
       AND ($3::text IS NULL OR cr.segment_code = $3)
       AND ($4::text IS NULL OR cr.status = $4)
     ORDER BY cr.created_at DESC
     LIMIT $5 OFFSET $6`,
    [
      deptFilter || null,
      staffFilter || null,
      segFilter || null,
      statusFilter || null,
      page.value.limit,
      page.value.offset,
    ],
  );

  return {
    ok: true,
    status: 200,
    data: res.rows.map(mapCustomerRow),
  };
}

export async function createCustomerReference(
  actor: Actor,
  body: unknown,
): Promise<ServiceResult<CustomerReferenceRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }
  const allowedCreateKeys = new Set([
    "customer_ref_code",
    "segment_code",
    "display_name",
    "managing_department_id",
    "assigned_staff_id",
    "maturity_date",
    "renewal_date",
  ]);
  const tamperKey =
    findDisallowedTamperKey(Object.keys(body), [...allowedCreateKeys]) ??
    Object.keys(body).find((k) => !allowedCreateKeys.has(k));
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("customer360.write", "customer_reference", tamperKey),
    );
  }

  const refCheck = readString(body, "customer_ref_code", {
    max: 64,
    pattern: REF_CODE_PATTERN,
  });
  if (!refCheck.ok || !refCheck.value) {
    return fail(
      400,
      "INVALID_FORMAT",
      "customer_ref_code must match ^SYN-CIF-[A-Z0-9_-]{3,56}$",
    );
  }
  const segCheck = readEnum(body, "segment_code", SEGMENT_CODES);
  if (!segCheck.ok || !segCheck.value) {
    return fail(400, "VALIDATION_ERROR", "Invalid segment_code");
  }
  const nameCheck = readString(body, "display_name", { min: 2, max: 160 });
  if (!nameCheck.ok || !nameCheck.value) {
    return fail(400, "VALIDATION_ERROR", "Invalid display_name");
  }

  const deptCheck = readUuid(body, "managing_department_id", true);
  if (!deptCheck.ok) return fail(400, "VALIDATION_ERROR", deptCheck.reason);
  const staffCheck = readUuid(body, "assigned_staff_id", true);
  if (!staffCheck.ok) return fail(400, "VALIDATION_ERROR", staffCheck.reason);

  const matCheck = readString(body, "maturity_date", {
    max: 16,
    optional: true,
    pattern: DATE_PATTERN,
  });
  if (!matCheck.ok) return fail(400, "VALIDATION_ERROR", matCheck.reason);
  const renCheck = readString(body, "renewal_date", {
    max: 16,
    optional: true,
    pattern: DATE_PATTERN,
  });
  if (!renCheck.ok) return fail(400, "VALIDATION_ERROR", renCheck.reason);

  const targetDeptId = deptCheck.value ?? actor.ctx.department.id;
  const targetStaffId = staffCheck.value ?? actor.ctx.staff_id;
  const refCode = refCheck.value;
  const segCode = segCheck.value;

  const denied = authorize(
    actor,
    {
      action: "customer360.write",
      targetDepartmentId: targetDeptId,
      targetStaffId: targetStaffId,
    },
    {
      type: "customer_reference",
      id: "new",
    },
  );
  if (denied) return finalizeFailure(actor, denied);

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const dup = await client.query(
      `SELECT id FROM customer_references WHERE customer_ref_code = $1`,
      [refCode],
    );
    if ((dup.rowCount ?? 0) > 0) {
      return abort(
        409,
        "DUPLICATE_CUSTOMER_REF",
        "customer_ref_code already exists",
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO customer_references (
         id, customer_ref_code, segment_code, display_name,
         managing_department_id, assigned_staff_id, maturity_date, renewal_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        refCode,
        segCode,
        nameCheck.value,
        targetDeptId,
        targetStaffId,
        matCheck.value ?? null,
        renCheck.value ?? null,
      ],
    );

    const rowRes = await client.query(
      `SELECT cr.*, d.code AS managing_department_code, s.staff_code AS assigned_staff_code
       FROM customer_references cr
       JOIN departments d ON d.id = cr.managing_department_id
       JOIN staff s ON s.id = cr.assigned_staff_id
       WHERE cr.id = $1`,
      [id],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "customer360.write",
      resourceType: "customer_reference",
      resourceId: id,
      decision: "ALLOW",
      reasonCode: "CUSTOMER_REFERENCE_CREATED",
      scopeContext: {
        customer_ref_code: refCode,
        segment_code: segCode,
      },
    });

    return mapCustomerRow(rowRes.rows[0]!);
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function updateCustomerReference(
  actor: Actor,
  customerId: string,
  body: unknown,
): Promise<ServiceResult<CustomerReferenceRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "display_name",
    "status",
    "maturity_date",
    "renewal_date",
    "expected_version",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("customer360.write", "customer_reference", tamperKey),
    );
  }
  const expectedVer = readExpectedVersion(body);
  if (!expectedVer.ok) return fail(400, "VALIDATION_ERROR", expectedVer.reason);

  const nameCheck = readString(body, "display_name", {
    min: 2,
    max: 160,
    optional: true,
  });
  if (!nameCheck.ok) return fail(400, "VALIDATION_ERROR", nameCheck.reason);
  const statusCheck = readEnum(body, "status", CUSTOMER_STATUSES, {
    optional: true,
  });
  if (!statusCheck.ok) return fail(400, "VALIDATION_ERROR", statusCheck.reason);
  const matCheck = readString(body, "maturity_date", {
    max: 16,
    optional: true,
    pattern: DATE_PATTERN,
  });
  if (!matCheck.ok) return fail(400, "VALIDATION_ERROR", matCheck.reason);
  const renCheck = readString(body, "renewal_date", {
    max: 16,
    optional: true,
    pattern: DATE_PATTERN,
  });
  if (!renCheck.ok) return fail(400, "VALIDATION_ERROR", renCheck.reason);

  const preDenied = authorize(
    actor,
    { action: "customer360.write" },
    { type: "customer_reference", id: customerId },
  );
  if (preDenied) return finalizeFailure(actor, preDenied);

  return runAuthorityTransaction(actor, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM customer_references WHERE id = $1 FOR UPDATE`,
      [customerId],
    );
    if ((existingRes.rowCount ?? 0) === 0) {
      const nf = notFound(
        "customer_reference",
        customerId,
        "customer360.write",
      );
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const existing = existingRes.rows[0]!;
    const scopeDenied = authorize(
      actor,
      {
        action: "customer360.write",
        targetDepartmentId: String(existing.managing_department_id),
        targetStaffId: String(existing.assigned_staff_id),
      },
      {
        type: "customer_reference",
        id: customerId,
      },
    );
    if (scopeDenied) {
      const nf = notFound(
        "customer_reference",
        customerId,
        "customer360.write",
      );
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }

    if (Number(existing.row_version) !== expectedVer.value) {
      return abort(
        409,
        "VERSION_CONFLICT",
        "customer_reference version conflict",
      );
    }

    await client.query(
      `UPDATE customer_references
       SET display_name = $1, status = $2, maturity_date = $3, renewal_date = $4
       WHERE id = $5`,
      [
        nameCheck.value ?? existing.display_name,
        statusCheck.value ?? existing.status,
        matCheck.value !== undefined ? matCheck.value : existing.maturity_date,
        renCheck.value !== undefined ? renCheck.value : existing.renewal_date,
        customerId,
      ],
    );

    const rowRes = await client.query(
      `SELECT cr.*, d.code AS managing_department_code, s.staff_code AS assigned_staff_code
       FROM customer_references cr
       JOIN departments d ON d.id = cr.managing_department_id
       JOIN staff s ON s.id = cr.assigned_staff_id
       WHERE cr.id = $1`,
      [customerId],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "customer360.write",
      resourceType: "customer_reference",
      resourceId: customerId,
      decision: "ALLOW",
      reasonCode: "CUSTOMER_REFERENCE_UPDATED",
      scopeContext: { expected_version: expectedVer.value },
    });

    return mapCustomerRow(rowRes.rows[0]!);
  });
}

export async function createCustomerMilestone(
  actor: Actor,
  customerId: string,
  body: unknown,
): Promise<ServiceResult<CustomerMilestoneRow>> {
  if (!isPlainObject(body)) {
    return fail(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  }
  const tamperKey = findDisallowedTamperKey(Object.keys(body), [
    "milestone_type",
    "due_date",
    "title",
    "status",
    "note",
  ]);
  if (tamperKey) {
    return finalizeFailure(
      actor,
      tamperRejected("customer360.write", "customer_milestone", tamperKey),
    );
  }

  const typeCheck = readEnum(body, "milestone_type", MILESTONE_TYPES);
  if (!typeCheck.ok || !typeCheck.value) {
    return fail(400, "VALIDATION_ERROR", "Invalid milestone_type");
  }
  const dueCheck = readString(body, "due_date", {
    max: 16,
    pattern: DATE_PATTERN,
  });
  if (!dueCheck.ok || !dueCheck.value) {
    return fail(400, "VALIDATION_ERROR", "due_date must be YYYY-MM-DD");
  }
  const titleCheck = readString(body, "title", { min: 2, max: 200 });
  if (!titleCheck.ok || !titleCheck.value) {
    return fail(400, "VALIDATION_ERROR", "Invalid milestone title");
  }
  const statusCheck = readEnum(body, "status", MILESTONE_STATUSES, {
    optional: true,
  });
  if (!statusCheck.ok) return fail(400, "VALIDATION_ERROR", statusCheck.reason);
  const noteCheck = readString(body, "note", { max: 500, optional: true });
  if (!noteCheck.ok) return fail(400, "VALIDATION_ERROR", noteCheck.reason);

  const preDenied = authorize(
    actor,
    { action: "customer360.write" },
    { type: "customer_milestone", id: customerId },
  );
  if (preDenied) return finalizeFailure(actor, preDenied);

  const txRes = await runAuthorityTransaction(actor, async (client) => {
    const custRes = await client.query(
      `SELECT id, managing_department_id, assigned_staff_id
       FROM customer_references WHERE id = $1`,
      [customerId],
    );
    if ((custRes.rowCount ?? 0) === 0) {
      const nf = notFound(
        "customer_reference",
        customerId,
        "customer360.write",
      );
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }
    const cust = custRes.rows[0]!;
    const scopeDenied = authorize(
      actor,
      {
        action: "customer360.write",
        targetDepartmentId: String(cust.managing_department_id),
        targetStaffId: String(cust.assigned_staff_id),
      },
      {
        type: "customer_milestone",
        id: customerId,
      },
    );
    if (scopeDenied) {
      const nf = notFound(
        "customer_reference",
        customerId,
        "customer360.write",
      );
      return abort(nf.status, nf.code, nf.message, { denyAudit: nf.denyAudit });
    }

    const msType = typeCheck.value!;
    const dueDate = dueCheck.value!;
    const id = randomUUID();
    const ins = await client.query(
      `INSERT INTO customer_milestones (
         id, customer_reference_id, milestone_type, due_date, title, status, note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        customerId,
        msType,
        dueDate,
        titleCheck.value,
        statusCheck.value ?? "OPEN",
        noteCheck.value ?? null,
      ],
    );

    await appendAuditEvent(client, {
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
      action: "customer360.write",
      resourceType: "customer_milestone",
      resourceId: id,
      decision: "ALLOW",
      reasonCode: "CUSTOMER_MILESTONE_CREATED",
      scopeContext: {
        customer_reference_id: customerId,
        milestone_type: msType,
        due_date: dueDate,
      },
    });

    return mapMilestoneRow(ins.rows[0]!);
  });

  if (!txRes.ok) return txRes;
  return { ok: true, status: 201, data: txRes.data };
}

export async function getCustomer360(
  actor: Actor,
  customerId: string,
): Promise<ServiceResult<Customer360Bundle>> {
  const preDenied = authorize(
    actor,
    { action: "customer360.read" },
    { type: "customer_reference", id: customerId },
  );
  if (preDenied) return finalizeFailure(actor, preDenied);

  const pool = getRuntimePool();
  const custRes = await pool.query(
    `SELECT cr.*, d.code AS managing_department_code, s.staff_code AS assigned_staff_code
     FROM customer_references cr
     JOIN departments d ON d.id = cr.managing_department_id
     JOIN staff s ON s.id = cr.assigned_staff_id
     WHERE cr.id = $1`,
    [customerId],
  );
  if ((custRes.rowCount ?? 0) === 0) {
    return finalizeFailure(
      actor,
      notFound("customer_reference", customerId, "customer360.read"),
    );
  }
  const customer = mapCustomerRow(custRes.rows[0]!);

  const scopeDenied = authorize(
    actor,
    {
      action: "customer360.read",
      targetDepartmentId: customer.managing_department_id,
      targetStaffId: customer.assigned_staff_id,
    },
    {
      type: "customer_reference",
      id: customerId,
    },
  );
  if (scopeDenied) {
    return finalizeFailure(
      actor,
      notFound("customer_reference", customerId, "customer360.read"),
    );
  }

  const [msRes, oppRes, actRes, alertRes] = await Promise.all([
    pool.query(
      `SELECT * FROM customer_milestones
       WHERE customer_reference_id = $1
       ORDER BY due_date ASC`,
      [customerId],
    ),
    pool.query(
      `SELECT o.id, o.opportunity_ref, o.display_label, o.kpi_group_code,
              o.stage, o.estimated_value, o.expected_close_date, s.staff_code AS owner_staff_code
       FROM opportunities o
       JOIN staff s ON s.id = o.owner_staff_id
       WHERE o.customer_reference_id = $1 OR o.customer_ref = $2
       ORDER BY o.created_at DESC`,
      [customerId, customer.customer_ref_code],
    ),
    pool.query(
      `SELECT al.id, al.activity_type, al.status, al.occurred_at, al.outcome_summary AS outcome_note, s.staff_code AS actor_staff_code
       FROM activity_logs al
       JOIN staff s ON s.id = al.actor_staff_id
       WHERE al.customer_reference_id = $1 OR al.synthetic_customer_ref = $2
       ORDER BY al.occurred_at DESC
       LIMIT 50`,
      [customerId, customer.customer_ref_code],
    ),
    pool.query(
      `SELECT id, rule_code, severity, title, resolution_status, read_at
       FROM in_app_alerts
       WHERE department_id = $1
         AND (
           title LIKE '%' || $2 || '%'
           OR dedup_key LIKE 'CUSTOMER_RENEWAL_CARE:MILESTONE:%'
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [customer.managing_department_id, customer.customer_ref_code],
    ),
  ]);

  return {
    ok: true,
    status: 200,
    data: {
      customer,
      milestones: msRes.rows.map(mapMilestoneRow),
      opportunities: oppRes.rows.map((r) => ({
        id: String(r.id),
        opportunity_ref: String(r.opportunity_ref),
        display_label: String(r.display_label),
        kpi_group_code: String(r.kpi_group_code),
        stage: String(r.stage),
        estimated_value: Number(r.estimated_value),
        expected_close_date: toDateStr(r.expected_close_date),
        owner_staff_code: String(r.owner_staff_code),
      })),
      activity_logs: actRes.rows.map((r) => ({
        id: String(r.id),
        activity_type: String(r.activity_type),
        status: String(r.status),
        occurred_at: new Date(String(r.occurred_at)).toISOString(),
        outcome_note: r.outcome_note ? String(r.outcome_note) : null,
        actor_staff_code: String(r.actor_staff_code),
      })),
      alerts: alertRes.rows.map((r) => ({
        id: String(r.id),
        rule_code: String(r.rule_code),
        severity: String(r.severity),
        title: String(r.title),
        resolution_status: String(r.resolution_status),
        read_at: r.read_at ? new Date(String(r.read_at)).toISOString() : null,
      })),
    },
  };
}

export async function getDashboardDrilldown(
  actor: Actor,
  url: URL,
): Promise<ServiceResult<DashboardDrilldownResult>> {
  const qv = validateQueryParams(url.searchParams, [
    "level",
    "department_id",
    "staff_id",
    "period_key",
  ]);
  if (!qv.ok) {
    if (qv.kind === "TAMPER") {
      return finalizeFailure(
        actor,
        tamperRejected(
          "dashboard.drilldown.read",
          "dashboard_drilldown",
          qv.field,
        ),
      );
    }
    return fail(400, "VALIDATION_ERROR", qv.reason);
  }

  const levelRaw = url.searchParams.get("level") ?? "BRANCH";
  if (
    !DRILLDOWN_LEVELS.includes(levelRaw as (typeof DRILLDOWN_LEVELS)[number])
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "level must be BRANCH, DEPARTMENT, STAFF, or ITEM",
    );
  }
  const level = levelRaw as DashboardDrilldownResult["level"];
  const reqDeptId = url.searchParams.get("department_id") ?? undefined;
  const reqStaffId = url.searchParams.get("staff_id") ?? undefined;
  const periodKey = url.searchParams.get("period_key") ?? "2026-11";

  const denied = authorize(
    actor,
    {
      action: "dashboard.drilldown.read",
      targetDepartmentId: reqDeptId,
      targetStaffId: reqStaffId,
    },
    {
      type: "dashboard_drilldown",
      id: `${level}:${reqDeptId ?? "all"}:${reqStaffId ?? "all"}`,
    },
  );
  if (denied) return finalizeFailure(actor, denied);

  const role = actor.ctx.effective_role.role_code;
  const scopedDeptId =
    role === "EXECUTIVE" ? (reqDeptId ?? null) : actor.ctx.department.id;
  const scopedStaffId =
    role === "STAFF" ? actor.ctx.staff_id : (reqStaffId ?? null);

  const pool = getRuntimePool();
  const [deptRes, staffRes, custRes, oppRes, actRes] = await Promise.all([
    pool.query(
      `SELECT d.id, d.code, d.name,
              (SELECT COUNT(*)::int FROM staff s WHERE s.department_id = d.id AND s.status = 'ACTIVE') AS staff_count,
              (SELECT COUNT(*)::int FROM customer_references cr WHERE cr.managing_department_id = d.id AND ($2::uuid IS NULL OR cr.assigned_staff_id = $2)) AS customer_count,
              (SELECT COUNT(*)::int FROM opportunities o WHERE o.department_id = d.id AND ($2::uuid IS NULL OR o.owner_staff_id = $2)) AS opportunity_count,
              (SELECT COUNT(*)::int FROM in_app_alerts a WHERE a.department_id = d.id AND a.resolution_status = 'OPEN' AND ($2::uuid IS NULL OR a.owner_staff_id = $2)) AS open_alert_count
       FROM departments d
       WHERE ($1::uuid IS NULL OR d.id = $1)
       ORDER BY d.code ASC`,
      [scopedDeptId, scopedStaffId],
    ),
    pool.query(
      `SELECT s.id, s.staff_code, s.display_name, s.department_id, d.code AS department_code,
              (SELECT COUNT(*)::int FROM customer_references cr WHERE cr.assigned_staff_id = s.id) AS customer_count,
              (SELECT COUNT(*)::int FROM activity_logs al WHERE al.actor_staff_id = s.id) AS activity_count,
              (SELECT COUNT(*)::int FROM opportunities o WHERE o.owner_staff_id = s.id) AS opportunity_count
       FROM staff s
       JOIN departments d ON d.id = s.department_id
       WHERE s.status = 'ACTIVE'
         AND ($1::uuid IS NULL OR s.department_id = $1)
         AND ($2::uuid IS NULL OR s.id = $2)
       ORDER BY s.staff_code ASC`,
      [scopedDeptId, scopedStaffId],
    ),
    pool.query(
      `SELECT id, customer_ref_code, display_name, segment_code, maturity_date, renewal_date
       FROM customer_references
       WHERE ($1::uuid IS NULL OR managing_department_id = $1)
         AND ($2::uuid IS NULL OR assigned_staff_id = $2)
       ORDER BY created_at DESC
       LIMIT 25`,
      [scopedDeptId, scopedStaffId],
    ),
    pool.query(
      `SELECT id, opportunity_ref, display_label, stage, estimated_value, customer_reference_id
       FROM opportunities
       WHERE ($1::uuid IS NULL OR department_id = $1)
         AND ($2::uuid IS NULL OR owner_staff_id = $2)
       ORDER BY created_at DESC
       LIMIT 25`,
      [scopedDeptId, scopedStaffId],
    ),
    pool.query(
      `SELECT a.id, kd.metric_code, a.actual_value,
              CASE WHEN a.actual_value IS NULL THEN 'MISSING_DATA' ELSE 'AVAILABLE' END AS data_state,
              a.reconciliation_status
       FROM kpi_actual_records a
       JOIN kpi_definitions kd ON kd.id = a.kpi_definition_id
       WHERE a.period_key = $1
         AND ($2::uuid IS NULL OR a.department_id = $2)
         AND ($3::uuid IS NULL OR a.primary_staff_id = $3)
       ORDER BY a.created_at DESC
       LIMIT 25`,
      [periodKey, scopedDeptId, scopedStaffId],
    ),
  ]);

  return {
    ok: true,
    status: 200,
    data: {
      level,
      period_key: periodKey,
      departments: deptRes.rows.map((r) => ({
        id: String(r.id),
        code: String(r.code),
        name: String(r.name),
        staff_count: Number(r.staff_count),
        customer_count: Number(r.customer_count),
        opportunity_count: Number(r.opportunity_count),
        open_alert_count: Number(r.open_alert_count),
      })),
      staff_nodes: staffRes.rows.map((r) => ({
        id: String(r.id),
        staff_code: String(r.staff_code),
        display_name: String(r.display_name),
        department_id: String(r.department_id),
        department_code: String(r.department_code),
        customer_count: Number(r.customer_count),
        activity_count: Number(r.activity_count),
        opportunity_count: Number(r.opportunity_count),
      })),
      items: {
        customers: custRes.rows.map((r) => ({
          id: String(r.id),
          customer_ref_code: String(r.customer_ref_code),
          display_name: String(r.display_name),
          segment_code: String(r.segment_code),
          maturity_date: toDateStr(r.maturity_date),
          renewal_date: toDateStr(r.renewal_date),
        })),
        opportunities: oppRes.rows.map((r) => ({
          id: String(r.id),
          opportunity_ref: String(r.opportunity_ref),
          display_label: String(r.display_label),
          stage: String(r.stage),
          estimated_value: Number(r.estimated_value),
          customer_reference_id: r.customer_reference_id
            ? String(r.customer_reference_id)
            : null,
        })),
        kpi_actuals: actRes.rows.map((r) => ({
          id: String(r.id),
          metric_code: String(r.metric_code),
          actual_value: r.actual_value === null ? null : Number(r.actual_value),
          data_state: String(r.data_state),
          reconciliation_status: String(r.reconciliation_status),
        })),
      },
    },
  };
}
