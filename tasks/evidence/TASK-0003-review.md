# TASK-0003 — PR #6 independent review and fixes

Base main: 04e7af0738e3ba90f04dca8c456b87328aeaf6b8. Original reviewed head: 035d9cc45c8fcaa8d4e2dfe88073c879805c8480, canonical tree 49aaf34ccc07b30cbe2b1c7238595da7f595272f; all 67 source blobs matched local review snapshot.

## Initial independent findings

Standards: P1 old cookies adopted changed same-ID role/department/mapping; P2 spoofable peer header, raw query in audit, runtime audit SELECT beyond INSERT-only. Spec: destructive fixed-schema restore, non-isolated PKCE/claims validation cases, and acceptance claims beyond evidence. Root also found start rm -f existing containers and seed DELETE audit/mapping without target guard. Original CI43460335537 was green, demonstrating these gaps were not caught by its old assertions.

## Scoped fixes

- Additive migration0002 revokes affected sessions inside authorization-changing transactions; preserves seven-table data/audit and revokes runtime audit SELECT.
- Ignore client peer headers in loopback-only profile; normalize UUID references and audit invalid input only as a marker.
- Harness verifies local socket/context and project ownership, preserves existing resources, reuse/stop without rm/reset; seed validates targets before I/O and only adds missing deterministic fixtures, preserving existing state.
- PKCE negative case encrypts a genuinely wrong verifier with valid GCM/AAD; claim cases re-sign and independently verify signatures at a negative-test-only wire seam, while real Keycloak happy-path remains unmocked.
- Restore uses actual pg_dump/pg_restore into a unique new synthetic database, hashes all seven tables and compares constraints; never drops a pre-existing schema/database and never logs dump/session data.

## Local verification before final CI

Pinned Node24.22.2/npm11.19.1. Lint/typecheck PASS; unit suite21 PASS (15 author tests plus6 review regressions). Four review regressions failed before fixes (forged throttle bucket, malformed staff/department audit references, destructive startup); seed-target regression failed with external-I/O-before-guard then passed after fix. External Docker/fetch boundaries were controlled for those unit tests; no real provider success was mocked for application acceptance.

A separate digest-pinned PostgreSQL18.7 ARM64 container, no network/published ports/host mounts, reproduced four session-authority failures before migration0002: same-ID role, SELF department transfer, inactive/reactivated, changed subject. All four plus display-name-only control PASS after migration; runtime audit SELECT refused. Container baocaobanhang-review-946f9c1a60 was stopped and retained, not removed; it did not touch Antigravity DB/IdP. This DB regression proof does not substitute final full OIDC/E2E CI.

## AC ledger — final head still pending

| AC | Final acceptance | Required remaining evidence |
|---|---|---|
| AC-01 | NOT RUN on final head | clean install/lock/image profile; final CI/review URL required |
| AC-02 | NOT RUN on final head | migration/seed/permissions plus preserved data; final CI/review URL required |
| AC-03 | NOT RUN on final head | real Keycloak mapping happy/deny; final CI/review URL required |
| AC-04 | NOT RUN on final head | isolated protocol negatives; final CI/review URL required |
| AC-05 | NOT RUN on final head | cookie/timeout/revocation/CSRF; final CI/review URL required |
| AC-06 | NOT RUN on final head | self-context scope/client-tamper; final CI/review URL required |
| AC-07 | NOT RUN on final head | audit/failure semantics; final CI/review URL required |
| AC-08 | NOT RUN on final head | security full history/dependencies; final CI/review URL required |
| AC-09 | NOT RUN on final head | full quality/integration/E2E; final CI/review URL required |
| AC-10 | NOT RUN on final head | README/UI/independent re-review/real restore; final CI/review URL required |

Final CI/head/reviewer results will be appended after actual execution; no deployment or real data. Official references: [PostgreSQL18 triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html), [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

Second review found and addressed an issuance race: graph read/evaluation and session+audit creation now share one transaction and a database-local advisory lock taken before all authority mutation statements. A real-DB barrier regression observes the blocked advisory lock before committing a mapping change. Added full ordered SQL preview (superset of migrations, including already-applied SQL), a valid control through the same signed-negative JWKS seam, and a runtime TEMP-table denial check (PUBLIC TEMP revoked in bootstrap). These new runtime cases require final CI before acceptance.

CI43464558354 at caa1d2e: unit21 PASS, migration/seed and integration14/15 PASS, including concurrency and all protocol controls. Restore failed because pg_dump archive tries CREATE SCHEMA public in a template0 database where public already exists; reproduced on the separate review container. Fixed by excluding exactly that single SCHEMA-public TOC entry via pg_restore --use-list, preserving all table/data/function/constraint entries and never DROPping the existing schema. Final rerun required.

CI43465388129 at9e1eb588: real restore succeeded and seven table content hashes matched, but raw CHECK-definition text comparison failed because PostgreSQL deparses array-level versus element-level casts differently after dump/restore. Fixed the comparator by checking all constraint metadata, comparing non-CHECK definitions exactly, and reparsing both differing CHECK definitions through the same PostgreSQL parser in private temporary tables before exact comparison; no constraints/data checks are skipped. Final rerun required.

CI43466515422 at38cf39f2 passed full pipeline (unit21/integration15/E2E4/security). Before final acceptance, a final challenge found verification could read active session, observe a same-ID role change, then ignore zero affected rows on guarded last_seen update and return new authority. Independent Standards confirmed this race. Added guarded UPDATE RETURNING id with rowCount1 requirement, a unit regression observed RED before fix, and deterministic real-DB interleaving regression; final expected suite22unit/16integration still requires actual CI evidence.

Final Spec follow-up added best-effort sanitized audit to the new zero-row refresh DENY branch. Both success/outage unit cases were RED without the audit attempt, then GREEN after addition; DENY remains unchanged during audit failure. Real-DB interleaving test also verifies a matching DENY audit row through the migrator connection. Final suite expected23unit/16integration/4E2E, subject to CI.
