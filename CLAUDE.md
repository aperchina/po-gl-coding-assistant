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
- **JS constants** (lines 458–660):
  - `MODEL` — Claude model used for all AI calls (`claude-haiku-4-5-20251001`)
  - `HST = 0.13` — Canadian HST rate
  - `PROPS` — property registry (keys: `772queen`, `1133yonge`, `college`, `eglinton`, `901college`). Each entry has `label`, `legal`, `address`, `type` (`residential`/`commercial`/`mixed`/`mixed3`), square footage, and an `allocs` array of named allocation schedules
  - `GL` — full Yardi GL code list with `code`, `name`, `cat`, `hst` treatment (`resi`/`comm`/`exempt`/`mixed`), `uses` description, and optional `flag`
- **JS functions** (lines 663–1340):
  - `scanInvoice()` — sends base64 file to Claude; parses JSON response into form fields; sets `invoiceServiceUnit` / `invoiceUnitPool` globals; auto-triggers `suggestGL()`
  - `suggestGL()` — sends description + property context to Claude; keyword-matches description for warning flags before rendering results
  - `getActiveSplit()` — single source of truth for resi/comm/condo split percentages; used by both `calcAlloc()` and `buildPO()`
  - `calcAlloc()` — recalculates the allocation table whenever amount, property, alloc schedule, HST toggle, or manual split changes
  - `buildPO()` — renders the printable PO preview from current form state
  - `callClaude(body)` — thin fetch wrapper to `/api/claude`

### `api/claude.js` — Vercel serverless proxy
Accepts POST, transforms any `{type:"image", media_type:"application/pdf"}` blocks into `{type:"document"}` (Anthropic's native PDF format), then proxies the request to `https://api.anthropic.com/v1/messages` with the `pdfs-2024-09-25` beta header. No other processing.

## Key domain rules encoded in the app

**Property types and HST:**
- `residential`: HST is a cost — post gross amount, no ITC
- `commercial` (1133 Yonge): HST fully recoverable as ITC — post net
- `mixed` (772 Queen, Eglinton): split by sq footage; resi portion = gross, comm portion = net + ITC
- `mixed3` (College St): three-way split — resi / comm / condo; each has named allocation schedules (equalSplit, resiWeighted, hvac, parking, hallway, amenityInternet, propertyTax)

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

**Warning flags in GL panel:**
Client-side regex on description triggers amber banners before showing GL codes:
- After Service / Post-Construction: `deficien|warranty|commissioning|new construction|builder|tarion|...`
- Building Improvement / Capital: `replace entire|new installation|full replacement|upgrade|new boiler|...`

**PO print:**
Print button calls `window.print()`. CSS hides everything except `#po-card`. The `no-print` class suppresses elements in print view. `print-color-adjust:exact` preserves the dark header background.

**History:**
Saved POs are stored in `localStorage` under key `rcpo-hist` as a JSON array. Max 50 entries, newest first.

## Adding a new property

1. Add an entry to `PROPS` in `index.html` with `label`, `legal`, `address`, `type`, square footage fields, and an `allocs` array
2. Add the property's `<option>` to `#f-prop` in the HTML
3. Add detection rules to the scan prompt's PRIORITY ORDER section in `scanInvoice()` — assign a new key string and add it to the `if(pid==='...')` blocks in `getActiveSplit()` and `calcAlloc()` if the split logic differs from standard mixed
