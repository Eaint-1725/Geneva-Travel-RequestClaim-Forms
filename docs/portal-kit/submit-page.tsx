"use client";

import { useCallback, useEffect, useState } from "react";
import Dropzone from "@/components/Dropzone";
import { getSupabaseBrowser } from "@/lib/supabase";
import { toMinorUnits } from "@/lib/money";

// SIM-326 (Workstream E) — the monthly submission flow, three modes:
//   Upload template  → files into SharePoint via the SIM-325 pipeline and creates a draft
//   No changes       → explicit attestation (recorded, timestamped, by you)
//   Manual entry     → structured entries: leave / salary change / new joiner / termination
// Every submission is a DRAFT for staff review — nothing is applied to payroll until your
// CorpSec team approves it. Reads here are publishable-key + RLS; submissions POST to the
// server route (validation + authorisation + filing).

interface Engagement { display_id: string; title: string; service_code: string | null }
interface SubmissionRow { id: string; display_id: string; month: string; mode: string; status: string; review_reason: string | null; created_at: string }
interface FiledRow { id: string; file_name: string; month: string; status: string; created_at: string }
interface PendingEntry { entry_type: string; data: Record<string, unknown>; summary: string }

const MODE_LABELS: Record<string, string> = { template_upload: "Template upload", no_changes: "No changes", manual: "Manual entry" };
const STATUS_CHIP: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  changes_requested: "bg-blue-100 text-blue-800",
};
const ENTRY_LABELS: Record<string, string> = { leave: "Leave", salary_change: "Salary change", new_joiner: "New joiner", termination: "Termination" };

function monthOptions(): string[] {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 7);
  return [fmt(now), fmt(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)))];
}

export default function PortalSubmitPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [dealId, setDealId] = useState("");
  const [month, setMonth] = useState(monthOptions()[0]);
  const [mode, setMode] = useState<"template_upload" | "no_changes" | "manual">("template_upload");
  const [attested, setAttested] = useState(false);
  const [entryType, setEntryType] = useState("leave");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[] | null>(null);
  const [filed, setFiled] = useState<FiledRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // SIM-615: the chosen template file (fed by the Dropzone — drop or browse)
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const { data: deals } = await supabase.from("crm_deals").select("display_id, title, service_code").order("created_at", { ascending: false });
    setEngagements((deals ?? []) as Engagement[]);
    const { data: subs } = await supabase.from("portal_submissions").select("id, display_id, month, mode, status, review_reason, created_at").order("created_at", { ascending: false });
    setSubmissions((subs ?? []) as SubmissionRow[]);
    const { data: files } = await supabase.from("portal_files").select("id, file_name, month, status, created_at").order("created_at", { ascending: false });
    setFiled((files ?? []) as FiledRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const field = (k: string) => fields[k] ?? "";
  const setField = (k: string, v: string) => setFields((p) => ({ ...p, [k]: v }));

  function addEntry() {
    setError(null);
    let data: Record<string, unknown>; let summary: string;
    if (entryType === "leave") {
      data = { employee_name: field("employee_name"), leave_type: field("leave_type"), start_date: field("start_date"), end_date: field("end_date"), notes: field("notes") };
      summary = `${field("employee_name")} — ${field("leave_type")} ${field("start_date")} → ${field("end_date")}`;
    } else if (entryType === "salary_change") {
      const major = Number(field("new_salary"));
      if (!Number.isFinite(major) || major <= 0) { setError("Enter the new salary as a number"); return; }
      data = { employee_name: field("employee_name"), new_salary_minor: toMinorUnits(major, field("currency") || "MMK"), currency: field("currency") || "MMK", effective_date: field("effective_date"), reason: field("reason") };
      summary = `${field("employee_name")} — new salary ${field("currency") || "MMK"} ${major} from ${field("effective_date")}`;
    } else if (entryType === "new_joiner") {
      const major = Number(field("salary"));
      if (!Number.isFinite(major) || major <= 0) { setError("Enter the salary as a number"); return; }
      data = { first_name: field("first_name"), last_name: field("last_name"), job_title: field("job_title"), start_date: field("start_date"), salary_minor: toMinorUnits(major, field("currency") || "MMK"), currency: field("currency") || "MMK", email: field("email") };
      summary = `${field("first_name")} ${field("last_name")} — joins ${field("start_date")}`;
    } else {
      data = { employee_name: field("employee_name"), last_working_day: field("last_working_day"), reason: field("reason") };
      summary = `${field("employee_name")} — last day ${field("last_working_day")}`;
    }
    setPending((p) => [...p, { entry_type: entryType, data, summary }]);
    setFields({});
  }

  async function submit() {
    if (!dealId) { setError("Pick the engagement first"); return; }
    setBusy(true); setError(null); setNotice(null);
    let res: Response;
    if (mode === "template_upload") {
      if (!file) { setBusy(false); setError("Choose a file first"); return; }
      const fd = new FormData();
      fd.append("mode", "template_upload"); fd.append("deal", dealId); fd.append("month", month); fd.append("file", file);
      res = await fetch("/api/portal/submissions", { method: "POST", body: fd });
    } else if (mode === "no_changes") {
      if (!attested) { setBusy(false); setError("Tick the attestation to confirm"); return; }
      res = await fetch("/api/portal/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, deal: dealId, month }) });
    } else {
      if (pending.length === 0) { setBusy(false); setError("Add at least one entry"); return; }
      res = await fetch("/api/portal/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, deal: dealId, month, entries: pending.map(({ entry_type, data }) => ({ entry_type, data })) }) });
    }
    const b = (await res.json().catch(() => ({}))) as { submission?: { display_id: string }; error?: string };
    setBusy(false);
    if (!res.ok || !b.submission) { setError(b.error ?? "Submission failed"); return; }
    setNotice(`Submitted ${b.submission.display_id} for ${month} — your CorpSec team will review it (draft).`);
    setPending([]); setAttested(false); setFile(null);
    void load();
  }

  const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";
  const ENTRY_FIELDS: Record<string, { key: string; label: string; type: string; placeholder?: string }[]> = {
    leave: [
      { key: "employee_name", label: "Employee", type: "text" }, { key: "leave_type", label: "Leave type", type: "text", placeholder: "annual / medical / unpaid" },
      { key: "start_date", label: "From", type: "date" }, { key: "end_date", label: "To", type: "date" }, { key: "notes", label: "Notes (optional)", type: "text" },
    ],
    salary_change: [
      { key: "employee_name", label: "Employee", type: "text" }, { key: "new_salary", label: "New monthly salary", type: "number" },
      { key: "currency", label: "Currency", type: "currency" }, { key: "effective_date", label: "Effective from", type: "date" }, { key: "reason", label: "Reason (optional)", type: "text" },
    ],
    new_joiner: [
      { key: "first_name", label: "First name", type: "text" }, { key: "last_name", label: "Last name", type: "text" },
      { key: "job_title", label: "Job title (optional)", type: "text" }, { key: "start_date", label: "Start date", type: "date" },
      { key: "salary", label: "Monthly salary", type: "number" }, { key: "currency", label: "Currency", type: "currency" }, { key: "email", label: "Email (optional)", type: "text" },
    ],
    termination: [
      { key: "employee_name", label: "Employee", type: "text" }, { key: "last_working_day", label: "Last working day", type: "date" }, { key: "reason", label: "Reason (optional)", type: "text" },
    ],
  };

  return (
    <div data-testid="portal-submit-page">
      <h1 className="mb-1 text-xl font-semibold text-navy-900">Submit</h1>
      <p className="mb-4 text-sm text-gray-500">Your monthly submission — upload our template, confirm nothing changed, or enter changes directly. Everything is reviewed by your CorpSec team before it is applied; nothing goes to payroll automatically.</p>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="portal-submission-form">
        {error && <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="portal-submit-error">{error}</p>}
        {notice && <p className="mb-2 rounded bg-green-50 px-3 py-1.5 text-sm text-green-800" data-testid="portal-submit-notice">{notice}</p>}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-0.5 block text-[11px] text-gray-500">Engagement</span>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={`w-72 ${inputCls}`} data-testid="portal-submit-deal">
              <option value="">— pick an engagement —</option>
              {engagements.map((e) => <option key={e.display_id} value={e.display_id}>{e.title}{e.service_code ? ` (${e.service_code})` : ""}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-0.5 block text-[11px] text-gray-500">Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} data-testid="portal-submit-month">
              {monthOptions().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div className="mb-3 flex gap-1" data-testid="portal-submit-modes">
          {(["template_upload", "no_changes", "manual"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); }}
              className={`rounded px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-primary text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              data-testid={`portal-mode-${m}`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {mode === "template_upload" && (
          <div className="flex flex-wrap items-center gap-2" data-testid="portal-mode-panel-upload">
            {/* SIM-615: drop the filled template here or click to browse (limits unchanged — 4 MB, server-enforced) */}
            <Dropzone onFiles={([f]) => setFile(f)} testid="portal-submit-file" compact>
              {file
                ? <span className="text-sm text-navy-900">{file.name} <span className="text-xs text-gray-400">— drop another file to replace</span></span>
                : <span className="text-sm text-gray-600">Drop the filled template here <span className="text-xs text-gray-400">or click to browse</span></span>}
            </Dropzone>
            <span className="text-[11px] text-gray-400">Our standard template — filed to your client folder automatically. Max 4 MB; re-uploads never overwrite.</span>
          </div>
        )}
        {mode === "no_changes" && (
          <label className="flex items-start gap-2 text-sm text-gray-700" data-testid="portal-mode-panel-nochanges">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" data-testid="portal-attest-checkbox" />
            <span>I confirm there are <strong>no changes</strong> for {month} on this engagement — no leave, salary changes, joiners or terminations. This attestation is recorded with my name and the time.</span>
          </label>
        )}
        {mode === "manual" && (
          <div data-testid="portal-mode-panel-manual">
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="mb-0.5 block text-[11px] text-gray-500">Entry type</span>
                <select value={entryType} onChange={(e) => { setEntryType(e.target.value); setFields({}); }} className={inputCls} data-testid="portal-entry-type">
                  {Object.entries(ENTRY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              {ENTRY_FIELDS[entryType].map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="mb-0.5 block text-[11px] text-gray-500">{f.label}</span>
                  {f.type === "currency" ? (
                    <select value={field(f.key) || "MMK"} onChange={(e) => setField(f.key, e.target.value)} className={inputCls} data-testid={`portal-entry-${f.key}`}>
                      {["MMK", "USD", "SGD", "THB"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input type={f.type === "number" ? "number" : f.type} value={field(f.key)} placeholder={f.placeholder}
                      onChange={(e) => setField(f.key, e.target.value)} className={`${inputCls} w-40`} data-testid={`portal-entry-${f.key}`} />
                  )}
                </label>
              ))}
              <button type="button" onClick={addEntry} className="rounded border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-light/30" data-testid="portal-entry-add">Add entry</button>
            </div>
            {pending.length > 0 && (
              <ul className="mb-2 space-y-1" data-testid="portal-pending-entries">
                {pending.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm" data-testid="portal-pending-entry">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{ENTRY_LABELS[p.entry_type]}</span>
                    <span className="text-gray-800">{p.summary}</span>
                    <button type="button" onClick={() => setPending((x) => x.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-600">remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3">
          <button type="button" onClick={() => void submit()} disabled={busy} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50" data-testid="portal-submit-btn">
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="portal-submissions-list">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Your submissions</h2>
        {submissions === null ? <p className="text-sm text-gray-400">Loading…</p> : submissions.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="portal-submissions-empty">No submissions yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="py-1">Ref</th><th className="py-1">Month</th><th className="py-1">Type</th><th className="py-1">Status</th><th className="py-1">Submitted</th></tr></thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 align-top" data-testid="portal-submission-row">
                  <td className="py-1.5 font-mono text-xs text-gray-600">{s.display_id}</td>
                  <td className="py-1.5 text-gray-700">{s.month}</td>
                  <td className="py-1.5 text-gray-700">{MODE_LABELS[s.mode] ?? s.mode}</td>
                  <td className="py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CHIP[s.status] ?? "bg-gray-100 text-gray-600"}`} data-testid="portal-submission-status">{s.status.replace("_", " ")}</span>
                    {s.review_reason && (s.status === "rejected" || s.status === "changes_requested") && (
                      <p className="mt-0.5 text-xs text-gray-500" data-testid="portal-submission-reason">“{s.review_reason}”</p>
                    )}
                  </td>
                  <td className="py-1.5 text-gray-500">{s.created_at.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5" data-testid="portal-filed-list">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Filed documents</h2>
        {filed.length === 0 ? <p className="text-sm text-gray-500" data-testid="portal-filed-empty">Nothing filed yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="py-1">File</th><th className="py-1">Month</th><th className="py-1">Status</th><th className="py-1">Uploaded</th></tr></thead>
            <tbody>
              {filed.map((f) => (
                <tr key={f.id} className="border-t border-gray-100" data-testid="portal-filed-row">
                  <td className="py-1.5 text-gray-800">{f.file_name}</td>
                  <td className="py-1.5 text-gray-600">{f.month}</td>
                  <td className="py-1.5"><span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{f.status}</span></td>
                  <td className="py-1.5 text-gray-500">{f.created_at.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
