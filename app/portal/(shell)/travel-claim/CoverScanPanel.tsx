"use client";

import type { CoverCheck, CoverScanResult } from "@/lib/travel/claim/document-scan";

type RowColor = "green" | "amber" | "red";

// pass -> green; a block-severity fail -> red (hard block, no override); everything else (a warn
// status, or a fail whose severity is only "warn") -> amber. See the plan this shipped with for
// why a warn-severity "fail" must render the same as a "warn" status, not as a block.
function checkColor(c: CoverCheck): RowColor {
  if (c.status === "pass") return "green";
  if (c.status === "fail" && c.severity === "block") return "red";
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

export default function CoverScanPanel({
  scan,
  scanning,
  ack,
  onAckChange,
}: {
  scan: CoverScanResult | null;
  scanning: boolean;
  ack: boolean;
  onAckChange: (ack: boolean) => void;
}) {
  if (scanning) {
    return (
      <p className="mt-1 text-xs text-gray-500" data-testid="travel-claim-cover-scan-loading">
        Checking cover…
      </p>
    );
  }
  if (!scan) return null;

  const needsAck =
    !scan.hasBlockingFailure &&
    (scan.scanAvailable === false || scan.checks.some((c) => c.status === "warn" || (c.status === "fail" && c.severity === "warn")));

  return (
    <div className="mt-1 rounded border border-gray-200 p-2" data-testid="travel-claim-cover-scan">
      <ul className="space-y-0.5">
        {scan.checks.map((c) => {
          const color = checkColor(c);
          return (
            <li
              key={c.id}
              className={`flex items-start gap-1.5 rounded px-2 py-1 text-xs ${ROW_BG[color]}`}
              data-testid={`travel-claim-cover-scan-check-${c.id}`}
            >
              <span className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${BADGE_CLASSES[color]}`}>
                {BADGE_ICON[color]}
              </span>
              <span className="text-gray-700">
                <span className="font-medium">{c.label}: </span>
                {c.message}
              </span>
            </li>
          );
        })}
      </ul>
      {needsAck && (
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => onAckChange(e.target.checked)}
            className="mt-0.5"
            data-testid="travel-claim-cover-scan-ack"
          />
          I&apos;ve reviewed the items above and confirm the cover is complete.
        </label>
      )}
    </div>
  );
}
