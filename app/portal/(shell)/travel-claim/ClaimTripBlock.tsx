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
}: {
  trip: Trip;
  index: number;
  unRates: UnRate[];
  onChange: (trip: Trip) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: Record<string, string>;
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
          <button type="button" onClick={onRemove} className="text-xs text-gray-400 hover:text-red-600" data-testid="travel-claim-trip-remove">
            remove trip
          </button>
        )}
      </div>

      {trip.rows.map((row, i) => (
        <div key={row.id} className="mb-1 flex items-start gap-2">
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
            />
          </div>
          {trip.rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="text-xs text-gray-400 hover:text-red-600"
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
        className="rounded border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-light/30"
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
