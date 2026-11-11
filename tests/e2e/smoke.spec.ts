import { expect, test } from "@playwright/test";

test.describe("Sprint 0 HTTP and browser smoke", () => {
  test("GET / returns 200, renders accessible landmarks/headings and emits no console or page errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);

    const main = page.getByRole("main", {
      name: /Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh/i,
    });
    await expect(main).toBeVisible();

    const heading = main.getByRole("heading", {
      level: 1,
      name: "Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh",
    });
    await expect(heading).toBeVisible();

    await expect(
      main.getByRole("heading", {
        level: 2,
        name: "Trạng thái hệ thống hiện tại",
      }),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("non-existent route returns HTTP 404", async ({ page }) => {
    const response = await page.goto("/route-khong-ton-tai-sprint-0");
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(404);
  });
});
