"use client";

import React, { useCallback, useEffect, useState } from "react";

interface SalesPlanItem {
  id: string;
  staff_id: string;
  staff_code: string;
  staff_name: string;
  department_id: string;
  department_code: string;
  period_type: "WEEK" | "DAY";
  period_key: string;
  title: string;
  focus_notes: string | null;
  status: "DRAFT" | "SUBMITTED" | "REVIEWED" | "CLOSED";
  row_version: number;
  activity_summary: {
    total_count: number;
    planned_count: number;
    completed_count: number;
    cancelled_count: number;
    follow_up_needed_count: number;
  };
}

interface ActivityLogItem {
  id: string;
  actor_staff_code: string;
  actor_staff_name: string;
  department_code: string;
  sales_plan_id: string | null;
  kpi_metric_code: string | null;
  synthetic_customer_ref: string | null;
  activity_type: string;
  occurred_at: string;
  occurred_date_vn: string;
  is_after_daily_cutoff: boolean;
  status: "PLANNED" | "COMPLETED" | "CANCELLED" | "FOLLOW_UP_NEEDED";
  outcome_summary: string;
  next_step: string | null;
  row_version: number;
}

interface MondayReviewItem {
  id: string;
  week_period_key: string;
  scope_type: "BRANCH" | "DEPARTMENT";
  department_id: string | null;
  department_code: string | null;
  conducted_by_name: string;
  review_date: string;
  summary_notes: string;
  status: "OPEN" | "COMPLETED";
  row_version: number;
}

interface DirectiveTaskItem {
  id: string;
  monday_review_id: string;
  department_code: string;
  assignee_staff_code: string;
  assignee_name: string;
  title: string;
  due_at: string;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "OVERDUE";
  completion_note: string | null;
  row_version: number;
}

interface WeeklyStaffRollupItem {
  staff_id: string;
  staff_code: string;
  staff_name: string;
  department_code: string;
  plans_count: number;
  activities_total: number;
  activities_completed: number;
  activities_follow_up_needed: number;
  weekly_target_count: number;
}

interface MondayReviewBundle {
  week_period_key: string;
  week_start_vn: string;
  week_end_vn: string;
  reviews: MondayReviewItem[];
  directives: DirectiveTaskItem[];
  weekly_activity_rollup: WeeklyStaffRollupItem[];
}

export interface PlanningPanelProps {
  csrfToken: string;
  actorStaffId: string;
  actorDepartmentId: string;
  actorRoleCode: "EXECUTIVE" | "CONFIG_ADMIN" | "DEPARTMENT_MANAGER" | "STAFF";
}

export function PlanningPanel({
  csrfToken,
  actorDepartmentId,
  actorRoleCode,
}: PlanningPanelProps) {
  const [plans, setPlans] = useState<SalesPlanItem[]>([]);
  const [activities, setActivities] = useState<ActivityLogItem[]>([]);
  const [bundle, setBundle] = useState<MondayReviewBundle | null>(null);
  const [weekKey, setWeekKey] = useState("2026-W46");
  const [loading, setLoading] = useState(true);
  const [deniedCode, setDeniedCode] = useState<string | null>(
    actorRoleCode === "CONFIG_ADMIN"
      ? "CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN"
      : null,
  );
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Create Plan form
  const [planPeriodType, setPlanPeriodType] = useState<"WEEK" | "DAY">("WEEK");
  const [planPeriodKey, setPlanPeriodKey] = useState("2026-W46");
  const [planTitle, setPlanTitle] = useState(
    "Kế hoạch tiếp cận khách hàng tuần 46 (Synthetic)",
  );
  const [planNotes, setPlanNotes] = useState(
    "Tập trung giải ngân KHCN & bán chéo thẻ tín dụng",
  );

  // Create Activity form
  const [actPlanId, setActPlanId] = useState("");
  const [actType, setActType] = useState("CUSTOMER_VISIT");
  const [actStatus, setActStatus] = useState("COMPLETED");
  const [actCustRef, setActCustRef] = useState("SYN-CIF-001");
  const [actOutcome, setActOutcome] = useState(
    "Đã gặp trực tiếp KH synthetic và thu thập hồ sơ đề nghị vay vốn",
  );
  const [actNextStep, setActNextStep] = useState(
    "Trình phê duyệt hồ sơ trong 24h",
  );

  // Create Monday Review form (EXECUTIVE / DEPARTMENT_MANAGER)
  const [reviewSummary, setReviewSummary] = useState(
    "Rà soát tiến độ tuần 46 theo nhật ký hoạt động một nguồn",
  );

  const loadAll = useCallback(async () => {
    if (actorRoleCode === "CONFIG_ADMIN") {
      setDeniedCode("CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [planRes, actRes, revRes] = await Promise.all([
        fetch("/api/planning/plans?limit=50", { cache: "no-store" }),
        fetch(
          `/api/planning/activities?week_period_key=${encodeURIComponent(weekKey)}&limit=50`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/planning/monday-reviews?week_period_key=${encodeURIComponent(weekKey)}`,
          { cache: "no-store" },
        ),
      ]);

      if (planRes.ok) {
        const pJson = (await planRes.json()) as { data?: SalesPlanItem[] };
        const items = pJson.data ?? [];
        setPlans(items);
        if (items.length > 0) {
          setActPlanId((prev) => prev || items[0]!.id);
        }
      } else {
        const err = (await planRes.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setDeniedCode(err.error?.code ?? `HTTP_${planRes.status}`);
      }

      if (actRes.ok) {
        const aJson = (await actRes.json()) as { data?: ActivityLogItem[] };
        setActivities(aJson.data ?? []);
      }

      if (revRes.ok) {
        const rJson = (await revRes.json()) as { data?: MondayReviewBundle };
        setBundle(rJson.data ?? null);
      }
    } catch (err) {
      setBanner({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Lỗi kết nối khi tải dữ liệu P0B-1.",
      });
    } finally {
      setLoading(false);
    }
  }, [actorRoleCode, weekKey]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadAll();
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const res = await fetch("/api/planning/plans", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        period_type: planPeriodType,
        period_key: planPeriodKey.trim(),
        title: planTitle.trim(),
        focus_notes: planNotes.trim() || undefined,
        status: "SUBMITTED",
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      data?: SalesPlanItem;
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể tạo kế hoạch bán hàng"}`,
      });
      return;
    }
    if (payload.data?.id) {
      setActPlanId(payload.data.id);
    }
    setBanner({
      type: "success",
      text: "Đã lưu kế hoạch bán hàng thành công.",
    });
    await loadAll();
  }

  async function handleCreateActivity(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const res = await fetch("/api/planning/activities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        sales_plan_id: actPlanId || null,
        synthetic_customer_ref: actCustRef.trim() || undefined,
        activity_type: actType,
        status: actStatus,
        occurred_at: "2026-11-10T09:30:00.000+07:00",
        outcome_summary: actOutcome.trim(),
        next_step: actNextStep.trim() || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể ghi nhận nhật ký hoạt động"}`,
      });
      return;
    }
    setBanner({
      type: "success",
      text: "Đã ghi nhận hoạt động một nguồn vào activity_logs và tự động tổng hợp lên Kế hoạch & Review Thứ Hai.",
    });
    await loadAll();
  }

  async function handleCreateMondayReview(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const isExec = actorRoleCode === "EXECUTIVE";
    const res = await fetch("/api/planning/monday-reviews", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        action: "create_review",
        week_period_key: weekKey,
        review_scope: isExec ? "BRANCH" : "DEPARTMENT",
        department_id: isExec ? null : actorDepartmentId,
        review_date: "2026-11-16",
        summary_notes: reviewSummary.trim(),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setBanner({
        type: "error",
        text: `${payload.error?.code ?? "ERROR"}: ${payload.error?.message ?? "Không thể tạo biên bản Review Thứ Hai"}`,
      });
      return;
    }
    setBanner({
      type: "success",
      text: "Đã lưu biên bản Review sáng Thứ Hai.",
    });
    await loadAll();
  }

  if (deniedCode) {
    return (
      <section
        className="scaffold-status denied-box"
        role="alert"
        data-testid="planning-denied-box"
      >
        <h2>Giới hạn quyền truy cập dữ liệu nghiệp vụ (ADR-002)</h2>
        <p>
          Vai trò <code>{actorRoleCode}</code> chỉ quản trị cấu hình hệ thống,
          không có quyền truy cập kế hoạch bán hàng hay nhật ký hoạt động (
          <code>{deniedCode}</code>).
        </p>
      </section>
    );
  }

  return (
    <div className="org-panel-wrapper" data-testid="planning-panel">
      {banner && (
        <div
          role="status"
          data-testid="planning-banner"
          className={`scaffold-status ${banner.type === "error" ? "banner-error" : "banner-success"}`}
        >
          <p>{banner.text}</p>
        </div>
      )}

      {/* 1. Sales Plans Section */}
      <section
        className="scaffold-status"
        aria-labelledby="sales-plans-heading"
      >
        <h2 id="sales-plans-heading">
          1. Kế hoạch Bán hàng Tuần / Ngày (tự động tổng hợp từ Nhật ký một
          nguồn)
        </h2>

        {loading ? (
          <p data-testid="planning-loading">
            Đang tải kế hoạch và hoạt động...
          </p>
        ) : plans.length === 0 ? (
          <p data-testid="sales-plans-empty">
            Chưa có kế hoạch bán hàng nào trong phạm vi của bạn.
          </p>
        ) : (
          <div className="table-scroll">
            <table
              className="data-table"
              data-testid="sales-plans-table"
              aria-label="Bảng kế hoạch bán hàng"
            >
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Nhân sự</th>
                  <th>Tiêu đề kế hoạch</th>
                  <th>Trạng thái</th>
                  <th>Hoạt động liên kết (Single Source)</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} data-testid={`sales-plan-row-${p.id}`}>
                    <td>
                      <code>
                        {p.period_type}: {p.period_key}
                      </code>
                    </td>
                    <td>
                      {p.staff_code} ({p.department_code})
                    </td>
                    <td>{p.title}</td>
                    <td>
                      <code>{p.status}</code>
                    </td>
                    <td data-testid={`plan-activity-count-${p.id}`}>
                      Tổng: <strong>{p.activity_summary.total_count}</strong> |
                      Hoàn tất:{" "}
                      <strong>{p.activity_summary.completed_count}</strong> |
                      Cần theo dõi: {p.activity_summary.follow_up_needed_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          onSubmit={handleCreatePlan}
          className="inline-form"
          data-testid="create-sales-plan-form"
        >
          <h3>Lập Kế hoạch Tuần / Ngày mới</h3>
          <div className="form-grid">
            <label>
              Loại kỳ
              <select
                data-testid="select-plan-period-type"
                value={planPeriodType}
                onChange={(e) => {
                  const v = e.target.value as "WEEK" | "DAY";
                  setPlanPeriodType(v);
                  setPlanPeriodKey(v === "WEEK" ? "2026-W46" : "2026-11-10");
                }}
              >
                <option value="WEEK">WEEK (Tuần)</option>
                <option value="DAY">DAY (Ngày)</option>
              </select>
            </label>
            <label>
              Mã kỳ
              <input
                type="text"
                required
                data-testid="input-plan-period-key"
                value={planPeriodKey}
                onChange={(e) => setPlanPeriodKey(e.target.value)}
              />
            </label>
            <label>
              Tiêu đề kế hoạch
              <input
                type="text"
                required
                data-testid="input-plan-title"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
              />
            </label>
            <label>
              Trọng tâm kế hoạch
              <input
                type="text"
                data-testid="input-plan-notes"
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="scaffold-button"
            data-testid="submit-create-plan"
          >
            Lưu kế hoạch bán hàng
          </button>
        </form>
      </section>

      {/* 2. Single-Source Activity Log Section */}
      <section
        className="scaffold-status"
        aria-labelledby="activity-log-heading"
      >
        <h2 id="activity-log-heading">
          2. Nhật ký Hoạt động Một Nguồn (Single Source of Activity — không nhập
          lặp)
        </h2>

        <form
          onSubmit={handleCreateActivity}
          className="inline-form"
          data-testid="create-activity-form"
        >
          <h3>Ghi nhận hoạt động bán hàng mới</h3>
          <div className="form-grid">
            <label>
              Kế hoạch liên kết
              <select
                data-testid="select-activity-plan"
                value={actPlanId}
                onChange={(e) => setActPlanId(e.target.value)}
              >
                <option value="">-- Không gắn kế hoạch cụ thể --</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_key} — {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Loại hoạt động
              <select
                data-testid="select-activity-type"
                value={actType}
                onChange={(e) => setActType(e.target.value)}
              >
                <option value="CUSTOMER_VISIT">CUSTOMER_VISIT</option>
                <option value="CALL">CALL</option>
                <option value="CONSULTATION">CONSULTATION</option>
                <option value="LOAN_APP_INTAKE">LOAN_APP_INTAKE</option>
                <option value="DEPOSIT_PITCH">DEPOSIT_PITCH</option>
                <option value="CARD_CROSS_SELL">CARD_CROSS_SELL</option>
                <option value="INSURANCE_PITCH">INSURANCE_PITCH</option>
                <option value="FOLLOW_UP">FOLLOW_UP</option>
              </select>
            </label>
            <label>
              Trạng thái
              <select
                data-testid="select-activity-status"
                value={actStatus}
                onChange={(e) => setActStatus(e.target.value)}
              >
                <option value="PLANNED">PLANNED</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FOLLOW_UP_NEEDED">FOLLOW_UP_NEEDED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>
            <label>
              Mã KH Synthetic
              <input
                type="text"
                data-testid="input-activity-customer-ref"
                value={actCustRef}
                onChange={(e) => setActCustRef(e.target.value)}
              />
            </label>
            <label>
              Kết quả tóm tắt
              <input
                type="text"
                required
                data-testid="input-activity-outcome"
                value={actOutcome}
                onChange={(e) => setActOutcome(e.target.value)}
              />
            </label>
            <label>
              Bước tiếp theo
              <input
                type="text"
                data-testid="input-activity-next-step"
                value={actNextStep}
                onChange={(e) => setActNextStep(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="scaffold-button"
            data-testid="submit-create-activity"
          >
            Ghi nhận hoạt động
          </button>
        </form>

        {activities.length === 0 ? (
          <p data-testid="activities-empty">
            Chưa có hoạt động nào trong tuần {weekKey}.
          </p>
        ) : (
          <div className="table-scroll">
            <table
              className="data-table"
              data-testid="activities-table"
              aria-label="Bảng nhật ký hoạt động một nguồn"
            >
              <thead>
                <tr>
                  <th>Ngày (VN)</th>
                  <th>Nhân sự</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                  <th>KH Synthetic</th>
                  <th>Kết quả &amp; Bước tiếp theo</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id} data-testid={`activity-row-${a.id}`}>
                    <td>
                      <code>{a.occurred_date_vn}</code>
                      {a.is_after_daily_cutoff && " (Sau 18:00)"}
                    </td>
                    <td>
                      {a.actor_staff_code} ({a.department_code})
                    </td>
                    <td>
                      <code>{a.activity_type}</code>
                    </td>
                    <td>
                      <code>{a.status}</code>
                    </td>
                    <td>{a.synthetic_customer_ref ?? "—"}</td>
                    <td>
                      {a.outcome_summary}
                      {a.next_step ? ` → ${a.next_step}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Monday Review & Directives Section */}
      <section
        className="scaffold-status"
        aria-labelledby="monday-review-heading"
      >
        <h2 id="monday-review-heading">
          3. Review sáng Thứ Hai &amp; Chỉ đạo quản trị (tổng hợp từ Single
          Source)
        </h2>
        <div className="filter-row">
          <label htmlFor="week-key-input">Tuần Review: </label>
          <input
            id="week-key-input"
            type="text"
            data-testid="input-review-week-key"
            value={weekKey}
            onChange={(e) => setWeekKey(e.target.value)}
          />
        </div>

        {bundle && (
          <>
            <p data-testid="monday-review-week-bounds">
              Kỳ tuần <code>{bundle.week_period_key}</code>: từ Thứ Hai{" "}
              <code>{bundle.week_start_vn}</code> đến Chủ Nhật{" "}
              <code>{bundle.week_end_vn}</code> (<code>Asia/Ho_Chi_Minh</code>).
            </p>
            <div className="table-scroll">
              <table
                className="data-table"
                data-testid="monday-rollup-table"
                aria-label="Bảng tổng hợp Review sáng Thứ Hai"
              >
                <thead>
                  <tr>
                    <th>Nhân sự</th>
                    <th>Phòng</th>
                    <th>Số kế hoạch</th>
                    <th>Tổng hoạt động</th>
                    <th>Hoàn tất</th>
                    <th>Cần theo dõi</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.weekly_activity_rollup.map((r) => (
                    <tr
                      key={r.staff_id}
                      data-testid={`rollup-row-${r.staff_code}`}
                    >
                      <td>
                        <code>{r.staff_code}</code> — {r.staff_name}
                      </td>
                      <td>{r.department_code}</td>
                      <td>{r.plans_count}</td>
                      <td data-testid={`rollup-total-${r.staff_code}`}>
                        <strong>{r.activities_total}</strong>
                      </td>
                      <td data-testid={`rollup-completed-${r.staff_code}`}>
                        <strong>{r.activities_completed}</strong>
                      </td>
                      <td>{r.activities_follow_up_needed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {(actorRoleCode === "EXECUTIVE" ||
          actorRoleCode === "DEPARTMENT_MANAGER") && (
          <form
            onSubmit={handleCreateMondayReview}
            className="inline-form"
            data-testid="create-monday-review-form"
          >
            <h3>Ghi nhận Biên bản Review sáng Thứ Hai</h3>
            <div className="form-grid">
              <label>
                Tóm tắt kết luận Review
                <input
                  type="text"
                  required
                  data-testid="input-review-summary"
                  value={reviewSummary}
                  onChange={(e) => setReviewSummary(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="scaffold-button"
              data-testid="submit-create-review"
            >
              Lưu biên bản Review Thứ Hai
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
