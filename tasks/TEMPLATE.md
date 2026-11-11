# TASK-XXXX — [Tóm tắt chức năng]

Status: DRAFT
Owner: Antigravity (khi READY)
Approved by: [chủ dự án; để trống trước phê duyệt]
Branch: feat/TASK-XXXX-short-name
Depends on: [none / TASK-...]
Priority: P0/P1/P2

## Goal
Một kết quả nghiệp vụ cụ thể, có thể nghiệm thu độc lập.

## In scope
- ...

## Out of scope
- ...

## References
- AGENTS.md
- docs/PRODUCT.md
- docs/BUSINESS_RULES.md [mục liên quan]
- docs/ARCHITECTURE.md
- docs/ENGINEERING.md
- docs/SECURITY.md

## Inputs / data
Chỉ synthetic. Nêu định nghĩa KPI, role scope và fixtures cần dùng.

## Implementation steps
1. Kiểm tra mã/test hiện có và lên change plan.
2. Thực hiện thay đổi nhỏ nhất và bổ sung test.
3. Chạy các kiểm tra liên quan, review diff.
4. Push branch, Draft PR nếu task cho phép.

## Acceptance criteria
- [ ] Điều kiện nghiệp vụ xác minh được #1
- [ ] Điều kiện nghiệp vụ xác minh được #2
- [ ] Permission denial và edge case phù hợp được kiểm thử
- [ ] Không có lỗi dữ liệu/bảo mật mức Critical/High chưa xử lý
- [ ] PR ghi lệnh kiểm tra, kết quả, giới hạn và rollback

## Evidence
Commands + PASS/FAIL/NOT RUN; screenshots chỉ dùng dữ liệu synthetic.

## Stop / escalation
Thiếu quy tắc/chính sách/quyền quan trọng: BLOCKED; không tự diễn giải thành quyền cho phép.
