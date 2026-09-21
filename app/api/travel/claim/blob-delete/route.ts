import { NextResponse } from "next/server";
import { deleteClaimUploadBlobs, isClaimUploadBlobUrl } from "@/lib/travel/claim/blob-cleanup";

// Deletes uploaded claim documents from Vercel Blob -- Blob is only a STAGING area between upload
// and submission for these HR claim documents (names, positions, totals, signatures), so nothing
// should persist here once it's no longer needed. Called from two places: ClaimDocumentField on
// remove/replace (see its onChange there), and the claim submit route directly (not over HTTP)
// after the HR email sends successfully (see submit/route.ts and blob-cleanup.ts).

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

  // Security: every URL must belong to our own Blob store AND sit under claim-uploads/ -- reject
  // the whole request on any mismatch rather than silently skipping bad ones. Never delete an
  // arbitrary caller-supplied URL.
  if (!urls.every((u) => isClaimUploadBlobUrl(u))) {
    return NextResponse.json({ error: "One or more URLs are not valid claim-upload blobs" }, { status: 400 });
  }

  // Deletion failures must never break the caller's flow -- log server-side (inside
  // deleteClaimUploadBlobs) and still return 200 with whatever actually succeeded.
  const deleted = await deleteClaimUploadBlobs(urls);
  return NextResponse.json({ deleted });
}
