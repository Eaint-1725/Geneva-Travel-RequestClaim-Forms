"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import Field from "@/components/travel/Field";
import SignaturePad from "@/components/travel/SignaturePad";
import { calcClaimGrandTotal } from "@/lib/travel/claim/calc";
import { resolveRowRate } from "@/lib/travel/claim/rate";
import { makeEmptyClaimHeader, type TravelClaimForm, type TravelClaimHeader } from "@/lib/travel/claim/types";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import { TEAMS } from "@/lib/travel/rates";
import { formatMmk, formatUsd } from "@/lib/travel/format";
import { makeEmptyTrip, type Row, type Signature, type Trip } from "@/lib/travel/types";
import { formatRateCaption, latestRate, type UnRate, type UnRatesPayload } from "@/lib/travel/un-rates";
import ClaimTripBlock from "./ClaimTripBlock";

const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

export default function TravelClaimPage() {
  const [header, setHeader] = useState<TravelClaimHeader>(makeEmptyClaimHeader());
  const [trips, setTrips] = useState<Trip[]>([makeEmptyTrip()]);
  const [signature, setSignature] = useState<Signature | null>(null);

  // Same interacted/showErrors pattern as Travel Request -- a brand-new blank form shouldn't
  // greet the user with every field already red.
  const [interacted, setInteracted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [unRates, setUnRates] = useState<UnRate[]>([]);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateRefreshing, setRateRefreshing] = useState(false);

  const form: TravelClaimForm = { header, trips, signature };
  const { errors, isValid } = useMemo(() => validateClaimForm(form, unRates), [header, trips, signature, unRates]);
  const showErrors = interacted;

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

  function updateHeader<K extends keyof TravelClaimHeader>(field: K, value: TravelClaimHeader[K]) {
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

  function handleClear() {
    if (!window.confirm("Clear the entire form? This can't be undone.")) return;
    setHeader(makeEmptyClaimHeader());
    setTrips([makeEmptyTrip()]);
    setSignature(null);
    setInteracted(false);
    setApiError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    setApiError(null);
    setNotice(null);
    if (!isValid) return;

    setBusy(true);
    try {
      const res = await fetch("/api/travel/claim-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not generate the file");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (header.name || "travel-claim").replace(/[^a-z0-9]+/gi, "-");
      a.download = `Travel Claim - ${safeName} - ${header.month || "draft"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice("Travel claim generated — your download should start automatically.");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Something went wrong generating the file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="travel-claim-page">
      <h1 className="mb-1 text-xl font-semibold text-navy-900">Travel Claim</h1>
      <p className="mb-4 text-sm text-gray-500">
        Fill in every required field and add each trip — each row's exchange rate is derived automatically from its own date. The
        Submit button unlocks once everything checks out, then we generate the Excel travel claim for you.
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
          <Field label="Position" error={showErrors ? errors["header.position"] : undefined} width="w-32">
            <input type="text" className={`${inputCls} w-full`} value={header.position} onChange={(e) => updateHeader("position", e.target.value)} data-testid="travel-claim-position" />
          </Field>
          <Field label="Duty Station" error={showErrors ? errors["header.dutyStation"] : undefined} width="w-36">
            <input type="text" className={`${inputCls} w-full`} value={header.dutyStation} onChange={(e) => updateHeader("dutyStation", e.target.value)} data-testid="travel-claim-duty-station" />
          </Field>
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

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="travel-claim-signature-card">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Employee signature</h2>
        <p className="mb-2 text-sm text-gray-500">Draw your signature or upload an image. Required.</p>
        <SignaturePad value={signature} onChange={updateSignature} />
        {showErrors && errors["signature"] && <p className="mt-1 text-xs text-red-600" data-testid="travel-claim-signature-error">{errors["signature"]}</p>}
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" onClick={() => void handleSubmit()} disabled={busy || !isValid} data-testid="travel-claim-submit-btn">
            {busy ? "Generating…" : "Submit travel claim"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={busy} data-testid="travel-claim-clear-btn">
            Clear
          </Button>
        </div>
        {!isValid && <p className="mt-1 text-xs text-gray-400">Fill in every required field above to enable submit.</p>}
      </div>
    </div>
  );
}
