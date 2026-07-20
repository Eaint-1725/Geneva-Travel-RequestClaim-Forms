import { NextResponse } from "next/server";
import { getCoverScanProvider } from "@/lib/travel/claim/document-scan";
import type { CoverScanResult } from "@/lib/travel/claim/document-scan";
import { MAX_FILE_BYTES, formatBytes, isPdfFile } from "@/lib/travel/claim/documents";

// Pre-submit automated scan of the Travel Cover PDF (see lib/travel/claim/document-scan). The
// browser already holds the File client-side (see ClaimDocumentField's onFileAccepted), so this
// route doesn't need the file to be stored in Blob first -- it's independent of the upload route.
//
// Document Intelligence's analyze call is a polled long-running operation, typically a few
// seconds for a one-page form -- raise the duration budget accordingly (matches the precedent at
// app/api/travel/submit/route.ts).

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");

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

  // A scan-provider outage must never hard-fail the request -- fall back to a graceful,
  // unavailable-but-still-200 result so the client's ack-to-proceed path can take over.
  try {
    const result = await getCoverScanProvider().scanTravelCover(buffer, file.type || "application/pdf");
    return NextResponse.json(result);
  } catch (e) {
    console.error("[scan-cover] provider error", e);
    const graceful: CoverScanResult = {
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
    return NextResponse.json(graceful);
  }
}
