"use client";

import { useRef, useState } from "react";

// SIM-615 — the ONE dropzone: drag-over highlight + drop-to-upload + click/keyboard
// browse. Adopted by every file-upload surface. VALIDATION STAYS WITH THE CALLER:
// `accept` drives the browse filter and the SAME extension/mime rule on drop (a
// mismatched drop shows the built-in reject note — parity with the native picker's
// filter); size/content limits remain in each surface's handler/API, unchanged.
export default function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  compact = false,
  className = "",
  testid = "dropzone",
  children,
}: {
  /** receives the accepted file(s) — single-file surfaces get a 1-element array */
  onFiles: (files: File[]) => void;
  /** same string a native <input type=file accept> takes (".docx", ".csv,text/csv") */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** inline chip-sized zone for toolbars (vs the full-width block) */
  compact?: boolean;
  className?: string;
  testid?: string;
  children: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejectNote, setRejectNote] = useState<string | null>(null);

  const matchesAccept = (f: File): boolean => {
    if (!accept) return true;
    const name = f.name.toLowerCase();
    const mime = (f.type || "").toLowerCase();
    return accept.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean).some((p) =>
      p.startsWith(".") ? name.endsWith(p) : p.endsWith("/*") ? mime.startsWith(p.slice(0, -1)) : mime === p,
    );
  };

  function take(list: FileList | null) {
    if (!list || disabled) return;
    const offered = multiple ? Array.from(list) : Array.from(list).slice(0, 1);
    const ok = offered.filter(matchesAccept);
    setRejectNote(ok.length < offered.length ? `File type not accepted (expected ${accept})` : null);
    if (ok.length) onFiles(ok);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload — drop a file here or press Enter to browse"
      data-testid={testid}
      data-dragover={dragOver ? "1" : "0"}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
      onClick={(e) => {
        if (disabled) return;
        // nested real controls (links, buttons, selects…) keep their own clicks
        if ((e.target as HTMLElement).closest("a, button, select, textarea, input:not([type='file'])")) return;
        fileRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileRef.current?.click(); }
      }}
      className={`cursor-pointer rounded border border-dashed transition-colors ${compact ? "px-3 py-2 text-sm" : "p-4 text-sm"} ${
        dragOver ? "border-primary bg-primary-light/40" : "border-gray-300 hover:border-gray-400"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        data-testid={`${testid}-input`}
        onChange={(e) => { take(e.target.files); e.target.value = ""; }}
      />
      {children}
      {rejectNote && <p className="mt-1 text-xs text-red-600" data-testid={`${testid}-reject`}>{rejectNote}</p>}
    </div>
  );
}
