# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app does

PO GL Coding Assistant for Roxborough Communities — a single-page web tool that helps property managers:
1. **Scan invoices** (PDF/image) using Claude's native document type to auto-extract vendor, amount, property, and work description
2. **Suggest Yardi GL codes** with correct HST treatment and allocation schedules for each property
3. **Generate a Purchase Order** (printable) with per-pool cost allocation breakdowns

## How to run locally

Open `index.html` directly in a browser — no build step. For the Claude API proxy to work (invoice scan + GL suggestion), you need Vercel:

```bash
npm i -g vercel
vercel dev        # serves index.html + api/claude.js on http://localhost:3000
```

The serverless function requires `ANTHROPIC_API_KEY` set as a Vercel environment variable (or in a local `.env` for `vercel dev`). `config.js` is gitignored and is not used by the Vercel function — it was a legacy local-only key holder.

## Deployment

```bash
vercel --prod
```

Set `ANTHROPIC_API_KEY` in the Vercel project environment variables dashboard.

## Architecture

Everything lives in two files:

### `index.html` — the entire frontend
One large file containing HTML, CSS, and JavaScript. No framework, no bundler. Key sections in order:

- **CSS** (lines 7–455): CSS custom properties (`--gold`, `--navy`, etc.), layout, component styles, print-only rules (`@media print`)
- **HTML** (lines 456–657): Four card sections — Invoice Scan, Invoice Details form, GL Suggestion panel, Cost Allocation table — plus a PO preview and history/reference panels
- **JS constants** (lines 458–680):
  - `MODEL` — Claude model used for all AI calls (`claude-haiku-4-5-20251001`)
  - `HST = 0.13` — Canadian HST rate
  - `PROPS` — property registry (keys: `772queen`, `1133yonge`, `college`, `eglinton`, `901college`). Each entry has `label`, `legal`, `address`, `type` (`residential`/`commercial`/`mixed`/`mixed3`), square footage, and an `allocs` array of named allocation schedules
  - `GL` — full Yardi GL code list with `code`, `name`, `cat`, `hst` treatment (`resi`/`comm`/`exempt`/`mixed`), `uses` description, and optional `flag`
  - `RESI_TO_COMM` — maps every residential 7000-series GL code to its commercial 6100/6200/6300/6500 equivalent; used by both `buildPO()` and `calcAlloc()` to show per-pool GL codes on split invoices
  - `glByCode(code)` — looks up a GL entry from `GL` by code string
- **JS functions** (lines 680–1380):
  - `scanInvoice()` — sends base64 file to Claude; parses JSON response into form fields; sets `invoiceServiceUnit` / `invoiceUnitPool` globals; auto-selects `parking` allocation at College St when description contains garage door keywords; auto-triggers `suggestGL()`
  - `suggestGL()` — sends description + property context to Claude; keyword-matches description for warning flags before rendering results; calls `calcAlloc()` after setting `selCode` so the GL code column in the allocation table is populated
  - `getActiveSplit()` — single source of truth for resi/comm/condo split percentages; used by both `calcAlloc()` and `buildPO()`
  - `calcAlloc()` — recalculates the allocation table whenever amount, property, alloc schedule, HST toggle, or manual split changes; reads `selCode` (or `sel-code` input as fallback) to fill the GL Code column per pool
  - `pickGL(code, name, el)` — called when user clicks a GL suggestion row; sets `selCode` and calls `calcAlloc()` to refresh the GL code column
  - `buildPO()` — renders the printable PO preview from current form state; uses `RESI_TO_COMM` to assign pool-specific GL codes per line item
  - `callClaude(body)` — thin fetch wrapper to `/api/claude`

### `api/claude.js` — Vercel serverless proxy
Accepts POST, transforms any `{type:"image", media_type:"application/pdf"}` blocks into `{type:"document"}` (Anthropic's native PDF format), then proxies the request to `https://api.anthropic.com/v1/messages` with the `pdfs-2024-09-25` beta header. No other processing.

## Key domain rules encoded in the app

**Property types and HST:**
- `residential`: HST is a cost — post gross amount, no ITC
- `commercial` (1133 Yonge): HST fully recoverable as ITC — post net
- `mixed` (772 Queen, Eglinton): split by sq footage; resi portion = gross, comm portion = net + ITC
- `mixed3` (College St): three-way split — resi / comm / condo; each has named allocation schedules (equalSplit, resiWeighted, hvac, parking, hallway, amenityInternet, propertyTax)

**Condo pool HST (College St):**
Condo is NOT treated like residential. Condo costs are recovered through condo fees, so HST is ITC recoverable — same treatment as commercial: post net amount, HST shows as "+ ITC" in green. In `calcAlloc()` the condo pool uses `hstType:'condo'`, which falls into the ITC branch (not the resi/inclusive-cost branch).

**HST in/out toggle (`f-hst-in`):**
- `yes` — invoice total is gross (HST already included); back-calculate net
- `no` — invoice total is net; add 13% HST on top
- `exempt` — no HST at all (property tax, insurance, interest)

**Unit-specific invoices:**
- `invoiceServiceUnit` (global) holds the unit/suite from the scan
- `invoiceUnitPool` is `'condo'` (College St 600–699 series) or `'resi'` otherwise
- When set, `getActiveSplit()` returns 100% to that pool — building-wide splits are bypassed

**GL code series convention:**
- `7000-3xxx` = residential R&M
- `7000-4xxx` = residential service contracts
- `6100-xxxx` = commercial R&M
- `6200-xxxx` = commercial service contracts
- `6300-xxxx` = commercial utilities
- `1850-1000` = balance sheet (post-construction holdbacks) — requires manager approval

**Per-pool GL codes on split invoices:**
When an invoice is split across pools, each pool gets its own GL code — not the same code for all lines. `RESI_TO_COMM` maps the selected resi code to its comm equivalent. In both `buildPO()` line items and the `calcAlloc()` GL Code column:
- Resi pool → selected code (7000-series)
- Condo pool → selected code + "(Condo)" label
- Comm pool → `RESI_TO_COMM[selectedCode]`

The GL code column in `calcAlloc()` is populated by `suggestGL()` calling `calcAlloc()` after it resolves, and by `pickGL()` doing the same. Without this re-call the column shows dashes because `calcAlloc()` fires first (via `amtChanged()`) before `selCode` is set.

**Garage door / parking allocation at College St:**
Any work involving garage doors, overhead doors, door operators, garage motors, or parking level doors must use the `parking` allocation schedule (condo 64.29% / resi 31.72% / comm 3.99%) — regardless of whether the vendor labels it "commercial service call". The physical asset determines the schedule, not the vendor billing type. Keywords that trigger auto-selection on scan: `garage door|overhead door|parking door|garage motor|door operator|tnr door|hormann door|parking level`. GL codes: resi/condo → `7000-3085`, comm → `6100-2600`.

**Waste / debris removal GL mapping:**
Keywords "debris removal", "debris disposal", "waste removal", "garbage removal", "junk removal", "disposal of debris", "haul away", "clean out" map to:
- One-off: `7000-2045` resi / `6300-4000` comm
- Recurring contract: `7000-4050` resi SC / `6200-2500` comm SC

Do NOT use `7000-3110` (In-Suite Misc) or `7000-3130` (Extra Janitorial) for disposal/hauling — those are only for actual cleaning services (mopping, sweeping). This distinction is enforced via an explicit CRITICAL note in the GL suggestion prompt's WORK TYPE HINTS section.

**Graffiti / vandalism GL mapping:**
Graffiti is always an exterior building surface issue. Keywords "graffiti", "graffiti removal", "remove graffiti", "paint over graffiti", "vandalism repair" map to Exterior/Roof codes: `7000-3050` resi / `6100-2200` comm. Never `7000-3110` (In-Suite Misc).

**"7 Fairbank" is a building address, not a unit:**
At 1924 Eglinton Ave W, "7 Fairbank" or "7 Fairbank Ave" alone is the building address — `serviceUnit` must be null and the standard 80/20 building-wide split applies. Only treat it as unit-specific when a unit/suite/apt number precedes it (e.g. "701-7 Fairbank Ave" = Unit 701). This rule is enforced in the scan prompt's SERVICE UNIT section.

**PO total always equals the invoice total:**
`buildPO()` uses a two-pass approach: first compute all pool amounts with `lineTotal = poolNet + poolHst` (gross) for every pool including comm and condo, then apply a rounding correction to the largest pool so the sum of all line totals equals the entered invoice total exactly. Comm and condo rows show a "GL post: $X.XX net + ITC" sub-note under the total so the posting instruction is clear. Prior to this fix the PO total was understated because comm/condo rows used `lineTotal = poolNet` (net only).

**Warning flags in GL panel:**
Client-side regex on description triggers amber banners at the top of the GL suggestion panel (above codes, non-blocking):
- After Service / Post-Construction: `deficien|warranty|commissioning|new construction|builder|tarion|touch.?up after|post.?construct|handover`
- Building Improvement / Capital: `replace entire|new installation|full replacement|upgrade|new boiler|new elevator|new roof|new windows|new entry system|new hvac|capital|major renovation|gut renovation`

**PO print:**
Print button calls `window.print()`. CSS hides everything except `#po-card`. The `no-print` class suppresses elements in print view. `print-color-adjust:exact` preserves the dark header background.

**History:**
Saved POs are stored in `localStorage` under key `rcpo-hist` as a JSON array. Max 50 entries, newest first.

## Adding a new property

1. Add an entry to `PROPS` in `index.html` with `label`, `legal`, `address`, `type`, square footage fields, and an `allocs` array
2. Add the property's `<option>` to `#f-prop` in the HTML
3. Add detection rules to the scan prompt's PRIORITY ORDER section in `scanInvoice()` — assign a new key string and add it to the `if(pid==='...')` blocks in `getActiveSplit()` and `calcAlloc()` if the split logic differs from standard mixed
