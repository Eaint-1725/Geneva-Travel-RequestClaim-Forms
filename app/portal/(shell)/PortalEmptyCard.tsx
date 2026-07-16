"use client";

// SIM-324 — shared empty-state card for portal sections whose features land in later
// workstreams (E/F/…). Explicit, readable placeholder — never a blank screen.
export function PortalEmptyCard({ title, note, testid }: { title: string; note: string; testid?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5" data-testid={testid ?? "portal-empty-card"}>
      <h2 className="mb-1 text-sm font-semibold text-navy-900">{title}</h2>
      <p className="text-sm text-gray-500">{note}</p>
      <p className="mt-3 inline-block rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">Coming soon</p>
    </div>
  );
}
