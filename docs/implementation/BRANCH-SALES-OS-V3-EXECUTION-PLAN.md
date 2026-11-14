# Branch Sales OS V3.0 — Execution and final handover plan

Status: OWNER-APPROVED FOR SYNTHETIC DEVTEST IMPLEMENTATION
Version: 1.0 | Date: 2026-11-14 (Asia/Ho_Chi_Minh)
Approval: [DEVTEST authorization](../decisions/SPRINT-1-BC-APPROVAL-2026-11-14.md)
Source of truth: [Issue #8](https://github.com/vannhan091289-ux/baocaobanhang/issues/8); [PRODUCT](../PRODUCT.md); [BUSINESS_RULES](../BUSINESS_RULES.md); [AGENTS](../../AGENTS.md); TASK-0004..TASK-0011

## Outcome and exclusion

Ship a reproducible, fully tested, role-scoped **synthetic DEVTEST MVP** covering five navigation groups and all seven KPI categories. Deliver real application code and reproducible test/handover evidence. Do not claim bank production readiness, import real customers/staff, connect Core Banking or enterprise SSO, provision paid infrastructure, or deploy without a further explicit decision. D-05/D-10 remain OPEN.

## Organization: one coordinator, builder agents and independent challengers

| Agent | File ownership / output |
|---|---|
| Coordinator | GitHub task state, dependency resolution, integration order, PR gates, checkpoint, release decision; never assert green without evidence |
| A0 Spec | Contracts, task-to-requirement trace, decision ledger, migration approval vs actual implementation; docs only |
| A1 DB | SQL migrations, synthetic fixtures, data integrity, DB ownership/role grants, reversible migration validation |
| A2 Backend/Auth | API endpoints/services, OIDC/session/RBAC, CSRF, audit and denial; exclude A1 SQL paths |
| A3 Frontend | Workspace screens, navigation, responsive UX and accessibility; exclude A1/A2 owned files |
| A4 Business Domain | KPI/targets, calendar/plans/actuals, leads/alerts/customer logic; coordinate contracts before touching shared modules |
| A5 QA (independent) | Standards review, Spec review, security adversarial and negative tests; cannot sign off own implementation |
| A6 CI/Handover | Deterministic CI, real PostgreSQL/Keycloak integration, Chromium journeys, synthetic backup/restore, runbooks and matrix |

Only parallelize non-overlapping ownership; serialize shared schema/API contracts and cross-module integration. Use available subagent tools only; if no subagent available, run independent review passes with distinct roles and disclose that they were not independent agents.

## Critical path and acceptance matrix

| Stage | Task | Deliverable | Hard prerequisite for START | Exit/acceptance evidence |
|---|---|---|---|---|
| 0 | TASK-0001..0003 | Sprint0 scaffold + S1-A OIDC/DB base | Previously ACCEPTED | Preserve existing regression gates; do not redo features |
| 1 | TASK-0004 | Org CRUD + Maker-Checker roles + approved migration 0003 | READY owner approval on main + synthetic Postgres/Keycloak preflight | AC-01..10, real DB constraints/atomic audit/revoke, CI/head review |
| 2 | TASK-0005 | Complete RBAC, temporal boundaries, concurrency & audit | TASK-0004 ACCEPTED and merged | AC-01..10, denial, IDOR, timing, race, E2E, independent review |
| 3 | TASK-0006 | P0A: 7 typed KPI definitions + targets/calendar | TASK-0005 ACCEPTED and merged | Approved DEVTEST formula versions, no STOCK temporal sum, test sample totals |
| 4 | TASK-0007 | P0B1: weekly/daily plans, activity logs & Monday review | TASK-0006 ACCEPTED and merged | One activity source, time/calendar, role-scoped workflow tests |
| 5 | TASK-0008 | P0B2: Actual reconciliation, attribution, dashboard drilldowns | TASK-0006 and TASK-0007 ACCEPTED and merged | NULL != 0, FLOW/STOCK, target vs actual, attribution sum=100%, scoped charts |
| 6 | TASK-0009 | P0C: Prospect/Lead/Opportunity and six in-app alerts | TASK-0007 and TASK-0008 ACCEPTED and merged | Lifecycle, duplicate prevention, configured thresholds, dedup and evidence-based closure |
| 7 | TASK-0010 | P0D: Synthetic Customer 360 and drilldown | TASK-0008 and TASK-0009 ACCEPTED and merged | Customer reference only, no PII, CONFIG_ADMIN deny, multi-level scoped navigation |
| 8 | TASK-0011 | Complete multi-role UAT/security/hardening/handover | TASK-0004..0010 all ACCEPTED and merged | Final 5-menu synthetic E2E, clean CI, negative tests, backup/restore, evidence matrix |

TASK-0004 is READY; TASK-0005..0011 remain REVIEWED with advance owner approval. Coordinator changes each subsequent task to READY only after prerequisites are ACCEPTED and merged; owner approval is not to be requested again for these DEVTEST tasks. Do not execute future task before its predecessors are ACCEPTED on main. If a prerequisite fails, repair it first while completing unrelated approved work.

## One-cycle execution loop — repeat until all gates green

1. Fetch origin/main, verify HEAD/clean working tree, read task, approval, ADRs and scope. Validate dependencies from GitHub, not stale messages. Work in a task-specific feature branch; never force push main.
2. Preflight local approved runtime, pinned Node/npm, PostgreSQL 18.7 and Keycloak 26.8.2, container ownership, synthetic test DB and secrets isolation. Verify no real data. If no environment, use approved CI and report exact absence rather than bypass.
3. Builder creates change plan (file owners, contracts, rollback, tests); add tests for positive, negative, boundary, concurrency, deny/audit, timezones and data quality before marking done.
4. Implement smallest vertical slice, preserve historical migrations 0001/0002; approved migration 0003 is additive with corrected TIMESTAMPTZ defaults and non-destructive rollback path.
5. Run clean install and documented scripts as applicable: format, lint, typecheck, unit, integration on real DB/IdP, build, Chromium E2E, security scans, diff-check. Record exact command/version/exit/URL/head SHA; never weaken test or CI to obtain green.
6. Independent A5 reviewers verify Standards and Spec separately, plus security/risk and out-of-scope modifications. Require zero Critical/High/P1/P2 outstanding. Fix defects and rerun impacted gates + regression; at most three identical ineffective repair attempts before changing diagnosis, NOT before exiting entire work.
7. Create Draft PR with evidence; mark ready only after required checks, reviewer separation and risk gates. Under the recorded owner delegation, merge using expected HEAD SHA and normal GitHub protections. Never self-approve, bypass CI or merge a failed PR.
8. Read back merged main and verify post-merge CI/functional checks. Only then update task ACCEPTED with proof, and move to the next dependency-unblocked task.
9. Continuously append concise checkpoint to Issue #8: DONE, IN_PROGRESS, NEXT, BLOCKED, task PR/head, main SHA, CI links, AC PASS/FAIL/NOT RUN, failing hypothesis, rollback, and resume command.

## Nonnegotiable technical tests

- Authorization matrix actor × action × resource × scope × effective_time, plus anonymous/unmapped/revoked, blind search/pagination, CSRF/origin, cross-branch/department and config-admin no-customer access.
- Maker-checker proposer != approver != target, atomic role change/session revocation and audit append-only, DB least privilege and concurrent-request serialization.
- PostgreSQL timestamps: CURRENT_TIMESTAMP on TIMESTAMPTZ, test UTC and Asia/Ho_Chi_Minh; never silently alter stored instants. Working week use half-open [Mon 00:00, next Mon 00:00) to avoid millisecond truncation.
- KPI: typed FLOW/STOCK/AVERAGE/NET_CHANGE; numeric decimal; do not sum stocks or ratios over time, distinct missing vs confirmed zero, no unapproved composite; provenance/version/as-of and audit.
- Synthetic only: dummy references; no PII fields, real bank data, logs with secrets or live external channels.
- Backup/restore on isolated synthetic copy, historical audit preservation and non-destructive migration/release rollback.

## DoD, stop rules and truthful final report

DEVTEST HANDOVER GO only when TASK-0004..0011 ACCEPTED with final main CI and full feature matrix PASS and no critical security/integrity gaps. For missing evidence, label NOT RUN and keep engineering state REWORK/IN_PROGRESS; continue diagnosing. For missing nondelegable privileges, licensing, services or environment, checkpoint BLOCKED with exact evidence and safe alternate path; never falsely report finished.

Final report: scope/feature matrix; tasks/PRs/commits/CI; verified tests and negative cases; migrations, sample data, setup, backup/restore, UAT script; residual advisories; production blockers D-05/D-10; installation and operating instructions.

## Short retrieval instruction

Antigravity: fetch main of vannhan091289-ux/baocaobanhang; read AGENTS.md, this plan, approval 2026-11-14, tasks/TASK-0004..0011 and Issue #8. Execute the READY synthetic DEVTEST tasks in dependency order, assign A0..A6 by non-overlapping ownership, code/test/review/fix until every AC passes, merge only under recorded gated delegation, log proof in Issue #8 and deliver full reproducible UAT handover. Never deploy production, ingest real data or auto-close D-05/D-10.
