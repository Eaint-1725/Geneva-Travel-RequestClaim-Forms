// Client-side fallback download for the generated Travel Request Excel -- the submit route
// returns the same buffer it emailed to HR as base64, so this decodes and saves that exact
// file rather than regenerating anything. Mirrors lib/travel/claim/excel-download.ts.

export const REQUEST_EXCEL_STORAGE_KEY = "travel-request-excel";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface StoredRequestExcel {
  fileName: string;
  base64: string;
}

export function downloadRequestExcel(excel: StoredRequestExcel): void {
  const binary = atob(excel.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: XLSX_CONTENT_TYPE });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = excel.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
