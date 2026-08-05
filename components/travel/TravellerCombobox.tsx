"use client";

import { useEffect, useState } from "react";
import type { Traveller } from "@/lib/travel/travellers";

const inputCls = "rounded border border-gray-300 px-2 py-2.5 text-base lg:py-1.5 lg:text-sm";

/**
 * Searchable, closed-list combobox: typing filters the roster, only a click on a real option
 * commits a selection. Blurring without a click reverts the visible text back to the last
 * committed value, so a typed-but-not-selected name can never linger as the field's value.
 */
export default function TravellerCombobox({
  travellers,
  value,
  onSelect,
  testid,
}: {
  travellers: Traveller[];
  value: string;
  onSelect: (traveller: Traveller | null) => void;
  testid: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // Stay in sync when the committed value changes from outside this component (e.g. form Clear).
  useEffect(() => setQuery(value), [value]);

  const needle = query.trim().toLowerCase();
  const filtered = needle === "" ? travellers : travellers.filter((t) => t.name.toLowerCase().includes(needle));

  function handleChange(next: string) {
    setQuery(next);
    setOpen(true);
    if (next.trim() === "" && value !== "") onSelect(null);
  }

  function handleSelect(t: Traveller) {
    onSelect(t);
    setQuery(t.name);
    setOpen(false);
  }

  function handleBlur() {
    setOpen(false);
    setQuery(value);
  }

  return (
    <div className="relative w-full">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${inputCls} w-full`}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === "Escape" && handleBlur()}
        placeholder="Type to search…"
        data-testid={testid}
      />
      {open && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-gray-300 bg-white text-sm shadow-lg"
          data-testid={`${testid}-list`}
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-gray-500">No match</li>
          ) : (
            filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="block w-full px-2 py-1.5 text-left hover:bg-primary-light/30"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(t)}
                  data-testid={`${testid}-option-${t.id}`}
                >
                  {t.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
