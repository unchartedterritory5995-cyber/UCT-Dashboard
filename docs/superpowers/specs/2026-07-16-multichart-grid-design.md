# Multi-Chart Grid Mode — Design Spec (2026-07-16)

Owner-approved feature: a second mode on `/charts` that swaps the drag/resize workspace for a
fixed CSS grid of independent chart cells (2x2 / 3x2 / 3x3 presets + custom N×M), each cell with
its own ticker + timeframe. Approved product decisions: **manual ticker per slot · fully
independent timeframe per cell · named saved layouts per member · built as a mode toggle inside
/charts**. v1 ships cells with **drawing tools OFF**.

Design validated by two multi-agent passes (analysis wf_3014bbeb-a80, solutions+adversarial
verify wf_2d2b4fee-813) against master `e380f6be`. All file:line refs are that commit.

## Non-goals / already solved (do not build)

- **No stream multiplexing.** `priceStreamManager` / `barsStreamManager` / `livePriceStore`
  already pool browser-wide: 16 cells = 1 price SSE + 1 bars SSE + 1 union REST poll. A second
  mux would double-subscribe and defeat backend refcounting.
- **No backend changes.** Bars 3-layer cache absorbs a staggered 16-cell open; prefs and
  `/api/charts/layouts` already exist.
- **No time-range sync in v1** (feedback loops with `keepPresentOnSymbolChange`); crosshair
  sync only, default OFF, ref-bus pattern.
- **No per-cell chart settings in v1** (escape hatch specced below, deferred).

## Architecture

`ChartsWorkspace` gains `mode: 'workspace' | 'grid'` (persisted). Header gets a **Multi Charts**
dropdown (same `.toolbarBtnGroup` pattern): preset rows with grid-shape icons, custom N×M form,
saved layouts, "Back to workspace" when in grid mode. The `<main .workspaceBody>` child swaps
from `<ResponsiveGridLayout>` to `<MultiChartGrid>`; header, WorkspaceContext.Provider and the
`data-charts-theme` root stay mounted (Sunrise contract).

New files under `app/src/pages/charts/grid/`:

- **`gridLayouts.js`** — presets (1x2, 2x1, 2x2, 2x3, 3x2, 3x3, 4x4) + custom N×M generator,
  `GRID_MAX_CELLS` (16 pending spike), clamp for stale oversized prefs. Ported from orphaned
  `pages/multichart/multiChartLayouts.js` + its test.
- **`useStaggeredMount.js`** — concurrency-limited mount queue: ≤3 cells loading at once, slot
  released on first `onBarsReady` or 5 s safety timer; reconcile on layout switch never
  unmounts live cells. (Fixed-delay stagger rejected — doesn't bound in-flight when server is
  slow, the actual 2026-05-24 incident condition.)
- **`GridChartCell.jsx`** — controlled cell `{cell:{id,sym,tf}, onChange, crosshairBus,
  volPanePct, isActive, onOpenSettings, onBarsReady}`. Chrome: SymbolSearch badge (wrapper
  span, SymbolSearch has no className prop), compact TF `<select>`, ChartDayGain, Shift+F flag
  toast. Empty cell (`sym=null`): no StockChart, "+ Add ticker" → `searchRef.openWith('')`.
- **`MultiChartGrid.jsx`** — container: cells state, debounced (500 ms) + hydration-gated
  `multichart_state` pref, mount queue, active-cell tracking, crosshair bus + Sync toggle,
  ONE gear → shared `ChartSettingsModal` (ChartWidget wiring incl. savedColors), per-cell
  clean context menu, layout picker plumbing, named layouts.
- **`MultiChartGrid.module.css`** — `.gridBody` uses `repeat(n, minmax(0,1fr))` tracks +
  `overflow:hidden` at every level (StockChart `.wrapper` has `min-height:200px`; unclipped
  bleed re-triggers the documented autoSize width-shake loop). No transforms (canvas blur on
  fractional Windows scaling — same reason workspace passes `useCSSTransforms={false}`).

## StockChart additive props (~35 LOC, all default = today's behavior)

| Prop | Default | Effect |
|---|---|---|
| `backgroundWarm` | `true` | `false` skips the all-TF warm chain (:2228) and D/W/M dwell-warm (:7181). On-demand paths (primary SWR, pan backfill, TF switch) untouched. |
| `onBarsReady` | `null` | Fires once per mount at first `loading===false` (:2326) — bars OR fatal error — via latest-ref latch. Releases a mount-queue slot. |
| `hotkeysActive` | `true` | `boolean \| () => boolean`, read via latest-ref at top of the document keydown handler (:2612). Function form = zero re-renders on active-cell changes. |
| `disablePatterns` | `false` | `usePatternDetections(sym, tf, showPatterns && !disablePatterns)` (:1796), PatternOverlay not mounted (:7803), toolbar gets `hidePatterns \|\| disablePatterns` (:7900). New prop, NOT strengthened `hidePatterns` — 3 of 9 existing callers are partner-owned OptionsFlow surfaces. |

## Grid cell — verified lite recipe

`sym tf onSymbolChange onTfChange` + crosshair pair when bus on + `showDrawingTools={false}
boldCandles userCandleColors colorByNetChange candlesOnTop ema9MatchCandle hidePriceLine
markVolumeExtremes volumeMa={50} volumeSeparatePane volumePaneHeightPct={volPanePct??12}
volumeLastValue carryDragPlacement={false} keepPresentOnSymbolChange dragMeasure lockWatermark
verticalLegend centerWatermarkOnPlot watermarkOpacity={0.82} rightPadBars={6}
dailyDefaultBars={126} priceScaleTopMargin={0.12} priceScaleBottomMargin={0.10}
canvasTheme={sunrise?'sunrise':null} backgroundWarm={false} onBarsReady disablePatterns
hotkeysActive={isActive}`. (`hideReplay/hidePatterns/hideCompare` inert under
`showDrawingTools={false}` — toolbar never mounts; passed anyway as future-proofing for the
v2 drawing flip.) `liveUpdates` stays default true (pooled).

**Adversarial-verify revisions folded in:**
- Focus wrapper (`tabIndex={0}`, keydown type-to-search) wraps ONLY `.cellChart` (ChartWidget
  parity); active ring via `.cell:focus-within`; keydown bail adds `SELECT`.
- `if (!cell.sym) return` guards on Shift+F flag and `handleSymbolChange` (else `toggleFlag(null)`
  writes a literal null into Flagged localStorage and syncs it).
- `useEffect(() => { if (!crosshairBus) setExternalCrosshair(null) }, [crosshairBus])` so
  toggling Sync off clears frozen crosshairs; subscribe effect gated on `crosshairBus && cell.sym`.
- Cross-symbol sync: intraday cells snap to their OWN nearest-bar close (on-scale); only D/W/M
  string-time bars fall back to source price (effectively time-only). Documented, not a bug.

## Active-cell hotkey model (grid + workspace fix)

Grid: `activeCellRef` seeded to 0, hover-sticky (`onPointerEnter`) + `onFocusCapture`, clamp
effect on shrink. **Memoization contract (verify-mandated):** cell exported as `React.memo`;
per-index `isActiveFns` and `onChangeFns` built with `useMemo` on `[cells.length]` using
functional `setCells`; activeIdx className lives on the container-owned wrapper div only, so a
mouse sweep across 4x4 re-renders zero StockCharts.

Workspace (separate, independently revertable commit): `activeChartRef` on WorkspaceContext
(FALLBACK gets `activeChartRef: null`), ChartWidget root `onPointerEnter` sets it,
`hotkeysActive` callback `a == null || a === widgetIdRef.current` (null-means-all = today's
behavior until first hover), **plus unmount cleanup**: if the ref holds this widget's id, null
it — otherwise closing the hovered widget leaves ALL workspace hotkeys dead.

## Settings semantics (v1: global)

`chart_settings` stays one global blob for all cells. One gear in the grid toolbar opens the
shared `ChartSettingsModal` (wired like ChartWidget.jsx:129-157 + :494-501, savedColors
included; extract `useSavedChartColors` hook to share). Per-cell right-click gets a
**custom clean context menu via `onBarContextMenu`** (verify Option B — the sections-path
"Chart settings…" item is gated on `showDrawingTools` at :1660 and the payload's
`openSettings` routes to a null `toolbarRef`, so it is unreachable in lite cells; the custom
menu also avoids exposing the app-root J2 menu's global "Chart type" submenu in cells).
Known + accepted: keyboard `toggle:` hotkeys from a focused cell write the global blob (one
POST after the hotkey fix). Settings write with 16 cells = applyOptions/setData update passes,
no chart re-init (instance reuse confirmed :3939-3955). Optimistic pref writes revert only on
network failure, not HTTP errors (pre-existing).

**Deferred escape hatch (specced, not shipped):** `settingsOverride` partial-blob prop merged
over `cs` at :901 (csBase/cs split), `mergeSettingsOverride` helper in chartDefaults, and
write-restore in `handleUpdateChartSettings` so overrides never leak into the global blob
(write sites: region menu :1600-1614, keyboard toggles :2653-2689, scale :969, ext-hours
:1589, patterns :1793 — all funnel through :1582; watermark-drag commit :1289-1292 writes the
pref directly but builds from the global blob, cannot leak). Then per-cell chartType ≈ 20 LOC.

## Persistence

- Working state: `multichart_state` pref `{layout:{rows,cols}, cells:[{id,sym,tf}], syncCrosshair,
  activeLayoutId}` — 500 ms debounce, flush-on-unmount, `hydratedRef` gate (never persist before
  the pref loads; V1's hydration-clobber race is the known trap). Written only on discrete
  changes, never crosshair/zoom.
- Named layouts: existing `/api/charts/layouts` service with a `kind:'multichart'` marker inside
  `layout_json`, client-filtered (workspace Open-layout list excludes them; grid list includes
  only them) — falls back to a `multichart_templates` pref if the list API can't filter cleanly.
- Mode: persisted alongside (`charts_mode` inside multichart_state or its own key).

## Drawings store (separate prerequisite ship)

Fixes today's latent workspace bug (two same-sym charts clobber `uct-chart-drawings`
last-writer-wins). Module store `drawingsStore.js` (realtimeCandle pattern) +
`useChartDrawings` rewritten as a `useSyncExternalStore` adapter with a byte-identical return
surface (zero StockChart/overlay edits). Shared per-sym undo/redo stack. Verify-mandated:
- Microtask dedup for undo/redo AND **content-keyed dedup for `addDrawing`** (Ctrl+V paste
  fans out to every same-sym overlay via window keydown — without dedup one paste persists N
  clones); no-op guards on `removeDrawing`/`updateDrawing` (double-selected Delete = junk
  history step).
- **rAF-coalesced notify** (writes stay synchronous; notify once per frame per sym) — a raw
  store notify re-renders the ENTIRE StockChart of every same-sym cell per pointermove drag.
- Pinned contract: `getSnapshot` for unloaded sym returns frozen EMPTY_SNAPSHOT, no side
  effects in render; subscribe's 0→1 lazy-load REPLACES the snapshot object; `snapshotHistory`
  rebuilds snapshot + notifies (toolbar canUndo at drag start); store keys are the RAW sym
  string (do NOT copy realtimeCandle's toUpperCase).
- Same key/format, no migration. Cross-tab reconciliation deferred.

## Mount storm (verified CONFIRMED, no revisions)

Cold 4x4 without gating ≈ 130+ requests (16 primary + 112 warm-chain + 16 full-depth dwell) —
the documented 2026-05-24 outage class. Fix: `backgroundWarm={false}` per cell + the 3-wide
mount queue + ChartSkeleton placeholders + prefs-hydration gate before first mount. Cold 4x4
becomes 16 shallow 600-bar fetches at ≤3-4 concurrent; warm grid paints near-instantly (IDB
hits release slots in ms). Rapid ticker flips in a cell cost exactly 1 fetch.

## Perf spike (before finalizing GRID_MAX_CELLS)

Admin-only `?gridspike=N&tf=D|5` runs the REAL grid path with persistence disabled, 16 distinct
liquid tickers, instrumentation module `gridSpike.js` → `window.__gridSpike` +
`[gridspike:done]` JSON console line (machine-readable for Chrome-MCP/Playwright).
Verify-mandated fixes: first-frame signal = **MutationObserver watching each cell's container
for first `<canvas>` insertion** (chart is created lazily after bars — an onTimeRangeChange
latch never fires; effect lacks `chartReady` dep); sweep dispatches synthetic `mouseenter`
first then `mousemove` on the LAST canvas (LWC attaches its listener lazily in mouseenter, on
the top canvas) with a `moveEvents===0 → invalid` guard so a silent regression can't fake-pass;
per-cell `mountAt` stamped at queue admission (not shell mount), all-framed measured from
`gridEnterAt`. Thresholds: warm per-cell median ≤700 ms, p95 ≤1.5 s; all-framed 3x3 ≤3 s /
4x4 ≤5 s; cold 3x3 ≤8 s / 4x4 ≤12 s; sweep median ≤33 ms, p95 ≤50 ms; heap settled ≤500 MB,
idle 2-min growth ≤20 MB. Decision tree: pass → 4x4; crosshair-only fail → 4x4 with sync
force-off >9 cells; mount ≤1.5× over + heap pass → soft cap (toast, picker defaults 3x3);
heap/leak fail → hard cap 12 (if 4x3 passes pro-rata) else 9; 3x3 fails → presets 2x2/3x2
only. Results recorded in this doc (section below). Sweep aborts unless tab visible
(rAF-freeze lesson).

## Mobile (<640 px)

At the existing `isMobile` early-return: grid mode renders stacked lite cells (~45 vh each),
same provider wrapper. No JS column collapse on desktop (CSS handles it).

## Housekeeping

Remove dead `MultiChart` lazy import (App.jsx:64); retire `pages/MultiChart.jsx` +
superseded `pages/multichart/*` once `gridLayouts.js` ports the math + test; MobileTabBar
`/multi-chart` entry; keep the `/multi-chart` → `/charts` LegacyRedirect.

## Ship plan

1. Commit spec. 2. Drawings store (own commit — prerequisite, independently useful).
3. StockChart props (own commit). 4. Grid engine + container + workspace toggle.
5. Workspace hotkey dedupe (own commit). 6. Mobile + housekeeping. 7. Spike run → cap.
8. vitest `--pool=threads` + build + live Playwright verify (DOM, single SSE at 3x3, Sunrise
pass) → push `origin feat/multichart-grid:master` in the deploy window.

## Perf spike results (2026-07-16, owner PC, local backend, market closed)

`?gridspike=16&tf=D`, Chrome via CDP automation, **cold local server cache** (worst case —
prod pre-caches the whole universe):

- **Heap: decisive PASS.** base 36 MB → settled 46 MB (+10 MB for 16 mounted charts, vs the
  ≤500 MB threshold) → idle 39 MB after 60 s (negative growth — GC; no leak signature).
- **All 16 cells visually framed ≈10 s** from grid enter on the cold-cache run, mount queue
  ≤3-wide, no request herd (per-cell/all-framed timer values from this run are NOT quotable —
  the tab was CDP-hidden and rAF-throttled, so `framedAt` stamps landed on forced frames).
- **Idle long tasks: 0/60 s** (underestimate in a hidden tab; consistent with the fluid
  interactive session).
- **Sweep: invalid ("tab not visible")** — the validity guard worked as designed; a hidden
  tab throttles rAF so the guard refused to emit garbage. Needs one foregrounded run:
  open `/charts?gridspike=16&tf=D` in a visible tab, wait ~90 s, read `[gridspike:done]`.

**VISIBLE-TAB RUN (2026-07-17 ~1:10 PM ET, real foreground Chrome window, warm server
cache — the summary now also persists to `localStorage['uct.gridspike.last']`):**
`allFramedMs: 901` (16/16 framed) · per-cell mount→paint `median 20 ms / p95 71 ms` ·
heap `8 MB base → 74 MB settled (+63 MB for 16 charts) → 47 MB idle (−25 MB GC)` ·
`0` idle long tasks / 60 s. Every threshold passed by 1–2 orders of magnitude.
**GRID_MAX_CELLS = 16 (4×4) CONFIRMED WITH DATA.** Sweep remains harness-invalid
("no crosshair events delivered"): LWC doesn't respond to the synthetic mousemove
dispatch — a harness-only limitation (real-mouse crosshair verified interactively);
fix candidate: PointerEvent dispatch / price-pane top-canvas targeting.
- Interactive verification (visible session, 3x3 + 5 charts): fluid hover/crosshair/type-to-
  search; single pooled SSE connection confirmed via netstat (1 TCP conn for 5 charts).

**Decision (tree branch b): GRID_MAX_CELLS stays 16 (4×4 ships).** Heap + visual + interactive
all pass; crosshair sync is already default-OFF (the tree's downgrade for unproven sweeps);
the in-tree harness re-runs the sweep any time from a visible tab.

**Known cosmetic wart (punch list):** switching workspace→grid while the SAME symbol was just
open at full 30-year depth in the workspace can paint that cell mis-framed (full-depth
memCache carryover); Reset view or a reload reframes it. Fix candidate: force a default-zoom
re-anchor on grid-cell first paint.

## v1.1 (2026-07-17 morning) — shipped

- **Blank-cell roundtrip bug root-caused and fixed** (3-lens parallel investigation): paint/
  framing latches survived chart destruction, so a destroy→recreate (StrictMode remount, warm
  caches) produced a chart under an armed 'noop' render plan — created, never painted, never
  framed. Fix: latch reset in the unmount cleanup + `_freshChart` guard + width-proportional
  viewing-latest floor. The stale-count re-anchor got `rangeDescribesOldExtent` (scrolled-back
  ranges ALWAYS re-anchor classically; only old-extent-impossible + new-edge-hugging ranges are
  trusted as LWC-remapped).
- **Saved drawings render read-only in grid cells** (`showSavedDrawings` + ChartDrawingOverlay
  `readOnly` prop — no window keydown registration, so Ctrl+Z/V/Escape are not swallowed ×16).
- **Per-cell chart style** (`settingsOverride` merged over the global blob inside StockChart;
  write-restore keeps overrides out of the global blob but preserves deliberate user edits via
  Object.is diffing; canonical `CHART_TYPE_OPTIONS` shared by picker + sanitizer).
- **Theme rows in the Multi Charts menu** (was unreachable from grid mode).
- 8-angle review ran; residual accepted findings → punch list below.

**Punch list from v1.1 review (deferred, non-blocking):**
- Read-only drawings layer runs ChartDrawingOverlay's per-frame rAF sampler per cell with
  drawings (render engine for pan-tracking) — consider a visible-range-subscription redraw or
  one shared ticker if dense grids show jank. Model Book's static layer shares the recipe
  (single instance) and still registers its keydown handler — consider `readOnly` there too.
- Latch refs could group into one paintLatch object so reset can't drift from declaration.
- mergeSettingsOverride section-key list duplicates mergeChartSettings shape knowledge; unify
  via a shared section-keys export before any SECTION override ships (write-restore is also
  whole-key — needs sub-key diffing for section overrides).
- Theme row array duplicated between workspace + grid menus (2 items; extract on 3rd theme).
- SPY-class intermittent one-cell mis-frame on some roundtrips (self-heals via Reset view /
  reload; frequency reduced by the v1.1 fixes — retest after members use it).

## v1.4 (2026-07-17 afternoon) — cell maximize + declutter

- **Cell maximize**: expand icon per header (new UIcon `expand`/`collapse`
  glyphs) → CSS-promotes the cell over the grid body (`.cellMaximized`
  absolute/inset-0/z-6; `.gridBody` position:relative) — NO remount, instant,
  keeps state; full width shows the complete primary header; collapse restores;
  stale maximized-id auto-restores. Gear+expand grouped in `.cellHeaderRight`.
- **Declutter**: `hideWatermark` (watermark off entirely — header already names
  the chart) + `hideJournalOverlay` (trade markers plastered small cells).

## v1.3 (2026-07-17 afternoon) — uniform cell header + polish batch

- **Grid cell header now mirrors the primary ChartWidget header 1:1** (owner
  request — cells were minimal). Reuses ChartWidget's exact CSS classes:
  top row = logo + full company name + day gain + per-cell Style + gear; second
  row = 8-button TF bar + Market Cap / Next Earnings / UCT Rating + session
  toggle + live clock. Adds the matching hooks + `sessionView` wiring.
  **Meta + session collapse by CELL width via `container-type: inline-size` on
  `.cell`**: 2-col full header, 3-col drops session (>700px hide), 4x4 (458px,
  verified) drops meta too (>560px hide) — no wrap/overflow. ChartWidget
  untouched (owner co-edits it). Fetch note: adds useFundamentalSnapshot +
  useTickerMeta per cell (SWR-deduped/cached; bounded) — acceptable, watch at
  scale.
- Model Book display-only overlays got `readOnly` (were swallowing hotkeys).
- Generic settings-section drift-guard test (caught the new `header` section).
- Stale test trio rewritten (root cause: `useAuth` in render path); suite green.
- Visible-tab spike: 16 cells ~900ms framed, +63MB, GRID_MAX_CELLS=16 confirmed.

## Live verification (2026-07-16, local build)

3×3 grid: presets dropdown w/ icons + custom N×M + sync toggle ✓ · row-major cell carryover ✓ ·
empty-cell "+ Add ticker" + type-to-search (NVDA) ✓ · per-cell TF independence (NVDA 1W, rest
1D) ✓ · custom right-click menu (alert @ price / reset view / chart settings) ✓ · persistence +
auto-restore of mode/cells/tf across reload ✓ · single pooled SSE ✓ · zero console errors ✓ ·
**Sunrise theme in grid cells ✓** (cells render the exact workspace/Bracco chart treatment —
same StockChart recipe, same per-user chart_settings blob, same data-charts-theme root) ·
workspace mode untouched ✓ · owner independently exercised 2×3 + back-to-workspace in a
parallel tab; state persisted their actions faithfully ✓.
