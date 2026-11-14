import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

function getSyntheticPassword(): string {
  if (process.env.SYNTHETIC_USER_PASSWORD) {
    return process.env.SYNTHETIC_USER_PASSWORD;
  }
  const envFile = path.resolve(process.cwd(), ".env.devtest.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      if (line.startsWith("SYNTHETIC_USER_PASSWORD=")) {
        return line.slice("SYNTHETIC_USER_PASSWORD=".length).trim();
      }
    }
  }
  throw new Error(
    "Missing SYNTHETIC_USER_PASSWORD in environment or .env.devtest.local. Run `npm run env:test:seed` first.",
  );
}

test.describe("Sprint 1 (S1-A) HTTP, OIDC Browser Auth, Self-Context & Logout E2E", () => {
  test("GET / returns 200, renders accessible landmarks/headings, S1-A status and emits no console or page errors", async ({
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

    await expect(
      main.getByRole("link", { name: /Đăng nhập qua OIDC/i }),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("unauthenticated GET /api/me returns 401, GET /auth/logout returns 405, and non-existent route returns 404", async ({
    page,
    request,
  }) => {
    const meRes = await request.get("/api/me");
    expect(meRes.status()).toBe(401);
    const meBody = await meRes.json();
    expect(meBody.error.code).toBe("SESSION_COOKIE_MISSING");

    const getLogoutRes = await request.get("/auth/logout");
    expect(getLogoutRes.status()).toBe(405);

    const notFoundRes = await page.goto("/route-khong-ton-tai-s1a");
    expect(notFoundRes?.status()).toBe(404);
  });

  test("completes real browser login via Keycloak to /workspace, verifies /api/me and tamper/scope rejections, and revokes session on POST /auth/logout", async ({
    page,
  }) => {
    const password = getSyntheticPassword();

    await page.goto("/");
    await page.getByRole("link", { name: /Đăng nhập qua OIDC/i }).click();

    // Wait for redirect to real Keycloak login form on 127.0.0.1:8080
    await page.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);

    await page.locator("#username").fill("syn.mgr.khcn");
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();

    // Redirected back through /auth/callback to /workspace
    await page.waitForURL("http://127.0.0.1:3100/workspace");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Trưởng phòng KHCN Synthetic \(SYN-MGR-KHCN\)/i,
      }),
    ).toBeVisible();

    await expect(page.getByTestId("self-staff-code")).toHaveText(
      "SYN-MGR-KHCN",
    );
    await expect(page.getByTestId("self-department")).toContainText("KHCN");
    await expect(page.getByTestId("self-role-code")).toContainText(
      "DEPARTMENT_MANAGER",
    );
    await expect(page.getByTestId("self-scope-type")).toContainText(
      "DEPARTMENT",
    );

    // Verify /api/me in the authenticated browser context
    const meRes = await page.request.get("/api/me");
    expect(meRes.status()).toBe(200);
    const meJson = await meRes.json();
    expect(meJson.data.staff_code).toBe("SYN-MGR-KHCN");
    expect(meJson.data.effective_role.role_code).toBe("DEPARTMENT_MANAGER");
    expect(meJson.data.effective_role.scope_type).toBe("DEPARTMENT");
    expect(meJson.data.department.code).toBe("KHCN");

    // Verify client role/scope tampering is rejected with 403
    const tamperRes = await page.request.get(
      "/api/me?role=EXECUTIVE&scope=BRANCH",
    );
    expect(tamperRes.status()).toBe(403);

    // Verify cross-staff / out-of-scope lookup returns uniform 404
    const crossScopeRes = await page.request.get(
      "/api/me?staff_id=22222222-2222-4222-8222-222222222299",
    );
    expect(crossScopeRes.status()).toBe(404);

    // Submit POST logout form with CSRF token
    await page
      .getByRole("button", { name: /Đăng xuất khỏi ứng dụng/i })
      .click();

    await page.waitForURL("http://127.0.0.1:3100/?logged_out=1");
    await expect(
      page.getByRole("status", { name: /Phiên ứng dụng đã đóng/i }),
    ).toBeVisible();

    // Verify /api/me is now 401 after logout
    const afterLogoutMe = await page.request.get("/api/me");
    expect(afterLogoutMe.status()).toBe(401);
  });

  test("denies browser login through Keycloak when user has multiple overlapping active roles (no session issued)", async ({
    page,
  }) => {
    const password = getSyntheticPassword();

    await page.goto("/auth/login");
    await page.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);

    await page.locator("#username").fill("syn.multirole");
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Từ chối cấp phiên làm việc/i,
      }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(
      "ROLE_ASSIGNMENT_MULTIPLE_EFFECTIVE",
    );

    const meRes = await page.request.get("/api/me");
    expect(meRes.status()).toBe(401);
  });

  test("S1-B Maker-Checker E2E: CONFIG_ADMIN creates synthetic Staff & Role Proposal in UI, EXECUTIVE approves Proposal in UI (AC-05, AC-09)", async ({
    browser,
  }) => {
    const password = getSyntheticPassword();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    const uniqueCode = `SYN-E2E-${Date.now().toString(36).toUpperCase()}`;

    // Step 1: Login as CONFIG_ADMIN (syn.admin01) in Maker browser context
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    adminPage.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    adminPage.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    try {
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await expect(
        adminPage.getByTestId("s1b-org-management-panel"),
      ).toBeVisible();
      await expect(
        adminPage.getByTestId("s1b-create-staff-form"),
      ).toBeVisible();

      // Create new Staff via UI form
      await adminPage.getByTestId("input-staff-code").fill(uniqueCode);
      await adminPage
        .getByTestId("input-staff-name")
        .fill(`Nhân sự E2E ${uniqueCode} (Synthetic)`);
      await adminPage.getByTestId("submit-create-staff").click();

      await expect(adminPage.getByTestId("s1b-status-banner")).toContainText(
        uniqueCode,
      );
      await expect(
        adminPage.getByTestId(`staff-row-${uniqueCode}`),
      ).toBeVisible();

      // Create Role Assignment Proposal (Maker) for the newly created Staff
      await adminPage
        .getByTestId("input-proposal-reason")
        .fill(`Đề xuất cấp quyền STAFF E2E cho ${uniqueCode}`);
      await adminPage.getByTestId("submit-create-proposal").click();

      await expect(
        adminPage.getByTestId(`proposal-row-${uniqueCode}-PENDING`),
      ).toBeVisible();
    } finally {
      await adminContext.close();
    }

    // Step 2: Login as EXECUTIVE (syn.exec01) in Checker browser context and approve the PENDING proposal
    const execContext = await browser.newContext();
    const execPage = await execContext.newPage();
    execPage.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    execPage.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    try {
      await execPage.goto("/auth/login");
      await execPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await execPage.locator("#username").fill("syn.exec01");
      await execPage.locator("#password").fill(password);
      await execPage.locator("#kc-login").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace");

      await expect(
        execPage.getByTestId(`proposal-row-${uniqueCode}-PENDING`),
      ).toBeVisible();
      await execPage
        .getByTestId(`input-decision-reason-${uniqueCode}`)
        .fill("EXECUTIVE phê duyệt E2E (Synthetic)");
      await execPage.getByTestId(`approve-proposal-${uniqueCode}`).click();

      await expect(
        execPage.getByTestId(`proposal-row-${uniqueCode}-APPROVED`),
      ).toBeVisible();
      await expect(
        execPage.getByTestId(`role-assignment-row-${uniqueCode}-ACTIVE`),
      ).toBeVisible();
    } finally {
      await execContext.close();
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("S1-C AC-07 Multi-Role Journey: Maker-Checker role grant for syn.zerorole -> new login -> DEPARTMENT_MANAGER scope isolation -> immediate session revocation on staff deactivation", async ({
    browser,
  }) => {
    const password = getSyntheticPassword();
    const zeroRoleStaffId = "22222222-2222-4222-8222-222222222209";
    const zeroRoleCode = "SYN-ZEROROLE-001";

    const adminContext = await browser.newContext();
    const execContext = await browser.newContext();
    const zeroContext = await browser.newContext();
    const mgrContext = await browser.newContext();

    try {
      // 1. CONFIG_ADMIN logs in and proposes STAFF role for SYN-ZEROROLE-001
      const adminPage = await adminContext.newPage();
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await adminPage
        .getByTestId("select-proposal-staff")
        .selectOption(zeroRoleStaffId);
      await adminPage.getByTestId("select-proposal-role").selectOption("STAFF");
      await adminPage
        .getByTestId("input-proposal-reason")
        .fill("Cấp quyền STAFF cho syn.zerorole trong kịch bản S1-C E2E");
      await adminPage.getByTestId("submit-create-proposal").click();

      await expect(
        adminPage.getByTestId(`proposal-row-${zeroRoleCode}-PENDING`),
      ).toBeVisible();

      // 2. EXECUTIVE logs in and approves the proposal for SYN-ZEROROLE-001
      const execPage = await execContext.newPage();
      await execPage.goto("/auth/login");
      await execPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await execPage.locator("#username").fill("syn.exec01");
      await execPage.locator("#password").fill(password);
      await execPage.locator("#kc-login").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace");

      await expect(
        execPage.getByTestId(`proposal-row-${zeroRoleCode}-PENDING`),
      ).toBeVisible();
      await execPage.getByTestId(`approve-proposal-${zeroRoleCode}`).click();
      await expect(
        execPage.getByTestId(`proposal-row-${zeroRoleCode}-APPROVED`).first(),
      ).toBeVisible();

      // 3. syn.zerorole logs in via Keycloak OIDC and receives the newly granted STAFF (SELF) role
      const zeroPage = await zeroContext.newPage();
      await zeroPage.goto("/auth/login");
      await zeroPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await zeroPage.locator("#username").fill("syn.zerorole");
      await zeroPage.locator("#password").fill(password);
      await zeroPage.locator("#kc-login").click();
      await zeroPage.waitForURL("http://127.0.0.1:3100/workspace");

      await expect(zeroPage.getByTestId("self-staff-code")).toHaveText(
        zeroRoleCode,
      );
      await expect(zeroPage.getByTestId("self-role-code")).toContainText(
        "STAFF",
      );
      await expect(zeroPage.getByTestId("self-scope-type")).toContainText(
        "SELF",
      );
      // SELF scope sees only own staff row and restricted governance notice
      await expect(
        zeroPage.getByTestId(`staff-row-${zeroRoleCode}`),
      ).toBeVisible();
      await expect(
        zeroPage.getByTestId("staff-row-SYN-STAFF-KHDN-01"),
      ).toHaveCount(0);
      await expect(
        zeroPage.getByTestId("s1b-restricted-governance-notice"),
      ).toBeVisible();

      // 4. DEPARTMENT_MANAGER (KHCN) logs in and sees only KHCN staff (never KHDN staff)
      const mgrPage = await mgrContext.newPage();
      await mgrPage.goto("/auth/login");
      await mgrPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await mgrPage.locator("#username").fill("syn.mgr.khcn");
      await mgrPage.locator("#password").fill(password);
      await mgrPage.locator("#kc-login").click();
      await mgrPage.waitForURL("http://127.0.0.1:3100/workspace");

      await expect(
        mgrPage.getByTestId("staff-row-SYN-STAFF-KHCN-01"),
      ).toBeVisible();
      await expect(
        mgrPage.getByTestId(`staff-row-${zeroRoleCode}`),
      ).toBeVisible();
      await expect(
        mgrPage.getByTestId("staff-row-SYN-STAFF-KHDN-01"),
      ).toHaveCount(0);

      // 5. CONFIG_ADMIN deactivates SYN-ZEROROLE-001 in UI -> immediately revokes syn.zerorole's active session
      await adminPage.reload();
      await expect(
        adminPage.getByTestId(`deactivate-staff-${zeroRoleCode}`),
      ).toBeVisible();
      await adminPage.getByTestId(`deactivate-staff-${zeroRoleCode}`).click();
      await expect(
        adminPage.getByTestId(`staff-status-${zeroRoleCode}`),
      ).toHaveText("INACTIVE");

      // syn.zerorole's existing session is immediately invalidated on next request
      const zeroMeAfterDeactivate = await zeroPage.request.get("/api/me");
      expect(zeroMeAfterDeactivate.status()).toBe(401);

      // Restore SYN-ZEROROLE-001 back to ACTIVE (with 0 active roles, matching initial seed state)
      const staffGet = await adminPage.request.get(
        `/api/org/staff/${zeroRoleStaffId}`,
      );
      const staffData = (await staffGet.json()) as {
        data: { row_version: number };
      };
      const csrfInput = await adminPage
        .locator('input[name="csrf_token"]')
        .inputValue();
      const restoreRes = await adminPage.request.patch(
        `/api/org/staff/${zeroRoleStaffId}`,
        {
          headers: {
            origin: "http://127.0.0.1:3100",
            "x-csrf-token": csrfInput,
          },
          data: {
            expected_version: staffData.data.row_version,
            status: "ACTIVE",
          },
        },
      );
      expect(restoreRes.status()).toBe(200);
    } finally {
      await adminContext.close();
      await execContext.close();
      await zeroContext.close();
      await mgrContext.close();
    }
  });

  test("P0A AC-06: /workspace/kpi-targets 7-group KPI dictionary, working calendar, CONFIG_ADMIN target denial, and EXECUTIVE target allocation", async ({
    browser,
  }) => {
    const password = getSyntheticPassword();
    const adminContext = await browser.newContext();
    const execContext = await browser.newContext();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    try {
      const adminPage = await adminContext.newPage();
      const execPage = await execContext.newPage();
      for (const p of [adminPage, execPage]) {
        p.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        p.on("pageerror", (err) => {
          pageErrors.push(err.message);
        });
      }

      // 1. CONFIG_ADMIN logs in and navigates to /workspace/kpi-targets
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await adminPage.getByTestId("nav-kpi-targets").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace/kpi-targets");

      await expect(
        adminPage.getByRole("heading", {
          level: 1,
          name: /Quản trị Từ điển 7 Nhóm KPI/i,
        }),
      ).toBeVisible();
      await expect(
        adminPage.getByTestId("kpi-definitions-table"),
      ).toBeVisible();
      await expect(
        adminPage.getByTestId("kpi-def-row-LOAN_BALANCE_END"),
      ).toBeVisible();
      await expect(
        adminPage.getByTestId("kpi-def-row-INSURANCE_FY_PREMIUM"),
      ).toBeVisible();
      await expect(
        adminPage.getByTestId("calendar-summary-line"),
      ).toContainText("Asia/Ho_Chi_Minh");
      await expect(
        adminPage.getByTestId("kpi-targets-denied-box"),
      ).toContainText("CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN");

      // 2. EXECUTIVE logs in, visits /workspace/kpi-targets, and allocates a MONTH KPI target
      await execPage.goto("/auth/login");
      await execPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await execPage.locator("#username").fill("syn.exec01");
      await execPage.locator("#password").fill(password);
      await execPage.locator("#kc-login").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace");

      await execPage.getByTestId("nav-kpi-targets").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace/kpi-targets");

      await expect(
        execPage.getByTestId("create-kpi-target-form"),
      ).toBeVisible();
      await execPage.getByTestId("input-target-value").fill("1250000000.00");
      await execPage
        .getByTestId("input-target-approval-ref")
        .fill("E2E-P0A-APPROVAL-001");
      await execPage.getByTestId("submit-create-kpi-target").click();

      await expect(execPage.getByTestId("kpi-targets-banner")).toContainText(
        "Đã lưu phân bổ chỉ tiêu KPI thành công",
      );
      await expect(execPage.getByTestId("kpi-targets-table")).toContainText(
        "1250000000.00",
      );

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await adminContext.close();
      await execContext.close();
    }
  });

  test("P0B-1 AC-05: /workspace/planning Single-Source Activity Log -> Sales Plan & Monday Review Rollup, and CONFIG_ADMIN denial", async ({
    browser,
  }) => {
    const password = getSyntheticPassword();
    const adminContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    try {
      const adminPage = await adminContext.newPage();
      const staffPage = await staffContext.newPage();
      for (const p of [adminPage, staffPage]) {
        p.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        p.on("pageerror", (err) => {
          pageErrors.push(err.message);
        });
      }

      // 1. CONFIG_ADMIN sees denial notice without 403 console error
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await adminPage.getByTestId("nav-planning").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace/planning");
      await expect(adminPage.getByTestId("planning-denied-box")).toContainText(
        "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      );

      // 2. STAFF logs in, creates a weekly plan, logs a Single-Source Activity, and sees it reflected in Plan & Monday Review rollup
      await staffPage.goto("/auth/login");
      await staffPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await staffPage.locator("#username").fill("syn.staff.khcn");
      await staffPage.locator("#password").fill(password);
      await staffPage.locator("#kc-login").click();
      await staffPage.waitForURL("http://127.0.0.1:3100/workspace");

      await staffPage.getByTestId("nav-planning").click();
      await staffPage.waitForURL("http://127.0.0.1:3100/workspace/planning");

      await staffPage
        .getByTestId("input-plan-title")
        .fill("Kế hoạch E2E Tuần 46 (Synthetic)");
      await staffPage.getByTestId("submit-create-plan").click();
      await expect(staffPage.getByTestId("planning-banner")).toContainText(
        "Đã lưu kế hoạch bán hàng thành công",
      );

      await staffPage
        .getByTestId("input-activity-outcome")
        .fill("Hoạt động E2E một nguồn (Synthetic)");
      await staffPage.getByTestId("submit-create-activity").click();
      await expect(staffPage.getByTestId("planning-banner")).toContainText(
        "Đã ghi nhận hoạt động một nguồn",
      );
      await expect(
        staffPage.getByTestId("rollup-total-SYN-STAFF-KHCN-01"),
      ).not.toHaveText("0");

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await adminContext.close();
      await staffContext.close();
    }
  });

  test("P0B-2 AC-06: EXECUTIVE views 7-group dashboard & records actual while CONFIG_ADMIN is denied without console errors", async ({
    browser,
  }) => {
    const password = getSyntheticPassword();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    const adminContext = await browser.newContext();
    const execContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const execPage = await execContext.newPage();

    for (const p of [adminPage, execPage]) {
      p.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      p.on("pageerror", (err) => pageErrors.push(String(err)));
    }

    try {
      // 1. CONFIG_ADMIN sees explicit 403 denial box on /workspace/dashboard with zero console errors
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await adminPage.getByTestId("nav-dashboard").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace/dashboard");
      await expect(adminPage.getByTestId("dashboard-denied-box")).toContainText(
        "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN",
      );

      // 2. EXECUTIVE opens /workspace/dashboard and sees 7 separate KPI groups
      await execPage.goto("/auth/login");
      await execPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await execPage.locator("#username").fill("syn.exec01");
      await execPage.locator("#password").fill(password);
      await execPage.locator("#kc-login").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace");

      await execPage.getByTestId("nav-dashboard").click();
      await execPage.waitForURL("http://127.0.0.1:3100/workspace/dashboard");
      const groupsEl = execPage.getByTestId("dashboard-groups");
      await expect(groupsEl).toContainText("LOAN");
      await expect(groupsEl).toContainText("INSURANCE");

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await adminContext.close();
      await execContext.close();
    }
  });

  test("P0C AC-06: pipeline & alerts UI enforces RBAC and creates prospect + evaluates alerts cleanly", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const staffPage = await staffContext.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    for (const p of [adminPage, staffPage]) {
      p.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      p.on("pageerror", (err) => pageErrors.push(err.message));
    }

    try {
      const password = getSyntheticPassword();
      await adminPage.goto("/auth/login");
      await adminPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await adminPage.locator("#username").fill("syn.admin01");
      await adminPage.locator("#password").fill(password);
      await adminPage.locator("#kc-login").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace");

      await adminPage.getByTestId("nav-pipeline").click();
      await adminPage.waitForURL("http://127.0.0.1:3100/workspace/pipeline");
      await expect(adminPage.getByTestId("pipeline-denied-box")).toBeVisible();

      await adminPage.goto("http://127.0.0.1:3100/workspace/alerts");
      await expect(adminPage.getByTestId("alerts-denied-box")).toBeVisible();

      await staffPage.goto("/auth/login");
      await staffPage.waitForURL(/127\.0\.0\.1:8080\/realms\/branch-sales-dev/);
      await staffPage.locator("#username").fill("syn.staff.khcn");
      await staffPage.locator("#password").fill(password);
      await staffPage.locator("#kc-login").click();
      await staffPage.waitForURL("http://127.0.0.1:3100/workspace");

      await staffPage.getByTestId("nav-pipeline").click();
      await staffPage.waitForURL("http://127.0.0.1:3100/workspace/pipeline");

      const uniqueRef = `SYN-E2E-P0C-${Date.now()}`;
      await staffPage.getByTestId("input-prospect-ref").fill(uniqueRef);
      await staffPage
        .getByTestId("input-prospect-label")
        .fill("Synth E2E Prospect");
      await staffPage.getByTestId("submit-create-prospect").click();
      await expect(staffPage.getByTestId("pipeline-status")).toContainText(
        "Đã tạo Prospect synthetic thành công.",
      );

      await staffPage.goto("http://127.0.0.1:3100/workspace/alerts");
      await staffPage.getByTestId("btn-evaluate-alerts").click();
      await expect(staffPage.getByTestId("alerts-status")).toContainText(
        "Đã quét 6 quy tắc P0",
      );

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await adminContext.close();
      await staffContext.close();
    }
  });
});
