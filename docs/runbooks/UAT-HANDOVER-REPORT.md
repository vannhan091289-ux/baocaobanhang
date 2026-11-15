# Branch Sales OS V3.0 — UAT & Final Handover Report (DEVTEST Synthetic)

- **Target Release:** Branch Sales OS V3.0 MVP (DEVTEST Synthetic)
- **Baseline:** `TASK-0001` through `TASK-0011` (`main` + `feat/TASK-0011-uat-hardening-handover`)
- **Open Decisions:** `D-05` (real CIF/PII integration) and `D-10` (production deploy / enterprise SSO) remain `OPEN`.
- **Owner UAT Status:** `READY FOR OWNER UAT` (Agent does not self-certify final owner UAT).

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
| UAT & Hardening Handover | `TASK-0011` | Multi-role UAT E2E, least-privilege & latency tests, backup/restore, runbooks | Pending PR on `feat/TASK-0011-uat-hardening-handover` (recorded in `tasks/evidence/TASK-0011-gates.txt`) |

## 2. Security, RBAC & Data Integrity Verification Summary
- **Least-privilege DB role (`app_runtime_role`):** Verified `rolsuper = false`, `rolbypassrls = false`, `INSERT`-only on `audit_events`, `SELECT/INSERT`-only on `pipeline_stage_transitions`; live `DELETE FROM audit_events` rejected with SQLSTATE `42501`.
- **RBAC Separation (`CONFIG_ADMIN`):** Verified `syn.admin01` receives `403` across KPI Targets, Sales Plans, Activity Logs, Dashboard Overview, Dashboard Drilldown, Pipeline, Alerts, and Customer 360.
- **Secret Scanning:** Gitleaks full git history scan reports `0` leaks.
- **Backup & Restore (`AC-04`):** `pg_dump -Fc` → `pg_restore` on clone DB `branch_sales_restore_verify` verified 100% parity across all `27` public tables and `515` constraints.

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
