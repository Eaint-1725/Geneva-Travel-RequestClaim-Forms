import type { Row, TravelRequestForm } from "./types";
import { formatDateLong, formatMonthLong } from "./format";

export interface ValidationResult {
  errors: Record<string, string>;
  isValid: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared between Travel Request and Travel Claim: both key per-row errors the same way. */
export function rowFieldKey(tripId: string, rowId: string, field: string): string {
  return `trip.${tripId}.row.${rowId}.${field}`;
}

/** Extracts a row's own errors (keys re-based to the row's field names) from a form-wide error map. */
export function rowErrors(errors: Record<string, string>, tripId: string, rowId: string): Record<string, string> {
  const prefix = `trip.${tripId}.row.${rowId}.`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

export type RowDateRule = "floor" | "ceiling";

/**
 * Row-level validation shared by Travel Request and Travel Claim (the row schema is identical).
 * The two forms use different Date rules, against different reference points: Request is filed
 * BEFORE travel happens, so `month` is a FLOOR (date must be on/after the selected month's first
 * day). Claim is filed AFTER travel happened, so its ceiling is the claim's own Submission Date
 * (`ceilingDate` -- date must be on/before it, no lower bound) -- NOT the Month, which is only a
 * period label for Claim now (see validateClaimForm). Do not "fix" this into agreement in a
 * future parity pass, and do not resurrect a month-based ceiling for Claim -- both are
 * intentional. `dateRule` defaults to "floor" so Travel Request's call site (which never passes
 * `ceilingDate`) is unaffected.
 */
export function validateRow(
  row: Row,
  tripId: string,
  month: string,
  errors: Record<string, string>,
  dateRule: RowDateRule = "floor",
  ceilingDate?: string,
): void {
  const key = (f: string) => rowFieldKey(tripId, row.id, f);

  if (!row.date) {
    errors[key("date")] = "Date is required";
  } else if (dateRule === "floor") {
    if (month && row.date < `${month}-01`) {
      errors[key("date")] = `Date must be on or after ${formatMonthLong(month)}`;
    }
  } else if (ceilingDate && row.date > ceilingDate) {
    // No branch for "ceilingDate not yet chosen" -- deliberately: there's nothing to validate
    // against yet, and a missing Submission Date already has its own error on that field (see
    // validateClaimForm), so silently skipping the row-date check here avoids a confusing pile-on.
    errors[key("date")] = `Date must be on or before the submission date (${formatDateLong(ceilingDate)}).`;
  }

  if (!row.fromArea) errors[key("fromArea")] = "From (Area) is required";
  if (!row.toArea) errors[key("toArea")] = "To (Area) is required";
  if (!row.mode) errors[key("mode")] = "Mode of Travel is required";

  if (row.noOfDays === null) errors[key("noOfDays")] = "No of days is required";
  else if (row.noOfDays < 0) errors[key("noOfDays")] = "No of days must be 0 or more";

  if (!row.deduction) errors[key("deduction")] = "Deductions is required";
  if (!row.purpose.trim()) errors[key("purpose")] = "Purpose of travel is required";

  if (row.travelHotelMmk === null) errors[key("travelHotelMmk")] = "Required";
  else if (row.travelHotelMmk < 0) errors[key("travelHotelMmk")] = "Must be 0 or more";
  if (row.airTicketMmk !== null && row.airTicketMmk < 0) errors[key("airTicketMmk")] = "Must be 0 or more";
  if (row.terminalAllowanceUsd !== null && row.terminalAllowanceUsd < 0) errors[key("terminalAllowanceUsd")] = "Must be 0 or more";

  if (row.mode === "Air") {
    if (row.airTicketMmk === null) errors[key("airTicketMmk")] = "Air Ticket Cost is required for Air travel";
    if (row.terminalAllowanceUsd === null) errors[key("terminalAllowanceUsd")] = "Terminal Allowance is required for Air travel";
  }
}

export function validateForm(form: TravelRequestForm): ValidationResult {
  const errors: Record<string, string> = {};
  const { header, trips, signature } = form;

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

  if (header.exchangeRate === null) errors["header.exchangeRate"] = "Exchange rate is required";
  else if (header.exchangeRate <= 0) errors["header.exchangeRate"] = "Exchange rate must be greater than 0";

  if (header.team === "MAL" && !header.notes.trim()) errors["header.notes"] = "Notes is required";

  if (!header.email.trim()) errors["header.email"] = "Email is required";
  else if (!EMAIL_RE.test(header.email.trim())) errors["header.email"] = "Enter a valid email address";

  if (trips.length === 0) {
    errors["trips"] = "Add at least one trip";
  } else {
    for (const trip of trips) {
      for (const row of trip.rows) {
        validateRow(row, trip.id, header.month, errors);
      }
    }
  }

  if (!signature) errors["signature"] = "Employee signature is required — draw or upload one";

  return { errors, isValid: Object.keys(errors).length === 0 };
}
