"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import { calcGrandTotal } from "@/lib/travel/calc";
import { REQUEST_EXCEL_STORAGE_KEY, downloadRequestExcel, type StoredRequestExcel } from "@/lib/travel/excel-download";
import { formatDateLong, formatMmk, formatUsd, todayIso } from "@/lib/travel/format";
import { TEAMS } from "@/lib/travel/rates";
import { makeEmptyTrip, type Signature, type SubmissionMeta, type Trip, type TravelRequestForm, type UploadedFile } from "@/lib/travel/types";
import { formatRateCaption, latestRate, type UnRate, type UnRatesPayload } from "@/lib/travel/un-rates";
import { validateForm } from "@/lib/travel/validation";
import ApprovalAttachmentsField from "@/components/travel/ApprovalAttachmentsField";
import Field from "@/components/travel/Field";
import ImportExcelDialog, { type ImportedRequestData } from "@/components/travel/ImportExcelDialog";
import SignaturePad from "@/components/travel/SignaturePad";
import SubmitNoteDialog, { isSubmitNoteValid } from "@/components/travel/SubmitNoteDialog";
import TripBlock from "./TripBlock";

function makeEmptySubmitMeta(): SubmissionMeta {
  return { type: "new", number: null, note: "" };
}

const inputCls = "rounded border border-gray-300 px-2 py-2.5 text-base lg:py-1.5 lg:text-sm";

function makeEmptyHeader(): TravelRequestForm["header"] {
  return {
    month: "",
    // Submission Date is no longer user-entered -- it's always today (the server re-stamps it
    // at submit time regardless of what's sent, this is just for display -- see Fix 1).
    submissionDate: todayIso(),
    team: "",
    name: "",
    position: "",
    dutyStation: "",
    exchangeRate: null,
    notes: "",
    email: "",
  };
}

export default function TravelRequestPage() {
  const router = useRouter();
  const [header, setHeader] = useState<TravelRequestForm["header"]>(makeEmptyHeader());
  const [trips, setTrips] = useState<Trip[]>([makeEmptyTrip()]);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  // Tracks in-flight Approval Attachment uploads so Submit stays disabled until every upload
  // has resolved -- otherwise a fast click could submit before a file's URL lands in state.
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);

  // Submit is gated purely on live validity (spec §4). "interacted" just controls when
  // per-field errors start showing -- otherwise a brand-new blank form would greet the
  // user with every field already red, which reads as hostile rather than friendly.
  const [interacted, setInteracted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitMeta, setSubmitMeta] = useState<SubmissionMeta>(makeEmptySubmitMeta());

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // Set once a "Import Excel" upload succeeds -- drives the "Imported from ..." banner and locks
  // the confirm dialog's Submission type to Updated (see handleImported/SubmitNoteDialog).
  const [importedFileName, setImportedFileName] = useState<string | null>(null);

  const [unRates, setUnRates] = useState<UnRate[]>([]);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateRefreshing, setRateRefreshing] = useState(false);

  const form: TravelRequestForm = { header, trips, signature, attachments };
  const { errors, isValid } = useMemo(() => validateForm(form), [header, trips, signature, attachments]);
  const showErrors = interacted;

  const exchangeRate = header.exchangeRate ?? 0;
  const grandTotal = useMemo(() => calcGrandTotal(trips, exchangeRate), [trips, exchangeRate]);

  const activeRate = useMemo(() => latestRate(unRates), [unRates]);

  const loadRates = useCallback(async (forceRefresh: boolean): Promise<void> => {
    if (forceRefresh) setRateRefreshing(true);
    try {
      const res = await fetch(`/api/exchange-rate${forceRefresh ? "?refresh=1" : ""}`);
      const data = (await res.json()) as UnRatesPayload;
      setUnRates(data.rates);
      setRateError(data.rates.length === 0 ? (data.error ?? "Couldn't fetch the UN rate — please enter it manually") : null);
    } catch {
      setRateError("Couldn't fetch the UN rate — please enter it manually");
    } finally {
      if (forceRefresh) setRateRefreshing(false);
    }
  }, []);

  // Load the UN rate history once on mount.
  useEffect(() => {
    void loadRates(false);
  }, [loadRates]);

  // The Exchange rate field is non-editable and always mirrors the latest UN rate -- a travel
  // request is forward-looking, so it must never be tied to the selected Month.
  useEffect(() => {
    const rate = latestRate(unRates);
    setHeader((h) => (h.exchangeRate === (rate?.rate ?? null) ? h : { ...h, exchangeRate: rate?.rate ?? null }));
  }, [unRates]);

  function updateHeader<K extends keyof TravelRequestForm["header"]>(field: K, value: TravelRequestForm["header"][K]) {
    setInteracted(true);
    setHeader((h) => ({ ...h, [field]: value }));
  }

  async function handleRefreshRate() {
    await loadRates(true);
  }

  function addTrip() {
    setInteracted(true);
    setTrips((t) => [...t, makeEmptyTrip()]);
  }

  function removeTrip(id: string) {
    setInteracted(true);
    setTrips((t) => t.filter((trip) => trip.id !== id));
  }

  function updateTrip(id: string, next: Trip) {
    setInteracted(true);
    setTrips((t) => t.map((trip) => (trip.id === id ? next : trip)));
  }

  function updateSignature(next: Signature | null) {
    setInteracted(true);
    setSignature(next);
  }

  function updateAttachments(next: UploadedFile[]) {
    setInteracted(true);
    setAttachments(next);
  }

  function handleClear() {
    if (!window.confirm("Clear the entire form? This can't be undone.")) return;
    const rate = latestRate(unRates);
    setHeader({ ...makeEmptyHeader(), exchangeRate: rate?.rate ?? null });
    setTrips([makeEmptyTrip()]);
    setSignature(null);
    setAttachments([]);
    setImportedFileName(null);
    setInteracted(false);
    setApiError(null);
    setNotice(null);
  }

  // Populates the form from a re-imported system-generated Excel (see ImportExcelDialog). Only
  // the fields the spec calls out get overwritten -- signature/email/attachments are left exactly
  // as they were, since the user redoes those regardless of what's imported. An imported
  // submission is inherently a re-submission of the one that generated the file, so Submission
  // type is forced to Updated at the SAME number the file was ("Submission 2" stays 2, not 3) --
  // see SubmitNoteDialog's lockedToUpdated prop for where "New" gets disabled.
  function handleImported(result: ImportedRequestData, fileName: string) {
    setHeader((h) => ({
      ...h,
      month: result.header.month,
      team: result.header.team,
      name: result.header.name,
      position: result.header.position,
      dutyStation: result.header.dutyStation,
      notes: result.header.notes,
    }));
    setTrips(result.trips.length > 0 ? result.trips : [makeEmptyTrip()]);
    setSubmitMeta({ type: "updated", number: result.submissionNumber, note: "" });
    setImportedFileName(fileName);
    setInteracted(true);
    setImportDialogOpen(false);
  }

  function handleSubmitClick() {
    setApiError(null);
    setNotice(null);
    // Keep the existing validation gate first -- the dialog only opens once the form itself
    // is valid; it must never become a way to bypass required-field checks.
    if (!isValid || attachmentsUploading) return;
    setDialogOpen(true);
  }

  async function handleConfirmSend() {
    if (!isSubmitNoteValid(submitMeta)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/travel/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form, meta: submitMeta }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        excelFileName?: string;
        excelBase64?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Couldn't email HR — please try again");
      }
      setDialogOpen(false);

      // Best-effort: the send already succeeded, so a blocked/failed download must never surface
      // as an error here -- the success page's own fallback link (fed by the same stashed data)
      // covers the case where the automatic download didn't go through.
      if (body.excelFileName && body.excelBase64) {
        const excel: StoredRequestExcel = { fileName: body.excelFileName, base64: body.excelBase64 };
        try {
          sessionStorage.setItem(REQUEST_EXCEL_STORAGE_KEY, JSON.stringify(excel));
        } catch {
          // Storage full/unavailable (e.g. strict private browsing) -- only the fallback link is lost.
        }
        try {
          downloadRequestExcel(excel);
        } catch {
          // Blocked by the browser -- the success page's fallback link is the recovery path.
        }
      }

      router.push("/portal/travel-request/success");
    } catch (e) {
      setDialogOpen(false);
      setApiError(e instanceof Error ? e.message : "Couldn't email HR — please try again");
    } finally {
      setBusy(false);
    }
  }

  function handleCancelDialog() {
    setDialogOpen(false);
  }

  return (
    <div data-testid="travel-request-page">
      <h1 className="mb-1 text-xl font-semibold text-navy-900">Travel Request</h1>
      <p className="mb-4 text-sm text-gray-500">
        Fill in every required field and add each trip — the Submit button unlocks once everything checks out, then we generate the Excel travel request for you.
      </p>

      {apiError && <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="travel-submit-error">{apiError}</p>}
      {notice && <p className="mb-2 rounded bg-green-50 px-3 py-1.5 text-sm text-green-800" data-testid="travel-submit-notice">{notice}</p>}
      {showErrors && !isValid && (
        <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="travel-validation-summary">
          Some required fields still need attention — check the highlighted fields below.
        </p>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-header-card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-navy-900">Request details</h2>
          <button
            type="button"
            onClick={() => setImportDialogOpen(true)}
            className="rounded border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-light/30"
            data-testid="travel-import-btn"
          >
            Import Excel
          </button>
        </div>
        {importedFileName && (
          <p className="mb-2 rounded bg-primary-light/30 px-3 py-1.5 text-xs text-navy-900" data-testid="travel-imported-notice">
            Imported from {importedFileName} — this will be submitted as an Update.
          </p>
        )}
        <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-x-3 md:gap-y-3 lg:flex lg:flex-row lg:flex-wrap lg:items-start lg:gap-2">
          <Field label="Month" error={showErrors ? errors["header.month"] : undefined} width="w-full lg:w-36">
            <input type="month" className={`${inputCls} w-full`} value={header.month} onChange={(e) => updateHeader("month", e.target.value)} data-testid="travel-month" />
          </Field>
          <Field label="Submission Date" width="w-full lg:w-40">
            <p className={`${inputCls} w-full bg-gray-50 text-gray-700`} data-testid="travel-submission-date">
              {formatDateLong(header.submissionDate)}
            </p>
          </Field>
          <Field label="Team" error={showErrors ? errors["header.team"] : undefined} width="w-full lg:w-32">
            <select className={`${inputCls} w-full`} value={header.team} onChange={(e) => updateHeader("team", e.target.value)} data-testid="travel-team">
              <option value="">— select —</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Name of traveller" error={showErrors ? errors["header.name"] : undefined} width="w-full lg:w-48">
            <input type="text" className={`${inputCls} w-full`} value={header.name} onChange={(e) => updateHeader("name", e.target.value)} data-testid="travel-name" />
          </Field>
          <Field label="Position" error={showErrors ? errors["header.position"] : undefined} width="w-full lg:w-56">
            <input type="text" className={`${inputCls} w-full`} value={header.position} onChange={(e) => updateHeader("position", e.target.value)} data-testid="travel-position" />
          </Field>
          <Field label="Duty Station" error={showErrors ? errors["header.dutyStation"] : undefined} width="w-full lg:w-56">
            <input type="text" className={`${inputCls} w-full`} value={header.dutyStation} onChange={(e) => updateHeader("dutyStation", e.target.value)} data-testid="travel-duty-station" />
          </Field>
          <div className="flex w-full flex-col lg:w-44">
            <Field label="Exchange rate (MMK per USD)" error={showErrors ? errors["header.exchangeRate"] : undefined}>
              <input
                type="number"
                readOnly
                className={`${inputCls} w-full`}
                value={header.exchangeRate ?? ""}
                data-testid="travel-exchange-rate"
              />
            </Field>
            <p className="mt-0.5 text-[11px] text-gray-500" data-testid="travel-exchange-rate-caption">
              {rateError && unRates.length === 0 ? rateError : activeRate ? formatRateCaption(activeRate) : "Loading UN rate…"}{" "}
              <button
                type="button"
                onClick={() => void handleRefreshRate()}
                disabled={rateRefreshing}
                className="text-primary underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="travel-refresh-rate"
              >
                {rateRefreshing ? "Refreshing…" : "Refresh rate"}
              </button>
            </p>
          </div>
        </div>

        {(header.team === "MAL" || header.team === "HIV") && (
          <div className="mt-3">
            <Field label="Notes" error={showErrors ? errors["header.notes"] : undefined} width="w-full">
              <textarea
                className={`${inputCls} w-full`}
                rows={3}
                value={header.notes}
                onChange={(e) => updateHeader("notes", e.target.value)}
                data-testid="travel-notes"
              />
            </Field>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Shown under the table in the exported Excel — e.g. exchange-rate basis, estimated hotel charges, coach fares.
            </p>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-trips-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Trips</h2>
        <p className="mb-2 text-sm text-gray-500">
          Each trip starts with one row — add as many as you need (one-way = 1 row, out-and-back = 2, multi-stop = 3+). At least one
          complete trip is required.
        </p>
        {showErrors && errors["trips"] && <p className="mb-2 text-xs text-red-600" data-testid="travel-trips-error">{errors["trips"]}</p>}

        {trips.map((trip, i) => (
          <TripBlock
            key={trip.id}
            trip={trip}
            index={i}
            exchangeRate={exchangeRate}
            onChange={(next) => updateTrip(trip.id, next)}
            onRemove={() => removeTrip(trip.id)}
            canRemove={trips.length > 1}
            errors={showErrors ? errors : {}}
          />
        ))}

        <button
          type="button"
          onClick={addTrip}
          className="w-full rounded border border-primary px-3 py-2.5 text-base font-medium text-primary hover:bg-primary-light/30 lg:w-auto lg:py-1.5 lg:text-sm"
          data-testid="travel-add-trip"
        >
          Add trip
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-totals-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Totals</h2>
        <p className="text-sm text-gray-700" data-testid="travel-grand-total">
          Grand Total Per-diem: <strong>{formatUsd(grandTotal.totalPerDiemUsd)} USD</strong> · Grand Total Amount:{" "}
          <strong>{formatMmk(grandTotal.totalAmountMmk)} MMK</strong>
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-signature-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Employee signature</h2>
        <p className="mb-2 text-sm text-gray-500">Draw your signature or upload an image. Required.</p>
        <SignaturePad value={signature} onChange={updateSignature} />
        {showErrors && errors["signature"] && <p className="mt-1 text-xs text-red-600" data-testid="travel-signature-error">{errors["signature"]}</p>}

        <div className="mt-3">
          <Field label="Your email" error={showErrors ? errors["header.email"] : undefined} width="w-full lg:w-64">
            <input
              type="email"
              className={`${inputCls} w-full`}
              value={header.email}
              onChange={(e) => updateHeader("email", e.target.value)}
              data-testid="travel-email"
            />
          </Field>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Your own email (personal Gmail is fine) — HR will reply to your travel request here.
          </p>
        </div>

        <div className="mt-3">
          <ApprovalAttachmentsField
            files={attachments}
            onChange={updateAttachments}
            error={showErrors ? errors["attachments"] : undefined}
            disabled={busy}
            onUploadingChange={setAttachmentsUploading}
          />
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Button type="button" variant="primary" onClick={handleSubmitClick} disabled={busy || !isValid || attachmentsUploading} className="max-lg:min-h-[44px] max-lg:w-full" data-testid="travel-submit-btn">
            {busy ? "Sending…" : attachmentsUploading ? "Uploading…" : "Submit travel request"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={busy} className="max-lg:min-h-[44px] max-lg:w-full" data-testid="travel-clear-btn">
            Clear
          </Button>
        </div>
        {!isValid && <p className="mt-1 text-xs text-gray-400">Fill in every required field above to enable submit.</p>}
        {isValid && attachmentsUploading && <p className="mt-1 text-xs text-gray-400">Waiting for uploads to finish…</p>}
      </div>

      <SubmitNoteDialog
        open={dialogOpen}
        meta={submitMeta}
        onChange={setSubmitMeta}
        onCancel={handleCancelDialog}
        onConfirm={() => void handleConfirmSend()}
        busy={busy}
        lockedToUpdated={importedFileName !== null}
      />

      <ImportExcelDialog
        open={importDialogOpen}
        onCancel={() => setImportDialogOpen(false)}
        onImported={handleImported}
      />
    </div>
  );
}
