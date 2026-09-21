import { AzureDocScanProvider } from "./azure-provider";
import { OpenAiDocScanProvider } from "./openai-provider";
import { StubDocScanProvider } from "./stub-provider";
import type { DocScanProvider } from "./types";

export type { CheckStatus, CheckSeverity, DocCheck, DocScanResult, DocScanProvider, ReportScanContext } from "./types";

// The rest of the app imports the provider only from here -- never a specific implementation
// directly -- so the scanning backend can be swapped later without touching the form.
//
// Deliberately non-throwing (unlike lib/email/graph.ts's requireEnv, which throws on a missing
// var): a missing/misconfigured provider must fall back to the stub, never break the page.
//
// Precedence: an explicit SCAN_PROVIDER override wins if set to a recognized value; otherwise
// OpenAI (if OPENAI_API_KEY is set) is preferred over Azure (if its vars are set), else stub.
export function getDocScanProvider(): DocScanProvider {
  // Trimmed defensively -- .env values pasted with trailing whitespace/newlines are an easy way
  // to end up with a falsy-looking-truthy key that still silently fails provider selection.
  const openaiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const azureEndpoint = process.env.DOC_INTELLIGENCE_ENDPOINT?.trim() || undefined;
  const azureKey = process.env.DOC_INTELLIGENCE_KEY?.trim() || undefined;
  const override = process.env.SCAN_PROVIDER?.trim().toLowerCase();

  if (override === "openai" && openaiKey) return new OpenAiDocScanProvider(openaiKey);
  if (override === "azure" && azureEndpoint && azureKey) return new AzureDocScanProvider(azureEndpoint, azureKey);
  if (override === "stub") return new StubDocScanProvider();

  if (openaiKey) return new OpenAiDocScanProvider(openaiKey);
  if (azureEndpoint && azureKey) return new AzureDocScanProvider(azureEndpoint, azureKey);
  return new StubDocScanProvider();
}
