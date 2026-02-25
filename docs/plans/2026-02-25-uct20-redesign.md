# UCT 20 Page Redesign — 2026-02-25

## Problem

The current UCT Leadership 20 thesis is a single 2-3 sentence text blob covering setup type, EMA alignment, and risk level. It lacks company context, recent catalyst detail, price action narrative, and actionable entry/stop/target levels. The layout shows all 20 expanded simultaneously with no visual hierarchy.

## Goal

Transform each UCT 20 card into a full AI-driven stock analysis that covers:
1. What the company does and why it matters right now
2. The specific catalyst or news driving the move
3. Chart structure and price action details
4. Actionable entry, stop, and target levels

Layout: compact collapsed list → click to expand inline.

---

## Data Design

### New AI Output Structure (per stock)

Replace the single `thesis` string with structured JSON fields:

```json
{
  "sym": "GLW",
  "setup_type": "EP",
  "company_desc": "Corning Inc. manufactures optical fiber and specialty glass for AI datacenter interconnects...",
  "catalyst": "Beat Q4 EPS by +18% on 2/19 driven by hyperscaler fiber demand surge; management raised FY26 guidance...",
  "price_action": "Stage 2 base forming above all MAs in LEAD alignment (9>21>50). Volume dried up 60% below avg over 3 weeks then surged 2.8× on the breakout day. Stock coiling near 52W highs within 3% of all-time high...",
  "entry": "$58.40 — PDH break above consolidation high on above-avg volume",
  "stop": "$54.20 — close below 21EMA / base low",
  "target_1": "$66.00",
  "target_2": "$74.00"
}
```

### KB Context (expanded)

Current prompt uses ~1,500 chars of KB context. New prompt expands to:
- **Setup rules** (3,000 chars) — KB records matching `setup_type` (EP/VCP/HTF etc.)
- **Sector context** (1,000 chars) — sector rotation, leading sector momentum
- **Case studies** (1,500 chars) — matching CASE_STUDY KB entries by setup type
- **Trader frameworks** (2,000 chars) — relevant trader rules from the 72-trader primer
- **News context** (1,000 chars) — recent Finnhub headlines for the ticker (already fetched)
- **Earnings context** (500 chars) — beat/miss history, upcoming date

Total: ~9,000 chars per stock prompt (vs ~1,500 today). Richer, more accurate output.

---

## Frontend Design

### Collapsed State (default, all 20 visible)

```
#1  [EP]  GLW   Corning Inc.          UCT Rating 94.2  ▸
#2  [EP]  AG    First Majestic Silver  UCT Rating 96.1  ▸
...
```

- Rank · Setup badge · Ticker · Company name · UCT Rating · expand caret
- Single row per stock, tight spacing, fast to scan

### Expanded State (click to open inline)

```
#1  GLW  Corning Inc.                          UCT Rating 94.2  ▾

  Corning Inc. manufactures optical fiber and specialty glass
  for AI datacenter interconnects. AI infrastructure capex
  from hyperscalers is driving a structural multi-year demand
  surge for high-bandwidth fiber — GLW is the picks-and-shovels
  play on the AI build-out.

  CATALYST
  Beat Q4 EPS by +18% on 2/19 driven by accelerating fiber
  orders. Management raised FY26 revenue guidance by 12%.
  Stock gapped +9% on earnings day and has held the gap.

  PRICE ACTION
  Stage 2 base forming above all MAs in LEAD alignment
  (9EMA > 21EMA > 50SMA). Volume contracted 60% below avg
  over 3 weeks — Wyckoff accumulation pattern. Coiling within
  3% of 52W high. Entry trigger: PDH break above $58.40 on
  2× average daily volume.

  ──────────────────────────────────────────────────────────
  ENTRY $58.40    STOP $54.20    TARGET $66 · $74
```

---

## Architecture

### Backend: `morning_wire_engine.py`

**Function:** `AIAnalyst.generate_leadership_theses(top20)`

**Changes:**
1. New system prompt — structured JSON output with 7 fields per stock
2. Expanded KB context query (setup + sector + case studies + trader frameworks)
3. Add news headlines per ticker to user message (already in `wire_data`)
4. Output: JSON array with `company_desc`, `catalyst`, `price_action`, `entry`, `stop`, `target_1`, `target_2`, `setup_type`

**Backward compatibility:** Keep `thesis` field populated (join sections as fallback) so existing code doesn't break.

### Frontend: `app/src/pages/UCT20.jsx`

**Changes:**
1. Read new fields: `company_desc`, `catalyst`, `price_action`, `entry`, `stop`, `target_1`, `target_2`
2. `expandedIdx` state — tracks which card (if any) is open
3. Collapsed row: rank + setup badge + ticker + company + rating + caret
4. Expanded section: company_desc prose → CATALYST section → PRICE ACTION section → entry/stop/target bar
5. Fallback: if new fields absent, render legacy `thesis` field (backwards compatible)

### Frontend: `app/src/pages/UCT20.module.css`

New styles for:
- `.collapsed` row — single line, flex, compact
- `.setupBadge` — small colored tag (`[EP]`, `[VCP]`, etc.)
- `.companyName` — muted, smaller than ticker
- `.expanded` — animated open/close
- `.sectionLabel` — `CATALYST`, `PRICE ACTION` headers
- `.sectionText` — prose body
- `.tradeBar` — bottom row: ENTRY · STOP · TARGET chips

---

## Files to Modify

| File | Change |
|------|--------|
| `C:\Users\Patrick\morning-wire\morning_wire_engine.py` | New thesis prompt, structured JSON output, expanded KB context |
| `app/src/pages/UCT20.jsx` | New card layout with expand/collapse and structured sections |
| `app/src/pages/UCT20.module.css` | New styles for all new elements |

No backend API changes needed — `/api/leadership` already returns the raw leadership array as-is.

---

## Backward Compatibility

- `thesis` field kept populated as a join of `company_desc + catalyst + price_action`
- Frontend checks for `item.company_desc` before rendering new layout; falls back to `item.thesis`
- No database schema changes required
