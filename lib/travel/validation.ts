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
 * The two forms use different Date rules, against different reference points, and in opposite
 * directions -- do not "fix" this into agreement in a future parity pass, both are intentional:
 * - Request (`dateRule = "floor"`, the default): filed BEFORE travel happens. The floor is
 *   Request's own Submission Date (`thresholdDate` -- date must be on/after it, no upper bound,
 *   since Submission Date is always today -- see validateForm). Falls back to month-start only
 *   when `thresholdDate` isn't given (defensive; Request's real call site always passes it).
 * - Claim (`dateRule = "ceiling"`): filed AFTER travel happened. Its ceiling is Claim's own
 *   Submission Date (`thresholdDate` -- date must be on/before it, no lower bound) -- NOT the
 *   Month, which is only a period label for Claim now (see validateClaimForm).
 */
export function validateRow(
  row: Row,
  tripId: string,
  month: string,
  errors: Record<string, string>,
  dateRule: RowDateRule = "floor",
  thresholdDate?: string,
): void {
  const key = (f: string) => rowFieldKey(tripId, row.id, f);

  if (!row.date) {
    errors[key("date")] = "Date is required";
  } else if (dateRule === "floor") {
    if (thresholdDate) {
      if (row.date < thresholdDate) errors[key("date")] = `Date must be on or after ${formatDateLong(thresholdDate)}`;
    } else if (month && row.date < `${month}-01`) {
      errors[key("date")] = `Date must be on or after ${formatMonthLong(month)}`;
    }
  } else if (thresholdDate && row.date > thresholdDate) {
    // No branch for "thresholdDate not yet chosen" -- deliberately: there's nothing to validate
    // against yet, and a missing Submission Date already has its own error on that field (see
    // validateClaimForm), so silently skipping the row-date check here avoids a confusing pile-on.
    errors[key("date")] = `Date must be on or before the submission date (${formatDateLong(thresholdDate)}).`;
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
        // Submission Date (always today -- see Fix 1) is the floor for Travel Request, not the
        // selected Month; Month stays a period label/grouping only (subject, filename, body).
        validateRow(row, trip.id, header.month, errors, "floor", header.submissionDate);
      }
    }
  }

  if (!signature) errors["signature"] = "Employee signature is required — draw or upload one";

  return { errors, isValid: Object.keys(errors).length === 0 };
}
