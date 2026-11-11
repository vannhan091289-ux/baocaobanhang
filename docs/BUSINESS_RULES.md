# Business rules — thiếu quy tắc chuẩn thì dừng implementation

## KPI Dictionary
Mỗi metric thực tế cần: `metric_id`, tên/nhóm, đơn vị-tiền tệ, `metric_type` (FLOW/STOCK/AVERAGE/NET_CHANGE), công thức, quy tắc tổng hợp theo thời gian/nhân sự, attribution, nguồn, ngày chốt, kỳ, quy tắc điều chỉnh, version, effective date và phê duyệt. `Target` khác `Actual`. Actual có trạng thái `PROVISIONAL / RECONCILED / FINAL`.

### Cần xác nhận
- Cho vay: dư nợ, giải ngân hay tăng trưởng ròng?
- Huy động: cuối kỳ, bình quân hay tăng trưởng?
- Thẻ TD: phê duyệt, phát hành, kích hoạt?
- TTQT: doanh số, giá trị quy đổi hay phí? Tỷ giá nào?
- KHCN mới: điều kiện KH mới, chống trùng và attribution?
- Hộ kinh doanh: KH mới, sản phẩm vay hay tăng trưởng phân khúc?
- Bảo hiểm: phí khai thác, doanh thu ghi nhận hay số hợp đồng?

Không gán mặc định cho định nghĩa chưa được ngân hàng phê duyệt. Không cộng số dư hay tỷ lệ phần trăm theo ngày/tháng. Không làm composite score khi chưa có trọng số chính thức.

## Phân bổ và đối soát
Chỉ tiêu năm/tháng được giao và phê duyệt. Tuần/ngày là dự phóng kế hoạch có thể điều chỉnh, không âm thầm sửa chỉ tiêu mẹ. Phải định nghĩa ngày làm việc/ngày nghỉ, kỳ chốt, mẫu số 0, KPI âm, vượt mức, điều chỉnh truy hồi và bán chéo nhiều nhân sự. Lưu version/lịch sử điều chỉnh.

## Một nguồn hoạt động
Nhật ký hoạt động chứa người thực hiện, phòng, ngày giờ, đối tượng liên quan hợp lệ, trạng thái, kết quả, bước tiếp theo. Kế hoạch tuần và báo cáo thứ Hai tham chiếu hoạt động, không nhập lại Actual.

## Prospect / Lead / Opportunity / Customer
Prospect = KH tiềm năng; Lead = tín hiệu nhu cầu cần tiếp cận; Opportunity = cơ hội đủ điều kiện trong Pipeline; Customer = mã tham chiếu KH. Một KH có thể nhiều cơ hội. Cần trạng thái, transition hợp lệ, chống trùng, lịch sử chuyển giao và người phụ trách.

## Alert
Rule = trigger + phạm vi + recipient + mức độ + SLA theo lịch làm việc + khóa chống trùng + điều kiện tự đóng + escalation. Đã đọc khác đã xử lý; cảnh báo chỉ đóng khi có bằng chứng khắc phục hoặc lý do bỏ qua hợp lệ. Giai đoạn đầu chỉ In-app; tránh notification flood.

## Phê duyệt còn mở
Công thức KPI, attribution bán chéo, lịch chốt tuần, SLA/ngưỡng cảnh báo, thời gian lưu trữ, cây quyền phê duyệt, nguồn và quyền sử dụng dữ liệu KH.
