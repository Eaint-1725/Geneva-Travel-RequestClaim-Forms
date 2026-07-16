"use client";

import { createContext, useContext } from "react";

// SIM-324 — the client's org context shared by every portal page (populated by the shell
// layout from the RLS-scoped org read).
export interface PortalOrg { display_id: string; name: string }
export const PortalOrgContext = createContext<PortalOrg | null>(null);
export const usePortalOrg = (): PortalOrg | null => useContext(PortalOrgContext);
