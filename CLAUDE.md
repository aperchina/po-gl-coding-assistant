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
  - `RESI_TO_COMM` — maps every residential 7000-series GL code to its commercial 6100/6200/6300/6500 equivalent; used by both `buildPO()` and `calcAlloc()` to show per-pool GL codes on split invoices. All 7000-3xxx and 7000-4xxx codes are covered; codes without a specific commercial equivalent (7000-3100 Building Signage, 7000-3110 In-Suite Misc, 7000-3120 Amenity Expenses, 7000-3125 Appliance Repairs, 7000-3200 Misc., 7000-3300 Unit Turn Over, 7000-3400 Admin Service) map to `6100-3200` (Comm R&M – Misc. Repairs). Notable SC mappings: `7000-4000` Other → `6200-9000`; `7000-4010` General Maintenance → `6200-3300`; `7000-4015` Generator Maintenance → `6200-3400`
  - `COMM_TO_RESI` — reverse map derived from `RESI_TO_COMM` at startup (`Object.fromEntries(...)`); used by `buildPO()` and the GL series enforcement block to reverse-map comm codes back to their resi equivalents. Note: `calcAlloc()` uses `Object.entries(RESI_TO_COMM).find()` for the resi branch reverse lookup (not this map directly)
  - `glByCode(code)` — looks up a GL entry from `GL` by code string
- **JS functions** (lines 680–1380):
  - `scanInvoice()` — sends base64 file to Claude; parses JSON response into form fields; sets `invoiceServiceUnit` / `invoiceUnitPool` globals; auto-selects `parking` allocation at College St when description contains garage door keywords; auto-selects `amenityBBQ` allocation at College St when description/notes contain BBQ/rooftop/amenity keywords; auto-triggers `suggestGL()`. Scan prompt contains an explicit `BUILDING ADDRESSES ARE NEVER SERVICE UNITS` block listing all known building addresses (College St street numbers, Queen/Yonge/Eglinton/901 College) so the model never sets them as `serviceUnit`.
  - `suggestGL()` — sends description + property context + notes field (`LOCATION/NOTES`) to Claude; GL panel renders with canonical names from `glByCode()` (never from the model's JSON); after setting `selCode`, runs GL series consistency enforcement (auto-swaps comm→resi or resi→comm based on active pool, updating chip + name div); keyword-matches description for warning flags; shows comm-code mismatch banner if pool has resi component; calls `calcAlloc()` last
  - `getActiveSplit()` — single source of truth for resi/comm/condo split percentages; used by both `calcAlloc()` and `buildPO()`. Priority order: (1) Pool Override dropdown (`f-pool-override`), (2) 772 Queen floor-based detection (desc+notes), (3) commercial tenant equipment keywords (desc+notes, independent of serviceUnit), (4) unit-specific invoice condo/resi branch, (5) Eglinton unit-number detection, (6) Eglinton address-based detection from description field only, (7) dropdown/manual split
  - `calcAlloc()` — recalculates the allocation table whenever amount, property, alloc schedule, HST toggle, manual split, or notes field changes; reads `activeCodeForTable` (hoisted outside `.map()`) to fill the GL Code column per pool; three separate branches: comm (resi→`RESI_TO_COMM`, fallback `'—'`), condo (resi→`RESI_TO_COMM`, fallback `activeCode`), resi (comm→`Object.entries(RESI_TO_COMM).find()` reverse scan, fallback `activeCode`); overrides split to 100% commercial when `1850-1000` or `1700-1300` is selected
  - `pickGL(code, name, el)` — called when user clicks a GL suggestion row; resolves `selName` via `glByCode()` (canonical, never from the onclick attribute string); sets `selCode` and calls `calcAlloc()` to refresh the GL code column
  - `buildPO()` — renders the printable PO preview from current form state; bidirectional pool-code assignment (comm pool: uses comm code directly or maps resi→comm; resi/condo pools: uses resi code directly or reverse-maps comm→resi via `COMM_TO_RESI`); overrides split to 100% commercial when `1850-1000` or `1700-1300` is selected
  - `clearAll()` — resets every panel in one call: `clearInvoice()`, all form inputs, pool-override dropdown, alloc/GL/PO panel visibility, `selCode`/`selName` globals, and scan status. Called by the header "✕ Clear All" button, the invoice card "✕ Clear All" button, and the PO form "Clear All" button.
  - `callClaude(body)` — thin fetch wrapper to `/api/claude`

### `api/claude.js` — Vercel serverless proxy
Accepts POST, transforms any `{type:"image", media_type:"application/pdf"}` blocks into `{type:"document"}` (Anthropic's native PDF format), then proxies the request to `https://api.anthropic.com/v1/messages` with the `pdfs-2024-09-25` beta header. No other processing.

## Key domain rules encoded in the app

**Property types and HST:**
- `residential`: HST is a cost — post gross amount, no ITC
- `commercial` (1133 Yonge): HST fully recoverable as ITC — post net
- `mixed` (772 Queen, Eglinton): split by sq footage; resi portion = gross, comm portion = net + ITC
- `mixed3` (College St): three-way split — resi / comm / condo; each has named allocation schedules (equalSplit, resiWeighted, hvac, parking, hallway, amenityBBQ, amenityInternet, propertyTax)

**772 Queen St E — allocation rule:**
This property has a `tenants` array (`Dollarama`, `BMO`, `LCBO`) and `autoSplitCodes` flag. Pool detection priority for this property:
1. **Floor-based signal** (desc + notes) — `2nd floor`, `second floor`, `3rd floor`, `floor 2/3/4`, `upper floor` → 100% residential; `ground floor`, `1st floor`, `first floor`, `main floor`, `storefront`, `dollarama`, `bmo`, `lcbo`, `retail unit`, `commercial unit` → 100% commercial
2. **Unit/suite repair** — always 100% residential unless explicitly a named commercial tenant space
3. **Fire/backflow building-wide** (no floor signal) — auto split 34.54% resi / 65.46% comm
4. **All other building-wide work with no floor signal** — manual split; user specifies resi/comm %

**Condo pool HST (College St):**
Condo is NOT treated like residential. Condo costs are recovered through condo fees, so HST is ITC recoverable — same treatment as commercial: post net amount, HST shows as "+ ITC" in green. In `calcAlloc()` the condo pool uses `hstType:'condo'`, which falls into the ITC branch (not the resi/inclusive-cost branch).

**HST in/out toggle (`f-hst-in`):**
- `yes` — invoice total is gross (HST already included); back-calculate net
- `no` — invoice total is net; add 13% HST on top
- `exempt` — no HST at all (property tax, insurance, interest)

**Unit-specific invoices:**
- `invoiceServiceUnit` (global) holds the unit/suite from the scan
- `invoiceUnitPool` is `'condo'` (College St 600–699 series) or `'resi'` otherwise
- When set, `getActiveSplit()` enters the unit-specific block, but checks commercial tenant equipment keywords first before defaulting to the unit's pool (see below)
- Building addresses (`871-899 College`, `772 Queen`, `1133 Yonge`, `1924/1928 Eglinton`, `901 College`) are explicitly excluded from `serviceUnit` in the scan prompt — a street address range like `871-899` is never a unit number

**Commercial tenant equipment override:**
In `getActiveSplit()`, freezer/refrigeration/temperature sensor keywords are checked **outside and before** the `invoiceServiceUnit` block — so the override fires even when no service unit is detected (e.g. when the scan correctly leaves `serviceUnit` null for a building-address invoice). Returns 100% commercial, HST ITC recoverable. Keywords: `freezer`, `refriger`, `temp.*sensor`, `sensor.*temp`, `walk.?in`, `cold room`, `cooler alarm`, `freezer alarm`, `temperature sensor`, `freezer sensor`, `freezer probe`, `temp probe`. The reasoning note tells the user to verify landlord vs tenant responsibility before posting.

**GL code series convention:**
- `7000-3xxx` = residential R&M
- `7000-4xxx` = residential service contracts
- `6100-xxxx` = commercial R&M
- `6200-xxxx` = commercial service contracts
- `6300-xxxx` = commercial utilities
- `6500-xxxx` = commercial property tax
- `1700-1300` = Buildings – Improvements (capital items for stabilized properties) — requires Controller approval
- `1850-1000` = After Service Post-Construction (balance sheet — post-construction holdbacks for Eglinton stabilization phase only) — requires manager approval

**Per-pool GL codes on split invoices:**
When an invoice is split across pools, each pool gets its own GL code. Condo is treated like commercial (ITC recovery), not like residential:
- Comm pool: comm (6xxx) code → use directly; resi code → `RESI_TO_COMM[selectedCode]` or `'—'` if unmapped
- Condo pool: comm (6xxx) code → use directly; resi code → `RESI_TO_COMM[selectedCode]` or `activeCode` as fallback (never `'—'`); label shows `(Condo — ITC)` in `buildPO()`
- Resi pool: resi (7000) code → use directly; comm code → `Object.entries(RESI_TO_COMM).find()` reverse scan, fallback `activeCode`

This means the user can select either a resi or comm code from the GL panel and all three pools will display the correct series. The GL code column in `calcAlloc()` is populated by `suggestGL()` calling `calcAlloc()` after it resolves, and by `pickGL()` doing the same.

**Garage door / parking allocation at College St:**
Any work involving garage doors, overhead doors, door operators, garage motors, or parking level doors must use the `parking` allocation schedule (condo 64.29% / resi 31.72% / comm 3.99%) — regardless of whether the vendor labels it "commercial service call". The physical asset determines the schedule, not the vendor billing type. Keywords that trigger auto-selection on scan: `garage door|overhead door|parking door|garage motor|door operator|tnr door|hormann door|parking level`. GL codes: resi/condo → `7000-3085`, comm → `6100-2600`.

**College St amenity / BBQ / rooftop allocation:**
BBQ cleaning, rooftop terrace, amenity room, gym, party room, and amenity space maintenance use the `amenityBBQ` allocation schedule: **condo 20% / resi 80% / comm 0%**. Commercial tenants at College St have no access to residential/condo amenity spaces — the commercial pool is never included. GL code: `7000-3120` (Resi R&M – Amenity Expenses) for the resi pool; condo pool maps to `6100-3200` via `RESI_TO_COMM`. This rule is enforced via a MANDATORY CRITICAL note in the GL suggestion prompt's WORK TYPE HINTS section and as a named allocation schedule in `PROPS`. `scanInvoice()` also auto-selects the `amenityBBQ` schedule when these keywords appear in description or notes at College St (same success path as the parking auto-select).

Keywords that trigger auto-select and rule enforcement: `barbeque`, `barbecue`, `bbq`, `amenity bbq`, `rooftop amenity`, `amenity room`, `amenity terrace`, `rooftop terrace`, `bbq cleaning`, `barbeque cleaning`.

**Waste / debris removal GL mapping:**
Keywords "debris removal", "debris disposal", "waste removal", "garbage removal", "junk removal", "disposal of debris", "haul away", "clean out", "cleanout", "dump run", "bin rental", "dumpster", "skip bin", "rubbish removal", "trash removal" map to:
- One-off: `7000-2045` resi / `6300-4000` comm
- Recurring contract: `7000-4050` resi SC / `6200-2500` comm SC

Do NOT use `7000-3110` (In-Suite Misc) or `7000-3130` (Extra Janitorial) for disposal/hauling — those are only for actual cleaning services (mopping, sweeping). This distinction is enforced via an explicit CRITICAL note in the GL suggestion prompt's WORK TYPE HINTS section.

**Graffiti / vandalism GL mapping:**
Graffiti is always an exterior building surface issue. Keywords "graffiti", "graffiti removal", "remove graffiti", "paint over graffiti", "vandalism repair", "graffiti cleanup", "remove spray paint", "spray paint on wall" map to Exterior/Roof codes: `7000-3050` resi / `6100-2200` comm. Never `7000-3110` (In-Suite Misc). The prompt includes a MANDATORY OVERRIDE so the model cannot return any other code when a graffiti keyword is present.

**Install / new installation / re-re → capital code (property-dependent):**
When the description contains "install", "new installation", "we install", "installed", "re/re" (remove and replace), "flash install", "flashing install", or "metal flashing" + "install", the primary suggestion must be a capital code with a manager/Controller approval flag. Which capital code depends on the property:
- **1924 Eglinton Ave W** (in post-construction stabilization phase) → `1850-1000` (After Service Post-Construction / Balance Sheet)
- **All other stabilized properties** (772 Queen, 1133 Yonge, College St, 901 College) → `1700-1300` (Buildings – Improvements)

The R&M exterior code (`7000-3050` / `6100-2200`) is always offered as a secondary suggestion for cases where the Controller determines it is a repair rather than a capital item.

**Capital code (1850-1000 / 1700-1300) 100% commercial override:**
When `1850-1000` or `1700-1300` is the selected GL code, both `calcAlloc()` and `buildPO()` override the split to **100% commercial** regardless of property type — capital items are posted to the commercial pool to recover the full HST as ITC. This override is applied immediately after `getActiveSplit()` returns. The GL Code column in `calcAlloc()` reads `activeCodeForTable` (hoisted before `.map()`) so these codes render correctly in the comm pool row instead of falling through to `RESI_TO_COMM` and showing a dash.

**Eglinton (1924 Eglinton Ave W) — address-based pool detection:**
This property has two sides with distinct pool rules. `getActiveSplit()` checks the **description field only** (not notes — the Yardi comment always contains the property address and would cause false positives) in this priority order:
1. **Residential unit numbers** (highest priority, overrides address) — regex matches `702`, `703`, `702/703`, `Unit 702`, `suite 401` etc. → 100% residential. The KFC commercial space has no suite/unit numbers, so any unit number in the description is always a residential signal.
2. `7 fairbank` or `fairbank` → 100% residential, HST inclusive
3. `1924 eglinton`, `1928 eglinton`, or `kfc` → 100% commercial, HST ITC
4. No signal → standard 80/20 building-wide split

"7 Fairbank" or "7 Fairbank Ave" alone is a **building address, not a unit number** — `serviceUnit` stays null unless a unit number precedes it (e.g. "701-7 Fairbank" = Unit 701). The `f-notes` input has `oninput="calcAlloc()"` so the allocation table updates live as the user edits the notes field. The same rules (including the unit-number override) are encoded in the GL suggestion prompt under PROPERTY ALLOCATIONS and in the scan prompt's SERVICE UNIT section.

**PO total always equals the invoice total:**
`buildPO()` uses a two-pass approach: first compute all pool amounts with `lineTotal = poolNet + poolHst` (gross) for every pool including comm and condo, then apply a rounding correction to the largest pool so the sum of all line totals equals the entered invoice total exactly. Comm and condo rows show a "GL post: $X.XX net + ITC" sub-note under the total so the posting instruction is clear. Prior to this fix the PO total was understated because comm/condo rows used `lineTotal = poolNet` (net only).

**Canonical GL name enforcement:**
`suggestGL()` always calls `glByCode(s.code)` to resolve the display name before rendering each suggestion card — the model's `name` string in the JSON response is never used for display. `pickGL()` does the same canonical lookup when a card is clicked. The GL series consistency enforcement block (auto-swap) also updates `.gl-line.sel .gl-name` alongside `.gl-line.sel .gl-chip` so the card header stays in sync after a code swap.

**Commercial tenant equipment GL mapping:**
Keywords "freezer sensor", "temperature sensor", "refrigeration alarm", "freezer alarm", "cooler alarm", "temp sensor", "freezer calibration", "sensor calibration", "temperature calibration", "freezer probe", "temp probe", "cold room sensor", "walk-in freezer", "walk-in cooler", "refrigeration system", "freezer temperature" map to `6100-3200` (Comm R&M – Misc. Repairs), 100% commercial, HST ITC recoverable. This is enforced as a MANDATORY OVERRIDE in the GL suggestion prompt (WORK TYPE HINTS section) and as a pool override in `getActiveSplit()`. The GL suggestion reason field must include a note to verify landlord vs tenant responsibility before posting.

**EWRB / ESG / energy compliance reporting GL mapping:**
Keywords "EWRB", "energy and water reporting", "benchmarking", "energy audit", "ESG submission", "ESG reporting", "environmental reporting", "net zero reporting", "carbon reporting", "greenhouse gas", "GHG reporting", "energy benchmarking", "water benchmarking", "historical data reporting", "Better Buildings", "energy disclosure", "Zenith Net Zero", "net-zero reporting" are regulatory/compliance invoices — no dedicated GL code exists yet:
- Resi and condo pools: `7000-3400` (Residential – Admin Service) — temporary home
- Comm pool: `6100-3200` (Comm R&M – Misc. Repairs) — temporary home
- Allocation: `resiWeighted` — whole-building regulatory obligation spanning all pools
- HST: comm and condo → ITC recoverable (post net); resi → HST inclusive non-recoverable
- Flag: "Temporary GL home — EWRB/ESG/energy compliance costs pending dedicated compliance code. Resi/condo pool: 7000-3400 Admin Service. Comm pool: 6100-3200 Misc Repairs. Confirm with Controller."

This is enforced as a MANDATORY OVERRIDE in the GL suggestion prompt (never use `6200-3200` Fire Alarm Inspections for compliance reporting). `scanInvoice()` also auto-selects the `resiWeighted` allocation schedule when any EWRB/ESG/benchmarking keyword appears in the description or notes field.

**Wildlife / pest removal GL mapping:**
Keywords "raccoon", "raccoon removal", "wildlife removal", "animal removal", "bird removal", "squirrel removal", "rat removal", "mouse removal", "rodent removal", "pest removal", "remove raccoon/animal/bird", "nest removal", "animal in vent/fan/exhaust", "critter removal", "wildlife trap", "animal trap" map to:
- One-off emergency removal: `7000-3200` (Resi R&M – Misc.) resi / `6100-3200` (Comm R&M – Misc. Repairs) comm
- Recurring pest control contract: `7000-4080` (Resi SC – Pest Control) resi / `6200-2400` (Comm SC – Pest Control) comm

Do NOT use `6100-2600` (Garage and Parking) or `6100-1000` (AC & Ventilation) for wildlife/pest work — the vent or fan is merely the location, not the work type. This is enforced as a MANDATORY OVERRIDE in the GL suggestion prompt. If the work is in a commercial tenant space, the reason field must flag for CAM recovery at year-end reconciliation.

**Pool Override dropdown (`f-pool-override`):**
A dropdown in the PO form lets the user manually override the auto-detected pool allocation. Options: `auto` (default), `100% Residential`, `100% Commercial`, `100% Condo`. When set to anything other than `auto`, `getActiveSplit()` returns immediately with the chosen pool — this runs before all other detection logic (unit-specific, Eglinton address, alloc schedule). `clearForm()` resets it to `auto`.

**GL series consistency enforcement:**
After `suggestGL()` receives the model's response and sets `selCode`, a consistency check runs before warning flags:
- If the active pool is **100% residential** and `selCode` is a comm code (`6100`/`6200`-series) → automatically reverse-maps via `COMM_TO_RESI` and replaces `selCode`, `selName`, the hidden inputs, and the selected chip in the GL panel. Prepends `[Auto-corrected to resi code: ...]` to the reasoning note.
- If the active pool is **100% commercial** and `selCode` is a resi code (`7000-3xxx`/`7000-4xxx`) → forward-maps via `RESI_TO_COMM` and applies the same swap.
- Additionally, if the primary suggestion is any comm (6xxx) code but the property has `resi > 0`, an amber **"Code mismatch"** banner is prepended to the warning panel so the user is aware even on split properties where no auto-swap occurs.

**Warning flags in GL panel:**
Client-side regex on description (+ vendor name) triggers amber banners at the top of the GL suggestion panel (above codes, non-blocking):
- After Service / Post-Construction: `deficien|warranty|warrant(y|ies)|commission(ing|ed)|new construction|builder|tarion|touch.?up after|post.?construct|handover|hand.over`
- Building Improvement / Capital: `replace entire|new installation|full replacement|full.?replace|upgrade|new boiler|new elevator|new roof|new windows|new entry system|new hvac|new h\.?v\.?a\.?c|capital|major renovation|gut renovation`

**PO print:**
Print button calls `window.print()`. CSS hides everything except `#po-card`. The `no-print` class suppresses elements in print view. `print-color-adjust:exact` preserves the dark header background.

**History:**
Saved POs are stored in `localStorage` under key `rcpo-hist` as a JSON array. Max 60 entries, newest first.

## Adding a new property

1. Add an entry to `PROPS` in `index.html` with `label`, `legal`, `address`, `type`, square footage fields, and an `allocs` array
2. Add the property's `<option>` to `#f-prop` in the HTML
3. Add detection rules to the scan prompt's PRIORITY ORDER section in `scanInvoice()` — assign a new key string and add it to the `if(pid==='...')` blocks in `getActiveSplit()` and `calcAlloc()` if the split logic differs from standard mixed
