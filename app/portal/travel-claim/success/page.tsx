"use client";

import { useRouter } from "next/navigation";
import Button from "@/components/Button";

// Deliberately outside app/portal/(shell) -- this route must render full-screen with no
// sidebar/org chrome, unlike every other portal page. Mirrors the Travel Request success page.
export default function TravelClaimSuccessPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4" data-testid="travel-claim-success-page">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
            <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-navy-900">Your submission is successful!</h1>
        <p className="mb-4 text-sm text-gray-600">
          Your travel claim, its Excel summary, and your supporting documents have been emailed to HR.
        </p>
        <p className="mb-6 rounded bg-success-light px-3 py-2 text-xs text-success-text">
          HR will follow up using the email address you provided. Any documents that were too large to attach directly were included
          as secure links instead.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => router.push("/portal/travel-claim")}
          data-testid="travel-claim-success-back"
        >
          Submit another claim
        </Button>
      </div>
    </div>
  );
}
