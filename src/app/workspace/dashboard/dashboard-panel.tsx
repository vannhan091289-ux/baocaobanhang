"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  DashboardOverviewPayload,
  KpiActualRow,
} from "@/server/kpi/p0b2-service";

interface Props {
  actorRoleCode: string;
  actorDepartmentId: string;
  actorStaffId: string;
  csrfToken: string;
}

interface KpiDefOption {
  id: string;
  metric_code: string;
  metric_name: string;
  group_code: string;
}

export function DashboardPanel({
  actorRoleCode,
  actorStaffId,
  csrfToken,
}: Props) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
  const canReconcile =
    actorRoleCode === "EXECUTIVE" || actorRoleCode === "DEPARTMENT_MANAGER";

  const [periodType, setPeriodType] = useState<
    "DAY" | "WEEK" | "MONTH" | "YEAR"
  >("MONTH");
  const [periodKey, setPeriodKey] = useState("2026-11");
  const [asOfDate, setAsOfDate] = useState("2026-11-14");
  const [groupFilter, setGroupFilter] = useState("");
  const [overview, setOverview] = useState<DashboardOverviewPayload | null>(
    null,
  );
  const [actuals, setActuals] = useState<KpiActualRow[]>([]);
  const [definitions, setDefinitions] = useState<KpiDefOption[]>([]);
  const [loading, setLoading] = useState(!isConfigAdmin);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Actual record creation form
  const [formDefId, setFormDefId] = useState("");
  const [formActualVal, setFormActualVal] = useState("");
  const [formIsMissing, setFormIsMissing] = useState(false);
  const [formSourceRef, setFormSourceRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    if (isConfigAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams({
        period_type: periodType,
        period_key: periodKey,
        as_of_date: asOfDate,
      });
      if (groupFilter) qs.set("group_code", groupFilter);

      const [ovRes, actRes, defRes] = await Promise.all([
        fetch(`/api/dashboard/overview?${qs.toString()}`),
        fetch(
          `/api/kpi/actuals?period_type=${encodeURIComponent(periodType)}&period_key=${encodeURIComponent(periodKey)}&limit=50`,
        ),
        fetch("/api/kpi/definitions?status=ACTIVE&limit=50"),
      ]);

      const ovJson = (await ovRes.json()) as {
        data?: DashboardOverviewPayload;
        error?: { message: string };
      };
      if (!ovRes.ok) {
        setErrorMsg(
          ovJson.error?.message ?? `Lỗi tải Dashboard (${ovRes.status})`,
        );
      } else if (ovJson.data) {
        setOverview(ovJson.data);
      }

      if (actRes.ok) {
        const actJson = (await actRes.json()) as { data?: KpiActualRow[] };
        setActuals(actJson.data ?? []);
      }

      if (defRes.ok) {
        const defJson = (await defRes.json()) as { data?: KpiDefOption[] };
        const defs = defJson.data ?? [];
        setDefinitions(defs);
        if (defs.length > 0 && defs[0] && !formDefId) {
          setFormDefId(defs[0].id);
        }
      }
    } catch {
      setErrorMsg("Không thể kết nối máy chủ để tải dữ liệu Dashboard.");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, formDefId, groupFilter, isConfigAdmin, periodKey, periodType]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  function handlePeriodTypeChange(next: "DAY" | "WEEK" | "MONTH" | "YEAR") {
    setPeriodType(next);
    if (next === "DAY") setPeriodKey(asOfDate);
    else if (next === "MONTH") setPeriodKey(asOfDate.slice(0, 7));
    else if (next === "YEAR") setPeriodKey(asOfDate.slice(0, 4));
    else setPeriodKey("2026-W46");
  }

  async function handleCreateActual(e: React.FormEvent) {
    e.preventDefault();
    if (!formDefId) return;
    setSubmitting(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const numericValue = formIsMissing
        ? null
        : formActualVal.trim() === ""
          ? null
          : Number(formActualVal);

      const res = await fetch("/api/kpi/actuals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          kpi_definition_id: formDefId,
          period_type: periodType,
          period_key: periodKey,
          as_of_date: asOfDate,
          primary_staff_id: actorStaffId,
          actual_value: numericValue,
          source_code: "SYNTHETIC_DEVTEST",
          source_ref: formSourceRef.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setErrorMsg(
          json.error?.message ?? `Lỗi ghi nhận Actual (${res.status})`,
        );
      } else {
        setStatusMsg("Đã ghi nhận bản ghi Actual trạng thái PROVISIONAL.");
        setFormActualVal("");
        setFormSourceRef("");
        await loadData();
      }
    } catch {
      setErrorMsg("Lỗi kết nối khi ghi nhận Actual.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReconcileAction(
    record: KpiActualRow,
    action: "RECONCILE" | "FINALIZE",
  ) {
    setSubmitting(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/kpi/actuals/${record.id}/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          reconcile_action: action,
          expected_version: record.row_version,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setErrorMsg(json.error?.message ?? `Lỗi đối soát (${res.status})`);
      } else {
        setStatusMsg(
          action === "RECONCILE"
            ? "Đã đối soát bản ghi sang RECONCILED."
            : "Đã chốt sổ bản ghi sang FINAL.",
        );
        await loadData();
      }
    } catch {
      setErrorMsg("Lỗi kết nối khi đối soát.");
    } finally {
      setSubmitting(false);
    }
  }

  if (isConfigAdmin) {
    return (
      <section
        className="scaffold-status"
        aria-labelledby="dashboard-config-admin-denied"
        data-testid="dashboard-denied-box"
      >
        <h2 id="dashboard-config-admin-denied">
          Từ chối truy cập dữ liệu kinh doanh (403)
        </h2>
        <p>
          Vai trò <code>CONFIG_ADMIN</code> chỉ quản trị cấu hình hệ thống và
          không được phép đọc hoặc ghi số liệu Dashboard/Actual kinh doanh (
          <code>CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN</code>).
        </p>
      </section>
    );
  }

  return (
    <div className="scaffold-grid" style={{ gap: "1.5rem" }}>
      <section
        className="scaffold-card"
        aria-labelledby="dashboard-filter-heading"
      >
        <h2 id="dashboard-filter-heading">Bộ lọc kỳ báo cáo &amp; ngày chốt</h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "flex-end",
          }}
        >
          <label>
            Kỳ báo cáo
            <select
              aria-label="Kỳ báo cáo"
              value={periodType}
              onChange={(e) =>
                handlePeriodTypeChange(
                  e.target.value as "DAY" | "WEEK" | "MONTH" | "YEAR",
                )
              }
            >
              <option value="DAY">Ngày (DAY)</option>
              <option value="WEEK">Tuần (WEEK)</option>
              <option value="MONTH">Tháng (MONTH)</option>
              <option value="YEAR">Năm (YEAR)</option>
            </select>
          </label>

          <label>
            Mã kỳ
            <input
              aria-label="Mã kỳ"
              type="text"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            />
          </label>

          <label>
            Ngày chốt (as_of_date)
            <input
              aria-label="Ngày chốt"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>

          <label>
            Nhóm KPI
            <select
              aria-label="Lọc nhóm KPI"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">Tất cả 7 nhóm</option>
              <option value="LOAN">LOAN</option>
              <option value="DEPOSIT">DEPOSIT</option>
              <option value="CARD">CARD</option>
              <option value="TTQT">TTQT</option>
              <option value="NEW_RETAIL_CIF">NEW_RETAIL_CIF</option>
              <option value="BIZ_HOUSEHOLD">BIZ_HOUSEHOLD</option>
              <option value="INSURANCE">INSURANCE</option>
            </select>
          </label>

          <button
            type="button"
            className="scaffold-button"
            onClick={() => void loadData()}
            disabled={loading}
          >
            Làm mới Dashboard
          </button>
        </div>

        {overview ? (
          <p className="scaffold-meta" style={{ marginTop: "0.75rem" }}>
            Phạm vi xem: <strong>{overview.viewer_scope}</strong> • Tiến độ kỳ
            vọng theo lịch làm việc D-03:{" "}
            <strong>
              {overview.expected_progress_pct !== null
                ? `${overview.expected_progress_pct}%`
                : "Chưa có lịch"}
            </strong>{" "}
            • Hiển thị tách biệt 7 nhóm KPI (không composite score — D-07).
          </p>
        ) : null}
      </section>

      {errorMsg ? (
        <div
          role="alert"
          className="scaffold-status"
          data-testid="dashboard-error"
        >
          <strong>Lỗi:</strong> {errorMsg}
        </div>
      ) : null}

      {statusMsg ? (
        <div
          role="status"
          className="scaffold-status"
          data-testid="dashboard-status"
        >
          {statusMsg}
        </div>
      ) : null}

      <section
        className="scaffold-card"
        aria-labelledby="dashboard-groups-heading"
        data-testid="dashboard-groups"
      >
        <h2 id="dashboard-groups-heading">
          Tổng hợp 7 nhóm KPI tách biệt (D-07)
        </h2>
        {loading ? (
          <p>Đang tải tổng hợp KPI...</p>
        ) : !overview || overview.groups.length === 0 ? (
          <p>Chưa có nhóm KPI nào để hiển thị.</p>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {overview.groups.map((grp) => (
              <article
                key={grp.group_code}
                className="scaffold-card"
                aria-label={`Nhóm KPI ${grp.group_code}`}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <h3>{grp.group_code}</h3>
                  <span className="scaffold-badge">
                    {grp.metrics_count} chỉ tiêu • OK: {grp.ok_count} • Khuyết:{" "}
                    {grp.missing_data_count}
                  </span>
                </header>
                {grp.metrics.length === 0 ? (
                  <p className="scaffold-meta">
                    Chưa có chỉ tiêu ACTIVE trong nhóm này.
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr>
                          <th scope="col">Mã KPI</th>
                          <th scope="col">Loại / Quy tắc</th>
                          <th scope="col">Target</th>
                          <th scope="col">Actual</th>
                          <th scope="col">Gap</th>
                          <th scope="col">Hoàn thành</th>
                          <th scope="col">Trạng thái / Nguồn / Ngày chốt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grp.metrics.map((m) => (
                          <tr key={m.kpi_definition_id}>
                            <td>
                              <strong>{m.metric_code}</strong>
                              <div className="scaffold-meta">
                                {m.metric_name}
                              </div>
                            </td>
                            <td>
                              {m.metric_type} / {m.time_aggregation_rule}
                            </td>
                            <td>
                              {m.target_value !== null
                                ? `${m.target_value.toLocaleString("en-US")} ${m.unit_code}`
                                : "—"}
                            </td>
                            <td>
                              {m.data_status === "MISSING_DATA"
                                ? "MISSING_DATA"
                                : `${m.actual_value?.toLocaleString("en-US") ?? "—"} ${m.unit_code}`}
                            </td>
                            <td>
                              {m.gap !== null
                                ? m.gap.toLocaleString("en-US")
                                : "—"}
                            </td>
                            <td>
                              {m.completion_pct !== null
                                ? `${m.completion_pct}%`
                                : "—"}
                            </td>
                            <td>
                              <span className="scaffold-badge">
                                {m.reconciliation_status}
                              </span>{" "}
                              <span className="scaffold-meta">
                                {m.source_code} • {m.as_of_date}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {overview && overview.drilldown_departments.length > 0 ? (
        <section
          className="scaffold-card"
          aria-labelledby="drilldown-dept-heading"
        >
          <h2 id="drilldown-dept-heading">Drill-down theo Phòng ban</h2>
          <ul>
            {overview.drilldown_departments.map((d) => (
              <li key={d.entity_id}>
                <strong>
                  {d.entity_code} — {d.entity_name}
                </strong>{" "}
                ({d.metrics_with_data} có số liệu, {d.metrics_missing_data}{" "}
                khuyết)
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview && overview.drilldown_staff.length > 0 ? (
        <section
          className="scaffold-card"
          aria-labelledby="drilldown-staff-heading"
        >
          <h2 id="drilldown-staff-heading">Drill-down theo Nhân sự</h2>
          <ul>
            {overview.drilldown_staff.map((s) => (
              <li key={s.entity_id}>
                <strong>
                  {s.entity_code} — {s.entity_name}
                </strong>{" "}
                ({s.metrics_with_data} có số liệu, {s.metrics_missing_data}{" "}
                khuyết)
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="scaffold-card"
        aria-labelledby="actual-record-heading"
      >
        <h2 id="actual-record-heading">
          Ghi nhận &amp; Đối soát kết quả Actual (PROVISIONAL → RECONCILED →
          FINAL)
        </h2>

        <form
          onSubmit={(e) => void handleCreateActual(e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "flex-end",
            marginBottom: "1rem",
          }}
        >
          <label>
            Chỉ tiêu KPI
            <select
              aria-label="Chỉ tiêu KPI"
              value={formDefId}
              onChange={(e) => setFormDefId(e.target.value)}
            >
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.group_code} — {d.metric_code}
                </option>
              ))}
            </select>
          </label>

          <label>
            Giá trị Actual
            <input
              aria-label="Giá trị Actual"
              type="number"
              step="0.01"
              disabled={formIsMissing}
              value={formActualVal}
              onChange={(e) => setFormActualVal(e.target.value)}
              placeholder="Ví dụ: 150000000"
            />
          </label>

          <label
            style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
          >
            <input
              type="checkbox"
              checked={formIsMissing}
              onChange={(e) => setFormIsMissing(e.target.checked)}
            />
            Khuyết dữ liệu (MISSING_DATA / NULL)
          </label>

          <label>
            Tham chiếu nguồn
            <input
              aria-label="Tham chiếu nguồn"
              type="text"
              value={formSourceRef}
              onChange={(e) => setFormSourceRef(e.target.value)}
              placeholder="SYN-BATCH-01"
            />
          </label>

          <button
            type="submit"
            className="scaffold-button"
            disabled={submitting || !formDefId}
          >
            Ghi nhận PROVISIONAL
          </button>
        </form>

        {actuals.length === 0 ? (
          <p className="scaffold-meta">Chưa có bản ghi Actual nào trong kỳ.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col">Chỉ tiêu</th>
                  <th scope="col">Nhân sự</th>
                  <th scope="col">Ngày chốt</th>
                  <th scope="col">Giá trị</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {actuals.map((rec) => (
                  <tr key={rec.id}>
                    <td>{rec.metric_code}</td>
                    <td>
                      {rec.primary_staff_code}
                      {rec.referrer_staff_code
                        ? ` (+${rec.referrer_staff_code})`
                        : ""}
                    </td>
                    <td>{rec.as_of_date}</td>
                    <td>
                      {rec.data_status === "MISSING_DATA"
                        ? "MISSING_DATA"
                        : `${rec.actual_value?.toLocaleString("en-US")} ${rec.unit_code}`}
                    </td>
                    <td>{rec.reconciliation_status}</td>
                    <td>
                      {canReconcile &&
                      rec.reconciliation_status === "PROVISIONAL" ? (
                        <button
                          type="button"
                          className="scaffold-button"
                          disabled={submitting}
                          onClick={() =>
                            void handleReconcileAction(rec, "RECONCILE")
                          }
                        >
                          Đối soát (RECONCILE)
                        </button>
                      ) : canReconcile &&
                        rec.reconciliation_status === "RECONCILED" ? (
                        <button
                          type="button"
                          className="scaffold-button"
                          disabled={submitting}
                          onClick={() =>
                            void handleReconcileAction(rec, "FINALIZE")
                          }
                        >
                          Chốt sổ (FINAL)
                        </button>
                      ) : (
                        <span className="scaffold-meta">
                          v{rec.row_version}
                          {rec.adjustments_count > 0
                            ? ` • ${rec.adjustments_count} điều chỉnh`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
