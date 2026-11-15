"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  DashboardOverviewPayload,
  KpiActualRow,
} from "@/server/kpi/p0b2-service";

interface DrilldownDepartmentNode {
  id: string;
  code: string;
  name: string;
  staff_count: number;
  customer_count: number;
  opportunity_count: number;
  open_alert_count: number;
}

interface DrilldownStaffNode {
  id: string;
  staff_code: string;
  display_name: string;
  department_id: string;
  department_code: string;
  customer_count: number;
  activity_count: number;
  opportunity_count: number;
}

interface DrilldownResultPayload {
  level: "BRANCH" | "DEPARTMENT" | "STAFF" | "ITEM";
  period_key: string;
  departments: DrilldownDepartmentNode[];
  staff_nodes: DrilldownStaffNode[];
  items: {
    customers: Array<{
      id: string;
      customer_ref_code: string;
      display_name: string;
      segment_code: string;
    }>;
    opportunities: Array<{
      id: string;
      opportunity_ref: string;
      display_label: string;
      stage: string;
      estimated_value: number;
    }>;
    kpi_actuals: Array<{
      id: string;
      metric_code: string;
      actual_value: number | null;
      data_state: string;
      reconciliation_status: string;
    }>;
  };
}

interface StaffFocusActivity {
  id: string;
  activity_date: string;
  activity_type: string;
  summary: string;
}

interface StaffFocusLead {
  id: string;
  lead_ref: string;
  display_label: string;
  stage: string;
}

interface StaffFocusCustomer {
  id: string;
  customer_ref_code: string;
  display_name: string;
  segment_code: string;
}

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

  // Interactive drill-down (P0D /api/dashboard/drilldown)
  const [drilldown, setDrilldown] = useState<DrilldownResultPayload | null>(
    null,
  );
  const [drilldownLabel, setDrilldownLabel] = useState<string>("");
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  // STAFF focus block (priorities / appointments / leads / customers)
  const [staffActivities, setStaffActivities] = useState<StaffFocusActivity[]>(
    [],
  );
  const [staffLeads, setStaffLeads] = useState<StaffFocusLead[]>([]);
  const [staffCustomers, setStaffCustomers] = useState<StaffFocusCustomer[]>(
    [],
  );

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

      if (actorRoleCode === "STAFF") {
        const [focusActRes, focusLeadRes, focusCustRes] = await Promise.all([
          fetch("/api/planning/activities?limit=5"),
          fetch("/api/pipeline/leads?limit=5"),
          fetch("/api/customers?limit=5"),
        ]);
        if (focusActRes.ok) {
          const j = (await focusActRes.json()) as {
            data?: StaffFocusActivity[];
          };
          setStaffActivities(j.data ?? []);
        }
        if (focusLeadRes.ok) {
          const j = (await focusLeadRes.json()) as { data?: StaffFocusLead[] };
          setStaffLeads(j.data ?? []);
        }
        if (focusCustRes.ok) {
          const j = (await focusCustRes.json()) as {
            data?: StaffFocusCustomer[];
          };
          setStaffCustomers(j.data ?? []);
        }
      }
    } catch {
      setErrorMsg("Không thể kết nối máy chủ để tải dữ liệu Dashboard.");
    } finally {
      setLoading(false);
    }
  }, [
    actorRoleCode,
    asOfDate,
    formDefId,
    groupFilter,
    isConfigAdmin,
    periodKey,
    periodType,
  ]);

  const loadDrilldown = useCallback(
    async (opts: {
      level: "BRANCH" | "DEPARTMENT" | "STAFF";
      department_id?: string;
      staff_id?: string;
      label: string;
    }) => {
      setDrilldownLoading(true);
      setDrilldownError(null);
      setDrilldownLabel(opts.label);
      try {
        const qs = new URLSearchParams({
          level: opts.level,
          period_key: periodKey,
        });
        if (opts.department_id) qs.set("department_id", opts.department_id);
        if (opts.staff_id) qs.set("staff_id", opts.staff_id);
        const res = await fetch(`/api/dashboard/drilldown?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as {
          data?: DrilldownResultPayload;
          error?: { message?: string };
        };
        if (!res.ok || !json.data) {
          setDrilldownError(
            json.error?.message ?? `Không thể tải drill-down (${res.status})`,
          );
          return;
        }
        setDrilldown(json.data);
      } catch {
        setDrilldownError("Lỗi kết nối khi tải dữ liệu drill-down.");
      } finally {
        setDrilldownLoading(false);
      }
    },
    [periodKey],
  );

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

      {overview ? (
        <section
          className="scaffold-card"
          aria-labelledby="completion-chart-heading"
          data-testid="dashboard-completion-chart"
        >
          <h2 id="completion-chart-heading">
            Biểu đồ Tiến độ Hoàn thành KPI so với Kỳ vọng (
            {overview.expected_progress_pct !== null
              ? `${overview.expected_progress_pct}%`
              : "N/A"}
            )
          </h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {overview.groups
              .flatMap((g) => g.metrics)
              .filter((m) => m.completion_pct !== null)
              .slice(0, 8)
              .map((m) => {
                const pct = Math.max(0, Math.min(100, m.completion_pct ?? 0));
                const targetPace = overview.expected_progress_pct ?? 100;
                const onTrack = (m.completion_pct ?? 0) >= targetPace;
                return (
                  <div key={m.kpi_definition_id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.9rem",
                        marginBottom: "0.2rem",
                      }}
                    >
                      <span>
                        <strong>{m.metric_code}</strong> — {m.metric_name}
                      </span>
                      <span>
                        {m.completion_pct}%
                        {overview.expected_progress_pct !== null
                          ? ` (kỳ vọng ${overview.expected_progress_pct}%)`
                          : ""}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`Tiến độ ${m.metric_code}`}
                      aria-valuenow={Math.round(pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{
                        height: "0.6rem",
                        background: "#e5e7eb",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: onTrack ? "#15803d" : "#b45309",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            {overview.groups
              .flatMap((g) => g.metrics)
              .every((m) => m.completion_pct === null) ? (
              <p className="scaffold-meta">
                Chưa có chỉ tiêu đủ cả Target và Actual trong kỳ để vẽ biểu đồ.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {actorRoleCode === "STAFF" ? (
        <section
          className="scaffold-card"
          aria-labelledby="staff-daily-focus-heading"
          data-testid="staff-daily-focus"
        >
          <h2 id="staff-daily-focus-heading">
            Ưu tiên Trong ngày, Lịch hẹn &amp; Lead / Khách hàng (STAFF)
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <div>
              <h3>Lịch hẹn &amp; Hoạt động gần nhất</h3>
              {staffActivities.length === 0 ? (
                <p className="scaffold-meta">Chưa có hoạt động bán hàng.</p>
              ) : (
                <ul>
                  {staffActivities.map((a) => (
                    <li key={a.id}>
                      <strong>{a.activity_date}</strong> [{a.activity_type}]{" "}
                      {a.summary}
                    </li>
                  ))}
                </ul>
              )}
              <Link className="scaffold-link" href="/workspace/planning">
                Mở Kế hoạch Bán hàng
              </Link>
            </div>
            <div>
              <h3>Lead đang phụ trách</h3>
              {staffLeads.length === 0 ? (
                <p className="scaffold-meta">Chưa có Lead.</p>
              ) : (
                <ul>
                  {staffLeads.map((l) => (
                    <li key={l.id}>
                      <code>{l.lead_ref}</code> — {l.display_label} ({l.stage})
                    </li>
                  ))}
                </ul>
              )}
              <Link className="scaffold-link" href="/workspace/pipeline">
                Mở Pipeline Lead
              </Link>
            </div>
            <div>
              <h3>Khách hàng được phân công</h3>
              {staffCustomers.length === 0 ? (
                <p className="scaffold-meta">Chưa có Khách hàng.</p>
              ) : (
                <ul>
                  {staffCustomers.map((c) => (
                    <li key={c.id}>
                      <code>{c.customer_ref_code}</code> — {c.display_name} (
                      {c.segment_code})
                    </li>
                  ))}
                </ul>
              )}
              <Link className="scaffold-link" href="/workspace/customers">
                Mở Customer 360
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className="scaffold-card"
        aria-labelledby="interactive-drilldown-heading"
      >
        <h2 id="interactive-drilldown-heading">
          Drill-down Tương tác Chi tiết (KPI / Khách hàng / Cơ hội)
        </h2>
        <div style={{ marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="scaffold-button"
            data-testid="dashboard-drilldown-load"
            disabled={drilldownLoading}
            onClick={() =>
              void loadDrilldown({
                level:
                  actorRoleCode === "STAFF"
                    ? "STAFF"
                    : actorRoleCode === "DEPARTMENT_MANAGER"
                      ? "DEPARTMENT"
                      : "BRANCH",
                label: `Tổng quan phạm vi ${actorRoleCode}`,
              })
            }
          >
            {drilldownLoading
              ? "Đang tải drill-down..."
              : "Tải Drill-down Chi tiết"}
          </button>
        </div>

        {drilldownError ? (
          <p role="alert" style={{ color: "#b91c1c" }}>
            {drilldownError}
          </p>
        ) : null}

        {drilldown ? (
          <div data-testid="dashboard-drilldown-result">
            <p className="scaffold-meta">
              Phạm vi đang xem: <strong>{drilldownLabel}</strong> (Cấp{" "}
              <code>{drilldown.level}</code> • Kỳ{" "}
              <code>{drilldown.period_key}</code>)
            </p>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="interactive-drilldown-heading"
              className="table-wrapper"
              style={{ overflowX: "auto" }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th scope="col">Phòng ban</th>
                    <th scope="col">Nhân sự</th>
                    <th scope="col">Khách hàng</th>
                    <th scope="col">Cơ hội</th>
                    <th scope="col">Cảnh báo mở</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.departments.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.code} — {d.name}
                      </td>
                      <td>{d.staff_count}</td>
                      <td>{d.customer_count}</td>
                      <td>{d.opportunity_count}</td>
                      <td>{d.open_alert_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="scaffold-meta" style={{ marginTop: "0.5rem" }}>
              Nhân sự trong phạm vi: {drilldown.staff_nodes.length} • Khách hàng
              chi tiết: {drilldown.items.customers.length} • Cơ hội:{" "}
              {drilldown.items.opportunities.length} • Bản ghi Actual:{" "}
              {drilldown.items.kpi_actuals.length}
            </p>
          </div>
        ) : null}
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
                khuyết){" "}
                <button
                  type="button"
                  className="scaffold-button"
                  data-testid={`drilldown-dept-${d.entity_code}`}
                  onClick={() =>
                    void loadDrilldown({
                      level: "DEPARTMENT",
                      department_id: d.entity_id,
                      label: `${d.entity_code} — ${d.entity_name}`,
                    })
                  }
                >
                  Xem chi tiết
                </button>
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
                khuyết){" "}
                <button
                  type="button"
                  className="scaffold-button"
                  data-testid={`drilldown-staff-${s.entity_code}`}
                  onClick={() =>
                    void loadDrilldown({
                      level: "STAFF",
                      staff_id: s.entity_id,
                      label: `${s.entity_code} — ${s.entity_name}`,
                    })
                  }
                >
                  Xem chi tiết
                </button>
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
