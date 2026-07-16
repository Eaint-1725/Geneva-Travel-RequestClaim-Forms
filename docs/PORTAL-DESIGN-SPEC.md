# CorpSec Client Portal — Design System Spec

**Purpose.** Everything needed to build a *separate* app (e.g. an expense-lodging portal) that is
visually and behaviourally indistinguishable from the CorpSec Client Portal (`app/portal/`), so it
can be folded into the platform later with zero visual drift.

Every value below is extracted from the real codebase — `tailwind.config.ts`, `app/globals.css`,
and the portal components. Nothing here is approximated. The verbatim primitives live in
[`portal-kit/`](./portal-kit/) and are the source of truth; this document explains them.

> **Scope.** Covers the authenticated portal shell and its five pages (`/portal`, `/portal/submit`,
> `/portal/files`, `/portal/payroll`, `/portal/notifications`). The login/MFA screen (`/portal/login`)
> is a separate surface and out of scope here.

---

## 1. Framework & environment

Reproduce this exactly — the visual match depends on the same Tailwind version and default theme.

| Thing | Value | Notes |
| --- | --- | --- |
| Framework | **Next.js `^14.2.18`** (App Router) | Running 14.2.35. `middleware.ts` (not `proxy.ts`). |
| Language | **TypeScript `^5.6.3`**, `strict`, **no `any`** | Portal components are `"use client"`. |
| React | `^18.3.1` | |
| Styling | **Tailwind CSS `^3.4.15`** + `autoprefixer ^10.4.20` + `postcss ^8.4.49` | Class strategy dark mode. |
| UI library | **None** — no shadcn/ui, no Radix, no MUI | Every component is hand-rolled Tailwind. |
| Icon set | **None** — the portal ships zero icons | Status is conveyed by coloured text chips, not glyphs. |
| Fonts | **None loaded** — no `next/font`, no web font | Uses Tailwind's default `font-sans` / `font-mono` (see §3). |
| Data client | `@supabase/ssr ^0.5.2` + `@supabase/supabase-js ^2.47.0` | Reads via a browser client that respects RLS. Swappable. |

**Install:**
```bash
npx create-next-app@14 --typescript --tailwind --app
npm i @supabase/ssr@^0.5.2 @supabase/supabase-js@^2.47.0
# then drop in portal-kit/tailwind.config.ts, globals.css, postcss.config.mjs
```

**Config files** (copy verbatim from `portal-kit/`):
- `tailwind.config.ts` — `darkMode: "class"`, `content: ["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"]`, all colour tokens, **no `fontFamily`/`spacing`/`borderRadius` overrides** (so all of those are Tailwind defaults).
- `postcss.config.mjs` — `{ plugins: { tailwindcss: {}, autoprefixer: {} } }`.
- `app/globals.css` — `@tailwind base/components/utilities`, the `body` base rule, and the full dark-mode remap.

**Root layout requirement** (from `app/layout.tsx`): a pre-paint inline script sets the theme class before first paint so there is no flash:
```html
<html lang="en" suppressHydrationWarning>
  <head><script>try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark");}catch(e){}</script></head>
  <body>{children}</body>
</html>
```
`<body>` inherits the base rule `@apply bg-content text-gray-900 antialiased;`.

---

## 2. Colour system

Two families are in play: **custom tokens** defined in `tailwind.config.ts`, and **stock Tailwind
palette shades** the portal uses directly (`bg-gray-100`, `bg-amber-100`, …). Both are listed with
exact hex. All hex values are the real ones.

### 2.1 Custom tokens (from `tailwind.config.ts`)

| Token / class | Hex | Used in portal for |
| --- | --- | --- |
| `bg-content` / `bg-app-bg` | `#f7f8fa` | Page/body background (base `body` rule) |
| `bg-panel` | `#ffffff` | Defined as the card colour (portal cards actually use `bg-white`, identical) |
| `primary` (`bg-primary`) | `#2563eb` | Active nav item, mode toggles, submit button, dropzone drag border |
| `primary-hover` | `#1d4ed8` | Primary button/hover |
| `primary-light` | `#eff6ff` | Dropzone drag fill (`bg-primary-light/40`) |
| `nav` (`bg-nav`) | `#111827` | Sidebar background |
| `nav-hover` | `#1f2937` | (available; portal hovers use `bg-white/10`) |
| `nav-text` (`text-nav-text`) | `#d1d5db` | Sidebar default text |
| `nav-heading` | `#9ca3af` | (available nav section-label token) |
| `text-secondary` | `#6b7280` | Sidebar subtitle, org label & id |
| `border-default` | `#e5e7eb` | Hairline token (== `gray-200`, which portal uses directly) |
| `navy.DEFAULT` (`text-navy`) | `#1b2a4a` | Legacy heading token |
| `navy.light` | `#273a63` | Legacy |

> ⚠️ **Accuracy note — `text-navy-900` is undefined.** The portal headings are written as
> `text-navy-900`, but the `navy` token only defines `DEFAULT` and `light` — there is **no `navy-900`
> shade**, so Tailwind emits nothing and the heading falls back to the inherited body colour
> **`text-gray-900` = `#111827`**. To match exactly, render portal headings at **`#111827`** (do not
> invent a navy heading colour). The kit pages carry `text-navy-900` verbatim; it renders as `#111827`.

The config also defines `success`/`warning`/`error`, `brand`, `agent` (indigo `#4f46e5`), record `pill`,
and `table` tokens. The **portal pages do not use these** — they use stock palette shades for chips
(see §2.3). They are included in the kit config for completeness and future parity.

### 2.2 Stock Tailwind shades used directly (light mode)

| Class | Hex | Where |
| --- | --- | --- |
| `white` | `#ffffff` | Cards (`bg-white`) |
| `gray-100` | `#f3f4f6` | **Main content area** (`bg-gray-100`), service-code chip, mode-toggle idle, "coming soon" pill |
| `gray-200` | `#e5e7eb` | Card borders (`border-gray-200`), mode-toggle hover |
| `gray-300` | `#d1d5db` | Input borders, dropzone border |
| `gray-400` | `#9ca3af` | Muted meta text (`target …`) |
| `gray-500` | `#6b7280` | Subtitles, field labels, table headers |
| `gray-600` | `#4b5563` | Chip text, mono ref cells |
| `gray-700` | `#374151` | Mode-toggle idle text |
| `gray-800` | `#1f2937` | Engagement/row titles |
| `gray-900` | `#111827` | Body text + all headings (see navy note) |

### 2.3 Status chips — exact colours per status

Chips are inline `<span>`s (no component). Base class for every chip:
`rounded px-1.5 py-0.5 text-[11px] font-medium`. The colour pair is the only thing that varies.

**Submission status** (`STATUS_CHIP` map in `submit-page.tsx`):

| Status | Classes | Fill hex | Text hex |
| --- | --- | --- | --- |
| `draft` | `bg-amber-100 text-amber-800` | `#fef3c7` | `#92400e` |
| `approved` | `bg-green-100 text-green-800` | `#dcfce7` | `#166534` |
| `changes_requested` | `bg-blue-100 text-blue-800` | `#dbeafe` | `#1e40af` |
| `rejected` | `bg-red-100 text-red-800` | `#fee2e2` | `#991b1b` |
| *fallback* | `bg-gray-100 text-gray-600` | `#f3f4f6` | `#4b5563` |

**Other chips:**

| Chip | Classes | Fill / Text |
| --- | --- | --- |
| Engagement state = `open` | `bg-green-100 text-green-800` | `#dcfce7` / `#166534` |
| Engagement state ≠ open | `bg-gray-100 text-gray-600` | `#f3f4f6` / `#4b5563` |
| Service-code tag (e.g. `PAY`) | `bg-gray-100 text-gray-600` | `#f3f4f6` / `#4b5563` |
| Filed-doc status | `bg-amber-100 text-amber-800` | `#fef3c7` / `#92400e` |
| "Coming soon" pill | `bg-gray-100 text-gray-500` + `uppercase tracking-wide` | `#f3f4f6` / `#6b7280` |

**Form banners:** error = `bg-red-50 text-red-700` (`#fef2f2` / `#b91c1c`); success/notice =
`bg-green-50 text-green-800` (`#f0fdf4` / `#166534`). Both: `rounded px-3 py-1.5 text-sm`.

**Sidebar translucents:** active nav = `bg-primary` (`#2563eb`) `text-white`; idle hover =
`hover:bg-white/10` (`rgba(255,255,255,.1)`); sign-out border = `border-white/20` (`rgba(255,255,255,.2)`).

### 2.4 Dark mode (present, class-strategy)

Dark mode is fully implemented as **overrides of the exact utility classes** in `globals.css` under
`.dark` (no `dark:` variants in components). It activates when `<html class="dark">` is set
(the root script sets it from `localStorage.theme === "dark"`). **The portal ships no theme toggle**
of its own — it inherits whatever the platform sets — but every surface responds correctly. Key remaps:

| Light class | Dark value | Surface |
| --- | --- | --- |
| `body` | bg `#0e1320`, text `#d6dbe6` | Page |
| `bg-white` | `#1a2233` | Cards |
| `bg-gray-100` | `#232c41` | Main content area |
| `bg-content` / `bg-app-bg` | `#0e1320` | Body token |
| `bg-panel` | `#1a2233` | Card token |
| `border-gray-100/200/300` | `#232c41` / `#2c3650` / `#3a4663` | Borders |
| `text-gray-900/800/700/600/500/400` | `#e6eaf2` / `#dde2ec` / `#c4cbd9` / `#aab2c4` / `#8e98ac` / `#707b91` | Text ramp |
| `divide-gray-100` | `#232c41` | Row dividers |
| `bg-amber-100` / `text-amber-800` | `rgba(245,158,11,.16)` / `#fcd34d` | draft / filed chip |
| `bg-green-100` / `text-green-800` | `rgba(34,197,94,.18)` / `#a7f3d0` | approved / open chip |
| `bg-blue-100` / `text-blue-800` | `rgba(59,130,246,.18)` / `#a8cbfd` | changes-requested chip |
| `bg-red-100` / `text-red-800` | `rgba(239,68,68,.16)` / `#fecaca` | rejected chip |
| `bg-red-50` / `text-red-700` | `rgba(239,68,68,.16)` / `#fca5a5` | error banner |
| `bg-green-50` / `text-green-800` | `rgba(34,197,94,.14)` / `#a7f3d0` | notice banner |
| `bg-primary-light/40` | `rgba(37,99,235,.11)` | Dropzone drag fill |

The **sidebar (`nav` tokens) is intentionally dark-stable** — `#111827` in both themes (it's already
dark). Copy `globals.css` verbatim to get the complete remap (it covers far more than the portal uses).

---

## 3. Typography

**No font is configured**, so Tailwind's defaults apply. Installing `tailwindcss@3.4.15` reproduces
them exactly — trust the installed default over any transcription:

- `font-sans` (body, everything): Tailwind v3.4 default —
  `ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`.
- `font-mono` (submission reference cells only): `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`.

**Type scale used** (Tailwind default sizes; no scale override):

| Class | Size / line-height | Weight class | Used for |
| --- | --- | --- | --- |
| `text-xl` | 20px / 28px | `font-semibold` (600) | Page `<h1>` (Submit), dashboard "Welcome …" |
| `text-lg` | 18px / 28px | `font-bold` (700) | Sidebar wordmark "CorpSec" |
| `text-sm` | 14px / 20px | `font-semibold` (600) | Card/section headings (`<h2>`) |
| `text-sm` | 14px / 20px | `font-medium` (500) | Nav items, buttons, mode toggles, row titles, org name |
| `text-sm` | 14px / 20px | normal (400) | Body copy, table cells, inputs |
| `text-xs` | 12px / 16px | normal | Table headers, `target …` meta, "Client Portal" subtitle |
| `text-[11px]` | 11px | `font-medium` | **All chips**, field labels, org label/id |

Weights present: `font-bold` 700, `font-semibold` 600, `font-medium` 500, normal 400.
Case: `uppercase tracking-wider` (org label), `uppercase tracking-wide` (coming-soon pill).

---

## 4. Spacing, radius, shadows, metrics

All Tailwind defaults (no overrides in config).

| Property | Value | Where |
| --- | --- | --- |
| Sidebar width | `w-56` = **14rem / 224px**, `shrink-0` | Shell aside |
| Main padding | `p-6` = **1.5rem / 24px** | Content area |
| Card padding | `p-5` = **1.25rem / 20px** | All cards |
| Card gap (dashboard grid) | `gap-4` = **1rem / 16px** | `grid sm:grid-cols-2` |
| Inline gaps | `gap-2` (8px) rows/chips, `gap-1` (4px) mode toggles, `space-y-0.5` (2px) nav | |
| Card radius | `rounded-lg` = **0.5rem / 8px** | Cards |
| Chip/button/input/nav radius | `rounded` = **0.25rem / 4px** | Everything else |
| Border width | `1px` (`border`) hairlines; `border-dashed` on dropzone | |
| Select width | `w-72` = 18rem (engagement), auto (month) | Submit form |
| **Shadows** | **None on portal cards** — flat, border-only (`border border-gray-200`) | The only shadow is `shadow-sm` on the suspended-state card |
| Content max-width | **None** — main is fluid `flex-1`, full width under `p-6` | |

Vertical rhythm inside pages: `<h1>` `mb-1`, subtitle `mb-4` (or `mb-6` on dashboard), each card
`mb-4` (last card no margin). Field label spans use `mb-0.5`.

---

## 5. Layout shell

The shell is one client component: [`portal-kit/PortalShellLayout.tsx`](./portal-kit/PortalShellLayout.tsx).
It owns the auth gate, the nav, the org badge, and the `PortalOrgContext` provider every page consumes.

```
┌──────────────────────────────────────────────────────────────┐  flex h-screen
│ aside  w-56 shrink-0            │ main  flex-1 overflow-y-auto │
│ bg-nav (#111827) text-nav-text │ bg-gray-100  p-6             │
│ flex flex-col                  │                              │
│  ┌───────────────────────────┐ │   {page content}             │
│  │ px-4 py-5                 │ │                              │
│  │  CorpSec  (text-lg bold)  │ │   (cards, forms, tables)     │
│  │  Client Portal (xs 2nd)   │ │                              │
│  ├───────────────────────────┤ │                              │
│  │ px-4 pb-4  org badge      │ │                              │
│  │  YOUR ORGANISATION        │ │                              │
│  │  {org.name} (white)       │ │                              │
│  │  {org.display_id}         │ │                              │
│  ├───────────────────────────┤ │                              │
│  │ nav flex-1 px-2 space-y.5 │ │                              │
│  │  Dashboard / Submit /     │ │                              │
│  │  Payroll Review / Files / │ │                              │
│  │  Notifications            │ │                              │
│  ├───────────────────────────┤ │                              │
│  │ p-3  [ Sign out ]         │ │                              │
│  └───────────────────────────┘ │                              │
└──────────────────────────────────────────────────────────────┘
```

**Nav model** (array drives it):
```ts
const NAV = [
  { href: "/portal",               label: "Dashboard" },
  { href: "/portal/submit",        label: "Submit" },
  { href: "/portal/payroll",       label: "Payroll Review" },
  { href: "/portal/files",         label: "Files" },
  { href: "/portal/notifications", label: "Notifications" },
];
```
Active-state logic: `const active = n.href === "/portal" ? pathname === "/portal" : pathname.startsWith(n.href);`
(exact match for the index, prefix match for the rest). Active item → `bg-primary text-white`;
idle → `hover:bg-white/10`. Item class: `block rounded px-2 py-1.5 text-sm`.

**Behavioural contract (the gate, run client-side in the shell):**
1. `getSession()` — no session → redirect `/portal/login`.
2. `session.user.role !== "portal_client"` → redirect `/` (staff belongs elsewhere).
3. MFA: `mfa.getAuthenticatorAssuranceLevel()` — not `aal2` → redirect `/portal/login`.
4. `portal_users.status === "suspended"` → render the **suspended** card (keeps session, shows no data).
5. Otherwise load the org (`crm_organisations` → `{ display_id, name }`), render children in `PortalOrgContext`.

Three render states before children: `loading` ("Loading your portal…" centered), `suspended`
(the suspended card), `ready`. Reproduce all three. The server-side route guard (Next middleware)
mirrors rules 1–3; in a standalone app, gate both server (middleware) and client (shell) the same way.

`data-testid` hooks are load-bearing for tests: `portal-nav`, `portal-org-badge`,
`portal-nav-{label-kebab}`, `portal-signout`, `portal-suspended`. Keep them.

---

## 6. Component catalogue

Every recurring block, with its real markup pattern and classes. Kit file cited per component.

### 6.1 Nav sidebar
Part of `PortalShellLayout.tsx` (§5). Container:
`<aside class="flex w-56 shrink-0 flex-col bg-nav text-nav-text">`. Wordmark
`text-lg font-bold tracking-tight text-white` + `text-xs text-text-secondary` subtitle. Org badge
label `text-[11px] uppercase tracking-wider text-text-secondary`, name `truncate text-sm font-medium text-white`,
id `text-[11px] text-text-secondary`. Sign-out: `w-full rounded border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10`.

### 6.2 Page header
No component — a plain pattern at the top of each page:
```tsx
<h1 className="mb-1 text-xl font-semibold text-navy-900">Submit</h1>
<p className="mb-4 text-sm text-gray-500">{one-line description}</p>
```
(Dashboard variant uses `mb-6` on the subtitle and interpolates the org name into the `<h1>`.)

### 6.3 Content card
The base surface. Flat, border-only, no shadow:
```tsx
<div className="mb-4 rounded-lg border border-gray-200 bg-white p-5" data-testid="...">
  <h2 className="mb-1 text-sm font-semibold text-navy-900">{title}</h2>
  {/* body */}
</div>
```

### 6.4 "Coming soon" placeholder card — [`PortalEmptyCard.tsx`](./portal-kit/PortalEmptyCard.tsx)
The exact skeleton used by Files / Payroll / Notifications (those pages render *only* this):
```tsx
<div className="rounded-lg border border-gray-200 bg-white p-5" data-testid={testid ?? "portal-empty-card"}>
  <h2 className="mb-1 text-sm font-semibold text-navy-900">{title}</h2>
  <p className="text-sm text-gray-500">{note}</p>
  <p className="mt-3 inline-block rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">Coming soon</p>
</div>
```

### 6.5 Status chip
Inline span; base `rounded px-1.5 py-0.5 text-[11px] font-medium` + the colour pair from §2.3:
```tsx
<span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CHIP[status] ?? "bg-gray-100 text-gray-600"}`}>
  {status.replace("_", " ")}
</span>
```

### 6.6 Button — [`Button.tsx`](./portal-kit/Button.tsx)
The one primitive. `type="button"` default; `rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50` + size + variant:

| Variant | Classes |
| --- | --- |
| `primary` | `bg-primary text-white hover:bg-primary-hover` |
| `secondary` | `border border-gray-300 text-gray-600 hover:bg-gray-100` |
| `ghost` | `text-gray-500 hover:bg-gray-100 hover:text-gray-700` |
| `danger` | `bg-red-600 text-white hover:bg-red-700` |

| Size | Classes |
| --- | --- |
| `sm` | `px-3 py-1.5 text-sm` |
| `md` (default) | `px-4 py-2 text-sm` |

> The portal's submit/mode buttons are written inline (not via `<Button>`) but use the *same* tokens —
> submit = `rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50`
> (identical to `<Button variant="primary" size="md">`). Prefer `<Button>` in new code.

### 6.7 Inputs, selects & labels
Shared input class: **`rounded border border-gray-300 px-2 py-1.5 text-sm`**. Label pattern:
```tsx
<label className="block text-sm">
  <span className="mb-0.5 block text-[11px] text-gray-500">{label}</span>
  <select className="w-72 rounded border border-gray-300 px-2 py-1.5 text-sm">…</select>
</label>
```
Mode-toggle buttons (segmented control): `rounded px-3 py-1.5 text-sm font-medium`, selected
`bg-primary text-white`, idle `bg-gray-100 text-gray-700 hover:bg-gray-200`, row `flex gap-1`.

### 6.8 Submission form — [`submit-page.tsx`](./portal-kit/submit-page.tsx)
Canonical form. Structure: card wrapper → optional error/notice banner → field row
(`flex flex-wrap items-end gap-2`) → mode segmented control → per-mode panel (upload uses the
Dropzone; "no changes" a checkbox attestation; "manual" a repeating entry builder) → primary submit.
Reuse its exact class strings for pixel parity.

### 6.9 Table
Plain, borderless-outer, hairline rows:
```tsx
<table className="w-full text-left text-sm">
  <thead className="text-xs text-gray-500"><tr><th className="py-1">Ref</th>…</tr></thead>
  <tbody>
    <tr className="border-t border-gray-100 align-top">
      <td className="py-1.5 font-mono text-xs text-gray-600">{display_id}</td>
      <td className="py-1.5 text-gray-700">{…}</td>
    </tr>
  </tbody>
</table>
```
Header `text-xs text-gray-500`, cells `py-1.5`, row separators `border-t border-gray-100`, the
reference/ID column is `font-mono text-xs text-gray-600`. Empty state: `text-sm text-gray-500`.

### 6.10 Dropzone — [`Dropzone.tsx`](./portal-kit/Dropzone.tsx)
The one upload primitive: drag-over highlight + click/keyboard browse, caller owns validation.
Idle `border-gray-300 hover:border-gray-400`; drag-over `border-primary bg-primary-light/40`;
`compact` → `px-3 py-2 text-sm`, block → `p-4 text-sm`; always `cursor-pointer rounded border border-dashed transition-colors`.
Reject note `mt-1 text-xs text-red-600`.

### 6.11 Engagement row (dashboard list)
```tsx
<li className="flex flex-wrap items-center gap-2 py-2 text-sm">
  <span className="font-medium text-gray-800">{title}</span>
  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{service_code}</span>
  <span className="rounded px-1.5 py-0.5 text-[11px] font-medium {open? green : gray}">{state}</span>
  <span className="text-xs text-gray-400">target {expected_close}</span>
</li>
```
List wrapper `divide-y divide-gray-100`.

---

## 7. Page-by-page reference

| Route | Kit file | Renders | Data |
| --- | --- | --- | --- |
| `/portal` (Dashboard) | `dashboard-page.tsx` | Welcome header, "Your engagements" card (list or empty), 2×2 grid of `PortalEmptyCard`s | reads `crm_deals` |
| `/portal/submit` | `submit-page.tsx` | Submission form (3 modes), "Your submissions" table, "Filed documents" table | reads `crm_deals`, `portal_submissions`, `portal_files`; POSTs to `/api/portal/submissions` |
| `/portal/files` | (skeleton) | Single `PortalEmptyCard` ("Shared documents") | none — feature not built |
| `/portal/payroll` | (skeleton) | Single `PortalEmptyCard` ("Payroll review & approval") | none — feature not built |
| `/portal/notifications` | (skeleton) | Single `PortalEmptyCard` ("Notifications") | none — feature not built |

Files/Payroll/Notifications are intentional placeholders in the current build — the "Coming soon" card
**is** their finished current state. For a new portal, add real pages using the §6 building blocks.

---

## 8. Accuracy notes & gotchas (read before building)

1. **`text-navy-900` renders as `#111827`** (undefined token → inherits body `gray-900`). Headings are
   effectively gray-900, not navy. (§2.1)
2. **Main content area is `bg-gray-100` (`#f3f4f6`), not `bg-content`.** The body is `#f7f8fa`, but the
   shell's `<main>` paints `bg-gray-100` over it — so the visible page field is `#f3f4f6` (light).
3. **Portal cards have no shadow** — border-only (`border-gray-200`). Only the suspended-state card uses `shadow-sm`.
4. **Chips use stock Tailwind palette shades** (`amber/green/blue/red-100/800`), *not* the semantic
   `success/warning/error` tokens. Use the exact classes in §2.3.
5. **No icons anywhere** — don't add a glyph set; status reads as coloured text chips.
6. **Dark mode is override-based**, not `dark:` variants — you must ship `globals.css` verbatim for it
   to work, and the nav stays `#111827` in both themes by design.
7. **Keep `data-testid` attributes** — the platform's E2E tests target them; matching them keeps a later merge clean.

---

## 9. Kit manifest

Everything in [`portal-kit/`](./portal-kit/) is a byte-for-byte copy of the live source. See
[`portal-kit/README.md`](./portal-kit/README.md) for the file map and the three adaptations needed in a
separate repo (path aliases, data layer, Tailwind `content` globs). Build against those files; treat the
class strings, `tailwind.config.ts`, and `globals.css` as immutable — they are the pixels.
