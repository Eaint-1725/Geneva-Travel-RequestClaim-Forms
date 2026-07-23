"use client";

import { SUBMISSION_NOTE_MAX_LENGTH, type SubmissionMeta, type SubmissionType } from "@/lib/travel/types";
import Button from "@/components/Button";

const inputCls = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm";

const OPTIONS: { value: SubmissionType; label: string; hint?: string }[] = [
  { value: "new", label: "New request" },
  { value: "updated", label: "Updated request", hint: "I've already submitted this and need to change something" },
];

export function isSubmitNoteValid(meta: SubmissionMeta): boolean {
  return meta.type === "updated" ? meta.note.trim().length > 0 : true;
}

export default function SubmitNoteDialog({
  open,
  meta,
  onChange,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  meta: SubmissionMeta;
  onChange: (next: SubmissionMeta) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  if (!open) return null;

  const noteRequired = meta.type === "updated";
  const canSend = isSubmitNoteValid(meta) && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="travel-submit-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg">
        <h2 className="mb-1 text-base font-semibold text-navy-900">Before we send this to HR</h2>
        <p className="mb-3 text-sm text-gray-500">Let HR know whether this is a new request or a change to one already sent.</p>

        <fieldset className="mb-3 flex flex-col gap-2">
          <legend className="mb-0.5 block text-[11px] text-gray-500">Submission type</legend>
          {OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-sm ${
                meta.type === opt.value ? "border-primary bg-primary-light/30" : "border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="submission-type"
                className="mt-0.5"
                checked={meta.type === opt.value}
                onChange={() => onChange({ ...meta, type: opt.value })}
                data-testid={`travel-submit-dialog-type-${opt.value}`}
              />
              <span>
                <span className="block font-medium text-navy-900">{opt.label}</span>
                {opt.hint && <span className="block text-[11px] text-gray-500">{opt.hint}</span>}
              </span>
            </label>
          ))}
        </fieldset>

        <label className="mb-1 block text-sm">
          <span className="mb-0.5 block text-[11px] text-gray-500">
            {noteRequired ? "What changed?" : "Anything HR should know? (optional)"}
          </span>
          <textarea
            className={`${inputCls}`}
            rows={3}
            maxLength={SUBMISSION_NOTE_MAX_LENGTH}
            value={meta.note}
            placeholder={noteRequired ? "e.g. Changed travel dates for Trip 1 from 30 Jul to 2 Aug." : ""}
            onChange={(e) => onChange({ ...meta, note: e.target.value })}
            data-testid="travel-submit-dialog-note"
          />
        </label>
        <p className="mb-3 text-right text-[11px] text-gray-400" data-testid="travel-submit-dialog-note-counter">
          {meta.note.length}/{SUBMISSION_NOTE_MAX_LENGTH}
        </p>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={onConfirm}
            disabled={!canSend}
            data-testid="travel-submit-dialog-send"
          >
            {busy ? "Sending…" : "Send to HR"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} data-testid="travel-submit-dialog-cancel">
            Cancel / Back to form
          </Button>
        </div>
      </div>
    </div>
  );
}
