import type { CoverScanProvider, CoverScanResult } from "./types";

// Used whenever Azure isn't configured (see ./index) -- lets the whole scan UI/flow be built and
// tested before the Azure resource exists, and keeps a scan-provider outage from ever blocking a
// legitimate submission (see ./index and app/api/travel/claim/scan-cover/route.ts).
export class StubCoverScanProvider implements CoverScanProvider {
  async scanTravelCover(): Promise<CoverScanResult> {
    return {
      checks: [
        {
          id: "scan_unavailable",
          label: "Automated scan",
          status: "warn",
          severity: "warn",
          message: "Automated scan unavailable — please verify the cover manually.",
        },
      ],
      hasBlockingFailure: false,
      scanAvailable: false,
    };
  }
}
