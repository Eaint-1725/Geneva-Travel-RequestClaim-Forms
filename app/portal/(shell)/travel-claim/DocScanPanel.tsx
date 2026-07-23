"use client";

import { useEffect, useState } from "react";
import type { DocCheck, DocScanResult } from "@/lib/travel/claim/document-scan";

// The scan can legitimately take a while (rasterizing + a vision model call) -- past this, the
// plain "Checking…" copy starts reading as a hang even though the server-side timeout (see
// OVERALL_SCAN_TIMEOUT_MS in openai-provider.ts) is still comfortably away from firing.
const SLOW_SCAN_NOTICE_MS = 20_000;

type RowColor = "green" | "amber" | "red";

// pass -> green; an overridden check -> amber (cleared for gating, but still worth HR
// double-checking, see the "Scan overrides" note the submit step will attach); every other
// required (severity:"block") check that isn't "pass" -> red, since under strict gating (see the
// plan this shipped with) ANY non-pass required check blocks submit, not just an explicit "fail".
// The only severity:"warn" check that reaches this component is the synthetic "scan_unavailable"
// row, which falls through to amber.
function checkColor(c: DocCheck, overridden: boolean): RowColor {
  if (overridden) return "amber";
  if (c.status === "pass") return "green";
  if (c.severity === "block") return "red";
  return "amber";
}

// Reusing exactly the chip/row tokens already in the codebase -- no new colors. Green matches
// ClaimDocumentField's "✓ Uploaded" chip, amber matches docs/portal-kit/submit-page.tsx's draft
// chip, red matches docs/portal-kit/submit-page.tsx's rejected chip / page.tsx's error banner.
const ROW_BG: Record<RowColor, string> = { green: "bg-green-50", amber: "bg-amber-50", red: "bg-red-50" };
const BADGE_CLASSES: Record<RowColor, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
};
const BADGE_ICON: Record<RowColor, string> = { green: "✓", amber: "!", red: "✕" };

// Shared checklist UI for both the Travel Cover and Travel Report pre-submit scans (see
// lib/travel/claim/document-scan) -- fed either document's DocScanResult, one instance per
// document on the page. idPrefix keeps each instance's data-testids distinct (e.g.
// "travel-claim-cover-scan" vs "travel-claim-report-scan").
export default function DocScanPanel({
  idPrefix,
  docLabel,
  scan,
  scanning,
  manualAck,
  onManualAckChange,
  overriddenCheckIds,
  onOverrideCheck,
}: {
  idPrefix: string;
  /** Lowercase document name used in the loading/ack copy, e.g. "cover", "report". */
  docLabel: string;
  scan: DocScanResult | null;
  scanning: boolean;
  manualAck: boolean;
  onManualAckChange: (ack: boolean) => void;
  overriddenCheckIds: ReadonlySet<string>;
  onOverrideCheck: (checkId: string) => void;
}) {
  // Which row currently has its override confirmation expanded -- at most one at a time, and
  // overriding is always a two-step action (click to reveal, then an explicit Confirm) so a
  // stray click can never silently clear a block. See the plan this shipped with (§D).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Resets to false every time a fresh scan starts (scanning: false -> true), then flips on once
  // SLOW_SCAN_NOTICE_MS elapses without a result -- so a normal, fast scan never shows it.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!scanning) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_SCAN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [scanning]);

  if (scanning) {
    return (
      <p className="mt-1 text-xs text-gray-500" data-testid={`${idPrefix}-loading`}>
        {slow ? "Still checking — this can take a moment…" : `Checking ${docLabel}…`}
      </p>
    );
  }
  if (!scan) return null;

  const scanUnavailable = scan.scanAvailable === false;

  return (
    <div className="mt-1 rounded border border-gray-200 p-2" data-testid={idPrefix}>
      <ul className="space-y-0.5">
        {scan.checks.map((c) => {
          const overridden = overriddenCheckIds.has(c.id);
          const color = checkColor(c, overridden);
          const canOverride = !overridden && c.severity === "block" && c.status !== "pass";
          const confirming = confirmingId === c.id;

          return (
            <li key={c.id} className={`rounded px-2 py-1 text-xs ${ROW_BG[color]}`} data-testid={`${idPrefix}-check-${c.id}`}>
              <div className="flex items-start gap-1.5">
                <span className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${BADGE_CLASSES[color]}`}>
                  {BADGE_ICON[color]}
                </span>
                <span className="text-gray-700">
                  <span className="font-medium">{c.label}: </span>
                  {overridden ? "You confirmed this is present on your form." : c.message}
                </span>
              </div>

              {canOverride && !confirming && (
                <button
                  type="button"
                  onClick={() => setConfirmingId(c.id)}
                  className="ml-6 mt-1 text-[11px] text-primary underline hover:no-underline"
                  data-testid={`${idPrefix}-override-${c.id}`}
                >
                  The scan got this wrong — this is on my form
                </button>
              )}

              {canOverride && confirming && (
                <div className="ml-6 mt-1 flex flex-wrap items-center gap-2 rounded bg-white/60 p-1.5 text-[11px] text-gray-700">
                  <span>Confirm &quot;{c.label}&quot; is actually present on your form:</span>
                  <button
                    type="button"
                    onClick={() => {
                      onOverrideCheck(c.id);
                      setConfirmingId(null);
                    }}
                    className="rounded bg-primary px-2 py-0.5 font-medium text-white hover:opacity-90"
                    data-testid={`${idPrefix}-override-confirm-${c.id}`}
                  >
                    Confirm override
                  </button>
                  <button type="button" onClick={() => setConfirmingId(null)} className="text-gray-500 underline hover:no-underline">
                    Cancel
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {scanUnavailable && (
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={manualAck}
            onChange={(e) => onManualAckChange(e.target.checked)}
            className="mt-0.5"
            data-testid={`${idPrefix}-ack`}
          />
          Automated scan unavailable — I&apos;ve verified the {docLabel} manually and confirm it is complete.
        </label>
      )}
    </div>
  );
}
