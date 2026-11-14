// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../scripts/migrate-s1a.mjs";
import { GET } from "@/app/api/me/route";
import {
  checkAuthStartRateLimit,
  resetAuthStartRateLimitBuckets,
  resolveDirectClientIp,
} from "@/server/rate-limit";

const { auditRows } = vi.hoisted(() => ({ auditRows: [] as unknown[][] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-session" }) }),
}));
vi.mock("@/server/config", () => ({
  getRuntimeConfig: () => ({ cookieSecure: false }),
}));
vi.mock("@/server/db", () => ({
  getRuntimePool: () => ({
    query: async (_sql: string, values: unknown[]) => {
      auditRows.push(values);
      return { rows: [], rowCount: 1 };
    },
  }),
}));
vi.mock("@/server/session", () => ({
  SESSION_COOKIE_NAME: "bsos_s1a_session",
  buildClearCookieHeaderValue: () => "",
  verifyRequestSession: async () => ({
    authenticated: true,
    selfContext: {
      staff_id: "22222222-2222-4222-8222-222222222205",
      department: { id: "11111111-1111-4111-8111-111111111101" },
      effective_role: { role_code: "STAFF", scope_type: "SELF" },
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthStartRateLimitBuckets();
  auditRows.length = 0;
});

describe("review security regressions", () => {
  it("previews every versioned SQL file that an up migration could apply", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "s1a-preview-"));
    try {
      writeFileSync(path.join(temp, "0001_s1a_foundation.sql"), "SELECT 1;\n");
      writeFileSync(path.join(temp, "0002_authority_guard.sql"), "SELECT 2;\n");
      const result = await runMigrations({
        mode: "preview",
        appEnv: "test",
        databaseUrl:
          "postgresql://migrator_role@127.0.0.1:55432/branch_sales_devtest",
        migrationsDir: temp,
      });
      expect(result.mode).toBe("preview");
      if (result.mode !== "preview") throw new Error("Expected SQL preview");
      expect(result.sqlPreview).toContain("SELECT 1;");
      expect(result.sqlPreview).toContain("SELECT 2;");
      expect(result.sqlPreview.indexOf("SELECT 1;")).toBeLessThan(
        result.sqlPreview.indexOf("SELECT 2;"),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("refuses a seed target outside the synthetic allowlist before external I/O", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "s1a-seed-refusal-"));
    const hook = path.join(temp, "fetch-hook.mjs");
    writeFileSync(
      hook,
      "globalThis.fetch = async () => { throw new Error('REVIEW_EXTERNAL_IO_BEFORE_GUARD'); };\n",
    );
    try {
      const result = spawnSync(
        process.execPath,
        ["--import", hook, path.resolve("scripts/seed-s1a.mjs")],
        {
          cwd: temp,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            APP_ENV: "test",
            MIGRATOR_DATABASE_URL:
              "postgresql://migrator_role@outside.example.invalid/customer_db",
            OIDC_CLIENT_SECRET: "synthetic-placeholder-only",
            KEYCLOAK_ADMIN_USER: "synthetic",
            KEYCLOAK_ADMIN_PASSWORD: "synthetic-placeholder-only",
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("MIGRATION_REFUSED");
      expect(result.stderr).not.toContain("REVIEW_EXTERNAL_IO_BEFORE_GUARD");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("keeps forged peer headers in the same loopback throttle bucket", () => {
    vi.stubEnv("APP_ENV", "test");
    resetAuthStartRateLimitBuckets();
    for (let i = 0; i < 30; i++) {
      const request = new Request("http://127.0.0.1:3100/auth/login", {
        headers: {
          "x-devtest-direct-peer": `192.0.2.${i}`,
          "x-forwarded-for": `192.0.2.${i}`,
        },
      });
      expect(
        checkAuthStartRateLimit(resolveDirectClientIp(request), 1000).allowed,
      ).toBe(true);
    }
    const request = new Request("http://127.0.0.1:3100/auth/login", {
      headers: { "x-devtest-direct-peer": "198.51.100.254" },
    });
    expect(
      checkAuthStartRateLimit(resolveDirectClientIp(request), 1000).allowed,
    ).toBe(false);
  });

  it.each(["staff_id", "department_id"])(
    "does not persist malformed %s query values in audit",
    async (key) => {
      const untrusted = "synthetic-person@example.invalid";
      const response = await GET(
        new Request(
          `http://127.0.0.1:3100/api/me?${key}=${encodeURIComponent(untrusted)}`,
        ),
      );
      expect(response.status).toBe(404);
      expect(auditRows.length).toBeGreaterThan(0);
      expect(JSON.stringify(auditRows)).not.toContain(untrusted);
    },
  );

  it("refuses existing containers before destructive startup actions", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "s1a-review-"));
    const docker = path.join(temp, "docker");
    const log = path.join(temp, "commands.log");
    writeFileSync(
      docker,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$REVIEW_DOCKER_LOG"
case "$*" in
  *'context ls'*) echo colima-baocaobanhang ;;
  *'context inspect default'*) echo 'unix:///var/run/docker.sock' ;;
  *'context inspect'*) echo "unix://$HOME/.colima/baocaobanhang/docker.sock" ;;
  *'info --format'*) echo 'linux/aarch64|29.5.2' ;;
  *'ps -a'*'baocaobanhang-s1a-postgres'*) echo baocaobanhang-s1a-postgres ;;
  *'ps -a'*'baocaobanhang-s1a-keycloak'*) echo baocaobanhang-s1a-keycloak ;;
esac
`,
    );
    chmodSync(docker, 0o700);
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [path.resolve("scripts/devtest-env.mjs"), "start"],
          {
            cwd: temp,
            env: {
              ...process.env,
              PATH: `${temp}:${process.env.PATH}`,
              GITHUB_ACTIONS: "true",
              REVIEW_DOCKER_LOG: log,
            },
            stdio: "pipe",
            timeout: 10_000,
          },
        ),
      ).toThrow();
      const calls = readFileSync(log, "utf8");
      expect(calls).not.toMatch(/\brm\b/);
      expect(calls).not.toMatch(/\bpull\b/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
