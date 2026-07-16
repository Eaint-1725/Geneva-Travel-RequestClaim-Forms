"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import { calcGrandTotal } from "@/lib/travel/calc";
import { formatMmk, formatUsd } from "@/lib/travel/format";
import { TEAMS } from "@/lib/travel/rates";
import { makeEmptyTrip, type Signature, type Trip, type TravelRequestForm } from "@/lib/travel/types";
import { formatRateCaption, latestRate, type UnRate, type UnRatesPayload } from "@/lib/travel/un-rates";
import { validateForm } from "@/lib/travel/validation";
import Field from "@/components/travel/Field";
import SignaturePad from "@/components/travel/SignaturePad";
import TripBlock from "./TripBlock";

const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

function makeEmptyHeader(): TravelRequestForm["header"] {
  return {
    month: "",
    submissionDate: "",
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

  // Submit is gated purely on live validity (spec §4). "interacted" just controls when
  // per-field errors start showing -- otherwise a brand-new blank form would greet the
  // user with every field already red, which reads as hostile rather than friendly.
  const [interacted, setInteracted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [unRates, setUnRates] = useState<UnRate[]>([]);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateRefreshing, setRateRefreshing] = useState(false);

  const form: TravelRequestForm = { header, trips, signature };
  const { errors, isValid } = useMemo(() => validateForm(form), [header, trips, signature]);
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

  function handleClear() {
    if (!window.confirm("Clear the entire form? This can't be undone.")) return;
    const rate = latestRate(unRates);
    setHeader({ ...makeEmptyHeader(), exchangeRate: rate?.rate ?? null });
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
      const res = await fetch("/api/travel/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't email HR — please try again");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const nameMatch = /filename="([^"]+)"/.exec(disposition);
      const safeName = (header.name || "travel-request").replace(/[^a-z0-9]+/gi, "-");
      const fileName = nameMatch?.[1] ?? `Travel Request - ${safeName} - ${header.month || "draft"}.xlsx`;

      router.push("/portal/travel-request/success");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Couldn't email HR — please try again");
    } finally {
      setBusy(false);
    }
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
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Request details</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Month" error={showErrors ? errors["header.month"] : undefined} width="w-36">
            <input type="month" className={`${inputCls} w-full`} value={header.month} onChange={(e) => updateHeader("month", e.target.value)} data-testid="travel-month" />
          </Field>
          <Field label="Submission Date" error={showErrors ? errors["header.submissionDate"] : undefined} width="w-40">
            <input type="date" className={`${inputCls} w-full`} value={header.submissionDate} onChange={(e) => updateHeader("submissionDate", e.target.value)} data-testid="travel-submission-date" />
          </Field>
          <Field label="Team" error={showErrors ? errors["header.team"] : undefined} width="w-32">
            <select className={`${inputCls} w-full`} value={header.team} onChange={(e) => updateHeader("team", e.target.value)} data-testid="travel-team">
              <option value="">— select —</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Name of traveller" error={showErrors ? errors["header.name"] : undefined} width="w-48">
            <input type="text" className={`${inputCls} w-full`} value={header.name} onChange={(e) => updateHeader("name", e.target.value)} data-testid="travel-name" />
          </Field>
          <Field label="Position" error={showErrors ? errors["header.position"] : undefined} width="w-32">
            <input type="text" className={`${inputCls} w-full`} value={header.position} onChange={(e) => updateHeader("position", e.target.value)} data-testid="travel-position" />
          </Field>
          <Field label="Duty Station" error={showErrors ? errors["header.dutyStation"] : undefined} width="w-36">
            <input type="text" className={`${inputCls} w-full`} value={header.dutyStation} onChange={(e) => updateHeader("dutyStation", e.target.value)} data-testid="travel-duty-station" />
          </Field>
          <div className="flex w-44 flex-col">
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

        {header.team === "MAL" && (
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
          className="rounded border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-light/30"
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
          <Field label="Your email" error={showErrors ? errors["header.email"] : undefined} width="w-64">
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
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" onClick={() => void handleSubmit()} disabled={busy || !isValid} data-testid="travel-submit-btn">
            {busy ? "Sending…" : "Submit travel request"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={busy} data-testid="travel-clear-btn">
            Clear
          </Button>
        </div>
        {!isValid && <p className="mt-1 text-xs text-gray-400">Fill in every required field above to enable submit.</p>}
      </div>
    </div>
  );
}
