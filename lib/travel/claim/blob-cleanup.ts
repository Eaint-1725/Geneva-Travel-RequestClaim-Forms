import { del } from "@vercel/blob";
import { CLAIM_UPLOADS_PREFIX } from "./documents";

// Every blob-deletion path in the app (the /blob-delete route, hit on remove/replace, and the
// post-submit cleanup in submit/route.ts) funnels through this file, so the "our own store +
// claim-uploads/ only" guard can never be forgotten on a new call site.

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
 * True only for a URL that belongs to OUR OWN Blob store AND sits under claim-uploads/ -- the one
 * gate every deletion path must pass before touching a blob, so a caller-supplied URL (whether
 * from the delete route's request body or a claim's own submitted document list) can never cause
 * an arbitrary Blob delete.
 */
export function isClaimUploadBlobUrl(url: string): boolean {
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
  return parsed.pathname.replace(/^\/+/, "").startsWith(CLAIM_UPLOADS_PREFIX);
}

/**
 * Deletes exactly the blob URLs given -- nothing else.
 *
 * CONCURRENCY, READ BEFORE "optimising" this: several travellers can be filling in and submitting
 * claims at the same time. NEVER reimplement this as "delete everything under claim-uploads/" or
 * a list()-then-delete-all sweep -- that would destroy other users' in-progress uploads mid-form.
 * Every caller must already hold the exact, explicit URL(s) it owns (one removed/replaced file,
 * or one submission's full document list) and pass only those.
 *
 * Deletes one URL at a time (rather than a single batched del(urls) call) so one bad or
 * already-gone URL can't take the rest down with it -- each failure is caught and logged
 * individually, and the caller gets back exactly what succeeded. Never throws.
 */
export async function deleteClaimUploadBlobs(urls: string[]): Promise<string[]> {
  const deleted: string[] = [];
  await Promise.all(
    urls.map(async (url) => {
      if (!isClaimUploadBlobUrl(url)) {
        console.error(`[claim-blob-cleanup] refused to delete a non-claim-upload URL: ${url}`);
        return;
      }
      try {
        await del(url);
        deleted.push(url);
      } catch (e) {
        console.error(`[claim-blob-cleanup] delete failed for ${url}`, e);
      }
    }),
  );
  return deleted;
}

// ORPHANS (flagged, not handled here): a user who uploads documents and then closes the tab
// without submitting leaves those files in claim-uploads/ forever -- neither the remove/replace
// trigger nor the post-submit cleanup ever runs for them. Not worth a complex system in this
// pass; the right fix later is a periodic scheduled job (e.g. Vercel Cron) that lists
// claim-uploads/ and deletes blobs older than N days (list() exposes uploadedAt per blob). Until
// that exists, orphans slowly accumulate and need occasional manual cleanup in the dashboard.
