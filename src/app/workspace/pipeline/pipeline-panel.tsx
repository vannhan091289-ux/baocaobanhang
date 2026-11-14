"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  LeadRow,
  OpportunityRow,
  ProspectRow,
} from "@/server/pipeline/p0c-pipeline-service";

interface Props {
  actorRoleCode: string;
  actorStaffId: string;
  csrfToken: string;
}

export function PipelinePanel({
  actorRoleCode,
  actorStaffId,
  csrfToken,
}: Props) {
  const isConfigAdmin = actorRoleCode === "CONFIG_ADMIN";

  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(!isConfigAdmin);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [prosRef, setProsRef] = useState("");
  const [prosLabel, setProsLabel] = useState("");
  const [prosSeg, setProsSeg] = useState<"RETAIL" | "SME" | "CORP">("RETAIL");

  const [leadRef, setLeadRef] = useState("");
  const [leadLabel, setLeadLabel] = useState("");
  const [leadGroup, setLeadGroup] = useState("LOAN");

  const [oppRef, setOppRef] = useState("");
  const [oppCustRef, setOppCustRef] = useState("SYN-CIF-0001");
  const [oppLabel, setOppLabel] = useState("");
  const [oppGroup, setOppGroup] = useState("LOAN");
  const [oppVal, setOppVal] = useState("500000000");

  const loadData = useCallback(async () => {
    if (isConfigAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const [pRes, lRes, oRes] = await Promise.all([
        fetch("/api/pipeline/prospects?limit=50"),
        fetch("/api/pipeline/leads?limit=50"),
        fetch("/api/pipeline/opportunities?limit=50"),
      ]);
      if (pRes.ok) {
        const j = (await pRes.json()) as { data?: ProspectRow[] };
        setProspects(j.data ?? []);
      }
      if (lRes.ok) {
        const j = (await lRes.json()) as { data?: LeadRow[] };
        setLeads(j.data ?? []);
      }
      if (oRes.ok) {
        const j = (await oRes.json()) as { data?: OpportunityRow[] };
        setOpportunities(j.data ?? []);
      }
    } catch {
      setErrorMsg("Không thể tải dữ liệu Pipeline.");
    } finally {
      setLoading(false);
    }
  }, [isConfigAdmin]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  async function handleCreateProspect(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/pipeline/prospects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        prospect_ref: prosRef.trim(),
        display_label: prosLabel.trim(),
        segment_code: prosSeg,
        owner_staff_id: actorStaffId,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi tạo Prospect");
    } else {
      setStatusMsg("Đã tạo Prospect synthetic thành công.");
      setProsRef("");
      setProsLabel("");
      await loadData();
    }
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/pipeline/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        lead_ref: leadRef.trim(),
        display_label: leadLabel.trim(),
        need_group_code: leadGroup,
        owner_staff_id: actorStaffId,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi tạo Lead");
    } else {
      setStatusMsg("Đã tạo Lead synthetic thành công.");
      setLeadRef("");
      setLeadLabel("");
      await loadData();
    }
  }

  async function handleCreateOpportunity(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch("/api/pipeline/opportunities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        opportunity_ref: oppRef.trim(),
        customer_ref: oppCustRef.trim(),
        display_label: oppLabel.trim(),
        kpi_group_code: oppGroup,
        estimated_value: Number(oppVal),
        owner_staff_id: actorStaffId,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi tạo Opportunity");
    } else {
      setStatusMsg("Đã tạo Opportunity synthetic thành công.");
      setOppRef("");
      setOppLabel("");
      await loadData();
    }
  }

  async function handleAdvanceStage(
    endpoint: string,
    id: string,
    rowVersion: number,
    nextStage: string,
  ) {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        id,
        expected_version: rowVersion,
        stage: nextStage,
      }),
    });
    const j = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setErrorMsg(j.error?.message ?? "Lỗi chuyển trạng thái");
    } else {
      setStatusMsg(`Đã chuyển trạng thái sang ${nextStage}.`);
      await loadData();
    }
  }

  if (isConfigAdmin) {
    return (
      <section
        className="scaffold-status"
        aria-labelledby="pipeline-config-admin-denied"
        data-testid="pipeline-denied-box"
      >
        <h2 id="pipeline-config-admin-denied">
          Từ chối truy cập dữ liệu Pipeline (403)
        </h2>
        <p>
          Vai trò <code>CONFIG_ADMIN</code> không được phép đọc/ghi dữ liệu
          Prospect, Lead hoặc Opportunity (
          <code>CONFIG_ADMIN_BUSINESS_DATA_FORBIDDEN</code>).
        </p>
      </section>
    );
  }

  return (
    <div className="scaffold-grid" style={{ gap: "1.5rem" }}>
      {errorMsg ? (
        <div
          role="alert"
          className="scaffold-status"
          data-testid="pipeline-error"
        >
          <strong>Lỗi:</strong> {errorMsg}
        </div>
      ) : null}
      {statusMsg ? (
        <div
          role="status"
          className="scaffold-status"
          data-testid="pipeline-status"
        >
          {statusMsg}
        </div>
      ) : null}

      <section className="scaffold-card" aria-labelledby="prospects-heading">
        <h2 id="prospects-heading">1. Prospect (KH Tiềm năng)</h2>
        <form
          onSubmit={(e) => void handleCreateProspect(e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <label>
            Mã Prospect (SYN-*)
            <input
              aria-label="Mã Prospect"
              data-testid="input-prospect-ref"
              type="text"
              required
              value={prosRef}
              onChange={(e) => setProsRef(e.target.value)}
              placeholder="SYN-PROS-001"
            />
          </label>
          <label>
            Nhãn hiển thị
            <input
              aria-label="Nhãn Prospect"
              data-testid="input-prospect-label"
              type="text"
              required
              value={prosLabel}
              onChange={(e) => setProsLabel(e.target.value)}
              placeholder="KH Tiềm năng Synthetic 01"
            />
          </label>
          <label>
            Phân khúc
            <select
              aria-label="Phân khúc Prospect"
              value={prosSeg}
              onChange={(e) =>
                setProsSeg(e.target.value as "RETAIL" | "SME" | "CORP")
              }
            >
              <option value="RETAIL">RETAIL</option>
              <option value="SME">SME</option>
              <option value="CORP">CORP</option>
            </select>
          </label>
          <button
            type="submit"
            className="scaffold-button"
            data-testid="submit-create-prospect"
          >
            Tạo Prospect
          </button>
        </form>

        {loading ? (
          <p>Đang tải...</p>
        ) : prospects.length === 0 ? (
          <p className="scaffold-meta">Chưa có Prospect nào.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">Mã</th>
                <th scope="col">Nhãn</th>
                <th scope="col">Phụ trách</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id}>
                  <td>{p.prospect_ref}</td>
                  <td>{p.display_label}</td>
                  <td>{p.owner_staff_code}</td>
                  <td>{p.stage}</td>
                  <td>
                    {p.stage === "NEW" ? (
                      <button
                        type="button"
                        className="scaffold-button"
                        onClick={() =>
                          void handleAdvanceStage(
                            "/api/pipeline/prospects",
                            p.id,
                            p.row_version,
                            "QUALIFIED",
                          )
                        }
                      >
                        Chuyển QUALIFIED
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="scaffold-card" aria-labelledby="leads-heading">
        <h2 id="leads-heading">2. Lead (Tín hiệu nhu cầu)</h2>
        <form
          onSubmit={(e) => void handleCreateLead(e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <label>
            Mã Lead (SYN-*)
            <input
              aria-label="Mã Lead"
              type="text"
              required
              value={leadRef}
              onChange={(e) => setLeadRef(e.target.value)}
              placeholder="SYN-LEAD-001"
            />
          </label>
          <label>
            Nhãn Lead
            <input
              aria-label="Nhãn Lead"
              type="text"
              required
              value={leadLabel}
              onChange={(e) => setLeadLabel(e.target.value)}
              placeholder="Nhu cầu vay vốn Synthetic"
            />
          </label>
          <label>
            Nhóm KPI
            <select
              aria-label="Nhóm KPI Lead"
              value={leadGroup}
              onChange={(e) => setLeadGroup(e.target.value)}
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
          <button type="submit" className="scaffold-button">
            Tạo Lead
          </button>
        </form>

        {leads.length === 0 ? (
          <p className="scaffold-meta">Chưa có Lead nào.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">Mã</th>
                <th scope="col">Nhãn</th>
                <th scope="col">Nhóm KPI</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{l.lead_ref}</td>
                  <td>{l.display_label}</td>
                  <td>{l.need_group_code}</td>
                  <td>{l.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="scaffold-card" aria-labelledby="opps-heading">
        <h2 id="opps-heading">3. Opportunity (Cơ hội trong Pipeline)</h2>
        <form
          onSubmit={(e) => void handleCreateOpportunity(e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <label>
            Mã Cơ hội (SYN-*)
            <input
              aria-label="Mã Opportunity"
              type="text"
              required
              value={oppRef}
              onChange={(e) => setOppRef(e.target.value)}
              placeholder="SYN-OPP-001"
            />
          </label>
          <label>
            Mã KH (SYN-CIF-*)
            <input
              aria-label="Mã KH Synthetic"
              type="text"
              required
              value={oppCustRef}
              onChange={(e) => setOppCustRef(e.target.value)}
            />
          </label>
          <label>
            Nhãn Cơ hội
            <input
              aria-label="Nhãn Opportunity"
              type="text"
              required
              value={oppLabel}
              onChange={(e) => setOppLabel(e.target.value)}
              placeholder="Gói tín dụng Synthetic"
            />
          </label>
          <label>
            Nhóm KPI
            <select
              aria-label="Nhóm KPI Opportunity"
              value={oppGroup}
              onChange={(e) => setOppGroup(e.target.value)}
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
            Giá trị ước tính
            <input
              aria-label="Giá trị ước tính"
              type="number"
              required
              value={oppVal}
              onChange={(e) => setOppVal(e.target.value)}
            />
          </label>
          <button type="submit" className="scaffold-button">
            Tạo Opportunity
          </button>
        </form>

        {opportunities.length === 0 ? (
          <p className="scaffold-meta">Chưa có Opportunity nào.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col">Mã</th>
                <th scope="col">Mã KH</th>
                <th scope="col">Nhóm KPI</th>
                <th scope="col">Giá trị</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.id}>
                  <td>{o.opportunity_ref}</td>
                  <td>{o.customer_ref}</td>
                  <td>{o.kpi_group_code}</td>
                  <td>{o.estimated_value.toLocaleString("en-US")}</td>
                  <td>{o.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
