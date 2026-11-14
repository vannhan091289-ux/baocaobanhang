import "server-only";
import type { PoolClient } from "pg";
import type pg from "pg";
import { recordDenyAuditSafely, type AuditEventInput } from "./audit";
import { getRuntimePool, withTransaction } from "./db";
import {
  evaluateActionAuthorization,
  type ActionEvaluationRequest,
  type EffectiveSelfContext,
} from "./policy";
import { verifyRequestSession } from "./session";

export interface Actor {
  rawSessionToken: string;
  csrfToken: string;
  sessionId: string;
  ctx: EffectiveSelfContext;
}

export interface ServiceSuccess<T> {
  ok: true;
  status: 200 | 201;
  data: T;
  page?: { limit: number; offset: number; total: number };
}

export interface ServiceFailure {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500;
  code: string;
  message: string;
  details?: Record<string, string>;
  /** When set, a DENY AuditEvent is appended after the transaction rolled back. */
  denyAudit?: Omit<
    AuditEventInput,
    "decision" | "actorStaffId" | "actorSubjectRef"
  >;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export class ServiceAbort extends Error {
  constructor(public readonly failure: ServiceFailure) {
    super(failure.code);
    this.name = "ServiceAbort";
  }
}

export function fail(
  status: ServiceFailure["status"],
  code: string,
  message: string,
  extra?: Pick<ServiceFailure, "details" | "denyAudit">,
): ServiceFailure {
  return { ok: false, status, code, message, ...extra };
}

export function abort(
  status: ServiceFailure["status"],
  code: string,
  message: string,
  extra?: Pick<ServiceFailure, "details" | "denyAudit">,
): never {
  throw new ServiceAbort(fail(status, code, message, extra));
}

export const NOT_FOUND_MESSAGE =
  "Không tìm thấy tài nguyên yêu cầu trong phạm vi được phép.";

export function notFound(
  resourceType: string,
  resourceId: string,
  action = "org.staff.read",
): ServiceFailure {
  return fail(404, "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE", NOT_FOUND_MESSAGE, {
    denyAudit: {
      action,
      resourceType,
      resourceId,
      scopeContext: { reason: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND" },
      reasonCode: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND",
    },
  });
}

export function tamperRejected(
  action: string,
  resourceType: string,
  resourceId = "request",
): ServiceFailure {
  return fail(
    403,
    "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
    "Không chấp nhận tham số ghi đè vai trò hoặc phạm vi dữ liệu từ phía client.",
    {
      denyAudit: {
        action,
        resourceType,
        resourceId,
        scopeContext: { reason: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED" },
        reasonCode: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
      },
    },
  );
}

/** Records the DENY audit for a failed result (best effort; never converts DENY to ALLOW). */
export async function finalizeFailure(
  actor: Actor,
  failure: ServiceFailure,
  pool: pg.Pool = getRuntimePool(),
): Promise<ServiceFailure> {
  if (failure.denyAudit) {
    await recordDenyAuditSafely(pool, {
      ...failure.denyAudit,
      actorStaffId: actor.ctx.staff_id,
      actorSubjectRef: `staff:${actor.ctx.staff_id}`,
    });
  }
  return failure;
}

/** Evaluates ADR-002 policy; returns a failure with DENY audit hint when not allowed. */
export function authorize(
  actor: Actor,
  req: Omit<ActionEvaluationRequest, "actorContext">,
  resource: { type: string; id: string },
): ServiceFailure | null {
  const authz = evaluateActionAuthorization({
    actorContext: actor.ctx,
    ...req,
  });
  if (authz.decision === "ALLOW") return null;
  return fail(
    authz.httpStatus === 200 ? 403 : authz.httpStatus,
    authz.reasonCode,
    "Không có quyền thực hiện thao tác này.",
    {
      denyAudit: {
        action: req.action,
        resourceType: resource.type,
        resourceId: resource.id,
        scopeContext: { reason: authz.reasonCode },
        reasonCode: authz.reasonCode,
      },
    },
  );
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

const CONSTRAINT_CODES: Record<string, { status: 409 | 422; code: string }> = {
  departments_code_key: { status: 409, code: "DEPARTMENT_CODE_DUPLICATE" },
  staff_staff_code_key: { status: 409, code: "STAFF_CODE_DUPLICATE" },
  uq_identity_links_issuer_subject: {
    status: 409,
    code: "IDENTITY_SUBJECT_DUPLICATE",
  },
  uq_identity_links_active_staff: {
    status: 409,
    code: "IDENTITY_ALREADY_ACTIVE_FOR_STAFF",
  },
  uq_role_proposals_pending_staff: {
    status: 409,
    code: "PROPOSAL_ALREADY_PENDING",
  },
};

export function mapDatabaseError(err: unknown): ServiceFailure | null {
  const e = err as PgErrorLike;
  if (e?.code === "23505") {
    const mapped = e.constraint ? CONSTRAINT_CODES[e.constraint] : undefined;
    return fail(
      mapped?.status ?? 409,
      mapped?.code ?? "UNIQUE_CONSTRAINT_VIOLATION",
      "Dữ liệu bị trùng với bản ghi hiện có.",
    );
  }
  if (e?.code === "23514") {
    return fail(
      422,
      "CHECK_CONSTRAINT_VIOLATION",
      "Dữ liệu không thỏa ràng buộc nghiệp vụ.",
    );
  }
  if (e?.code === "23503") {
    return fail(
      422,
      "REFERENCE_NOT_FOUND",
      "Tham chiếu tới bản ghi không tồn tại.",
    );
  }
  return null;
}

/**
 * Runs a write under the single authority advisory lock (0002), re-verifies the caller's
 * session and effective role INSIDE the transaction (ADR-002 §6.1: authority is re-checked
 * at commit time) and rolls everything back on any ServiceAbort or unexpected error.
 * Audit failures therefore roll back the data change (fail-closed ALLOW audit).
 */
export async function runAuthorityTransaction<T>(
  actor: Actor,
  fn: (client: PoolClient, current: EffectiveSelfContext) => Promise<T>,
  pool: pg.Pool = getRuntimePool(),
): Promise<ServiceSuccess<T> | ServiceFailure> {
  try {
    const data = await withTransaction(async (client) => {
      await client.query("SELECT lock_s1a_authority()");
      const current = await verifyRequestSession({
        rawSessionToken: actor.rawSessionToken,
        db: client,
      });
      if (!current.authenticated) {
        throw new ServiceAbort(
          fail(
            current.httpStatus,
            current.reasonCode,
            "Phiên làm việc không còn hiệu lực.",
          ),
        );
      }
      const before = actor.ctx.effective_role;
      const after = current.selfContext.effective_role;
      if (
        current.selfContext.staff_id !== actor.ctx.staff_id ||
        current.selfContext.department.id !== actor.ctx.department.id ||
        after.role_code !== before.role_code ||
        after.scope_type !== before.scope_type
      ) {
        throw new ServiceAbort(
          fail(
            403,
            "AUTHORITY_CHANGED",
            "Thẩm quyền đã thay đổi; thao tác bị hủy.",
          ),
        );
      }
      return fn(client, current.selfContext);
    }, pool);
    return { ok: true, status: 200, data };
  } catch (err) {
    if (err instanceof ServiceAbort) {
      return finalizeFailure(actor, err.failure, pool);
    }
    const mapped = mapDatabaseError(err);
    if (mapped) return mapped;
    return fail(
      500,
      "INTERNAL_OR_AUDIT_FAILURE",
      "Thao tác không thể hoàn tất; mọi thay đổi đã được hoàn tác.",
    );
  }
}

export const VALIDATION_MESSAGE = "Dữ liệu đầu vào không hợp lệ.";

export function validationFailure(
  field: string,
  reason: string,
): ServiceFailure {
  return fail(422, "VALIDATION_FAILED", VALIDATION_MESSAGE, {
    details: { field, reason },
  });
}

export function created<T>(
  result: Awaited<ReturnType<typeof runAuthorityTransaction<T>>>,
): ServiceResult<T> {
  return result.ok ? { ...result, status: 201 } : result;
}
