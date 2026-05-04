# Font Unification — Instrument Sans Everywhere

**Date:** 2026-05-03  
**Status:** Approved

## Goal

Replace every font across the UCT dashboard with Instrument Sans, making every surface — body text, data tables, section headers, charts, canvas overlays, and brand elements — use a single unified typeface. The visual hierarchy currently expressed through font variety (Cinzel for headers, IBM Plex Mono for data) will instead be expressed through weight, size, color, and letter-spacing within Instrument Sans.

## Current State

| Variable | Current Font | Weight(s) |
|----------|-------------|-----------|
| `--font-sans` | Instrument Sans | 400, 500, 600, 700 |
| `--font-mono` | IBM Plex Mono | 400, 500, 600 |
| `--font-display` | Cinzel | 700, 800, 900 |
| `--font-heading` | Bebas Neue | regular |

**28 CSS module files** have 250+ hardcoded `'IBM Plex Mono'` and 28 hardcoded `'Cinzel'` strings (in addition to the CSS variable system).  
**3 JSX files** have inline `fontFamily` strings.  
**1 canvas file** (`ChartDrawingOverlay.jsx`) has `ctx.font` calls.

## Phase 1 — Token Layer (`tokens.css`)

### CSS Variables
Collapse all four font variables to Instrument Sans:
```css
--font-sans:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-display: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-heading: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
```

### Google Fonts Import
Remove IBM Plex Mono, Cinzel, Bebas Neue from the import URL. Load only Instrument Sans:
```
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
```
This saves ~40KB of font payload on every page load.

## Phase 2 — CSS Module Sweep (28 files, 280+ occurrences)

Replace every hardcoded font name with the appropriate CSS variable. All replacements are mechanical find-and-replace:

| Find | Replace |
|------|---------|
| `font-family: 'IBM Plex Mono', monospace;` | `font-family: var(--font-sans);` |
| `font-family: 'IBM Plex Mono', 'SF Mono', Consolas, monospace;` | `font-family: var(--font-sans);` |
| `font-family: 'IBM Plex Mono';` | `font-family: var(--font-sans);` |
| `font-family: 'Cinzel', serif;` | `font-family: var(--font-sans);` |
| `font-family: 'Bebas Neue', sans-serif;` | `font-family: var(--font-sans);` |
| `font-family: 'Instrument Sans', sans-serif;` | `font-family: var(--font-sans);` |

**Files to sweep:**
- `Screener.module.css` (27 occurrences)
- `journal/tabs/Portfolio.module.css` (22 occurrences)
- `journal/tabs/Playbooks.module.css` (19 occurrences)
- `CustomScan.module.css` (18 occurrences)
- `tiles/UCT20Performance.module.css` (16 occurrences)
- `journal/tabs/TradeLog.module.css` (16 occurrences)
- `tiles/UCT20Backtest.module.css` (10 occurrences)
- `journal/tabs/Analytics.module.css` (10 occurrences)
- `journal/tabs/Overview.module.css` (10 occurrences)
- `ModelBook.module.css` (9 occurrences)
- `Community.module.css` (10 occurrences)
- `TickerActions.module.css` (8 occurrences)
- `tiles/MARelationship.module.css` (5 occurrences)
- `chart/ChartToolbar.module.css` (5 occurrences)
- `tiles/NHNLModal.module.css` (4 occurrences)
- `PostMarket.module.css` (4 occurrences + 1 Cinzel)
- `tiles/EpisodicPivots.module.css` (4 occurrences)
- `chart/SymbolSearch.module.css` (3 occurrences)
- `pages/ThemeTrackerPage.module.css` (3 occurrences)
- `MoversSidebar.module.css` (3 occurrences + 1 Cinzel)
- `chart/ColorPicker.module.css` (2 occurrences)
- `OptionsFlow.module.css` (2 Cinzel)
- `DarkPool.module.css` (2 Cinzel)
- `tiles/IntradayPulse.module.css` (1 occurrence)
- `CotData.module.css` (1 occurrence)
- `TileCard.module.css` (1 Cinzel + 1 mono)
- `NavBar.module.css` (1 Cinzel + 1 Instrument Sans hardcode)
- `Traders.module.css` (1 Cinzel + 1 mono)

## Phase 3 — JSX/Inline Style Sweep

**`AuthGuard.jsx`**:
- Line 21: Replace `fontFamily: "'Cinzel', serif"` → `fontFamily: "'Instrument Sans', sans-serif"`
- Lines 10, 68: Already use Instrument Sans — no change needed

**`Analytics.jsx`** (lines 82, 103, 114, 129 — ECharts configs):
- Replace `fontFamily: 'IBM Plex Mono'` → `fontFamily: 'Instrument Sans'`

**`UCT20Backtest.jsx`** (lines 199, 204, 231, 236, 257 — Recharts tick labels):
- Replace `fontFamily: 'IBM Plex Mono'` → `fontFamily: 'Instrument Sans'`

**`Breadth.jsx`** (ECharts config — confirm location during impl):
- Any `fontFamily: 'IBM Plex Mono'` → `fontFamily: 'Instrument Sans'`

## Phase 4 — Canvas Sweep

**`ChartDrawingOverlay.jsx`** (lines 106, 122):
- `ctx.font = '10px "IBM Plex Mono", monospace'` → `ctx.font = '10px "Instrument Sans", sans-serif'`
- Also update any other `ctx.font` calls in the file using IBM Plex Mono

## Phase 5 — Header Hierarchy Repair

Sections that used Cinzel's serif character to look visually distinct need minor typography adjustments so they still read as headers with Instrument Sans:

| Location | Was (Cinzel) | Becomes (Instrument Sans) |
|----------|-------------|--------------------------|
| TileCard `.title` headers | 9px, 700, 2.5px tracking | 10px, 600, 1.5px tracking |
| Page section labels | 9–11px, 700–900 | 10–11px, 600–700, 1.5px tracking |
| `.rd-subsection-label` (Morning Wire) | auto (var) | inherits — no CSS change needed |
| MoversSidebar `.title` | Cinzel serif | Instrument Sans 700, uppercase |
| NavBar `.brand` | Cinzel 700 | Instrument Sans 700, gold color `#c9a84c` |
| OptionsFlow/DarkPool/PostMarket page headers | Cinzel | Instrument Sans 700, uppercase |

**Rule**: all header elements keep `text-transform: uppercase` and `letter-spacing` (reduced from 2.5px → 1.5px). Weight stays 600–700. Color stays as-is.

## Phase 6 — Number Alignment Fix

IBM Plex Mono is monospace — columns of numbers align automatically. Instrument Sans is proportional — `$421.50` and `$91.20` won't line up. Fix: add `font-variant-numeric: tabular-nums` to all cells displaying prices, percentages, or numeric data.

Locations to add `font-variant-numeric: tabular-nums`:
- All price, change%, and performance cells in Screener, Watchlists, UCT20, ThemeTracker
- CatalystFlow EPS/Revenue columns
- Journal trade data cells
- MorningWire pick fields (entry/stop/target)
- Admin stat numbers
- Morning Wire pills (exposure values)

## Aesthetic Improvements

After the font swap is complete, the following refinements complete the look:

1. **Brand name** — NavBar "UCT Intelligence" and auth screen logo: Instrument Sans 700 + gold `#c9a84c`. Maintains visual identity without Cinzel.

2. **Section labels** — Letter-spacing on uppercase section headers reduced from 2.5px → 1.5px. Cinzel's built-in wide proportions created natural spacing; Instrument Sans with 2.5px tracking looks slightly spaced-out.

3. **Button weight standardization** — All button text set to `font-weight: 600`. Some buttons currently use 500 (too light) or 700 (too heavy). 600 reads as the cleanest action weight in Instrument Sans.

4. **Ticker symbol treatment** — Ticker chips/labels that were IBM Plex Mono gold now use Instrument Sans 600 + `font-variant-numeric: tabular-nums`. Gold color `#c9a84c` stays.

## Files NOT Changed

- `MorningWire.module.css` — already 100% CSS variable compliant; Phase 1 token change covers it automatically
- `Breadth.module.css` — same, already 100% compliant
- `ChartDrawingOverlay.jsx` text tool (user-typed text) — canvas API requires literal font strings; Phase 4 updates them directly
- COT charts (`CotData.jsx`) — Chart.js uses browser default font; no explicit font config to change

## Verification Pass

After implementation, run a final grep across the entire `app/src/` directory for:
- `'IBM Plex Mono'` — should return 0 results
- `'Cinzel'` — should return 0 results
- `'Bebas Neue'` — should return 0 results

Any remaining hits get fixed before deploy.

## Deploy

Commit all changes, push to Railway. No backend changes required — purely frontend CSS/JSX.
