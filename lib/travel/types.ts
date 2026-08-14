export interface TravelRequestHeader {
  month: string; // YYYY-MM
  submissionDate: string; // YYYY-MM-DD
  team: string;
  name: string;
  position: string;
  dutyStation: string;
  exchangeRate: number | null;
  /** Free-text notes, only shown in the UI and exported to Excel when team is "MAL" or "HIV". */
  notes: string;
  /** Traveller's own email (personal Gmail expected) — used as Reply-To on the HR notification. */
  email: string;
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

/** One file already uploaded to Vercel Blob -- the form only ever holds the resulting metadata/URL,
 * never raw bytes. Shared shape for any Travel-Request upload field (currently just Approval
 * Attachments; see lib/travel/request-uploads.ts for the upload/delete pipeline). */
export interface UploadedFile {
  url: string;
  pathname: string;
  name: string;
  size: number;
  contentType: string;
}

export interface TravelRequestForm {
  header: TravelRequestHeader;
  trips: Trip[];
  signature: Signature | null;
  /** Approval Attachments -- required, at least one file, any type. Attached to the HR email
   * alongside the Excel on submit; see app/api/travel/submit/route.ts. */
  attachments: UploadedFile[];
}

/** Embedded into every generated Travel Request .xlsx (see lib/travel/excel-embed.ts) and read
 * back by the "Import Excel" flow (see app/api/travel/import/route.ts) to auto-fill a
 * re-submission. Deliberately excludes Signature/email/attachments/submissionDate/exchangeRate --
 * those are never re-imported (redone by the user, or server-derived at submit time). */
export interface TravelRequestImportPayload {
  header: Pick<TravelRequestHeader, "month" | "team" | "name" | "position" | "dutyStation" | "notes">;
  trips: Trip[];
}

/** Whether this submission is brand new or replaces one HR already received -- drives the
 * "[UPDATED]" subject prefix and the note block in the email body (see lib/email builders). */
export type SubmissionType = "new" | "updated";

export const SUBMISSION_NOTE_MAX_LENGTH = 500;

/** 1st through 10th -- user-declared count of how many times this month's request has been sent. */
export const SUBMISSION_NUMBER_MIN = 1;
export const SUBMISSION_NUMBER_MAX = 10;

export interface SubmissionMeta {
  type: SubmissionType;
  /** User-declared submission count (1-10), required before Send enables. Null until chosen. */
  number: number | null;
  note: string;
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
