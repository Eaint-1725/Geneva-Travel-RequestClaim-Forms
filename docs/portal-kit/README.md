# portal-kit — verbatim source of truth

These files are **exact copies** of the CorpSec Client Portal primitives (`app/portal/`),
copied unmodified so a separate app can be built against them and later folded in
without visual drift. The companion spec is [`../PORTAL-DESIGN-SPEC.md`](../PORTAL-DESIGN-SPEC.md).

| Kit file | Copied from | What it is |
| --- | --- | --- |
| `tailwind.config.ts` | `tailwind.config.ts` | The full palette + token source of truth |
| `globals.css` | `app/globals.css` | Base layer + the entire dark-mode remap |
| `postcss.config.mjs` | `postcss.config.mjs` | Tailwind + autoprefixer wiring |
| `PortalShellLayout.tsx` | `app/portal/(shell)/layout.tsx` | The sidebar + content shell **and** nav (one file) |
| `portal-org-context.tsx` | `app/portal/(shell)/portal-org-context.tsx` | Org context the shell provides to every page |
| `PortalEmptyCard.tsx` | `app/portal/(shell)/PortalEmptyCard.tsx` | The "Coming soon" placeholder card |
| `Button.tsx` | `components/Button.tsx` | The one button primitive (4 variants, 2 sizes) |
| `Dropzone.tsx` | `components/Dropzone.tsx` | The one file-drop primitive |
| `dashboard-page.tsx` | `app/portal/(shell)/page.tsx` | Canonical **card + chip** reference page |
| `submit-page.tsx` | `app/portal/(shell)/submit/page.tsx` | Canonical **form + table + chip** reference page |

## Adapting them in a separate app (the only 3 things to change)

The files are verbatim, so two things won't resolve as-is in a fresh repo. Change these and nothing else:

1. **Path aliases.** They import via `@/lib/supabase`, `@/components/Button`. Set the same
   `@/*` → project-root alias in `tsconfig.json` (`"paths": { "@/*": ["./*"] }`), or rewrite the
   handful of imports. Keep component *file locations* mirrored so a later merge is a move, not a rewrite.
2. **The data layer.** `PortalShellLayout.tsx`, `dashboard-page.tsx` and `submit-page.tsx` read
   through `getSupabaseBrowser()` (RLS-scoped Supabase). Swap that for your own data source, but
   **keep the component shapes, class strings and markup identical** — that is what preserves the look.
   The auth gate in the shell (session → `portal_client` role → `aal2` MFA → org load) is the
   behavioural contract; reproduce the same four states (`loading` / `suspended` / `ready` / redirect).
3. **Tailwind must see the kit.** Ensure your `content` globs cover wherever you place these files
   (the copied config already globs `./app/**` and `./components/**`).

Do **not** edit the class strings, the colour tokens, `globals.css`, or `tailwind.config.ts` — those
are the pixels. Everything visual is reproduced by installing the same Tailwind version and keeping
these class strings intact.
