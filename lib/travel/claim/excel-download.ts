// Client-side helper for downloading the Travel Claim Excel the submit route already built and
// attached to the HR email (see route.ts's excelBase64/excelFileName on the success response) --
// shared by the submit page (auto-download right after a successful send) and the success page
// (a manual fallback link if the automatic download was blocked). Kept as plain functions, not a
// component, so both call sites can invoke them directly without prop-drilling between routes.

export const CLAIM_EXCEL_STORAGE_KEY = "travel-claim-success-excel";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface StoredClaimExcel {
  fileName: string;
  base64: string;
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: XLSX_CONTENT_TYPE });
}

/** Triggers a browser download of the given xlsx via a temporary object-URL link -- the same
 * pattern Travel Request uses for its own post-submit download. */
export function downloadClaimExcel(excel: StoredClaimExcel): void {
  const url = URL.createObjectURL(base64ToBlob(excel.base64));
  const a = document.createElement("a");
  a.href = url;
  a.download = excel.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
