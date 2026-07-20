import { AzureCoverScanProvider } from "./azure-provider";
import { StubCoverScanProvider } from "./stub-provider";
import type { CoverScanProvider } from "./types";

export type { CheckStatus, CheckSeverity, CoverCheck, CoverScanResult, CoverScanProvider } from "./types";

// The rest of the app imports the provider only from here -- never azure-provider.ts directly --
// so the scanning backend can be swapped later without touching the form.
//
// Deliberately non-throwing (unlike lib/email/graph.ts's requireEnv, which throws on a missing
// var): a missing/misconfigured Azure resource must fall back to the stub, never break the page.
export function getCoverScanProvider(): CoverScanProvider {
  const endpoint = process.env.DOC_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOC_INTELLIGENCE_KEY;
  return endpoint && key ? new AzureCoverScanProvider(endpoint, key) : new StubCoverScanProvider();
}
