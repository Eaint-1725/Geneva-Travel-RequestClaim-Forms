import { NextRequest, NextResponse } from "next/server";
import { buildTravelRequestWorkbook, bufferToArrayBuffer } from "@/lib/travel/export-workbook";
import { validateForm } from "@/lib/travel/validation";
import { addSubmission } from "@/lib/portal/submissions";
import { sendGraphEmail } from "@/lib/email/graph";
import { formatMmk, formatMonthLong } from "@/lib/travel/format";
import type { TravelRequestForm } from "@/lib/travel/types";

export const runtime = "nodejs";
// Token fetch + Graph sendMail + Excel build can run close to Vercel's default 10s function
// limit; the Excel is built before the send anyway (it's the attachment), so this budget mainly
// covers network latency to Graph, not a slow step after the email is already sent.
export const maxDuration = 30;

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function buildEmailBody(form: TravelRequestForm, grandTotalMmk: number): string {
  return [
    `Traveller: ${form.header.name}`,
    `Position (Duty Station): ${form.header.position} (${form.header.dutyStation})`,
    `Team: ${form.header.team}`,
    `Month: ${form.header.month}`,
    `Submission date: ${form.header.submissionDate}`,
    `Grand total: ${formatMmk(grandTotalMmk)} MMK`,
    "",
    `The completed travel request Excel is attached. Replies to this email go directly to the traveller (${form.header.email}).`,
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: TravelRequestForm;
  try {
    form = (await req.json()) as TravelRequestForm;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { isValid, errors } = validateForm(form);
  if (!isValid) {
    return NextResponse.json({ error: "The request is missing required fields", errors }, { status: 400 });
  }

  // Built before the send so the slow-ish step (workbook generation) never lands after the
  // email is already on its way -- the send is the point past which a failure must not read
  // as "email failed" to the client.
  const { buffer, fileName, grandTotal } = await buildTravelRequestWorkbook(form);
  console.log("[travel-submit] step=excel ok");

  const hrRecipient = process.env.HR_RECIPIENT;
  if (!hrRecipient) {
    console.error("[travel-submit] step=config error=missing HR_RECIPIENT");
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 500 });
  }

  try {
    await sendGraphEmail({
      to: hrRecipient,
      replyTo: form.header.email,
      subject: `${form.header.team} - ${form.header.name} - TR - ${formatMonthLong(form.header.month)}`,
      bodyText: buildEmailBody(form, grandTotal.totalAmountMmk),
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

  return new NextResponse(bufferToArrayBuffer(buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
