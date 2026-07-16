import { NextRequest, NextResponse } from "next/server";
import { buildTravelRequestWorkbook, bufferToArrayBuffer } from "@/lib/travel/export-workbook";
import { validateForm } from "@/lib/travel/validation";
import { addSubmission } from "@/lib/portal/submissions";
import type { TravelRequestForm } from "@/lib/travel/types";

export const runtime = "nodejs";

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
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
