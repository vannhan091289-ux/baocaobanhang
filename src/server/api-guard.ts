import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recordDenyAuditSafely } from "./audit";
import { getRuntimeConfig } from "./config";
import { getRuntimePool } from "./db";
import type { Actor, ServiceResult } from "./service-core";
import {
  buildClearCookieHeaderValue,
  SESSION_COOKIE_NAME,
  verifyRequestSession,
} from "./session";
import { findTamperHeader, findTamperKey, isPlainObject } from "./validation";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 16 * 1024;

export interface ApiContext {
  actor: Actor;
  url: URL;
  body: unknown;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Response {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: { ...NO_STORE, ...extraHeaders } },
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function denyAudit(
  actor: Actor,
  action: string,
  resourceType: string,
  reasonCode: string,
): Promise<void> {
  await recordDenyAuditSafely(getRuntimePool(), {
    actorStaffId: actor.ctx.staff_id,
    actorSubjectRef: `staff:${actor.ctx.staff_id}`,
    action,
    resourceType,
    resourceId: "request",
    scopeContext: { reason: reasonCode },
    reasonCode,
  });
}

export async function readRawSessionCookie(
  request: Request,
): Promise<string | undefined> {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
        const val = trimmed.slice(SESSION_COOKIE_NAME.length + 1).trim();
        if (val) return val;
      }
    }
  }
  try {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Shared HTTP guard for S1-B endpoints: session from DB on every request, Origin + CSRF on
 * mutations, strict JSON body, client role/scope tamper rejection, no-store responses.
 * Authorization decisions and audit are enforced inside the service layer.
 */
export async function handleApi(
  request: Request,
  opts: { mutating: boolean; resourceType: string },
  run: (ctx: ApiContext) => Promise<ServiceResult<unknown>>,
): Promise<Response> {
  let cfg;
  try {
    cfg = getRuntimeConfig();
  } catch {
    return errorResponse(
      500,
      "CONFIG_PROFILE_REFUSED",
      "Môi trường cấu hình hiện tại không được phép thực thi.",
    );
  }

  const rawSessionToken = await readRawSessionCookie(request);
  const sessionCheck = await verifyRequestSession({
    rawSessionToken,
  });
  if (!sessionCheck.authenticated) {
    return errorResponse(
      sessionCheck.httpStatus,
      sessionCheck.reasonCode,
      sessionCheck.httpStatus === 401
        ? "Chưa xác thực hoặc phiên làm việc đã hết hạn/thu hồi."
        : "Tài khoản không có quyền truy cập hợp lệ.",
      undefined,
      {
        "Set-Cookie": buildClearCookieHeaderValue(
          SESSION_COOKIE_NAME,
          cfg.cookieSecure,
        ),
      },
    );
  }
  const actor: Actor = {
    rawSessionToken: rawSessionToken!,
    csrfToken: sessionCheck.csrfToken,
    sessionId: sessionCheck.sessionId,
    ctx: sessionCheck.selfContext,
  };
  const action = opts.mutating ? "authz.request.write" : "authz.request.read";

  const url = new URL(request.url);
  if (
    findTamperHeader(request.headers) ||
    findTamperKey(url.searchParams.keys())
  ) {
    await denyAudit(
      actor,
      action,
      opts.resourceType,
      "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
    );
    return errorResponse(
      403,
      "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
      "Không chấp nhận tham số ghi đè vai trò hoặc phạm vi dữ liệu từ phía client.",
    );
  }

  let body: unknown = undefined;
  if (opts.mutating) {
    if (request.headers.get("origin") !== cfg.appOrigin) {
      await denyAudit(actor, action, opts.resourceType, "ORIGIN_MISMATCH");
      return errorResponse(403, "ORIGIN_MISMATCH", "Origin không hợp lệ.");
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return errorResponse(
        422,
        "VALIDATION_FAILED",
        "Nội dung yêu cầu quá lớn.",
      );
    }
    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return errorResponse(
          422,
          "VALIDATION_FAILED",
          "Nội dung JSON không hợp lệ.",
        );
      }
    }
    const headerCsrf = request.headers.get("x-csrf-token");
    const bodyCsrf =
      isPlainObject(parsed) && typeof parsed.csrf_token === "string"
        ? parsed.csrf_token
        : undefined;
    const submitted = headerCsrf ?? bodyCsrf;
    if (!submitted || !safeEqual(submitted, actor.csrfToken)) {
      await denyAudit(actor, action, opts.resourceType, "CSRF_INVALID");
      return errorResponse(
        403,
        "CSRF_INVALID",
        "CSRF token thiếu hoặc không hợp lệ.",
      );
    }
    if (isPlainObject(parsed) && findTamperKey(Object.keys(parsed))) {
      await denyAudit(
        actor,
        action,
        opts.resourceType,
        "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
      );
      return errorResponse(
        403,
        "CLIENT_ROLE_OR_SCOPE_TAMPER_REJECTED",
        "Không chấp nhận tham số ghi đè vai trò hoặc phạm vi dữ liệu từ phía client.",
      );
    }
    body = parsed ?? {};
  }

  const result = await run({ actor, url, body });
  if (!result.ok) {
    return errorResponse(
      result.status,
      result.code,
      result.message,
      result.details,
    );
  }
  return NextResponse.json(
    { data: result.data, ...(result.page ? { page: result.page } : {}) },
    { status: result.status, headers: NO_STORE },
  );
}

export function methodNotAllowed(allow: string): Response {
  return NextResponse.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Phương thức không được hỗ trợ.",
      },
    },
    { status: 405, headers: { Allow: allow, ...NO_STORE } },
  );
}
