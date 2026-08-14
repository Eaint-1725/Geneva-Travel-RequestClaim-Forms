import { NextResponse } from "next/server";
import { deleteRequestUploadBlobs, isRequestUploadBlobUrl } from "@/lib/travel/request-uploads-cleanup";

// Deletes uploaded Approval Attachments from Vercel Blob -- Blob is only a STAGING area between
// upload and submission, so nothing should persist here once it's no longer needed. Called from
// two places: ApprovalAttachmentsField on remove (see its onChange there), and the submit route
// directly (not over HTTP) after the HR email sends successfully (see submit/route.ts and
// request-uploads-cleanup.ts). Mirrors app/api/travel/claim/blob-delete/route.ts.

export const runtime = "nodejs";

interface DeleteRequestBody {
  urls?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let urls: unknown;
  try {
    const body = (await request.json()) as DeleteRequestBody;
    urls = body.urls;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u): u is string => typeof u === "string")) {
    return NextResponse.json({ error: "Provide one or more blob URLs" }, { status: 400 });
  }

  // Security: every URL must belong to our own Blob store AND sit under request-uploads/ -- reject
  // the whole request on any mismatch rather than silently skipping bad ones. Never delete an
  // arbitrary caller-supplied URL.
  if (!urls.every((u) => isRequestUploadBlobUrl(u))) {
    return NextResponse.json({ error: "One or more URLs are not valid request-upload blobs" }, { status: 400 });
  }

  // Deletion failures must never break the caller's flow -- log server-side (inside
  // deleteRequestUploadBlobs) and still return 200 with whatever actually succeeded.
  const deleted = await deleteRequestUploadBlobs(urls);
  return NextResponse.json({ deleted });
}
