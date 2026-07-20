import { rowFieldKey, validateRow } from "../validation";
import type { UnRate } from "../un-rates";
import { resolveRowRate } from "./rate";
import type { TravelClaimForm } from "./types";
import { coverReportRequired } from "./documents";

export interface ValidationResult {
  errors: Record<string, string>;
  isValid: boolean;
}

// Duplicated rather than imported from ../validation -- that file doesn't export its EMAIL_RE,
// and exporting a private const purely to reuse a two-line regex isn't worth the shared-file
// touch (see the claim's conflict-avoidance rules).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Same shape as validateForm (lib/travel/validation.ts), minus the header-level exchange rate
 * check -- Travel Claim has no such field -- plus a per-row check that a rate could actually
 * be resolved for that row's Date. `unRates` must be the same UN rate history used to render
 * the rows (see resolveRowRate), so this agrees with what the user sees on screen.
 */
export function validateClaimForm(form: TravelClaimForm, unRates: UnRate[]): ValidationResult {
  const errors: Record<string, string> = {};
  const { header, trips, signature, documents } = form;

  if (!header.month) errors["header.month"] = "Month is required";

  if (!header.submissionDate) errors["header.submissionDate"] = "Submission date is required";
  else {
    const today = new Date().toISOString().slice(0, 10);
    if (header.submissionDate > today) errors["header.submissionDate"] = "Submission date can't be in the future";
  }

  if (!header.team) errors["header.team"] = "Team is required";
  if (!header.name.trim()) errors["header.name"] = "Name of traveller is required";
  if (!header.position.trim()) errors["header.position"] = "Position is required";
  if (!header.dutyStation.trim()) errors["header.dutyStation"] = "Duty Station is required";

  if (!header.email.trim()) errors["header.email"] = "Email is required";
  else if (!EMAIL_RE.test(header.email.trim())) errors["header.email"] = "Enter a valid email address";

  if (header.team === "HIV" && !header.townLocation) {
    errors["header.townLocation"] = "Select Inside or Outside town";
  }

  if (header.team === "MAL" && !header.notes.trim()) errors["header.notes"] = "Notes is required";

  if (documents.travelRequest.length > 1) errors["documents.travelRequest"] = "Only one Travel Request file is allowed";
  else if (documents.travelRequest.length === 0) errors["documents.travelRequest"] = "Attach the Travel Request PDF";

  const coverReport = coverReportRequired(header);
  if (documents.travelCover.length > 1) errors["documents.travelCover"] = "Only one Travel Cover file is allowed";
  else if (coverReport && documents.travelCover.length === 0) errors["documents.travelCover"] = "Attach the Travel Cover PDF";
  if (documents.travelReport.length > 1) errors["documents.travelReport"] = "Only one Travel Report file is allowed";
  else if (coverReport && documents.travelReport.length === 0) errors["documents.travelReport"] = "Attach the Travel Report PDF";

  if (documents.voucher.length === 0) errors["documents.voucher"] = "Attach at least one Voucher file";

  if (trips.length === 0) {
    errors["trips"] = "Add at least one trip";
  } else {
    for (const trip of trips) {
      for (const row of trip.rows) {
        validateRow(row, trip.id, header.month, errors);
        if (row.date && !resolveRowRate(row.date, unRates)) {
          errors[rowFieldKey(trip.id, row.id, "exchangeRate")] = "No UN rate on file for this date";
        }
      }
    }
  }

  if (!signature) errors["signature"] = "Employee signature is required — draw or upload one";

  return { errors, isValid: Object.keys(errors).length === 0 };
}
