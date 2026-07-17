"use client";

import Button from "@/components/Button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSession, getAal, getPortalUserStatus, getOrg, signOut as dataSignOut } from "@/lib/portal/data";
import { FEATURES } from "@/config/features";
import { PortalOrgContext, type PortalOrg } from "./portal-org-context";

// SIM-324 (Portal Workstream C) — the client shell: session/aal guard, client-scoped nav and
// the org context every portal page shares. EVERY read on this surface goes through the
// publishable key + SIM-322 RLS — there is no service-role code path here and no app-side
// tenant filter (the DB scopes rows to the client's org).

// Sidebar org badge (name + client code) is hidden for now -- flip to true to restore it.
// The org context/provider below stays wired up regardless, so this only affects rendering.
const SHOW_ORG_BADGE = false;

// Sidebar Sign out button is hidden for now (this portal predates real auth) -- flip to true
// to restore it. The signOut() wiring below stays intact regardless, so this only affects rendering.
const SHOW_SIGN_OUT = false;

type NavItem = { href: string; label: string; enabled?: boolean };

const NAV: NavItem[] = [
  { href: "/portal/travel-request", label: "Travel Request" },
  { href: "/portal/travel-claim", label: "Travel Claim", enabled: FEATURES.travelClaim },
];

export default function PortalShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready" | "suspended">("loading");
  const [org, setOrg] = useState<PortalOrg | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getSession();
      if (!session) { router.replace("/portal/login"); return; }
      if (session.role !== "portal_client") { router.replace("/"); return; }
      const aal = await getAal();
      if (aal !== "aal2") { router.replace("/portal/login"); return; } // MFA gate (UX; the DB enforces regardless)

      // suspended mappings keep the session but the DB returns no org data
      const status = await getPortalUserStatus();
      if (status === "suspended") { if (!cancelled) setState("suspended"); return; }

      // RLS returns exactly the client's own org row — no app-side filter
      const orgRow = await getOrg();
      if (!cancelled) { setOrg(orgRow); setState("ready"); }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function signOut() {
    await dataSignOut();
    router.replace("/portal/login");
  }

  if (state === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-sm text-gray-500">Loading your portal…</div>;
  }
  if (state === "suspended") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <div className="max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm" data-testid="portal-suspended">
          <h1 className="mb-2 text-lg font-semibold text-navy-900">Account suspended</h1>
          <p className="mb-4 text-sm text-gray-600">Your portal access is currently suspended. Please contact your CorpSec account manager.</p>
          <Button type="button" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <PortalOrgContext.Provider value={org}>
      <div className="flex h-screen">
        <aside className="flex w-56 shrink-0 flex-col bg-nav text-nav-text" data-testid="portal-nav">
          <div className="px-4 py-5">
            <p className="text-lg font-bold tracking-tight text-white">CorpSec</p>
            <p className="text-xs text-text-secondary">Client Portal</p>
          </div>
          {SHOW_ORG_BADGE && (
            <div className="px-4 pb-4" data-testid="portal-org-badge">
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Your organisation</p>
              <p className="truncate text-sm font-medium text-white">{org?.name ?? "—"}</p>
              <p className="text-[11px] text-text-secondary">{org?.display_id ?? ""}</p>
            </div>
          )}
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
            {NAV.filter((n) => n.enabled !== false).map((n) => {
              const active = pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={`block rounded px-2 py-1.5 text-sm ${active ? "bg-primary text-white" : "hover:bg-white/10"}`}
                  data-testid={`portal-nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          {SHOW_SIGN_OUT && (
            <div className="p-3">
              <button type="button" onClick={() => void signOut()} className="w-full rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10" data-testid="portal-signout">
                Sign out
              </button>
            </div>
          )}
        </aside>
        <main className="flex-1 overflow-y-auto bg-gray-100 p-6">{children}</main>
      </div>
    </PortalOrgContext.Provider>
  );
}
