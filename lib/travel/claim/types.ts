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
}

export interface TravelClaimForm {
  header: TravelClaimHeader;
  trips: Trip[];
  signature: Signature | null;
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
  };
}
