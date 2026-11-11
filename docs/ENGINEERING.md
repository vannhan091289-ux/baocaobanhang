# Engineering standard — small, clear, verified

## Trước khi code
Đọc task READY và tài liệu liên quan; kiểm tra code/test hiện hữu; viết change plan ngắn gồm file, edge cases, tác động quyền/dữ liệu, test và rollback. Thiếu quy tắc quan trọng thì BLOCKED.

## Quy tắc
- Một trách nhiệm rõ cho module/hàm; tên theo nghiệp vụ ngân hàng; code trực tiếp, dễ hiểu trước tối ưu.
- Tái sử dụng thư viện sẵn có; chỉ thêm dependency khi chứng minh cần và được duyệt.
- Không tự sinh abstraction, framework, helper, bảng hay API cho tính năng giả định.
- Không giới hạn số dòng máy móc; tách file lớn khi tăng độ hiểu/kiểm thử. Tránh duplication và unrelated refactor.
- Không đổi contract công khai, schema, hạ tầng, auth ngoài phạm vi task.
- Types nghiêm ngặt ở biên, validation theo schema, tiền bằng decimal phù hợp, timezone/cut-off minh bạch; phép tính KPI deterministic.
- Backend authorization; error rõ nhưng không rò rỉ PII/secrets. Fixture synthetic.

## Test & Definition of Done
Viết ví dụ đầu vào/đầu ra trước cho KPI, state transitions và quyền truy cập. Unit: tính toán. Integration: database/API và deny cases. E2E: hành trình vai trò. Kiểm tra positive, negative, edge cases.

Chạy các script thực có trong repository: build, typecheck, lint, tests, security scan, diff review. Ghi chính xác lệnh + PASS/FAIL/NOT RUN; không tự nhận coverage khi chưa đo. Task chỉ hoàn thành khi acceptance criteria đạt, không còn lỗi critical về dữ liệu/bảo mật, thay đổi và rollback được giải thích trong Draft PR. Local PASS không đồng nghĩa production accepted.
