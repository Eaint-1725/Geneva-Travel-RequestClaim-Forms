import { NextRequest, NextResponse } from "next/server";
import { getUnRates } from "@/lib/travel/un-rates-cache";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
  const payload = await getUnRates(forceRefresh);
  return NextResponse.json(payload);
}
