"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";
import { usePortalOrg } from "./portal-org-context";
import { PortalEmptyCard } from "./PortalEmptyCard";

// SIM-324 — the org-scoped landing dashboard. SIM-323 lights up "Your engagements": the
// deals THIS contact is authorised on, read straight through the portal RLS (org access ∧
// deal authorisation enforced in Postgres; the column grant exposes only the safe fields).
// The remaining sections (Submit = E, Payroll Review = F, …) keep explicit empty states.

interface Engagement { display_id: string; title: string; service_code: string | null; state: string; expected_close: string | null }

export default function PortalDashboardPage() {
  const org = usePortalOrg();
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);

  useEffect(() => {
    void (async () => {
      // explicit column list — the SIM-323 grant is column-scoped, select(*) is denied by design
      const { data } = await getSupabaseBrowser()
        .from("crm_deals")
        .select("display_id, title, service_code, state, expected_close")
        .order("created_at", { ascending: false });
      setEngagements((data ?? []) as Engagement[]);
    })();
  }, []);

  return (
    <div data-testid="portal-dashboard">
      <h1 className="mb-1 text-xl font-semibold text-navy-900">Welcome{org ? `, ${org.name}` : ""}</h1>
      <p className="mb-6 text-sm text-gray-500">
        Your secure client portal{org ? ` for ${org.display_id}` : ""}. Everything shown here is scoped to your organisation only.
      </p>

      {/* SIM-323 — the engagements this contact is authorised on */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="portal-engagements">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Your engagements</h2>
        {engagements === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : engagements.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="portal-engagements-empty">No engagements yet — your CorpSec team authorises you on each engagement you work on.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {engagements.map((e) => (
              <li key={e.display_id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="portal-engagement-row">
                <span className="font-medium text-gray-800">{e.title}</span>
                {e.service_code && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{e.service_code}</span>}
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${e.state === "open" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{e.state}</span>
                {e.expected_close && <span className="text-xs text-gray-400">target {e.expected_close}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PortalEmptyCard title="Submissions" testid="portal-card-submit" note="Submit payroll inputs and documents — arriving in the next portal phase." />
        <PortalEmptyCard title="Payroll Review" testid="portal-card-payroll" note="Review and approve payroll calculations — arriving in the next portal phase." />
        <PortalEmptyCard title="Files" testid="portal-card-files" note="Your shared documents will appear here." />
        <PortalEmptyCard title="Notifications" testid="portal-card-notifications" note="Portal notifications will appear here." />
      </div>
    </div>
  );
}
