import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/server/config";
import { completeOidcCallback } from "@/server/oidc";
import {
  AUTH_TX_COOKIE_NAME,
  buildClearCookieHeaderValue,
  buildCookieHeaderValue,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_COOKIE_NAME,
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

  const cookieStore = await cookies();
  const rawTxCookieToken = cookieStore.get(AUTH_TX_COOKIE_NAME)?.value;
  const clearTxCookie = buildClearCookieHeaderValue(
    AUTH_TX_COOKIE_NAME,
    cfg.cookieSecure,
  );
  const clearSessionCookie = buildClearCookieHeaderValue(
    SESSION_COOKIE_NAME,
    cfg.cookieSecure,
  );

  const callbackUrl = new URL(request.url);
  const result = await completeOidcCallback({
    callbackUrl,
    rawTxCookieToken,
  });

  if (result.decision === "DENY") {
    const accept = request.headers.get("accept") ?? "";
    const headers = new Headers({
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", clearTxCookie);
    headers.append("Set-Cookie", clearSessionCookie);

    if (accept.includes("text/html")) {
      const deniedUrl = new URL("/workspace", cfg.appOrigin);
      deniedUrl.searchParams.set("auth_error", result.reasonCode);
      return new Response(
        `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>Từ chối đăng nhập — Branch Sales OS</title>
  </head>
  <body>
    <main aria-labelledby="callback-denied-heading">
      <h1 id="callback-denied-heading">Từ chối cấp phiên làm việc</h1>
      <p>Hệ thống không cấp phiên làm việc cho yêu cầu đăng nhập này.</p>
      <p>Mã trạng thái kiểm tra: <code>${result.reasonCode}</code></p>
      <p><a href="/">Quay về trang chủ</a></p>
    </main>
  </body>
</html>`,
        {
          status: result.httpStatus,
          headers: (() => {
            headers.set("Content-Type", "text/html; charset=utf-8");
            return headers;
          })(),
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          code: result.reasonCode,
          message: "Yêu cầu xác thực hoặc phân quyền không hợp lệ.",
        },
      }),
      {
        status: result.httpStatus,
        headers: (() => {
          headers.set("Content-Type", "application/json; charset=utf-8");
          return headers;
        })(),
      },
    );
  }

  const sessionCookie = buildCookieHeaderValue({
    name: SESSION_COOKIE_NAME,
    value: result.session.rawSessionToken,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cfg.cookieSecure,
    maxAge: Math.floor(SESSION_ABSOLUTE_TIMEOUT_MS / 1000),
  });

  const redirectHeaders = new Headers({
    Location: `${cfg.appOrigin}${result.redirectPath}`,
    "Cache-Control": "no-store",
  });
  redirectHeaders.append("Set-Cookie", clearTxCookie);
  redirectHeaders.append("Set-Cookie", sessionCookie);

  return new Response(null, {
    status: 302,
    headers: redirectHeaders,
  });
}
