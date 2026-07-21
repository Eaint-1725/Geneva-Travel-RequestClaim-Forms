import { AzureCoverScanProvider } from "./azure-provider";
import { OpenAiCoverScanProvider } from "./openai-provider";
import { StubCoverScanProvider } from "./stub-provider";
import type { CoverScanProvider } from "./types";

export type { CheckStatus, CheckSeverity, CoverCheck, CoverScanResult, CoverScanProvider } from "./types";

// The rest of the app imports the provider only from here -- never a specific implementation
// directly -- so the scanning backend can be swapped later without touching the form.
//
// Deliberately non-throwing (unlike lib/email/graph.ts's requireEnv, which throws on a missing
// var): a missing/misconfigured provider must fall back to the stub, never break the page.
//
// Precedence: an explicit SCAN_PROVIDER override wins if set to a recognized value; otherwise
// OpenAI (if OPENAI_API_KEY is set) is preferred over Azure (if its vars are set), else stub.
export function getCoverScanProvider(): CoverScanProvider {
  // Trimmed defensively -- .env values pasted with trailing whitespace/newlines are an easy way
  // to end up with a falsy-looking-truthy key that still silently fails provider selection.
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const azureEndpoint = process.env.DOC_INTELLIGENCE_ENDPOINT?.trim() || undefined;
  const azureKey = process.env.DOC_INTELLIGENCE_KEY?.trim() || undefined;
  const override = process.env.SCAN_PROVIDER?.trim().toLowerCase();

  if (override === "openai" && openaiKey) return new OpenAiCoverScanProvider(openaiKey);
  if (override === "azure" && azureEndpoint && azureKey) return new AzureCoverScanProvider(azureEndpoint, azureKey);
  if (override === "stub") return new StubCoverScanProvider();

  if (openaiKey) return new OpenAiCoverScanProvider(openaiKey);
  if (azureEndpoint && azureKey) return new AzureCoverScanProvider(azureEndpoint, azureKey);
  return new StubCoverScanProvider();
}
