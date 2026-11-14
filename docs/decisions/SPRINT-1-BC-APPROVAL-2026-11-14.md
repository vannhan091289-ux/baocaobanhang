# Owner approval — Branch Sales OS V3.0 synthetic DEVTEST

Status: ACCEPTED (DEVTEST ONLY)
Decision date: 2026-11-14 (Asia/Ho_Chi_Minh)
Approver: Product owner, explicit instruction in ChatGPT conversation dated 2026-11-14
Scope: repository vannhan091289-ux/baocaobanhang; S1-B/S1-C and P0A..P0D, synthetic UAT, no production
Approved proposal: [SPRINT-1-BC-PROPOSAL.md v0.2](SPRINT-1-BC-PROPOSAL.md), baseline main eae0b0deec919f90f7498c28bc8bdc1f13efc1bd
Coordination: [Implementation plan](../implementation/BRANCH-SALES-OS-V3-EXECUTION-PLAN.md), [Issue #8](https://github.com/vannhan091289-ux/baocaobanhang/issues/8)

## Owner decision — instruction received

Chủ dự án phê duyệt gói SPRINT-1-BC-PROPOSAL.md phiên bản 0.2 cho môi trường DEVTEST synthetic, bao gồm migration 0003, S1-B/S1-C và các phương án A cho KPI, lịch làm việc, attribution, cảnh báo, Customer 360; giữ D-05/D-10 chưa phê duyệt. Cho phép lập kế hoạch, triển khai các bước còn lại, điều phối Antigravity tự động sửa lỗi, khắc phục bảo mật và hoàn tất ứng dụng trong phạm vi đã phê duyệt.

## Accepted decisions, explicitly versioned

| ID | Decision | Exact scope |
|---|---|---|
| D-08, D-09, ADR-002 v0.3 | Extend existing S1-A DEVTEST decisions to S1-B and S1-C organization, authorization, session and audit | ACCEPTED synthetic DEVTEST only |
| Migration 0003 | Authorize additive 0003_s1b_org_and_role_workflow.sql per proposal v0.2, including correcting TIMESTAMPTZ defaults from applied 0001 through a new migration | ACCEPTED on isolated synthetic databases, preview/backup/non-destructive rollback required |
| D-01, ADR-003 v1.0 | Option A seven KPI groups and typed metrics, configured formulas and strict temporal aggregation/missing-data rules | ACCEPTED synthetic DEVTEST, NOT official bank KPI |
| D-02 | Option A per-metric configurable cross-sell allocation, weights total 100%, no branch double counting | ACCEPTED synthetic DEVTEST |
| D-03 | Option A Asia/Ho_Chi_Minh work calendar, Mon–Fri except configured holidays, Monday weekly review | ACCEPTED synthetic DEVTEST |
| D-04, ADR-004 v1.0 | Option A six configurable in-app alert rules and initial synthetic thresholds; dedup, resolution evidence, business-calendar SLA | ACCEPTED synthetic DEVTEST, NOT operational bank SLA |
| D-07 | Do not compute a branch composite score; show seven KPI groups separately | ACCEPTED synthetic DEVTEST |
| ADR-005 v1.0 | Option A limited synthetic customer references and role-scoped Customer 360 | ACCEPTED synthetic DEVTEST |
| D-05 | Real customer/staff data classification, hosting/region, retention, backup policy, bank approval | OPEN; NO access, migration or production pilot |
| D-10 | Enterprise IdP, bank MFA, operational SSO and release | OPEN; NO enterprise SSO/production activation |

## Delegation for implementation

1. Owner authorizes TASK-0004..TASK-0011 for **synthetic DEVTEST only** using task scope and acceptance criteria already in the repository; TASK-0004 is actionable immediately after this approval reaches main. The remaining tasks are pre-approved but may start **only after all Depends on tasks are ACCEPTED** and the associated prior slice is merged and verified. These are advance owner approvals, not independently created approvals by an agent.
2. Antigravity may create task branches, write/refine implementation and tests, fix defects and security findings, update execution status, run synthetic migrations and restore tests, push and open PRs; no need to ask again for ordinary in-scope remediation. Do not add an unapproved business rule, third-party dependency with material risk/cost, external service, or destructive migration.
3. Owner delegates DEVTEST-only *technical PR merging* for TASK-0004..0011 to Antigravity **only if** a distinct reviewer agent independently reviews Standards, Spec and security, all actual required CI/test gates pass at the exact head SHA, zero Critical/High/P1/P2 findings remain, PR is not draft and GitHub branch protections allow the merge. Use an expected-head SHA, do not bypass protection, do not auto-approve own PR. If review controls cannot be met, leave PR open and checkpoint.
4. After every merge, verify main and all affected gates. Update the task acceptance ledger and Issue #8 with real evidence. An agent may record task ACCEPTED only on complete AC evidence and independent review; a manual human UAT sign-off is still required before calling it a user-approved release.
5. Continue through all tasks and retry justified engineering fixes; checkpoint and resume after context/session limits. No claim of an always-on remote runner, no silent background job guarantee. A true authority/environment blocker must be identified exactly, not bypassed.

## Hard boundaries and acceptance

- Synthetic fixtures only; no customer PII, credentials, account numbers or real bank data in repository, prompts or CI artifacts.
- No production deployment, hosting procurement, public release, privilege escalation, destructive reset, unapproved integration or modification of other repositories.
- Isolation, default-deny RBAC, maker-checker, no self-approval, restricted customer data, atomic audit, and S1-A regressions are non-negotiable.
- Devtest code completion is only certified by passing the full 5-menu product feature matrix, S1-B/C RBAC, seven KPI groups, Unit/Integration PostgreSQL+Keycloak/Chromium E2E, security, backup/restore and traceable evidence on the final merged main SHA.
- Retained human gate: organizational hosting/real data/enterprise SSO (D-05/D-10) and final production approval. DEVTEST readiness is not production readiness.

Approval source is the owner's direct request in this chat; this record does not create or represent an internal bank policy.
