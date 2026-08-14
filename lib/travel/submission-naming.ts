// Shared subject-line/filename builder for HR submission emails -- one source of truth so the
// Travel Request ("TR") and Travel Claim ("TC") flows stay in lockstep instead of each hand-
// rolling the same string format.

import { formatMonthLong } from "./format";

export type SubmissionDocType = "TR" | "TC";

/** "{TEAM} - {Name} - TR - {Month Year} - Submission {N}" -- shared base for both the email
 * subject and the Excel filename (before the Updated-only suffix/prefix is applied). */
export function buildSubmissionLabel(team: string, name: string, docType: SubmissionDocType, month: string, submissionNumber: number): string {
  return `${team} - ${name} - ${docType} - ${formatMonthLong(month)} - Submission ${submissionNumber}`;
}

/** Prefixes "[UPDATED] " for updated submissions -- kept in lockstep with buildExcelFileName's
 * " (Updated)" suffix so a subject and its attachment always agree on New vs Updated. */
export function buildSubmissionEmailSubject(label: string, isUpdated: boolean): string {
  return isUpdated ? `[UPDATED] ${label}` : label;
}

export function buildSubmissionFileName(label: string, isUpdated: boolean): string {
  return `${label}${isUpdated ? " (Updated)" : ""}.xlsx`;
}

export interface ParsedSubmissionFileName {
  team: string;
  name: string;
  docType: SubmissionDocType;
  submissionNumber: number;
  /** Whether the FILE ITSELF was exported as an "(Updated)" copy -- informational only. A
   * re-imported file is always treated as an update going forward regardless of this flag; see
   * the import route/page for why (importing an already-generated submission is inherently an
   * update to it, keeping the same submission number). */
  wasUpdated: boolean;
}

// Mirrors buildSubmissionLabel/buildSubmissionFileName's own format exactly -- this is the
// single place that must stay in lockstep with those builders, in both directions.
const SUBMISSION_FILENAME_RE = /^(.+) - (.+) - (TR|TC) - .+ - Submission (\d{1,2})( \(Updated\))?\.xlsx$/;

/** Parses a system-generated submission filename, or returns null if it doesn't match the exact
 * format buildSubmissionFileName produces. `expectedDocType` rejects a right-shaped filename for
 * the wrong flow (e.g. a Travel Claim file uploaded to Travel Request's importer). */
export function parseSubmissionFileName(fileName: string, expectedDocType: SubmissionDocType): ParsedSubmissionFileName | null {
  const match = SUBMISSION_FILENAME_RE.exec(fileName);
  if (!match) return null;
  const [, team, name, docType, numStr, updatedSuffix] = match;
  if (docType !== expectedDocType) return null;
  const submissionNumber = Number(numStr);
  if (!Number.isInteger(submissionNumber) || submissionNumber < 1) return null;
  return { team, name, docType, submissionNumber, wasUpdated: Boolean(updatedSuffix) };
}
