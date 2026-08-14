// Shared by the upload UI, form validation, and the submit route -- one source of truth for
// the size rules around Travel Request's Approval Attachments, mirroring the same-purpose
// constants in lib/travel/claim/documents.ts (kept as a separate module rather than imported --
// Travel Request must stay buildable/mergeable without the Travel Claim feature branch).

/**
 * Per-file cap: reject at selection, before the file ever reaches the upload route.
 * Uploads go browser -> our API route (multipart) -> Blob, so this must stay under Vercel's
 * ~4.5MB serverless request body limit, with headroom for multipart overhead.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

/** Total attachment budget for the HR email (Excel + files) -- stays well under M365's ~25-35MB ceiling. */
export const MAX_TOTAL_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB

/** Blob storage is a STAGING area only, between upload and submission -- never permanent storage
 * (see request-uploads-cleanup.ts). Shared by the upload route (where the prefix is set) and the
 * cleanup path (where it's validated) so the two can never drift apart. */
export const REQUEST_UPLOADS_PREFIX = "request-uploads/";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
