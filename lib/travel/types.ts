export interface TravelRequestHeader {
  month: string; // YYYY-MM
  submissionDate: string; // YYYY-MM-DD
  team: string;
  name: string;
  position: string;
  dutyStation: string;
  exchangeRate: number | null;
  /** Free-text notes, only shown in the UI and exported to Excel when team === "MAL". */
  notes: string;
}

export interface Row {
  id: string;
  date: string;
  fromArea: string;
  fromTownship: string;
  toArea: string;
  toTownship: string;
  mode: string;
  noOfDays: number | null;
  deduction: string;
  travelHotelMmk: number | null;
  airTicketMmk: number | null;
  terminalAllowanceUsd: number | null;
  purpose: string;
  ipoNumber: string;
  remark: string;
}

export interface Trip {
  id: string;
  rows: Row[];
}

export interface Signature {
  kind: "drawn" | "uploaded";
  dataUrl: string;
  fileName?: string;
}

export interface TravelRequestForm {
  header: TravelRequestHeader;
  trips: Trip[];
  signature: Signature | null;
}

export function makeEmptyRow(): Row {
  return {
    id: `row-${Math.random().toString(36).slice(2, 10)}`,
    date: "",
    fromArea: "",
    fromTownship: "",
    toArea: "",
    toTownship: "",
    mode: "",
    noOfDays: null,
    deduction: "",
    travelHotelMmk: null,
    airTicketMmk: null,
    terminalAllowanceUsd: null,
    purpose: "",
    ipoNumber: "",
    remark: "",
  };
}

export function makeEmptyTrip(): Trip {
  return {
    id: `trip-${Math.random().toString(36).slice(2, 10)}`,
    rows: [makeEmptyRow()],
  };
}
