# Branch Sales OS — Báo cáo và quản trị bán hàng chi nhánh

**Trạng thái:** Planning baseline V3.0 — chưa triển khai mã ứng dụng.

Ứng dụng quản trị bán hàng tinh gọn cho ba phòng: Cá nhân, Doanh nghiệp, Dịch vụ KH. Quản trị bảy nhóm KPI, kế hoạch ngày/tuần, Lead, khách hàng tiềm năng, Customer 360 giới hạn, Dashboard đa tầng và cảnh báo trong ứng dụng.

## Phân công
- **Chủ dự án:** phê duyệt nghiệp vụ, kiến trúc quan trọng, hợp nhất và vận hành.
- **ChatGPT:** đặc tả nhiệm vụ, quản lý tài liệu và đánh giá bằng chứng.
- **Antigravity:** chỉ thực thi task READY trên nhánh riêng; kiểm thử và mở Draft PR.
- **GitHub:** nguồn sự thật cho tài liệu, nhiệm vụ, code và lịch sử thay đổi.

## Đọc theo thứ tự
1. [AGENTS.md](AGENTS.md) — quy tắc bắt buộc cho coding agent.
2. [docs/PRODUCT.md](docs/PRODUCT.md) — phạm vi và điều hướng sản phẩm.
3. [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) — quy tắc KPI, Lead, báo cáo, cảnh báo.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — đề xuất ranh giới module.
5. [docs/ENGINEERING.md](docs/ENGINEERING.md), [docs/SECURITY.md](docs/SECURITY.md) — tiêu chuẩn code và bảo mật.
6. [docs/WORKFLOW.md](docs/WORKFLOW.md), [tasks/TEMPLATE.md](tasks/TEMPLATE.md) — cách giao việc và nghiệm thu.
7. [docs/DECISIONS.md](docs/DECISIONS.md) — các quyết định còn mở.

**Nguyên tắc:** Chưa có READY task thì không coding. Chỉ dùng dữ liệu synthetic cho đến khi được phép sử dụng dữ liệu thật. Không AI, email/tin nhắn bên ngoài hoặc triển khai production trong MVP.
