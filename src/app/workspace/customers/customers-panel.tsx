"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CustomerReferenceRow } from "@/server/customers/p0d-service";

interface Props {
  actorRoleCode: string;
  csrfToken: string;
}

export function CustomersPanel({ actorRoleCode, csrfToken }: Props) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
  const [customers, setCustomers] = useState<CustomerReferenceRow[]>([]);
  const [loading, setLoading] = useState(!isConfigAdmin);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [refCode, setRefCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [segmentCode, setSegmentCode] = useState<"KHCN" | "KHDN" | "HKD">(
    "KHCN",
  );
  const [maturityDate, setMaturityDate] = useState("2026-11-20");

  const loadCustomers = useCallback(async () => {
    if (isConfigAdmin) return;
    const res = await fetch("/api/customers");
    const j = (await res.json()) as {
      ok?: boolean;
      data?: CustomerReferenceRow[];
      error?: { message?: string };
    };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Không tải được danh sách KH synthetic");
    } else {
      setCustomers(j.data ?? []);
    }
    setLoading(false);
  }, [isConfigAdmin]);

  useEffect(() => {
    if (isConfigAdmin) return;
    let active = true;
    fetch("/api/customers")
      .then((res) =>
        res.json().then((j) => ({
          ok: res.ok,
          j: j as {
            data?: CustomerReferenceRow[];
            error?: { message?: string };
          },
        })),
      )
      .then(({ ok, j }) => {
        if (!active) return;
        if (!ok) {
          setErrorMsg(
            j.error?.message ?? "Không tải được danh sách KH synthetic",
          );
        } else {
          setCustomers(j.data ?? []);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isConfigAdmin]);

  if (isConfigAdmin) {
    return (
      <section
        className="scaffold-status"
        aria-labelledby="customers-config-admin-denied"
        data-testid="customers-denied-box"
      >
        <h2 id="customers-config-admin-denied">
          Từ chối truy cập Customer 360 nghiệp vụ (403)
        </h2>
        <p>
          Vai trò <code>CONFIG_ADMIN</code> chỉ quản trị cấu hình hệ thống và bị
          chặn khỏi dữ liệu khách hàng synthetic (
          <code>CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN</code>).
        </p>
      </section>
    );
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        customer_ref_code: refCode,
        display_name: displayName,
        segment_code: segmentCode,
        maturity_date: maturityDate || undefined,
      }),
    });
    const j = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      setErrorMsg(j.error?.code ?? j.error?.message ?? "Lỗi tạo KH synthetic");
    } else {
      setStatusMsg("Đã tạo Khách hàng synthetic thành công.");
      setRefCode("");
      setDisplayName("");
      await loadCustomers();
    }
  }

  return (
    <div className="scaffold-stack">
      {errorMsg ? (
        <div role="alert" className="scaffold-error">
          <strong>Lỗi:</strong> {errorMsg}
        </div>
      ) : null}
      {statusMsg ? (
        <div
          role="status"
          className="scaffold-status"
          data-testid="customers-status"
        >
          {statusMsg}
        </div>
      ) : null}

      <section className="scaffold-card" aria-labelledby="create-cust-heading">
        <h2 id="create-cust-heading">
          Tạo Khách hàng tham chiếu Synthetic (ADR-005)
        </h2>
        <form onSubmit={handleCreateCustomer} className="scaffold-form-row">
          <label>
            Mã KH Synthetic (SYN-CIF-*)
            <input
              type="text"
              required
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              placeholder="SYN-CIF-KHCN-001"
              data-testid="input-customer-ref"
            />
          </label>
          <label>
            Tên hiển thị synthetic
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="KH Synthetic Retail 01"
              data-testid="input-customer-name"
            />
          </label>
          <label>
            Phân khúc
            <select
              value={segmentCode}
              onChange={(e) =>
                setSegmentCode(e.target.value as "KHCN" | "KHDN" | "HKD")
              }
            >
              <option value="KHCN">KHCN</option>
              <option value="KHDN">KHDN</option>
              <option value="HKD">HKD</option>
            </select>
          </label>
          <label>
            Ngày đáo hạn dự kiến
            <input
              type="date"
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="scaffold-button"
            data-testid="submit-create-customer"
          >
            Tạo KH Synthetic
          </button>
        </form>
      </section>

      <section className="scaffold-card" aria-labelledby="cust-list-heading">
        <h2 id="cust-list-heading">
          Danh sách Khách hàng tham chiếu trong phạm vi
        </h2>
        {loading ? (
          <p>Đang tải...</p>
        ) : customers.length === 0 ? (
          <p>Chưa có Khách hàng tham chiếu nào.</p>
        ) : (
          <table className="scaffold-table">
            <thead>
              <tr>
                <th>Mã KH</th>
                <th>Tên hiển thị</th>
                <th>Phân khúc</th>
                <th>Phòng / NV</th>
                <th>Đáo hạn</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code>{c.customer_ref_code}</code>
                  </td>
                  <td>{c.display_name}</td>
                  <td>{c.segment_code}</td>
                  <td>
                    {c.managing_department_code} / {c.assigned_staff_code}
                  </td>
                  <td>{c.maturity_date ?? "—"}</td>
                  <td>
                    <Link
                      className="scaffold-link"
                      href={`/workspace/customers/${c.id}`}
                      data-testid={`link-customer-360-${c.customer_ref_code}`}
                    >
                      Mở Customer 360
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
