import { NextResponse } from "next/server";
import { list, del, type ListBlobResultBlob } from "@vercel/blob";
import { REQUEST_UPLOADS_PREFIX } from "@/lib/travel/request-uploads";
import { CLAIM_UPLOADS_PREFIX } from "@/lib/travel/claim/documents";

// Safety net for orphaned uploads: a user who uploads a file (Approval Attachments or claim
// documents) and then closes the tab, refreshes, or crashes before submitting leaves that blob in
// Blob storage forever -- neither the on-submit cleanup nor the on-remove delete route ever runs
// for it (see request-uploads-cleanup.ts / claim/blob-cleanup.ts, which funnel exact-URL deletes
// only and deliberately never sweep). This route is the deferred fix those files point at: a
// scheduled sweep (Vercel Cron, see vercel.json) that deletes blobs older than 24h under either
// prefix. 24h is comfortably longer than a real working session, so nobody mid-form is affected.
//
// Both request-uploads/ and claim-uploads/ live in the same Blob store (see .env.local.example),
// so one job covers both. The two prefixes are hardcoded below -- never taken from the request --
// so this route can never be pointed at an unrelated part of the store.

export const runtime = "nodejs";

const SWEEP_PREFIXES = [REQUEST_UPLOADS_PREFIX, CLAIM_UPLOADS_PREFIX] as const;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PrefixResult {
  prefix: string;
  deletedCount: number;
  deletedBytes: number;
  errorCount: number;
}

async function sweepPrefix(prefix: string): Promise<PrefixResult> {
  const cutoff = Date.now() - MAX_AGE_MS;
  const result: PrefixResult = { prefix, deletedCount: 0, deletedBytes: 0, errorCount: 0 };

  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    const stale = page.blobs.filter((blob: ListBlobResultBlob) => blob.uploadedAt.getTime() < cutoff);

    await Promise.all(
      stale.map(async (blob: ListBlobResultBlob) => {
        try {
          await del(blob.url);
          result.deletedCount += 1;
          result.deletedBytes += blob.size;
        } catch (e) {
          result.errorCount += 1;
          console.error(`[cleanup-blobs] delete failed for ${blob.pathname}`, e);
        }
      }),
    );

    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return result;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await Promise.all(SWEEP_PREFIXES.map(sweepPrefix));

  const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
  const totalBytes = results.reduce((sum, r) => sum + r.deletedBytes, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
  console.log(
    `[cleanup-blobs] swept ${SWEEP_PREFIXES.join(", ")}: deleted ${totalDeleted} blob(s), ${totalBytes} byte(s), ${totalErrors} error(s)`,
  );

  return NextResponse.json({ results, totalDeleted, totalBytes, totalErrors });
}
