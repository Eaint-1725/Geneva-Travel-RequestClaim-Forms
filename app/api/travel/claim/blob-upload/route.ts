import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { CLAIM_UPLOADS_PREFIX, MAX_FILE_BYTES, formatBytes, isPdfFile } from "@/lib/travel/claim/documents";

// Server-upload route for Travel Claim's supporting documents. The browser POSTs the file as
// multipart form data here; this route uploads it to Blob via put() and returns the blob URL,
// which the client stores in form state. (Client-direct upload via @vercel/blob/client's
// upload()/handleUpload was tried first, but on this setup the browser's PUT to Vercel Blob was
// rejected with a 400 from vercel.com/api/blob regardless of token/store configuration. Since
// these files only need to fit the HR email's attachment budget anyway, routing bytes through
// this function -- capped below Vercel's ~4.5MB body limit -- is the better fit here.)

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const pdfOnly = form.get("pdfOnly") === "true";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" is ${formatBytes(file.size)} — the per-file limit is ${formatBytes(MAX_FILE_BYTES)}.` },
        { status: 413 },
      );
    }
    if (pdfOnly && !isPdfFile(file)) {
      return NextResponse.json({ error: `"${file.name}" isn't a PDF — only PDF files are accepted here.` }, { status: 415 });
    }

    const blob = await put(`${CLAIM_UPLOADS_PREFIX}${file.name}`, file, {
      access: "private",
      addRandomSuffix: true,
      contentType: file.type || undefined,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      name: file.name,
      size: file.size,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
