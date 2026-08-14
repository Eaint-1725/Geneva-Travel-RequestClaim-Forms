import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { MAX_FILE_BYTES, REQUEST_UPLOADS_PREFIX, formatBytes } from "@/lib/travel/request-uploads";

// Server-upload route for Travel Request's Approval Attachments. The browser POSTs the file as
// multipart form data here; this route uploads it to Blob via put() and returns the blob URL,
// which the client stores in form state. Mirrors app/api/travel/claim/blob-upload/route.ts (see
// that file's comment for why a server-upload route is used instead of client-direct upload).

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
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

    const blob = await put(`${REQUEST_UPLOADS_PREFIX}${file.name}`, file, {
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
