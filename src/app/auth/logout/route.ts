import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/server/config";
import {
  buildClearCookieHeaderValue,
  revokeSessionOnLogout,
  SESSION_COOKIE_NAME,
} from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Đăng xuất bắt buộc sử dụng phương thức POST kèm CSRF token.",
      },
    },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
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

  const originHeader = request.headers.get("origin");
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  let submittedCsrfToken: string | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData();
      const val = formData.get("csrf_token");
      if (typeof val === "string") {
        submittedCsrfToken = val;
      }
    } else if (contentType.includes("application/json")) {
      const body = (await request.json()) as { csrf_token?: unknown };
      if (typeof body?.csrf_token === "string") {
        submittedCsrfToken = body.csrf_token;
      }
    }
  } catch {
    submittedCsrfToken = undefined;
  }

  if (!submittedCsrfToken) {
    const headerCsrf = request.headers.get("x-csrf-token");
    if (headerCsrf) {
      submittedCsrfToken = headerCsrf;
    }
  }

  const result = await revokeSessionOnLogout({
    rawSessionToken,
    submittedCsrfToken,
    originHeader,
  });

  if (!result.revoked) {
    return NextResponse.json(
      {
        error: {
          code: result.code,
          message:
            "Yêu cầu đăng xuất không hợp lệ (sai Origin, thiếu/sai CSRF token hoặc phiên không tồn tại).",
        },
      },
      {
        status: result.httpStatus,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const clearCookie = buildClearCookieHeaderValue(
    SESSION_COOKIE_NAME,
    cfg.cookieSecure,
  );

  // If audit failed after revocation was committed, keep session revoked, clear cookie, and return safe error code
  if (!result.auditRecorded) {
    return NextResponse.json(
      {
        status: "SESSION_REVOKED",
        audit_recorded: false,
        error: {
          code: result.code,
          message:
            "Phiên ứng dụng đã được thu hồi bền vững, nhưng ghi nhận nhật ký kiểm toán gặp sự cố cần kiểm tra.",
        },
      },
      {
        status: 500,
        headers: {
          "Set-Cookie": clearCookie,
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const accept = request.headers.get("accept") ?? "";
  if (
    accept.includes("text/html") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${cfg.appOrigin}/?logged_out=1`,
        "Set-Cookie": clearCookie,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      status: "LOGGED_OUT",
      audit_recorded: true,
      message:
        "Phiên ứng dụng đã đóng. Lưu ý: thao tác này chỉ đóng phiên làm việc trên ứng dụng Branch Sales OS (chưa hủy phiên SSO toàn cục tại IdP); lần đăng nhập tiếp theo vẫn phải qua OIDC và kiểm tra lại liên kết nhân sự/quyền hiện hành.",
    },
    {
      status: 200,
      headers: {
        "Set-Cookie": clearCookie,
        "Cache-Control": "no-store",
      },
    },
  );
}
