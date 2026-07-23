// Provider-agnostic shapes for the pre-submit document scans (Travel Cover, Travel Report). Every
// consumer (the scan routes, the client UI) imports these -- and the provider itself -- only from
// ./index, never from a specific implementation like ./azure-provider directly, so the scanning
// backend can be swapped later without touching the form. Both documents share this one type set
// deliberately -- they're the same kind of "read the filled-in value, judge pass/fail/block" check
// against a scanned PDF, just with different checklists (see openai-provider.ts).

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckSeverity = "block" | "warn";

export interface DocCheck {
  /** Stable id, e.g. "who_team", "section_iii_present", "tu_signature". */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  /** e.g. "Couldn't find the Total amount — please check it's on the form." */
  message: string;
}

export interface DocScanResult {
  checks: DocCheck[];
  /** True if any severity:"block" check has status other than "pass". */
  hasBlockingFailure: boolean;
  /** False if the provider is unconfigured/errored -- the UI falls back to a manual-verify note. */
  scanAvailable: boolean;
  /** Optional, for debugging; do not surface to users. */
  rawTextFound?: string;
}

/**
 * Claim-form context a scan needs but must never guess from the image itself -- e.g. the Travel
 * Report's TU's Clearance signature rule only applies for the EPI team, and that team comes from
 * the form the user already filled in, never from the AI reading the page.
 */
export interface ReportScanContext {
  team: string;
}

export interface DocScanProvider {
  scanTravelCover(pdf: Buffer, contentType: string): Promise<DocScanResult>;
  scanTravelReport(pdf: Buffer, contentType: string, context: ReportScanContext): Promise<DocScanResult>;
}
