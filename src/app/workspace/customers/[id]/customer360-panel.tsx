"use client";

import { useCallback, useEffect, useState } from "react";
import type { Customer360Bundle } from "@/server/customers/p0d-service";

interface Props {
  customerId: string;
  actorRoleCode: string;
  csrfToken: string;
}

export function Customer360Panel({
  customerId,
  actorRoleCode,
  csrfToken,
}: Props) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
  const [bundle, setBundle] = useState<Customer360Bundle | null>(null);
  const [loading, setLoading] = useState(!isConfigAdmin);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [msType, setMsType] = useState<"MATURITY" | "RENEWAL" | "REVIEW">(
    "MATURITY",
  );
  const [msDueDate, setMsDueDate] = useState("2026-11-18");
  const [msTitle, setMsTitle] = useState("");

  const loadBundle = useCallback(async () => {
    if (isConfigAdmin) return;
    const res = await fetch(`/api/customers/${customerId}/360`);
    const j = (await res.json()) as {
      ok?: boolean;
      data?: Customer360Bundle;
      error?: { code?: string; message?: string };
    };
    if (!res.ok || !j.data) {
      setErrorMsg(
        j.error?.code ?? j.error?.message ?? "Không tải được Customer 360",
      );
      setBundle(null);
    } else {
      setBundle(j.data);
    }
    setLoading(false);
  }, [customerId, isConfigAdmin]);

  useEffect(() => {
    if (isConfigAdmin) return;
    let active = true;
    fetch(`/api/customers/${customerId}/360`)
      .then((res) =>
        res.json().then((j) => ({
          ok: res.ok,
          j: j as {
            data?: Customer360Bundle;
            error?: { code?: string; message?: string };
          },
        })),
      )
      .then(({ ok, j }) => {
        if (!active) return;
        if (!ok || !j.data) {
          setErrorMsg(
            j.error?.code ?? j.error?.message ?? "Không tải được Customer 360",
          );
          setBundle(null);
        } else {
          setBundle(j.data);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, isConfigAdmin]);

  if (isConfigAdmin) {
    return (
      <section
        className="scaffold-status"
        aria-labelledby="cust360-admin-denied"
        data-testid="customers-denied-box"
      >
        <h2 id="cust360-admin-denied">
          Từ chối truy cập Customer 360 nghiệp vụ (403)
        </h2>
        <p>
          Vai trò <code>CONFIG_ADMIN</code> bị chặn khỏi chi tiết Customer 360 (
          <code>CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN</code>).
        </p>
      </section>
    );
  }

  async function handleAddMilestone(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch(`/api/customers/${customerId}/milestones`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        milestone_type: msType,
        due_date: msDueDate,
        title: msTitle,
      }),
    });
    const j = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setErrorMsg(j.error?.code ?? j.error?.message ?? "Lỗi tạo mốc chăm sóc");
    } else {
      setStatusMsg("Đã thêm mốc tái cấp/đáo hạn thành công.");
      setMsTitle("");
      await loadBundle();
    }
  }

  if (loading) {
    return <p>Đang tải hồ sơ Customer 360...</p>;
  }

  if (!bundle) {
    return (
      <div role="alert" className="scaffold-error" data-testid="cust360-error">
        <strong>Lỗi:</strong> {errorMsg ?? "RESOURCE_NOT_FOUND_OR_OUT_OF_SCOPE"}
      </div>
    );
  }

  const { customer, milestones, opportunities, activity_logs, alerts } = bundle;

  return (
    <div className="scaffold-stack" data-testid="customer360-bundle">
      {errorMsg ? (
        <div role="alert" className="scaffold-error">
          <strong>Lỗi:</strong> {errorMsg}
        </div>
      ) : null}
      {statusMsg ? (
        <div
          role="status"
          className="scaffold-status"
          data-testid="cust360-status"
        >
          {statusMsg}
        </div>
      ) : null}

      <section className="scaffold-card" aria-labelledby="cust-summary-heading">
        <h2 id="cust-summary-heading">
          {customer.display_name} (<code>{customer.customer_ref_code}</code>)
        </h2>
        <p>
          Phân khúc: <strong>{customer.segment_code}</strong> • Phòng:{" "}
          <strong>{customer.managing_department_code}</strong> • NV phụ trách:{" "}
          <strong>{customer.assigned_staff_code}</strong> • Đáo hạn:{" "}
          <strong>{customer.maturity_date ?? "—"}</strong>
        </p>
      </section>

      <section className="scaffold-card" aria-labelledby="ms-heading">
        <h2 id="ms-heading">Mốc tái cấp / đáo hạn (customer_milestones)</h2>
        <form onSubmit={handleAddMilestone} className="scaffold-form-row">
          <label>
            Loại mốc
            <select
              value={msType}
              onChange={(e) =>
                setMsType(e.target.value as "MATURITY" | "RENEWAL" | "REVIEW")
              }
            >
              <option value="MATURITY">MATURITY</option>
              <option value="RENEWAL">RENEWAL</option>
              <option value="REVIEW">REVIEW</option>
            </select>
          </label>
          <label>
            Ngày đến hạn
            <input
              type="date"
              required
              value={msDueDate}
              onChange={(e) => setMsDueDate(e.target.value)}
            />
          </label>
          <label>
            Tiêu đề mốc
            <input
              type="text"
              required
              value={msTitle}
              onChange={(e) => setMsTitle(e.target.value)}
              placeholder="Đáo hạn khoản vay Synthetic"
              data-testid="input-milestone-title"
            />
          </label>
          <button
            type="submit"
            className="scaffold-button"
            data-testid="submit-create-milestone"
          >
            Thêm mốc
          </button>
        </form>
        {milestones.length === 0 ? (
          <p>Chưa có mốc nào.</p>
        ) : (
          <ul>
            {milestones.map((m) => (
              <li key={m.id}>
                [{m.milestone_type}] {m.due_date} — {m.title} ({m.status})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="scaffold-card" aria-labelledby="opps-heading">
        <h2 id="opps-heading">Cơ hội liên kết ({opportunities.length})</h2>
        {opportunities.length === 0 ? (
          <p>Chưa có cơ hội liên kết.</p>
        ) : (
          <ul>
            {opportunities.map((o) => (
              <li key={o.id}>
                <code>{o.opportunity_ref}</code> — {o.display_label} ({o.stage},{" "}
                {o.estimated_value.toLocaleString("vi-VN")})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="scaffold-card" aria-labelledby="acts-heading">
        <h2 id="acts-heading">Hoạt động chăm sóc ({activity_logs.length})</h2>
        {activity_logs.length === 0 ? (
          <p>Chưa có hoạt động chăm sóc nào.</p>
        ) : (
          <ul>
            {activity_logs.map((a) => (
              <li key={a.id}>
                [{a.activity_type}] {a.occurred_at.slice(0, 10)} —{" "}
                {a.outcome_note ?? a.status} ({a.actor_staff_code})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="scaffold-card" aria-labelledby="cust-alerts-heading">
        <h2 id="cust-alerts-heading">Cảnh báo liên quan ({alerts.length})</h2>
        {alerts.length === 0 ? (
          <p>Chưa có cảnh báo nào.</p>
        ) : (
          <ul>
            {alerts.map((al) => (
              <li key={al.id}>
                [{al.severity}] {al.title} ({al.resolution_status})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
