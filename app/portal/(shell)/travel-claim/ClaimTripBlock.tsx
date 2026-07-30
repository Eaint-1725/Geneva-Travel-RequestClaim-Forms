"use client";

import { calcClaimTrip } from "@/lib/travel/claim/calc";
import { resolveRowRate } from "@/lib/travel/claim/rate";
import { formatMmk, formatUsd } from "@/lib/travel/format";
import { makeEmptyRow, type Row, type Trip } from "@/lib/travel/types";
import type { UnRate } from "@/lib/travel/un-rates";
import { rowErrors } from "@/lib/travel/validation";
import ClaimRowFields from "./ClaimRowFields";

export default function ClaimTripBlock({
  trip,
  index,
  unRates,
  onChange,
  onRemove,
  canRemove,
  errors,
  submissionDate,
}: {
  trip: Trip;
  index: number;
  unRates: UnRate[];
  onChange: (trip: Trip) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: Record<string, string>;
  /** Header's Submission Date -- forwarded to each row as the row Date's ceiling (see validateRow). */
  submissionDate: string;
}) {
  const rateForRow = (row: Row) => resolveRowRate(row.date, unRates)?.rate ?? 0;
  const calc = calcClaimTrip(trip, rateForRow);

  function updateRow(rowId: string, next: Row) {
    onChange({ ...trip, rows: trip.rows.map((r) => (r.id === rowId ? next : r)) });
  }

  function addRow() {
    onChange({ ...trip, rows: [...trip.rows, makeEmptyRow()] });
  }

  function removeRow(rowId: string) {
    onChange({ ...trip, rows: trip.rows.filter((r) => r.id !== rowId) });
  }

  return (
    <div className="mb-3 rounded border border-gray-200 p-3" data-testid="travel-claim-trip">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-900">Trip {index + 1}</h3>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:border-red-300 hover:text-red-600 lg:rounded-none lg:border-0 lg:p-0 lg:text-xs lg:text-gray-400"
            data-testid="travel-claim-trip-remove"
          >
            remove trip
          </button>
        )}
      </div>

      {trip.rows.map((row, i) => (
        <div key={row.id} className="mb-3 flex flex-col gap-2 lg:mb-1 lg:flex-row lg:items-start lg:gap-2">
          <div className="flex-1">
            <ClaimRowFields
              row={row}
              rowIndex={i}
              rowLabel={`Row ${i + 1}`}
              onChange={(next) => updateRow(row.id, next)}
              errors={rowErrors(errors, trip.id, row.id)}
              resolvedRate={resolveRowRate(row.date, unRates)}
              perDiemUsd={calc.rows[i].perDiemUsd}
              amountMmk={calc.rows[i].amountMmk}
              submissionDate={submissionDate}
            />
          </div>
          {trip.rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:border-red-300 hover:text-red-600 lg:rounded-none lg:border-0 lg:p-0 lg:text-xs lg:text-gray-400"
              data-testid={`travel-claim-row-${i}-remove`}
            >
              remove row
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="w-full rounded border border-primary px-3 py-2.5 text-base font-medium text-primary hover:bg-primary-light/30 lg:w-auto lg:py-1.5 lg:text-sm"
        data-testid="travel-claim-add-row"
      >
        Add row
      </button>

      <p className="mt-2 border-t border-gray-100 pt-2 text-sm text-gray-800" data-testid="travel-claim-trip-subtotal">
        Trip subtotal — Per-diem: <strong>{formatUsd(calc.subtotalPerDiemUsd)} USD</strong> · Amount:{" "}
        <strong>{formatMmk(calc.subtotalAmountMmk)} MMK</strong>
      </p>
    </div>
  );
}
