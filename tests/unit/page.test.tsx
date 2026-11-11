import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage (Sprint 0 scaffold)", () => {
  it("renders accessible main landmark and heading with neutral Sprint 0 status", () => {
    render(<HomePage />);

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
    expect(statusSection).toHaveTextContent(
      /chưa triển khai chức năng nghiệp vụ, cơ sở dữ liệu, chỉ tiêu KPI, phân quyền RBAC hay xác thực SSO/i,
    );
  });
});
