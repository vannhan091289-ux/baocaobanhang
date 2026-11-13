declare module "*/scripts/migrate-s1a.mjs" {
  export function validateMigrationTarget(params: {
    appEnv?: string;
    databaseUrl?: string;
  }): {
    dbName: string;
    host: string;
    port: string;
  };

  export function runMigrations(params: {
    mode: "preview" | "up";
    appEnv?: string;
    databaseUrl?: string;
    migrationsDir?: string;
  }): Promise<
    | {
        mode: "preview";
        target: { dbName: string; host: string; port: string };
        sqlPath: string;
        sqlByteLength: number;
        sqlPreview: string;
      }
    | {
        mode: "up";
        target: { dbName: string; host: string; port: string };
        appliedMigrations: string[];
      }
  >;
}

declare module "*/scripts/seed-s1a.mjs" {
  export interface SyntheticDepartment {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "INACTIVE";
  }

  export interface SyntheticUserFixture {
    key: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    staff: {
      id: string;
      staff_code: string;
      display_name: string;
      department_id: string;
      status: "ACTIVE" | "INACTIVE";
    } | null;
    identityLink: {
      id: string;
      status: "ACTIVE" | "REVOKED";
    } | null;
    roleAssignments: Array<{
      id: string;
      role_code: string;
      scope_type: string;
      scope_department_id: string | null;
      effective_from: string;
      effective_to: string | null;
      status: "ACTIVE" | "REVOKED";
      approval_reference: string;
    }>;
  }

  export const SYNTHETIC_DEPARTMENTS: {
    KHCN: SyntheticDepartment;
    KHDN: SyntheticDepartment;
    DVKH: SyntheticDepartment;
  };

  export const SYNTHETIC_USERS: SyntheticUserFixture[];
}
