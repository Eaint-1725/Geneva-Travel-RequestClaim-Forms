export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMmk(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07" -> "July 2026"; falls back to the raw value if it isn't YYYY-MM. */
export function formatMonthLong(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : month;
}

/** Today's date as YYYY-MM-DD in UTC -- matches the convention used elsewhere in this codebase
 * (e.g. the Excel date parsing in export-workbook.ts is also UTC-based). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-07-30" -> "30 Jul 2026"; falls back to the raw value if it isn't YYYY-MM-DD. */
export function formatDateLong(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${Number(match[3])} ${name.slice(0, 3)} ${match[1]}` : date;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11-13 -> "th" (English ordinal rules). */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
