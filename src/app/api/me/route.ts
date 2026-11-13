import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recordDenyAuditSafely } from "@/server/audit";
import { getRuntimeConfig } from "@/server/config";
import { getRuntimePool } from "@/server/db";
import { evaluateActionAuthorization } from "@/server/policy";
import {
  buildClearCookieHeaderValue,
  SESSION_COOKIE_NAME,
  verifyRequestSession,
} from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let cfg;
  try {
    cfg = getRuntimeConfig();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "CONFIG_PROFILE_REFUSED",
          message:
            "Môi trường cấu hình hiện tại không được phép thực thi S1-A.",
        },
      },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const clearCookie = buildClearCookieHeaderValue(
      SESSION_COOKIE_NAME,
      cfg.cookieSecure,
    );
    return NextResponse.json(
      {
        error: {
          code: sessionCheck.reasonCode,
          message:
            sessionCheck.httpStatus === 401
              ? "Chưa xác thực hoặc phiên làm việc đã hết hạn/thu hồi."
              : "Tài khoản không có quyền truy cập hợp lệ.",
        },
      },
      {
        status: sessionCheck.httpStatus,
        headers: {
          "Set-Cookie": clearCookie,
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const url = new URL(request.url);
  // Check if the caller attempted to query another staff_id or department_id or tamper with role/scope
  const rawStaffId = url.searchParams.get("staff_id");
  const rawDepartmentId = url.searchParams.get("department_id");
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const malformedReference = [rawStaffId, rawDepartmentId].some(
    (value) => value !== null && !uuidPattern.test(value),
  );
  const requestedStaffId = rawStaffId?.toLowerCase();
  const requestedDepartmentId = rawDepartmentId?.toLowerCase();
  const tamperedRole = url.searchParams.get("role");
  const tamperedScope = url.searchParams.get("scope");

  if (tamperedRole !== null || tamperedScope !== null) {
    await recordDenyAuditSafely(getRuntimePool(), {
      actorStaffId: sessionCheck.selfContext.staff_id,
      actorSubjectRef: `staff:${sessionCheck.selfContext.staff_id}`,
      action: "org.staff.read",
      resourceType: "self_context",
      resourceId: sessionCheck.selfContext.staff_id,
      scopeContext: { reason: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED" },
      reasonCode: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
    });
    return NextResponse.json(
      {
        error: {
          code: "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
          message:
            "Không chấp nhận tham số ghi đè vai trò hoặc phạmạng dữ liệu từ phía client.",
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  // In S1-A, /api/me only returns the caller's own self-context.
  // If a caller attempts to look up another staff_id or out-of-scope department_id, return uniform 404 envelope per ADR-002 §4 & §5.
  if (
    malformedReference ||
    (requestedStaffId &&
      requestedStaffId !== sessionCheck.selfContext.staff_id) ||
    (requestedDepartmentId &&
      requestedDepartmentId !== sessionCheck.selfContext.department.id &&
      sessionCheck.selfContext.effective_role.scope_type !== "BRANCH")
  ) {
    await recordDenyAuditSafely(getRuntimePool(), {
      actorStaffId: sessionCheck.selfContext.staff_id,
      actorSubjectRef: `staff:${sessionCheck.selfContext.staff_id}`,
      action: "org.staff.read",
      resourceType: "staff",
      resourceId: malformedReference
        ? "invalid-reference"
        : (requestedStaffId ?? requestedDepartmentId ?? "unknown"),
      scopeContext: { reason: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND" },
      reasonCode: "RESOURCE_OUT_OF_SCOPE_OR_NOT_FOUND",
    });
    return NextResponse.json(
      {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Không tìm thấy tài nguyên yêu cầu trong phạm vi được phép.",
        },
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const authz = evaluateActionAuthorization({
    actorContext: sessionCheck.selfContext,
    action: "org.staff.read",
    targetStaffId: sessionCheck.selfContext.staff_id,
    targetDepartmentId: sessionCheck.selfContext.department.id,
  });

  if (authz.decision === "DENY") {
    return NextResponse.json(
      {
        error: {
          code: authz.reasonCode,
          message: "Không có quyền thực hiện thao tác này.",
        },
      },
      { status: authz.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Strictly return the ADR-002 §3.1 allowlisted self-context fields
  return NextResponse.json(
    {
      data: sessionCheck.selfContext,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
