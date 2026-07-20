import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { buildTravelClaimWorkbook } from "@/lib/travel/claim/export-workbook";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import { getUnRates } from "@/lib/travel/un-rates-cache";
import { sendGraphEmailWithAttachments, type GraphEmailAttachmentBuffer } from "@/lib/email/graph";
import { formatMmk, formatMonthLong } from "@/lib/travel/format";
import { ALL_DOC_KEYS, DOC_LABELS, MAX_TOTAL_ATTACH_BYTES, type DocKey } from "@/lib/travel/claim/documents";
import type { TravelClaimForm, UploadedFile } from "@/lib/travel/claim/types";

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

function buildEmailBody(
  form: TravelClaimForm,
  grandTotalMmk: number,
  attached: DocToSend[],
  linked: DocToSend[],
): string {
  const lines = [
    `Traveller: ${form.header.name}`,
    `Position (Duty Station): ${form.header.position} (${form.header.dutyStation})`,
    `Team: ${form.header.team}`,
    `Month: ${form.header.month}`,
    `Submission date: ${form.header.submissionDate}`,
    `Grand total: ${formatMmk(grandTotalMmk)} MMK`,
    "",
    `The completed travel claim Excel is attached. Replies to this email go directly to the traveller (${form.header.email}).`,
  ];
  if (attached.length > 0) {
    lines.push("", "Attached documents:");
    for (const d of attached) lines.push(`- ${d.label}: ${d.file.name}`);
  }
  if (linked.length > 0) {
    lines.push("", "Additional documents (sent as secure links -- combined size was over the email attachment limit):");
    for (const d of linked) lines.push(`- ${d.label}: ${d.file.name} — ${d.file.url}`);
  }
  return lines.join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: TravelClaimForm;
  try {
    form = (await req.json()) as TravelClaimForm;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

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
  const { buffer: excelBuffer, fileName: excelFileName, grandTotal } = await buildTravelClaimWorkbook(form, unRates);
  console.log("[claim-submit] step=excel ok");

  const hrRecipient = process.env.HR_RECIPIENT;
  if (!hrRecipient) {
    console.error("[claim-submit] step=config error=missing HR_RECIPIENT");
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 500 });
  }

  // Flatten every uploaded document in a stable, checklist order -- the same list drives both
  // the attach/link split below and the email body's document listing.
  const allDocs: DocToSend[] = ALL_DOC_KEYS.flatMap((key) =>
    form.documents[key].map((file) => ({ key, label: DOC_LABELS[key], file })),
  );

  // Excel is always attached -- it's the primary deliverable, not optional. Everything else
  // attaches while the running total (Excel + files already queued) stays within the 20MB
  // email budget; once a file wouldn't fit, that file and everything after it (in checklist
  // order) is linked instead. This keeps the core documents (Travel Request/Cover/Report/
  // Voucher) attached ahead of the optional checkbox items whenever there's a choice to make.
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
    attachments = [{ name: excelFileName, contentType: XLSX_CONTENT_TYPE, content: excelBuffer }, ...fetchedDocs];
    console.log(`[claim-submit] step=fetchBlobs ok count=${fetchedDocs.length}`);
  } catch (e) {
    console.error("[claim-submit] step=fetchBlobs error", e);
    return NextResponse.json({ error: "Couldn't prepare the uploaded documents — please try again" }, { status: 502 });
  }

  try {
    await sendGraphEmailWithAttachments({
      to: hrRecipient,
      replyTo: form.header.email,
      subject: `${form.header.team} - ${form.header.name} - TC - ${formatMonthLong(form.header.month)}`,
      bodyText: buildEmailBody(form, grandTotal.totalAmountMmk, attached, linked),
      attachments,
    });
    console.log("[claim-submit] step=sendMail ok");
  } catch (e) {
    console.error("[claim-submit] step=sendMail error", e);
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, attachedCount: attached.length, linkedCount: linked.length });
}
