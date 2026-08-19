import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import type { Canvas } from "@napi-rs/canvas";
import OpenAI from "openai";
import { createIsomorphicCanvasFactory, definePDFJSModule, getDocumentProxy } from "unpdf";
import { TEAMS } from "@/lib/travel/rates";
import type { DocCheck, DocScanProvider, DocScanResult, ReportScanContext } from "./types";

// pdfjs-dist's canvas renderer targets a browser-like Canvas API and looks up Path2D/DOMMatrix/
// ImageData as GLOBALS rather than importing them -- @napi-rs/canvas provides its own
// implementations of these but doesn't install them on globalThis. Without this, rendering any
// vector drawing op (table borders, lines -- anything beyond a flat scanned image) throws inside
// pdfjs's CanvasGraphics.consumePath ("Value is none of these types `String`, `Path`"), because
// pdfjs hands the canvas backend a Path2D that global lookup can't resolve. A flat scanned image
// (no vector ops) never hits this path, which is why the Travel Cover worked while the Travel
// Report -- built from vector table/line content -- crashed. Set once, before any pdfjs render.
globalThis.Path2D ??= Path2D as unknown as typeof globalThis.Path2D;
globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix;
globalThis.ImageData ??= ImageData as unknown as typeof globalThis.ImageData;

// OpenAI vision implementation of DocScanProvider -- rasterizes a claim document (Travel Cover or
// Travel Report) to one JPEG per page ourselves (see rasterizePdfPage/rasterizeAllPages below),
// then sends those image(s) to a vision-capable Responses API model and
// gets back a strict JSON checklist. Both documents share this one file/provider/schema-building
// plumbing -- they're the same shape of problem (read the filled-in value beside/inside each
// labelled field, judge pass/fail/block) with two different checklists (COVER_* vs REPORT_*
// below). Both documents read EVERY page: the Travel Cover can legitimately run to 2+ pages, and
// checks like section_iii_present/section_iii_names/ssa_signature commonly land on a later page;
// the Travel Report's other checks are still expected on page 1 in practice, but its
// employee_signature check specifically must search every page -- a long report's employee
// signature can land at the bottom of the last page, and page-1-only reading would falsely block
// a validly-signed report.
//
// We rasterize ourselves rather than sending the PDF straight through (the Responses API can
// accept a PDF directly and will extract page images internally) because that internal extraction
// gave us no control over resolution -- scanned handwriting and checkboxes came back too blurry to
// read reliably. Rendering at RASTER_DPI ourselves and sending the image with detail:"high" fixes
// that. Only this file talks to OpenAI or does PDF rasterization -- everything else in the app
// imports the provider through ./index.
//
// The model is trusted for `status` and `message` per check ONLY. `label` and `severity` are
// owned entirely by our code so a hallucinated or malformed model response can never change what
// blocks submit or how a check is presented. Every check in COVER_CHECK_IDS / REPORT_CHECK_IDS is
// a required field on its document -- severity is always "block", and hasBlockingFailure fires on
// ANY required check whose status isn't "pass" (a "warn"/uncertain read blocks exactly like a
// "fail" does -- see page.tsx's per-item override, which is how a legitimate document the scan
// misread gets unblocked without weakening this rule).
//
// Signature checks (ssa_signature on the cover, tu_signature on the report) get one more layer of
// code ownership on top of that: image-based signature judgement is the least reliable thing an
// LLM can attest to here (it can't verify a signature is genuine, and can conflate a printed label
// or a nearby date with an actual mark in the box). So the model is never trusted to self-report
// pass/fail for these -- instead it reports raw observations (signaturePresent: is there ink
// INSIDE the box; dateNearSignature: is a date present beside it, cover's ssa_signature only --
// on the report, tu_signature repurposes this same boolean to mean "was the box itself located
// under either of its known labels", since a date is never relevant there), and OUR code
// deterministically derives status + a fixed message from those. The model's own `status`/
// `message` for these check ids are ignored entirely. The Travel Report's tu_signature rule is
// additionally team-conditional (only blocks for EPI) -- that decision is made entirely in our
// code from the form's own team field (ReportScanContext), never guessed by the model, which is
// never told the team at all.

const DEFAULT_MODEL = "gpt-4o";

// ~200 DPI (PDF points are 1/72in) -- stepped up from the previous 150 baseline (~1600-1800px long
// edge) to read handwriting more reliably at detail:"high", while staying well short of the 300
// DPI target that used to block the Node event loop while rendering (stalling concurrent requests
// like blob-upload) and produce an oversized base64 payload to OpenAI. Handwriting reading is
// inherently imperfect for any vision model no matter the resolution -- this raises accuracy, it
// doesn't guarantee a correct read, which is exactly why every check still has an honest "warn"
// path and the per-item manual override exists. Now that the Travel Cover can rasterize several
// pages (see rasterizeAllPages below), pages are always rendered one at a time in sequence, never
// concurrently, so per-page CPU cost doesn't stack into a single event-loop-blocking burst. Bump
// further (rather than back toward 300) only if a specific field stops reading reliably.
const RASTER_DPI = 200;

// JPEG over PNG for the same reason: a scanned document JPEG-compresses far smaller than a PNG
// with no meaningful legibility loss, which is most of what keeps the base64 payload small.
const JPEG_QUALITY = 82;

// Safety ceiling on how many pages get rasterized/sent for either document -- real covers and
// reports are short (1-3 pages); this only guards against a pathological upload (e.g. a
// misdirected multi-page scan) ballooning render time/payload, never a real form.
const MAX_SCAN_PAGES = 10;

// Hard ceilings so a slow/hanging OpenAI call or rasterization can never hang the request
// indefinitely -- see scanWithTimeout below. OPENAI_CALL_TIMEOUT_MS aborts the network call
// itself (via the SDK's own per-request timeout); OVERALL_SCAN_TIMEOUT_MS is the outer ceiling
// covering rasterization + the call together, since rasterization has no true cancellation.
const OPENAI_CALL_TIMEOUT_MS = 60_000;
const OVERALL_SCAN_TIMEOUT_MS = 70_000;
const SCAN_TIMEOUT_MESSAGE = "Scan timed out — please verify manually.";

// Concurrent claims (three travellers submitting at once = three OpenAI calls at once) can hit
// OpenAI's rate limit. The SDK already retries 429s itself with a short exponential backoff --
// maxRetries is set explicitly here (rather than relying on its own default) so that behaviour
// can't silently change out from under this route on an SDK bump. If every retry still comes back
// 429, that's reported as a distinct "busy" message rather than the generic scan_unavailable one,
// so the user knows to just try again shortly instead of assuming something is broken.
const OPENAI_MAX_RETRIES = 2;
const RATE_LIMIT_MESSAGE = "The document checker is busy right now — please try again in a few minutes.";

function isRateLimitError(e: unknown): boolean {
  return e instanceof OpenAI.APIError && e.status === 429;
}

// Loads the pdfjs-dist module into unpdf exactly once per process (repeat calls are cheap/no-op
// via the cached promise) -- required before rendering will work.
//
// Explicitly the `legacy` build: pdfjs-dist's default entry targets browsers and warns "Please
// use the `legacy` build in Node.js environments" when loaded server-side -- under Next's webpack
// bundling for this route that mismatch is what silently broke rasterization (it threw, and the
// route's graceful catch swallowed the real cause). The legacy build is the Node-supported path.
let pdfjsModuleReady: Promise<void> | null = null;
function ensurePdfjsModule(): Promise<void> {
  pdfjsModuleReady ??= definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  return pdfjsModuleReady;
}

// Shared pdfjs setup for rasterizing a document -- loads the module and opens the PDF exactly once
// per scan, before rasterizeAllPages renders however many pages it has.
async function loadPdfDocument(pdf: Buffer) {
  await ensurePdfjsModule();
  const CanvasFactory = await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas"));
  const pdfDoc = await getDocumentProxy(new Uint8Array(pdf), { CanvasFactory });
  return { pdfDoc, CanvasFactory };
}

// Renders one page of an already-opened PDF document to a JPEG at RASTER_DPI. Built directly on
// unpdf's lower-level getDocumentProxy/createIsomorphicCanvasFactory (rather than its
// renderPageAsImage helper) because that helper hard-codes PNG output via canvas.toDataURL() with
// no format/quality control -- we need JPEG for payload size. unpdf/pdfjs-dist + @napi-rs/canvas
// do the rendering entirely in-process (no native toolchain, no external binary), which keeps
// this safe to run in a Vercel Node serverless function -- see next.config.js's
// serverComponentsExternalPackages for the webpack-bundling fix that made this work reliably
// under Next's server build.
async function rasterizePdfPage(
  pdfDoc: Awaited<ReturnType<typeof getDocumentProxy>>,
  CanvasFactory: Awaited<ReturnType<typeof createIsomorphicCanvasFactory>>,
  pageNumber: number,
): Promise<Buffer> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RASTER_DPI / 72 });
  const drawingContext = new CanvasFactory().create(viewport.width, viewport.height);
  // pdfjs-dist's RenderParameters type is browser-shaped (HTMLCanvasElement/CanvasRenderingContext2D)
  // -- the same Node/browser API mismatch the globalThis polyfills above paper over. At runtime this
  // is always @napi-rs/canvas's own Canvas/SKRSContext2D (see createIsomorphicCanvasFactory).
  await page.render({
    canvas: drawingContext.canvas as unknown as HTMLCanvasElement,
    canvasContext: drawingContext.context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  // In Node, CanvasFactory always produces @napi-rs/canvas's own Canvas -- the only concrete type
  // with an .encode() (async, doesn't block the event loop the way a sync toBuffer() would).
  const canvas = drawingContext.canvas as Canvas;
  const buffer = await canvas.encode("jpeg", JPEG_QUALITY);
  if (buffer.length === 0) {
    throw new Error("Rasterizer produced an empty JPEG buffer");
  }
  // TEMP DIAGNOSTIC -- remove once confirmed the payload is comfortably small in production.
  console.log(
    `[doc-scan] rasterized page ${pageNumber} ${viewport.width}x${viewport.height} -> jpeg ${buffer.length} bytes (base64 ~${Math.ceil((buffer.length * 4) / 3)} bytes)`,
  );
  return buffer;
}

// Every page of the document, up to MAX_SCAN_PAGES -- used for both the Travel Cover and the
// Travel Report (see the file-level comment for why both need every page). Rendered sequentially
// (one page's render + encode fully finishes before the next starts), not in parallel, so a
// multi-page document's CPU cost stays spread out rather than stacking into one event-loop-
// blocking burst (see RASTER_DPI's comment). Covers and reports are short in practice, so this
// stays cheap.
async function rasterizeAllPages(pdf: Buffer): Promise<Buffer[]> {
  const { pdfDoc, CanvasFactory } = await loadPdfDocument(pdf);
  const pageCount = Math.min(pdfDoc.numPages, MAX_SCAN_PAGES);
  if (pdfDoc.numPages > MAX_SCAN_PAGES) {
    console.log(`[doc-scan] document has ${pdfDoc.numPages} pages -- only rasterizing the first ${MAX_SCAN_PAGES}`);
  }
  const buffers: Buffer[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    buffers.push(await rasterizePdfPage(pdfDoc, CanvasFactory, pageNumber));
  }
  return buffers;
}

// Races the real scan against a fixed ceiling so a slow/hung rasterization or model call always
// yields a response -- a request that never returns is worse than a graceful "please verify
// manually" degrade. The losing side (if the real scan is still running when the timeout wins)
// isn't truly cancelled -- Node can't force that -- but the HTTP response is no longer waiting on
// it, which is what matters here.
function scanWithTimeout(run: () => Promise<DocScanResult>): Promise<DocScanResult> {
  const timeout = new Promise<DocScanResult>((resolve) => {
    setTimeout(() => resolve(unavailableResult(SCAN_TIMEOUT_MESSAGE)), OVERALL_SCAN_TIMEOUT_MS);
  });
  return Promise.race([run(), timeout]);
}

// ---- Shared model-call plumbing (checklist-agnostic) ------------------------------------------

interface RawModelCheck {
  id: string;
  status: string;
  message: string;
  signaturePresent: boolean;
  dateNearSignature: boolean;
}

interface RawModelResult {
  checks: RawModelCheck[];
}

function isCheckStatus(status: string): status is DocCheck["status"] {
  return status === "pass" || status === "warn" || status === "fail";
}

function buildResponseSchema(checkIds: readonly string[]) {
  return {
    type: "object",
    properties: {
      checks: {
        type: "array",
        minItems: checkIds.length,
        maxItems: checkIds.length,
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: [...checkIds] },
            status: { type: "string", enum: ["pass", "warn", "fail"] },
            message: { type: "string" },
            signaturePresent: { type: "boolean" },
            dateNearSignature: { type: "boolean" },
          },
          required: ["id", "status", "message", "signaturePresent", "dateNearSignature"],
          additionalProperties: false,
        },
      },
    },
    required: ["checks"],
    additionalProperties: false,
  } as const;
}

// Strips a stray ```json ... ``` (or plain ```) fence the model might wrap the JSON in despite
// being told not to, then parses. Returns null on any failure -- callers must degrade gracefully,
// never throw, on a parse failure.
function parseModelJson(text: string): RawModelResult | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(stripped);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "checks" in parsed &&
      Array.isArray((parsed as { checks: unknown }).checks)
    ) {
      return parsed as RawModelResult;
    }
    return null;
  } catch {
    return null;
  }
}

// pageImages is every page to be sent, in document order -- one image for the Travel Report
// (always just page 1), one-per-page for the Travel Cover (see rasterizeAllPages). The trailing
// instruction text is worded differently for a single image vs. several so the model doesn't
// mistake a multi-page cover's later pages for a separate document.
async function requestScan(
  client: OpenAI,
  model: string,
  pageImages: readonly Buffer[],
  systemPrompt: string,
  checkIds: readonly string[],
): Promise<RawModelResult | null> {
  const instruction =
    pageImages.length > 1
      ? `This document has ${pageImages.length} pages, shown in order below as page 1 through page ${pageImages.length}. Treat them as one document -- some fields may appear on a later page. Scan all pages together and return the JSON checklist.`
      : "Scan this document and return the JSON checklist.";
  const response = await client.responses.create(
    {
      model,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            ...pageImages.map((pageImage) => ({
              type: "input_image" as const,
              detail: "high" as const,
              image_url: `data:image/jpeg;base64,${pageImage.toString("base64")}`,
            })),
            { type: "input_text", text: instruction },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "doc_scan",
          schema: buildResponseSchema(checkIds),
          strict: true,
        },
      },
    },
    // Aborts the network call itself rather than just racing it -- see OVERALL_SCAN_TIMEOUT_MS's
    // comment for why we also need the outer race (rasterization has no equivalent cancellation).
    { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES },
  );

  const result = parseModelJson(response.output_text);
  if (!result) {
    // TEMP DIAGNOSTIC -- remove once the report path is confirmed working. This is the silent
    // degrade path: no exception is thrown here, so the route's try/catch never sees it either.
    console.error(
      `[doc-scan] parseModelJson returned null -- status=${response.status} output_text(len=${response.output_text?.length ?? 0})=${JSON.stringify(response.output_text?.slice(0, 500))}`,
    );
  }
  return result;
}

function unavailableResult(message: string): DocScanResult {
  return {
    checks: [
      {
        id: "scan_unavailable",
        label: "Automated scan",
        status: "warn",
        severity: "warn",
        message,
      },
    ],
    hasBlockingFailure: false,
    scanAvailable: false,
  };
}

// ---- Travel Cover checklist ---------------------------------------------------------------

const COVER_CHECK_IDS = [
  "who_geneva_branding",
  "who_team",
  "name_format",
  "hotel_meals",
  "itinerary",
  "duty_report",
  "ssa_signature",
  "total_amount",
  "section_iii_present",
  "section_iii_names",
] as const;

type CoverCheckId = (typeof COVER_CHECK_IDS)[number];

const COVER_CHECK_LABELS: Record<CoverCheckId, string> = {
  who_geneva_branding: "No WHO/Geneva branding",
  who_team: "WHO TEAM present",
  name_format: "Name format (Name, Position (Duty Station))",
  hotel_meals: "Hotel/Meals Yes-No answered",
  itinerary: "Itinerary",
  duty_report: "Duty Travel report submitted",
  ssa_signature: "SSA holder signature + date",
  total_amount: "Total Travel Claim amount (MMK)",
  section_iii_present: "Section III (Approvals) present",
  section_iii_names: "Section III names (supervisor & finance)",
};

const SIGNATURE_PASS_MESSAGE = "SSA holder signature and date present.";
const SIGNATURE_MISSING_DATE_MESSAGE = "Signature present but the DATE is missing — please add the date.";
const SIGNATURE_MISSING_MESSAGE = "SSA holder signature is MISSING — the cover must be signed.";

const SUPERVISOR_NAME = "Ei Thae Phyu";
const FINANCE_NAME = "Theint Theint Thu";

const COVER_SYSTEM_PROMPT = `You are validating a single, fixed "TRAVEL CLAIM SUMMARY FORM" document. You are shown scanned images of EVERY page of this document, in order (it may be 1, 2, or more pages) -- treat all of them together as one document, not separate documents. A field required by a check below may legitimately appear on any page (for example, on a multi-page cover, Section III and the SSA holder signature commonly land on page 2 or later) -- search across ALL of the pages shown for each check, not just the first one.

This is a SCANNED form with handwritten entries, and it may mix Myanmar and English text. For every check, the data that matters is the VALUE actually written in NEXT TO or INSIDE the labelled cell -- not the printed label itself. A label being present on the form (e.g. the text "Total Travel Claim amount (MMK)") is not evidence of anything; you must find and read the handwritten/typed/ticked VALUE beside or inside that label. Examples: the claim amount is the handwritten or typed number in the cell to the right of the "Total Travel Claim amount (MMK)" label; a signature is ink actually INSIDE the "Signature SSA holder" box, not the label itself; Hotel/Meals answers are the ticked box or the handwritten Yes/No word written beside the label, not the label text. Read the value that was actually written in each cell -- do not infer or guess it from context. Do NOT report a field as present just because its label exists on the form -- judge only by the filled-in content.

Report EXACTLY these ${COVER_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${COVER_CHECK_IDS.join(", ")}. For every check, briefly state in your message what you actually read in the value cell (e.g. for total_amount, quote the number itself, like "Read 612,787 in the Total Travel Claim amount cell."). Every check object also carries two boolean fields, signaturePresent and dateNearSignature -- these are ONLY meaningful for the ssa_signature check (see its rule below); for every other check id just report your best honest read of those two fields or false if not applicable, they will be ignored.

Rules per check:
- who_geneva_branding: status "fail" if the document shows real WHO/Geneva branding -- this covers an actual WHO/Geneva logo, letterhead, or Geneva HQ address, OR the organization being named/branded in printed text via phrases like "World Health Organization", "World Health Organisation", "World Health Organisation (WHO)"/"World Health Organization (WHO)", or an abbreviated form such as "WHO Health Org". Do NOT fail on the legitimate form field "WHO TEAM" or incidental mentions like "WHO can query..." -- these are normal form text and must NEVER cause a fail. Only fail when text is actually naming/branding the organization, not when "WHO" appears as part of an unrelated form label.
- who_team: "pass" if the text "WHO TEAM" appears on the form.
- name_format: "pass" if a Name appears in the format "Name, Position (Duty Station)", e.g. "Hla Hla, NTO (Yangon)".
- hotel_meals: "pass" only if BOTH a Hotel Yes/No answer AND a Meals Yes/No answer are present -- each may be a handwritten Yes/No or a ticked checkbox, read from beside the label, not the label itself.
- itinerary: "pass" if the itinerary table has at least one populated row of actual trip data (dates, places, etc.), not just column headers.
- duty_report: "pass" if "Duty Travel report submitted" has a Yes/No answer written or ticked beside it.
- ssa_signature: look across ALL of the pages shown for the SSA holder signature box (on a multi-page cover it commonly appears on page 2 or later, not necessarily page 1). Judge ONLY the content actually inside that box, and set the two boolean fields honestly -- your status/message for this specific check are ignored, only the booleans matter. Set signaturePresent to true ONLY if there is visible handwriting/ink actually INSIDE the box -- a printed label such as "Signature SSA holder:" is NOT a signature, so an empty box with only that label means signaturePresent: false. Separately, set dateNearSignature to true if a Date value (handwritten or typed) is present in the Date field beside/next to the signature box, false if that Date field is empty -- this is independent of whether the signature itself is present. In your message for this check, state plainly what you observe and which page it's on (e.g. "box appears empty, no date" or "handwriting present in the box on page 2, date filled in").
- total_amount: "pass" if a Total Travel Claim amount in MMK is present on the form -- read the actual number from the value cell.
- section_iii_present: "pass" if Section III (Approvals) appears on ANY of the pages shown; "fail" only if it's missing from the entire document.
- section_iii_names: "pass" only if, within Section III (wherever it appears across the pages shown), the supervisor/authorized officer name written/typed in the value cell is "${SUPERVISOR_NAME}" AND the finance staff name written/typed in the value cell is "${FINANCE_NAME}". Allow minor OCR/handwriting spelling variance when matching these two names.

Be honest about uncertainty: handwriting is inherently hard to read perfectly, on this form and for any scan. If you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when a value is unclear or ambiguous. Do not infer a field is present from a nearby label, heading, or date -- judge each field by what is actually filled in beside or inside it. If you cannot clearly see the content, mark it "warn" with "couldn't confirm", never "pass".

Respond with ONLY the JSON object described by the schema -- no prose, no markdown code fences, no extra commentary.`;

function isCoverCheckId(id: string): id is CoverCheckId {
  return (COVER_CHECK_IDS as readonly string[]).includes(id);
}

// A missing/invalid id from the model doesn't invalidate the whole scan -- it's filled in here as
// an honest "couldn't confirm" warn, consistent with the uncertainty rule we ask the model to
// follow itself.
function buildCoverChecks(raw: RawModelResult): DocCheck[] {
  const byId = new Map<CoverCheckId, RawModelCheck>();
  for (const entry of raw.checks) {
    if (
      isCoverCheckId(entry.id) &&
      isCheckStatus(entry.status) &&
      typeof entry.message === "string" &&
      typeof entry.signaturePresent === "boolean" &&
      typeof entry.dateNearSignature === "boolean"
    ) {
      byId.set(entry.id, entry);
    }
  }

  return COVER_CHECK_IDS.map((id) => {
    const entry = byId.get(id);

    // Signature check: our code owns status and message outright, derived deterministically from
    // the model's two raw observations (see the file-level comment and the three fixed messages
    // above). A missing/unparseable model entry is treated as "nothing observed" -- i.e. the same
    // as an empty box -- so a scan glitch fails safe (blocks + is overridable) rather than passing
    // a signature check no one actually verified.
    if (id === "ssa_signature") {
      const signed = entry?.signaturePresent ?? false;
      const dated = entry?.dateNearSignature ?? false;
      const status: DocCheck["status"] = signed && dated ? "pass" : "fail";
      const message = !signed
        ? SIGNATURE_MISSING_MESSAGE
        : dated
          ? SIGNATURE_PASS_MESSAGE
          : SIGNATURE_MISSING_DATE_MESSAGE;
      return { id, label: COVER_CHECK_LABELS[id], status, severity: "block", message };
    }

    const status: DocCheck["status"] = entry && isCheckStatus(entry.status) ? entry.status : "warn";
    const message = entry?.message ?? "Couldn't confirm — the scan didn't return a result for this check.";
    return { id, label: COVER_CHECK_LABELS[id], status, severity: "block", message };
  });
}

// ---- Travel Report checklist ---------------------------------------------------------------

const REPORT_CHECK_IDS = [
  "who_geneva_branding",
  "submitted_by",
  "place_visited",
  "planned_date",
  "travel_date",
  "employee_signature",
  "tu_signature",
] as const;

type ReportCheckId = (typeof REPORT_CHECK_IDS)[number];

const REPORT_CHECK_LABELS: Record<ReportCheckId, string> = {
  who_geneva_branding: "No WHO/Geneva branding",
  submitted_by: "Submitted by (Name, Position (Duty Station))",
  place_visited: "Place visited",
  planned_date: "Planned date",
  travel_date: "Travel date",
  employee_signature: "Employee signature (in the Submitted by block, not TU's/WR's Clearance)",
  tu_signature: "TU's Clearance / WR's Clearance signature",
};

const EMPLOYEE_SIGNATURE_PASS_MESSAGE = "Employee signature present.";
const EMPLOYEE_SIGNATURE_MISSING_MESSAGE =
  "Employee signature is MISSING — the report must be signed by the employee (this is separate from the TU's/WR's Clearance signature).";
const EMPLOYEE_SIGNATURE_UNCERTAIN_MESSAGE =
  "Found the Submitted by signature area but couldn't confidently confirm a handwritten signature mark — please check and override if the report is actually signed.";

// EPI is the only team this form's TU's Clearance box applies to -- decided entirely in our code
// from the claim form's own team field (see ReportScanContext), never guessed by the model.
const TU_SIGNATURE_TEAM = "EPI";
const TU_SIGNATURE_PASS_MESSAGE = "TU's Clearance / WR's Clearance signature present.";
const TU_SIGNATURE_MISSING_MESSAGE = "TU's Clearance / WR's Clearance signature is MISSING (required for EPI).";
const TU_SIGNATURE_BOX_NOT_FOUND_MESSAGE =
  "Couldn't locate the TU's Clearance / Technical Unit / WR's Clearance box (required for EPI) -- if the report is correctly signed, override this check.";
const TU_SIGNATURE_NOT_REQUIRED_MESSAGE = "Not required for this team.";
const TU_SIGNATURE_UNKNOWN_TEAM_MESSAGE =
  "Team not detected — can't confirm whether TU's Clearance is required. Select your Team above, then re-upload the report.";

const REPORT_SYSTEM_PROMPT = `You are validating a single, fixed "SUMMARY DUTY TRAVEL REPORT" document. You are shown scanned images of EVERY page of this document, in order (it may be 1, 2, or more pages) -- treat all of them together as one document, not separate documents. submitted_by, place_visited, planned_date, travel_date, and tu_signature normally appear on page 1 -- read them from wherever they actually appear, but expect them on page 1. employee_signature is the exception: search ALL of the pages shown for it, including the last page (see its rule below) -- a report's employee signature can land on any page.

This is a SCANNED form with handwritten entries, and it may mix Myanmar and English text. For every check, the data that matters is the VALUE filled in BESIDE or AFTER the labelled field -- not the printed label itself. A label being present on the form (e.g. the text "PLACE visited") is not evidence of anything; you must find and read the handwritten/typed VALUE beside or after that label. Examples: the place visited is the text written after the "PLACE visited" label, not the label itself; the submitter is the name written after "Submitted by", not the label; a signature is ink actually INSIDE a signature box, not the label itself. Read the value that was actually written -- do not infer or guess it from context. Do NOT report a field as present just because its label exists on the form -- judge only by the filled-in content.

Report EXACTLY these ${REPORT_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${REPORT_CHECK_IDS.join(", ")}. For every check, briefly state in your message what you actually read in the value (e.g. for place_visited, quote it, like "Read 'Nay Pyi Taw' after PLACE visited."). Every check object also carries two boolean fields, signaturePresent and dateNearSignature -- these are ONLY meaningful for the employee_signature and tu_signature checks (see their rules below). For employee_signature: signaturePresent is true ONLY when you're confident you see a genuine handwritten signature mark; dateNearSignature is repurposed for this check to mean "ambiguous" -- set it true if you located the Submitted by signature area but can't confidently tell whether the ink there is a signature mark or just the printed name (report the ambiguity honestly instead of guessing), and false if there's no such ambiguity (either a clear signature was found, or the area is clearly unsigned/nothing was found). For tu_signature, signaturePresent is whether there is ink inside the box, and dateNearSignature is repurposed for this form to mean whether you were able to locate the box itself at all (under any of its known labels), regardless of whether it's signed. For every other check id just report your best honest read of signaturePresent or false if not applicable, and report dateNearSignature as false -- both will be ignored for those checks.

Rules per check:
- who_geneva_branding: status "fail" if the document shows real WHO/Geneva branding -- this covers an actual WHO/Geneva logo, letterhead, or Geneva HQ address, OR the organization being named/branded in printed text via phrases like "World Health Organization", "World Health Organisation", "World Health Organisation (WHO)"/"World Health Organization (WHO)", or an abbreviated form such as "WHO Health Org". Ordinary words like "WHO", "EPI", or "UNICEF" appearing as normal form content/body text (not naming/branding the organization) must NEVER cause a fail here. Do NOT fail on legitimate form labels/fields such as "WHO TEAM", "WR", or "WR's Clearance" (WHO Representative) either -- these are normal form labels, not branding, even though they contain "WHO" or start with "WR". Only real WHO/Geneva branding/letterhead, or the organization actually being named as above, counts.
- submitted_by: "pass" if a name appears after the "Submitted by" label in the format "Name, Position (Duty Station)", e.g. "Khaing Win, NTO (EPI), Shan East" -- read the actual filled-in name, not the label.
- place_visited: "pass" if a value is filled in after the "PLACE visited" label, e.g. "Nay Pyi Taw" -- read the value, not the label.
- planned_date: "pass" if a value is filled in after the "PLANNED DATE" label, e.g. "17-20 Mar 2026" -- read the value, not the label.
- travel_date: "pass" if a value is filled in after the "TRAVEL DATE" label, e.g. "17-24 Mar 2026" -- read the value, not the label.
- employee_signature: the employee's signature is typically found INSIDE the "Submitted by" header block, near or beside the "(Name)" line and the "Co-traveller(s) (if any):" line -- look there FIRST and most carefully. You are looking for a handwritten ink mark (a stylized scribble, initials, or a signature-like flourish) that is separate from the printed/typed name text -- it may be small, may overlap nearby text, or sit right beside the name; all of these still count as a signature. Do NOT mistake the printed/typed name itself for a signature -- you need actual handwritten ink beyond the typed text. This signature must NOT be ink inside a "TU's Clearance" / "Technical Unit" / "WR's Clearance" box on any page (see tu_signature below) -- a mark inside that box is the TU's/WR's signature, never the employee's, even if it's the only mark you can find anywhere in the document. If you don't find it in the Submitted by block, search the rest of the document (all pages shown) before concluding it's missing -- forms are occasionally laid out differently. Set signaturePresent to true ONLY when you are confident you see a genuine handwritten signature mark (in the Submitted by block or elsewhere, outside a TU/WR box). If the Submitted by signature area clearly exists but you can't confidently tell whether faint/stylized ink there is a signature mark or just the printed name, set signaturePresent to false AND dateNearSignature to true (ambiguous -- do not guess). If the area is clearly empty, or you cannot find any relevant signature anywhere in the document, set both signaturePresent and dateNearSignature to false. Your status/message for this specific check are ignored, only signaturePresent and dateNearSignature matter. This check is required for every team.
- tu_signature: this is ONE signature box that different versions of this form label differently -- look for it under ANY of these headings: "TU's Clearance", "Technical Unit", OR "WR's Clearance" (WHO Representative), and treat close variants of any of them as the same box (e.g. "Technical Unit Clearance", "TU Clearance", "T.U. Clearance", "WR Clearance", with or without a trailing colon, matched case-insensitively). Do not treat these labels as separate checks -- there is only ever one such box in the document, normally on page 1. First set dateNearSignature to true if you can locate this box at all (under any of those label variants) anywhere across the pages shown, or false if you cannot find it under any of them. Then judge ONLY the content actually inside that box and set signaturePresent honestly: true ONLY if there is visible handwriting/ink actually INSIDE the box -- a printed label alone (e.g. "TU's Clearance:", "Technical Unit:", or "WR's Clearance:") is NOT a signature, so an empty box with only that label means signaturePresent: false. If you could not locate the box at all, also report signaturePresent: false. Your status/message for this specific check are ignored, only signaturePresent and dateNearSignature matter.

Be honest about uncertainty: handwriting is inherently hard to read perfectly, on this form and for any scan. If you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when a value is unclear or ambiguous. Do not infer a field is present from a nearby label or heading -- judge each field by what is actually filled in beside or after it. If you cannot clearly see the content, mark it "warn" with "couldn't confirm", never "pass".

Respond with ONLY the JSON object described by the schema -- no prose, no markdown code fences, no extra commentary.`;

function isReportCheckId(id: string): id is ReportCheckId {
  return (REPORT_CHECK_IDS as readonly string[]).includes(id);
}

function buildReportChecks(raw: RawModelResult, context: ReportScanContext): DocCheck[] {
  const byId = new Map<ReportCheckId, RawModelCheck>();
  for (const entry of raw.checks) {
    if (
      isReportCheckId(entry.id) &&
      isCheckStatus(entry.status) &&
      typeof entry.message === "string" &&
      typeof entry.signaturePresent === "boolean" &&
      typeof entry.dateNearSignature === "boolean"
    ) {
      byId.set(entry.id, entry);
    }
  }

  // Never throw on a missing/malformed team -- but an unrecognized/empty team is NOT the same as
  // "not EPI": silently auto-passing the TU check whenever the team is missing would quietly skip
  // a real EPI requirement (e.g. the report was uploaded before Team was selected upstream). Only
  // a team we can actually recognize as non-EPI clears this check; anything else blocks until the
  // team is known. Trimmed/uppercased so stray whitespace or casing can't misclassify a real team.
  const normalizedTeam = (context?.team ?? "").trim().toUpperCase();
  const teamKnown = normalizedTeam !== "" && TEAMS.includes(normalizedTeam);
  const tuSignatureRequired = normalizedTeam === TU_SIGNATURE_TEAM;

  return REPORT_CHECK_IDS.map((id) => {
    const entry = byId.get(id);

    // Employee signature: our code owns status and message outright, same reasoning as
    // ssa_signature/tu_signature (see the file-level comment) -- a missing/unparseable model entry
    // is treated as "nothing observed", so a scan glitch fails safe rather than passing a signature
    // check no one actually verified. Required for every team, unlike tu_signature. dateNearSignature
    // is repurposed here (see the prompt) to mean "found the Submitted by area but the ink is
    // ambiguous" -- that reads as "warn" (surfaced, overridable, but not a confident MISSING),
    // distinct from "fail" when nothing relevant was found at all. Under strict gating "warn" still
    // blocks exactly like "fail" does -- only an explicit "pass" clears the check.
    if (id === "employee_signature") {
      const signed = entry?.signaturePresent ?? false;
      const uncertain = entry?.dateNearSignature ?? false;
      const status: DocCheck["status"] = signed ? "pass" : uncertain ? "warn" : "fail";
      const message = signed
        ? EMPLOYEE_SIGNATURE_PASS_MESSAGE
        : uncertain
          ? EMPLOYEE_SIGNATURE_UNCERTAIN_MESSAGE
          : EMPLOYEE_SIGNATURE_MISSING_MESSAGE;
      return { id, label: REPORT_CHECK_LABELS[id], status, severity: "block", message };
    }

    // TU's Clearance: our code owns status and message outright. Team-gating happens here, from
    // the form's own team field, never from the model (which is never told the team) -- a non-EPI
    // claim always passes this check regardless of what the model observed in the box.
    if (id === "tu_signature") {
      if (!teamKnown) {
        return { id, label: REPORT_CHECK_LABELS[id], status: "warn", severity: "block", message: TU_SIGNATURE_UNKNOWN_TEAM_MESSAGE };
      }
      if (!tuSignatureRequired) {
        return { id, label: REPORT_CHECK_LABELS[id], status: "pass", severity: "block", message: TU_SIGNATURE_NOT_REQUIRED_MESSAGE };
      }
      const signed = entry?.signaturePresent ?? false;
      // dateNearSignature is repurposed for this check (see the prompt) to mean "was the box
      // located at all under either of its known labels" -- an entirely missing/unparseable model
      // entry has no such observation to trust, so it falls back to the generic MISSING message
      // rather than claiming the box couldn't be found.
      const boxLocated = entry ? entry.dateNearSignature : true;
      const message = signed
        ? TU_SIGNATURE_PASS_MESSAGE
        : boxLocated
          ? TU_SIGNATURE_MISSING_MESSAGE
          : TU_SIGNATURE_BOX_NOT_FOUND_MESSAGE;
      return { id, label: REPORT_CHECK_LABELS[id], status: signed ? "pass" : "fail", severity: "block", message };
    }

    const status: DocCheck["status"] = entry && isCheckStatus(entry.status) ? entry.status : "warn";
    const message = entry?.message ?? "Couldn't confirm — the scan didn't return a result for this check.";
    return { id, label: REPORT_CHECK_LABELS[id], status, severity: "block", message };
  });
}

// ---- Provider -------------------------------------------------------------------------------

export class OpenAiDocScanProvider implements DocScanProvider {
  constructor(private readonly apiKey: string) {}

  // Public methods stay thin wrappers around the real work so the timeout race (see
  // scanWithTimeout) applies uniformly to both documents from one place.
  async scanTravelCover(pdf: Buffer): Promise<DocScanResult> {
    return scanWithTimeout(() => this.runCoverScan(pdf));
  }

  async scanTravelReport(pdf: Buffer, _contentType: string, context: ReportScanContext): Promise<DocScanResult> {
    return scanWithTimeout(() => this.runReportScan(pdf, context));
  }

  private async runCoverScan(pdf: Buffer): Promise<DocScanResult> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = process.env.OPENAI_SCAN_MODEL || DEFAULT_MODEL;
    const pageImages = await rasterizeAllPages(pdf);

    let raw: RawModelResult | null;
    try {
      raw = await requestScan(client, model, pageImages, COVER_SYSTEM_PROMPT, COVER_CHECK_IDS);
    } catch (e) {
      // The SDK already retried (see OPENAI_MAX_RETRIES) -- this only fires once every retry is
      // exhausted, so a busy-provider message is accurate here, not a false alarm.
      if (isRateLimitError(e)) return unavailableResult(RATE_LIMIT_MESSAGE);
      throw e;
    }
    if (!raw) {
      return unavailableResult("Automated scan returned an unreadable result — please verify the cover manually.");
    }

    const checks = buildCoverChecks(raw);
    // Strict gating (see the file-level comment): a "warn"/uncertain read on a required check
    // blocks exactly like a "fail" does -- only an explicit "pass" clears a required check.
    const hasBlockingFailure = checks.some((c) => c.severity === "block" && c.status !== "pass");

    return { checks, hasBlockingFailure, scanAvailable: true };
  }

  private async runReportScan(pdf: Buffer, context: ReportScanContext): Promise<DocScanResult> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = process.env.OPENAI_SCAN_MODEL || DEFAULT_MODEL;
    const pageImages = await rasterizeAllPages(pdf);

    let raw: RawModelResult | null;
    try {
      raw = await requestScan(client, model, pageImages, REPORT_SYSTEM_PROMPT, REPORT_CHECK_IDS);
    } catch (e) {
      // The SDK already retried (see OPENAI_MAX_RETRIES) -- this only fires once every retry is
      // exhausted, so a busy-provider message is accurate here, not a false alarm.
      if (isRateLimitError(e)) return unavailableResult(RATE_LIMIT_MESSAGE);
      throw e;
    }
    if (!raw) {
      return unavailableResult("Automated scan returned an unreadable result — please verify the report manually.");
    }

    const checks = buildReportChecks(raw, context);
    // TEMP DIAGNOSTIC -- remove once the team-wiring fix is confirmed in production. Logs what the
    // TU's Clearance check actually decided, not just the raw form value (see the route's own log
    // for that), so a bad normalization/lookup is visible even if the raw value looks right.
    const tuCheck = checks.find((c) => c.id === "tu_signature");
    console.log(`[doc-scan] runReportScan team=${JSON.stringify(context?.team)} tu_signature=${tuCheck?.status}/${tuCheck?.message}`);
    const hasBlockingFailure = checks.some((c) => c.severity === "block" && c.status !== "pass");

    return { checks, hasBlockingFailure, scanAvailable: true };
  }
}
