"use client";

import { useEffect, useRef, useState } from "react";
import Dropzone from "@/components/Dropzone";
import { MAX_FILE_BYTES, formatBytes, isPdfFile } from "@/lib/travel/claim/documents";
import type { UploadedFile } from "@/lib/travel/claim/types";

interface PendingEntry {
  /** Stable per-file id, independent of filename -- lets two same-named files upload/fail
   * side by side without one's state update clobbering the other's. */
  id: string;
  name: string;
  status: "uploading" | "error";
  message?: string;
}

// Every Supporting Documents field on the claim form goes through this: the browser posts the
// file as multipart form data to /api/travel/claim/blob-upload, which uploads it to Vercel Blob
// server-side and returns the blob URL. The form only ever holds that URL/name/size, never raw
// file data beyond the upload itself.
export default function ClaimDocumentField({
  label,
  hint,
  testid,
  pdfOnly = false,
  multiple = false,
  files,
  onChange,
  error,
  disabled = false,
  onUploadingChange,
  onFileAccepted,
}: {
  label: string;
  hint?: string;
  testid: string;
  pdfOnly?: boolean;
  multiple?: boolean;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  error?: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  /** Fires once per accepted file, before its upload starts -- independent of upload success/failure.
   * Used only by the Travel Cover field to kick off its pre-submit scan (see page.tsx); every other
   * field simply omits this prop. */
  onFileAccepted?: (file: File) => void;
}) {
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEntry[]>([]);

  // Mirrors the `files` prop so a just-resolved upload can append onto the latest known list
  // even if the parent hasn't re-rendered yet (React state updates from an earlier resolve in
  // the same batch are async, but this ref is updated synchronously right after each onChange).
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  async function handleFiles(picked: File[]) {
    setRejectMsg(null);
    const accepted: File[] = [];
    for (const f of picked) {
      if (pdfOnly && !isPdfFile(f)) {
        setRejectMsg(`"${f.name}" isn't a PDF — only PDF files are accepted here.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setRejectMsg(`"${f.name}" is ${formatBytes(f.size)} — the per-file limit is ${formatBytes(MAX_FILE_BYTES)}.`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length === 0) return;

    const entries: PendingEntry[] = accepted.map((f) => ({ id: crypto.randomUUID(), name: f.name, status: "uploading" }));
    setPending((p) => [...p, ...entries]);
    onUploadingChange?.(true);

    for (let i = 0; i < accepted.length; i++) {
      const f = accepted[i];
      const entryId = entries[i].id;
      onFileAccepted?.(f);
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("pdfOnly", pdfOnly ? "true" : "false");

        const res = await fetch("/api/travel/claim/blob-upload", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Upload failed");
        }
        const blob = (await res.json()) as { url: string; pathname: string; name: string; size: number };

        // Resolved -- the file is in Blob and the browser has its URL. Flip this field/file
        // straight from "uploading" to "uploaded" now; nothing else needs to happen server-side.
        const uploaded: UploadedFile = {
          url: blob.url,
          pathname: blob.pathname,
          name: f.name,
          size: f.size,
          contentType: f.type || "application/octet-stream",
        };
        const next = multiple ? [...filesRef.current, uploaded] : [uploaded];
        filesRef.current = next;
        onChange(next);
        setPending((p) => p.filter((e) => e.id !== entryId));
      } catch (e) {
        const message = e instanceof Error ? e.message : "please try again";
        setPending((p) => p.map((entry) => (entry.id === entryId ? { ...entry, status: "error", message } : entry)));
      }
    }
    onUploadingChange?.(false);
  }

  function removeFile(url: string) {
    onChange(files.filter((f) => f.url !== url));
  }

  function dismissError(id: string) {
    setPending((p) => p.filter((entry) => entry.id !== id));
  }

  const uploading = pending.filter((e) => e.status === "uploading");
  const failed = pending.filter((e) => e.status === "error");

  return (
    <div data-testid={testid}>
      <p className="mb-1 text-sm font-medium text-navy-900">{label}</p>
      {hint && <p className="mb-1 text-[11px] text-gray-500">{hint}</p>}
      <Dropzone
        onFiles={(fs) => void handleFiles(fs)}
        accept={pdfOnly ? ".pdf,application/pdf" : undefined}
        multiple={multiple}
        disabled={disabled}
        compact
        testid={`${testid}-dropzone`}
      >
        <span className="text-gray-500">{multiple ? "Drop files here or click to browse" : "Drop a file here or click to browse"}</span>
      </Dropzone>
      {rejectMsg && <p className="mt-1 text-xs text-red-600" data-testid={`${testid}-reject`}>{rejectMsg}</p>}
      {uploading.length > 0 && (
        <p className="mt-1 text-xs text-gray-500" data-testid={`${testid}-uploading`}>
          Uploading {uploading.map((e) => e.name).join(", ")}…
        </p>
      )}
      {failed.map((entry) => (
        <p key={entry.id} className="mt-1 flex items-center justify-between gap-2 text-xs text-red-600" data-testid={`${testid}-reject`}>
          <span>"{entry.name}" failed to upload — {entry.message}. Drop it again to retry.</span>
          <button type="button" onClick={() => dismissError(entry.id)} className="shrink-0 text-gray-400 hover:text-red-600">
            dismiss
          </button>
        </p>
      ))}
      {files.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {files.map((f) => (
            <li key={f.url} className="flex items-center justify-between rounded bg-green-50 px-2 py-1 text-xs text-gray-700" data-testid={`${testid}-file`}>
              <span className="truncate">
                <span className="mr-1.5 rounded bg-green-100 px-1 py-0.5 text-[10px] font-medium text-green-800">✓ Uploaded</span>
                {f.name} <span className="text-gray-400">({formatBytes(f.size)})</span>
              </span>
              <button type="button" onClick={() => removeFile(f.url)} disabled={disabled} className="ml-2 shrink-0 text-gray-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" data-testid={`${testid}-remove`}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600" data-testid={`${testid}-error`}>{error}</p>}
    </div>
  );
}
