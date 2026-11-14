import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { KpiTargetsPanel } from "./kpi-targets-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function KpiTargetsPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="kpi-targets-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="kpi-targets-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập phân hệ Chỉ tiêu KPI"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="kpi-denied-detail-heading"
        >
          <h2 id="kpi-denied-detail-heading">Thông tin kiểm soát truy cập</h2>
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
    <main className="scaffold-container" aria-labelledby="kpi-targets-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          Phân hệ P0A — Từ điển 7 nhóm KPI, Lịch làm việc &amp; Chỉ tiêu
          (Synthetic)
        </p>
        <h1 id="kpi-targets-heading">
          Quản trị Từ điển 7 Nhóm KPI &amp; Giao/Duyệt Chỉ tiêu
          Năm/Tháng/Tuần/Ngày
        </h1>
        <nav
          aria-label="Điều hướng không gian làm việc"
          className="scaffold-actions"
        >
          <Link
            className="scaffold-link"
            href="/workspace"
            data-testid="nav-back-workspace"
          >
            ← Quay về Không gian làm việc &amp; Tổ chức (Sprint 1)
          </Link>
        </nav>
      </header>

      <KpiTargetsPanel
        csrfToken={csrfToken}
        actorStaffId={selfContext.staff_id}
        actorDepartmentId={selfContext.department.id}
        actorRoleCode={selfContext.effective_role.role_code}
        actorScopeType={selfContext.effective_role.scope_type}
      />
    </main>
  );
}
