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

## AC ledger tại thời điểm chờ CI — lịch sử, được thay bởi kết quả cuối bên dưới

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

## Final acceptance — 2026-11-14 Asia/Ho_Chi_Minh

Accepted code head: `199d1b0fb93a7432e17db672101257bfa2ec8acb`.
CI: [https://github.com/vannhan091289-ux/baocaobanhang/actions/runs/43468523124](https://github.com/vannhan091289-ux/baocaobanhang/actions/runs/43468523124), job132033976300. All steps succeeded with exit0 (no continue-on-error): clean install/lockfile, lint, format, strict typecheck, unit23, locked env start/health, preview/up/re-run, seed, real integration16, production build, Chromium E2E4, preserve-data stop, Gitleaks full history+PR diff, npm audit and diff whitespace.

Toolchain: Node24.22.2/npm11.19.1/Gitleaks8.30.1. Fixed dependencies/image digests unchanged. Security: no leaks; 0 High/Critical; 9 moderate dev advisories disclosed, no forced dependency upgrade. Full history21 commits and PR range7 commits scanned at this code checkpoint. No deploy/real data/enterprise SSO, D05/D10 remain OPEN.

| AC | Result | Evidence at accepted code head |
|---|---|---|
| AC-01 | PASS | Pinned toolchain; npm ci and lockfile unchanged; daemon/digest checks and loopback ports; approved local profile readback plus AMD64 CI |
| AC-02 | PASS | Seven tables; ordered SQL preview0001+0002/up/re-run; seed target refusal/preservation; runtime no owner/superuser/BYPASSRLS/DDL/TEMP or grant writes, audit INSERT-only |
| AC-03 | PASS | Real Keycloak form/OIDC code exchange + PostgreSQL positive roles and unmapped/inactive/zero/multiple/expired/mismatched-scope DENY |
| AC-04 | PASS | Real wrong verifier with valid GCM/AAD rejected by Keycloak; state/nonce/replay/expiry/injection; signed wrong aud/iss/exp with SAME-seam valid control; real-provider happy path remains separate |
| AC-05 | PASS | Token hashing/cookies/5m/15m/8h boundaries; CSRF+Origin POST logout; durable role/mapping/lifecycle revoke and concurrent issuance/refresh denial regressions |
| AC-06 | PASS | Backend self-context/role/scope from DB; direct tamper/cross-scope DENY; no Org/role-write endpoint; private real-DB old-session proof plus CI interleavings |
| AC-07 | PASS | Login session+ALLOW audit atomic; audit outage fails closed; revoke durable despite audit failure; sanitized malformed-reference/refresh-race DENY with healthy/outage regression and real audit-row check |
| AC-08 | PASS | Full-history/diff Gitleaks, audit0 High/Critical,9 moderate dev disclosed, pinned actions/tools and read-only CI permissions, ephemeral secret masking, no weakened gate |
| AC-09 | PASS | Unit23, real integration16, Chromium E2E4, full quality/build/security at accepted code head; regressions and failed CI attempts recorded rather than hidden |
| AC-10 | PASS | README/env placeholders/UI states; independent Standards/Spec/security re-review0 open P1/P2; real pg_dump/restore new target, seven content hashes, columns/constraints preserved with parser normalization; source untouched |

Independent final delta reviews: Standards PASS and Spec PASS in separate reviewer contexts; source/delta checks and runtime CI are distinct evidence. GitHub same-account API disallows formal self APPROVE/REQUEST_CHANGES, so PR review is recorded using COMMENT with explicit outcome; this is not an external security certification.

Restore scope: copies are synthetic inspection targets; pg_restore uses no-owner/no-acl, while source runtime privilege boundaries are tested independently. The test is not a production recovery or credentials/ACL rollout plan. Temporary CHECK parser tables exist only in restore-copy connection and disappear on close; no existing DB/schema/volume was dropped. Review container baocaobanhang-review-946f9c1a60 is stopped; synthetic proof copies retained.

Conditional merge authority: chủ dự án trực tiếp yêu cầu “review … sửa lỗi trọng yếu, xác minh AC-01..10 rồi merge nếu đạt” cho TASK-0003. Applies to PR #6 only; future merge/release permissions are not implied. Documentation acceptance commit preserves this tested product code and must pass its own final-head CI/readback before merge.
