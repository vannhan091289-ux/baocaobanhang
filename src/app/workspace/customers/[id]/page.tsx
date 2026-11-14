import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifyRequestSession } from "@/server/session";
import { Customer360Panel } from "./customer360-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Customer360DetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionCheck = await verifyRequestSession({ rawSessionToken });

  if (!sessionCheck.authenticated) {
    const isUnauthenticated = sessionCheck.httpStatus === 401;
    return (
      <main
        className="scaffold-container"
        aria-labelledby="cust360-denied-heading"
      >
        <header className="scaffold-header">
          <p className="scaffold-badge">
            {isUnauthenticated
              ? "Yêu cầu xác thực (401)"
              : "Từ chối truy cập (403)"}
          </p>
          <h1 id="cust360-denied-heading">
            {isUnauthenticated
              ? "Phiên làm việc chưa xác thực hoặc đã hết hạn"
              : "Không có quyền truy cập Customer 360"}
          </h1>
        </header>
        <section
          className="scaffold-status"
          aria-labelledby="cust360-denied-detail"
        >
          <h2 id="cust360-denied-detail">Thông tin kiểm soát truy cập</h2>
          <p>
            Mã trạng thái kiểm tra: <code>{sessionCheck.reasonCode}</code>
          </p>
          <div className="scaffold-actions">
            <a className="scaffold-button" href="/auth/login">
              Đăng nhập lại qua OIDC
            </a>
            <Link className="scaffold-link" href="/workspace">
              Về không gian làm việc
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const { selfContext, csrfToken } = sessionCheck;

  return (
    <main className="scaffold-container" aria-labelledby="cust360-heading">
      <header className="scaffold-header">
        <p className="scaffold-badge">
          {selfContext.effective_role.role_code} • {selfContext.department.code}{" "}
          • {selfContext.staff_code}
        </p>
        <h1 id="cust360-heading">Hồ sơ Customer 360 Giới hạn (Synthetic)</h1>
        <nav className="scaffold-actions" aria-label="Điều hướng phân hệ">
          <Link className="scaffold-link" href="/workspace/customers">
            Danh sách Khách hàng
          </Link>
          <Link className="scaffold-link" href="/workspace/dashboard">
            Dashboard Chi nhánh
          </Link>
          <Link className="scaffold-link" href="/workspace">
            Về không gian làm việc
          </Link>
        </nav>
      </header>
      <Customer360Panel
        customerId={id}
        actorRoleCode={selfContext.effective_role.role_code}
        csrfToken={csrfToken}
      />
    </main>
  );
}
