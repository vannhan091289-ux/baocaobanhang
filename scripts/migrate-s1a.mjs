#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const ALLOWED_DATABASE_NAMES = new Set([
  "branch_sales_devtest",
  "branch_sales_test",
]);
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_APP_ENVS = new Set(["dev", "test"]);

function loadEnvFileIfPresent(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

export function validateMigrationTarget({ appEnv, databaseUrl }) {
  if (!appEnv || !ALLOWED_APP_ENVS.has(appEnv)) {
    throw new Error(
      `[MIGRATION_REFUSED] APP_ENV="${appEnv ?? ""}" is not allowed. Only "dev" or "test" synthetic profiles may run S1-A migrations.`,
    );
  }
  if (!databaseUrl) {
    throw new Error(
      "[MIGRATION_REFUSED] MIGRATOR_DATABASE_URL is required to run or preview migrations.",
    );
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "[MIGRATION_REFUSED] MIGRATOR_DATABASE_URL is not a valid URL.",
    );
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      "[MIGRATION_REFUSED] MIGRATOR_DATABASE_URL must use postgresql:// protocol.",
    );
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `[MIGRATION_REFUSED] Database host "${parsed.hostname}" is outside loopback allowlist (127.0.0.1 / localhost).`,
    );
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!ALLOWED_DATABASE_NAMES.has(dbName)) {
    throw new Error(
      `[MIGRATION_REFUSED] Database name "${dbName}" is not in the synthetic allowlist (branch_sales_devtest, branch_sales_test).`,
    );
  }
  if (parsed.username === "app_runtime_role") {
    throw new Error(
      "[MIGRATION_REFUSED] Runtime role (app_runtime_role) is forbidden from running schema migrations.",
    );
  }
  return { dbName, host: parsed.hostname, port: parsed.port || "5432" };
}

export async function runMigrations({
  mode,
  appEnv = process.env.APP_ENV,
  databaseUrl = process.env.MIGRATOR_DATABASE_URL,
  migrationsDir = path.resolve(process.cwd(), "migrations"),
}) {
  if (mode !== "preview" && mode !== "up") {
    throw new Error(
      `[MIGRATION_REFUSED] Unsupported migration mode "${mode}". Only "preview" and "up" are permitted in S1-A (destructive down/drop is prohibited).`,
    );
  }

  const target = validateMigrationTarget({ appEnv, databaseUrl });

  if (mode === "preview") {
    const sqlPath = path.join(migrationsDir, "0001_s1a_foundation.sql");
    const sqlPreview = readFileSync(sqlPath, "utf8");
    return {
      mode: "preview",
      target,
      sqlPath,
      sqlByteLength: Buffer.byteLength(sqlPreview, "utf8"),
      sqlPreview,
    };
  }

  const applied = await runner({
    databaseUrl,
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    checkOrder: true,
    singleTransaction: true,
    createSchema: false,
    createMigrationsSchema: false,
    dryRun: false,
    verbose: false,
    log: (msg) => {
      // Redact any connection URL if ever emitted
      const safe = String(msg).replace(
        /postgres(?:ql)?:\/\/[^\s]+/gi,
        "[REDACTED_DB_URL]",
      );
      console.log(safe);
    },
  });

  return {
    mode: "up",
    target,
    appliedMigrations: applied.map((m) => m.name),
  };
}

async function main() {
  loadEnvFileIfPresent(path.resolve(process.cwd(), ".env.devtest.local"));
  const mode = process.argv[2] ?? "preview";
  const result = await runMigrations({ mode });
  if (result.mode === "preview") {
    console.log(
      `[db:migrate:preview] Target verified: ${result.target.host}:${result.target.port}/${result.target.dbName} (${result.sqlByteLength} bytes in 0001_s1a_foundation.sql)`,
    );
    console.log("--- SQL PREVIEW START ---");
    console.log(result.sqlPreview);
    console.log("--- SQL PREVIEW END ---");
  } else {
    console.log(
      `[db:migrate:up] Completed on ${result.target.host}:${result.target.port}/${result.target.dbName}. Applied migrations: ${
        result.appliedMigrations.length > 0
          ? result.appliedMigrations.join(", ")
          : "none (already up to date)"
      }`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
