# Branch Sales OS V3.0 — UAT & Final Handover Report (DEVTEST Synthetic)

- **Target Release:** Branch Sales OS V3.0 MVP (DEVTEST Synthetic)
- **Baseline:** `TASK-0001` through `TASK-0017` (`main` `92789091f7a763fa9c358cc28e61d130e7d1ef33` + `TASK-0016` on `feat/TASK-0016-dashboard-alerts-nav-hardening`; `M-03` & `TASK-0013` remain `OPEN`/`BLOCKED`)
- **Open Decisions:** `D-05` (real CIF/PII integration), `D-10` (production deploy / enterprise SSO), `M-03` (`ADJUST_FINAL` 2-step contract), and `TASK-0013` remain `OPEN`.
- **Owner UAT Status:** `TECHNICAL HANDOVER READY` / `READY FOR OWNER UAT` (Agent does not self-certify final owner UAT).

## 1. Traceability Matrix (`Feature → Task → AC → PR / Merge SHA`)

| Phase / Module | Task | Scope Summary | Merged PR & `main` SHA |
|---|---|---|---|
| Sprint 0 Foundation | `TASK-0001` | Next.js + TS + Vitest + Playwright + CI scaffold | PR #3 (`bac54ba921aeddd37fbf19e35e11104e69a3f791`) |
| Sprint 1 Prep | `TASK-0002` | DEVTEST architecture, ADR-001..005 & prep | PR #4 (`b04b69d1c63ae9f0a9aa5259446e46b838476ef0`) |
| S1-A Identity & Session | `TASK-0003` | Keycloak 26.8.2 OIDC + PKCE + PostgreSQL session + `app_runtime_role` | PR #6 (`d8a7bd9c4b8bbebb738dd84f7369a9446e46b2dc`) |
| S1-B Org & Maker-Checker | `TASK-0004` | Departments, Staff CRUD, Maker-Checker role proposals, `CONFIG_ADMIN` separation | PR #11 (`52843270e7d743d14c40ad287b748847b7097994`) |
| S1-C Authz Matrix & Audit | `TASK-0005` | Temporal role handover, optimistic concurrency, tamper-evident `audit_events` | PR #12 (`a92e996f7eec12574ec0a0a26eecfdf8ca5c3e96`) |
| P0A KPI Dictionary & Targets | `TASK-0006` | 7-group KPI dictionary, working calendar, target allocation & revisions | PR #13 (`128be748907b76712df59dced0f3d32b190b8237`) |
| P0B1 Planning & Activity Log | `TASK-0007` | Weekly/daily sales plans, single-source activity logs, Monday review | PR #14 (`b98c47809e4d0eda504fe70ddd79ee2459de661e`) |
| P0B2 Actuals & Dashboard | `TASK-0008` | KPI actuals reconciliation, adjustments, multi-layer dashboard overview | PR #15 (`a3222e30c2538f1d22ff94b1a74f9744468ffc0d`) |
| P0C Pipeline & P0 Alerts | `TASK-0009` | Prospect/Lead/Opportunity state machine & 6-rule in-app P0 alert engine | PR #16 (`cca6a4256034d5ab207cad8709f3ff2cbe1778ac`) |
| P0D Customer 360 & Drilldown | `TASK-0010` | Scoped synthetic `customer_references`, milestones, 360 view & drilldown | PR #17 (`27b97628384760e51c4f249782fe7fa5cfac5901`) |
| UAT & Hardening Handover | `TASK-0011` | Multi-role UAT E2E, least-privilege & latency tests, backup/restore, runbooks | PR #18 (`e82e2af5d17008c0384145c2a430d9cd922fda91`) |
| Audit Cleanup | `TASK-0012` | Unify `VALIDATION_FAILED` in `p0b1-service`, security headers & audit cleanup | PR #19 (`0535756868dd7cebfe8d7e336f38965ecba50b0d`) |
| Audit Hardening (Batch 1) | `TASK-0014` | `A-03` streaming body reader, `A-02` CSP/HSTS/COOP, `A-06` env parser, `A-08` CI/Dependabot | PR #21 (`d9d9e6fe88f5f710014627953d4aca72d181c1ea`) |
| Conformance & Handover Refresh | `TASK-0015` | Fix `H-01`, `H-02`, `M-01`, `M-04`, `L-01`, `L-02`, `L-03`, `M-07` + A5 audit + C1..C5 gates | PR #27 (`67005c162b8e6f1e6a6a71c2a8188a0e09d82c5b`, post-merge CI `43684697313`) |
| Lean Code Audit | `TASK-0017` | Remove dead code & consolidate duplicated helpers (`service-core`, `api-guard`, `validation`) | PR #29 (`92789091f7a763fa9c358cc28e61d130e7d1ef33`, post-merge CI `43687091274`) |
| Dashboard/Alerts/Nav Hardening | `TASK-0016` | `M-02` SQL scope pushdown, `M-05` alert escalation, `M-06` 5-group nav, interactive drill-down, `STAFF` block, CSS chart, read-only `/api/audit-events` | Branch `feat/TASK-0016-dashboard-alerts-nav-hardening` (pending PR merge) |

## 2. Security, RBAC & Data Integrity Verification Summary
- **Least-privilege DB role (`app_runtime_role`):** Verified `rolsuper = false`, `rolbypassrls = false`, `INSERT`-only on `audit_events`, `SELECT/INSERT`-only on `pipeline_stage_transitions`; live `DELETE FROM audit_events` rejected with SQLSTATE `42501`.
- **RBAC Separation (`CONFIG_ADMIN`) & 6-Role Browser Journeys (`C3`):** Verified all 6 synthetic roles (`syn.admin01`, `syn.exec01`, `syn.mgr.khcn`, `syn.staff.khcn`, `syn.mgr.khdn`, `syn.staff.dvkh`) across all 7 `/workspace/*` pages with `0` console errors, `0` page errors, `0` CSP violations, `0` server 5xx, and `401` post-logout.
- **Negative Security & Concurrency (`C4`):** Verified `403` on query/header role tampering, invalid `x-csrf-token`, cross-origin `Origin`; `422` on >16 KB body; `415` on non-JSON `Content-Type`; `404` on out-of-scope/missing customer; `401` on revoked session; `409` on stale `expected_version`.
- **API Latency (`C5`):** Measured warm response times across 7 core GET endpoints (`4.2ms`–`38.4ms` max, all `< 1000ms`).
- **Secret Scanning:** Gitleaks `8.30.1` full git history scan reports `0` leaks; `npm audit --audit-level=high` reports `0` High/Critical vulnerabilities.
- **Backup, Restore & Migration Rollback Drill (`C5`):** `pg_dump -Fc` → `pg_restore` on clone DB `branch_sales_restore_verify` verified 100% parity across all `27` public tables, `515` constraints, and `7002` `audit_events`. Isolated rollback/re-apply drill of `0008_p0d_customer360_and_milestones.sql` completed without touching live `branch_sales_devtest`.

## 3. Product Owner UAT Execution Checklist (DEVTEST Synthetic)
1. **Start DEVTEST environment:** Follow `docs/runbooks/DEVTEST-OPERATIONS-AND-BACKUP.md` (`npm run env:test:start && npm run db:migrate:up && npm run env:test:seed && npm run build && npm run start`).
2. **Verify `CONFIG_ADMIN` (`syn.admin01`):**
   - Sign in at `http://127.0.0.1:3100/auth/login`.
   - Confirm Org/Staff management works in `/workspace` and business modules (`/workspace/kpi-targets`, `/workspace/dashboard`, `/workspace/customers`) show RBAC denial.
3. **Verify `BRANCH_EXEC` (`syn.exec01`):**
   - Confirm full-branch read/review across all 5 modules (`/workspace/kpi-targets`, `/workspace/planning`, `/workspace/dashboard`, `/workspace/pipeline`, `/workspace/alerts`, `/workspace/customers`).
   - Verify drill-down (`BRANCH` → `DEPARTMENT` → `STAFF`) and Monday Review / Directive creation.
4. **Verify `DEPARTMENT_MANAGER` (`syn.mgr.khcn`) & `STAFF` (`syn.staff.khcn`):**
   - Confirm KHCN manager sees only KHCN department staff/targets/customers/alerts (never KHDN).
   - Confirm `syn.staff.khcn` sees only `SELF`-scoped records, can log activities, transition pipeline prospects/leads/opportunities, and add synthetic customer milestones.
5. **Sign-off:** Record UAT sign-off on GitHub Issue #8; keep `D-05` and `D-10` `OPEN` until production authorization.
