import type { DocScanProvider, DocScanResult } from "./types";

function unavailableResult(message: string): DocScanResult {
  return {
    checks: [
      {
        id: "scan_unavailable",
        label: "Automated scan",
        status: "warn",
        severity: "warn",
        message,
      },
    ],
    hasBlockingFailure: false,
    scanAvailable: false,
  };
}

// Used whenever neither OpenAI nor Azure is configured (see ./index) -- lets the whole scan
// UI/flow be built and tested before a real provider is configured, and keeps a scan-provider
// outage from ever blocking a legitimate submission (see ./index and the scan-cover/scan-report
// routes).
export class StubDocScanProvider implements DocScanProvider {
  async scanTravelCover(): Promise<DocScanResult> {
    return unavailableResult("Automated scan unavailable — please verify the cover manually.");
  }

  async scanTravelReport(): Promise<DocScanResult> {
    return unavailableResult("Automated scan unavailable — please verify the report manually.");
  }
}
