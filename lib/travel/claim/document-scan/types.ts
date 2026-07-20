// Provider-agnostic shapes for the Travel Cover pre-submit scan. Every consumer (the scan route,
// the client UI) imports these -- and the provider itself -- only from ./index, never from a
// specific implementation like ./azure-provider directly, so the scanning backend can be swapped
// later without touching the form.

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckSeverity = "block" | "warn";

export interface CoverCheck {
  /** Stable id, e.g. "who_team", "section_iii_present". */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  /** e.g. "Couldn't find the Total amount — please check it's on the form." */
  message: string;
}

export interface CoverScanResult {
  checks: CoverCheck[];
  /** True if any severity:"block" check has status:"fail". */
  hasBlockingFailure: boolean;
  /** False if the provider is unconfigured/errored -- the UI falls back to a manual-verify note. */
  scanAvailable: boolean;
  /** Optional, for debugging; do not surface to users. */
  rawTextFound?: string;
}

export interface CoverScanProvider {
  scanTravelCover(pdf: Buffer, contentType: string): Promise<CoverScanResult>;
}
