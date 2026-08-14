import { del } from "@vercel/blob";
import { REQUEST_UPLOADS_PREFIX } from "./request-uploads";

// Every blob-deletion path for Approval Attachments (the /blob-delete route, hit on remove, and
// the post-submit cleanup in app/api/travel/submit/route.ts) funnels through this file, so the
// "our own store + request-uploads/ only" guard can never be forgotten on a new call site.
// Mirrors lib/travel/claim/blob-cleanup.ts -- kept as a separate module (not imported) so Travel
// Request stays independent of the Travel Claim feature branch.

// Vercel Blob URLs look like https://<storeId>.<access>.blob.vercel-storage.com/<pathname> (see
// @vercel/blob's own constructBlobUrl). storeId is the 4th underscore-delimited segment of
// BLOB_READ_WRITE_TOKEN (vercel_blob_rw_<storeId>_<secret>) -- the same way the SDK itself derives
// it from the token internally.
function ownBlobStoreId(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const id = token.split("_")[3];
  // The hostname Blob actually issues is lowercase even though the token segment isn't
  // necessarily -- confirmed by comparing a real upload's returned URL against its token.
  return id ? id.toLowerCase() : null;
}

/**
 * True only for a URL that belongs to OUR OWN Blob store AND sits under request-uploads/ -- the
 * one gate every deletion path must pass before touching a blob, so a caller-supplied URL (whether
 * from the delete route's request body or a submission's own attachment list) can never cause an
 * arbitrary Blob delete.
 */
export function isRequestUploadBlobUrl(url: string): boolean {
  const storeId = ownBlobStoreId();
  if (!storeId) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return false;
  if (!parsed.hostname.startsWith(`${storeId}.`)) return false;
  return parsed.pathname.replace(/^\/+/, "").startsWith(REQUEST_UPLOADS_PREFIX);
}

/**
 * Deletes exactly the blob URLs given -- nothing else.
 *
 * CONCURRENCY, READ BEFORE "optimising" this: several travellers can be filling in and submitting
 * requests at the same time. NEVER reimplement this as "delete everything under request-uploads/"
 * or a list()-then-delete-all sweep -- that would destroy other users' in-progress uploads mid-form.
 * Every caller must already hold the exact, explicit URL(s) it owns (one removed file, or one
 * submission's full attachment list) and pass only those.
 *
 * Deletes one URL at a time (rather than a single batched del(urls) call) so one bad or
 * already-gone URL can't take the rest down with it -- each failure is caught and logged
 * individually, and the caller gets back exactly what succeeded. Never throws.
 */
export async function deleteRequestUploadBlobs(urls: string[]): Promise<string[]> {
  const deleted: string[] = [];
  await Promise.all(
    urls.map(async (url) => {
      if (!isRequestUploadBlobUrl(url)) {
        console.error(`[request-blob-cleanup] refused to delete a non-request-upload URL: ${url}`);
        return;
      }
      try {
        await del(url);
        deleted.push(url);
      } catch (e) {
        console.error(`[request-blob-cleanup] delete failed for ${url}`, e);
      }
    }),
  );
  return deleted;
}
