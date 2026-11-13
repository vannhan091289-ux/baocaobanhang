import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage (Sprint 1 S1-A synthetic status)", () => {
  it("renders accessible main landmark, heading, S1-A synthetic status, and login link", async () => {
    const jsx = await HomePage({});
    render(jsx);

    const main = screen.getByRole("main", {
      name: /Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh/i,
    });
    expect(main).toBeInTheDocument();

    const heading = within(main).getByRole("heading", {
      level: 1,
      name: "Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh",
    });
    expect(heading).toBeInTheDocument();

    const statusSection = within(main).getByRole("region", {
      name: "Trạng thái hệ thống hiện tại",
    });
    expect(statusSection).toBeInTheDocument();
    expect(statusSection).toHaveTextContent(/Sprint 1 — Slice S1-A/i);
    expect(statusSection).toHaveTextContent(
      /Chưa triển khai chức năng nghiệp vụ KPI, Actual, Target, Dashboard, Lead\/Customer hay API quản trị danh mục/i,
    );

    const loginLink = within(main).getByRole("link", {
      name: /Đăng nhập qua OIDC/i,
    });
    expect(loginLink).toHaveAttribute("href", "/auth/login");
  });

  it("renders app session closed notice when logged_out=1 is present", async () => {
    const jsx = await HomePage({
      searchParams: Promise.resolve({ logged_out: "1" }),
    });
    render(jsx);

    const notice = screen.getByRole("status", {
      name: /Phiên ứng dụng đã đóng/i,
    });
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/chưa hủy phiên SSO toàn cục tại IdP/i);
  });
});
