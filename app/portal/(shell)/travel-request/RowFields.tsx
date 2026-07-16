"use client";

import { AREAS, DEDUCTIONS, MODES_OF_TRAVEL, TOWNSHIPS } from "@/lib/travel/rates";
import { formatMmk, formatUsd } from "@/lib/travel/format";
import type { Row } from "@/lib/travel/types";
import Field from "@/components/travel/Field";

const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

function numOrNull(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function RowFields({
  row,
  rowIndex,
  rowLabel,
  onChange,
  errors,
  perDiemUsd,
  amountMmk,
}: {
  row: Row;
  rowIndex: number;
  rowLabel: string;
  onChange: (row: Row) => void;
  errors: Record<string, string>;
  perDiemUsd: number;
  amountMmk: number;
}) {
  const set = <K extends keyof Row>(field: K, value: Row[K]) => onChange({ ...row, [field]: value });
  const tid = (suffix: string) => `travel-row-${rowIndex}-${suffix}`;

  return (
    <div className="mb-2" data-testid={`travel-row-${rowIndex}`}>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{rowLabel}</p>
      <div className="flex flex-wrap gap-2">
        <Field label="Date" error={errors.date} width="w-36">
          <input type="date" className={`${inputCls} w-full`} value={row.date} onChange={(e) => set("date", e.target.value)} data-testid={tid("date")} />
        </Field>
        <Field label="From (Area)" error={errors.fromArea} width="w-40">
          <select className={`${inputCls} w-full`} value={row.fromArea} onChange={(e) => set("fromArea", e.target.value)} data-testid={tid("from-area")}>
            <option value="">— select —</option>
            {AREAS.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="From Township (optional)" width="w-40">
          <select className={`${inputCls} w-full`} value={row.fromTownship} onChange={(e) => set("fromTownship", e.target.value)} data-testid={tid("from-township")}>
            <option value="">—</option>
            {TOWNSHIPS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="To (Area)" error={errors.toArea} width="w-40">
          <select className={`${inputCls} w-full`} value={row.toArea} onChange={(e) => set("toArea", e.target.value)} data-testid={tid("to-area")}>
            <option value="">— select —</option>
            {AREAS.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="To Township (optional)" width="w-40">
          <select className={`${inputCls} w-full`} value={row.toTownship} onChange={(e) => set("toTownship", e.target.value)} data-testid={tid("to-township")}>
            <option value="">—</option>
            {TOWNSHIPS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Mode of Travel" error={errors.mode} width="w-36">
          <select className={`${inputCls} w-full`} value={row.mode} onChange={(e) => set("mode", e.target.value)} data-testid={tid("mode")}>
            <option value="">— select —</option>
            {MODES_OF_TRAVEL.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="No of days" error={errors.noOfDays} width="w-20">
          <input type="number" min="0" step="1" className={`${inputCls} w-full`} value={row.noOfDays ?? ""} onChange={(e) => set("noOfDays", numOrNull(e.target.value))} data-testid={tid("days")} />
        </Field>
        <Field label="Deductions" error={errors.deduction} width="w-56">
          <select className={`${inputCls} w-full`} value={row.deduction} onChange={(e) => set("deduction", e.target.value)} data-testid={tid("deduction")}>
            <option value="">— select —</option>
            {DEDUCTIONS.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Travel cost + Hotel Bill (MMK, optional)" error={errors.travelHotelMmk} width="w-44">
          <input type="number" min="0" className={`${inputCls} w-full`} value={row.travelHotelMmk ?? ""} onChange={(e) => set("travelHotelMmk", numOrNull(e.target.value))} data-testid={tid("travel-hotel")} />
        </Field>
        <Field label="Air Ticket Cost (MMK, optional)" error={errors.airTicketMmk} width="w-40">
          <input type="number" min="0" className={`${inputCls} w-full`} value={row.airTicketMmk ?? ""} onChange={(e) => set("airTicketMmk", numOrNull(e.target.value))} data-testid={tid("air-ticket")} />
        </Field>
        <Field label="Terminal Allowance (USD, optional)" error={errors.terminalAllowanceUsd} width="w-44">
          <input type="number" min="0" className={`${inputCls} w-full`} value={row.terminalAllowanceUsd ?? ""} onChange={(e) => set("terminalAllowanceUsd", numOrNull(e.target.value))} data-testid={tid("terminal")} />
        </Field>
        <Field label="Purpose of travel" error={errors.purpose} width="w-56">
          <textarea
            rows={3}
            className={`${inputCls} w-full resize-y`}
            value={row.purpose}
            onChange={(e) => set("purpose", e.target.value)}
            data-testid={tid("purpose")}
          />
        </Field>
        <Field label="IPO Number (optional)" width="w-32">
          <input type="text" className={`${inputCls} w-full`} value={row.ipoNumber} onChange={(e) => set("ipoNumber", e.target.value)} data-testid={tid("ipo")} />
        </Field>
        <Field label="Remark (optional)" width="w-40">
          <input type="text" className={`${inputCls} w-full`} value={row.remark} onChange={(e) => set("remark", e.target.value)} data-testid={tid("remark")} />
        </Field>
      </div>
      <p className="mt-1 text-xs text-gray-600" data-testid={tid("computed")}>
        Total Per-diem: <strong>{formatUsd(perDiemUsd)} USD</strong> · Total Amount: <strong>{formatMmk(amountMmk)} MMK</strong>
      </p>
    </div>
  );
}
