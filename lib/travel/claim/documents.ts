// Shared by the upload UI, form validation, and the submit route -- one source of truth for
// the size/type rules in the Travel Claim spec, so the client-side reject message and the
// server-side attach/link decision never drift apart.

import type { ClaimDocuments, TravelClaimHeader } from "./types";

/**
 * Per-file cap: reject at selection, before the file ever reaches the upload route.
 * Uploads go browser -> our API route (multipart) -> Blob, so this must stay under Vercel's
 * ~4.5MB serverless request body limit, with headroom for multipart overhead.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

/** Total attachment budget for the HR email (Excel + files) -- stays well under M365's ~25-35MB ceiling. */
export const MAX_TOTAL_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB

/** Blob storage is a STAGING area only, between upload and submission -- never permanent storage
 * (see lib/travel/claim/blob-cleanup.ts). Shared by the upload route (where the prefix is set)
 * and the cleanup path (where it's validated) so the two can never drift apart. */
export const CLAIM_UPLOADS_PREFIX = "claim-uploads/";

export type SingleDocKey = "travelRequest" | "travelCover" | "travelReport";
export type OptionalDocKey = "justification" | "approvedEmail" | "airTicket" | "declaration" | "certificate";
export type DocKey = SingleDocKey | "voucher" | OptionalDocKey;

export const OPTIONAL_DOC_KEYS: OptionalDocKey[] = [
  "justification", "approvedEmail", "airTicket", "declaration", "certificate",
];

/** Stable checklist order -- drives both the attach/link split and the email's document listing. */
export const ALL_DOC_KEYS: DocKey[] = ["travelRequest", "travelCover", "travelReport", "voucher", ...OPTIONAL_DOC_KEYS];

export const DOC_LABELS: Record<DocKey, string> = {
  travelRequest: "Travel Request",
  travelCover: "Travel Cover",
  travelReport: "Travel Report",
  voucher: "Voucher",
  justification: "Justification",
  approvedEmail: "Approved Email",
  airTicket: "Air Ticket",
  declaration: "Declaration",
  certificate: "Certificate",
};

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function totalDocumentBytes(documents: ClaimDocuments): number {
  return (Object.keys(documents) as DocKey[]).reduce(
    (sum, key) => sum + documents[key].reduce((s, f) => s + f.size, 0),
    0,
  );
}

/**
 * Travel Cover/Report are always required, EXCEPT for HIV team travelling inside town.
 * A blank team (not yet chosen) is treated as "required" -- the safe default, and the
 * separate "Team is required" error already flags the real problem in that case.
 */
export function coverReportRequired(header: Pick<TravelClaimHeader, "team" | "townLocation">): boolean {
  if (header.team !== "HIV") return true;
  return header.townLocation === "outside";
}
