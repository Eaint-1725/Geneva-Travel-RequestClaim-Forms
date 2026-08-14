// Fire-and-forget cleanup call to /api/travel/request/blob-delete -- used when the user removes
// an uploaded Approval Attachment (see components/travel/ApprovalAttachmentsField.tsx). By the
// time this is called, the file has already been dropped from form state, so a failed delete must
// never surface to the user or block the UI -- it's only ever logged (server-side, in the route
// itself). Mirrors lib/travel/claim/blob-client.ts.
export function deleteRequestBlobs(urls: string[]): void {
  if (urls.length === 0) return;
  fetch("/api/travel/request/blob-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  }).catch((e) => {
    console.error("[request-blob-delete] request failed", e);
  });
}
