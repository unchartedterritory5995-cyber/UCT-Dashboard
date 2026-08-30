# Mobile Charts — iOS-grade redesign (Phase 1: the chart screen)

**Date:** 2026-08-30 · **Branch:** `claude/mobile-ui-ios-redesign-1ky91n`
**Goal:** `/charts` on a phone should feel like TradingView's iOS app — a full-bleed
chart with thumb-reachable controls — instead of the desktop widget chrome crammed
into 375px. Owner's rating of the shipped experience: 3/100. This phase is the
foundation the rest of the mobile initiative builds on.

## What was wrong (measured against the shipped `MobileWorkspace`)

1. **The chart rendered with full desktop chrome.** `MobileWorkspace` mounted
   `WidgetHost → ChartWidget → ChartPane(density="full")`: identity row (company
   name + session toggles + market clock), timeframe bar with meta strip, settings
   gear — all at ~24px touch targets, all at the TOP of the screen where thumbs
   aren't. The actual candles got what was left.
2. **Every picker was a desktop control.** Timeframes: a hover-tuned dropdown.
   Symbol search: a 280px desktop portal dropdown. No bottom sheets, no 44px rows.
3. **Widget tabs consumed a row to say "Chart · Watchlist · Themes"** — navigation
   chrome a phone user pays for on every screen.
4. **Zero iOS affordances**: no safe-area awareness inside the page, no
   tap-highlight suppression, no haptics, no thumb-zone layout.

## The new shape (TradingView-mobile parity)

```
┌────────────────────────────────────┐
│ MobileNav (existing app bar, 48px) │
├────────────────────────────────────┤
│ ◉ AAPL ⌄  Apple Inc.       212.44 │  ← symbol strip: tap ANYWHERE → full-screen
│                            +1.24%  │    symbol search. Live price via SSE pool.
├────────────────────────────────────┤
│                                    │
│          FULL-BLEED CHART          │  ← ChartPane density="mini" showTfBar={false}
│        (pinch / pan native)        │    = zero pane chrome, candles only
│                                    │
├────────────────────────────────────┤
│ [ D ]  [type] [ ƒx ] [ ⋯ ]         │  ← bottom toolbar, 44px+ targets, thumb zone
├────────────────────────────────────┤
│ MobileTabBar (existing, 58px)      │
└────────────────────────────────────┘
```

Every picker is a **bottom sheet** (`components/mobile/Sheet`), every commit fires
`haptics.tap()`:

- **Symbol** (tap the strip) → full-screen sheet: auto-focused search (16px font so
  iOS never zooms), Recents (localStorage `uct.charts.mobileRecents`, cap 12),
  Popular, live `/api/ticker-search` results at 52px rows with logos, "Go to X"
  fallback row.
- **Timeframe** → bottom sheet grid: the 8 native TFs + the user's custom TFs from
  chart settings. Active = gold.
- **Chart type** → bottom sheet: Candles / Hollow / Bars / Line / Area with drawn
  SVG glyphs (writes `cs.chartType`, `preset:'custom'`, same sink as desktop).
- **Indicators (ƒx)** → bottom sheet: the 4 MA overlay slots as toggles (reads/writes
  `cs.overlays` positionally — the schema is positional, see chartDefaults), plus
  **"Browse indicator library…"** which opens the SAME `IndicatorLibraryDialog` the
  desktop toolbar owns (see `toolbarApiRef` below) — the criteria-builder door stays
  open on phone — plus "All chart settings…" (`paneRef.openSettings()`).
- **More (⋯)** → bottom sheet: Flag/unflag current symbol · Chart settings · the
  layout's OTHER widgets (watchlist / scanner / themes …) each opening as a
  full-screen page over the chart with a "‹ Chart" back bar · Add widget
  (`MOBILE_MENU_TYPES`).

## Architecture decisions

- **The phone view is a VIEW over the same saved layout.** `MobileChartsApp` binds
  the **first `type:'chart'` widget** in `layout.widgets` (derived every render —
  the hydration-ordering rule from the 2026-08-09 landing fix, ported forward:
  never a `useState` initializer). Its `opts.tf` / `opts.settings` are read and
  written through the same `onOptsChange` the desktop grid uses, so a phone edit
  is a desktop edit; `chartId = widget.id` matches WidgetHost's main-tab `groupId`,
  so alert scoping agrees across devices. Ticker changes go through
  `setGroupSym(widget.color)` — color-group linking with the other widgets is
  preserved.
- **Compose `ChartPane` directly, never `ChartWidget`** — the same precedent as
  `GridChartCell` ("composed on StockChart directly … NEVER ChartWidget itself").
  ChartWidget is workspace chrome (tabs, right-click menu, crosshair bus); the pane
  is the chart. `density="mini"` + `showTfBar={false}` renders candles only and
  gates off the fundamentals/quote/meta fetches (`infoGate` in ChartPane).
- **The drawing toolbar stays mounted** (StockChart default `showDrawingTools`).
  It is the mount point of `IndicatorLibraryDialog` → `BuilderSheet` (the
  builder-door wire, `builderDoor.wire.test.jsx`), it has its own collapse chevron,
  and it keeps drawing possible on phone. Restyling it for touch is Phase 2.
- **`toolbarApiRef`** — one additive StockChart prop: a host-supplied ref that
  StockChart fills with the mounted ChartToolbar's imperative API
  (`openIndicatorLibrary` / `openAlerts`), null when no toolbar is mounted. This is
  how the bottom toolbar's ƒx sheet opens the real library instead of mounting a
  second one (the "ONE POPOVER, NOT A SECOND MOUNT" rule already in StockChart).
- **Widget pages render OVER the chart** (absolute overlay), not instead of it —
  the chart never unmounts, so returning from the watchlist is instant and free
  (no refetch/reframe). `WidgetHost` renders the page body unchanged, so widget
  behaviors (tabs, color linking, remove) are byte-identical to the tab-strip era.
- **Sizing:** the shell root keeps the `.mobileWorkspace` class —
  `mobileShellHeight.test.js`'s token-subtraction contract (top bar + tab bar
  declared once in tokens.css) holds untouched.
- **Grid mode on phone** (stacked Multi-Chart cells) is untouched this phase.

## iOS polish checklist (applied in `MobileCharts.module.css`)

- 44px minimum targets (`var(--tap-min)`) on every control; the toolbar buttons
  are flex-grown so the whole bar is a thumb strip.
- `-webkit-tap-highlight-color: transparent` + `touch-action: manipulation`
  (kills the 300ms/double-tap-zoom class) + `user-select: none` on chrome.
- Frosted-glass toolbar (`backdrop-filter: blur/saturate`) with solid fallback.
- Search input ≥16px font (prevents iOS focus-zoom), `autocapitalize=characters`,
  `autocorrect/spellcheck off`, `enterkeyhint=go`.
- Sheets already carry safe-area padding + drag-to-dismiss (Sheet primitive).
- Haptics on selection commits only (`components/mobile/haptics`), never on scroll.
- Momentum scrolling + `overscroll-behavior: contain` in sheet lists.

## What replaced what

| Was | Now |
|---|---|
| `widgets/MobileWorkspace.jsx` (tab strip + full desktop widget) | 🗑️ deleted — `mobile/MobileChartsApp.jsx` (chart-first shell). Its hydration-ordering rule and cold/warm tests are PORTED, not dropped (`MobileChartsApp.landing.test.jsx`). |
| `MobileWorkspace.landing.test.jsx` | `mobile/MobileChartsApp.landing.test.jsx` (same cold-prefs discipline) |
| phone assertion in `builderDoor.wire.test.jsx` (`tablist "Chart widgets"`) | the shell's toolbar (`data-testid="mobile-chart-toolbar"`); the builder walk itself is unchanged and unmocked |
| `ChartsWorkspace.test.jsx` mobile-branch mock | same test, new mock path/testid |

## Phase 2 — competitor parity (shipped same branch, 2026-08-30)

Grounded in a research pass on TradingView mobile (bottom interval/indicators/
draw controls, rotate-to-fullscreen — our layout matched the pattern) and
Deepvue (whose signature is the watchlist scan→tap→chart loop with mini
charts):

- **Landscape immersive** — a coarse-pointer landscape short viewport
  (`max-height: 500px`) now lands in `MobileChartsApp` too (it previously fell
  into the desktop RGL branch at 700–930px width). While the shell is mounted
  (`html[data-mobile-chart-shell]`) that media state hides MobileNav,
  MobileTabBar and both FABs, zeroes Layout's bar reservations, and the shell
  takes `100dvh` with slimmed strip/toolbar + notch-safe side padding
  (`viewport-fit=cover` is already set). Rotate = fullscreen chart; every
  other route is untouched.
- **★ Watchlist in the toolbar** — one tap opens the layout's watchlist widget
  full-screen over the chart (color-group linked, so tapping a row retargets
  the chart); with none saved, one is added and opened when it hydrates
  (render-time state adjustment, not an effect).
- **Price alerts from the chart** — More → "Set price alert…" →
  `MobileAlertSheet`: 20px decimal input seeded from the live price, "Alert
  above" / "Alert below" as the commit buttons, riding the same `createAlert`
  (bell + email + Discord delivery) the desktop right-click uses.

## Phase 3 — the loop, closed (same branch, 2026-08-30)

- **Tap-to-chart** — a full-screen page that RETARGETS the chart (a watchlist
  row tap publishing into the chart's color group) hands the member straight
  back to the chart showing the pick, TradingView-watchlist style. Implemented
  as a render-time comparison of the chart symbol against the symbol captured
  at page-open (`screen.symAtOpen`); a page on a different color group can
  never move the chart's symbol, so it stays open — correct by construction,
  no widget-type allowlist to maintain.
- **Chromeless widget pages** — the phone page now mounts `WidgetHost` with
  its existing `merged` contract (no desktop drag/close bar; a multi-tab slot
  keeps its tab strip), and removal moves to a trash button in the page
  header. The accidental-remove ✕ is off the phone.

## Deliberately deferred (Phase 4+)

- **Touch drawing pass** — restyle ChartToolbar for touch (left rail, 44px),
  test pointer-based drawing end-to-end on iOS Safari. (The toolbar now starts
  collapsed on phone; its chevron expands it.)
- **Deepvue-style watchlist mini-charts** — sparkline per row on the phone
  watchlist page.
- **Price + interval in the top app bar** (reclaim MobileNav's title row on
  /charts), long-press crosshair inspect card, per-widget mobile headers.
- **Tablet (641–1024px portrait)** still renders the RGL workspace.
