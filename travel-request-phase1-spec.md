# Travel Request Portal — Phase 1 Build Spec

**Goal.** A friendly web form that prevents incomplete travel requests. The user fills the
required fields and the per-leg trip rows; the Submit button stays disabled until every
required field is valid; on submit the platform generates a **new Excel file** that reproduces
the existing travel-request layout line by line (leg rows → per-trip subtotal → grand total →
signature block), with the employee's signature image embedded.

**Look & feel.** Built from the CorpSec `portal-kit/` components — same shell, sidebar, cards,
buttons, inputs, tables, and status chips — so it folds into the main portal later with zero
visual drift. No new fonts, colours, UI libraries, or layout patterns.

---

## 1. Field inventory

Three groups. "Required" means the Submit button is blocked until it is valid.

### 1a. Header / identity — one per request (hard-required)

| Field | Input type | Required | Validation | Notes |
| --- | --- | --- | --- | --- |
| Month | Month picker (YYYY-MM) | Yes | Must be a valid month | Header "Month:" cell |
| Submission Date | Date picker | Yes | Valid date; not in the future | Header "Submission date:" |
| Team | Dropdown | Yes | One of: ADM, DSE, EPI, ERM/WHE, HIV, HSS, MAL, NCD, NPO, PLN, RMNCAH, TB, WRO | Column A |
| Name of traveller | Text | Yes | Non-empty | Feeds the "Name of traveller/Capacity" cell |
| Position | Text | Yes | Non-empty | e.g. "NTO" |
| Duty Station | Text | Yes | Non-empty | e.g. "Yangon" |
| Exchange rate | Number | Yes | > 0 | Column O; USD→MMK |

The traveller/capacity cell in the sheet is composed as **`{Name}, {Position}- {Team}`**
(e.g. "Dr. Zar Ni Swe, NTO- EPI"), matching the current template.

### 1b. Trip legs — repeatable rows (at least one trip = two legs)

A **trip** = an outbound leg + a return leg. The user adds trips; each trip auto-creates its two
legs. These fields build the line-by-line body and drive the per-diem calculation.

| Field | Input type | Required per leg | Validation | Notes |
| --- | --- | --- | --- | --- |
| Date | Date picker | Yes | Valid; within the selected Month | Column C |
| From (Area) | Dropdown (32 areas) | Yes | In area list | Column D |
| From Township | Dropdown (~330) | Optional | In township list | Column E |
| To (Area) | Dropdown (32 areas) | Yes | In area list | Column F |
| To Township | Dropdown (~330) | Optional | In township list | Column G |
| Mode of Travel | Dropdown | Yes | Air, Boat, Coach, Official Vehicle, Private Vehicle, Cycle Taxi, Train, Rented vehicle | Column H (red-boxed in sample) |
| No of days | Number | Yes | ≥ 0 | Column I — see calc §2 |
| Deductions | Dropdown (11 options) | Yes | In deduction list | Column J — drives per-diem |
| Travel cost + Actual Hotel Bill | Number (MMK) | Optional | ≥ 0 | Column L — entered in MMK |
| Air Ticket Cost | Number (MMK) | Optional | ≥ 0 | Column M — entered in MMK |
| Terminal Allowance | Number (USD) | Optional | ≥ 0 | Column N — USD, ×exchange rate |
| Purpose of travel | Text | Yes | Non-empty | Column Q (red-boxed) |
| IPO Number | Text | Optional | — | Column R |
| Remark | Text | Optional | — | Column S |

**Auto-calculated (read-only, never user-entered):** Total Per-diem (K), Total Amount MMK (P),
per-trip subtotals, grand total.

### 1c. Signatures (bottom block)

| Block | Phase 1 | Notes |
| --- | --- | --- |
| Employee signature | **Drawn or uploaded image** (required) | Embedded into the sheet's employee block, with Name / Position / Duty Station / Team / Date printed beneath |
| HR Company (P&O) | Left blank | Approver signs later — not the client's step |
| Team Lead (WHO-EPI) | Left blank | Approver signs later |

---

## 2. Calculation logic (platform-side, then written into the sheet)

Rates and factors are taken from the analysed workbook and stored server-side.

**Daily rate for an area** = `Perdiem × (1 − Hotel component) × 90%` (the "DSA rate"). This is
looked up from the fixed area table — always against the **full** table (avoids the shifting-range
bug in the original sheet).

**Total Per-diem (USD), per leg** — branches on the Deduction choice:
- `Full deduction (100%)` → **0**
- `day >10 hrs travel (Non-HC)` **or** `overnight – outbound (50% destination)` → **To-area daily rate** (one day, no ×days)
- `overnight – inbound (50% origin)` → **From-area daily rate** (one day)
- everything else (`-`, `Non-Hotel Component(None)`, the meal deductions) → **To-area rate × No of days × deduction factor**

Deduction factors: `-` 0 · None 1.00 · +Breakfast 0.89 · +Lunch 0.78 · +Dinner 0.78 ·
+Breakfast+Lunch 0.67 · +3 meals 0.45.

**Total Amount (MMK), per leg** = `(Per-diem × exchange rate) + (Terminal allowance × exchange
rate) + Travel/Hotel + Air Ticket`. Per-diem and Terminal are USD (converted); Travel/Hotel and
Air Ticket are already MMK. **Keep the two currency worlds visually distinct in the UI.**

**Per-trip subtotal** = sum of that trip's two legs (per-diem and amount). **Grand Total** = sum of
all trips.

> Business rule to confirm with the client: From Area only affects the number in the
> "overnight – inbound" case; otherwise the destination (To Area) drives everything.

---

## 3. Export layout (new .xlsx)

Recreates the sample, top to bottom:

1. Title row: "TRAVEL REQUEST (MYANMAR PAYROLL AND OUTSOURCING CO. LTD)"
2. Header line: Month (left), Submission date (right)
3. Column headers (Team … Remark)
4. For each trip: **outbound leg row**, **return leg row**, then a **yellow subtotal row**
5. **Orange Grand Total row**
6. Signature block: employee image + Name / Position / Duty Station / Team / Date; two blank
   approver blocks (HR Company (P&O), Team Lead (WHO-EPI))

Styling to match: yellow fill on subtotal rows, orange fill on the grand-total row, bordered
table, the identity/manual columns tinted as in the sample.

---

## 4. Submit gating (the core purpose)

- Submit is disabled until **all required fields** (§1a + the required per-leg fields in §1b + the
  employee signature) are valid.
- Inline, friendly errors appear next to each missing/invalid field — never a single vague
  "missing data" message.
- At least one complete trip (two legs) is required.

---

## 5. Assumptions to confirm

1. The fresh Excel stores **computed values** (static numbers), not live formulas. Say if you'd
   rather it carry working formulas so reviewers can tweak inputs.
2. Trip-leg **From/To Area, No of days, Deductions, Date, Mode, Purpose** are treated as required
   (needed to compute per-diem); Air Ticket, Terminal Allowance, Townships, IPO, Remark are
   optional. Adjust if any of these should flip.
3. Only the **employee** signs in phase 1; the two approver blocks stay blank for a later step.
4. "No of days" is entered by the user (not auto-derived from dates) in phase 1, for simplicity.
