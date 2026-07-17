import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { calcRow, composeTravellerCapacity } from "@/lib/travel/calc";
import { calcClaimTrip } from "@/lib/travel/claim/calc";
import { resolveRowRate } from "@/lib/travel/claim/rate";
import type { TravelClaimForm } from "@/lib/travel/claim/types";
import { validateClaimForm } from "@/lib/travel/claim/validation";
import { getApproverBlock } from "@/lib/travel/approvers";
import { getUnRates } from "@/lib/travel/un-rates-cache";
import type { Row } from "@/lib/travel/types";

// Same line-by-line workbook layout as app/api/travel/export (request), duplicated rather
// than shared: the two exports are already expected to diverge further (actual-vs-estimate,
// receipts, etc. -- see the Travel Claim page's out-of-scope notes), and the only genuinely
// shared pieces -- calcRow, composeTravellerCapacity, getApproverBlock -- are imported from
// lib/travel/, not reimplemented here.

export const runtime = "nodejs";

const COLS = 19; // A..S
const MANUAL_FILL = "FFF2DCDB"; // Accent2 Lighter 80% -- manual entry
const DROPDOWN_FILL = "FFEBF1DE"; // Accent3 Lighter 80% -- dropdown list
const AUTO_FILL = "FFDCE6F1"; // Accent1 Lighter 80% -- automatic calculation
const YELLOW_FILL = "FFFFFF00"; // trip subtotal row
const ORANGE_FILL = "FFFFC000"; // grand total row

const MANUAL_COLS = new Set([2, 3, 9, 12, 13, 14, 17, 18, 19]);
const DROPDOWN_COLS = new Set([1, 4, 5, 6, 7, 8, 10]);
// Exchange rate (15) is auto-derived per row here, unlike the request's single manually-set
// header value -- so it's tinted as an automatic-calculation column, alongside Total Per-diem
// (11) and Total Amount (16).
const AUTO_COLS = new Set([11, 15, 16]);

const AMOUNT_FMT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const DATE_FMT = "dd-mmm-yy";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const ALIGN_CENTER_MIDDLE: Partial<ExcelJS.Alignment> = { vertical: "middle", horizontal: "center" };
const ALIGN_LEFT_MIDDLE: Partial<ExcelJS.Alignment> = { vertical: "middle", horizontal: "left" };
const ALIGN_RIGHT_MIDDLE: Partial<ExcelJS.Alignment> = { vertical: "middle", horizontal: "right" };

const PER_DIEM_DISPLAY_FMT = "0"; // display whole numbers only; underlying stored value keeps full precision

function fillCell(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

// Parsed as UTC (note the "Z"), not local time: ExcelJS derives the Excel serial date from
// the Date's absolute epoch ms (utils.dateToExcel -> d.getTime()), so a local-time parse would
// drift by the server's UTC offset -- e.g. UTC+6:30 turns "2026-07-01" into 2026-06-30T17:30Z,
// which rounds down to the previous day (and, for the 1st of a month, the previous month).
function parseDate(value: string): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: TravelClaimForm;
  try {
    form = (await req.json()) as TravelClaimForm;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Re-derive the UN rate history server-side (never trust a client-supplied rate) -- the
  // same source used to render the rows and to validate them.
  const { rates: unRates } = await getUnRates();

  const { isValid, errors } = validateClaimForm(form, unRates);
  if (!isValid) {
    return NextResponse.json({ error: "The claim is missing required fields", errors }, { status: 400 });
  }

  function rateForRow(row: Row): number {
    return resolveRowRate(row.date, unRates)?.rate ?? 0;
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Travel");

  ws.columns = [
    { width: 8 }, { width: 26 }, { width: 11 }, { width: 20 }, { width: 12 },
    { width: 20 }, { width: 12 }, { width: 14 }, { width: 8 }, { width: 24 },
    { width: 12 }, { width: 15 }, { width: 12 }, { width: 12 }, { width: 10 },
    { width: 15 }, { width: 24 }, { width: 12 }, { width: 12 },
  ];

  // Title
  ws.mergeCells(1, 1, 1, COLS);
  const title = ws.getCell(1, 1);
  title.value = "TRAVEL CLAIM (MYANMAR PAYROLL AND OUTSOURCING CO. LTD)";
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: "center", vertical: "middle" };

  // Header line: Month (left), Submission date (right)
  ws.getCell(2, 6).value = "Month:";
  const monthCell = ws.getCell(2, 7);
  monthCell.value = form.header.month ? parseDate(`${form.header.month}-01`) : null;
  monthCell.numFmt = "mmm-yy";
  ws.getCell(2, 17).value = "Submission date:";
  ws.mergeCells(2, 18, 2, 19); // R:S -- the full "dddd, mmmm dd, yyyy" value overflows a single column
  const subDateCell = ws.getCell(2, 18);
  subDateCell.value = parseDate(form.header.submissionDate);
  subDateCell.numFmt = "dddd, mmmm dd, yyyy";

  // Column headers
  const headers = [
    "Team", "Name of the traveller/Capacity", "Date", "From (Area)", "Township", "To (Area)", "Township",
    "Mode of Travel", "No of days", "Deductions", "Total Per-diem", "Travel cost+Actual Hotel Bill",
    "Air Ticket Cost", "Terminal Allowance", "Exchange rate", "Total Amount (MMK)", "Purpose of travel",
    "IPO Number", "Remark",
  ];
  headers.forEach((h, i) => {
    const c = ws.getCell(3, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.border = THIN_BORDER;
    c.alignment = { ...ALIGN_CENTER_MIDDLE, wrapText: true };
  });

  function tintRow(r: number): void {
    for (let c = 1; c <= COLS; c++) {
      const cell = ws.getCell(r, c);
      if (MANUAL_COLS.has(c)) fillCell(cell, MANUAL_FILL);
      else if (DROPDOWN_COLS.has(c)) fillCell(cell, DROPDOWN_FILL);
      else if (AUTO_COLS.has(c)) fillCell(cell, AUTO_FILL);
      cell.border = THIN_BORDER;
    }
  }

  const travellerCapacity = composeTravellerCapacity(form.header.name, form.header.position, form.header.dutyStation);

  function writeRow(r: number, row: Row, showName: boolean, rowRate: number, perDiemUsd: number, amountMmk: number): void {
    const teamCell = ws.getCell(r, 1);
    teamCell.value = form.header.team;
    teamCell.alignment = ALIGN_CENTER_MIDDLE;
    const nameCell = ws.getCell(r, 2);
    nameCell.value = showName ? travellerCapacity : null;
    nameCell.alignment = { ...ALIGN_CENTER_MIDDLE, wrapText: true };
    const dateCell = ws.getCell(r, 3);
    dateCell.value = parseDate(row.date);
    dateCell.numFmt = DATE_FMT;
    dateCell.alignment = ALIGN_CENTER_MIDDLE;
    const fromAreaCell = ws.getCell(r, 4);
    fromAreaCell.value = row.fromArea;
    fromAreaCell.alignment = ALIGN_LEFT_MIDDLE;
    const fromTownshipCell = ws.getCell(r, 5);
    fromTownshipCell.value = row.fromTownship || null;
    fromTownshipCell.alignment = ALIGN_LEFT_MIDDLE;
    const toAreaCell = ws.getCell(r, 6);
    toAreaCell.value = row.toArea;
    toAreaCell.alignment = ALIGN_LEFT_MIDDLE;
    const toTownshipCell = ws.getCell(r, 7);
    toTownshipCell.value = row.toTownship || null;
    toTownshipCell.alignment = ALIGN_LEFT_MIDDLE;
    const modeCell = ws.getCell(r, 8);
    modeCell.value = row.mode;
    modeCell.alignment = ALIGN_LEFT_MIDDLE;
    const daysCell = ws.getCell(r, 9);
    daysCell.value = row.noOfDays ?? 0;
    daysCell.alignment = ALIGN_CENTER_MIDDLE;
    const deductionCell = ws.getCell(r, 10);
    deductionCell.value = row.deduction;
    deductionCell.alignment = { ...ALIGN_LEFT_MIDDLE, wrapText: true };
    const perDiemCell = ws.getCell(r, 11);
    perDiemCell.value = Math.round(perDiemUsd * 100) / 100;
    perDiemCell.numFmt = PER_DIEM_DISPLAY_FMT;
    perDiemCell.alignment = ALIGN_RIGHT_MIDDLE;
    const travelCell = ws.getCell(r, 12);
    travelCell.value = row.travelHotelMmk ?? 0;
    travelCell.numFmt = AMOUNT_FMT;
    travelCell.alignment = ALIGN_RIGHT_MIDDLE;
    const airCell = ws.getCell(r, 13);
    airCell.value = row.airTicketMmk ?? 0;
    airCell.numFmt = AMOUNT_FMT;
    airCell.alignment = ALIGN_RIGHT_MIDDLE;
    const terminalCell = ws.getCell(r, 14);
    terminalCell.value = row.terminalAllowanceUsd ?? 0;
    terminalCell.numFmt = AMOUNT_FMT;
    terminalCell.alignment = ALIGN_RIGHT_MIDDLE;
    const rateCell = ws.getCell(r, 15);
    rateCell.value = rowRate;
    rateCell.numFmt = "#,##0";
    rateCell.alignment = ALIGN_RIGHT_MIDDLE;
    const amountCell = ws.getCell(r, 16);
    amountCell.value = Math.round(amountMmk);
    amountCell.numFmt = AMOUNT_FMT;
    amountCell.alignment = ALIGN_RIGHT_MIDDLE;
    const purposeCell = ws.getCell(r, 17);
    purposeCell.value = row.purpose;
    purposeCell.alignment = { ...ALIGN_LEFT_MIDDLE, wrapText: true };
    ws.getCell(r, 18).value = row.ipoNumber || null;
    ws.getCell(r, 19).value = row.remark || null;
    tintRow(r);
  }

  let row = 4;
  let grandDays = 0;
  let grandPerDiem = 0;
  let grandTravel = 0;
  let grandAir = 0;
  let grandTerminal = 0;
  let grandAmount = 0;

  for (const trip of form.trips) {
    const rowCalcs = trip.rows.map((r) => calcRow(r, rateForRow(r)));
    const tripCalc = calcClaimTrip(trip, rateForRow);
    const tripFirstRow = row;

    trip.rows.forEach((r, i) => {
      writeRow(row, r, i === 0, rateForRow(r), rowCalcs[i].perDiemUsd, rowCalcs[i].amountMmk);
      row += 1;
    });

    const tripLastRow = row - 1;
    if (tripLastRow > tripFirstRow) {
      ws.mergeCells(tripFirstRow, 2, tripLastRow, 2);
    }

    const subDays = trip.rows.reduce((sum, r) => sum + (r.noOfDays ?? 0), 0);
    const subPerDiem = tripCalc.subtotalPerDiemUsd;
    const subTravel = trip.rows.reduce((sum, r) => sum + (r.travelHotelMmk ?? 0), 0);
    const subAir = trip.rows.reduce((sum, r) => sum + (r.airTicketMmk ?? 0), 0);
    const subTerminal = trip.rows.reduce((sum, r) => sum + (r.terminalAllowanceUsd ?? 0), 0);
    const subAmount = tripCalc.subtotalAmountMmk;

    ws.mergeCells(row, 4, row, 8);
    const subNameCell = ws.getCell(row, 4);
    subNameCell.value = travellerCapacity;
    subNameCell.alignment = { ...ALIGN_LEFT_MIDDLE, wrapText: true };
    const subDaysCell = ws.getCell(row, 9);
    subDaysCell.value = subDays;
    subDaysCell.alignment = ALIGN_CENTER_MIDDLE;
    const subPerDiemCell = ws.getCell(row, 11);
    subPerDiemCell.value = Math.round(subPerDiem * 100) / 100;
    subPerDiemCell.numFmt = PER_DIEM_DISPLAY_FMT;
    subPerDiemCell.alignment = ALIGN_RIGHT_MIDDLE;
    const subTravelCell = ws.getCell(row, 12);
    subTravelCell.value = subTravel;
    subTravelCell.numFmt = AMOUNT_FMT;
    subTravelCell.alignment = ALIGN_RIGHT_MIDDLE;
    const subAirCell = ws.getCell(row, 13);
    subAirCell.value = subAir;
    subAirCell.numFmt = AMOUNT_FMT;
    subAirCell.alignment = ALIGN_RIGHT_MIDDLE;
    const subTerminalCell = ws.getCell(row, 14);
    subTerminalCell.value = subTerminal;
    subTerminalCell.numFmt = AMOUNT_FMT;
    subTerminalCell.alignment = ALIGN_RIGHT_MIDDLE;
    const subAmountCell = ws.getCell(row, 16);
    subAmountCell.value = Math.round(subAmount);
    subAmountCell.numFmt = AMOUNT_FMT;
    subAmountCell.alignment = ALIGN_RIGHT_MIDDLE;
    for (let c = 1; c <= COLS; c++) {
      fillCell(ws.getCell(row, c), YELLOW_FILL);
      ws.getCell(row, c).border = THIN_BORDER;
    }
    row += 1;

    grandDays += subDays;
    grandPerDiem += subPerDiem;
    grandTravel += subTravel;
    grandAir += subAir;
    grandTerminal += subTerminal;
    grandAmount += subAmount;
  }

  const grandRow = row;
  ws.mergeCells(grandRow, 1, grandRow, 8);
  ws.getCell(grandRow, 1).value = "Grand Total";
  const grandDaysCell = ws.getCell(grandRow, 9);
  grandDaysCell.value = grandDays;
  grandDaysCell.alignment = ALIGN_CENTER_MIDDLE;
  const grandPerDiemCell = ws.getCell(grandRow, 11);
  grandPerDiemCell.value = Math.round(grandPerDiem * 100) / 100;
  grandPerDiemCell.numFmt = PER_DIEM_DISPLAY_FMT;
  grandPerDiemCell.alignment = ALIGN_RIGHT_MIDDLE;
  ws.getCell(grandRow, 12).value = grandTravel;
  ws.getCell(grandRow, 13).value = grandAir;
  ws.getCell(grandRow, 14).value = grandTerminal;
  const grandAmountCell = ws.getCell(grandRow, 16);
  grandAmountCell.value = Math.round(grandAmount);
  grandAmountCell.numFmt = AMOUNT_FMT;
  grandAmountCell.alignment = ALIGN_RIGHT_MIDDLE;
  const grandPurposeCell = ws.getCell(grandRow, 17);
  grandPurposeCell.value = "-";
  grandPurposeCell.alignment = ALIGN_LEFT_MIDDLE;
  [12, 13, 14].forEach((c) => {
    const cell = ws.getCell(grandRow, c);
    cell.numFmt = AMOUNT_FMT;
    cell.alignment = ALIGN_RIGHT_MIDDLE;
  });
  for (let c = 1; c <= COLS; c++) {
    const cell = ws.getCell(grandRow, c);
    fillCell(cell, ORANGE_FILL);
    cell.font = { bold: true };
    cell.border = THIN_BORDER;
  }

  // Notes block (MAL team only) -- one merged, wrapped row per line, centered under
  // columns F:K, so long lines never spill into other cells.
  const NOTES_START_COL = 6;
  const NOTES_END_COL = 11;
  const NOTES_MERGED_WIDTH_CHARS = 90; // approx chars that fit across the merged F:K span
  const DEFAULT_ROW_HEIGHT = 15;
  if (form.header.team === "MAL" && form.header.notes.trim() !== "") {
    row = grandRow + 1; // immediately below the Grand Total row, no gap
    for (const line of form.header.notes.split(/\r?\n/)) {
      ws.mergeCells(row, NOTES_START_COL, row, NOTES_END_COL);
      const cell = ws.getCell(row, NOTES_START_COL);
      cell.value = line;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      const wrappedLines = Math.max(1, Math.ceil(line.length / NOTES_MERGED_WIDTH_CHARS));
      ws.getRow(row).height = DEFAULT_ROW_HEIGHT * wrappedLines;
      row += 1;
    }
    row += 1; // blank spacer row before the signature block
  } else {
    row = grandRow + 2; // unchanged spacing when there's no notes block
  }

  // Signature block
  const imageAnchorRow = row;
  row += 3; // reserve vertical space for the embedded signature image

  if (form.signature) {
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(form.signature.dataUrl);
    if (match) {
      const rawExt = match[1] === "jpg" ? "jpeg" : match[1];
      if (rawExt === "png" || rawExt === "jpeg") {
        const imageId = wb.addImage({ base64: match[2], extension: rawExt });
        ws.addImage(imageId, {
          tl: { col: 0, row: imageAnchorRow - 1 },
          ext: { width: 160, height: 60 },
        });
      }
    }
  }

  const approverLines = getApproverBlock(form.header.team);

  const sigTop = row;
  ws.getCell(sigTop, 1).value = "……………………………….";
  ws.getCell(sigTop, 5).value = "……………………………….";
  ws.getCell(sigTop, 11).value = "……………………………….";
  row += 1;
  ws.getCell(row, 1).value = form.header.name;
  ws.getCell(row, 5).value = "HR Company (P&O)";
  approverLines.forEach((line, i) => {
    ws.getCell(row + i, 11).value = line;
  });
  row += 1;
  ws.getCell(row, 1).value = `${form.header.position} (${form.header.dutyStation})`;
  row += 1;
  ws.getCell(row, 1).value = form.header.team;
  row += 1;
  const signedDateCell = ws.getCell(row, 1);
  signedDateCell.value = parseDate(form.header.submissionDate);
  signedDateCell.numFmt = "d-mmm-yy";
  signedDateCell.alignment = { horizontal: "left" };

  const buffer = await wb.xlsx.writeBuffer();

  const safeName = (form.header.name || "travel-claim").replace(/[^a-z0-9]+/gi, "-");
  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Travel Claim - ${safeName} - ${form.header.month || "draft"}.xlsx"`,
    },
  });
}
