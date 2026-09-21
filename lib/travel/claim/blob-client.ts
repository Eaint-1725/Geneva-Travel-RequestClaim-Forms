// Fire-and-forget cleanup call to /api/travel/claim/blob-delete -- used when the user removes or
// replaces an uploaded claim document (see ClaimDocumentField). By the time this is called, the
// file has already been dropped from form state, so a failed delete must never surface to the
// user or block the UI -- it's only ever logged (server-side, in the route itself).
export function deleteClaimBlobs(urls: string[]): void {
  if (urls.length === 0) return;
  fetch("/api/travel/claim/blob-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  }).catch((e) => {
    console.error("[claim-blob-delete] request failed", e);
  });
}
