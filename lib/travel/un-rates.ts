// UN Operational Rate of Exchange for MMK -- shared types + the "latest rate" helper.
// Safe to import from client components (no fs/network access here).
//
// The cache stores the full rate history (see un-rates-cache.ts) because a later phase --
// the Travel Claim form -- will need the rate in effect for each historical trip date. The
// Travel Request form itself is forward-looking and only ever uses the latest row; no
// date/month selection logic is built here yet, on purpose.

export interface UnRate {
  /** MMK per USD */
  rate: number;
  /** YYYY-MM-DD */
  effectiveDate: string;
}

export type UnRatesSource = "live" | "cache" | "none";

export interface UnRatesPayload {
  rates: UnRate[];
  fetchedAt: string | null;
  source: UnRatesSource;
  error?: string;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Rates must be sorted newest-first (by effectiveDate desc) for this to work. */
export function latestRate(rates: UnRate[]): UnRate | null {
  return rates[0] ?? null;
}

/**
 * The rate in effect for a given date: the latest effective date on or before `date`
 * (YYYY-MM-DD). This is what the Travel Claim form uses to auto-derive each row's rate from
 * its own Date, instead of the single latest-rate lookup the Travel Request form uses.
 * Rates must be sorted newest-first (by effectiveDate desc), same precondition as latestRate.
 */
export function rateForDate(rates: UnRate[], date: string): UnRate | null {
  return rates.find((r) => r.effectiveDate <= date) ?? null;
}

export interface RowDaySpanBoundary {
  /** Largest "No of days" this row can have without its span crossing into the next rate period. */
  maxDays: number;
  /** YYYY-MM-DD the next (newer) UN rate takes effect -- the first day outside this row's rate period. */
  boundaryDate: string;
}

/**
 * The next rate-period boundary after `date`, i.e. the earliest effectiveDate strictly greater
 * than `date` -- irregular per data/un-rates.json (1st, 15th, 30th, 13th, ...), never assumed.
 * `rates` must be sorted newest-first, same precondition as rateForDate. Returns null when `date`
 * has no resolvable rate at all (before the earliest rate on file -- rateForDate's own "no rate"
 * state governs that) or when `date` already falls in the newest known rate period (nothing newer
 * to cross into yet).
 */
function nextRateBoundary(date: string, rates: UnRate[]): string | null {
  const idx = rates.findIndex((r) => r.effectiveDate <= date);
  if (idx <= 0) return null;
  return rates[idx - 1].effectiveDate;
}

/** Inclusive day count from `from` up to and including `to` minus one day, i.e. `to` - `from` in days. */
function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Whether a row's day-span crosses into the next UN rate period, per the single-rate-per-row rule
 * shared by Travel Request and Travel Claim: a row covers `date` through `date + (noOfDays - 1)`
 * inclusive, and must stay within one rate period. Returns null when there's no next boundary to
 * check against (see nextRateBoundary) -- callers should treat that as "nothing to block on", not
 * as an error.
 */
export function rowDaySpanBoundary(date: string, rates: UnRate[]): RowDaySpanBoundary | null {
  const boundaryDate = nextRateBoundary(date, rates);
  if (!boundaryDate) return null;
  return { maxDays: daysUntil(date, boundaryDate), boundaryDate };
}

function formatUnDate(effectiveDate: string): string {
  const [y, m, d] = effectiveDate.split("-");
  const monthName = MONTH_ABBR[Number(m) - 1] ?? m;
  return `${d} ${monthName} ${y}`;
}

export function formatRateCaption(rate: UnRate): string {
  return `Latest UN operational rate — ${rate.rate.toLocaleString("en-US")} effective ${formatUnDate(rate.effectiveDate)}.`;
}

/** Short per-row caption for an auto-derived, locked rate (Travel Claim rows). */
export function formatAutoRateCaption(rate: UnRate): string {
  return `Auto — UN rate effective ${formatUnDate(rate.effectiveDate)}`;
}
