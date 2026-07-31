import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { buildTravelClaimWorkbook } from "@/lib/travel/claim/export-workbook";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import { getUnRates } from "@/lib/travel/un-rates-cache";
import { sendGraphEmailWithAttachments, type GraphEmailAttachmentBuffer } from "@/lib/email/graph";
import { formatMmk, ordinal, todayIso } from "@/lib/travel/format";
import { buildSubmissionEmailSubject, buildSubmissionFileName, buildSubmissionLabel } from "@/lib/travel/submission-naming";
import { ALL_DOC_KEYS, DOC_LABELS, MAX_TOTAL_ATTACH_BYTES, type DocKey } from "@/lib/travel/claim/documents";
import { deleteClaimUploadBlobs } from "@/lib/travel/claim/blob-cleanup";
import type { DocScanStatus, TravelClaimForm, UploadedFile } from "@/lib/travel/claim/types";
import {
  SUBMISSION_NOTE_MAX_LENGTH,
  SUBMISSION_NUMBER_MAX,
  SUBMISSION_NUMBER_MIN,
  type SubmissionMeta,
} from "@/lib/travel/types";

export const runtime = "nodejs";
// Excel build + several Blob fetches + Graph draft/attach(es)/send can run well past Vercel's
// default 10s limit, especially with multiple large documents -- raise the budget accordingly.
export const maxDuration = 60;

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface DocToSend {
  key: DocKey;
  label: string;
  file: UploadedFile;
}

interface SubmitClaimRequestBody {
  form: TravelClaimForm;
  meta: SubmissionMeta;
}

// Duplicated rather than imported from app/api/travel/submit/route.ts -- same reasoning as the
// EMAIL_RE duplication in lib/travel/claim/validation.ts: exporting this purely to share it isn't
// worth touching the Travel Request route (see the claim's conflict-avoidance rules).
/** True for anything but a well-formed { type, number, note } -- callers must have already
 * checked the "updated ⇒ non-empty note" rule client-side; this only guards shape/length/enum. */
function isInvalidMeta(meta: unknown): boolean {
  if (typeof meta !== "object" || meta === null) return true;
  const m = meta as Record<string, unknown>;
  if (m.type !== "new" && m.type !== "updated") return true;
  if (typeof m.number !== "number" || !Number.isInteger(m.number) || m.number < SUBMISSION_NUMBER_MIN || m.number > SUBMISSION_NUMBER_MAX) return true;
  if (typeof m.note !== "string" || m.note.length > SUBMISSION_NOTE_MAX_LENGTH) return true;
  if (m.type === "updated" && m.note.trim().length === 0) return true;
  return false;
}

/** Where "Travel Claim" (the generated Excel, not a DocKey -- it's never uploaded) belongs among
 * `attached`'s already-ordered entries: right after any Travel Cover entry, right before Travel
 * Request. Falls back to the front when there's no Travel Cover among the attached docs (e.g.
 * HIV in-town, or the rare case a huge Cover got linked instead), so the position is always
 * defined. Shared by the body listing and the real Graph attachment order so they can never drift. */
function excelInsertIndex(attached: DocToSend[]): number {
  const idx = attached.findIndex((d) => d.key !== "travelCover");
  return idx === -1 ? attached.length : idx;
}

/** Lines for the block shown above the traveller/summary details -- empty when a new claim has
 * no note, so the body is byte-for-byte identical to today's when there's nothing to add. */
function buildNoteBlockLines(meta: SubmissionMeta): string[] {
  const note = meta.note.trim();
  if (meta.type === "updated") {
    return ["*** UPDATED CLAIM — this replaces a previous submission ***", `What changed: ${note}`, ""];
  }
  if (note) {
    return [`Note from traveller: ${note}`, ""];
  }
  return [];
}

/** Trailing block flagging any pre-submit scan check the traveller overrode (or a document whose
 * scan was unavailable and was manually self-confirmed instead) -- HR visibility only, see
 * DocScanStatus. Empty when nothing was overridden, so most emails carry no trace of this at all. */
function buildScanOverrideLines(coverScanStatus?: DocScanStatus, reportScanStatus?: DocScanStatus): string[] {
  const lines: string[] = [];
  const addDoc = (label: string, status?: DocScanStatus) => {
    if (!status) return;
    if (!status.scanAvailable) lines.push(`- ${label}: automated scan unavailable — traveller manually confirmed it's complete`);
    for (const c of status.overriddenChecks) lines.push(`- ${label}: ${c} (overridden by traveller)`);
  };
  addDoc("Travel Cover", coverScanStatus);
  addDoc("Travel Report", reportScanStatus);
  return lines.length > 0 ? ["", "⚠ Scan overrides:", ...lines] : [];
}

function buildEmailBody(
  form: TravelClaimForm,
  meta: SubmissionMeta,
  grandTotalMmk: number,
  excelFileName: string,
  attached: DocToSend[],
  linked: DocToSend[],
): string {
  const lines = [
    ...buildNoteBlockLines(meta),
    `Traveller: ${form.header.name}`,
    `Position (Duty Station): ${form.header.position} (${form.header.dutyStation})`,
    `Team: ${form.header.team}`,
    // Only meaningful for HIV -- blank (falsy) for every other team, so nothing shows for them.
    ...(form.header.travelArea ? [`Travel area: ${form.header.travelArea === "out_of_town" ? "Out-of-town" : "In-town"}`] : []),
    `Month: ${form.header.month}`,
    `Submission date: ${form.header.submissionDate}`,
    `Submission: ${ordinal(meta.number as number)} (${meta.type === "updated" ? "Updated" : "New"})`,
    `Grand total: ${formatMmk(grandTotalMmk)} MMK`,
    "",
    `The completed travel claim Excel is attached. Replies to this email go directly to the traveller (${form.header.email}).`,
  ];

  // Excel isn't a DocKey (never uploaded) -- spliced into the same position it gets spliced
  // into the real attachment array below, so the labelled order here always matches what's
  // actually attached to the email.
  lines.push("", "Attached documents (in order):");
  const insertAt = excelInsertIndex(attached);
  attached.slice(0, insertAt).forEach((d) => lines.push(`- ${d.label}: ${d.file.name}`));
  lines.push(`- Travel Claim: ${excelFileName}`);
  attached.slice(insertAt).forEach((d) => lines.push(`- ${d.label}: ${d.file.name}`));

  if (linked.length > 0) {
    lines.push("", "Additional documents (sent as secure links -- combined size was over the email attachment limit):");
    for (const d of linked) lines.push(`- ${d.label}: ${d.file.name} — ${d.file.url}`);
  }
  lines.push(...buildScanOverrideLines(form.coverScanStatus, form.reportScanStatus));
  return lines.join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: TravelClaimForm;
  let meta: SubmissionMeta;
  try {
    const body = (await req.json()) as Partial<SubmitClaimRequestBody>;
    if (!body.form || isInvalidMeta(body.meta)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    form = body.form;
    meta = body.meta as SubmissionMeta;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Submission Date is never taken from the client -- it's always "today" on the server, so it
  // can't be stale, spoofed, or left blank by a form that no longer collects it (see Fix 1).
  form = { ...form, header: { ...form.header, submissionDate: todayIso() } };

  // Re-derive the UN rate history server-side (never trust a client-supplied rate) -- the
  // same source used to render the rows and to validate them.
  const { rates: unRates } = await getUnRates();

  const { isValid, errors } = validateClaimForm(form, unRates);
  if (!isValid) {
    return NextResponse.json({ error: "The claim is missing required fields", errors }, { status: 400 });
  }

  // Built before the send so the slow-ish step (workbook generation) never lands after the
  // email is already on its way -- the send is the point past which a failure must not read
  // as "email failed" to the client.
  const { buffer: excelBuffer, grandTotal } = await buildTravelClaimWorkbook(form, unRates);
  console.log("[claim-submit] step=excel ok");

  const hrRecipient = process.env.HR_RECIPIENT;
  if (!hrRecipient) {
    console.error("[claim-submit] step=config error=missing HR_RECIPIENT");
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 500 });
  }

  const label = buildSubmissionLabel(form.header.team, form.header.name, "TC", form.header.month, meta.number as number);
  const isUpdated = meta.type === "updated";
  const subject = buildSubmissionEmailSubject(label, isUpdated);
  const excelFileName = buildSubmissionFileName(label, isUpdated);

  // The traveller goes in To alongside HR -- both are primary recipients of the one email, not
  // CC/BCC (see Fix 4). A blank traveller email must never fail the whole submission; today
  // validateClaimForm already requires header.email, so this branch is a defensive fallback only.
  const travellerEmail = form.header.email.trim();
  if (!travellerEmail) {
    console.error("[claim-submit] step=recipients warning=traveller email empty, sending to HR only");
  }
  const recipients = travellerEmail ? [hrRecipient, travellerEmail] : [hrRecipient];

  // Flatten every uploaded document in a stable, checklist order -- the same list drives both
  // the attach/link split below and the email body's document listing.
  const allDocs: DocToSend[] = ALL_DOC_KEYS.flatMap((key) =>
    form.documents[key].map((file) => ({ key, label: DOC_LABELS[key], file })),
  );

  // Excel is always attached -- it's the primary deliverable, not optional. Everything else
  // attaches while the running total (Excel + files already queued) stays within the 20MB
  // email budget; once a file wouldn't fit, that file and everything after it (in checklist
  // order) is linked instead. This keeps the core documents (Cover/Request/Voucher/Report)
  // attached ahead of the optional checkbox items whenever there's a choice to make.
  let runningBytes = excelBuffer.byteLength;
  const attached: DocToSend[] = [];
  const linked: DocToSend[] = [];
  for (const doc of allDocs) {
    if (runningBytes + doc.file.size <= MAX_TOTAL_ATTACH_BYTES) {
      attached.push(doc);
      runningBytes += doc.file.size;
    } else {
      linked.push(doc);
    }
  }

  let attachments: GraphEmailAttachmentBuffer[];
  try {
    const fetchedDocs = await Promise.all(
      attached.map(async (doc) => {
        // Blobs are private -- a plain fetch(url) isn't authenticated and would 403. get()
        // reads them server-side using BLOB_READ_WRITE_TOKEN instead.
        const result = await get(doc.file.url, { access: "private" });
        if (!result || result.statusCode !== 200) {
          throw new Error(`Fetching "${doc.file.name}" from Blob failed`);
        }
        const arrayBuffer = await new Response(result.stream).arrayBuffer();
        return {
          name: doc.file.name,
          contentType: doc.file.contentType || "application/octet-stream",
          content: Buffer.from(arrayBuffer),
        };
      }),
    );
    // Same position as the body's "Attached documents" listing -- right after Travel Cover,
    // right before Travel Request -- so the two never drift apart.
    const excelAttachment: GraphEmailAttachmentBuffer = { name: excelFileName, contentType: XLSX_CONTENT_TYPE, content: excelBuffer };
    const insertAt = excelInsertIndex(attached);
    attachments = [...fetchedDocs.slice(0, insertAt), excelAttachment, ...fetchedDocs.slice(insertAt)];
    console.log(`[claim-submit] step=fetchBlobs ok count=${fetchedDocs.length}`);
  } catch (e) {
    console.error("[claim-submit] step=fetchBlobs error", e);
    return NextResponse.json({ error: "Couldn't prepare the uploaded documents — please try again" }, { status: 502 });
  }

  try {
    await sendGraphEmailWithAttachments({
      to: recipients,
      replyTo: form.header.email,
      subject,
      bodyText: buildEmailBody(form, meta, grandTotal.totalAmountMmk, excelFileName, attached, linked),
      attachments,
    });
    console.log("[claim-submit] step=sendMail ok");
  } catch (e) {
    console.error("[claim-submit] step=sendMail error", e);
    // ORDERING: the email did not go out -- keep every blob so the user can retry without
    // re-uploading. Cleanup below must only ever run after this point, never before it.
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 502 });
  }

  // Blob is a STAGING area only, between upload and submission -- these are HR claim documents
  // (names, positions, totals, signatures) and shouldn't persist in storage once safely emailed.
  // Delete exactly this submission's own document URLs -- see deleteClaimUploadBlobs's own
  // comment for why this must never become a claim-uploads/ prefix sweep (other travellers may be
  // uploading concurrently under that same prefix). A failed cleanup is never shown to the user --
  // the submission already succeeded -- it's only logged server-side.
  try {
    const deleted = await deleteClaimUploadBlobs(allDocs.map((d) => d.file.url));
    console.log(`[claim-submit] step=cleanupBlobs ok deleted=${deleted.length}/${allDocs.length}`);
  } catch (e) {
    console.error("[claim-submit] step=cleanupBlobs error (non-fatal, email already sent)", e);
  }

  // Same buffer that was just attached to the HR email -- returned here so the traveller's own
  // downloaded copy is byte-identical to what HR received, not a separately regenerated file.
  return NextResponse.json({
    ok: true,
    attachedCount: attached.length,
    linkedCount: linked.length,
    excelFileName,
    excelBase64: excelBuffer.toString("base64"),
  });
}
