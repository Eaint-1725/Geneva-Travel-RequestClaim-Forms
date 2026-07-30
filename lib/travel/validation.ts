import type { Row, TravelRequestForm } from "./types";
import { formatMonthLong } from "./format";

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
 * "2026-07" -> "2026-07-31" (the last calendar day of that month). Uses the day-0 rollback
 * trick -- new Date(year, month, 0) where `month` is already the 1-indexed month number, so it
 * addresses "day 0 of the NEXT month" (0-indexed), which rolls back to the last day of THIS
 * month -- rather than a hand-rolled days-in-month/leap-year table. Done entirely in UTC
 * (Date.UTC + getUTC*) so the server's local timezone can never shift the result by a day --
 * see the zero-based-month bug this codebase has been bitten by before.
 */
function lastDayOfMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  const last = new Date(Date.UTC(year, monthNum, 0));
  const y = last.getUTCFullYear();
  const m = String(last.getUTCMonth() + 1).padStart(2, "0");
  const d = String(last.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Row-level validation shared by Travel Request and Travel Claim (the row schema is identical).
 * The two forms deliberately use OPPOSITE Date rules against the same header Month, though:
 * Request is filed BEFORE travel happens, so Month is a FLOOR (date must be on/after it); Claim
 * is filed AFTER travel happened, so Month is a CEILING (date must be on/before the month's last
 * day, no lower bound). Do not "fix" this into agreement in a future parity pass -- it's
 * intentional. `dateRule` defaults to "floor" so Travel Request's call site is unaffected.
 */
export function validateRow(
  row: Row,
  tripId: string,
  month: string,
  errors: Record<string, string>,
  dateRule: RowDateRule = "floor",
): void {
  const key = (f: string) => rowFieldKey(tripId, row.id, f);

  if (!row.date) errors[key("date")] = "Date is required";
  else if (month) {
    if (dateRule === "floor" && row.date < `${month}-01`) {
      errors[key("date")] = `Date must be on or after ${formatMonthLong(month)}`;
    } else if (dateRule === "ceiling" && row.date > lastDayOfMonth(month)) {
      errors[key("date")] = `Date must be on or before ${formatMonthLong(month)}`;
    }
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
