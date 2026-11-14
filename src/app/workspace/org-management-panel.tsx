"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { DataScopeType, RoleCode } from "@/server/policy";

interface DepartmentItem {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  row_version: number;
}

interface StaffItem {
  id: string;
  staff_code: string;
  display_name: string;
  department_id: string;
  status: "ACTIVE" | "INACTIVE";
  row_version: number;
}

interface IdentityLinkItem {
  id: string;
  issuer: string;
  subject: string;
  staff_id: string;
  status: "ACTIVE" | "REVOKED";
  row_version: number;
}

interface RoleAssignmentItem {
  id: string;
  staff_id: string;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "ACTIVE" | "REVOKED";
  row_version: number;
}

interface ProposalItem {
  id: string;
  target_staff_id: string;
  propose_action: "ASSIGN" | "REVOKE";
  target_assignment_id: string | null;
  role_code: RoleCode;
  scope_type: DataScopeType;
  scope_department_id: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  proposer_staff_id: string;
  proposer_reason: string;
  approver_staff_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  applied_assignment_id: string | null;
  row_version: number;
}

export interface OrgManagementPanelProps {
  csrfToken: string;
  actorStaffId: string;
  actorRoleCode: RoleCode;
  actorScopeType: DataScopeType;
}

export function OrgManagementPanel({
  csrfToken,
  actorRoleCode,
}: OrgManagementPanelProps) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";
  const isExecutive = actorRoleCode === "EXECUTIVE";
  const canViewAdminGovernance = isConfigAdmin || isExecutive;

  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [identityLinks, setIdentityLinks] = useState<IdentityLinkItem[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignmentItem[]>(
    [],
  );
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Department Create Form
  const [newDeptCode, setNewDeptCode] = useState("");
  const [newDeptName, setNewDeptName] = useState("");

  // Staff Create Form
  const [newStaffCode, setNewStaffCode] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffDeptId, setNewStaffDeptId] = useState("");

  // Proposal Create Form (CONFIG_ADMIN Maker)
  const [propTargetStaffId, setPropTargetStaffId] = useState("");
  const [propRoleCode, setPropRoleCode] = useState<RoleCode>("STAFF");
  const [propReason, setPropReason] = useState("");

  // Decision Form (EXECUTIVE Checker)
  const [decisionReasons, setDecisionReasons] = useState<
    Record<string, string>
  >({});

  const deptById = React.useMemo(() => {
    const map = new Map<string, DepartmentItem>();
    for (const d of departments) map.set(d.id, d);
    return map;
  }, [departments]);

  const staffById = React.useMemo(() => {
    const map = new Map<string, StaffItem>();
    for (const s of staffList) map.set(s.id, s);
    return map;
  }, [staffList]);

  const loadAll = useCallback(async () => {
    try {
      const [deptRes, staffRes, roleRes] = await Promise.all([
        fetch("/api/org/departments", { cache: "no-store" }),
        fetch("/api/org/staff", { cache: "no-store" }),
        fetch("/api/role-assignments", { cache: "no-store" }),
      ]);

      if (deptRes.ok) {
        const d = (await deptRes.json()) as { data: DepartmentItem[] };
        const items = d.data ?? [];
        setDepartments(items);
        setNewStaffDeptId((prev) => {
          if (prev || items.length === 0) return prev;
          const firstActive =
            items.find((x) => x.status === "ACTIVE") ?? items[0];
          return firstActive ? firstActive.id : prev;
        });
      }
      if (staffRes.ok) {
        const s = (await staffRes.json()) as { data: StaffItem[] };
        const items = s.data ?? [];
        setStaffList(items);
        setPropTargetStaffId((prev) =>
          prev || items.length === 0 ? prev : items[0]!.id,
        );
      }
      if (roleRes.ok) {
        const r = (await roleRes.json()) as { data: RoleAssignmentItem[] };
        setRoleAssignments(r.data ?? []);
      }

      if (canViewAdminGovernance) {
        const [linkRes, propRes] = await Promise.all([
          fetch("/api/org/identity-links", { cache: "no-store" }),
          fetch("/api/role-assignments/proposals", { cache: "no-store" }),
        ]);
        if (linkRes.ok) {
          const l = (await linkRes.json()) as { data: IdentityLinkItem[] };
          setIdentityLinks(l.data ?? []);
        }
        if (propRes.ok) {
          const p = (await propRes.json()) as { data: ProposalItem[] };
          setProposals(p.data ?? []);
        }
      }
    } catch {
      setErrorBanner("Không thể tải dữ liệu quản trị tổ chức & phân quyền.");
    } finally {
      setLoading(false);
    }
  }, [canViewAdminGovernance]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadAll();
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    setErrorBanner(null);
    setStatusBanner(null);

    const res = await fetch("/api/org/departments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        code: newDeptCode.trim(),
        name: newDeptName.trim(),
      }),
    });

    const payload = (await res.json()) as {
      data?: DepartmentItem;
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      setErrorBanner(
        `Lỗi tạo phòng ban (${res.status}): ${payload.error?.code ?? "ERROR"} - ${payload.error?.message ?? ""}`,
      );
      return;
    }

    setStatusBanner(
      `Đã tạo phòng ban ${payload.data?.code ?? newDeptCode} thành công.`,
    );
    setNewDeptCode("");
    setNewDeptName("");
    await loadAll();
  }

  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault();
    setErrorBanner(null);
    setStatusBanner(null);

    const res = await fetch("/api/org/staff", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        staff_code: newStaffCode.trim(),
        display_name: newStaffName.trim(),
        department_id: newStaffDeptId,
      }),
    });

    const payload = (await res.json()) as {
      data?: StaffItem;
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      setErrorBanner(
        `Lỗi tạo nhân sự (${res.status}): ${payload.error?.code ?? "ERROR"} - ${payload.error?.message ?? ""}`,
      );
      return;
    }

    setStatusBanner(
      `Đã tạo hồ sơ nhân sự ${payload.data?.staff_code ?? newStaffCode} thành công.`,
    );
    if (payload.data?.id) {
      setPropTargetStaffId(payload.data.id);
    }
    setNewStaffCode("");
    setNewStaffName("");
    await loadAll();
  }

  async function handleCreateProposal(e: React.FormEvent) {
    e.preventDefault();
    setErrorBanner(null);
    setStatusBanner(null);

    const res = await fetch("/api/role-assignments/proposals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        target_staff_id: propTargetStaffId,
        propose_action: "ASSIGN",
        role_code: propRoleCode,
        reason: propReason.trim(),
      }),
    });

    const payload = (await res.json()) as {
      data?: ProposalItem;
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      setErrorBanner(
        `Lỗi tạo đề xuất phân quyền (${res.status}): ${payload.error?.code ?? "ERROR"} - ${payload.error?.message ?? ""}`,
      );
      return;
    }

    setStatusBanner(
      `Đã gửi đề xuất phân quyền (${payload.data?.status ?? "PENDING"}) mã ${payload.data?.id ?? ""}.`,
    );
    setPropReason("");
    await loadAll();
  }

  async function handleDecideProposal(
    proposal: ProposalItem,
    decision: "APPROVE" | "REJECT",
  ) {
    setErrorBanner(null);
    setStatusBanner(null);

    const reason =
      (decisionReasons[proposal.id] ?? "").trim() ||
      (decision === "APPROVE"
        ? "Ban Giám đốc phê duyệt đề xuất phân quyền (Synthetic Checker)."
        : "Ban Giám đốc từ chối đề xuất phân quyền (Synthetic Checker).");

    const res = await fetch(
      `/api/role-assignments/proposals/${proposal.id}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          decision,
          reason,
          expected_version: proposal.row_version,
        }),
      },
    );

    const payload = (await res.json()) as {
      data?: ProposalItem;
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      setErrorBanner(
        `Lỗi phê duyệt đề xuất (${res.status}): ${payload.error?.code ?? "ERROR"} - ${payload.error?.message ?? ""}`,
      );
      return;
    }

    setStatusBanner(
      `Đã xử lý đề xuất ${proposal.id}: ${payload.data?.status ?? decision}.`,
    );
    await loadAll();
  }

  return (
    <div className="s1b-panel" data-testid="s1b-org-management-panel">
      {errorBanner && (
        <div
          role="alert"
          className="s1b-alert s1b-alert-error"
          data-testid="s1b-error-banner"
        >
          {errorBanner}
        </div>
      )}
      {statusBanner && (
        <div
          role="status"
          className="s1b-alert s1b-alert-success"
          data-testid="s1b-status-banner"
        >
          {statusBanner}
        </div>
      )}

      {/* 1. Departments */}
      <section
        className="scaffold-status"
        aria-labelledby="s1b-departments-heading"
      >
        <h2 id="s1b-departments-heading">
          Danh mục Phòng ban (Departments — S1-B)
        </h2>
        {loading ? (
          <p data-testid="s1b-loading">Đang tải dữ liệu phòng ban...</p>
        ) : departments.length === 0 ? (
          <p>Không có phòng ban nào trong phạm vi hiển thị.</p>
        ) : (
          <div className="s1b-table-wrap">
            <table className="s1b-table" data-testid="s1b-departments-table">
              <caption>Danh sách phòng ban trong phạm vi dữ liệu</caption>
              <thead>
                <tr>
                  <th scope="col">Mã phòng</th>
                  <th scope="col">Tên phòng ban</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Phiên bản (row_version)</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id} data-testid={`dept-row-${d.code}`}>
                    <td>
                      <code>{d.code}</code>
                    </td>
                    <td>{d.name}</td>
                    <td>{d.status}</td>
                    <td>{d.row_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isConfigAdmin && (
          <form
            onSubmit={handleCreateDepartment}
            className="s1b-form"
            aria-label="Tạo phòng ban mới"
            data-testid="s1b-create-department-form"
          >
            <h3>Tạo phòng ban mới (CONFIG_ADMIN)</h3>
            <div className="s1b-form-row">
              <label htmlFor="new-dept-code">Mã phòng ban</label>
              <input
                id="new-dept-code"
                data-testid="input-dept-code"
                type="text"
                value={newDeptCode}
                onChange={(e) => setNewDeptCode(e.target.value)}
                placeholder="VD: KHDN2"
                required
              />
            </div>
            <div className="s1b-form-row">
              <label htmlFor="new-dept-name">Tên phòng ban</label>
              <input
                id="new-dept-name"
                data-testid="input-dept-name"
                type="text"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="Phòng KHDN 2 (Synthetic)"
                required
              />
            </div>
            <button
              type="submit"
              className="scaffold-button"
              data-testid="submit-create-dept"
            >
              Thêm phòng ban
            </button>
          </form>
        )}
      </section>

      {/* 2. Staff */}
      <section className="scaffold-status" aria-labelledby="s1b-staff-heading">
        <h2 id="s1b-staff-heading">Danh mục Nhân sự (Staff — S1-B)</h2>
        {loading ? (
          <p>Đang tải danh sách nhân sự...</p>
        ) : staffList.length === 0 ? (
          <p>Không có nhân sự nào trong phạm vi hiển thị.</p>
        ) : (
          <div className="s1b-table-wrap">
            <table className="s1b-table" data-testid="s1b-staff-table">
              <caption>Danh sách nhân sự theo phạm vi quyền</caption>
              <thead>
                <tr>
                  <th scope="col">Mã nhân sự</th>
                  <th scope="col">Họ và tên (Synthetic)</th>
                  <th scope="col">Phòng ban</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Phiên bản</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s) => {
                  const dept = deptById.get(s.department_id);
                  return (
                    <tr key={s.id} data-testid={`staff-row-${s.staff_code}`}>
                      <td>
                        <code>{s.staff_code}</code>
                      </td>
                      <td>{s.display_name}</td>
                      <td>
                        {dept ? `${dept.name} (${dept.code})` : s.department_id}
                      </td>
                      <td>{s.status}</td>
                      <td>{s.row_version}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {isConfigAdmin && (
          <form
            onSubmit={handleCreateStaff}
            className="s1b-form"
            aria-label="Tạo nhân sự mới"
            data-testid="s1b-create-staff-form"
          >
            <h3>Tạo nhân sự mới (CONFIG_ADMIN)</h3>
            <div className="s1b-form-row">
              <label htmlFor="new-staff-code">Mã nhân sự</label>
              <input
                id="new-staff-code"
                data-testid="input-staff-code"
                type="text"
                value={newStaffCode}
                onChange={(e) => setNewStaffCode(e.target.value)}
                placeholder="VD: SYN-STAFF-NEW-01"
                required
              />
            </div>
            <div className="s1b-form-row">
              <label htmlFor="new-staff-name">Họ và tên (Synthetic)</label>
              <input
                id="new-staff-name"
                data-testid="input-staff-name"
                type="text"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                placeholder="Chuyên viên Synthetic Mới"
                required
              />
            </div>
            <div className="s1b-form-row">
              <label htmlFor="new-staff-dept">Phòng ban trực thuộc</label>
              <select
                id="new-staff-dept"
                data-testid="select-staff-dept"
                value={newStaffDeptId}
                onChange={(e) => setNewStaffDeptId(e.target.value)}
                required
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name} ({d.status})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="scaffold-button"
              data-testid="submit-create-staff"
            >
              Thêm nhân sự
            </button>
          </form>
        )}
      </section>

      {/* 3. Role Assignments */}
      <section
        className="scaffold-status"
        aria-labelledby="s1b-role-assignments-heading"
      >
        <h2 id="s1b-role-assignments-heading">
          Phân quyền hiệu lực (Role Assignments)
        </h2>
        {loading ? (
          <p>Đang tải danh sách phân quyền...</p>
        ) : roleAssignments.length === 0 ? (
          <p>Không có bản ghi phân quyền nào trong phạm vi hiển thị.</p>
        ) : (
          <div className="s1b-table-wrap">
            <table
              className="s1b-table"
              data-testid="s1b-role-assignments-table"
            >
              <caption>Danh sách phân quyền theo phạm vi</caption>
              <thead>
                <tr>
                  <th scope="col">Mã nhân sự</th>
                  <th scope="col">Vai trò</th>
                  <th scope="col">Phạm vi</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Hiệu lực từ</th>
                </tr>
              </thead>
              <tbody>
                {roleAssignments.map((r) => {
                  const st = staffById.get(r.staff_id);
                  const staffCode = st?.staff_code ?? r.staff_id;
                  return (
                    <tr
                      key={r.id}
                      data-testid={`role-assignment-row-${staffCode}-${r.status}`}
                    >
                      <td>
                        <code>{staffCode}</code>
                      </td>
                      <td>{r.role_code}</td>
                      <td>{r.scope_type}</td>
                      <td>{r.status}</td>
                      <td>{r.effective_from}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Governance: Role Assignment Proposals (Maker-Checker) & Identity Links */}
      {canViewAdminGovernance ? (
        <section
          className="scaffold-status"
          aria-labelledby="s1b-proposals-heading"
        >
          <h2 id="s1b-proposals-heading">
            Quy trình Phân quyền 2 bước (Maker-Checker Proposals — D-09)
          </h2>
          <p>
            <code>CONFIG_ADMIN</code> tạo đề xuất (Maker);{" "}
            <code>EXECUTIVE</code> phê duyệt hoặc từ chối (Checker). Nghiêm cấm
            tự nâng quyền hoặc tự duyệt đề xuất của chính mình.
          </p>

          {proposals.length === 0 ? (
            <p data-testid="s1b-proposals-empty">
              Chưa có đề xuất phân quyền nào.
            </p>
          ) : (
            <div className="s1b-table-wrap">
              <table className="s1b-table" data-testid="s1b-proposals-table">
                <caption>Danh sách đề xuất thay đổi vai trò</caption>
                <thead>
                  <tr>
                    <th scope="col">Nhân sự mục tiêu</th>
                    <th scope="col">Vai trò đề xuất</th>
                    <th scope="col">Phạm vi</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Lý do đề xuất</th>
                    <th scope="col">Hành động (Checker)</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => {
                    const targetStaff = staffById.get(p.target_staff_id);
                    const targetCode =
                      targetStaff?.staff_code ?? p.target_staff_id;
                    return (
                      <tr
                        key={p.id}
                        data-testid={`proposal-row-${targetCode}-${p.status}`}
                      >
                        <td>
                          <code>{targetCode}</code>
                        </td>
                        <td>{p.role_code}</td>
                        <td>{p.scope_type}</td>
                        <td data-testid={`proposal-status-${p.id}`}>
                          {p.status}
                        </td>
                        <td>{p.proposer_reason}</td>
                        <td>
                          {isExecutive && p.status === "PENDING" ? (
                            <div className="s1b-decision-box">
                              <input
                                type="text"
                                aria-label={`Lý do phê duyệt cho đề xuất ${targetCode}`}
                                data-testid={`input-decision-reason-${targetCode}`}
                                placeholder="Lý do phê duyệt / từ chối..."
                                value={decisionReasons[p.id] ?? ""}
                                onChange={(e) =>
                                  setDecisionReasons((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value,
                                  }))
                                }
                              />
                              <div className="s1b-decision-buttons">
                                <button
                                  type="button"
                                  className="scaffold-button"
                                  data-testid={`approve-proposal-${targetCode}`}
                                  onClick={() =>
                                    void handleDecideProposal(p, "APPROVE")
                                  }
                                >
                                  Phê duyệt (APPROVE)
                                </button>
                                <button
                                  type="button"
                                  className="scaffold-link"
                                  data-testid={`reject-proposal-${targetCode}`}
                                  onClick={() =>
                                    void handleDecideProposal(p, "REJECT")
                                  }
                                >
                                  Từ chối (REJECT)
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span>
                              {p.status === "PENDING"
                                ? "Chờ EXECUTIVE phê duyệt"
                                : `Đã xử lý (${p.status})`}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {isConfigAdmin && (
            <form
              onSubmit={handleCreateProposal}
              className="s1b-form"
              aria-label="Tạo đề xuất phân quyền mới"
              data-testid="s1b-create-proposal-form"
            >
              <h3>Tạo đề xuất phân quyền (Maker — CONFIG_ADMIN)</h3>
              <div className="s1b-form-row">
                <label htmlFor="prop-target-staff">Nhân sự mục tiêu</label>
                <select
                  id="prop-target-staff"
                  data-testid="select-proposal-staff"
                  value={propTargetStaffId}
                  onChange={(e) => setPropTargetStaffId(e.target.value)}
                  required
                >
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.staff_code} — {s.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="s1b-form-row">
                <label htmlFor="prop-role-code">Vai trò đề xuất</label>
                <select
                  id="prop-role-code"
                  data-testid="select-proposal-role"
                  value={propRoleCode}
                  onChange={(e) => setPropRoleCode(e.target.value as RoleCode)}
                >
                  <option value="STAFF">STAFF (SELF)</option>
                  <option value="DEPARTMENT_MANAGER">
                    DEPARTMENT_MANAGER (DEPARTMENT)
                  </option>
                  <option value="CONFIG_ADMIN">CONFIG_ADMIN (BRANCH)</option>
                  <option value="EXECUTIVE">EXECUTIVE (BRANCH)</option>
                </select>
              </div>
              <div className="s1b-form-row">
                <label htmlFor="prop-reason">Lý do đề xuất</label>
                <input
                  id="prop-reason"
                  data-testid="input-proposal-reason"
                  type="text"
                  value={propReason}
                  onChange={(e) => setPropReason(e.target.value)}
                  placeholder="Cấp quyền nghiệp vụ cho nhân sự mới..."
                  required
                />
              </div>
              <button
                type="submit"
                className="scaffold-button"
                data-testid="submit-create-proposal"
              >
                Gửi đề xuất phân quyền (PENDING)
              </button>
            </form>
          )}

          <h3>
            Liên kết định danh OIDC (Identity Links — {identityLinks.length})
          </h3>
          {identityLinks.length > 0 && (
            <div className="s1b-table-wrap">
              <table
                className="s1b-table"
                data-testid="s1b-identity-links-table"
              >
                <caption>Danh sách liên kết định danh OIDC</caption>
                <thead>
                  <tr>
                    <th scope="col">Mã nhân sự</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {identityLinks.map((l) => {
                    const st = staffById.get(l.staff_id);
                    return (
                      <tr key={l.id}>
                        <td>
                          <code>{st?.staff_code ?? l.staff_id}</code>
                        </td>
                        <td>
                          <code>{l.subject}</code>
                        </td>
                        <td>{l.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section
          className="scaffold-status"
          aria-labelledby="s1b-restricted-governance-heading"
          data-testid="s1b-restricted-governance-notice"
        >
          <h2 id="s1b-restricted-governance-heading">
            Giới hạn quyền quản trị danh mục &amp; phân quyền
          </h2>
          <p>
            Vai trò hiện tại của bạn (<code>{actorRoleCode}</code>) chỉ có quyền
            tra cứu dữ liệu tổ chức trong phạm vi được giao và không có quyền
            thay đổi danh mục hoặc truy cập danh sách liên kết định danh / đề
            xuất phân quyền.
          </p>
        </section>
      )}
    </div>
  );
}
