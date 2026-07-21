import OpenAI from "openai";
import { definePDFJSModule, renderPageAsImage } from "unpdf";
import type { CoverCheck, CheckSeverity, CoverScanProvider, CoverScanResult } from "./types";

// OpenAI vision implementation of CoverScanProvider -- rasterizes page 1 of the one-page Travel
// Cover PDF to a high-resolution PNG ourselves (see rasterizeCoverPage below), then sends that
// image to a vision-capable Responses API model and gets back a strict JSON checklist.
//
// We rasterize ourselves rather than sending the PDF straight through (the Responses API can
// accept a PDF directly and will extract page images internally) because that internal extraction
// gave us no control over resolution -- scanned handwriting and checkboxes came back too blurry to
// read reliably. Rendering at RASTER_DPI ourselves and sending the image with detail:"high" fixes
// that. Only this file talks to OpenAI or does PDF rasterization -- everything else in the app
// imports the provider through ./index.
//
// The model is trusted for `status` and `message` per check ONLY. `label` and `severity` are
// owned entirely by our code (CHECK_LABELS / SEVERITY_BY_ID below) so a hallucinated or malformed
// model response can never change what blocks submit or how a check is presented.
//
// Signature checks (SIGNATURE_CHECK_IDS) get one more layer of code ownership on top of that:
// image-based signature judgement is the least reliable thing an LLM can attest to here (it can't
// verify a signature is genuine, and can conflate a printed label or a nearby date with an actual
// mark in the box) -- so their `status` is always forced to "warn" and their `message` is always
// one of our own two fixed strings, never the model's freeform text. A confident green pass on a
// signature would be actively misleading, so the model is never allowed to produce one.

const DEFAULT_MODEL = "gpt-4o";

// ~300 DPI (PDF points are 1/72in) -- comfortably clears the ~2000-2500px long-edge target for
// standard A4/Letter page sizes, so scanned handwriting and checkboxes stay legible instead of
// being downsized into a blur before the model ever sees them.
const RASTER_DPI = 300;

// Loads the pdfjs-dist module into unpdf exactly once per process (repeat calls are cheap/no-op
// via the cached promise) -- required before renderPageAsImage will work.
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

// Renders page 1 of the cover PDF to a PNG at RASTER_DPI. unpdf/pdfjs-dist + @napi-rs/canvas do
// the rendering entirely in-process (no native toolchain, no external binary), which keeps this
// safe to run in a Vercel Node serverless function. Confirmed at 2550x3300 (300 DPI Letter) against
// a real request -- see next.config.js's serverComponentsExternalPackages for the webpack-bundling
// fix that made this work reliably under Next's server build.
async function rasterizeCoverPage(pdf: Buffer): Promise<Buffer> {
  await ensurePdfjsModule();
  const png = await renderPageAsImage(new Uint8Array(pdf), 1, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: RASTER_DPI / 72,
  });
  const buffer = Buffer.from(png);
  if (buffer.length === 0) {
    throw new Error("Rasterizer produced an empty PNG buffer");
  }
  return buffer;
}

const KNOWN_CHECK_IDS = [
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

type CheckId = (typeof KNOWN_CHECK_IDS)[number];

const CHECK_LABELS: Record<CheckId, string> = {
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

// Hard-block policy, owned by our code: only these two ids can ever set hasBlockingFailure, and
// only when their status is "fail". Every other id is severity:"warn" no matter what the model
// says -- the model is never asked for a severity at all.
const BLOCK_CHECK_IDS: ReadonlySet<CheckId> = new Set(["who_geneva_branding", "section_iii_present"]);

function severityFor(id: CheckId): CheckSeverity {
  return BLOCK_CHECK_IDS.has(id) ? "block" : "warn";
}

// Image-judgement signature checks -- see the file-level comment. Currently just the SSA holder
// signature, but any future Section III signature judgement belongs in this same set.
const SIGNATURE_CHECK_IDS: ReadonlySet<CheckId> = new Set(["ssa_signature"]);

const SIGNATURE_LOOKS_EMPTY_MESSAGE = "The SSA holder box appears EMPTY — please check it is signed.";
const SIGNATURE_LOOKS_SIGNED_MESSAGE = "The SSA holder box appears signed — please confirm.";

const SUPERVISOR_NAME = "Ei Thae Phyu";
const FINANCE_NAME = "Theint Theint Thu";

const SYSTEM_PROMPT = `You are validating a single, fixed one-page "TRAVEL CLAIM SUMMARY FORM" scanned image.

This is a scanned form. For every check, the data that matters is the VALUE filled in NEXT TO or INSIDE the labelled cell -- not the printed label itself. A label being present on the form (e.g. the text "Total Travel Claim amount (MMK)") is not evidence of anything; you must find and read the handwritten/typed/ticked VALUE beside or inside that label. Examples: the claim amount is the handwritten or typed number in the cell to the right of the "Total Travel Claim amount (MMK)" label; a signature is ink actually INSIDE the "Signature SSA holder" box, not the label itself; Hotel/Meals answers are the ticked box or the Yes/No word written beside the label, not the label text. Do NOT report a field as present just because its label exists on the form -- judge only by the filled-in content.

Report EXACTLY these ${KNOWN_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${KNOWN_CHECK_IDS.join(", ")}. For every check, briefly state in your message what you actually read in the value cell (e.g. for total_amount, quote the number itself, like "Read 612,787 in the Total Travel Claim amount cell.").

Rules per check:
- who_geneva_branding: status "fail" ONLY if the document carries an actual WHO/Geneva logo, letterhead, or branding (e.g. a "World Health Organization" letterhead, a Geneva HQ address). The form legitimately contains the phrases "WHO TEAM" and "WHO can query" -- these are normal form text and must NEVER cause a fail here. Only real WHO/Geneva branding counts.
- who_team: "pass" if the text "WHO TEAM" appears on the form.
- name_format: "pass" if a Name appears in the format "Name, Position (Duty Station)", e.g. "Hla Hla, NTO (Yangon)".
- hotel_meals: "pass" only if BOTH a Hotel Yes/No answer AND a Meals Yes/No answer are present -- each may be a written Yes/No or a ticked checkbox, read from beside the label, not the label itself.
- itinerary: "pass" if the itinerary table has at least one populated row of actual trip data (dates, places, etc.), not just column headers.
- duty_report: "pass" if "Duty Travel report submitted" has a Yes/No answer written or ticked beside it.
- ssa_signature: judge ONLY the content actually inside the SSA holder signature box. A signature counts ONLY if there is visible handwriting/ink INSIDE the box. A printed label such as "Signature SSA holder:" is NOT a signature. A Date next to the box is NOT a signature, and does not make an empty box count as signed. If the box is blank apart from the printed label, this is "fail" (not signed). If there is clear handwriting/ink inside the box, this is "pass". In your message for this check, state plainly what you observe in the box itself (e.g. "box appears empty" or "handwriting present in the box").
- total_amount: "pass" if a Total Travel Claim amount in MMK is present on the form -- read the actual number from the value cell.
- section_iii_present: "fail" if Section III (Approvals) is missing from the page entirely; "pass" if present.
- section_iii_names: "pass" only if, within Section III, the supervisor/authorized officer name written/typed in the value cell is "${SUPERVISOR_NAME}" AND the finance staff name written/typed in the value cell is "${FINANCE_NAME}". Allow minor OCR/handwriting spelling variance when matching these two names.

Be honest about uncertainty: if you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when the page is unclear. Do not infer a field is present from a nearby label, heading, or date -- judge each field by what is actually filled in beside or inside it. If you cannot clearly see the content, mark it "warn" with "couldn't confirm", never "pass".

Respond with ONLY the JSON object described by the schema -- no prose, no markdown code fences, no extra commentary.`;

interface RawModelCheck {
  id: string;
  status: string;
  message: string;
}

interface RawModelResult {
  checks: RawModelCheck[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      minItems: KNOWN_CHECK_IDS.length,
      maxItems: KNOWN_CHECK_IDS.length,
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...KNOWN_CHECK_IDS] },
          status: { type: "string", enum: ["pass", "warn", "fail"] },
          message: { type: "string" },
        },
        required: ["id", "status", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["checks"],
  additionalProperties: false,
} as const;

function isCheckId(id: string): id is CheckId {
  return (KNOWN_CHECK_IDS as readonly string[]).includes(id);
}

function isCheckStatus(status: string): status is CoverCheck["status"] {
  return status === "pass" || status === "warn" || status === "fail";
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

// A missing/invalid id from the model doesn't invalidate the whole scan -- it's filled in here as
// an honest "couldn't confirm" warn, consistent with the uncertainty rule we ask the model to
// follow itself.
function buildChecks(raw: RawModelResult): CoverCheck[] {
  const byId = new Map<CheckId, RawModelCheck>();
  for (const entry of raw.checks) {
    if (isCheckId(entry.id) && isCheckStatus(entry.status) && typeof entry.message === "string") {
      byId.set(entry.id, entry);
    }
  }

  return KNOWN_CHECK_IDS.map((id) => {
    const entry = byId.get(id);

    // Signature checks: our code owns both status and message outright -- the model's read is
    // advisory only (see the file-level comment). Status is always "warn"; the message picks
    // between our two fixed strings based on whether the model's own read leaned "signed"
    // (status "pass") or not (anything else, including "couldn't tell").
    if (SIGNATURE_CHECK_IDS.has(id)) {
      const looksSigned = entry?.status === "pass";
      return {
        id,
        label: CHECK_LABELS[id],
        status: "warn",
        severity: severityFor(id),
        message: looksSigned ? SIGNATURE_LOOKS_SIGNED_MESSAGE : SIGNATURE_LOOKS_EMPTY_MESSAGE,
      };
    }

    const status: CoverCheck["status"] = entry && isCheckStatus(entry.status) ? entry.status : "warn";
    const message = entry?.message ?? "Couldn't confirm — the scan didn't return a result for this check.";
    return { id, label: CHECK_LABELS[id], status, severity: severityFor(id), message };
  });
}

function unavailableResult(message: string): CoverScanResult {
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

export class OpenAiCoverScanProvider implements CoverScanProvider {
  constructor(private readonly apiKey: string) {}

  async scanTravelCover(pdf: Buffer): Promise<CoverScanResult> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = process.env.OPENAI_SCAN_MODEL || DEFAULT_MODEL;
    const pageImage = await rasterizeCoverPage(pdf);

    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_image",
              detail: "high",
              image_url: `data:image/png;base64,${pageImage.toString("base64")}`,
            },
            { type: "input_text", text: "Scan this Travel Claim cover page and return the JSON checklist." },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "travel_cover_scan",
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },
    });

    const raw = parseModelJson(response.output_text);
    if (!raw) {
      return unavailableResult("Automated scan returned an unreadable result — please verify the cover manually.");
    }

    const checks = buildChecks(raw);
    const hasBlockingFailure = checks.some((c) => c.severity === "block" && c.status === "fail");

    return { checks, hasBlockingFailure, scanAvailable: true };
  }
}
