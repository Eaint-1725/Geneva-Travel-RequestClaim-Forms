import type { Signature, Trip } from "../types";

// Travel Claim reuses Row/Trip/Signature from ../types unchanged -- the trip/row model isn't
// claim-specific. The header differs by exactly one field: Travel Claim has no form-level
// Exchange rate (it moved into each row, auto-derived from that row's Date -- see ./rate.ts).

export interface TravelClaimHeader {
  month: string; // YYYY-MM
  submissionDate: string; // YYYY-MM-DD
  team: string;
  name: string;
  position: string;
  dutyStation: string;
  /** Free-text notes, only shown in the UI and exported to Excel when team === "MAL". */
  notes: string;
  /** Traveller's own email -- used as Reply-To on the HR notification, same role as the request's header.email. */
  email: string;
  /**
   * In-town/Out-of-town, HIV team only -- decides whether Travel Cover/Report are required
   * (see coverReportRequired in ./documents.ts). Empty for every other team, and also the
   * fail-safe "not yet chosen" state for HIV -- treated as required, same as out-of-town.
   */
  travelArea: "" | "in_town" | "out_of_town";
}

/** One file already uploaded to Vercel Blob -- the form only ever holds the resulting metadata/URL, never raw bytes. */
export interface UploadedFile {
  url: string;
  pathname: string;
  name: string;
  size: number;
  contentType: string;
}

export interface ClaimDocuments {
  travelRequest: UploadedFile[]; // exactly one, PDF only
  travelCover: UploadedFile[]; // exactly one when required, PDF only
  travelReport: UploadedFile[]; // exactly one when required, PDF only
  voucher: UploadedFile[]; // at least one, any type
  justification: UploadedFile[]; // optional, checkbox-gated, any type
  approvedEmail: UploadedFile[]; // optional, checkbox-gated, any type
  airTicket: UploadedFile[]; // optional, checkbox-gated, any type
  declaration: UploadedFile[]; // optional, checkbox-gated, any type
  certificate: UploadedFile[]; // optional, checkbox-gated, any type
}

/**
 * Record of a pre-submit document scan gate (Travel Cover or Travel Report) at the moment of
 * submit, carried along in the submission payload for HR visibility -- not consumed by validation
 * or the Excel export. See DocScanPanel/page.tsx for how the gate itself works.
 */
export interface DocScanStatus {
  /** False when the scan provider was unavailable and the user went through the manual-acknowledge fallback instead. */
  scanAvailable: boolean;
  /** "<check id> — <check label>" for every required check the user explicitly overrode (see the override control in DocScanPanel). Empty when nothing was overridden. */
  overriddenChecks: string[];
}

export interface TravelClaimForm {
  header: TravelClaimHeader;
  trips: Trip[];
  signature: Signature | null;
  documents: ClaimDocuments;
  /** Both absent when the Travel Cover/Report aren't required for this team/location (see coverReportRequired) -- they're gated together, so either both are present or neither is. */
  coverScanStatus?: DocScanStatus;
  reportScanStatus?: DocScanStatus;
}

export function makeEmptyClaimHeader(): TravelClaimHeader {
  return {
    month: "",
    submissionDate: "",
    team: "",
    name: "",
    position: "",
    dutyStation: "",
    notes: "",
    email: "",
    travelArea: "",
  };
}

export function makeEmptyClaimDocuments(): ClaimDocuments {
  return {
    travelRequest: [],
    travelCover: [],
    travelReport: [],
    voucher: [],
    justification: [],
    approvedEmail: [],
    airTicket: [],
    declaration: [],
    certificate: [],
  };
}
