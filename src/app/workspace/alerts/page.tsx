import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { AlertsPanel } from "./alerts-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="alerts-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="alerts-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập Trung tâm Cảnh báo"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="alerts-denied-detail-heading"
        >
          <h2 id="alerts-denied-detail-heading">
            Thông tin kiểm soát truy cập
          </h2>
          <p>
            Mã trạng thái kiểm tra: <code>{sessionCheck.reasonCode}</code>
          </p>
          <div className="scaffold-actions">
            <a className="scaffold-button" href="/auth/login">
              Đăng nhập lại qua OIDC
            </a>
            <Link className="scaffold-link" href="/">
              Quay về trang chủ
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const { selfContext, csrfToken } = sessionCheck;

  return (
    <main className="scaffold-container" aria-labelledby="alerts-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          {selfContext.effective_role.role_code} • {selfContext.department.code}{" "}
          • {selfContext.staff_code}
        </p>
        <h1 id="alerts-heading">
          Trung tâm Cảnh báo P0 &amp; Cấu hình Ngưỡng (P0C)
        </h1>
        <p className="scaffold-subtitle">
          6 nhóm cảnh báo P0 chống trùng (dedup_key), tách biệt Đã đọc (read_at)
          và Đã xử lý kèm bằng chứng (RESOLVED/DISMISSED).
        </p>
        <nav className="scaffold-actions" aria-label="Điều hướng phân hệ">
          <Link className="scaffold-link" href="/workspace">
            Về không gian làm việc
          </Link>
          <Link className="scaffold-link" href="/workspace/pipeline">
            Pipeline Prospect / Lead / Opportunity
          </Link>
        </nav>
      </header>

      <AlertsPanel
        actorRoleCode={selfContext.effective_role.role_code}
        csrfToken={csrfToken}
      />
    </main>
  );
}
