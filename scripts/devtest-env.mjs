#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Locked image manifest references from docs/decisions/SPRINT-1-IMAGES.md
 * Never use mutable tags or fallback images.
 */
export const LOCKED_IMAGES = {
  "linux/amd64": {
    postgres:
      "docker.io/library/postgres@sha256:c7fedce47eff6a78cb35dad6b627f0d684107f75ab15c0870e40c093766ba452",
    keycloak:
      "quay.io/keycloak/keycloak@sha256:4da21f9a53bcbac1026a0d654b740a81e98e5de4c45457076acc74b4d94b1551",
  },
  "linux/arm64": {
    postgres:
      "docker.io/library/postgres@sha256:ede0133b5b300f7609629c2bd8ac2cf8cbaf830527200ea2cbecf80f4481f2d3",
    keycloak:
      "quay.io/keycloak/keycloak@sha256:923a431c08971d49727a857e64870d8d63b5bf294a730e5dde729b5138c26c9e",
  },
};

const PG_CONTAINER_NAME = "baocaobanhang-s1a-postgres";
const KC_CONTAINER_NAME = "baocaobanhang-s1a-keycloak";
const PG_HOST_PORT = 55432;
const KC_HOST_PORT = 8080;
const ENV_FILE_PATH = path.resolve(process.cwd(), ".env.devtest.local");

function resolveDockerContext() {
  if (process.env.DOCKER_CONTEXT) {
    return process.env.DOCKER_CONTEXT;
  }
  try {
    const out = execFileSync(
      "docker",
      ["context", "ls", "--format", "{{.Name}}"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const contexts = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (contexts.includes("colima-baocaobanhang")) {
      return "colima-baocaobanhang";
    }
  } catch {
    // Fallback to default context when colima-baocaobanhang does not exist (e.g., Linux CI)
  }
  return undefined;
}

function runDocker(args, options = {}) {
  const ctx = resolveDockerContext();
  const fullArgs = ctx ? ["--context", ctx, ...args] : args;
  const out = execFileSync("docker", fullArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof out === "string" ? out.trim() : "";
}

function detectPlatform() {
  const info = runDocker([
    "info",
    "--format",
    "{{.OSType}}/{{.Architecture}}|{{.ServerVersion}}",
  ]);
  const [osArch, serverVersion] = info.split("|");
  if (osArch === "linux/aarch64" || osArch === "linux/arm64") {
    return { platformKey: "linux/arm64", osArch, serverVersion };
  }
  if (osArch === "linux/x86_64" || osArch === "linux/amd64") {
    return { platformKey: "linux/amd64", osArch, serverVersion };
  }
  throw new Error(
    `[ENV_REFUSED] Unsupported container daemon platform "${osArch}". Only linux/amd64 and linux/arm64 are locked in docs/decisions/SPRINT-1-IMAGES.md.`,
  );
}

function isContainerRunning(name) {
  try {
    const out = runDocker([
      "ps",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return out.trim() === name;
  } catch {
    return false;
  }
}

function containerExists(name) {
  try {
    const out = runDocker([
      "ps",
      "-a",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return out.trim() === name;
  } catch {
    return false;
  }
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function verifyImageDigest(imageRef) {
  const expectedDigest = imageRef.split("@")[1];
  const repoDigestsRaw = runDocker([
    "image",
    "inspect",
    imageRef,
    "--format",
    "{{json .RepoDigests}}|{{.Os}}/{{.Architecture}}",
  ]);
  const [repoDigestsJson, imagePlatform] = repoDigestsRaw.split("|");
  const repoDigests = JSON.parse(repoDigestsJson);
  const matched = repoDigests.some((d) => d.endsWith(`@${expectedDigest}`));
  if (!matched) {
    throw new Error(
      `[ENV_REFUSED] Pulled image ${imageRef} RepoDigests (${repoDigests.join(", ")}) did not match locked digest ${expectedDigest}.`,
    );
  }
  return { imageRef, repoDigests, imagePlatform };
}

function generateSecret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

async function waitForPostgres(connectionString, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      try {
        await client.end();
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(
    "Timed out waiting for PostgreSQL 18.7 readiness on 127.0.0.1:55432.",
  );
}

async function waitForKeycloak(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const wellKnownUrl =
    "http://127.0.0.1:8080/realms/master/.well-known/openid-configuration";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(wellKnownUrl);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    "Timed out waiting for Keycloak 26.8.2 readiness on 127.0.0.1:8080.",
  );
}

async function provisionDatabaseRoles({
  superuserPass,
  migratorPass,
  runtimePass,
}) {
  const adminUrl = `postgresql://postgres:${encodeURIComponent(superuserPass)}@127.0.0.1:${PG_HOST_PORT}/postgres`;
  await waitForPostgres(adminUrl);

  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    const dbCheck = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = 'branch_sales_devtest'",
    );
    if (dbCheck.rowCount === 0) {
      await adminClient.query("CREATE DATABASE branch_sales_devtest");
    }

    // Create or update migrator_role (owns schema objects, runs migrations & seed)
    const migRoleCheck = await adminClient.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'migrator_role'",
    );
    const escapedMigPass = migratorPass.replace(/'/g, "''");
    if (migRoleCheck.rowCount === 0) {
      await adminClient.query(
        `CREATE ROLE migrator_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${escapedMigPass}'`,
      );
    } else {
      await adminClient.query(
        `ALTER ROLE migrator_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${escapedMigPass}'`,
      );
    }

    // Create or update app_runtime_role (strict least-privilege runtime role)
    const runRoleCheck = await adminClient.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime_role'",
    );
    const escapedRunPass = runtimePass.replace(/'/g, "''");
    if (runRoleCheck.rowCount === 0) {
      await adminClient.query(
        `CREATE ROLE app_runtime_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${escapedRunPass}'`,
      );
    } else {
      await adminClient.query(
        `ALTER ROLE app_runtime_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${escapedRunPass}'`,
      );
    }

    await adminClient.query(
      "GRANT CONNECT ON DATABASE branch_sales_devtest TO migrator_role, app_runtime_role",
    );
  } finally {
    await adminClient.end();
  }

  const appDbAdminUrl = `postgresql://postgres:${encodeURIComponent(superuserPass)}@127.0.0.1:${PG_HOST_PORT}/branch_sales_devtest`;
  const dbClient = new pg.Client({ connectionString: appDbAdminUrl });
  await dbClient.connect();
  try {
    await dbClient.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await dbClient.query(
      "GRANT USAGE, CREATE ON SCHEMA public TO migrator_role",
    );
    await dbClient.query("GRANT USAGE ON SCHEMA public TO app_runtime_role");
  } finally {
    await dbClient.end();
  }
}

function loadEnvMap(filePath) {
  const map = {};
  if (!existsSync(filePath)) {
    return map;
  }
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return map;
}

async function startEnvironment() {
  const ctx = resolveDockerContext();
  const { platformKey, osArch, serverVersion } = detectPlatform();
  const images = LOCKED_IMAGES[platformKey];

  console.log(
    `[env:test:start] Context=${ctx ?? "default"} | Daemon=${osArch} (Server ${serverVersion}) | PlatformKey=${platformKey}`,
  );

  // If our own project containers are already running and healthy, reuse or recreate cleanly
  if (containerExists(PG_CONTAINER_NAME)) {
    runDocker(["rm", "-f", PG_CONTAINER_NAME]);
  }
  if (containerExists(KC_CONTAINER_NAME)) {
    runDocker(["rm", "-f", KC_CONTAINER_NAME]);
  }

  // Verify ports 127.0.0.1:55432 and 127.0.0.1:8080 are free (do not kill other users' containers)
  const pgPortFree = await checkPortFree(PG_HOST_PORT);
  if (!pgPortFree) {
    throw new Error(
      `[ENV_REFUSED] Port 127.0.0.1:${PG_HOST_PORT} is already in use by another process. Refusing to overwrite or interfere.`,
    );
  }
  const kcPortFree = await checkPortFree(KC_HOST_PORT);
  if (!kcPortFree) {
    throw new Error(
      `[ENV_REFUSED] Port 127.0.0.1:${KC_HOST_PORT} is already in use by another process. Refusing to overwrite or interfere.`,
    );
  }

  console.log(
    `[env:test:start] Pulling locked PostgreSQL 18.7 digest: ${images.postgres}`,
  );
  runDocker(["pull", images.postgres], { stdio: "inherit" });
  const pgVerified = verifyImageDigest(images.postgres);
  console.log(
    `[env:test:start] Verified PostgreSQL digest: ${pgVerified.repoDigests.join(", ")} (${pgVerified.imagePlatform})`,
  );

  console.log(
    `[env:test:start] Pulling locked Keycloak 26.8.2 digest: ${images.keycloak}`,
  );
  runDocker(["pull", images.keycloak], { stdio: "inherit" });
  const kcVerified = verifyImageDigest(images.keycloak);
  console.log(
    `[env:test:start] Verified Keycloak digest: ${kcVerified.repoDigests.join(", ")} (${kcVerified.imagePlatform})`,
  );

  const superuserPass = generateSecret(24);
  const migratorPass = generateSecret(24);
  const runtimePass = generateSecret(24);
  const keycloakAdminPass = generateSecret(24);
  const oidcClientSecret = generateSecret(32);
  const authTxEncryptionKeyHex = randomBytes(32).toString("hex");

  if (process.env.GITHUB_ACTIONS === "true") {
    for (const secret of [
      superuserPass,
      migratorPass,
      runtimePass,
      keycloakAdminPass,
      oidcClientSecret,
      authTxEncryptionKeyHex,
    ]) {
      console.log(`::add-mask::${secret}`);
    }
  }

  // Start PostgreSQL 18.7 bound strictly to 127.0.0.1:55432
  // PostgreSQL 18 uses /var/lib/postgresql volume layout internally
  runDocker([
    "run",
    "-d",
    "--name",
    PG_CONTAINER_NAME,
    "-p",
    `127.0.0.1:${PG_HOST_PORT}:5432`,
    "-e",
    `POSTGRES_PASSWORD=${superuserPass}`,
    "-e",
    "POSTGRES_DB=postgres",
    images.postgres,
  ]);

  // Start Keycloak 26.8.2 in start-dev mode bound strictly to 127.0.0.1:8080
  runDocker([
    "run",
    "-d",
    "--name",
    KC_CONTAINER_NAME,
    "-p",
    `127.0.0.1:${KC_HOST_PORT}:8080`,
    "-e",
    "KC_BOOTSTRAP_ADMIN_USERNAME=temp-bootstrap-admin",
    "-e",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${keycloakAdminPass}`,
    "-e",
    "KC_HTTP_ENABLED=true",
    "-e",
    "KC_HOSTNAME_STRICT=false",
    images.keycloak,
    "start-dev",
  ]);

  await provisionDatabaseRoles({ superuserPass, migratorPass, runtimePass });
  await waitForKeycloak();

  const envContent = [
    "# Ephemeral DEVTEST local/CI environment generated by scripts/devtest-env.mjs",
    "# Ignored by Git (.gitignore). Do NOT commit.",
    "APP_ENV=test",
    "APP_ORIGIN=http://127.0.0.1:3100",
    "OIDC_ISSUER=http://127.0.0.1:8080/realms/branch-sales-dev",
    "OIDC_CLIENT_ID=branch-sales-web",
    `OIDC_CLIENT_SECRET=${oidcClientSecret}`,
    "OIDC_REDIRECT_URI=http://127.0.0.1:3100/auth/callback",
    `AUTH_TX_ENCRYPTION_KEY_HEX=${authTxEncryptionKeyHex}`,
    `DATABASE_URL=postgresql://app_runtime_role:${encodeURIComponent(runtimePass)}@127.0.0.1:${PG_HOST_PORT}/branch_sales_devtest`,
    `MIGRATOR_DATABASE_URL=postgresql://migrator_role:${encodeURIComponent(migratorPass)}@127.0.0.1:${PG_HOST_PORT}/branch_sales_devtest`,
    `SUPERUSER_DATABASE_URL=postgresql://postgres:${encodeURIComponent(superuserPass)}@127.0.0.1:${PG_HOST_PORT}/branch_sales_devtest`,
    "KEYCLOAK_ADMIN_URL=http://127.0.0.1:8080",
    "KEYCLOAK_ADMIN_USER=temp-bootstrap-admin",
    `KEYCLOAK_ADMIN_PASSWORD=${keycloakAdminPass}`,
    "",
  ].join("\n");

  writeFileSync(ENV_FILE_PATH, envContent, { mode: 0o600 });
  console.log(
    "[env:test:start] PostgreSQL 18.7 and Keycloak 26.8.2 are healthy on loopback 127.0.0.1. Ephemeral config written to .env.devtest.local (mode 0600).",
  );
}

async function checkHealth() {
  const envMap = loadEnvMap(ENV_FILE_PATH);
  const dbUrl = process.env.DATABASE_URL ?? envMap.DATABASE_URL;
  const migUrl =
    process.env.MIGRATOR_DATABASE_URL ?? envMap.MIGRATOR_DATABASE_URL;
  if (!dbUrl || !migUrl) {
    throw new Error(
      "[env:test:health] Missing DATABASE_URL or MIGRATOR_DATABASE_URL. Run `npm run env:test:start` first.",
    );
  }
  if (!isContainerRunning(PG_CONTAINER_NAME)) {
    throw new Error(
      `[env:test:health] Container ${PG_CONTAINER_NAME} is not running.`,
    );
  }
  if (!isContainerRunning(KC_CONTAINER_NAME)) {
    throw new Error(
      `[env:test:health] Container ${KC_CONTAINER_NAME} is not running.`,
    );
  }
  await waitForPostgres(dbUrl, 10_000);
  await waitForPostgres(migUrl, 10_000);
  await waitForKeycloak(10_000);

  const pgBindings = runDocker(["port", PG_CONTAINER_NAME]);
  const kcBindings = runDocker(["port", KC_CONTAINER_NAME]);
  if (
    !pgBindings.includes("127.0.0.1:55432") ||
    !kcBindings.includes("127.0.0.1:8080")
  ) {
    throw new Error(
      `[env:test:health] Port bindings are not restricted to loopback 127.0.0.1: pg=(${pgBindings}) kc=(${kcBindings})`,
    );
  }

  console.log(
    `[env:test:health] PASS — ${PG_CONTAINER_NAME} (${pgBindings.replace(/\r?\n/g, ", ")}) and ${KC_CONTAINER_NAME} (${kcBindings.replace(/\r?\n/g, ", ")}) are healthy.`,
  );
}

async function stopEnvironment() {
  if (containerExists(KC_CONTAINER_NAME)) {
    runDocker(["rm", "-f", KC_CONTAINER_NAME]);
  }
  if (containerExists(PG_CONTAINER_NAME)) {
    runDocker(["rm", "-f", PG_CONTAINER_NAME]);
  }
  if (existsSync(ENV_FILE_PATH)) {
    rmSync(ENV_FILE_PATH, { force: true });
  }
  console.log(
    "[env:test:stop] Stopped and removed project test containers and ephemeral .env.devtest.local.",
  );
}

async function main() {
  const cmd = process.argv[2] ?? "health";
  if (cmd === "start") {
    await startEnvironment();
  } else if (cmd === "health") {
    await checkHealth();
  } else if (cmd === "stop") {
    await stopEnvironment();
  } else {
    throw new Error(
      `Unknown command "${cmd}". Expected start | health | stop.`,
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
