"use client";

export default function Field({
  label,
  error,
  width,
  children,
}: {
  label: string;
  error?: string;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${width ?? ""}`}>
      <span className="mb-0.5 block text-[11px] text-gray-500">{label}</span>
      {children}
      {error && <span className="mt-0.5 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}
