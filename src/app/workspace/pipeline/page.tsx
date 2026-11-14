import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { PipelinePanel } from "./pipeline-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="pipeline-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="pipeline-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập phân hệ Pipeline"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="pipeline-denied-detail-heading"
        >
          <h2 id="pipeline-denied-detail-heading">
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
    <main className="scaffold-container" aria-labelledby="pipeline-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          {selfContext.effective_role.role_code} • {selfContext.department.code}{" "}
          • {selfContext.staff_code}
        </p>
        <h1 id="pipeline-heading">
          Pipeline Prospect / Lead / Opportunity (P0C)
        </h1>
        <p className="scaffold-subtitle">
          Quản lý phễu chuyển đổi 100% synthetic, kiểm soát máy trạng thái và
          lịch sử bàn giao phụ trách.
        </p>
        <nav className="scaffold-actions" aria-label="Điều hướng phân hệ">
          <Link className="scaffold-link" href="/workspace">
            Về không gian làm việc
          </Link>
          <Link className="scaffold-link" href="/workspace/alerts">
            Trung tâm Cảnh báo P0
          </Link>
        </nav>
      </header>

      <PipelinePanel
        actorRoleCode={selfContext.effective_role.role_code}
        actorStaffId={selfContext.staff_id}
        csrfToken={csrfToken}
      />
    </main>
  );
}
