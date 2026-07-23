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

// OpenAI vision implementation of DocScanProvider -- rasterizes page 1 of a one-page claim
// document (Travel Cover or Travel Report) to a JPEG ourselves (see rasterizePage below), then
// sends that image to a vision-capable Responses API model and gets back a strict
// JSON checklist. Both documents share this one file/provider/schema-building plumbing -- they're
// the same shape of problem (read the filled-in value beside/inside each labelled field, judge
// pass/fail/block) with two different checklists (COVER_* vs REPORT_* below).
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
// INSIDE the box; dateNearSignature: is a date present beside it, cover only), and OUR code
// deterministically derives status + a fixed message from those. The model's own `status`/
// `message` for these check ids are ignored entirely. The Travel Report's tu_signature rule is
// additionally team-conditional (only blocks for EPI) -- that decision is made entirely in our
// code from the form's own team field (ReportScanContext), never guessed by the model, which is
// never told the team at all.

const DEFAULT_MODEL = "gpt-4o";

// ~150 DPI (PDF points are 1/72in) -- lands around a 1600-1800px long edge for a standard
// A4/Letter page, still plenty for the model to read handwriting/ticks at detail:"high". The
// previous 300 DPI target produced a huge image that blocked the Node event loop while rendering
// (stalling concurrent requests like blob-upload) and an oversized base64 payload to OpenAI --
// this is the "still legible, no longer heavy" middle ground. Bump modestly (e.g. 200) rather
// than back toward 300 if a specific field stops reading reliably.
const RASTER_DPI = 150;

// JPEG over PNG for the same reason: a scanned document JPEG-compresses far smaller than a PNG
// with no meaningful legibility loss, which is most of what keeps the base64 payload small.
const JPEG_QUALITY = 82;

// Hard ceilings so a slow/hanging OpenAI call or rasterization can never hang the request
// indefinitely -- see scanWithTimeout below. OPENAI_CALL_TIMEOUT_MS aborts the network call
// itself (via the SDK's own per-request timeout); OVERALL_SCAN_TIMEOUT_MS is the outer ceiling
// covering rasterization + the call together, since rasterization has no true cancellation.
const OPENAI_CALL_TIMEOUT_MS = 60_000;
const OVERALL_SCAN_TIMEOUT_MS = 70_000;
const SCAN_TIMEOUT_MESSAGE = "Scan timed out — please verify manually.";

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

// Renders page 1 of a one-page claim document PDF to a JPEG at RASTER_DPI. Built directly on
// unpdf's lower-level getDocumentProxy/createIsomorphicCanvasFactory (rather than its
// renderPageAsImage helper) because that helper hard-codes PNG output via canvas.toDataURL() with
// no format/quality control -- we need JPEG for payload size. unpdf/pdfjs-dist + @napi-rs/canvas
// do the rendering entirely in-process (no native toolchain, no external binary), which keeps
// this safe to run in a Vercel Node serverless function -- see next.config.js's
// serverComponentsExternalPackages for the webpack-bundling fix that made this work reliably
// under Next's server build.
async function rasterizePage(pdf: Buffer): Promise<Buffer> {
  await ensurePdfjsModule();
  const CanvasFactory = await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas"));
  const pdfDoc = await getDocumentProxy(new Uint8Array(pdf), { CanvasFactory });
  const page = await pdfDoc.getPage(1);
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
    `[doc-scan] rasterized ${viewport.width}x${viewport.height} -> jpeg ${buffer.length} bytes (base64 ~${Math.ceil((buffer.length * 4) / 3)} bytes)`,
  );
  return buffer;
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

async function requestScan(
  client: OpenAI,
  model: string,
  pageImage: Buffer,
  systemPrompt: string,
  checkIds: readonly string[],
): Promise<RawModelResult | null> {
  const response = await client.responses.create(
    {
      model,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "input_image",
              detail: "high",
              image_url: `data:image/jpeg;base64,${pageImage.toString("base64")}`,
            },
            { type: "input_text", text: "Scan this document and return the JSON checklist." },
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
    { timeout: OPENAI_CALL_TIMEOUT_MS },
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

const COVER_SYSTEM_PROMPT = `You are validating a single, fixed one-page "TRAVEL CLAIM SUMMARY FORM" scanned image.

This is a scanned form. For every check, the data that matters is the VALUE filled in NEXT TO or INSIDE the labelled cell -- not the printed label itself. A label being present on the form (e.g. the text "Total Travel Claim amount (MMK)") is not evidence of anything; you must find and read the handwritten/typed/ticked VALUE beside or inside that label. Examples: the claim amount is the handwritten or typed number in the cell to the right of the "Total Travel Claim amount (MMK)" label; a signature is ink actually INSIDE the "Signature SSA holder" box, not the label itself; Hotel/Meals answers are the ticked box or the Yes/No word written beside the label, not the label text. Do NOT report a field as present just because its label exists on the form -- judge only by the filled-in content.

Report EXACTLY these ${COVER_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${COVER_CHECK_IDS.join(", ")}. For every check, briefly state in your message what you actually read in the value cell (e.g. for total_amount, quote the number itself, like "Read 612,787 in the Total Travel Claim amount cell."). Every check object also carries two boolean fields, signaturePresent and dateNearSignature -- these are ONLY meaningful for the ssa_signature check (see its rule below); for every other check id just report your best honest read of those two fields or false if not applicable, they will be ignored.

Rules per check:
- who_geneva_branding: status "fail" ONLY if the document carries an actual WHO/Geneva logo, letterhead, or branding (e.g. a "World Health Organization" letterhead, a Geneva HQ address). The form legitimately contains the phrases "WHO TEAM" and "WHO can query" -- these are normal form text and must NEVER cause a fail here. Only real WHO/Geneva branding counts.
- who_team: "pass" if the text "WHO TEAM" appears on the form.
- name_format: "pass" if a Name appears in the format "Name, Position (Duty Station)", e.g. "Hla Hla, NTO (Yangon)".
- hotel_meals: "pass" only if BOTH a Hotel Yes/No answer AND a Meals Yes/No answer are present -- each may be a written Yes/No or a ticked checkbox, read from beside the label, not the label itself.
- itinerary: "pass" if the itinerary table has at least one populated row of actual trip data (dates, places, etc.), not just column headers.
- duty_report: "pass" if "Duty Travel report submitted" has a Yes/No answer written or ticked beside it.
- ssa_signature: judge ONLY the content actually inside the SSA holder signature box, and set the two boolean fields honestly -- your status/message for this specific check are ignored, only the booleans matter. Set signaturePresent to true ONLY if there is visible handwriting/ink actually INSIDE the box -- a printed label such as "Signature SSA holder:" is NOT a signature, so an empty box with only that label means signaturePresent: false. Separately, set dateNearSignature to true if a Date value (handwritten or typed) is present in the Date field beside/next to the signature box, false if that Date field is empty -- this is independent of whether the signature itself is present. In your message for this check, state plainly what you observe (e.g. "box appears empty, no date" or "handwriting present in the box, date filled in").
- total_amount: "pass" if a Total Travel Claim amount in MMK is present on the form -- read the actual number from the value cell.
- section_iii_present: "fail" if Section III (Approvals) is missing from the page entirely; "pass" if present.
- section_iii_names: "pass" only if, within Section III, the supervisor/authorized officer name written/typed in the value cell is "${SUPERVISOR_NAME}" AND the finance staff name written/typed in the value cell is "${FINANCE_NAME}". Allow minor OCR/handwriting spelling variance when matching these two names.

Be honest about uncertainty: if you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when the page is unclear. Do not infer a field is present from a nearby label, heading, or date -- judge each field by what is actually filled in beside or inside it. If you cannot clearly see the content, mark it "warn" with "couldn't confirm", never "pass".

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

const REPORT_CHECK_IDS = ["who_geneva_branding", "submitted_by", "place_visited", "planned_date", "travel_date", "tu_signature"] as const;

type ReportCheckId = (typeof REPORT_CHECK_IDS)[number];

const REPORT_CHECK_LABELS: Record<ReportCheckId, string> = {
  who_geneva_branding: "No WHO/Geneva branding",
  submitted_by: "Submitted by (Name, Position (Duty Station))",
  place_visited: "Place visited",
  planned_date: "Planned date",
  travel_date: "Travel date",
  tu_signature: "TU's Clearance signature",
};

// EPI is the only team this form's TU's Clearance box applies to -- decided entirely in our code
// from the claim form's own team field (see ReportScanContext), never guessed by the model.
const TU_SIGNATURE_TEAM = "EPI";
const TU_SIGNATURE_PASS_MESSAGE = "TU's Clearance signature present.";
const TU_SIGNATURE_MISSING_MESSAGE = "TU's Clearance signature is MISSING (required for EPI).";
const TU_SIGNATURE_NOT_REQUIRED_MESSAGE = "Not required for this team.";
const TU_SIGNATURE_UNKNOWN_TEAM_MESSAGE =
  "Team not detected — can't confirm whether TU's Clearance is required. Select your Team above, then re-upload the report.";

const REPORT_SYSTEM_PROMPT = `You are validating a single, fixed one-page "SUMMARY DUTY TRAVEL REPORT" scanned image.

This is a scanned form. For every check, the data that matters is the VALUE filled in BESIDE or AFTER the labelled field -- not the printed label itself. A label being present on the form (e.g. the text "PLACE visited") is not evidence of anything; you must find and read the handwritten/typed VALUE beside or after that label. Examples: the place visited is the text written after the "PLACE visited" label, not the label itself; the submitter is the name written after "Submitted by", not the label; a signature is ink actually INSIDE the "TU's Clearance" box, not the label itself. Do NOT report a field as present just because its label exists on the form -- judge only by the filled-in content.

Report EXACTLY these ${REPORT_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${REPORT_CHECK_IDS.join(", ")}. For every check, briefly state in your message what you actually read in the value (e.g. for place_visited, quote it, like "Read 'Nay Pyi Taw' after PLACE visited."). Every check object also carries two boolean fields, signaturePresent and dateNearSignature -- signaturePresent is ONLY meaningful for the tu_signature check (see its rule below), and dateNearSignature is unused on this form -- always report it as false. For every check id other than tu_signature just report your best honest read of signaturePresent or false if not applicable, it will be ignored.

Rules per check:
- who_geneva_branding: status "fail" ONLY if the document carries an actual WHO/Geneva logo, letterhead, or branding (e.g. a "World Health Organization" letterhead, a Geneva HQ address). Ordinary words like "WHO", "EPI", or "UNICEF" appearing in the body text are normal form content and must NEVER cause a fail here. Only real WHO/Geneva branding/letterhead counts.
- submitted_by: "pass" if a name appears after the "Submitted by" label in the format "Name, Position (Duty Station)", e.g. "Khaing Win, NTO (EPI), Shan East" -- read the actual filled-in name, not the label.
- place_visited: "pass" if a value is filled in after the "PLACE visited" label, e.g. "Nay Pyi Taw" -- read the value, not the label.
- planned_date: "pass" if a value is filled in after the "PLANNED DATE" label, e.g. "17-20 Mar 2026" -- read the value, not the label.
- travel_date: "pass" if a value is filled in after the "TRAVEL DATE" label, e.g. "17-24 Mar 2026" -- read the value, not the label.
- tu_signature: judge ONLY the content actually inside the "TU's Clearance" signature box, and set signaturePresent honestly -- your status/message for this specific check are ignored, only signaturePresent matters. Set it to true ONLY if there is visible handwriting/ink actually INSIDE the box -- a printed label such as "TU's Clearance:" is NOT a signature, so an empty box with only that label means signaturePresent: false.

Be honest about uncertainty: if you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when the page is unclear. Do not infer a field is present from a nearby label or heading -- judge each field by what is actually filled in beside or after it. If you cannot clearly see the content, mark it "warn" with "couldn't confirm", never "pass".

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
      typeof entry.signaturePresent === "boolean"
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
      return {
        id,
        label: REPORT_CHECK_LABELS[id],
        status: signed ? "pass" : "fail",
        severity: "block",
        message: signed ? TU_SIGNATURE_PASS_MESSAGE : TU_SIGNATURE_MISSING_MESSAGE,
      };
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
    const pageImage = await rasterizePage(pdf);

    const raw = await requestScan(client, model, pageImage, COVER_SYSTEM_PROMPT, COVER_CHECK_IDS);
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
    const pageImage = await rasterizePage(pdf);

    const raw = await requestScan(client, model, pageImage, REPORT_SYSTEM_PROMPT, REPORT_CHECK_IDS);
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
