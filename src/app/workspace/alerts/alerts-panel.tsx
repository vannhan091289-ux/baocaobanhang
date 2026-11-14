"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  AlertRuleConfigRow,
  InAppAlertRow,
} from "@/server/alerts/p0c-alerts-service";

interface Props {
  actorRoleCode: string;
  csrfToken: string;
}

export function AlertsPanel({ actorRoleCode, csrfToken }: Props) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
  const canViewRules = isConfigAdmin || actorRoleCode === "EXECUTIVE";

  const [rules, setRules] = useState<AlertRuleConfigRow[]>([]);
  const [alerts, setAlerts] = useState<InAppAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [evidenceNote, setEvidenceNote] = useState(
    "Đã xử lý theo quy trình synthetic",
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const promises: Promise<void>[] = [];
      if (canViewRules) {
        promises.push(
          fetch("/api/alerts/rules").then(async (res) => {
            if (res.ok) {
              const j = (await res.json()) as { data?: AlertRuleConfigRow[] };
              setRules(j.data ?? []);
            }
          }),
        );
      }
      if (!isConfigAdmin) {
        promises.push(
          fetch("/api/alerts?limit=50").then(async (res) => {
            if (res.ok) {
              const j = (await res.json()) as { data?: InAppAlertRow[] };
              setAlerts(j.data ?? []);
            } else {
              const j = (await res.json()) as { error?: { message: string } };
              setErrorMsg(j.error?.message ?? "Lỗi tải cảnh báo");
            }
          }),
        );
      }
      await Promise.all(promises);
    } catch {
      setErrorMsg("Không thể kết nối máy chủ cảnh báo.");
    } finally {
      setLoading(false);
    }
  }, [canViewRules, isConfigAdmin]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  async function handleToggleRule(rule: AlertRuleConfigRow) {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/alerts/rules", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        id: rule.id,
        expected_version: rule.row_version,
        is_enabled: !rule.is_enabled,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi cập nhật quy tắc cảnh báo");
    } else {
      setStatusMsg(`Đã cập nhật trạng thái quy tắc ${rule.rule_code}.`);
      await loadData();
    }
  }

  async function handleEvaluate() {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ as_of_date: "2026-11-14", period_key: "2026-11" }),
    });
    const j = (await res.json()) as {
      data?: { created_count: number };
      error?: { message: string };
    };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi chạy đánh giá cảnh báo");
    } else {
      setStatusMsg(
        `Đã quét 6 quy tắc P0: tạo mới ${j.data?.created_count ?? 0} cảnh báo (chống trùng dedup_key).`,
      );
      await loadData();
    }
  }

  async function handleMarkRead(alert: InAppAlertRow) {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch(`/api/alerts/${alert.id}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ expected_version: alert.row_version }),
    });
    if (res.ok) {
      setStatusMsg("Đã đánh dấu ĐÃ ĐỌC (trạng thái xử lý vẫn giữ OPEN).");
      await loadData();
    }
  }

  async function handleResolve(
    alert: InAppAlertRow,
    resolutionStatus: "RESOLVED" | "DISMISSED",
  ) {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch(`/api/alerts/${alert.id}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        expected_version: alert.row_version,
        resolution_status: resolutionStatus,
        resolution_note: evidenceNote,
        resolution_evidence_ref: `SYN-EV-${alert.id.slice(0, 8)}`,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi đóng cảnh báo");
    } else {
      setStatusMsg(`Đã chuyển cảnh báo sang ${resolutionStatus}.`);
      await loadData();
    }
  }

  return (
    <div className="scaffold-grid" style={{ gap: "1.5rem" }}>
      {errorMsg ? (
        <div
          role="alert"
          className="scaffold-status"
          data-testid="alerts-error"
        >
          <strong>Lỗi:</strong> {errorMsg}
        </div>
      ) : null}
      {statusMsg ? (
        <div
          role="status"
          className="scaffold-status"
          data-testid="alerts-status"
        >
          {statusMsg}
        </div>
      ) : null}

      {canViewRules ? (
        <section
          className="scaffold-card"
          aria-labelledby="alert-rules-heading"
        >
          <h2 id="alert-rules-heading">
            Cấu hình 6 nhóm quy tắc Cảnh báo P0 (D-04 / ADR-004)
          </h2>
          {rules.length === 0 ? (
            <p className="scaffold-meta">Đang tải quy tắc...</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col">Mã quy tắc</th>
                  <th scope="col">Tên</th>
                  <th scope="col">Ngưỡng</th>
                  <th scope="col">SLA (ngày làm việc)</th>
                  <th scope="col">Trạng thái</th>
                  {isConfigAdmin ? <th scope="col">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.rule_code}</td>
                    <td>{r.rule_name}</td>
                    <td>{r.threshold_value}</td>
                    <td>{r.sla_working_days}</td>
                    <td>{r.is_enabled ? "BẬT" : "TẮT"}</td>
                    {isConfigAdmin ? (
                      <td>
                        <button
                          type="button"
                          className="scaffold-button"
                          onClick={() => void handleToggleRule(r)}
                        >
                          {r.is_enabled ? "Tắt rule" : "Bật rule"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {isConfigAdmin ? (
        <section
          className="scaffold-status"
          aria-labelledby="alerts-config-admin-denied"
          data-testid="alerts-denied-box"
        >
          <h2 id="alerts-config-admin-denied">
            Từ chối truy cập danh sách cảnh báo nghiệp vụ (403)
          </h2>
          <p>
            Vai trò <code>CONFIG_ADMIN</code> chỉ cấu hình ngưỡng{" "}
            <code>alert_rule_configs</code> và bị chặn khỏi nội dung cảnh báo
            kinh doanh/KH (<code>CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN</code>).
          </p>
        </section>
      ) : (
        <section
          className="scaffold-card"
          aria-labelledby="alerts-inbox-heading"
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <h2 id="alerts-inbox-heading">
              Danh sách Cảnh báo P0 Trong ứng dụng
            </h2>
            <button
              type="button"
              className="scaffold-button"
              data-testid="btn-evaluate-alerts"
              onClick={() => void handleEvaluate()}
            >
              Quét &amp; Tạo Cảnh báo P0
            </button>
          </header>

          <label style={{ display: "block", marginBottom: "1rem" }}>
            Ghi chú bằng chứng xử lý
            <input
              aria-label="Ghi chú bằng chứng xử lý"
              type="text"
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              style={{ marginLeft: "0.5rem", minWidth: "280px" }}
            />
          </label>

          {loading ? (
            <p>Đang tải danh sách cảnh báo...</p>
          ) : alerts.length === 0 ? (
            <p className="scaffold-meta">
              Không có cảnh báo nào trong phạm vi.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col">Quy tắc / Mức độ</th>
                  <th scope="col">Tiêu đề</th>
                  <th scope="col">Phụ trách</th>
                  <th scope="col">Đã đọc</th>
                  <th scope="col">Xử lý</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.rule_code}</strong> ({a.severity})
                    </td>
                    <td>
                      {a.title}
                      <div className="scaffold-meta">{a.summary}</div>
                    </td>
                    <td>{a.owner_staff_code}</td>
                    <td>{a.read_at ? "Đã đọc" : "Chưa đọc"}</td>
                    <td>{a.resolution_status}</td>
                    <td
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      {!a.read_at ? (
                        <button
                          type="button"
                          className="scaffold-button"
                          onClick={() => void handleMarkRead(a)}
                        >
                          Đánh dấu đã đọc
                        </button>
                      ) : null}
                      {a.resolution_status === "OPEN" ? (
                        <button
                          type="button"
                          className="scaffold-button"
                          onClick={() => void handleResolve(a, "RESOLVED")}
                        >
                          Xử lý xong (RESOLVED)
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
