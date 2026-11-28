// @vitest-environment node
import type { QueryResult, QueryResultRow } from "pg";
import { expect, it } from "vitest";
import { hashOpaqueToken } from "@/server/crypto";
import type { Queryable } from "@/server/db";
import { verifyRequestSession } from "@/server/session";

it.each([false, true])(
  "denies and audits a zero-row session refresh even if audit fails: %s",
  async (auditFails) => {
    const token = "unit-fixture";
    const staffId = "22222222-2222-4222-8222-222222222205";
    const departmentId = "11111111-1111-4111-8111-111111111101";
    const identityId = "33333333-3333-4333-8333-333333333305";
    const assignmentId = "44444444-4444-4444-8444-444444444405";
    const now = new Date("2026-06-01T12:00:00Z");
    let refreshAttempted = false;
    let auditAttempted = false;
    const db: Queryable = {
      async query<R extends QueryResultRow>(
        text: string,
      ): Promise<QueryResult<R>> {
        let rows: unknown[];
        if (text.includes("FROM sessions"))
          rows = [
            {
              id: "55555555-5555-4555-8555-555555555501",
              token_hash: hashOpaqueToken(token),
              staff_id: staffId,
              identity_link_id: identityId,
              role_assignment_id: assignmentId,
              csrf_token: "synthetic-csrf-value",
              created_at: now,
              last_seen_at: now,
              absolute_expires_at: new Date(now.getTime() + 3600000),
              revoked_at: null,
              revoked_reason: null,
            },
          ];
        else if (text.includes("FROM identity_links"))
          rows = [
            {
              id: identityId,
              issuer: "synthetic-issuer",
              subject: "synthetic-subject",
              staff_id: staffId,
              status: "ACTIVE",
            },
          ];
        else if (text.includes("FROM staff"))
          rows = [
            {
              id: staffId,
              staff_code: "SYN-TEST",
              display_name: "Synthetic",
              department_id: departmentId,
              status: "ACTIVE",
            },
          ];
        else if (text.includes("FROM departments"))
          rows = [
            {
              id: departmentId,
              code: "KHCN",
              name: "Synthetic",
              status: "ACTIVE",
            },
          ];
        else if (text.includes("FROM role_assignments"))
          rows = [
            {
              id: assignmentId,
              staff_id: staffId,
              role_code: "EXECUTIVE",
              scope_type: "BRANCH",
              scope_department_id: null,
              effective_from: "2026-01-01T00:00:00Z",
              effective_to: null,
              status: "ACTIVE",
            },
          ];
        else if (text.includes("SET last_seen_at")) {
          refreshAttempted = true;
          rows = [];
        } else if (text.includes("INSERT INTO audit_events")) {
          auditAttempted = true;
          if (auditFails) throw new Error("Simulated audit outage");
          return {
            rows: [],
            rowCount: 1,
            command: "INSERT",
            oid: 0,
            fields: [],
          } as QueryResult<R>;
        } else
          throw new Error(
            "Unexpected query at the controlled database boundary",
          );
        return {
          rows,
          rowCount: rows.length,
          command: "SELECT",
          oid: 0,
          fields: [],
        } as QueryResult<R>;
      },
    };
    const result = await verifyRequestSession({
      rawSessionToken: token,
      now,
      db,
    });
    expect(refreshAttempted).toBe(true);
    expect(auditAttempted).toBe(true);
    expect(result.authenticated).toBe(false);
    if (!result.authenticated)
      expect(result.reasonCode).toBe("SESSION_REVOKED");
  },
);

it("tolerates sub-second concurrent last_seen_at skew without falsely revoking session", async () => {
  const token = "concurrent-skew-session-token-123456";
  const tokenHash = hashOpaqueToken(token);
  const realNowMs = Date.now();
  const createdAt = new Date(realNowMs - 10_000).toISOString();
  const concurrentLastSeenAt = new Date(realNowMs + 50).toISOString();
  const absoluteExpiresAt = new Date(realNowMs + 3_600_000).toISOString();
  const sessionId = "sess-skew-1";
  const identityLinkId = "link-skew-1";
  const staffId = "staff-skew-1";
  const deptId = "dept-skew-1";
  const assignmentId = "role-skew-1";

  const db: Queryable = {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
    ): Promise<QueryResult<R>> {
      let rows: unknown[];
      if (text.includes("FROM sessions"))
        rows = [
          {
            id: sessionId,
            token_hash: tokenHash,
            csrf_token: "csrf-skew",
            staff_id: staffId,
            identity_link_id: identityLinkId,
            role_assignment_id: assignmentId,
            created_at: createdAt,
            last_seen_at: concurrentLastSeenAt,
            absolute_expires_at: absoluteExpiresAt,
            revoked_at: null,
            revoked_reason: null,
          },
        ];
      else if (text.includes("FROM identity_links"))
        rows = [
          {
            id: identityLinkId,
            issuer: "http://127.0.0.1:8080/realms/branch-sales-dev",
            subject: "sub-skew",
            staff_id: staffId,
            status: "ACTIVE",
          },
        ];
      else if (text.includes("FROM staff"))
        rows = [
          {
            id: staffId,
            staff_code: "SYN-SKEW-1",
            display_name: "Skew Staff",
            department_id: deptId,
            status: "ACTIVE",
          },
        ];
      else if (text.includes("FROM departments"))
        rows = [
          {
            id: deptId,
            code: "KHCN",
            name: "KHCN",
            status: "ACTIVE",
          },
        ];
      else if (text.includes("FROM role_assignments"))
        rows = [
          {
            id: assignmentId,
            staff_id: staffId,
            role_code: "CONFIG_ADMIN",
            scope_type: "BRANCH",
            scope_department_id: null,
            effective_from: "2026-01-01T00:00:00Z",
            effective_to: null,
            status: "ACTIVE",
          },
        ];
      else if (text.includes("SET last_seen_at")) {
        rows = [{ id: sessionId }];
      } else {
        throw new Error(`Unexpected query: ${text}`);
      }
      return {
        rows,
        rowCount: rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as QueryResult<R>;
    },
  };

  const result = await verifyRequestSession({ rawSessionToken: token, db });
  expect(result.authenticated).toBe(true);
});
