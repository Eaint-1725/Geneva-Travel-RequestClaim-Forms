"use client";

export default function Field({
  label,
  error,
  hint,
  hintTestId,
  width,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  hintTestId?: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex shrink-0 flex-col text-sm ${width ?? ""}`}>
      <span className="mb-0.5 block min-h-[14px] text-[11px] text-gray-500">{label}</span>
      {children}
      {error && <span className="mt-0.5 block text-[11px] text-red-600">{error}</span>}
      {hint && (
        <span className="mt-0.5 block text-[11px] text-gray-500" data-testid={hintTestId}>
          {hint}
        </span>
      )}
    </label>
  );
}
