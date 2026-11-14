# Branch Sales OS V3.0 — DEVTEST Operations, Setup & Backup/Restore Runbook

- **Environment scope:** `DEVTEST Synthetic Only` (Colima ARM64 + Docker Compose + PostgreSQL 18.7 + Keycloak 26.8.2 + Next.js App)
- **Open policy decisions:** `D-05` (real CIF/PII integration), `D-10` (enterprise SSO & production deploy) remain `OPEN`. Never run against production data or real customer/staff PII.

## 1. Prerequisites & Toolchain
- macOS ARM64 (`aarch64`) with Homebrew, Colima (`profile=baocaobanhang`, context `colima-baocaobanhang`), Docker CLI + Compose, Node.js `v24.x`, `gitleaks`.
- Ensure Docker context is active:
  ```bash
  export DOCKER_CONTEXT=colima-baocaobanhang
  ```

## 2. Clean Setup & Startup (DEVTEST Synthetic)
1. Install dependencies:
   ```bash
   npm ci
   ```
2. Start PostgreSQL 18.7 (`127.0.0.1:55432`) and Keycloak 26.8.2 (`127.0.0.1:8080`), apply migrations `0001`–`0008`, and seed synthetic accounts & baseline data:
   ```bash
   npm run env:test:up
   npm run env:test:migrate
   npm run env:test:seed
   ```
3. Start the application (dev or production build):
   ```bash
   npm run build
   npm run start
   ```
   Application URL: `http://127.0.0.1:3100` (Keycloak OIDC login redirects to `http://127.0.0.1:8080/realms/branch-sales-dev`).

## 3. Synthetic Test Accounts (`DEVTEST`)
Password is read from `.env.devtest` / `DEVTEST_SYNTHETIC_PASSWORD` (never committed).
- `syn.admin01` — `CONFIG_ADMIN` (`BRANCH` org admin only; 403 on all business/KPI/CRM routes)
- `syn.exec01` — `BRANCH_EXEC` (`BRANCH` read/approve/dashboard/drilldown/alerts)
- `syn.mgr.khcn` — `DEPARTMENT_MANAGER` (`DEPARTMENT`: KHCN)
- `syn.staff.khcn` — `STAFF` (`SELF`: KHCN)
- `syn.multirole` — Multi-role synthetic user (`STAFF` + `DEPARTMENT_MANAGER`)
- `syn.zerorole` — Zero-role synthetic user (restricted until Maker-Checker role grant)

## 4. Quality & Security Verification Commands
```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run env:test:seed && npm run test:e2e
npm run security
git diff --check
```

## 5. Backup & Restore Procedure (`pg_dump` / `pg_restore`)
Verified on PostgreSQL 18.7 (`baocaobanhang-s1a-postgres`, database `branch_sales_devtest`, 27 public tables, 515 public constraints):

### 5.1 Backup (Custom Format)
```bash
export DOCKER_CONTEXT=colima-baocaobanhang
docker exec baocaobanhang-s1a-postgres \
  pg_dump -U postgres -Fc -d branch_sales_devtest -f /tmp/branch_sales_devtest_backup.dump
docker cp baocaobanhang-s1a-postgres:/tmp/branch_sales_devtest_backup.dump ./branch_sales_devtest_backup.dump
```

### 5.2 Restore & Integrity Verification (Clone DB)
```bash
export DOCKER_CONTEXT=colima-baocaobanhang
docker cp ./branch_sales_devtest_backup.dump baocaobanhang-s1a-postgres:/tmp/branch_sales_devtest_backup.dump
docker exec baocaobanhang-s1a-postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS branch_sales_restore_verify;"
docker exec baocaobanhang-s1a-postgres psql -U postgres -d postgres -c "CREATE DATABASE branch_sales_restore_verify;"
docker exec baocaobanhang-s1a-postgres \
  pg_restore -U postgres -d branch_sales_restore_verify --no-owner --role=postgres /tmp/branch_sales_devtest_backup.dump
```
Verify parity of table count (`27`), constraint count (`515`), `audit_events`, `role_assignments`, `kpi_targets`, `kpi_target_revisions`, `sales_plans`, `activity_logs`, `pipeline_stage_transitions`, `customer_references`, and `customer_milestones` before switching or promoting.

## 6. Rollback / Roll-Forward Notes
- Database migrations `0001`–`0008` are additive and forward-only in DEVTEST.
- To revert an application change safely: revert the merge commit on `main` (`git revert -m 1 <merge_sha>`) or re-seed DEVTEST synthetic state from a verified `.dump` backup.
- `app_runtime_role` has least-privilege (`INSERT`-only on `audit_events`, `SELECT, INSERT` on `pipeline_stage_transitions`; no `SUPERUSER`, no `BYPASSRLS`, no `DELETE`/`TRUNCATE`).
