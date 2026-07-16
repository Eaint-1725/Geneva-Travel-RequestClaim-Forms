import { rateForDate, type UnRate } from "../un-rates";

/**
 * The exchange rate that applies to a single Travel Claim row: the UN rate whose effective
 * date is the latest one on or before the row's own Date. Returns null when the row has no
 * Date yet, or when no UN rate is on file on/before that Date -- callers must never invent or
 * fall back to a guessed rate in either case.
 */
export function resolveRowRate(date: string, rates: UnRate[]): UnRate | null {
  if (!date) return null;
  return rateForDate(rates, date);
}
