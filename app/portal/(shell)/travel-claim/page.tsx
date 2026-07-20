"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import Field from "@/components/travel/Field";
import SignaturePad from "@/components/travel/SignaturePad";
import { calcClaimGrandTotal } from "@/lib/travel/claim/calc";
import { resolveRowRate } from "@/lib/travel/claim/rate";
import type { CoverScanResult } from "@/lib/travel/claim/document-scan";
import {
  makeEmptyClaimDocuments,
  makeEmptyClaimHeader,
  type ClaimDocuments,
  type TravelClaimForm,
  type TravelClaimHeader,
} from "@/lib/travel/claim/types";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import {
  DOC_LABELS,
  MAX_FILE_BYTES,
  MAX_TOTAL_ATTACH_BYTES,
  OPTIONAL_DOC_KEYS,
  coverReportRequired,
  formatBytes,
  totalDocumentBytes,
  type OptionalDocKey,
} from "@/lib/travel/claim/documents";
import { TEAMS } from "@/lib/travel/rates";
import { formatMmk, formatUsd } from "@/lib/travel/format";
import { makeEmptyTrip, type Row, type Signature, type Trip } from "@/lib/travel/types";
import { formatRateCaption, latestRate, type UnRate, type UnRatesPayload } from "@/lib/travel/un-rates";
import ClaimTripBlock from "./ClaimTripBlock";
import ClaimDocumentField from "./ClaimDocumentField";
import CoverScanPanel from "./CoverScanPanel";

const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

const EMPTY_CHECKED_DOCS: Record<OptionalDocKey, boolean> = {
  justification: false,
  approvedEmail: false,
  airTicket: false,
  declaration: false,
  certificate: false,
};

export default function TravelClaimPage() {
  const router = useRouter();
  const [header, setHeader] = useState<TravelClaimHeader>(makeEmptyClaimHeader());
  const [trips, setTrips] = useState<Trip[]>([makeEmptyTrip()]);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [documents, setDocuments] = useState<ClaimDocuments>(makeEmptyClaimDocuments());
  const [checkedDocs, setCheckedDocs] = useState<Record<OptionalDocKey, boolean>>(EMPTY_CHECKED_DOCS);
  // Field keys currently mid-upload to Blob -- submit stays disabled until this is empty, so a
  // click can't race an in-flight upload and submit a claim missing a document the user just added.
  const [uploadingFields, setUploadingFields] = useState<Set<string>>(new Set());

  // Pre-submit automated scan of the Travel Cover PDF (see lib/travel/claim/document-scan).
  // Runs in parallel with that field's Blob upload, not after it -- the scan uses the browser's
  // own File, independent of Blob storage.
  const [coverScan, setCoverScan] = useState<CoverScanResult | null>(null);
  const [coverScanning, setCoverScanning] = useState(false);
  const [coverScanAck, setCoverScanAck] = useState(false);
  // Guards a stale in-flight scan response from clobbering state after the file is removed or
  // replaced with a newer one.
  const scanRequestIdRef = useRef(0);

  // Same interacted/showErrors pattern as Travel Request -- a brand-new blank form shouldn't
  // greet the user with every field already red.
  const [interacted, setInteracted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [unRates, setUnRates] = useState<UnRate[]>([]);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateRefreshing, setRateRefreshing] = useState(false);

  const form: TravelClaimForm = { header, trips, signature, documents };
  const { errors, isValid } = useMemo(() => validateClaimForm(form, unRates), [header, trips, signature, documents, unRates]);
  const showErrors = interacted;
  const coverReport = coverReportRequired(header);
  const totalBytes = useMemo(() => totalDocumentBytes(documents), [documents]);

  const coverScanBlocked = coverScan?.hasBlockingFailure ?? false;
  const coverScanNeedsAck =
    !!coverScan &&
    !coverScanBlocked &&
    !coverScanAck &&
    (coverScan.scanAvailable === false ||
      coverScan.checks.some((c) => c.status === "warn" || (c.status === "fail" && c.severity === "warn")));

  const rateForRow = useCallback((row: Row) => resolveRowRate(row.date, unRates)?.rate ?? 0, [unRates]);
  const grandTotal = useMemo(() => calcClaimGrandTotal(trips, rateForRow), [trips, rateForRow]);

  const activeRate = useMemo(() => latestRate(unRates), [unRates]);

  const loadRates = useCallback(async (forceRefresh: boolean): Promise<void> => {
    if (forceRefresh) setRateRefreshing(true);
    try {
      const res = await fetch(`/api/exchange-rate${forceRefresh ? "?refresh=1" : ""}`);
      const data = (await res.json()) as UnRatesPayload;
      setUnRates(data.rates);
      setRateError(data.rates.length === 0 ? (data.error ?? "Couldn't fetch the UN rate history — per-row rates will show as unavailable") : null);
    } catch {
      setRateError("Couldn't fetch the UN rate history — per-row rates will show as unavailable");
    } finally {
      if (forceRefresh) setRateRefreshing(false);
    }
  }, []);

  // Load the UN rate history once on mount -- each row derives its own rate from this list.
  useEffect(() => {
    void loadRates(false);
  }, [loadRates]);

  // Team + Inside/Outside town together decide whether Travel Cover/Report are required (see
  // coverReportRequired). Moving away from HIV must hide the town dropdown AND clear its value,
  // so a stale "outside" choice from a previous HIV selection can't keep blocking submit.
  useEffect(() => {
    if (header.team !== "HIV" && header.townLocation) {
      setHeader((h) => ({ ...h, townLocation: "" }));
    }
  }, [header.team, header.townLocation]);

  // Removing the Travel Cover file doesn't go through ClaimDocumentField's onFileAccepted (that
  // only fires on accept, not on remove) -- so watch for the field going empty here instead.
  // Replacement is handled separately: dropping a new file re-fires onFileAccepted, which already
  // resets this state before starting a fresh scan.
  useEffect(() => {
    if (documents.travelCover.length === 0) {
      scanRequestIdRef.current++;
      setCoverScan(null);
      setCoverScanAck(false);
      setCoverScanning(false);
    }
  }, [documents.travelCover.length]);

  function updateHeader<K extends keyof TravelClaimHeader>(field: K, value: TravelClaimHeader[K]) {
    setInteracted(true);
    setHeader((h) => ({ ...h, [field]: value }));
  }

  function updateDocuments<K extends keyof ClaimDocuments>(field: K, files: ClaimDocuments[K]) {
    setInteracted(true);
    setDocuments((d) => ({ ...d, [field]: files }));
  }

  function setFieldUploading(key: string, uploading: boolean) {
    setUploadingFields((prev) => {
      const next = new Set(prev);
      if (uploading) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function handleCoverFileAccepted(file: File) {
    const requestId = ++scanRequestIdRef.current;
    setCoverScan(null);
    setCoverScanAck(false);
    setCoverScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/travel/claim/scan-cover", { method: "POST", body: fd });
      const result = (await res.json()) as CoverScanResult;
      if (scanRequestIdRef.current === requestId) setCoverScan(result);
    } catch {
      // The route itself already degrades gracefully on a provider error -- this catch only
      // covers the fetch call failing outright (network blip, non-JSON response, etc).
      if (scanRequestIdRef.current === requestId) {
        setCoverScan({
          checks: [
            {
              id: "scan_unavailable",
              label: "Automated scan",
              status: "warn",
              severity: "warn",
              message: "Automated scan unavailable — please verify the cover manually.",
            },
          ],
          hasBlockingFailure: false,
          scanAvailable: false,
        });
      }
    } finally {
      if (scanRequestIdRef.current === requestId) setCoverScanning(false);
    }
  }

  function toggleOptionalDoc(key: OptionalDocKey, checked: boolean) {
    setInteracted(true);
    setCheckedDocs((c) => ({ ...c, [key]: checked }));
    if (!checked) setDocuments((d) => ({ ...d, [key]: [] })); // unticking drops its files
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

  function handleClear() {
    if (!window.confirm("Clear the entire form? This can't be undone.")) return;
    setHeader(makeEmptyClaimHeader());
    setTrips([makeEmptyTrip()]);
    setSignature(null);
    setDocuments(makeEmptyClaimDocuments());
    setCheckedDocs(EMPTY_CHECKED_DOCS);
    setInteracted(false);
    setApiError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    setApiError(null);
    setNotice(null);
    if (!isValid || uploadingFields.size > 0) return;

    setBusy(true);
    try {
      const res = await fetch("/api/travel/claim/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't email HR — please try again");
      }
      router.push("/portal/travel-claim/success");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Couldn't email HR — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="travel-claim-page">
      <h1 className="mb-1 text-xl font-semibold text-navy-900">Travel Claim</h1>
      <p className="mb-4 text-sm text-gray-500">
        Fill in every required field, add each trip, and attach your supporting documents — each row&apos;s exchange rate is derived
        automatically from its own date. The Submit button unlocks once everything checks out, then we email HR the completed travel claim.
      </p>

      {apiError && <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="travel-claim-submit-error">{apiError}</p>}
      {notice && <p className="mb-2 rounded bg-green-50 px-3 py-1.5 text-sm text-green-800" data-testid="travel-claim-submit-notice">{notice}</p>}
      {showErrors && !isValid && (
        <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700" data-testid="travel-claim-validation-summary">
          Some required fields still need attention — check the highlighted fields below.
        </p>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-header-card">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Claim details</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Month" error={showErrors ? errors["header.month"] : undefined} width="w-36">
            <input type="month" className={`${inputCls} w-full`} value={header.month} onChange={(e) => updateHeader("month", e.target.value)} data-testid="travel-claim-month" />
          </Field>
          <Field label="Submission Date" error={showErrors ? errors["header.submissionDate"] : undefined} width="w-40">
            <input type="date" className={`${inputCls} w-full`} value={header.submissionDate} onChange={(e) => updateHeader("submissionDate", e.target.value)} data-testid="travel-claim-submission-date" />
          </Field>
          <Field label="Team" error={showErrors ? errors["header.team"] : undefined} width="w-32">
            <select className={`${inputCls} w-full`} value={header.team} onChange={(e) => updateHeader("team", e.target.value)} data-testid="travel-claim-team">
              <option value="">— select —</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Name of traveller" error={showErrors ? errors["header.name"] : undefined} width="w-48">
            <input type="text" className={`${inputCls} w-full`} value={header.name} onChange={(e) => updateHeader("name", e.target.value)} data-testid="travel-claim-name" />
          </Field>
          <Field label="Position" error={showErrors ? errors["header.position"] : undefined} width="w-56">
            <input type="text" className={`${inputCls} w-full`} value={header.position} onChange={(e) => updateHeader("position", e.target.value)} data-testid="travel-claim-position" />
          </Field>
          <Field label="Duty Station" error={showErrors ? errors["header.dutyStation"] : undefined} width="w-56">
            <input type="text" className={`${inputCls} w-full`} value={header.dutyStation} onChange={(e) => updateHeader("dutyStation", e.target.value)} data-testid="travel-claim-duty-station" />
          </Field>
          {header.team === "HIV" && (
            <Field label="Inside/Outside town" error={showErrors ? errors["header.townLocation"] : undefined} width="w-40">
              <select
                className={`${inputCls} w-full`}
                value={header.townLocation}
                onChange={(e) => updateHeader("townLocation", e.target.value as TravelClaimHeader["townLocation"])}
                data-testid="travel-claim-town-location"
              >
                <option value="">— select —</option>
                <option value="inside">Inside town</option>
                <option value="outside">Outside town</option>
              </select>
            </Field>
          )}
        </div>

        <p className="mt-3 text-[11px] text-gray-500" data-testid="travel-claim-rate-status">
          {rateError && unRates.length === 0 ? rateError : activeRate ? formatRateCaption(activeRate) : "Loading UN rate history…"}{" "}
          <button
            type="button"
            onClick={() => void handleRefreshRate()}
            disabled={rateRefreshing}
            className="text-primary underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="travel-claim-refresh-rate"
          >
            {rateRefreshing ? "Refreshing…" : "Refresh rates"}
          </button>
        </p>

        {header.team === "MAL" && (
          <div className="mt-3">
            <Field label="Notes" error={showErrors ? errors["header.notes"] : undefined} width="w-full">
              <textarea
                className={`${inputCls} w-full`}
                rows={3}
                value={header.notes}
                onChange={(e) => updateHeader("notes", e.target.value)}
                data-testid="travel-claim-notes"
              />
            </Field>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Shown under the table in the exported Excel — e.g. exchange-rate basis, estimated hotel charges, coach fares.
            </p>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-trips-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Trips</h2>
        <p className="mb-2 text-sm text-gray-500">
          Each trip starts with one row — add as many as you need (one-way = 1 row, out-and-back = 2, multi-stop = 3+). At least one
          complete trip is required.
        </p>
        {showErrors && errors["trips"] && <p className="mb-2 text-xs text-red-600" data-testid="travel-claim-trips-error">{errors["trips"]}</p>}

        {trips.map((trip, i) => (
          <ClaimTripBlock
            key={trip.id}
            trip={trip}
            index={i}
            unRates={unRates}
            onChange={(next) => updateTrip(trip.id, next)}
            onRemove={() => removeTrip(trip.id)}
            canRemove={trips.length > 1}
            errors={showErrors ? errors : {}}
          />
        ))}

        <button
          type="button"
          onClick={addTrip}
          className="rounded border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-light/30"
          data-testid="travel-claim-add-trip"
        >
          Add trip
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-totals-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Totals</h2>
        <p className="text-sm text-gray-700" data-testid="travel-claim-grand-total">
          Grand Total Per-diem: <strong>{formatUsd(grandTotal.totalPerDiemUsd)} USD</strong> · Grand Total Amount:{" "}
          <strong>{formatMmk(grandTotal.totalAmountMmk)} MMK</strong>
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-documents-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Supporting documents</h2>
        <p className="mb-3 text-sm text-gray-500">
          Per-file limit {formatBytes(MAX_FILE_BYTES)}. Total uploaded so far: <strong data-testid="travel-claim-documents-total">{formatBytes(totalBytes)}</strong>
          {totalBytes > MAX_TOTAL_ATTACH_BYTES
            ? " — some files will be emailed to HR as secure download links instead of attachments (still delivered, just not attached)."
            : `, within the ${formatBytes(MAX_TOTAL_ATTACH_BYTES)} email attachment budget.`}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ClaimDocumentField
            label="Travel Request (PDF, required)"
            testid="travel-claim-doc-travelRequest"
            pdfOnly
            files={documents.travelRequest}
            onChange={(files) => updateDocuments("travelRequest", files)}
            error={showErrors ? errors["documents.travelRequest"] : undefined}
            disabled={busy}
            onUploadingChange={(u) => setFieldUploading("travelRequest", u)}
          />
          <div>
            <ClaimDocumentField
              label={`Travel Cover (PDF, ${coverReport ? "required" : "optional"})`}
              testid="travel-claim-doc-travelCover"
              pdfOnly
              files={documents.travelCover}
              onChange={(files) => updateDocuments("travelCover", files)}
              onFileAccepted={(file) => void handleCoverFileAccepted(file)}
              error={showErrors ? errors["documents.travelCover"] : undefined}
              disabled={busy}
              onUploadingChange={(u) => setFieldUploading("travelCover", u)}
            />
            <CoverScanPanel scan={coverScan} scanning={coverScanning} ack={coverScanAck} onAckChange={setCoverScanAck} />
          </div>
          <ClaimDocumentField
            label={`Travel Report (PDF, ${coverReport ? "required" : "optional"})`}
            testid="travel-claim-doc-travelReport"
            pdfOnly
            files={documents.travelReport}
            onChange={(files) => updateDocuments("travelReport", files)}
            error={showErrors ? errors["documents.travelReport"] : undefined}
            disabled={busy}
            onUploadingChange={(u) => setFieldUploading("travelReport", u)}
          />
          <ClaimDocumentField
            label="Voucher (required, multiple files allowed)"
            testid="travel-claim-doc-voucher"
            multiple
            files={documents.voucher}
            onChange={(files) => updateDocuments("voucher", files)}
            error={showErrors ? errors["documents.voucher"] : undefined}
            disabled={busy}
            onUploadingChange={(u) => setFieldUploading("voucher", u)}
          />
        </div>

        <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-600">Optional documents</p>
          {OPTIONAL_DOC_KEYS.map((key) => (
            <div key={key}>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={checkedDocs[key]}
                  onChange={(e) => toggleOptionalDoc(key, e.target.checked)}
                  disabled={busy}
                  data-testid={`travel-claim-doc-${key}-checkbox`}
                />
                {DOC_LABELS[key]}
              </label>
              {checkedDocs[key] && (
                <div className="ml-6 mt-1">
                  <ClaimDocumentField
                    label={DOC_LABELS[key]}
                    testid={`travel-claim-doc-${key}`}
                    multiple
                    files={documents[key]}
                    onChange={(files) => updateDocuments(key, files)}
                    disabled={busy}
                    onUploadingChange={(u) => setFieldUploading(key, u)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-signature-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Employee signature</h2>
        <p className="mb-2 text-sm text-gray-500">Draw your signature or upload an image. Required.</p>
        <SignaturePad value={signature} onChange={updateSignature} />
        {showErrors && errors["signature"] && <p className="mt-1 text-xs text-red-600" data-testid="travel-claim-signature-error">{errors["signature"]}</p>}

        <div className="mt-3">
          <Field label="Your email" error={showErrors ? errors["header.email"] : undefined} width="w-64">
            <input
              type="email"
              className={`${inputCls} w-full`}
              value={header.email}
              onChange={(e) => updateHeader("email", e.target.value)}
              data-testid="travel-claim-email"
            />
          </Field>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Your own email (personal Gmail is fine) — HR will reply to your travel claim here.
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={busy || !isValid || uploadingFields.size > 0 || coverScanning || coverScanBlocked || coverScanNeedsAck}
            data-testid="travel-claim-submit-btn"
          >
            {busy ? "Sending…" : uploadingFields.size > 0 ? "Uploading…" : "Submit travel claim"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={busy} data-testid="travel-claim-clear-btn">
            Clear
          </Button>
        </div>
        {!isValid && <p className="mt-1 text-xs text-gray-400">Fill in every required field above to enable submit.</p>}
        {isValid && uploadingFields.size > 0 && <p className="mt-1 text-xs text-gray-400">Waiting for uploads to finish…</p>}
        {isValid && uploadingFields.size === 0 && coverScanning && <p className="mt-1 text-xs text-gray-400">Checking the Travel Cover…</p>}
        {isValid && uploadingFields.size === 0 && coverScanBlocked && (
          <p className="mt-1 text-xs text-red-600">The Travel Cover has a blocking issue above that must be resolved before submitting.</p>
        )}
        {isValid && uploadingFields.size === 0 && !coverScanBlocked && coverScanNeedsAck && (
          <p className="mt-1 text-xs text-gray-400">Review the Travel Cover checklist above and tick the acknowledgement to enable submit.</p>
        )}
      </div>
    </div>
  );
}
