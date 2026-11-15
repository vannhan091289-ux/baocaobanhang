"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEventRow {
  id: string;
  occurred_at: string;
  actor_staff_code: string | null;
  actor_display_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: "ALLOW" | "DENY";
  reason_code: string;
  policy_version: string;
}

export function AuditViewerPanel() {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<"" | "ALLOW" | "DENY">(
    "",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const qs = new URLSearchParams({ limit: "20" });
      if (decisionFilter) {
        qs.set("decision", decisionFilter);
      }
      const res = await fetch(`/api/audit-events?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        data?: {
          items?: AuditEventRow[];
          privilege_restricted?: boolean;
          notice?: string;
        };
        page?: { total: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setEvents(json.data?.items ?? []);
      setNotice(json.data?.notice ?? null);
      setTotal(json.page?.total ?? 0);
    } catch {
      setError("Không thể tải nhật ký kiểm toán.");
    } finally {
      setLoading(false);
    }
  }, [decisionFilter]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAudit());
  }, [loadAudit]);

  return (
    <section
      id="audit-events"
      className="scaffold-status"
      aria-labelledby="audit-events-heading"
      data-testid="audit-events-panel"
    >
      <h2 id="audit-events-heading">
        Nhật ký Kiểm toán Bảo mật &amp; Phân quyền (Audit Events — Read-Only)
      </h2>
      <p>
        Tổng số sự kiện ghi nhận: <strong>{total}</strong>. Chỉ{" "}
        <code>CONFIG_ADMIN</code> và <code>EXECUTIVE</code> được phép xem; không
        hiển thị bí mật, token hay PII.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <label>
          Lọc quyết định{" "}
          <select
            aria-label="Lọc quyết định audit"
            value={decisionFilter}
            onChange={(e) =>
              setDecisionFilter(e.target.value as "" | "ALLOW" | "DENY")
            }
          >
            <option value="">Tất cả</option>
            <option value="ALLOW">ALLOW</option>
            <option value="DENY">DENY</option>
          </select>
        </label>
        <button
          type="button"
          className="scaffold-button"
          onClick={() => void loadAudit()}
          disabled={loading}
        >
          {loading ? "Đang tải..." : "Làm mới nhật ký"}
        </button>
      </div>

      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          data-testid="audit-privilege-notice"
          style={{ color: "#92400e", fontSize: "0.9rem" }}
        >
          {notice}
        </p>
      ) : null}

      <div
        tabIndex={0}
        role="region"
        aria-labelledby="audit-events-heading"
        className="table-wrapper"
        style={{ overflowX: "auto" }}
      >
        <table
          data-testid="audit-events-table"
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              <th scope="col">Thời điểm</th>
              <th scope="col">Nhân sự</th>
              <th scope="col">Hành động</th>
              <th scope="col">Tài nguyên</th>
              <th scope="col">Quyết định</th>
              <th scope="col">Mã lý do</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={6}>Chưa có bản ghi phù hợp.</td>
              </tr>
            ) : (
              events.map((ev) => (
                <tr key={ev.id}>
                  <td>{new Date(ev.occurred_at).toLocaleString("vi-VN")}</td>
                  <td>
                    {ev.actor_staff_code
                      ? `${ev.actor_staff_code} (${ev.actor_display_name ?? ""})`
                      : "Hệ thống / Chưa xác thực"}
                  </td>
                  <td>
                    <code>{ev.action}</code>
                  </td>
                  <td>
                    <code>{ev.resource_type}</code>
                  </td>
                  <td>
                    <span className="scaffold-badge">{ev.decision}</span>
                  </td>
                  <td>
                    <code>{ev.reason_code}</code>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
