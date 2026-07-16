import type { Config } from "tailwindcss";

// Platform palette. SIM-446 (SIM-445a) introduces the SIM-445 design-token foundation: the full
// modern palette + semantic map + record-pill + table tokens, as ONE source of truth. Surfaces
// adopt these tokens in the later per-surface issues (sidebar, tables, RecordLink pills, Badge,
// buttons); the ONLY visual changes applied in SIM-446 are (a) agents: teal → INDIGO, and (b) the
// two-tier app/panel background. The legacy tokens (navy header, green `primary`, #171e2e sidebar)
// stay until their own adoption issues re-point them to the new palette.
const config: Config = {
  // SIM-263: class strategy — the no-flash inline script in app/layout.tsx
  // sets <html class="dark"> before first paint
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── legacy tokens (still consumed by current surfaces; re-pointed later) ──
        sidebar: {
          DEFAULT: "#171e2e",
          hover: "#232c42",
          active: "#2c3856",
          text: "#9aa5bd",
          heading: "#5e6a85",
        },
        navy: {
          DEFAULT: "#1b2a4a",
          light: "#273a63",
        },
        // SIM-445 (§3 single accent): `primary` re-pointed from the legacy green #1f9d55 to the
        // brand royal blue — every primary button/link/active accent flips in this ONE place
        // (buttons route through the shared <Button> since SIM-442). Green now means SUCCESS
        // only (the `success` token); the handful of success-meaning usages that leaned on the
        // green `primary` were re-pointed to `success` in the same pass.
        primary: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
          light: "#eff6ff",
        },

        // ── SIM-446 (SIM-445a): retire teal=agents → INDIGO #4F46E5 (applied now) ──
        // Every existing bg-agent / text-agent / bg-agent-light / border-agent now renders indigo.
        agent: {
          DEFAULT: "#4f46e5", // indigo (was teal #0d9488)
          hover: "#4338ca",   // SIM-445: hover for agent-solid buttons (teal-literal sweep)
          light: "#e0e7ff",   // indigo-100 (was teal #ccfbf1)
          text: "#4338ca",    // SIM-448: indigo-700 chip text (agent Badge tone)
        },

        // ── SIM-446 (SIM-445a): two-tier background (applied now) ──
        // The app shell. `content` is the shell bg that body + sticky headers consume; it moves
        // from the warm off-white #f7f7f5 to the cooler #F7F8FA so panels (white) read as raised.
        content: "#f7f8fa",
        "app-bg": "#f7f8fa", // semantic alias for the shell bg (later surfaces use this name)
        panel: "#ffffff",    // content cards / panels sit on the shell

        // ── SIM-445 palette — semantic tokens (one meaning = one colour). DEFINED here; the
        //    per-surface issues adopt them. ──
        brand: {              // navigation / active / selected / links / primary buttons / pagination
          DEFAULT: "#2563eb", // royal blue
          hover: "#1d4ed8",
          light: "#eff6ff",   // chip / selected-row tint
          strong: "#1d4ed8",
        },
        // `text` = the darker chip text (GitHub-muted: light bg + darker text), consumed by the
        // SIM-448 Badge re-point. brand uses its `strong` (#1d4ed8) for chip text.
        success: { DEFAULT: "#10b981", light: "#ecfdf5", text: "#047857" }, // success ONLY
        warning: { DEFAULT: "#f59e0b", light: "#fef3c7", text: "#b45309" }, // pending / warning
        error: { DEFAULT: "#ef4444", light: "#fee2e2", text: "#b91c1c" },   // problem / overdue ONLY
        // SIM-447 (SIM-445b): the sidebar palette. DEFAULT/hover from SIM-446; `text` added here for
        // the always-dark nav item label (Tailwind grays are dark-remapped, so a sidebar-scoped token
        // keeps the same colour in light + dark). Selected item = the `brand` blue.
        // SIM-612: `heading` — section labels on the charcoal nav. text-secondary (#6b7280) sat at
        // ~3.7:1 on #111827; #9ca3af reads ~7.0:1 and stays fixed in dark mode like the other
        // nav-scoped tokens.
        nav: { DEFAULT: "#111827", hover: "#1f2937", text: "#d1d5db", heading: "#9ca3af" },
        "border-default": "#e5e7eb",                       // hairline borders
        "text-secondary": "#6b7280",                       // secondary text

        // ── record-pill tokens (TYPE identity, not status) — adopted into RecordLink later ──
        pill: {
          org: { bg: "#eff6ff", text: "#1d4ed8" },     // blue
          contact: { bg: "#ecfdf5", text: "#047857" }, // green
          lead: { bg: "#fef3c7", text: "#b45309" },    // amber
          deal: { bg: "#f3e8ff", text: "#7c3aed" },    // purple
        },

        // ── table tokens — adopted into the list/table surfaces later ──
        table: {
          row: "#ffffff",
          alt: "#fafafb",
          hover: "#eef5ff",
          selected: "#dbeafe", // blue (selected ≠ green success)
        },
      },
    },
  },
  plugins: [],
};

export default config;
