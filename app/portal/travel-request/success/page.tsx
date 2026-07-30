"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import { REQUEST_EXCEL_STORAGE_KEY, downloadRequestExcel, type StoredRequestExcel } from "@/lib/travel/excel-download";

// Deliberately outside app/portal/(shell) -- this route must render full-screen with no
// sidebar/org chrome, unlike every other portal page. Mirrors the Travel Claim success page.
export default function TravelRequestSuccessPage() {
  const router = useRouter();
  const [excel, setExcel] = useState<StoredRequestExcel | null>(null);

  // The submit page stashes the same Excel it just tried to auto-download here, purely as a
  // fallback for browsers that silently block/drop the automatic download -- read once and clear
  // immediately, so a stale copy from an earlier submission can never resurface on a later,
  // unrelated visit to this route (e.g. the user navigating back here directly).
  useEffect(() => {
    const raw = sessionStorage.getItem(REQUEST_EXCEL_STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(REQUEST_EXCEL_STORAGE_KEY);
    try {
      setExcel(JSON.parse(raw) as StoredRequestExcel);
    } catch {
      // Malformed stash -- no fallback link, nothing else affected.
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4" data-testid="travel-request-success-page">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
            <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-navy-900">Your submission is successful!</h1>
        <p className="mb-4 text-sm text-gray-600">
          Your travel request has been emailed to HR, and a copy of the Excel file has been downloaded to your device.
        </p>
        <p className="mb-6 rounded bg-success-light px-3 py-2 text-xs text-success-text">
          HR will follow up using the email address you provided.
        </p>
        {excel && (
          <Button
            type="button"
            variant="secondary"
            className="mb-3 w-full max-lg:min-h-[44px]"
            onClick={() => downloadRequestExcel(excel)}
            data-testid="travel-request-success-download"
          >
            Download the Excel
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          onClick={() => router.push("/portal/travel-request")}
          className="max-lg:min-h-[44px] max-lg:w-full"
          data-testid="travel-request-success-back"
        >
          Submit another request
        </Button>
      </div>
    </div>
  );
}
