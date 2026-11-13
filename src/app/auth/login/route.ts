import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/server/config";
import { initiateOidcLoginTransaction } from "@/server/oidc";
import {
  checkAuthStartRateLimit,
  resolveDirectClientIp,
} from "@/server/rate-limit";
import {
  AUTH_TX_COOKIE_NAME,
  AUTH_TX_TTL_MS,
  buildCookieHeaderValue,
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
            "Môi trường cấu hình hiện tại không được phép thực thi xác thực S1-A.",
        },
      },
      { status: 500 },
    );
  }

  const directIp = resolveDirectClientIp(request);
  const rateCheck = checkAuthStartRateLimit(directIp);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_START_RATE_LIMITED",
          message:
            "Quá giới hạn số lần bắt đầu đăng nhập (tối đa 30 yêu cầu/phút/IP). Vui lòng thử lại sau.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const url = new URL(request.url);
  const requestedIssuer =
    url.searchParams.get("issuer") ?? url.searchParams.get("iss");
  const requestedReturnTo =
    url.searchParams.get("returnTo") ??
    url.searchParams.get("redirect_uri") ??
    url.searchParams.get("next");

  try {
    const startResult = await initiateOidcLoginTransaction({
      requestedIssuer,
      requestedReturnTo,
    });

    if (!startResult.ok) {
      return NextResponse.json(
        {
          error: {
            code: startResult.reasonCode,
            message:
              "Yêu cầu đăng nhập bị từ chối do tham số điều hướng hoặc định danh không nằm trong danh sách cho phép.",
          },
        },
        {
          status: startResult.httpStatus,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const txCookieHeader = buildCookieHeaderValue({
      name: AUTH_TX_COOKIE_NAME,
      value: startResult.data.rawTxCookieToken,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: cfg.cookieSecure,
      maxAge: Math.floor(AUTH_TX_TTL_MS / 1000),
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: startResult.data.authorizationUrl,
        "Set-Cookie": txCookieHeader,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_START_FAILED",
          message:
            "Không thể khởi tạo giao dịch đăng nhập OIDC tại thời điểm này.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
