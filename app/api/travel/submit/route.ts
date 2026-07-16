import { NextRequest, NextResponse } from "next/server";
import { buildTravelRequestWorkbook, bufferToArrayBuffer } from "@/lib/travel/export-workbook";
import { validateForm } from "@/lib/travel/validation";
import { addSubmission } from "@/lib/portal/submissions";
import { sendGraphEmail } from "@/lib/email/graph";
import { formatMmk, formatMonthLong } from "@/lib/travel/format";
import type { TravelRequestForm } from "@/lib/travel/types";

export const runtime = "nodejs";

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

  const { buffer, fileName, grandTotal } = await buildTravelRequestWorkbook(form);

  const hrRecipient = process.env.HR_RECIPIENT;
  if (!hrRecipient) {
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
  } catch (e) {
    console.error("Graph sendMail failed", e);
    return NextResponse.json({ error: "Couldn't email HR — please try again" }, { status: 502 });
  }

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

  return new NextResponse(bufferToArrayBuffer(buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
