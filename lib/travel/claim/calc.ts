import { calcRow, type RowCalc } from "../calc";
import type { Row, Trip } from "../types";

// Per-diem logic itself is unchanged from the request -- calcRow already takes its exchange
// rate per call, so Travel Claim only needs to supply a per-row rate instead of one shared
// across the whole trip/form. `rateForRow` is expected to resolve via
// resolveRowRate(row.date, unRates) and fall back to 0 for a row whose rate can't be
// resolved (submit is blocked in that case by validateClaimForm, so 0 never reaches export).

export interface ClaimTripCalc {
  rows: RowCalc[];
  subtotalPerDiemUsd: number;
  subtotalAmountMmk: number;
}

export function calcClaimTrip(trip: Trip, rateForRow: (row: Row) => number): ClaimTripCalc {
  const rows = trip.rows.map((row) => calcRow(row, rateForRow(row)));
  return {
    rows,
    subtotalPerDiemUsd: rows.reduce((sum, r) => sum + r.perDiemUsd, 0),
    subtotalAmountMmk: rows.reduce((sum, r) => sum + r.amountMmk, 0),
  };
}

export interface ClaimGrandTotal {
  totalPerDiemUsd: number;
  totalAmountMmk: number;
}

export function calcClaimGrandTotal(trips: Trip[], rateForRow: (row: Row) => number): ClaimGrandTotal {
  return trips.reduce<ClaimGrandTotal>(
    (acc, trip) => {
      const t = calcClaimTrip(trip, rateForRow);
      return {
        totalPerDiemUsd: acc.totalPerDiemUsd + t.subtotalPerDiemUsd,
        totalAmountMmk: acc.totalAmountMmk + t.subtotalAmountMmk,
      };
    },
    { totalPerDiemUsd: 0, totalAmountMmk: 0 },
  );
}
