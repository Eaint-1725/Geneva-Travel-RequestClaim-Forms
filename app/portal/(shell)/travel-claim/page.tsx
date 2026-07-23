"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import Field from "@/components/travel/Field";
import SignaturePad from "@/components/travel/SignaturePad";
import { calcClaimGrandTotal } from "@/lib/travel/claim/calc";
import { resolveRowRate } from "@/lib/travel/claim/rate";
import type { DocScanResult } from "@/lib/travel/claim/document-scan";
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
import DocScanPanel from "./DocScanPanel";

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

  // Pre-submit automated scans of the Travel Cover and Travel Report PDFs (see
  // lib/travel/claim/document-scan). Each starts once that field's own Blob upload finishes (see
  // ClaimDocumentField's onFileAccepted) -- the scan uses the browser's own File, independent of
  // Blob storage, but is sequenced after the upload so the two don't compete for the server's
  // event loop at once. The two documents scan independently (separate state, separate requests)
  // but gate together -- see docsGateActive below.
  const [coverScan, setCoverScan] = useState<DocScanResult | null>(null);
  const [coverScanning, setCoverScanning] = useState(false);
  // Only meaningful in the scan-outage fallback (scanAvailable:false) -- unlocks the gate via a
  // manual "I verified it myself" acknowledgement instead of per-check results.
  const [coverScanManualAck, setCoverScanManualAck] = useState(false);
  // Per-check overrides for a required check the scan got wrong (see DocScanPanel and the plan
  // this shipped with, §D) -- ids of checks the user explicitly confirmed are present despite the
  // scan reporting otherwise. Logged in the submission (coverScanStatus.overriddenChecks) so HR
  // can see what was bypassed.
  const [overriddenCheckIds, setOverriddenCheckIds] = useState<Set<string>>(new Set());
  // Guards a stale in-flight scan response from clobbering state after the file is removed or
  // replaced with a newer one.
  const scanRequestIdRef = useRef(0);

  // Same pattern as the cover's scan state, one level down -- see the Travel Report scan plan.
  const [reportScan, setReportScan] = useState<DocScanResult | null>(null);
  const [reportScanning, setReportScanning] = useState(false);
  const [reportScanManualAck, setReportScanManualAck] = useState(false);
  const [reportOverriddenCheckIds, setReportOverriddenCheckIds] = useState<Set<string>>(new Set());
  const reportScanRequestIdRef = useRef(0);

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

  // Every required check not yet "pass" and not explicitly overridden -- see DocScanPanel and
  // the plan this shipped with (§B/§D). Empty once every required check passes, or every failing
  // one has been individually overridden.
  const coverBlockingChecks = useMemo(
    () => (coverScan?.checks ?? []).filter((c) => c.severity === "block" && c.status !== "pass" && !overriddenCheckIds.has(c.id)),
    [coverScan, overriddenCheckIds],
  );
  const coverScanUnavailable = coverScan?.scanAvailable === false;

  const reportBlockingChecks = useMemo(
    () => (reportScan?.checks ?? []).filter((c) => c.severity === "block" && c.status !== "pass" && !reportOverriddenCheckIds.has(c.id)),
    [reportScan, reportOverriddenCheckIds],
  );
  const reportScanUnavailable = reportScan?.scanAvailable === false;

  // Sequential unlock (see the plan this shipped with, §C), applied to each document
  // independently. Keyed off whether a scan actually RAN, not off required-ness: "optional"
  // (HIV in-town) governs whether the document must be provided, never whether a provided one may
  // be invalid. So nothing uploaded passes only when the doc isn't required at all; but once a
  // scan has run -- required or not -- the gate always depends on its real result, same strict
  // rule as always (a failing/unconfirmed required check blocks until fixed, removed, or
  // overridden; scan-outage fallback still needs the manual acknowledgement).
  const coverGatePassed = coverScan
    ? coverScanUnavailable
      ? coverScanManualAck
      : coverBlockingChecks.length === 0
    : !coverReport;
  const reportGatePassed = reportScan
    ? reportScanUnavailable
      ? reportScanManualAck
      : reportBlockingChecks.length === 0
    : !coverReport;
  // Both must pass for the dependent uploads/submit to unlock (see the plan this shipped with,
  // §3: "If BOTH the cover and the report are required for the team, BOTH must pass"). No longer
  // gated on `coverReport` here -- each of the two formulas above already accounts for
  // required-vs-optional on its own, so this generalizes correctly (an optional doc that was
  // uploaded and is failing its scan must still block, which `coverReport &&` used to suppress).
  const docsGatePassed = coverGatePassed && reportGatePassed;
  const docsGateActive = !docsGatePassed;

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

  // Team + Travel area together decide whether Travel Cover/Report are required (see
  // coverReportRequired). Moving away from HIV must hide the dropdown AND clear its value, so a
  // stale "out_of_town" choice from a previous HIV selection can't keep blocking submit.
  useEffect(() => {
    if (header.team !== "HIV" && header.travelArea) {
      setHeader((h) => ({ ...h, travelArea: "" }));
    }
  }, [header.team, header.travelArea]);

  // Removing the Travel Cover file doesn't go through ClaimDocumentField's onFileAccepted (that
  // only fires on accept, not on remove) -- so watch for the field going empty here instead.
  // Replacement is handled separately: dropping a new file re-fires onFileAccepted, which already
  // resets this state before starting a fresh scan.
  useEffect(() => {
    if (documents.travelCover.length === 0) {
      scanRequestIdRef.current++;
      setCoverScan(null);
      setCoverScanManualAck(false);
      setOverriddenCheckIds(new Set());
      setCoverScanning(false);
    }
  }, [documents.travelCover.length]);

  // Same reset as the cover's, for the Travel Report field.
  useEffect(() => {
    if (documents.travelReport.length === 0) {
      reportScanRequestIdRef.current++;
      setReportScan(null);
      setReportScanManualAck(false);
      setReportOverriddenCheckIds(new Set());
      setReportScanning(false);
    }
  }, [documents.travelReport.length]);

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
    setCoverScanManualAck(false);
    setOverriddenCheckIds(new Set());
    setCoverScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/travel/claim/scan-cover", { method: "POST", body: fd });
      const result = (await res.json()) as DocScanResult;
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

  function handleOverrideCheck(checkId: string) {
    setOverriddenCheckIds((prev) => new Set(prev).add(checkId));
  }

  // Mirrors handleCoverFileAccepted, plus forwards the already-selected team as scan context (the
  // TU's Clearance rule is team-conditional -- see openai-provider.ts's scanTravelReport).
  async function handleReportFileAccepted(file: File) {
    const requestId = ++reportScanRequestIdRef.current;
    setReportScan(null);
    setReportScanManualAck(false);
    setReportOverriddenCheckIds(new Set());
    setReportScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("team", header.team);
      const res = await fetch("/api/travel/claim/scan-report", { method: "POST", body: fd });
      const result = (await res.json()) as DocScanResult;
      if (reportScanRequestIdRef.current === requestId) setReportScan(result);
    } catch (e) {
      // TEMP DIAGNOSTIC (see the Travel Report scan-unavailable investigation) -- remove once
      // the report path is confirmed working. This client-side catch only fires if the fetch
      // itself failed or the response wasn't JSON -- the route degrades gracefully otherwise.
      console.error("[scan-report] client fetch/parse failed", e);
      if (reportScanRequestIdRef.current === requestId) {
        setReportScan({
          checks: [
            {
              id: "scan_unavailable",
              label: "Automated scan",
              status: "warn",
              severity: "warn",
              message: "Automated scan unavailable — please verify the report manually.",
            },
          ],
          hasBlockingFailure: false,
          scanAvailable: false,
        });
      }
    } finally {
      if (reportScanRequestIdRef.current === requestId) setReportScanning(false);
    }
  }

  function handleReportOverrideCheck(checkId: string) {
    setReportOverriddenCheckIds((prev) => new Set(prev).add(checkId));
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
    setCoverScan(null);
    setCoverScanManualAck(false);
    setOverriddenCheckIds(new Set());
    setReportScan(null);
    setReportScanManualAck(false);
    setReportOverriddenCheckIds(new Set());
    setInteracted(false);
    setApiError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    setApiError(null);
    setNotice(null);
    if (!isValid || uploadingFields.size > 0 || docsGateActive) return;

    // Attached to the submission payload for HR visibility only (see DocScanStatus) -- never
    // consulted by validation itself, which is why this is built fresh here rather than kept in
    // form state.
    const coverScanStatus = coverReport
      ? {
          scanAvailable: coverScan?.scanAvailable ?? true,
          overriddenChecks: (coverScan?.checks ?? [])
            .filter((c) => overriddenCheckIds.has(c.id))
            .map((c) => `${c.id} — ${c.label}`),
        }
      : undefined;
    const reportScanStatus = coverReport
      ? {
          scanAvailable: reportScan?.scanAvailable ?? true,
          overriddenChecks: (reportScan?.checks ?? [])
            .filter((c) => reportOverriddenCheckIds.has(c.id))
            .map((c) => `${c.id} — ${c.label}`),
        }
      : undefined;

    setBusy(true);
    try {
      const res = await fetch("/api/travel/claim/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, coverScanStatus, reportScanStatus }),
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
            <Field label="Travel area" error={showErrors ? errors["header.travelArea"] : undefined} width="w-56">
              <select
                className={`${inputCls} w-full`}
                value={header.travelArea}
                onChange={(e) => updateHeader("travelArea", e.target.value as TravelClaimHeader["travelArea"])}
                data-testid="travel-claim-travel-area"
              >
                <option value="">Select…</option>
                <option value="in_town">In-town (within duty station)</option>
                <option value="out_of_town">Out-of-town (outside duty station)</option>
              </select>
            </Field>
          )}
        </div>

        {header.team === "HIV" && (
          <p className="mt-0.5 text-[11px] text-gray-500" data-testid="travel-claim-travel-area-hint">
            Out-of-town travel requires the Travel Cover and Travel Report.
          </p>
        )}

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

        {docsGateActive && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" data-testid="travel-claim-doc-gate-notice">
            <p className="font-medium">Fix the Travel Cover/Report below before uploading the Voucher/optional documents or submitting:</p>
            <ul className="ml-4 list-disc">
              {!coverGatePassed && !coverScan && <li>Upload the Travel Cover PDF below to run the automated check.</li>}
              {!coverGatePassed && coverScan && coverScanUnavailable && (
                <li>Travel Cover: automated scan unavailable — tick the acknowledgement below its checklist to continue.</li>
              )}
              {!coverGatePassed &&
                coverScan &&
                !coverScanUnavailable &&
                coverBlockingChecks.map((c) => <li key={`cover-${c.id}`}>Travel Cover: {c.message}</li>)}
              {!reportGatePassed && !reportScan && <li>Upload the Travel Report PDF below to run the automated check.</li>}
              {!reportGatePassed && reportScan && reportScanUnavailable && (
                <li>Travel Report: automated scan unavailable — tick the acknowledgement below its checklist to continue.</li>
              )}
              {!reportGatePassed &&
                reportScan &&
                !reportScanUnavailable &&
                reportBlockingChecks.map((c) => <li key={`report-${c.id}`}>Travel Report: {c.message}</li>)}
            </ul>
          </div>
        )}

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
              label={`Travel Cover (PDF, ${coverReport ? "required" : "optional for in-town travel"})`}
              testid="travel-claim-doc-travelCover"
              pdfOnly
              files={documents.travelCover}
              onChange={(files) => updateDocuments("travelCover", files)}
              onFileAccepted={(file) => void handleCoverFileAccepted(file)}
              error={showErrors ? errors["documents.travelCover"] : undefined}
              disabled={busy}
              onUploadingChange={(u) => setFieldUploading("travelCover", u)}
            />
            <DocScanPanel
              idPrefix="travel-claim-cover-scan"
              docLabel="cover"
              scan={coverScan}
              scanning={coverScanning}
              manualAck={coverScanManualAck}
              onManualAckChange={setCoverScanManualAck}
              overriddenCheckIds={overriddenCheckIds}
              onOverrideCheck={handleOverrideCheck}
            />
          </div>
          <div>
            <ClaimDocumentField
              label={`Travel Report (PDF, ${coverReport ? "required" : "optional for in-town travel"})`}
              testid="travel-claim-doc-travelReport"
              pdfOnly
              files={documents.travelReport}
              onChange={(files) => updateDocuments("travelReport", files)}
              onFileAccepted={(file) => void handleReportFileAccepted(file)}
              error={showErrors ? errors["documents.travelReport"] : undefined}
              disabled={busy}
              onUploadingChange={(u) => setFieldUploading("travelReport", u)}
            />
            <DocScanPanel
              idPrefix="travel-claim-report-scan"
              docLabel="report"
              scan={reportScan}
              scanning={reportScanning}
              manualAck={reportScanManualAck}
              onManualAckChange={setReportScanManualAck}
              overriddenCheckIds={reportOverriddenCheckIds}
              onOverrideCheck={handleReportOverrideCheck}
            />
          </div>
          <ClaimDocumentField
            label="Voucher (required, multiple files allowed)"
            testid="travel-claim-doc-voucher"
            multiple
            files={documents.voucher}
            onChange={(files) => updateDocuments("voucher", files)}
            error={showErrors ? errors["documents.voucher"] : undefined}
            disabled={busy || docsGateActive}
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
                  disabled={busy || docsGateActive}
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
                    disabled={busy || docsGateActive}
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
            disabled={busy || !isValid || uploadingFields.size > 0 || coverScanning || reportScanning || docsGateActive}
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
        {isValid && uploadingFields.size === 0 && (coverScanning || reportScanning) && (
          <p className="mt-1 text-xs text-gray-400">Checking the Travel Cover/Report…</p>
        )}
        {isValid && uploadingFields.size === 0 && !coverScanning && !reportScanning && docsGateActive && (
          <p className="mt-1 text-xs text-red-600">The Travel Cover/Report has a blocking issue above that must be resolved (or overridden) before submitting.</p>
        )}
      </div>
    </div>
  );
}
