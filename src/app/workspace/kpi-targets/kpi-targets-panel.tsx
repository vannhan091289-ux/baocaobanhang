"use client";

import React, { useCallback, useEffect, useState } from "react";

interface KpiDefinitionItem {
  id: string;
  metric_code: string;
  metric_name: string;
  group_code: string;
  unit_code: string;
  currency_code: string | null;
  metric_type: string;
  time_aggregation_rule: string;
  staff_aggregation_rule: string;
  attribution_mode: string;
  primary_weight: string;
  referrer_weight: string;
  formula_expression: string;
  version: number;
  status: "ACTIVE" | "INACTIVE";
  approval_reference: string;
  row_version: number;
}

interface CalendarDayItem {
  calendar_date: string;
  is_working_day: boolean;
  holiday_name: string | null;
  weekly_cutoff_day: string;
  daily_report_cutoff_time: string;
  row_version: number;
}

interface CalendarSummary {
  total_days: number;
  working_days_count: number;
  non_working_days_count: number;
  timezone: string;
  weekly_cutoff_day: string;
  daily_report_cutoff_time: string;
}

interface KpiTargetRevisionItem {
  id: string;
  revision_no: number;
  previous_target_value: string | null;
  new_target_value: string;
  previous_status: string | null;
  new_status: string;
  change_reason: string;
  changed_by_staff_id: string;
  approved_by_staff_id: string | null;
  created_at: string;
}

interface KpiTargetItem {
  id: string;
  kpi_definition_id: string;
  metric_code: string;
  metric_name: string;
  group_code: string;
  unit_code: string;
  metric_type: string;
  period_type: "YEAR" | "MONTH" | "WEEK" | "DAY";
  period_key: string;
  scope_type: "BRANCH" | "DEPARTMENT" | "SELF";
  department_id: string | null;
  staff_id: string | null;
  parent_target_id: string | null;
  target_value: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SUPERSEDED";
  revision_no: number;
  proposed_by_staff_id: string;
  approved_by_staff_id: string | null;
  approval_reference: string | null;
  notes: string | null;
  row_version: number;
  revisions: KpiTargetRevisionItem[];
}

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

interface StaffOption {
  id: string;
  staff_code: string;
  display_name: string;
  department_id: string;
}

export interface KpiTargetsPanelProps {
  csrfToken: string;
  actorStaffId: string;
  actorDepartmentId: string;
  actorRoleCode: "EXECUTIVE" | "CONFIG_ADMIN" | "DEPARTMENT_MANAGER" | "STAFF";
  actorScopeType: "BRANCH" | "DEPARTMENT" | "SELF";
}

export function KpiTargetsPanel({
  csrfToken,
  actorStaffId,
  actorDepartmentId,
  actorRoleCode,
}: KpiTargetsPanelProps) {
  const [definitions, setDefinitions] = useState<KpiDefinitionItem[]>([]);
  const [calendarDays, setCalendarDays] = useState<CalendarDayItem[]>([]);
  const [calendarSummary, setCalendarSummary] =
    useState<CalendarSummary | null>(null);
  const [targets, setTargets] = useState<KpiTargetItem[]>([]);
  const [targetsDeniedReason, setTargetsDeniedReason] = useState<string | null>(
    null,
  );
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Filter states
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [periodTypeFilter, setPeriodTypeFilter] = useState<string>("");

  // Create KPI Definition form state (CONFIG_ADMIN)
  const [defCode, setDefCode] = useState("");
  const [defName, setDefName] = useState("");
  const [defGroup, setDefGroup] = useState("LOAN");
  const [defUnit, setDefUnit] = useState("VND");
  const [defMetricType, setDefMetricType] = useState("FLOW");
  const [defTimeAgg, setDefTimeAgg] = useState("SUM");
  const [defFormula, setDefFormula] = useState("SUM(synthetic_metric_value)");
  const [defApprovalRef, setDefApprovalRef] = useState(
    "ADR-003-SYNTHETIC-CONFIG",
  );

  // Calendar update form state (CONFIG_ADMIN)
  const [calDate, setCalDate] = useState("2026-11-20");
  const [calWorking, setCalWorking] = useState(false);
  const [calHoliday, setCalHoliday] = useState("Ngày lễ Synthetic");

  // Create KPI Target form state (EXECUTIVE / DEPARTMENT_MANAGER / STAFF)
  const [targetDefId, setTargetDefId] = useState("");
  const [targetPeriodType, setTargetPeriodType] = useState<
    "YEAR" | "MONTH" | "WEEK" | "DAY"
  >(actorRoleCode === "STAFF" ? "WEEK" : "MONTH");
  const [targetPeriodKey, setTargetPeriodKey] = useState(
    actorRoleCode === "STAFF" ? "2026-W46" : "2026-11",
  );
  const [targetScopeType, setTargetScopeType] = useState<
    "BRANCH" | "DEPARTMENT" | "SELF"
  >(
    actorRoleCode === "EXECUTIVE"
      ? "DEPARTMENT"
      : actorRoleCode === "DEPARTMENT_MANAGER"
        ? "SELF"
        : "SELF",
  );
  const [targetDeptId, setTargetDeptId] = useState(actorDepartmentId);
  const [targetStaffId, setTargetStaffId] = useState(actorStaffId);
  const [targetParentId, setTargetParentId] = useState("");
  const [targetValue, setTargetValue] = useState("1000000.00");
  const [targetApprovalRef, setTargetApprovalRef] = useState(
    "TARGET-APPROVAL-2026-11",
  );
  const [targetNotes, setTargetNotes] = useState(
    "Giao chỉ tiêu synthetic kỳ 2026-11",
  );

  const fetchAllData = useCallback(async () => {
    const defParams = new URLSearchParams({ limit: "50" });
    if (groupFilter) defParams.set("group_code", groupFilter);

    const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
    const [defRes, calRes, deptRes, staffRes, targetRes] = await Promise.all([
      fetch(`/api/kpi/definitions?${defParams.toString()}`, {
        cache: "no-store",
      }),
      fetch("/api/kpi/calendar?from=2026-11-01&to=2026-11-30&limit=50", {
        cache: "no-store",
      }),
      fetch("/api/org/departments?limit=50", { cache: "no-store" }),
      fetch("/api/org/staff?limit=50", { cache: "no-store" }),
      isConfigAdmin
        ? Promise.resolve(null)
        : fetch(
            `/api/kpi/targets?limit=50${periodTypeFilter ? `&period_type=${encodeURIComponent(periodTypeFilter)}` : ""}`,
            { cache: "no-store" },
          ),
    ]);

    if (defRes.ok) {
      const dJson = (await defRes.json()) as { data?: KpiDefinitionItem[] };
      const items = dJson.data ?? [];
      setDefinitions(items);
      if (items.length > 0) {
        setTargetDefId((prev) => prev || items[0]!.id);
      }
    }
    if (calRes.ok) {
      const cJson = (await calRes.json()) as {
        data?: {
          items: CalendarDayItem[];
          summary: CalendarSummary;
        };
      };
      setCalendarDays(cJson.data?.items ?? []);
      setCalendarSummary(cJson.data?.summary ?? null);
    }
    if (deptRes.ok) {
      const dpJson = (await deptRes.json()) as { data?: DepartmentOption[] };
      setDepartments(dpJson.data ?? []);
    }
    if (staffRes.ok) {
      const stJson = (await staffRes.json()) as { data?: StaffOption[] };
      setStaffList(stJson.data ?? []);
    }

    if (isConfigAdmin || targetRes === null) {
      setTargets([]);
      setTargetsDeniedReason("CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN");
    } else if (targetRes.ok) {
      const tJson = (await targetRes.json()) as { data?: KpiTargetItem[] };
      setTargets(tJson.data ?? []);
      setTargetsDeniedReason(null);
    } else {
      const errJson = (await targetRes.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      setTargets([]);
      setTargetsDeniedReason(errJson.error?.code ?? `HTTP_${targetRes.status}`);
    }
  }, [actorRoleCode, groupFilter, periodTypeFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await fetchAllData();
    } catch (err) {
      setBanner({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Lỗi kết nối khi tải dữ liệu P0A.",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchAllData]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleCreateDefinition(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const res = await fetch("/api/kpi/definitions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        metric_code: defCode.trim(),
        metric_name: defName.trim(),
        group_code: defGroup,
        unit_code: defUnit,
        currency_code: defUnit === "VND" || defUnit === "USD" ? defUnit : null,
        metric_type: defMetricType,
        time_aggregation_rule: defTimeAgg,
        staff_aggregation_rule: "SUM",
        attribution_mode: "PRIMARY_ONLY",
        primary_weight: 1.0,
        referrer_weight: 0.0,
        formula_expression: defFormula.trim(),
        governance_ref: defApprovalRef.trim(),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể tạo KPI definition"}`,
      });
      return;
    }
    setDefCode("");
    setDefName("");
    setBanner({
      type: "success",
      text: "Đã tạo định nghĩa chỉ số KPI mới thành công.",
    });
    await loadData();
  }

  async function handleUpdateCalendarDay(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const existing = calendarDays.find((c) => c.calendar_date === calDate);
    const res = await fetch("/api/kpi/calendar", {
      method: existing ? "PATCH" : "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        calendar_date: calDate,
        is_working_day: calWorking,
        holiday_name: calWorking ? null : calHoliday.trim() || null,
        ...(existing ? { expected_version: existing.row_version } : {}),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể cập nhật lịch làm việc"}`,
      });
      return;
    }
    setBanner({
      type: "success",
      text: `Đã cập nhật lịch ngày ${calDate} thành công.`,
    });
    await loadData();
  }

  async function handleCreateTarget(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const res = await fetch("/api/kpi/targets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        kpi_definition_id: targetDefId,
        period_type: targetPeriodType,
        period_key: targetPeriodKey.trim(),
        target_scope: targetScopeType,
        department_id:
          targetScopeType === "BRANCH" ? null : targetDeptId || null,
        staff_id: targetScopeType === "SELF" ? targetStaffId || null : null,
        parent_target_id: targetParentId.trim() || null,
        target_value: targetValue.trim(),
        governance_ref: targetApprovalRef.trim() || undefined,
        notes: targetNotes.trim() || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể giao chỉ tiêu KPI"}`,
      });
      return;
    }
    setBanner({
      type: "success",
      text: "Đã lưu phân bổ chỉ tiêu KPI thành công.",
    });
    await loadData();
  }

  async function handleApproveTarget(t: KpiTargetItem) {
    setBanner(null);
    const res = await fetch(`/api/kpi/targets/${t.id}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        expected_version: t.row_version,
        governance_ref: `EXEC-APPROVE-${t.period_key}`,
        decision_reason: `Phê duyệt chính thức chỉ tiêu ${t.metric_code} kỳ ${t.period_key}`,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể phê duyệt chỉ tiêu"}`,
      });
      return;
    }
    setBanner({
      type: "success",
      text: `Đã phê duyệt chỉ tiêu ${t.metric_code} (${t.period_key}).`,
    });
    await loadData();
  }

  return (
    <div className="org-panel-wrapper" data-testid="kpi-targets-panel">
      {banner && (
        <div
          role="status"
          data-testid="kpi-targets-banner"
          className={`scaffold-status ${banner.type === "error" ? "banner-error" : "banner-success"}`}
        >
          <p>{banner.text}</p>
        </div>
      )}

      {/* 1. 7-Group KPI Dictionary Section */}
      <section
        className="scaffold-status"
        aria-labelledby="kpi-dictionary-heading"
      >
        <h2 id="kpi-dictionary-heading">
          1. Từ điển 7 Nhóm KPI chuẩn hóa (D-01 &amp; ADR-003)
        </h2>
        <p>
          Toàn bộ chỉ số tiền tệ sử dụng kiểu <code>NUMERIC(20, 2)</code> chính
          xác; các chỉ số số dư cuối kỳ (<code>STOCK</code>) bị khóa cứng không
          được cộng dồn (<code>SUM</code>) qua thời gian.
        </p>

        <div className="filter-row">
          <label htmlFor="kpi-group-filter">Lọc theo nhóm KPI: </label>
          <select
            id="kpi-group-filter"
            data-testid="kpi-group-filter"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="">Tất cả 7 nhóm KPI</option>
            <option value="LOAN">1. Dư nợ &amp; Giải ngân (LOAN)</option>
            <option value="DEPOSIT">2. Huy động vốn (DEPOSIT)</option>
            <option value="CARD">3. Thẻ tín dụng (CARD)</option>
            <option value="TTQT">4. Thanh toán quốc tế (TTQT)</option>
            <option value="NEW_RETAIL_CIF">
              5. KHCN mở mới (NEW_RETAIL_CIF)
            </option>
            <option value="BIZ_HOUSEHOLD">
              6. Hộ kinh doanh (BIZ_HOUSEHOLD)
            </option>
            <option value="INSURANCE">7. Bảo hiểm (INSURANCE)</option>
          </select>
        </div>

        {loading ? (
          <p data-testid="kpi-definitions-loading">
            Đang tải từ điển 7 nhóm KPI...
          </p>
        ) : definitions.length === 0 ? (
          <p data-testid="kpi-definitions-empty">
            Không có định nghĩa KPI nào khớp bộ lọc.
          </p>
        ) : (
          <div className="table-scroll">
            <table
              className="data-table"
              data-testid="kpi-definitions-table"
              aria-label="Bảng từ điển 7 nhóm KPI"
            >
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th>Mã KPI</th>
                  <th>Tên chỉ số</th>
                  <th>Đơn vị</th>
                  <th>Kiểu chỉ số</th>
                  <th>Gộp thời gian</th>
                  <th>Gộp nhân sự / Attribution</th>
                  <th>Công thức chuẩn</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((d) => (
                  <tr key={d.id} data-testid={`kpi-def-row-${d.metric_code}`}>
                    <td>
                      <code>{d.group_code}</code>
                    </td>
                    <td>
                      <code>{d.metric_code}</code>
                    </td>
                    <td>{d.metric_name}</td>
                    <td>{d.unit_code}</td>
                    <td>
                      <code>{d.metric_type}</code>
                    </td>
                    <td>
                      <code>{d.time_aggregation_rule}</code>
                    </td>
                    <td>
                      <code>
                        {d.staff_aggregation_rule} ({d.attribution_mode}:{" "}
                        {d.primary_weight}/{d.referrer_weight})
                      </code>
                    </td>
                    <td>
                      <code>{d.formula_expression}</code>
                    </td>
                    <td>v{d.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {actorRoleCode === "CONFIG_ADMIN" && (
          <form
            onSubmit={handleCreateDefinition}
            className="inline-form"
            data-testid="create-kpi-definition-form"
            aria-label="Biểu mẫu thêm chỉ số KPI (CONFIG_ADMIN)"
          >
            <h3>Thêm định nghĩa chỉ số KPI mới (CONFIG_ADMIN)</h3>
            <div className="form-grid">
              <label>
                Mã KPI
                <input
                  type="text"
                  required
                  data-testid="input-kpi-code"
                  value={defCode}
                  onChange={(e) => setDefCode(e.target.value)}
                  placeholder="VD: LOAN_SME_NEW"
                />
              </label>
              <label>
                Tên hiển thị
                <input
                  type="text"
                  required
                  data-testid="input-kpi-name"
                  value={defName}
                  onChange={(e) => setDefName(e.target.value)}
                  placeholder="Tên chỉ số KPI (Synthetic)"
                />
              </label>
              <label>
                Nhóm KPI
                <select
                  data-testid="select-kpi-group"
                  value={defGroup}
                  onChange={(e) => setDefGroup(e.target.value)}
                >
                  <option value="LOAN">LOAN</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="CARD">CARD</option>
                  <option value="TTQT">TTQT</option>
                  <option value="NEW_RETAIL_CIF">NEW_RETAIL_CIF</option>
                  <option value="BIZ_HOUSEHOLD">BIZ_HOUSEHOLD</option>
                  <option value="INSURANCE">INSURANCE</option>
                </select>
              </label>
              <label>
                Đơn vị
                <select
                  data-testid="select-kpi-unit"
                  value={defUnit}
                  onChange={(e) => setDefUnit(e.target.value)}
                >
                  <option value="VND">VND</option>
                  <option value="USD">USD</option>
                  <option value="CARD">CARD</option>
                  <option value="CUSTOMER">CUSTOMER</option>
                  <option value="CONTRACT">CONTRACT</option>
                </select>
              </label>
              <label>
                Kiểu chỉ số (Metric Type)
                <select
                  data-testid="select-kpi-metric-type"
                  value={defMetricType}
                  onChange={(e) => setDefMetricType(e.target.value)}
                >
                  <option value="FLOW">FLOW</option>
                  <option value="STOCK">STOCK</option>
                  <option value="AVERAGE">AVERAGE</option>
                  <option value="NET_CHANGE">NET_CHANGE</option>
                </select>
              </label>
              <label>
                Quy tắc gộp thời gian
                <select
                  data-testid="select-kpi-time-agg"
                  value={defTimeAgg}
                  onChange={(e) => setDefTimeAgg(e.target.value)}
                >
                  <option value="SUM">SUM</option>
                  <option value="END_OF_PERIOD">END_OF_PERIOD</option>
                  <option value="AVERAGE">AVERAGE</option>
                  <option value="NET_DELTA">NET_DELTA</option>
                </select>
              </label>
              <label>
                Công thức chuẩn
                <input
                  type="text"
                  required
                  data-testid="input-kpi-formula"
                  value={defFormula}
                  onChange={(e) => setDefFormula(e.target.value)}
                />
              </label>
              <label>
                Mã phê duyệt
                <input
                  type="text"
                  required
                  data-testid="input-kpi-approval-ref"
                  value={defApprovalRef}
                  onChange={(e) => setDefApprovalRef(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="scaffold-button"
              data-testid="submit-create-kpi-def"
            >
              Lưu định nghĩa KPI
            </button>
          </form>
        )}
      </section>

      {/* 2. Branch Working Calendar Section */}
      <section
        className="scaffold-status"
        aria-labelledby="working-calendar-heading"
      >
        <h2 id="working-calendar-heading">
          2. Lịch Ngày Làm việc Chi nhánh &amp; Kỳ Chốt Tuần (D-03)
        </h2>
        {calendarSummary && (
          <p data-testid="calendar-summary-line">
            Múi giờ: <code>{calendarSummary.timezone}</code> | Chốt tuần:{" "}
            <code>{calendarSummary.weekly_cutoff_day}</code> | Cut-off báo cáo
            ngày: <code>{calendarSummary.daily_report_cutoff_time}</code> |
            Tháng 11/2026:{" "}
            <strong data-testid="calendar-working-days-count">
              {calendarSummary.working_days_count}
            </strong>{" "}
            ngày làm việc / {calendarSummary.non_working_days_count} ngày nghỉ.
          </p>
        )}

        {actorRoleCode === "CONFIG_ADMIN" && (
          <form
            onSubmit={handleUpdateCalendarDay}
            className="inline-form"
            data-testid="update-calendar-form"
            aria-label="Biểu mẫu cập nhật ngày làm việc (CONFIG_ADMIN)"
          >
            <h3>Cập nhật ngày làm việc / nghỉ lễ (CONFIG_ADMIN)</h3>
            <div className="form-grid">
              <label>
                Ngày (YYYY-MM-DD)
                <input
                  type="date"
                  required
                  data-testid="input-calendar-date"
                  value={calDate}
                  onChange={(e) => setCalDate(e.target.value)}
                />
              </label>
              <label>
                Trạng thái ngày làm việc
                <select
                  data-testid="select-calendar-working"
                  value={calWorking ? "true" : "false"}
                  onChange={(e) => setCalWorking(e.target.value === "true")}
                >
                  <option value="true">Ngày làm việc (Working Day)</option>
                  <option value="false">Ngày nghỉ / Lễ (Non-working)</option>
                </select>
              </label>
              <label>
                Ghi chú ngày nghỉ lễ
                <input
                  type="text"
                  data-testid="input-calendar-holiday"
                  value={calHoliday}
                  onChange={(e) => setCalHoliday(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="scaffold-button"
              data-testid="submit-calendar-day"
            >
              Cập nhật lịch ngày làm việc
            </button>
          </form>
        )}
      </section>

      {/* 3. KPI Target Allocation & Approval Section */}
      <section
        className="scaffold-status"
        aria-labelledby="kpi-targets-allocation-heading"
      >
        <h2 id="kpi-targets-allocation-heading">
          3. Phân bổ, Phê duyệt &amp; Lịch sử Revision Chỉ tiêu KPI
          (Năm/Tháng/Tuần/Ngày)
        </h2>

        {actorRoleCode === "CONFIG_ADMIN" || targetsDeniedReason ? (
          <div
            role="alert"
            data-testid="kpi-targets-denied-box"
            className="denied-box"
          >
            <p>
              <strong>
                Giới hạn quyền truy cập dữ liệu nghiệp vụ (ADR-002 / ADR-003):
              </strong>{" "}
              Vai trò <code>{actorRoleCode}</code> chỉ quản trị cấu hình công
              thức KPI và lịch làm việc, không có quyền đọc hoặc chỉnh sửa số
              liệu chỉ tiêu kinh doanh gắn với phòng ban/nhân sự (
              <code>
                {targetsDeniedReason ?? "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN"}
              </code>
              ).
            </p>
          </div>
        ) : (
          <>
            <div className="filter-row">
              <label htmlFor="period-type-filter">Lọc theo kỳ chỉ tiêu: </label>
              <select
                id="period-type-filter"
                data-testid="period-type-filter"
                value={periodTypeFilter}
                onChange={(e) => setPeriodTypeFilter(e.target.value)}
              >
                <option value="">Tất cả kỳ (YEAR / MONTH / WEEK / DAY)</option>
                <option value="YEAR">Năm (YEAR)</option>
                <option value="MONTH">Tháng (MONTH)</option>
                <option value="WEEK">Dự phóng Tuần (WEEK)</option>
                <option value="DAY">Dự phóng Ngày (DAY)</option>
              </select>
            </div>

            {targets.length === 0 ? (
              <p data-testid="kpi-targets-empty">
                Chưa có bản ghi chỉ tiêu KPI nào trong phạm vi của bạn.
              </p>
            ) : (
              <div className="table-scroll">
                <table
                  className="data-table"
                  data-testid="kpi-targets-table"
                  aria-label="Bảng chỉ tiêu KPI theo phạm vi"
                >
                  <thead>
                    <tr>
                      <th>Kỳ</th>
                      <th>Mã KPI</th>
                      <th>Phạm vi</th>
                      <th>Chỉ tiêu (Target)</th>
                      <th>Đơn vị</th>
                      <th>Trạng thái</th>
                      <th>Revision</th>
                      <th>Lịch sử điều chỉnh</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr
                        key={t.id}
                        data-testid={`kpi-target-row-${t.metric_code}-${t.period_key}`}
                      >
                        <td>
                          <code>
                            {t.period_type}: {t.period_key}
                          </code>
                        </td>
                        <td>
                          <code>{t.metric_code}</code> — {t.metric_name}
                        </td>
                        <td>
                          <code>{t.scope_type}</code>
                        </td>
                        <td data-testid={`kpi-target-value-${t.id}`}>
                          <strong>{t.target_value}</strong>
                        </td>
                        <td>{t.unit_code}</td>
                        <td data-testid={`kpi-target-status-${t.id}`}>
                          <code>{t.status}</code>
                        </td>
                        <td>v{t.revision_no}</td>
                        <td>
                          <ul className="revision-list">
                            {t.revisions.map((r) => (
                              <li key={r.id}>
                                #{r.revision_no}:{" "}
                                {r.previous_target_value ?? "NULL"} →{" "}
                                <strong>{r.new_target_value}</strong> (
                                <code>{r.new_status}</code> — {r.change_reason})
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {t.status === "PENDING_APPROVAL" &&
                            (actorRoleCode === "EXECUTIVE" ||
                              (actorRoleCode === "DEPARTMENT_MANAGER" &&
                                t.scope_type === "SELF" &&
                                t.proposed_by_staff_id !== actorStaffId)) && (
                              <button
                                type="button"
                                className="scaffold-button"
                                data-testid={`approve-target-${t.id}`}
                                onClick={() => void handleApproveTarget(t)}
                              >
                                Phê duyệt
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form
              onSubmit={handleCreateTarget}
              className="inline-form"
              data-testid="create-kpi-target-form"
              aria-label="Biểu mẫu phân bổ chỉ tiêu KPI"
            >
              <h3>
                {actorRoleCode === "STAFF"
                  ? "Lập dự phóng chỉ tiêu Tuần/Ngày cá nhân (SELF)"
                  : "Giao / Đề nghị chỉ tiêu KPI theo phạm vi"}
              </h3>
              <div className="form-grid">
                <label>
                  Chỉ số KPI
                  <select
                    data-testid="select-target-def"
                    value={targetDefId}
                    onChange={(e) => setTargetDefId(e.target.value)}
                  >
                    {definitions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.metric_code} — {d.metric_name} ({d.unit_code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Loại kỳ (Period Type)
                  <select
                    data-testid="select-target-period-type"
                    value={targetPeriodType}
                    onChange={(e) => {
                      const pt = e.target.value as
                        "YEAR" | "MONTH" | "WEEK" | "DAY";
                      setTargetPeriodType(pt);
                      if (pt === "YEAR") setTargetPeriodKey("2026");
                      if (pt === "MONTH") setTargetPeriodKey("2026-11");
                      if (pt === "WEEK") setTargetPeriodKey("2026-W46");
                      if (pt === "DAY") setTargetPeriodKey("2026-11-14");
                    }}
                  >
                    {actorRoleCode !== "STAFF" && (
                      <>
                        <option value="YEAR">YEAR (Chỉ tiêu Năm)</option>
                        <option value="MONTH">MONTH (Chỉ tiêu Tháng)</option>
                      </>
                    )}
                    <option value="WEEK">WEEK (Dự phóng Tuần)</option>
                    <option value="DAY">DAY (Dự phóng Ngày)</option>
                  </select>
                </label>
                <label>
                  Mã kỳ (Period Key)
                  <input
                    type="text"
                    required
                    data-testid="input-target-period-key"
                    value={targetPeriodKey}
                    onChange={(e) => setTargetPeriodKey(e.target.value)}
                  />
                </label>
                <label>
                  Phạm vi (Scope)
                  <select
                    data-testid="select-target-scope"
                    value={targetScopeType}
                    onChange={(e) =>
                      setTargetScopeType(
                        e.target.value as "BRANCH" | "DEPARTMENT" | "SELF",
                      )
                    }
                  >
                    {actorRoleCode === "EXECUTIVE" && (
                      <option value="BRANCH">BRANCH (Toàn chi nhánh)</option>
                    )}
                    {(actorRoleCode === "EXECUTIVE" ||
                      actorRoleCode === "DEPARTMENT_MANAGER") && (
                      <option value="DEPARTMENT">DEPARTMENT (Phòng ban)</option>
                    )}
                    <option value="SELF">SELF (Cá nhân)</option>
                  </select>
                </label>
                {targetScopeType !== "BRANCH" && (
                  <label>
                    Phòng ban
                    <select
                      data-testid="select-target-dept"
                      value={targetDeptId}
                      onChange={(e) => setTargetDeptId(e.target.value)}
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {targetScopeType === "SELF" && (
                  <label>
                    Nhân sự
                    <select
                      data-testid="select-target-staff"
                      value={targetStaffId}
                      onChange={(e) => setTargetStaffId(e.target.value)}
                    >
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.staff_code} — {s.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Giá trị chỉ tiêu (NUMERIC 20,2)
                  <input
                    type="text"
                    required
                    data-testid="input-target-value"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                  />
                </label>
                <label>
                  Chỉ tiêu mẹ (Parent Target ID, tùy chọn)
                  <input
                    type="text"
                    data-testid="input-target-parent"
                    value={targetParentId}
                    onChange={(e) => setTargetParentId(e.target.value)}
                    placeholder="UUID chỉ tiêu YEAR/MONTH mẹ"
                  />
                </label>
                <label>
                  Mã tham chiếu phê duyệt
                  <input
                    type="text"
                    data-testid="input-target-approval-ref"
                    value={targetApprovalRef}
                    onChange={(e) => setTargetApprovalRef(e.target.value)}
                  />
                </label>
                <label>
                  Ghi chú / Lý do giao chỉ tiêu
                  <input
                    type="text"
                    data-testid="input-target-notes"
                    value={targetNotes}
                    onChange={(e) => setTargetNotes(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="submit"
                className="scaffold-button"
                data-testid="submit-create-kpi-target"
              >
                Lưu phân bổ chỉ tiêu
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
