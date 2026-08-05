# ChartPane — the `/charts` widget everywhere a chart lives

**Date:** 2026-08-04
**Branch:** `feat/chart-pane-universal` · **Worktree:** `.worktrees/chart-pane` (off `origin/master`)
**Status:** design — awaiting owner review

## The ask

> "This is the shit that I want everywhere — this chart. I want to replace the other older
> chart structure that we had before. Essentially just applying the chart widget functions
> and settings and everything else about it, for each user, into all the other spots in the
> app that have a chart."

The `/charts` ChartWidget is the reference chart. Every other chart surface — Options Flow
popups, Dark Pool, TickerPopup, the intraday day popup, Breadth, ThemeTracker — should be
that same chart, carrying that user's own settings.

## Current state

### There is already one chart component

`StockChart.jsx` (10,001 lines on master) is imported by **22 files** and mounted at **27
sites**:

| Group | Files |
|---|---|
| Charts workspace | `ChartWidget` · `MobileChartFallback` · `grid/GridChartCell` |
| Options / flow | `OptionsFlow` (×2: contract popup, GEX) · `DarkPool` |
| Popups | `TickerPopup` · `mobile/TickerHubSheet` · `IntradayDayPopover` |
| Pages | `Breadth` · `CustomScan` · `Watchlists` · `ThemeTrackerPage` · `research/tabs/OverviewTab` · `screener/ChartsGallery` |
| Model Book | `ModelBook` · `modelbook/SetupsView` · `modelbook/BottomsView` · `modelbook/shared/ChartExampleKit` |
| Journal 2.0 | `position/PositionDetailPage` · `trade/TradeDetailPage` |
| Infrastructure | `ChartRender` (headless export) · `admin/PatternReview` |

So the chart *engine* is shared. What is not shared is the **shell**.

### The shell lives in ChartWidget, and that's the whole gap

`ChartWidget.jsx` (786 lines on master) renders, in order:

| Region | Contents | Shared today? |
|---|---|---|
| `ChartTabStrip` | multi-tab chart profiles | workspace-only |
| `chartHeaderTop` | `SymbolSearch` (logo + company name) · `ChartDayGain` · session toggle (Regular Hours / Include Post-Market / Extended Hours) · `ChartMarketClock` | **no** |
| `tfBar` | TF buttons · `TimeframeMenu` (⌄ favorites + custom) · MARKET CAP / NEXT EARNINGS / UCT RATING meta · `LeverageInverseControl` · add-tab · settings gear · `ShareToFloor` | **no** |
| `chartFill` | `StockChart` + click-to-focus + type-to-search | partly |
| overlays | flag toast · right-click menu · AI search · `ChartSettingsModal` | **no** |

Every popup mounts `StockChart` bare. That is why the LLY contract popup shows candles and a
drawing toolbar but no identity line, no metadata, no clock, and a watermark scaled for a
full pane. Its TF bar reads `D W M`; the charts tab reads `1D 1W 1M` — two separately
written TF bars that have already drifted.

### The constraint that shapes everything

`ChartWidget.jsx` took **13 commits in the last 14 days**. Bracco is actively shipping in
`app/src/pages/charts/widgets/` right now (Stock Profile widget, News catalysts, chart
annotations). A big-bang extraction that moves ~600 lines out of that file would collide
with every one of those commits.

## Design

### Principle: extract leaf-first, never duplicate

Each step lifts one region into its own component **and immediately rewires ChartWidget to
use it**. There is never a window where ChartWidget and ChartPane hold two copies of the
same markup, so no new drift can appear. Each step is a small, mechanical, independently
committable diff — a conflict with Bracco is a few lines to rebase, not a rewrite.

This mirrors how this directory already evolved: `ChartDayGain`, `ChartMarketClock`,
`TimeframeMenu`, `LeverageInverseControl` and `ChartTabStrip` were all extracted this way.

### Target structure

```
components/chart/pane/
  ChartPane.jsx            composes everything below + StockChart
  ChartIdentityRow.jsx     SymbolSearch + day gain + session toggle + clock
  ChartMetaRow.jsx         MARKET CAP / NEXT EARNINGS / UCT RATING
  ChartTfBar.jsx           TF buttons + TimeframeMenu + favorites/custom
  useChartSurfaceSettings.js   settings resolution + menu theme vars
```

`ChartWidget.jsx` keeps only what is genuinely workspace-specific and becomes a thin adapter:
color groups, `crosshairBus`, `activeChartRef` hotkey arbitration, chart tabs, `ShareToFloor`,
`AiSearchWidget`, and the per-widget/per-tab settings routing.

### ChartPane prop contract

```js
<ChartPane
  sym                    // string, required
  tf                     // string, required
  onSymbolChange         // (sym) => void — omit to lock the symbol (contextual popups)
  onTfChange             // (tf) => void
  density="full"         // "full" | "compact"
  settingsOverride={null}// null = the user's global chart_settings ("your chart")
  onSettingsPersist      // omit = writes the global blob
  stockChartProps={{}}   // per-surface passthrough (priceLines, darkPoolBars, markers…)
  slots={{ headerRight, tfBarRight }}   // host-specific chrome (ShareToFloor, tabs, …)
/>
```

Surfaces that must not let the user retarget the chart (Breadth drill, Journal trade drawer)
simply omit `onSymbolChange`; `ChartIdentityRow` renders a static label.

### Density is a container query, not a viewport query

`density="compact"` drops the meta row, session toggles and clock; keeps identity, TF bar and
the settings gear. The switch is driven by `@container` on the pane root — same mechanism
`.widgetBody` already uses — so a chart in a narrow popup collapses correctly even on a wide
monitor. Canonical breakpoints only (640 / 1024); no new literals.

### "Each user's chart" — the settings decision

The workspace deliberately gives **each widget and tab its own settings blob** (`opts.settings`),
seeded from the global `chart_settings` and diverging once edited. That isolation fixed a real
bug and must not regress.

Popups are the opposite case. The ask is that a popup shows *your* chart. So:

- **Popups pass `settingsOverride={null}`** → they read the global `chart_settings` blob, which
  is exactly the user's default chart.
- **Edits made from a popup write the global blob** — one chart identity, edited anywhere.
- **Workspace widgets keep per-surface isolation**, unchanged.

⚠️ **Owner decision required.** This means changing a setting from the Options Flow popup also
changes the Dashboard/TickerPopup chart and the seed for new widgets. That is the literal
reading of "each user has their chart everywhere," but it is a real behavioral choice. The
alternative is popups read-global / write-nowhere (settings only editable on `/charts`).

### Popups need more room

The Options Flow contract chart renders into `flex:1` inside a fixed region — roughly
460×300 CSS px. `density="compact"` alone is not enough; four rows of chrome on 300px leaves
almost no candles. The adoption commit for each popup includes enlarging its modal toward
near-fullscreen, matching how `/charts` treats the chart.

### Explicitly NOT adopting ChartPane

Three `StockChart` mount sites must stay bare, and saying so is load-bearing — adopting the
shell in any of them is a regression, not an improvement:

- **`ChartRender.jsx`** — the headless export route. It renders a chart *image*; shell chrome
  would be baked into every exported PNG. It also has no saved settings, which is why
  `forceExtendedHours` exists.
- **`grid/GridChartCell.jsx`** — Multi-Chart grid cells are deliberately composed on
  `StockChart` directly, *never* on ChartWidget, because color groups cap at 4 independent
  symbols. It carries locked invariants (`backgroundWarm={false}` or a 16×7 fetch herd;
  `React.memo` "hover sweep re-renders zero charts"). Out of scope entirely.
- **`admin/PatternReview.jsx`** — an admin triage grid; chrome would only get in the way.

`ModelBook` / `SetupsView` / `BottomsView` / `ChartExampleKit` are *curated exhibits* with
their own framing (`frozen`, `boldCandles`, watermark overrides). They are deferred to a
follow-up, not part of this spec.

### Out of scope

Charts that are not `StockChart` stay as they are: the UCT20 tile (`createChart` line chart),
COT (Chart.js), Breadth Data Charts (ECharts), Options Flow's Vol/OI panel (Recharts).
Calendar/EarningsModal has no chart at all today and is mid-redesign on
`feat/research-calendar-redesign` — adding one there is a separate project, sequenced after
that branch lands.

## Execution order

Each numbered item is one commit, rebased on `origin/master` immediately before it lands.

| # | Step | Touches ChartWidget.jsx? |
|---|---|---|
| 1 | `useChartSurfaceSettings` — lift settings resolution + `menuVars` | yes, small |
| 2 | `ChartIdentityRow` | yes, small |
| 3 | `ChartMetaRow` | yes, small |
| 4 | `ChartTfBar` | yes, small |
| 5 | `ChartPane` composing 1–4 + StockChart + settings modal + focus/type-to-search | yes, moderate |
| 6 | ChartWidget → thin adapter over ChartPane | yes, final |
| 7 | Options Flow contract popup adopts ChartPane (+ modal enlarge) | no |
| 8 | Options Flow GEX chart | no |
| 9 | Dark Pool | no |
| 10 | TickerPopup + TickerHubSheet | no |
| 11 | IntradayDayPopover (`density="compact"`, keeps `showDrawingTools={false}`) | no |
| 12 | Breadth · ThemeTracker · CustomScan · Watchlists | no |
| 13 | Journal 2.0 `PositionDetailPage` + `TradeDetailPage` (symbol locked — omit `onSymbolChange`) | no |
| 14 | `research/OverviewTab` · `screener/ChartsGallery` | no |
| 15 | Retire the surfaces' hand-rolled TF bars; kill the `D W M` / `1D 1W 1M` drift | no |

Steps 1–6 are the only ones that touch the hot file. Steps 7–15 are pure adoption and carry
no conflict risk with Bracco at all.

### Coordination protocol

- All work in `.worktrees/chart-pane` on `feat/chart-pane-universal`, off `origin/master`.
- `git fetch && git rebase origin/master` before **every** commit in steps 1–6.
- Never `git add -A` — commit named paths only.
- Ship via `git push origin feat/chart-pane-universal:master`, after-hours, respecting the
  market-hours push freeze (`.git/hooks/pre-push`: no web pushes Mon–Fri 09:15–16:20 ET).
- If Bracco has ChartWidget.jsx open for a large change, steps 1–6 pause; steps 7–15 do not
  depend on them landing and can proceed in parallel once ChartPane exists.

## Verification

The extraction claims to be **behavior-preserving**. The gate has to be able to fail on that.

1. **The existing suites are the regression rail, unchanged.** `ChartWidget.test.jsx`,
   `ChartWidget.session.test.jsx`, `ChartWidget.volumepane.test.jsx` assert on rendered DOM.
   They must pass across steps 1–6 **without being edited**. Editing an assertion to match new
   output is the failure mode to refuse — if output changed, the extraction wasn't mechanical.
2. **Mutation control.** For each extracted component, one deliberate mutation (drop the meta
   row; swap a TF label) must turn the suite red, with an unmutated control green in the same
   run, verdict read from **exit code** — not grep. A suite that cannot fail is not a gate.
3. **Live-surface pass.** Roughly 4,000 green tests did not catch six contract defects on the
   Research/Calendar work; component-boundary bugs (a prop renamed on one side, a unit
   mismatch) are invisible to fixtures that assert against themselves. Every step 7–15 gets a
   real browser check of the actual popup — identity line, meta, TF switching, settings gear,
   drawing toolbar, crosshair legend — not just a passing test file.
4. **Per-surface screenshot diff** of `/charts` before and after step 6. The charts tab is the
   reference; if it moves a pixel, the adapter is wrong.
5. **Bundle check.** ChartPane must not become an eager import on a free-tier route.
   Entry-chunk gzip delta is reported per commit — a static import from an eager module is
   eager by definition, and `manualChunks` cannot fix it; the import edge has to move.

## Open questions for the owner

1. **Global settings write-through** (see above) — popup edits change your chart everywhere.
   Confirm, or restrict popup settings to read-only.
2. **Popup sizing** — enlarge the Options Flow contract modal toward near-fullscreen? It is
   currently ~460×300 for the chart, which cannot carry the full shell.
3. **Chart tabs in popups** — workspace-only, or should a popup get tabs too? Default: no.
4. **ShareToFloor in popups** — include, or `/charts` only? Default: `/charts` only.
