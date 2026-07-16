// Phase 1 local stub for the portal data layer. Swaps in for the real Supabase-backed
// reads (RLS-scoped session / org / engagements) so the shell renders without a backend.
// Mirrors the shapes PortalShellLayout.tsx and the dashboard page already expect.

export interface PortalSession {
  userId: string;
  role: "portal_client";
  aal: "aal1" | "aal2";
}

export interface PortalOrgRecord {
  display_id: string;
  name: string;
}

export interface Engagement {
  display_id: string;
  title: string;
  service_code: string | null;
  state: string;
  expected_close: string | null;
}

const MOCK_SESSION: PortalSession = { userId: "usr_demo_001", role: "portal_client", aal: "aal2" };
const MOCK_ORG: PortalOrgRecord = { display_id: "CL003181", name: "Zed Mobile Malaysia" };
const MOCK_USER_STATUS: "active" | "suspended" = "active";

export async function getSession(): Promise<PortalSession | null> {
  return MOCK_SESSION;
}

export async function getAal(): Promise<"aal1" | "aal2"> {
  return MOCK_SESSION.aal;
}

export async function getPortalUserStatus(): Promise<"active" | "suspended"> {
  return MOCK_USER_STATUS;
}

export async function getOrg(): Promise<PortalOrgRecord | null> {
  return MOCK_ORG;
}

export async function signOut(): Promise<void> {
  // no remote session to invalidate in the local stub
}

export async function getEngagements(): Promise<Engagement[]> {
  return [];
}
