import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from "@azure-rest/ai-document-intelligence";
import type {
  AnalyzeOperationOutput,
  DocumentPageOutput,
  DocumentTableOutput,
} from "@azure-rest/ai-document-intelligence";
import { nearestLabel } from "./geometry";
import { fuzzyContains } from "./fuzzy-match";
import type { CoverCheck, CoverScanProvider, CoverScanResult } from "./types";

// Azure Document Intelligence (Layout model, prebuilt-layout) implementation of CoverScanProvider.
// KNOWN LIMITATION, stated up front: none of the extraction rules below have been validated
// against a real Azure resource or a real sample Travel Cover PDF -- they're built from the
// form's textual description and the SDK's documented response shape. Every tunable (allow-lists,
// target names, proximity/fuzzy thresholds) is a named constant below so this is a single place
// to adjust once tested against real samples. Only this file talks to Azure -- everything else in
// the app imports the provider through ./index.

// ---- Tunables, one edit point for post-validation tuning -------------------------------------

const WHO_BRANDING_PHRASES = ["world health organization"];
// Real WHO/Geneva HQ address fragments -- best-effort, unverified against a real letterhead.
const WHO_LETTERHEAD_PATTERNS = [/avenue appia/i, /1211\s*geneva/i, /geneva\s*27\b/i];
// Legitimate WHO-containing phrases on this form -- stripped out before scanning for branding so
// they can never contribute to a false match (see detectWhoBranding).
const WHO_ALLOWED_PHRASES = ["who team", "who can query"];

const SUPERVISOR_NAME = "Ei Thae Phyu";
const FINANCE_NAME = "Theint Theint Thu";
// ~20% of target length, minimum 2 edits (see fuzzy-match.ts) -- OCR on scanned handwriting.
const NAME_FUZZY_TOLERANCE_RATIO = 0.2;

const NAME_FORMAT_PATTERN = /[A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*)*,\s*[A-Za-z][A-Za-z .'-]*\([^()]+\)/;
const LOOSE_NAME_PATTERN = /[A-Za-z][A-Za-z .'-]{1,60},[^()\n]{1,60}\([^()]{1,40}\)/;

// Document Intelligence reports PDF polygon coordinates in inches (see DocumentPageOutput.unit).
// This is an approximate "something is near the label" proximity, not a layout guarantee.
const SIGNATURE_PROXIMITY_INCHES = 1.5;

function detectWhoBranding(content: string): string | null {
  const normalized = content.toLowerCase();
  let scanText = normalized;
  for (const allowed of WHO_ALLOWED_PHRASES) {
    scanText = scanText.split(allowed).join(" ");
  }
  for (const phrase of WHO_BRANDING_PHRASES) {
    if (scanText.includes(phrase)) return phrase;
  }
  for (const pattern of WHO_LETTERHEAD_PATTERNS) {
    const match = pattern.exec(scanText);
    if (match) return match[0];
  }
  return null;
}

function checkSectionIiiPresent(content: string): CoverCheck {
  const present = content.toLowerCase().includes("section iii");
  return {
    id: "section_iii_present",
    label: "Section III (Approvals) present",
    severity: "block",
    status: present ? "pass" : "fail",
    message: present
      ? "Section III (Approvals) found."
      : "Section III (Approvals) appears to be missing from this document.",
  };
}

function checkWhoTeam(content: string): CoverCheck {
  const present = content.toLowerCase().includes("who team");
  return {
    id: "who_team",
    label: "WHO TEAM present",
    severity: "warn",
    status: present ? "pass" : "fail",
    message: present ? '"WHO TEAM" found.' : 'Couldn\'t find "WHO TEAM" on the form — please check.',
  };
}

// Name presence and name format are checked as two distinct facts -- "missing entirely" reads
// very differently to a user than "present but not in the expected format".
function checkName(content: string): CoverCheck[] {
  const formatMatch = NAME_FORMAT_PATTERN.test(content);
  const looseMatch = formatMatch || LOOSE_NAME_PATTERN.test(content);

  const presence: CoverCheck = {
    id: "name_presence",
    label: "Traveller name",
    severity: "warn",
    status: looseMatch ? "pass" : "fail",
    message: looseMatch
      ? "Traveller name found."
      : "Couldn't find the traveller's name — please check it's on the form.",
  };
  const format: CoverCheck = {
    id: "name_format",
    label: "Name format (Name, Position (Duty Station))",
    severity: "warn",
    status: formatMatch ? "pass" : "fail",
    message: formatMatch
      ? 'Name matches the expected "Name, Position (Duty Station)" format.'
      : looseMatch
        ? 'Found a name-like entry but couldn\'t confirm it matches "Name, Position (Duty Station)" — please check the format.'
        : 'Couldn\'t confirm the name format — please check it reads "Name, Position (Duty Station)".',
  };
  return [presence, format];
}

// Handles BOTH a typed/handwritten Yes/No answer near the label AND a ticked checkbox
// (selectionMarks) near the label -- the form may use either variant.
function checkYesNoField(page: DocumentPageOutput | undefined, labelWord: string, id: string, label: string): CoverCheck {
  const lines = page?.lines ?? [];
  const marks = page?.selectionMarks ?? [];
  const labelLines = lines.filter((l) => l.content.toLowerCase().includes(labelWord));

  const typedAnswer = labelLines.find((l) => /\b(yes|no)\b/i.test(l.content));
  if (typedAnswer) {
    return {
      id,
      label,
      severity: "warn",
      status: "pass",
      message: `${label} answered ("${typedAnswer.content.trim()}").`,
    };
  }

  if (labelLines.length > 0 && marks.length > 0) {
    const nearest = nearestLabel(labelLines[0], marks);
    if (nearest) {
      const checked = nearest.candidate.state === "selected";
      return {
        id,
        label,
        severity: "warn",
        status: "pass",
        message: `${label} checkbox found (${checked ? "checked" : "unchecked"}).`,
      };
    }
  }

  return {
    id,
    label,
    severity: "warn",
    status: "fail",
    message: `Couldn't find a Yes/No answer for ${label} — please check it's filled in.`,
  };
}

function checkItinerary(tables: DocumentTableOutput[] | undefined): CoverCheck {
  const candidate = (tables ?? []).find((t) => t.columnCount >= 3 && t.rowCount >= 2);
  if (!candidate) {
    return {
      id: "itinerary_rows",
      label: "Itinerary",
      severity: "warn",
      status: "fail",
      message: "Couldn't find a populated itinerary table — please check at least one trip row is filled in.",
    };
  }

  const rows = new Map<number, string[]>();
  for (const cell of candidate.cells) {
    if (cell.rowIndex === 0) continue; // header row
    const row = rows.get(cell.rowIndex) ?? [];
    row.push(cell.content.trim());
    rows.set(cell.rowIndex, row);
  }
  const hasPopulatedRow = [...rows.values()].some((cells) => cells.filter(Boolean).length >= 2);

  return {
    id: "itinerary_rows",
    label: "Itinerary",
    severity: "warn",
    status: hasPopulatedRow ? "pass" : "fail",
    message: hasPopulatedRow
      ? "Itinerary has at least one populated row."
      : "Couldn't find a populated itinerary row (date, city, mode, purpose) — please check the table.",
  };
}

function checkDutyReport(content: string): CoverCheck {
  const idx = content.toLowerCase().indexOf("duty travel report");
  const window = idx === -1 ? "" : content.slice(idx, idx + 80);
  const answered = /\b(yes|no)\b/i.test(window);
  return {
    id: "duty_report",
    label: "Duty Travel report submitted",
    severity: "warn",
    status: idx !== -1 && answered ? "pass" : "fail",
    message: idx !== -1 && answered
      ? "Duty Travel report Yes/No answered."
      : 'Couldn\'t find a Yes/No answer for "Duty Travel report submitted" — please check it\'s filled in.',
  };
}

// Signature detection is a presence heuristic, not signature verification -- Document
// Intelligence Layout has no ink/image analysis, only OCR'd text, lines and selection marks. This
// cannot distinguish a real signature from a stray mark or stamp, and will miss a genuine
// signature that produces no OCRable content at all. Kept at severity:"warn" for exactly that
// reason. The date sub-check is a plain date-pattern presence search, not approximate in the same
// way.
function checkSignatureAndDate(page: DocumentPageOutput | undefined, content: string): CoverCheck[] {
  const lines = page?.lines ?? [];
  const signatureLabel = lines.find((l) => /ssa holder|signature/i.test(l.content));

  let signatureFound = false;
  if (signatureLabel) {
    const others = lines.filter((l) => l !== signatureLabel && l.content.trim().length > 0);
    const nearest = nearestLabel(signatureLabel, others);
    signatureFound = nearest !== null && nearest.distance < SIGNATURE_PROXIMITY_INCHES;
  }

  const dateFound = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(content);

  return [
    {
      id: "ssa_signature",
      label: "SSA holder signature",
      severity: "warn",
      status: signatureFound ? "pass" : "fail",
      message: signatureFound
        ? "Found content near the SSA holder signature box."
        : "Couldn't confirm the SSA holder signature box is filled in — please check.",
    },
    {
      id: "ssa_signature_date",
      label: "SSA holder signature date",
      severity: "warn",
      status: dateFound ? "pass" : "fail",
      message: dateFound
        ? "Found a date near the signature."
        : "Couldn't find a date for the SSA holder signature — please check.",
    },
  ];
}

function checkTotalAmount(content: string): CoverCheck {
  const found = /total[^a-z0-9]{0,25}mmk[^a-z0-9]{0,10}[\d,]{2,}/i.test(content)
    || /\bmmk\b[^a-z0-9]{0,10}[\d,]{3,}/i.test(content);
  return {
    id: "total_amount",
    label: "Total Travel Claim amount (MMK)",
    severity: "warn",
    status: found ? "pass" : "fail",
    message: found
      ? "Total Travel Claim amount found."
      : "Couldn't find the Total Travel Claim amount — please check it's on the form.",
  };
}

// Scoped to the text after the "Section III" heading only, so a name occurring elsewhere on the
// form (e.g. the traveller's own name) can't produce a false match here. Runs even when Section
// III is missing -- that's reported by checkSectionIiiPresent (a block check); these report "not
// found" as expected in that case, not a duplicate of the block failure.
function checkSectionIiiNames(content: string): CoverCheck[] {
  const idx = content.toLowerCase().indexOf("section iii");
  const region = idx === -1 ? "" : content.slice(idx);
  const supervisorFound = region !== "" && fuzzyContains(region, SUPERVISOR_NAME, NAME_FUZZY_TOLERANCE_RATIO);
  const financeFound = region !== "" && fuzzyContains(region, FINANCE_NAME, NAME_FUZZY_TOLERANCE_RATIO);

  return [
    {
      id: "section_iii_supervisor",
      label: `Supervisor/authorized officer (${SUPERVISOR_NAME})`,
      severity: "warn",
      status: supervisorFound ? "pass" : "fail",
      message: supervisorFound
        ? "Supervisor/authorized officer name matched."
        : `Couldn't confirm "${SUPERVISOR_NAME}" as the supervisor/authorized officer in Section III — please check.`,
    },
    {
      id: "section_iii_finance",
      label: `Finance staff (${FINANCE_NAME})`,
      severity: "warn",
      status: financeFound ? "pass" : "fail",
      message: financeFound
        ? "Finance staff name matched."
        : `Couldn't confirm "${FINANCE_NAME}" as the finance staff name in Section III — please check.`,
    },
  ];
}

export class AzureCoverScanProvider implements CoverScanProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async scanTravelCover(pdf: Buffer): Promise<CoverScanResult> {
    const client = DocumentIntelligence(this.endpoint, { key: this.apiKey });

    // This form is always a PDF (the route only accepts pdfOnly uploads for Travel Cover), so the
    // content type sent to Azure is fixed rather than derived from the caller-supplied
    // contentType (which the SDK's binary-upload endpoint only accepts a fixed union for anyway).
    const initialResponse = await client
      .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
      .post({ contentType: "application/pdf", body: pdf });

    if (isUnexpected(initialResponse)) {
      throw new Error(initialResponse.body.error.message);
    }

    const poller = getLongRunningPoller(client, initialResponse);
    const pollResult = await poller.pollUntilDone();
    // Cast: the SDK's logical-response type for this poller doesn't carry a typed `body` beyond
    // `status` in this package version -- the actual runtime shape is the analyze-operation
    // payload documented for GetAnalyzeResult. Unverified against a live resource -- flagged as a
    // known risk until tested against real Azure output.
    const operation = pollResult.body as AnalyzeOperationOutput;
    if (operation.status !== "succeeded" || !operation.analyzeResult) {
      throw new Error(operation.error?.message ?? "Document analysis did not complete successfully");
    }

    const { content, pages, tables } = operation.analyzeResult;
    const page = pages[0];

    const whoBrandingPhrase = detectWhoBranding(content);
    const checks: CoverCheck[] = [
      {
        id: "who_branding",
        label: "No WHO/Geneva branding",
        severity: "block",
        status: whoBrandingPhrase ? "fail" : "pass",
        message: whoBrandingPhrase
          ? `This document appears to carry WHO/Geneva branding or letterhead ("${whoBrandingPhrase}") — it shouldn't be submitted this way.`
          : "No WHO/Geneva branding detected.",
      },
      checkSectionIiiPresent(content),
      checkWhoTeam(content),
      ...checkName(content),
      checkYesNoField(page, "hotel", "hotel_answer", "Hotel Yes/No"),
      checkYesNoField(page, "meals", "meals_answer", "Meals Yes/No"),
      checkItinerary(tables),
      checkDutyReport(content),
      ...checkSignatureAndDate(page, content),
      checkTotalAmount(content),
      ...checkSectionIiiNames(content),
    ];

    const hasBlockingFailure = checks.some((c) => c.severity === "block" && c.status === "fail");

    return {
      checks,
      hasBlockingFailure,
      scanAvailable: true,
      rawTextFound: whoBrandingPhrase ?? undefined,
    };
  }
}
