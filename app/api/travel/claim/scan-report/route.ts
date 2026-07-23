import { NextResponse } from "next/server";
import { getDocScanProvider } from "@/lib/travel/claim/document-scan";
import type { DocScanResult } from "@/lib/travel/claim/document-scan";
import { MAX_FILE_BYTES, formatBytes, isPdfFile } from "@/lib/travel/claim/documents";

// Pre-submit automated scan of the Travel Report PDF (see lib/travel/claim/document-scan) --
// mirrors scan-cover/route.ts exactly, except it also forwards the claim's already-selected team
// as scan context (the TU's Clearance signature check only applies for EPI, and that decision is
// made in the provider from this field, never guessed from the image -- see openai-provider.ts).
// The browser already holds the File client-side (see ClaimDocumentField's onFileAccepted, which
// now fires this only after that file's own Blob upload finishes), so this route doesn't need the
// file to be stored in Blob first -- it's independent of the upload route.
//
// maxDuration must clear the OpenAI provider's own OVERALL_SCAN_TIMEOUT_MS (70s, see
// openai-provider.ts) with headroom, so that internal graceful-degrade timeout always wins over
// Vercel killing the function first.

export const runtime = "nodejs";
export const maxDuration = 80;

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");
  const team = form.get("team");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `"${file.name}" is ${formatBytes(file.size)} — the per-file limit is ${formatBytes(MAX_FILE_BYTES)}.` },
      { status: 413 },
    );
  }
  if (!isPdfFile(file)) {
    return NextResponse.json({ error: `"${file.name}" isn't a PDF — only PDF files are accepted here.` }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // TEMP DIAGNOSTIC (see the Travel Report team-wiring investigation) -- remove once the team is
  // confirmed arriving correctly in production.
  console.log(`[scan-report] team form value=${JSON.stringify(team)} (typeof ${typeof team})`);

  // A scan-provider outage must never hard-fail the request -- fall back to a graceful,
  // unavailable-but-still-200 result so the client's ack-to-proceed path can take over.
  try {
    const result = await getDocScanProvider().scanTravelReport(buffer, file.type || "application/pdf", {
      team: typeof team === "string" ? team : "",
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[scan-report] provider error", e instanceof Error ? `${e.message}\n${e.stack}` : e);
    const graceful: DocScanResult = {
      checks: [
        {
          id: "scan_unavailable",
          label: "Automated scan",
          status: "warn",
          severity: "warn",
          message: "Automated scan unavailable — please verify the report manually.",
        },
      ],
      hasBlockingFailure: false,
      scanAvailable: false,
    };
    return NextResponse.json(graceful);
  }
}
