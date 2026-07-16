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
