"use client";

import { useEffect, useRef, useState } from "react";
import Dropzone from "@/components/Dropzone";
import { deleteRequestBlobs } from "@/lib/travel/request-uploads-client";
import { MAX_FILE_BYTES, MAX_TOTAL_ATTACH_BYTES, formatBytes } from "@/lib/travel/request-uploads";
import type { UploadedFile } from "@/lib/travel/types";

interface PendingEntry {
  /** Stable per-file id, independent of filename -- lets two same-named files upload/fail
   * side by side without one's state update clobbering the other's. */
  id: string;
  name: string;
  status: "uploading" | "error";
  message?: string;
}

// Approval Attachments goes through this: the browser posts the file as multipart form data to
// /api/travel/request/blob-upload, which uploads it to Vercel Blob server-side and returns the
// blob URL. The form only ever holds that URL/name/size, never raw file data beyond the upload
// itself. Mirrors app/portal/(shell)/travel-claim/ClaimDocumentField.tsx (simplified: always
// multi-file, any file type, no pre-submit scan hook).
export default function ApprovalAttachmentsField({
  files,
  onChange,
  error,
  disabled = false,
  onUploadingChange,
}: {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  error?: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
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
      try {
        const fd = new FormData();
        fd.append("file", f);

        const res = await fetch("/api/travel/request/blob-upload", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Upload failed");
        }
        const blob = (await res.json()) as { url: string; pathname: string; name: string; size: number };

        const uploaded: UploadedFile = {
          url: blob.url,
          pathname: blob.pathname,
          name: f.name,
          size: f.size,
          contentType: f.type || "application/octet-stream",
        };
        const next = [...filesRef.current, uploaded];
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
    // Optimistic: drop it from form state immediately, don't make the user wait on the network.
    // The delete is best-effort cleanup (see deleteRequestBlobs) -- a failure here is only logged,
    // never surfaced, and the file is already gone from the UI either way.
    onChange(files.filter((f) => f.url !== url));
    deleteRequestBlobs([url]);
  }

  function dismissError(id: string) {
    setPending((p) => p.filter((entry) => entry.id !== id));
  }

  const uploading = pending.filter((e) => e.status === "uploading");
  const failed = pending.filter((e) => e.status === "error");
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div data-testid="travel-attachments">
      <p className="mb-1 text-sm font-medium text-navy-900">Approval Attachments</p>
      <p className="mb-1 text-[11px] text-gray-500">Any file type, multiple files allowed. Required.</p>
      <p className="mb-1 text-[11px] text-gray-500">
        Per-file limit {formatBytes(MAX_FILE_BYTES)}. Total uploaded so far:{" "}
        <strong data-testid="travel-attachments-total">{formatBytes(totalBytes)}</strong>
        {totalBytes > MAX_TOTAL_ATTACH_BYTES
          ? " — some files will be sent as secure download links instead of attachments (still delivered, just not attached)."
          : `, within the ${formatBytes(MAX_TOTAL_ATTACH_BYTES)} email attachment budget.`}
      </p>
      <Dropzone
        onFiles={(fs) => void handleFiles(fs)}
        multiple
        disabled={disabled}
        compact
        className="max-lg:min-h-[44px]"
        testid="travel-attachments-dropzone"
      >
        <span className="text-gray-500">Drop files here or click to browse</span>
      </Dropzone>
      {rejectMsg && <p className="mt-1 text-xs text-red-600" data-testid="travel-attachments-reject">{rejectMsg}</p>}
      {uploading.length > 0 && (
        <p className="mt-1 text-xs text-gray-500" data-testid="travel-attachments-uploading">
          Uploading {uploading.map((e) => e.name).join(", ")}…
        </p>
      )}
      {failed.map((entry) => (
        <p key={entry.id} className="mt-1 flex items-center justify-between gap-2 text-xs text-red-600" data-testid="travel-attachments-reject">
          <span>"{entry.name}" failed to upload — {entry.message}. Drop it again to retry.</span>
          <button type="button" onClick={() => dismissError(entry.id)} className="shrink-0 text-gray-400 hover:text-red-600">
            dismiss
          </button>
        </p>
      ))}
      {files.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {files.map((f) => (
            <li key={f.url} className="flex flex-wrap items-center justify-between gap-1 rounded bg-green-50 px-2 py-1 text-xs text-gray-700 lg:flex-nowrap" data-testid="travel-attachments-file">
              <span className="max-lg:min-w-0 lg:truncate">
                <span className="mr-1.5 rounded bg-green-100 px-1 py-0.5 text-[10px] font-medium text-green-800">✓ Uploaded</span>
                {f.name} <span className="text-gray-400">({formatBytes(f.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(f.url)}
                disabled={disabled}
                className="ml-2 shrink-0 rounded border border-gray-200 px-2 py-1.5 text-gray-500 hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 lg:rounded-none lg:border-0 lg:p-0 lg:text-gray-400"
                data-testid="travel-attachments-remove"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600" data-testid="travel-attachments-error">{error}</p>}
    </div>
  );
}
