import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { CustomersPanel } from "./customers-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="customers-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="customers-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Tài khoản không có quyền truy cập Customer 360"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="customers-denied-detail-heading"
        >
          <h2 id="customers-denied-detail-heading">
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
    <main className="scaffold-container" aria-labelledby="customers-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          {selfContext.effective_role.role_code} • {selfContext.department.code}{" "}
          • {selfContext.staff_code}
        </p>
        <h1 id="customers-heading">Customer 360 Giới hạn Synthetic (P0D)</h1>
        <p className="scaffold-lead">
          Quản lý mã tham chiếu khách hàng synthetic (D-05 / ADR-005, không lưu
          PII thật) và liên kết 1-N tới Cơ hội, Hoạt động & Mốc tái cấp/đáo hạn.
        </p>
        <nav className="scaffold-actions" aria-label="Điều hướng phân hệ">
          <Link className="scaffold-link" href="/workspace">
            Về không gian làm việc
          </Link>
          <Link className="scaffold-link" href="/workspace/dashboard">
            Dashboard Chi nhánh
          </Link>
        </nav>
      </header>
      <CustomersPanel
        actorRoleCode={selfContext.effective_role.role_code}
        csrfToken={csrfToken}
      />
    </main>
  );
}
