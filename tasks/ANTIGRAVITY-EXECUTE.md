# Antigravity — Execute to synthetic DEVTEST handover

Approved: [Owner decision](../docs/decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md). Plan: [Execution plan](../docs/implementation/BRANCH-SALES-OS-V3-EXECUTION-PLAN.md). Coordinator: [Issue #8](https://github.com/vannhan091289-ux/baocaobanhang/issues/8).

## One-line order

> Fetch `main` of `vannhan091289-ux/baocaobanhang`; read `AGENTS.md`, approval, execution plan, Issue #8, TASK-0004..0011; assign A0..A6 with separated file ownership and independent A5 reviews. Start TASK-0004 READY, then automatically activate each downstream task only after predecessors are ACCEPTED on main. Implement, run real PostgreSQL/Keycloak/unit/Chromium E2E/security/backup-restore tests, fix regressions, push Draft PRs, merge only when the exact-head CI and independent review pass under owner DEVTEST delegation; checkpoint Issue #8 after each slice. Repeat to full synthetic MVP handover; keep D-05/D-10 OPEN; no production or real data.

## Execution contract

1. The approval branch/PR MUST be merged into main first. Do not use stale TASK status from earlier SHA. Verify `TASK-0004` is `READY` on origin/main.
2. `TASK-0005`..`TASK-0011`: `REVIEWED` with advance owner approval, switch to `READY` only after prerequisites are independently reviewed, merged and `ACCEPTED`. Coordinator may change task state under pre-approval without stopping to ask owner again.
3. Preserve task specs, ADR-002 default-deny maker-checker scope, S1-A migration history, timestamp correctness, and synthetic-only rules. Dependency/cost/credential/hosting changes outside approval remain blocked.
4. No skipping CI/test cases, no fake PASS and no success claim without actual artifacts. After three ineffective attempts of same failing hypothesis change diagnosis while continuing other authorized tasks. Checkpoint before context/session ends; resume from latest SHA.
5. Final artifact: application code in main plus feature-to-task-to-test/PR/SHA/CI matrix, setup, synthetic fixtures, user journeys, rollback, backup/restore, security findings and UAT handover. No human-UAT or production certification is implied.
