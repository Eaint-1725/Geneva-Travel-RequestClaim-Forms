import OpenAI from "openai";
import type { CoverCheck, CheckSeverity, CoverScanProvider, CoverScanResult } from "./types";

// OpenAI vision implementation of CoverScanProvider -- sends the one-page Travel Cover PDF
// directly to a vision-capable Responses API model (no local rasterization: the Responses API
// extracts page images from the PDF itself) and gets back a strict JSON checklist. Only this file
// talks to OpenAI -- everything else in the app imports the provider through ./index.
//
// The model is trusted for `status` and `message` per check ONLY. `label` and `severity` are
// owned entirely by our code (CHECK_LABELS / SEVERITY_BY_ID below) so a hallucinated or malformed
// model response can never change what blocks submit or how a check is presented.

const DEFAULT_MODEL = "gpt-4o";

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

const SUPERVISOR_NAME = "Ei Thae Phyu";
const FINANCE_NAME = "Theint Theint Thu";

const SYSTEM_PROMPT = `You are validating a single, fixed one-page "TRAVEL CLAIM SUMMARY FORM" image/PDF page.

Report EXACTLY these ${KNOWN_CHECK_IDS.length} checks, one object per id, using these ids verbatim: ${KNOWN_CHECK_IDS.join(", ")}.

Rules per check:
- who_geneva_branding: status "fail" ONLY if the document carries an actual WHO/Geneva logo, letterhead, or branding (e.g. a "World Health Organization" letterhead, a Geneva HQ address). The form legitimately contains the phrases "WHO TEAM" and "WHO can query" -- these are normal form text and must NEVER cause a fail here. Only real WHO/Geneva branding counts.
- who_team: "pass" if the text "WHO TEAM" appears on the form.
- name_format: "pass" if a Name appears in the format "Name, Position (Duty Station)", e.g. "Hla Hla, NTO (Yangon)".
- hotel_meals: "pass" only if BOTH a Hotel Yes/No answer AND a Meals Yes/No answer are present -- each may be a written Yes/No or a ticked checkbox.
- itinerary: "pass" if the itinerary table has at least one populated row.
- duty_report: "pass" if "Duty Travel report submitted" has a Yes/No answer.
- ssa_signature: "pass" if the SSA holder signature box is signed AND has a date beside it. This is an approximate visual judgement.
- total_amount: "pass" if a Total Travel Claim amount in MMK is present on the form.
- section_iii_present: "fail" if Section III (Approvals) is missing from the page entirely; "pass" if present.
- section_iii_names: "pass" only if, within Section III, the supervisor/authorized officer name is "${SUPERVISOR_NAME}" AND the finance staff name is "${FINANCE_NAME}". Allow minor OCR/handwriting spelling variance when matching these two names.

Be honest about uncertainty: if you cannot clearly read a field, use status "warn" with a message saying you couldn't confirm it -- never guess "pass" or "fail" when the page is unclear.

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

  async scanTravelCover(pdf: Buffer, contentType: string): Promise<CoverScanResult> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = process.env.OPENAI_SCAN_MODEL || DEFAULT_MODEL;
    const mime = contentType || "application/pdf";

    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "travel-cover.pdf",
              file_data: `data:${mime};base64,${pdf.toString("base64")}`,
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
