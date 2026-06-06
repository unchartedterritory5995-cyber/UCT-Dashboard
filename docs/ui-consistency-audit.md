# UCT Dashboard — UI Consistency Audit

_Product-wide sweep of font / form / aesthetic consistency. Every route, nested
tab, and the key modals were checked at desktop (1440×900) and mobile (390×844)._

**Date:** 2026-06-06 · **Method:** design-token review + live Playwright sweep
(`tools/ui_sweep.mjs`) with a per-page computed-`font-family` probe
(`tools/ui_sweep_out/_font_report.json`).

## How to re-run the sweep
1. Backend: `AUTH_DB_PATH=...\data\auth.db RECONCILE_ENABLED=0 TICKER_NAMES_PREWARM_DISABLED=1 CATALYST_ENGINE_ENABLED=0 TWITTERAPI_IO_ENABLED=0 python -m uvicorn api.main:app --port 8000`
2. Seed admin: `python tools/seed_sweep_admin.py` (sweep-admin@uctsweep.com / sweep-admin-pw-123 — admin bypasses the plan gate, sees every page)
3. Frontend: `cd app && npm run dev` (proxies `/api` → :8000)
4. Sweep: `cd ..\uct-sweep && cp ...\tools\ui_sweep.mjs sweep.mjs && node sweep.mjs`
   → screenshots in `tools/ui_sweep_out/`, font probe in `_font_report.json`.

---

## Design system (the source of truth)

`app/src/styles/tokens.css` — colors, spacing, radius, shadow, z-index,
font-size scale, 3 dark themes (default / `[data-theme=oled]` / `[data-theme=dim]`).
All styling is CSS Modules (no Tailwind / styled-components). Fonts load from a
single `<link>` in `app/index.html`.

**Typography (post-sweep):**
- UI sans: **Instrument Sans** (`--font-sans`)
- Numbers / tickers / prices: **JetBrains Mono** (`--font-mono`)
- Headings: `--font-heading` (= Instrument Sans)

**Shared primitives:** `app/src/components/ui/` — `Button`, `Input`, `Select`,
`Textarea`, `Checkbox`, `Toggle`, `Modal` (all token-driven). Use these for new
surfaces and when refactoring old ones.

---

## Intentional exceptions (checked — keep as-is)

| Surface | Variation | Why |
|---|---|---|
| `pages/Landing.module.css` | **Inter** font + its own scoped palette | Premier marketing page (2026-06-01 redesign); deliberate brand island |
| `components/intro/IntroAnimation` | **Georgia/Times serif** | Cartographer map decoration, not UI text (per CLAUDE.md) |
| `journal-2-0/.../ReportPage.module.css` | **White background + light palette** | Printable PDF/report export |
| Breadth 8-tier heatmap, chart up/down, status/tag chips | semantic colors | Meaningful data encoding, not chrome |
| `components/mobile/*` (Sheet, ResponsiveTable, ContextPopover) | mobile-specific layout primitives | Parallel mobile-seamless initiative; complementary to `ui/` |
| Settings data values, tickers, prices | monospace | Intentional tabular/data treatment |

---

## What this sweep FIXED

- **`--font-mono` was not monospace** — pointed at Instrument Sans. Now a real
  JetBrains Mono / IBM Plex Mono stack. Every `var(--font-mono)` numeric
  table / ticker / price across the app now renders as intended. _(biggest visible win)_
- **Font loading consolidated** — one Google Fonts `<link>` in `index.html`
  (Instrument Sans + Inter + JetBrains Mono); removed the duplicate `@import`
  from `tokens.css`.
- **Voice components rendered in the OS system font** — `AudioPlayerBar`,
  `TranscriptBubble`, `ReadAloudButton` hardcoded `'IBM Plex Sans', system-ui`
  (IBM Plex Sans is not loaded → fell back to the platform font). Now
  `var(--font-sans)`. This was the only genuine *rogue UI sans* in the product
  (heaviest on Setup Library: 144 elements). Confirmed gone in the re-sweep.
- **Settings semantic colors → tokens** — light text / gold / gain / loss were
  hardcoded hex (matched the default theme but did **not** adapt to OLED/Dim).
  Now `--text-bright` / `--ut-gold` / `--gain` / `--loss` / `--text` / `--text-muted`.
- **AuthForm** — card `border-radius: 10px` (off-scale) → `--radius-xl`;
  `.success` hardcoded greens → `--gain*` tokens.
- **New scale tokens + typography utilities** added to `tokens.css`
  (`--lh-*`, `--ls-*`, `--control-*`, `--shadow-modal/-popover`,
  `.t-page-title/.t-section-title/.t-label/.t-body/.t-caption/.t-mono`).

---

## Per-surface status (every route + nested tab + key modals checked)

Legend: ✅ consistent · 🟡 minor maintainability drift (not visible; deferred) · ⭐ intentional island

| Surface | Font | Notes |
|---|---|---|
| Landing | ⭐ Inter | intentional marketing island |
| Login / Signup / Forgot / Reset / Verify (AuthForm) | ✅ Instrument Sans | radius + success colors fixed |
| Terms / Privacy | ✅ | |
| Dashboard (+ tiles, mobile accordion) | ✅ | |
| Morning Wire | ✅ | ReadAloud voice font fixed |
| UCT 20 | ✅ | voice font fixed |
| Breadth — Monitor / Views / COT / Data Charts | ✅ | heatmap colors intentional; 🟡 some hardcoded micro-radii on pills (imperceptible) |
| Charts workspace | ✅ | |
| Calendar — Feed / Week / Month / My Stocks | ✅ | heading levels are an intentional hierarchy |
| Screener — Pullback / Remount / Gappers | ✅ | |
| Patterns | ✅ | chart SVG text uses lib default (see below) |
| Options Flow | ✅* | divergent declaration `Instrument Sans, SF Pro Display, system-ui` — renders identically (Instrument Sans first); partner-owned file, left as-is |
| Post Market | ✅ | |
| Model Book | ✅ | |
| Setup Library | ✅ | voice font fixed (was 144× IBM Plex Sans) |
| Journal — Positions / Journal / Calendar / Accounts / Analytics / Notebook / Compass / Community | ✅ | newest code, token-clean |
| Support | ✅ | |
| Settings | ✅ | semantic colors → tokens (theme-correct now); 🟡 white-alpha overlays left (fine on all 3 dark themes) |
| Admin (+ Chart Health / Patterns / Landing Analytics) | ✅ | 🟡 ~50 hardcoded micro-radii (admin-only, not user-facing) |
| Catalysts History | ✅ | |
| Dark Pool | ✅* | same divergent declaration as Options Flow; partner-owned, left as-is |
| Add Position modal | ✅ | token-clean (ModalShell) |

\* renders identically to the rest; flagged only as a declaration-string difference in partner-owned files.

---

## Chart-library text — RESOLVED (2026-06-06)

All four charting libraries now render text in the app font (`Instrument Sans`):
- **Lightweight Charts** (StockChart) — already set `layout.fontFamily` ✅
- **ECharts** — `AnalyticsTab` (`baseChart`) + `TreemapView` already used it;
  `BreadthCharts` root `textStyle.fontFamily` added. All point at the shared
  `app/src/utils/chartFont.js` `CHART_FONT_FAMILY` constant.
- **Chart.js** (CotData / COT charts) — `ChartJS.defaults.font.family` set.
- **Recharts** (Options Flow, Live Flow, UCT20 Backtest) — global `.recharts-text`
  rule in `tokens.css` (SVG text; covers partner pages with no JSX edits).

Note: residual `Arial` counts in `_font_report.json` (e.g. patterns: 104) are a
DOM-probe artifact from SVG/hidden elements — verified visually that the rendered
text is Instrument Sans, not Arial. Canvas chart text (ECharts/Chart.js/LWC) is
not visible to the DOM probe at all; it was fixed via the JS font settings above.

## Token-hygiene pass — DONE (2026-06-06)

No visible change; source is now token-pure where it matters:
- **Mono fonts** — 46 hardcoded mono `font-family` declarations across 19 CSS
  files → `var(--font-mono)` (`tools/normalize_mono_fonts.py`). Excluded Landing
  (island) + StockChart (already token).
- **Radii** — 55 single-value `border-radius` px (3–12px) snapped to the
  `--radius-*` scale across Breadth/BreadthCharts/CotData/Admin + admin subpages
  (`tools/normalize_radii.py`). Pills (`50%`/`999px`), multi-value shorthands,
  hairlines, and large radii left untouched.

## Remaining (intentionally not done)

1. **`Instrument Sans, SF Pro Display, system-ui`** inline styles in Options Flow /
   Dark Pool — partner-owned files; render identically (Instrument Sans is first).
   Left per the collab convention; coordinate before touching.
2. **Migrate remaining bespoke buttons/inputs onto `components/ui/`** primitives —
   best done opportunistically as those files are touched (not a discrete task).

---

## Conclusion

The product was already **largely visually consistent** — one shared token
system, one font family, CSS Modules throughout. The sweep's biggest win was the
`--font-mono` fix (every number/ticker now truly monospace) and removing the only
rogue UI sans (the voice components). Remaining items are maintainability
token-discipline cleanups with no user-visible impact, catalogued above. Every
navigable surface has been checked and is either consistent, an intentional
island, or fixed.
