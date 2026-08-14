"use client";

import { useState } from "react";
import Button from "@/components/Button";
import Dropzone from "@/components/Dropzone";
import type { ImportedFormResult } from "@/lib/travel/types";

const GENERIC_ERROR = "Couldn't import this file — please try again.";

// Popup for "Import Excel", shared by Travel Request and Travel Claim -- uploads a previously
// system-generated .xlsx to `apiUrl`, which validates the filename and reads the file's embedded
// form data (see lib/travel/excel-embed.ts), and hands the result back to the page to populate
// state. Generic over the header shape (THeader) since Request's and Claim's headers differ (e.g.
// Claim's travelArea); everything else -- copy structure, upload flow, error handling -- is
// identical between the two, so this stays one component (mirrors SubmitNoteDialog's own `kind`
// prop for the same request/claim split).
export default function ImportExcelDialog<THeader>({
  open,
  onCancel,
  onImported,
  apiUrl,
  docLabel,
  excludedFieldsNote,
}: {
  open: boolean;
  onCancel: () => void;
  onImported: (result: ImportedFormResult<THeader>, fileName: string) => void;
  /** Import route for this form, e.g. "/api/travel/import" or "/api/travel/claim/import". */
  apiUrl: string;
  /** "Travel Request" | "Travel Claim" -- used in the intro copy. */
  docLabel: string;
  /** e.g. "Your signature, email, and Approval Attachments won't be imported — you'll redo those." */
  excludedFieldsNote: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as Partial<ImportedFormResult<THeader>> & { error?: string };
      if (!res.ok || !body.header || !body.trips || typeof body.submissionNumber !== "number") {
        throw new Error(body.error ?? GENERIC_ERROR);
      }
      onImported({ header: body.header, trips: body.trips, submissionNumber: body.submissionNumber }, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="travel-import-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-base font-semibold text-navy-900">Import Excel</h2>
        <p className="mb-3 text-sm text-gray-500">
          Upload a {docLabel} Excel this system previously generated for you to auto-fill this form as a re-submission. {excludedFieldsNote}
        </p>

        <Dropzone
          onFiles={(fs) => void handleFiles(fs)}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          testid="travel-import-dropzone"
        >
          <span className="text-gray-500">{busy ? "Importing…" : "Drop the Excel file here or click to browse"}</span>
        </Dropzone>

        {error && (
          <p className="mt-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="travel-import-error">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            className="max-lg:min-h-[44px] max-lg:w-full"
            data-testid="travel-import-cancel"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
