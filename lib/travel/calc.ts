import { dailyRate, findDeduction } from "./rates";
import type { Row, Trip } from "./types";

export interface RowCalc {
  perDiemUsd: number;
  amountMmk: number;
}

/**
 * Per-row Total Per-diem (USD), branching on the Deduction choice (spec §2):
 * - Full deduction (100%) -> 0
 * - day >10 hrs travel (Non-HC) / overnight - outbound (50% destination) -> To-area daily rate, single day
 * - overnight - inbound (50% origin) -> From-area daily rate, single day
 * - everything else -> To-area daily rate x No of days x deduction factor
 */
export function calcRow(row: Row, exchangeRate: number): RowCalc {
  const days = row.noOfDays ?? 0;
  const deduction = findDeduction(row.deduction);
  const factor = deduction?.factor ?? 0;

  let perDiemUsd: number;
  if (row.deduction === "Full deduction (100%)") {
    perDiemUsd = 0;
  } else if (row.deduction === "day >10 hrs travel (Non-HC)" || row.deduction === "overnight - outbound (50% destination)") {
    perDiemUsd = dailyRate(row.toArea);
  } else if (row.deduction === "overnight - inbound (50% origin)") {
    perDiemUsd = dailyRate(row.fromArea);
  } else {
    perDiemUsd = dailyRate(row.toArea) * days * factor;
  }

  const travelHotel = row.travelHotelMmk ?? 0;
  const airTicket = row.airTicketMmk ?? 0;
  const terminal = row.terminalAllowanceUsd ?? 0;

  // Total Amount (MMK) = (Per-diem x rate) + (Terminal allowance x rate) + Travel/Hotel + Air Ticket
  const amountMmk = perDiemUsd * exchangeRate + terminal * exchangeRate + travelHotel + airTicket;

  return { perDiemUsd, amountMmk };
}

export interface TripCalc {
  rows: RowCalc[];
  subtotalPerDiemUsd: number;
  subtotalAmountMmk: number;
}

export function calcTrip(trip: Trip, exchangeRate: number): TripCalc {
  const rows = trip.rows.map((row) => calcRow(row, exchangeRate));
  return {
    rows,
    subtotalPerDiemUsd: rows.reduce((sum, r) => sum + r.perDiemUsd, 0),
    subtotalAmountMmk: rows.reduce((sum, r) => sum + r.amountMmk, 0),
  };
}

export interface GrandTotal {
  totalPerDiemUsd: number;
  totalAmountMmk: number;
}

export function calcGrandTotal(trips: Trip[], exchangeRate: number): GrandTotal {
  return trips.reduce<GrandTotal>(
    (acc, trip) => {
      const t = calcTrip(trip, exchangeRate);
      return {
        totalPerDiemUsd: acc.totalPerDiemUsd + t.subtotalPerDiemUsd,
        totalAmountMmk: acc.totalAmountMmk + t.subtotalAmountMmk,
      };
    },
    { totalPerDiemUsd: 0, totalAmountMmk: 0 },
  );
}

/** The sheet's "Name of the traveller/Capacity" cell: "{Name}, {Position} ({Duty Station})". */
export function composeTravellerCapacity(name: string, position: string, dutyStation: string): string {
  return `${name}, ${position} (${dutyStation})`;
}
