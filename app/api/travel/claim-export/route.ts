import { NextRequest, NextResponse } from "next/server";
import { buildTravelClaimWorkbook, bufferToArrayBuffer } from "@/lib/travel/claim/export-workbook";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import { getUnRates } from "@/lib/travel/un-rates-cache";
import type { TravelClaimForm } from "@/lib/travel/claim/types";

export const runtime = "nodejs";

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

  const { buffer, fileName } = await buildTravelClaimWorkbook(form, unRates);

  return new NextResponse(bufferToArrayBuffer(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
