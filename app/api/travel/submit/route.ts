import { NextRequest, NextResponse } from "next/server";
import { buildTravelRequestWorkbook } from "@/lib/travel/export-workbook";
import { validateForm } from "@/lib/travel/validation";
import { addSubmission } from "@/lib/portal/submissions";
import { sendGraphEmail } from "@/lib/email/graph";
import { formatMmk, ordinal, todayIso } from "@/lib/travel/format";
import { buildSubmissionEmailSubject, buildSubmissionFileName, buildSubmissionLabel } from "@/lib/travel/submission-naming";
import {
  SUBMISSION_NOTE_MAX_LENGTH,
  SUBMISSION_NUMBER_MAX,
  SUBMISSION_NUMBER_MIN,
  type SubmissionMeta,
  type TravelRequestForm,
} from "@/lib/travel/types";

export const runtime = "nodejs";
// Token fetch + Graph sendMail + Excel build can run close to Vercel's default 10s function
// limit; the Excel is built before the send anyway (it's the attachment), so this budget mainly
// covers network latency to Graph, not a slow step after the email is already sent.
export const maxDuration = 30;

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface SubmitRequestBody {
  form: TravelRequestForm;
  meta: SubmissionMeta;
}

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

/** Lines for the block shown above the traveller/summary details -- empty when a new request
 * has no note, so the body is byte-for-byte identical to today's when there's nothing to add. */
function buildNoteBlockLines(meta: SubmissionMeta): string[] {
  const note = meta.note.trim();
  if (meta.type === "updated") {
    return ["*** UPDATED REQUEST — this replaces a previous submission ***", `What changed: ${note}`, ""];
  }
  if (note) {
    return [`Note from traveller: ${note}`, ""];
  }
  return [];
}

function buildEmailBody(form: TravelRequestForm, meta: SubmissionMeta, grandTotalMmk: number): string {
  return [
    ...buildNoteBlockLines(meta),
    `Traveller: ${form.header.name}`,
    `Position (Duty Station): ${form.header.position} (${form.header.dutyStation})`,
    `Team: ${form.header.team}`,
    `Month: ${form.header.month}`,
    `Submission date: ${form.header.submissionDate}`,
    `Submission: ${ordinal(meta.number as number)} (${meta.type === "updated" ? "Updated" : "New"})`,
    `Grand total: ${formatMmk(grandTotalMmk)} MMK`,
    "",
    `The completed travel request Excel is attached. Replies to this email go directly to the traveller (${form.header.email}).`,
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: TravelRequestForm;
  let meta: SubmissionMeta;
  try {
    const body = (await req.json()) as Partial<SubmitRequestBody>;
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

  const { isValid, errors } = validateForm(form);
  if (!isValid) {
    return NextResponse.json({ error: "The request is missing required fields", errors }, { status: 400 });
  }

  // Built before the send so the slow-ish step (workbook generation) never lands after the
  // email is already on its way -- the send is the point past which a failure must not read
  // as "email failed" to the client.
  const { buffer, grandTotal } = await buildTravelRequestWorkbook(form);
  console.log("[travel-submit] step=excel ok");

  const hrRecipient = process.env.HR_RECIPIENT;
  if (!hrRecipient) {
    console.error("[travel-submit] step=config error=missing HR_RECIPIENT");
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 500 });
  }

  const label = buildSubmissionLabel(form.header.team, form.header.name, "TR", form.header.month, meta.number as number);
  const isUpdated = meta.type === "updated";
  const subject = buildSubmissionEmailSubject(label, isUpdated);
  const fileName = buildSubmissionFileName(label, isUpdated);

  // The traveller goes in To alongside HR -- both are primary recipients of the one email, not
  // CC/BCC (see Fix 4). A blank traveller email must never fail the whole submission; today
  // validateForm already requires header.email, so this branch is a defensive fallback only.
  const travellerEmail = form.header.email.trim();
  if (!travellerEmail) {
    console.error("[travel-submit] step=recipients warning=traveller email empty, sending to HR only");
  }
  const recipients = travellerEmail ? [hrRecipient, travellerEmail] : [hrRecipient];

  try {
    await sendGraphEmail({
      to: recipients,
      replyTo: form.header.email,
      subject,
      bodyText: buildEmailBody(form, meta, grandTotal.totalAmountMmk),
      attachment: {
        name: fileName,
        contentType: XLSX_CONTENT_TYPE,
        contentBytes: buffer.toString("base64"),
      },
    });
    console.log("[travel-submit] step=sendMail ok");
  } catch (e) {
    console.error("[travel-submit] step=sendMail error", e);
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 502 });
  }

  // The email is already sent at this point -- nothing below may turn a successful send into
  // a reported failure. addSubmission logs a local record for the portal's own listing; on
  // Vercel its filesystem write can fail (read-only fs), and that must not mask the send.
  try {
    await addSubmission({
      id: `TRV-${Date.now().toString(36).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      month: form.header.month,
      team: form.header.team,
      name: form.header.name,
      dutyStation: form.header.dutyStation,
      grandTotalPerDiemUsd: grandTotal.totalPerDiemUsd,
      grandTotalAmountMmk: grandTotal.totalAmountMmk,
    });
    console.log("[travel-submit] step=addSubmission ok");
  } catch (e) {
    console.error("[travel-submit] step=addSubmission error (non-fatal, email already sent)", e);
  }

  // Same buffer that was just attached to the HR email -- returned here so the traveller's own
  // downloaded copy (auto-download + the success page's fallback button) is byte-identical to
  // what HR received, not a separately regenerated file. Mirrors the Travel Claim submit route.
  return NextResponse.json({
    ok: true,
    excelFileName: fileName,
    excelBase64: buffer.toString("base64"),
  });
}
