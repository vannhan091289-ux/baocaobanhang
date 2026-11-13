#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validateMigrationTarget } from "./migrate-s1a.mjs";

/**
 * Deterministic Synthetic UUIDs and Fixtures for S1-A (Scope: DEVTEST).
 * Strictly synthetic — zero real staff or customer data.
 */
export const SYNTHETIC_DEPARTMENTS = {
  KHCN: {
    id: "11111111-1111-4111-8111-111111111101",
    code: "KHCN",
    name: "Phòng Khách hàng Cá nhân (Synthetic)",
    status: "ACTIVE",
  },
  KHDN: {
    id: "11111111-1111-4111-8111-111111111102",
    code: "KHDN",
    name: "Phòng Khách hàng Doanh nghiệp (Synthetic)",
    status: "ACTIVE",
  },
  DVKH: {
    id: "11111111-1111-4111-8111-111111111103",
    code: "DVKH",
    name: "Phòng Dịch vụ Khách hàng (Synthetic)",
    status: "ACTIVE",
  },
};

export const SYNTHETIC_USERS = [
  // Positive / Valid fixtures
  {
    key: "exec01",
    username: "syn.exec01",
    email: "syn.exec01@devtest.local",
    firstName: "BGD",
    lastName: "Synthetic01",
    staff: {
      id: "22222222-2222-4222-8222-222222222201",
      staff_code: "SYN-EXEC-001",
      display_name: "Giám đốc Chi nhánh Synthetic 01",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333301",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444401",
        role_code: "EXECUTIVE",
        scope_type: "BRANCH",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-001",
      },
    ],
  },
  {
    key: "admin01",
    username: "syn.admin01",
    email: "syn.admin01@devtest.local",
    firstName: "Admin",
    lastName: "Synthetic01",
    staff: {
      id: "22222222-2222-4222-8222-222222222202",
      staff_code: "SYN-ADMIN-001",
      display_name: "Quản trị Cấu hình Synthetic 01",
      department_id: SYNTHETIC_DEPARTMENTS.DVKH.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333302",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444402",
        role_code: "CONFIG_ADMIN",
        scope_type: "BRANCH",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-002",
      },
    ],
  },
  {
    key: "mgr_khcn",
    username: "syn.mgr.khcn",
    email: "syn.mgr.khcn@devtest.local",
    firstName: "QuanLy",
    lastName: "KHCN",
    staff: {
      id: "22222222-2222-4222-8222-222222222203",
      staff_code: "SYN-MGR-KHCN",
      display_name: "Trưởng phòng KHCN Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333303",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444403",
        role_code: "DEPARTMENT_MANAGER",
        scope_type: "DEPARTMENT",
        scope_department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-003",
      },
    ],
  },
  {
    key: "mgr_khdn",
    username: "syn.mgr.khdn",
    email: "syn.mgr.khdn@devtest.local",
    firstName: "QuanLy",
    lastName: "KHDN",
    staff: {
      id: "22222222-2222-4222-8222-222222222204",
      staff_code: "SYN-MGR-KHDN",
      display_name: "Trưởng phòng KHDN Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333304",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444404",
        role_code: "DEPARTMENT_MANAGER",
        scope_type: "DEPARTMENT",
        scope_department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-004",
      },
    ],
  },
  {
    key: "staff_khcn",
    username: "syn.staff.khcn",
    email: "syn.staff.khcn@devtest.local",
    firstName: "ChuyenVien",
    lastName: "KHCN",
    staff: {
      id: "22222222-2222-4222-8222-222222222205",
      staff_code: "SYN-STAFF-KHCN-01",
      display_name: "Chuyên viên KHCN Synthetic 01",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333305",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444405",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-005",
      },
    ],
  },
  {
    key: "staff_khdn",
    username: "syn.staff.khdn",
    email: "syn.staff.khdn@devtest.local",
    firstName: "ChuyenVien",
    lastName: "KHDN",
    staff: {
      id: "22222222-2222-4222-8222-222222222206",
      staff_code: "SYN-STAFF-KHDN-01",
      display_name: "Chuyên viên KHDN Synthetic 01",
      department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333306",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444406",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-006",
      },
    ],
  },
  {
    key: "staff_dvkh",
    username: "syn.staff.dvkh",
    email: "syn.staff.dvkh@devtest.local",
    firstName: "ChuyenVien",
    lastName: "DVKH",
    staff: {
      id: "22222222-2222-4222-8222-222222222207",
      staff_code: "SYN-STAFF-DVKH-01",
      display_name: "Chuyên viên DVKH Synthetic 01",
      department_id: SYNTHETIC_DEPARTMENTS.DVKH.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333307",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444407",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-007",
      },
    ],
  },

  // Negative / Deny fixtures
  {
    key: "unmapped",
    username: "syn.unmapped",
    email: "syn.unmapped@devtest.local",
    firstName: "Unmapped",
    lastName: "User",
    staff: null,
    identityLink: null,
    roleAssignments: [],
  },
  {
    key: "inactive_staff",
    username: "syn.inactive",
    email: "syn.inactive@devtest.local",
    firstName: "Inactive",
    lastName: "Staff",
    staff: {
      id: "22222222-2222-4222-8222-222222222208",
      staff_code: "SYN-INACTIVE-001",
      display_name: "Nhân sự Ngừng hoạt động Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "INACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333308",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444408",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-008",
      },
    ],
  },
  {
    key: "zero_role",
    username: "syn.zerorole",
    email: "syn.zerorole@devtest.local",
    firstName: "Zero",
    lastName: "Role",
    staff: {
      id: "22222222-2222-4222-8222-222222222209",
      staff_code: "SYN-ZEROROLE-001",
      display_name: "Nhân sự Chưa gán quyền Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333309",
      status: "ACTIVE",
    },
    roleAssignments: [],
  },
  {
    key: "multi_role",
    username: "syn.multirole",
    email: "syn.multirole@devtest.local",
    firstName: "Multi",
    lastName: "Role",
    staff: {
      id: "22222222-2222-4222-8222-222222222210",
      staff_code: "SYN-MULTIROLE-001",
      display_name: "Nhân sự Trùng 2 Quyền Hiệu lực Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333310",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444410",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-010A",
      },
      {
        id: "44444444-4444-4444-8444-444444444411",
        role_code: "DEPARTMENT_MANAGER",
        scope_type: "DEPARTMENT",
        scope_department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-010B",
      },
    ],
  },
  {
    key: "expired_role",
    username: "syn.expiredrole",
    email: "syn.expiredrole@devtest.local",
    firstName: "Expired",
    lastName: "Role",
    staff: {
      id: "22222222-2222-4222-8222-222222222211",
      staff_code: "SYN-EXPIRED-001",
      display_name: "Nhân sự Quyền Hết hạn Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHDN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333311",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444412",
        role_code: "STAFF",
        scope_type: "SELF",
        scope_department_id: null,
        effective_from: "2025-01-01T00:00:00.000Z",
        effective_to: "2025-12-31T23:59:59.000Z",
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-011",
      },
    ],
  },
  {
    key: "dept_mismatch",
    username: "syn.deptmismatch",
    email: "syn.deptmismatch@devtest.local",
    firstName: "DeptMismatch",
    lastName: "Manager",
    staff: {
      id: "22222222-2222-4222-8222-222222222212",
      staff_code: "SYN-MISMATCH-001",
      display_name: "Quản lý Lệch Phòng ban Synthetic",
      department_id: SYNTHETIC_DEPARTMENTS.KHCN.id,
      status: "ACTIVE",
    },
    identityLink: {
      id: "33333333-3333-4333-8333-333333333312",
      status: "ACTIVE",
    },
    roleAssignments: [
      {
        id: "44444444-4444-4444-8444-444444444413",
        role_code: "DEPARTMENT_MANAGER",
        scope_type: "DEPARTMENT",
        scope_department_id: SYNTHETIC_DEPARTMENTS.KHDN.id, // Mismatches staff.department_id (KHCN)
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_to: null,
        status: "ACTIVE",
        approval_reference: "SEED-DEVTEST-S1A-012",
      },
    ],
  },
];

function loadEnvMap(filePath) {
  const map = {};
  if (!existsSync(filePath)) return map;
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

async function getKeycloakAdminToken({ adminUrl, adminUser, adminPassword }) {
  const res = await fetch(
    `${adminUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: adminUser,
        password: adminPassword,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to obtain Keycloak admin token: HTTP ${res.status}`,
    );
  }
  const data = await res.json();
  return data.access_token;
}

async function ensureRealmAndClient({
  adminUrl,
  token,
  realmName,
  clientId,
  clientSecret,
  redirectUri,
}) {
  // Check if realm exists
  const checkRes = await fetch(`${adminUrl}/admin/realms/${realmName}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (checkRes.status === 404) {
    const createRealmRes = await fetch(`${adminUrl}/admin/realms`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        realm: realmName,
        enabled: true,
        registrationAllowed: false,
        resetPasswordAllowed: false,
        rememberMe: false,
        loginWithEmailAllowed: false,
      }),
    });
    if (!createRealmRes.ok) {
      throw new Error(
        `Failed to create Keycloak realm ${realmName}: HTTP ${createRealmRes.status}`,
      );
    }
  }

  // Ensure confidential client branch-sales-web exists with PKCE S256 required
  const clientsRes = await fetch(
    `${adminUrl}/admin/realms/${realmName}/clients?clientId=${encodeURIComponent(clientId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!clientsRes.ok) {
    throw new Error(`Failed to query clients in realm ${realmName}`);
  }
  const existingClients = await clientsRes.json();
  const clientPayload = {
    clientId,
    name: "Branch Sales OS Web Client (DEVTEST Synthetic)",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    secret: clientSecret,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [redirectUri],
    webOrigins: ["http://127.0.0.1:3100"],
    attributes: {
      "pkce.code.challenge.method": "S256",
    },
  };

  if (existingClients.length === 0) {
    const createClientRes = await fetch(
      `${adminUrl}/admin/realms/${realmName}/clients`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(clientPayload),
      },
    );
    if (!createClientRes.ok) {
      throw new Error(
        `Failed to create Keycloak client ${clientId}: HTTP ${createClientRes.status}`,
      );
    }
  } else {
    const internalId = existingClients[0].id;
    const updateClientRes = await fetch(
      `${adminUrl}/admin/realms/${realmName}/clients/${internalId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...existingClients[0], ...clientPayload }),
      },
    );
    if (!updateClientRes.ok) {
      throw new Error(
        `Failed to update Keycloak client ${clientId}: HTTP ${updateClientRes.status}`,
      );
    }
  }
}

async function ensureKeycloakUser({
  adminUrl,
  token,
  realmName,
  userDef,
  password,
}) {
  const searchRes = await fetch(
    `${adminUrl}/admin/realms/${realmName}/users?username=${encodeURIComponent(userDef.username)}&exact=true`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!searchRes.ok) {
    throw new Error(`Failed to query Keycloak user ${userDef.username}`);
  }
  const found = await searchRes.json();
  let userId;
  if (found.length === 0) {
    const createRes = await fetch(
      `${adminUrl}/admin/realms/${realmName}/users`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: userDef.username,
          email: userDef.email,
          firstName: userDef.firstName,
          lastName: userDef.lastName,
          enabled: true,
          emailVerified: true,
          requiredActions: [],
        }),
      },
    );
    if (!createRes.ok) {
      throw new Error(
        `Failed to create Keycloak user ${userDef.username}: HTTP ${createRes.status}`,
      );
    }
    const afterRes = await fetch(
      `${adminUrl}/admin/realms/${realmName}/users?username=${encodeURIComponent(userDef.username)}&exact=true`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    const afterList = await afterRes.json();
    userId = afterList[0].id;
  } else {
    userId = found[0].id;
    await fetch(`${adminUrl}/admin/realms/${realmName}/users/${userId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...found[0],
        email: userDef.email,
        firstName: userDef.firstName,
        lastName: userDef.lastName,
        enabled: true,
        emailVerified: true,
        requiredActions: [],
      }),
    });
  }

  // Reset password to the ephemeral test user password
  const pwRes = await fetch(
    `${adminUrl}/admin/realms/${realmName}/users/${userId}/reset-password`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "password",
        value: password,
        temporary: false,
      }),
    },
  );
  if (!pwRes.ok) {
    throw new Error(
      `Failed to set password for synthetic user ${userDef.username}: HTTP ${pwRes.status}`,
    );
  }
  return userId;
}

async function main() {
  const envFilePath = path.resolve(process.cwd(), ".env.devtest.local");
  const envMap = loadEnvMap(envFilePath);

  const migratorUrl =
    process.env.MIGRATOR_DATABASE_URL ?? envMap.MIGRATOR_DATABASE_URL;
  const oidcIssuer =
    process.env.OIDC_ISSUER ??
    envMap.OIDC_ISSUER ??
    "http://127.0.0.1:8080/realms/branch-sales-dev";
  const oidcClientId =
    process.env.OIDC_CLIENT_ID ?? envMap.OIDC_CLIENT_ID ?? "branch-sales-web";
  const oidcClientSecret =
    process.env.OIDC_CLIENT_SECRET ?? envMap.OIDC_CLIENT_SECRET;
  const oidcRedirectUri =
    process.env.OIDC_REDIRECT_URI ??
    envMap.OIDC_REDIRECT_URI ??
    "http://127.0.0.1:3100/auth/callback";
  const adminUrl =
    process.env.KEYCLOAK_ADMIN_URL ??
    envMap.KEYCLOAK_ADMIN_URL ??
    "http://127.0.0.1:8080";
  const adminUser =
    process.env.KEYCLOAK_ADMIN_USER ?? envMap.KEYCLOAK_ADMIN_USER;
  const adminPassword =
    process.env.KEYCLOAK_ADMIN_PASSWORD ?? envMap.KEYCLOAK_ADMIN_PASSWORD;

  if (!migratorUrl || !oidcClientSecret || !adminUser || !adminPassword) {
    throw new Error(
      "[env:test:seed] Missing required environment variables. Run `npm run env:test:start` and `npm run db:migrate:up` first.",
    );
  }

  // Refuse out-of-scope targets before any IdP or database mutation.
  validateMigrationTarget({
    appEnv: process.env.APP_ENV ?? envMap.APP_ENV,
    databaseUrl: migratorUrl,
  });
  if (
    new URL(migratorUrl).username !== "migrator_role" ||
    adminUrl !== "http://127.0.0.1:8080" ||
    oidcIssuer !== "http://127.0.0.1:8080/realms/branch-sales-dev" ||
    oidcClientId !== "branch-sales-web" ||
    oidcRedirectUri !== "http://127.0.0.1:3100/auth/callback"
  ) {
    throw new Error(
      "[SEED_REFUSED] Only the approved synthetic migrator/IdP profile may be seeded.",
    );
  }

  const syntheticUserPassword =
    process.env.SYNTHETIC_USER_PASSWORD ??
    envMap.SYNTHETIC_USER_PASSWORD ??
    `SynPass-${randomBytes(16).toString("base64url")}!9`;

  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${syntheticUserPassword}`);
  }

  const token = await getKeycloakAdminToken({
    adminUrl,
    adminUser,
    adminPassword,
  });

  const realmName = "branch-sales-dev";
  await ensureRealmAndClient({
    adminUrl,
    token,
    realmName,
    clientId: oidcClientId,
    clientSecret: oidcClientSecret,
    redirectUri: oidcRedirectUri,
  });

  const subjectByKey = {};
  for (const userDef of SYNTHETIC_USERS) {
    const sub = await ensureKeycloakUser({
      adminUrl,
      token,
      realmName,
      userDef,
      password: syntheticUserPassword,
    });
    subjectByKey[userDef.key] = sub;
  }

  // Seed PostgreSQL via migrator_role in a single transaction
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    // Preserve existing sessions, audit and mappings. Re-running seed only adds
    // missing deterministic fixtures; it never resets existing data or grants.
    for (const dept of Object.values(SYNTHETIC_DEPARTMENTS)) {
      await client.query(
        `INSERT INTO departments (id, code, name, status)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [dept.id, dept.code, dept.name, dept.status],
      );
    }

    for (const userDef of SYNTHETIC_USERS) {
      if (!userDef.staff) continue;
      await client.query(
        `INSERT INTO staff (id, staff_code, display_name, department_id, status)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [
          userDef.staff.id,
          userDef.staff.staff_code,
          userDef.staff.display_name,
          userDef.staff.department_id,
          userDef.staff.status,
        ],
      );

      if (userDef.identityLink) {
        const sub = subjectByKey[userDef.key];
        await client.query(
          `INSERT INTO identity_links (id, issuer, subject, staff_id, status)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [
            userDef.identityLink.id,
            oidcIssuer,
            sub,
            userDef.staff.id,
            userDef.identityLink.status,
          ],
        );
      }

      for (const ra of userDef.roleAssignments) {
        await client.query(
          `INSERT INTO role_assignments (
             id, staff_id, role_code, scope_type, scope_department_id,
             effective_from, effective_to, status, approval_reference
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
          [
            ra.id,
            userDef.staff.id,
            ra.role_code,
            ra.scope_type,
            ra.scope_department_id,
            ra.effective_from,
            ra.effective_to,
            ra.status,
            ra.approval_reference,
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  // Persist SYNTHETIC_USER_PASSWORD in .env.devtest.local if not already present
  if (existsSync(envFilePath)) {
    const current = readFileSync(envFilePath, "utf8");
    if (!current.includes("SYNTHETIC_USER_PASSWORD=")) {
      appendFileSync(
        envFilePath,
        `SYNTHETIC_USER_PASSWORD=${syntheticUserPassword}\n`,
        { mode: 0o600 },
      );
    } else {
      const updated = current.replace(
        /^SYNTHETIC_USER_PASSWORD=.*$/m,
        `SYNTHETIC_USER_PASSWORD=${syntheticUserPassword}`,
      );
      writeFileSync(envFilePath, updated, { mode: 0o600 });
    }
  }

  console.log(
    `[env:test:seed] Seeded 3 synthetic departments (KHCN, KHDN, DVKH) and ${SYNTHETIC_USERS.length} synthetic Keycloak/DB fixtures in realm "${realmName}".`,
  );
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
