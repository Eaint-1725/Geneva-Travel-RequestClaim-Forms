import type ExcelJS from "exceljs";

// Shared by Travel Request's export/import (and, later, Travel Claim's) -- lets a generated
// .xlsx carry its own exact form data so re-importing it never has to reverse-engineer values
// out of printed cells (fragile, and some fields -- e.g. a calculated amount's original
// Deduction type -- can't be recovered from the number alone). The embedded data is the single
// source of truth for import; the visible sheet is for humans only.

const DATA_SHEET_NAME = "__data";
const DATA_CELL = "A1";

// Excel's per-cell string limit (32,767 chars) -- a form with an unreasonable number of trips
// could theoretically exceed it. Fail loudly at generation time rather than silently producing
// a workbook whose embedded data would come back truncated/invalid on import.
const MAX_CELL_CHARS = 32000;

/** Adds a very-hidden worksheet (not reachable via Excel's own Unhide dialog -- purely a data
 * carrier, never meant for a human to see) containing `data` as a single JSON cell. Must be
 * called before the workbook is written; safe to call at most once per workbook. */
export function embedJsonSheet<T>(wb: ExcelJS.Workbook, data: T): void {
  const json = JSON.stringify(data);
  if (json.length > MAX_CELL_CHARS) {
    throw new Error(`Embedded form data (${json.length} chars) exceeds the ${MAX_CELL_CHARS}-char cell limit -- too many trips/rows to embed.`);
  }
  const ws = wb.addWorksheet(DATA_SHEET_NAME, { state: "veryHidden" });
  ws.getCell(DATA_CELL).value = json;
}

/** Reads back the JSON embedded by embedJsonSheet, or null if this workbook has no `__data`
 * sheet (e.g. it predates this feature) or the cell isn't valid JSON. Never throws. */
export function readJsonSheet<T>(wb: ExcelJS.Workbook): T | null {
  const ws = wb.getWorksheet(DATA_SHEET_NAME);
  if (!ws) return null;
  const raw = ws.getCell(DATA_CELL).value;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
