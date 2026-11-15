import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type AppEnv = "dev" | "test";

export interface RuntimeConfig {
  appEnv: AppEnv;
  appOrigin: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcRedirectUri: string;
  authTxEncryptionKey: Buffer;
  databaseUrl: string;
  cookieSecure: boolean;
}

const ALLOWED_APP_ENVS = new Set<string>(["dev", "test"]);
const ALLOWED_LOOPBACK_ORIGINS = new Set<string>(["http://127.0.0.1:3100"]);
const ALLOWED_LOOPBACK_ISSUERS = new Set<string>([
  "http://127.0.0.1:8080/realms/branch-sales-dev",
]);
const ALLOWED_DB_HOSTS = new Set<string>(["127.0.0.1", "localhost"]);
const ALLOWED_DB_NAMES = new Set<string>([
  "branch_sales_devtest",
  "branch_sales_test",
]);
const DISALLOWED_RUNTIME_DB_USERS = new Set<string>([
  "postgres",
  "migrator_role",
]);

let envLoadedFromDisk = false;

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFileContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    let trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("export ") || trimmed.startsWith("export\t")) {
      trimmed = trimmed.slice(6).trimStart();
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      continue;
    }
    let val = trimmed.slice(idx + 1).trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }
  return parsed;
}

export function ensureDevtestEnvLoaded(): void {
  if (envLoadedFromDisk) {
    return;
  }
  envLoadedFromDisk = true;
  const localEnvPath = path.resolve(process.cwd(), ".env.devtest.local");
  if (!existsSync(localEnvPath)) {
    return;
  }
  const content = readFileSync(localEnvPath, "utf8");
  const entries = parseEnvFileContent(content);
  for (const [key, val] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

export class ConfigProfileError extends Error {
  public readonly code = "CONFIG_PROFILE_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "ConfigProfileError";
  }
}

export function validateAndBuildRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const rawAppEnv = env.APP_ENV?.trim();
  if (!rawAppEnv || !ALLOWED_APP_ENVS.has(rawAppEnv)) {
    throw new ConfigProfileError(
      `Invalid or unsupported APP_ENV="${rawAppEnv ?? ""}". Only DEVTEST synthetic profiles ("dev" or "test") are permitted in S1-A.`,
    );
  }
  const appEnv = rawAppEnv as AppEnv;

  const appOrigin = env.APP_ORIGIN?.trim() ?? "";
  if (!ALLOWED_LOOPBACK_ORIGINS.has(appOrigin)) {
    throw new ConfigProfileError(
      `APP_ORIGIN="${appOrigin}" is not in the S1-A loopback allowlist (http://127.0.0.1:3100).`,
    );
  }

  const oidcIssuer = env.OIDC_ISSUER?.trim() ?? "";
  if (!ALLOWED_LOOPBACK_ISSUERS.has(oidcIssuer)) {
    throw new ConfigProfileError(
      `OIDC_ISSUER="${oidcIssuer}" is not in the S1-A loopback allowlist (http://127.0.0.1:8080/realms/branch-sales-dev).`,
    );
  }

  const oidcClientId = env.OIDC_CLIENT_ID?.trim() ?? "";
  if (oidcClientId !== "branch-sales-web") {
    throw new ConfigProfileError(
      `OIDC_CLIENT_ID="${oidcClientId}" must be "branch-sales-web" in S1-A DEVTEST profile.`,
    );
  }

  const oidcClientSecret = env.OIDC_CLIENT_SECRET?.trim() ?? "";
  if (
    oidcClientSecret.length < 16 ||
    oidcClientSecret === "replace-with-ephemeral-random-secret"
  ) {
    throw new ConfigProfileError(
      "OIDC_CLIENT_SECRET is missing, too short, or still set to the placeholder value.",
    );
  }

  const oidcRedirectUri = env.OIDC_REDIRECT_URI?.trim() ?? "";
  const expectedRedirectUri = `${appOrigin}/auth/callback`;
  if (oidcRedirectUri !== expectedRedirectUri) {
    throw new ConfigProfileError(
      `OIDC_REDIRECT_URI="${oidcRedirectUri}" must match fixed callback "${expectedRedirectUri}".`,
    );
  }

  const keyHex = env.AUTH_TX_ENCRYPTION_KEY_HEX?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex) || /^0+$/.test(keyHex)) {
    throw new ConfigProfileError(
      "AUTH_TX_ENCRYPTION_KEY_HEX must be a non-zero 64-character hexadecimal string (256-bit key).",
    );
  }
  const authTxEncryptionKey = Buffer.from(keyHex, "hex");

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new ConfigProfileError("DATABASE_URL is required.");
  }

  let parsedDb: URL;
  try {
    parsedDb = new URL(databaseUrl);
  } catch {
    throw new ConfigProfileError("DATABASE_URL is not a valid URL.");
  }

  if (
    parsedDb.protocol !== "postgresql:" &&
    parsedDb.protocol !== "postgres:"
  ) {
    throw new ConfigProfileError(
      "DATABASE_URL must use postgresql:// protocol.",
    );
  }
  if (!ALLOWED_DB_HOSTS.has(parsedDb.hostname)) {
    throw new ConfigProfileError(
      `DATABASE_URL host "${parsedDb.hostname}" is outside the loopback allowlist.`,
    );
  }
  const dbName = parsedDb.pathname.replace(/^\//, "");
  if (!ALLOWED_DB_NAMES.has(dbName)) {
    throw new ConfigProfileError(
      `DATABASE_URL database "${dbName}" is not in the synthetic allowlist (branch_sales_devtest, branch_sales_test).`,
    );
  }
  const dbUser = decodeURIComponent(parsedDb.username);
  if (!dbUser || DISALLOWED_RUNTIME_DB_USERS.has(dbUser)) {
    throw new ConfigProfileError(
      `DATABASE_URL user "${dbUser}" is forbidden at runtime. Runtime must use least-privilege role (app_runtime_role), never superuser or migrator.`,
    );
  }
  const dbPassword = decodeURIComponent(parsedDb.password);
  if (!dbPassword || dbPassword === "replace-with-ephemeral-runtime-password") {
    throw new ConfigProfileError(
      "DATABASE_URL password is missing or still set to the placeholder value.",
    );
  }

  // Per D-08 §2: Secure=false exception is strictly for loopback HTTP in DEVTEST (dev/test)
  const isHttps = appOrigin.startsWith("https://");
  const cookieSecure = isHttps;

  return {
    appEnv,
    appOrigin,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcRedirectUri,
    authTxEncryptionKey,
    databaseUrl,
    cookieSecure,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  ensureDevtestEnvLoaded();
  return validateAndBuildRuntimeConfig(process.env);
}
