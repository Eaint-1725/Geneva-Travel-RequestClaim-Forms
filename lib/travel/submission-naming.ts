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
