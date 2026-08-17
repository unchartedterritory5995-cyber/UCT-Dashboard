// app/src/components/chart/chartDefaults.js — Chart settings schema, defaults, presets
//
// ⭐ B5 TASK 9 — THE IMPORT BELOW USED TO BE A CYCLE AND IS NOT ANY MORE.
// `engine/instances.js` imported `instanceTombstone` / `isInstanceTombstone`
// back out of this file, which made the two mutually dependent the moment this
// file imported the migrator. It was SAFE (both sides are hoisted
// `export function` declarations and neither calls the other at module scope) —
// but safe by accident, and a `const` added to either side at the wrong moment
// is a TDZ crash inside the merge every chart is on. Both helpers moved to
// `./instanceShape`, which imports nothing; this file re-exports them.
import { migrateLegacyToInstances, normalizeInstances, instanceScope } from './engine/instances'
import * as engineRegistry from './engine/nativeRegistry'
// The legend's one reader. Imported (never re-implemented) so the merge below
// resolves `legendMode` by the SAME rule every surface reads it by — see the
// header block in `mergeChartSettings`. `legendMode.js` imports nothing, so
// this cannot start a cycle.
import { explicitLegendMode } from './legendMode'

export const CHART_DEFAULTS = {
  chartType: 'candles', // candles | hollow | bars | line | area
  invertScale: false,   // flip the price axis upside-down (Alt+I)

  candles: {
    // Defaults are the workspace "bold" palette (formerly hardcoded as MB_UP/MB_DOWN
    // in StockChart) so charts look identical by default now that the workspace
    // sources candle colors from settings (userCandleColors). oneColor = the single
    // color used by the "One Color" coloring mode.
    upColor: '#1ae51a',
    downColor: '#c41f2d',
    upBorder: '#1ae51a',
    downBorder: '#c41f2d',
    upWick: '#1ae51a',
    downWick: '#c41f2d',
    oneColor: '#1ae51a',
    // Bar thickness for the OHLC/HLC bar types ONLY. Lightweight Charts exposes a
    // single boolean here (`thinBars`) — true = 1px lines (the long-standing look,
    // and the library default), false = lines as wide as the bar slot. There is no
    // in-between, and CandlestickSeries has no width option at all, so candles and
    // hollow candles cannot be thickened. See the Type section of ChartSettingsModal.
    thinBars: true,
  },

  // How candles/bars are colored. 'netchange' = close-vs-previous-close (default,
  // matches the workspace's long-standing look); 'openclose' = close-vs-open
  // (LWC-native); 'onecolor' = every bar a single color.
  candleColorMode: 'netchange', // 'onecolor' | 'netchange' | 'openclose'

  // Canvas. background = the solid canvas color (defaults to the app --bg so the
  // workspace look is unchanged now that it reads this instead of a hardcoded value).
  // bgMode 'gradient' paints a top→bottom gradient across both panes (like Sunrise).
  background: '#0e0f0d',
  bgMode: 'solid',        // 'solid' | 'gradient'
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#706b5e',
  textSize: 11,           // price/time scale font size (px)
  grid: { color: 'rgba(46,49,39,0.25)', visible: true },

  crosshair: { color: '#706b5e', style: 1, width: 1, magnet: false }, // LineStyle: 0=solid, 1=dotted, 2=dashed, 3=large-dashed; width in px; magnet snaps to OHLC

  // Chart-widget header (workspace): the title/change row + timeframe bar + info
  // stats. Fully user-toggleable via Chart Settings → Header.
  header: {
    titleMode: 'company',   // 'company' | 'ticker' | 'both' (TICKER (Company Name))
    showChange: true,       // current-day $ + % change beside the title
    timeframes: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], // favorites — which TF buttons show in the header
    customTimeframes: [],   // user-created custom interval codes (e.g. '45','120','3D') saved for reuse
    showMarketCap: true,
    showNextEarnings: true,
    showUctRating: true,
    // ⚠️ LEGACY, READ-ONLY. `legendMode` below supersedes this boolean and is the
    // only key anything writes. It stays declared so a blob that predates the
    // mode still merges cleanly, and `legendMode.js::legendModeOf` reads it as
    // the fallback. Do NOT write it — two keys over one fact is the defect.
    showLegend: true,       // the on-chart OHLCV crosshair legend
    // ⛔ `legendMode` IS DELIBERATELY NOT DECLARED HERE. Its default lives in
    // `legendMode.js::DEFAULT_LEGEND_MODE` and is resolved on every READ by
    // `legendModeOf`. Declaring it would spread it into every merged blob, and
    // the merged blob is what every settings write persists — so the default
    // would be recorded as a user choice and could never be changed again for
    // anyone who had saved. Measured in production 2026-08-16; see
    // `legendStamp.test.js`.
    // Shape of that legend on the Charts workspace: 'vertical' = the stacked
    // label/value table down the left (the long-standing look); 'horizontal' =
    // a flat two-line strip (ticker · company · TF, then the values) with NO
    // background box. Surfaces that don't opt into the workspace legend
    // (Model Book, popups, …) keep their own inline row regardless.
    legendLayout: 'vertical', // 'vertical' | 'horizontal'
    // Per-item colors for the header/legend readouts. Each key is unset (absent) by
    // default = keep the item's built-in color; a hex here overrides that one item.
    // Day change is a pair (up-day / down-day). Keys: dayChangeUp, dayChangeDown,
    // marketCap, nextEarnings, uctRating, legend.
    colors: {},
  },

  // Moving-average overlays. `lineWidth`/`lineStyle` are per-overlay (the Indicators
  // tab edits them); when unset the renderer keeps its own defaults, so existing
  // stored blobs are unaffected. `offset` and `plotStyle` are declared here but NOT
  // yet honored by the renderer — both need series-level work in StockChart (offset
  // re-keys every point; plotStyle swaps the LWC series type). The Indicators tab
  // shows them disabled rather than pretending they work.
  overlays: [
    { enabled: true, type: 'EMA', period: 9,   color: '#4ade80', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'EMA', period: 20,  color: '#f472b6', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'SMA', period: 50,  color: '#60a5fa', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'SMA', period: 200, color: '#fb923c', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    // APPENDED, never inserted: mergeChartSettings merges overlays POSITIONALLY, so
    // inserting a slot would shift every stored blob's overlays by one (a user's EMA 9
    // would silently become an SMA 5). New slots go on the end. This is the SMA 5 that
    // used to be the hardcoded `showSma5` prop, now a real editable overlay.
    { enabled: true, type: 'SMA', period: 5,   color: 'rgba(168,162,144,0.55)', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
  ],

  volume: {
    visible: true,
    // Match StockChart's MB_UP / MB_DOWN — the workspace renders volume from these
    // now, so the defaults must equal the previous hardcoded palette or the default
    // look would shift for every user.
    upColor: '#1ae51a',
    downColor: '#c41f2d',
    hvcEnabled: true,
    separatePane: false,
    paneHeightPct: 22,   // height of the separate volume pane, % of chart (8–45)
    // The "$ Vol … Avg 50D …" strip at the top-left of the volume pane.
    labelVisible: true,
    labelColor: '#9b9684',
    // The volume moving-average line. Was a prop (volumeMa) with a hardcoded color;
    // now a real editable indicator. period 0 = off.
    maPeriod: 50,
    maColor: 'rgba(168,162,144,0.55)',
    maLineWidth: 1,
    maLineStyle: 'solid',
    // Bar style: 'columns' = built-in full-slot HistogramSeries (the long-standing
    // look); 'histogram' = thin bars with a gap between each (ThinVolumeSeries
    // custom series, TC2000-style). Recreates the volume series on change.
    barStyle: 'columns',
    // Declared, not yet honored — swapping the volume pane between histogram/line/area
    // needs a series-type recreate in StockChart (same as overlays' plotStyle).
    plotStyle: 'histogram',
  },

  watermark: {
    visible: true,
    opacity: 0.07,
    color: '#a8a290',
    sizeScale: 1.0,
    lines: { ticker: true, company: true, sector: true, industry: true, theme: true },
    x: 0.5,
    y: 0.5,
  },

  drawingDefaults: { color: '#c9a84c', width: 1, style: 'solid', fontSize: 13 },

  // ⭐⭐ B5 TASK 9 — THIS SECTION USED TO ENUMERATE FIFTEEN INDICATORS, AND IT IS
  // DOWN TO ONE. Ledger site #1, retired.
  //
  // The other fourteen are DEFINITIONS now (`engine/nativeRegistry`), and what a
  // chart has one of is an INSTANCE (`indicatorInstances`), not a section here
  // with an `enabled` flag. `mergeChartSettings` folds any v1 blob's fourteen
  // into instances on the next READ — see the migration at the bottom of this
  // file — so nothing is lost and nobody has to do anything.
  //
  // ⛔ `volumeProfile` IS NOT A LEFTOVER. It has no definition and never will:
  // it is a 2D canvas overlay, not an `addSeries` call, so no `plots[]` style can
  // express it and no flip touches it (`nativeRegistry.CARVED_OUT_INDICATOR_KEYS`
  // carries the decision and its expiry condition). Its surviving alone is what
  // makes this a RETIREMENT of the enumeration rather than a rename of it.
  indicators: {
    volumeProfile: { enabled: false, bins: 24, color: 'rgba(120,160,100,0.25)', pocColor: 'rgba(200,160,40,0.65)' },
  },
  // MarketSurge-style swing high/low price labels (rendered by swingLabelsPrimitive)
  swingLabels: {
    enabled: false,
    sensitivity: 'medium', // low | medium | high
    color: '#d4d0c4',
    tintByType: false,     // tint swing-high labels up-color, swing-low down-color
    upColor: '#4ade80',
    downColor: '#f87171',
    bgEnabled: true,       // draw the label's background box at all
    bg: null,              // the box color; null = match the canvas background
  },
  heikinAshi: false,
  logScale:   false,
  percentScale: false,
  comparisonSymbols: [], // Array<{ sym: string, color: string, enabled: boolean, scaleMode?, group? }>
  compareHideBase: false, // "Group only" — hide base candles/MAs/volume, show only comparisons
  // Event markers. earningsBeat/earningsMiss default to the candle up/down colors
  // (#1ae51a / #c41f2d) so the "E" badge matches the chart out of the box; both are
  // user-overridable (Markers tab) and also color the surprise rows in the popover.
  markers: {
    earnings: false, splits: false, dividends: false, news: false,
    earningsBeat: '#1ae51a', earningsMiss: '#c41f2d',
  },
  // Previous-day High / Low / Close reference lines (TC2000-style), INTRADAY charts
  // only. Each line anchors at the candle that MADE that level (high candle / low
  // candle / the session's last candle for close) and extends to the current candle
  // as new bars form. Per-line: enabled, color, style ('solid'|'dashed'|'dotted'),
  // width (1-4). Default ON with the TC2000 palette (green high, red low, grey close).
  prevDayLevels: {
    high:  { enabled: true, color: '#3cb868', style: 'dashed', width: 1 },
    low:   { enabled: true, color: '#e74c3c', style: 'dashed', width: 1 },
    close: { enabled: true, color: '#9aa0a6', style: 'dotted', width: 1 },
  },
  countdown: false,
  showPatterns: false,
  // Right-axis last-value labels. `showPriceLabels` = the boxed last-price tag on
  // the main series (on by default — matches prior behavior). `showMaLabels` = a
  // colored last-value chip per moving average (opt-in, off by default).
  showPriceLabels: true,
  showMaLabels: false,
  // Dark-pool print bars overlaid on the chart (the Dark Pool page look, brought
  // to any chart). OFF by default — opt-in, paid-gated. Bar + label colors are
  // 8-digit hex so the color menu's opacity slider is stored inline.
  darkPool: { enabled: false, barColor: '#c9a84ccc', labelColor: '#c9a84c' },
  // The three UCT signature overlays (dark-pool price levels, GEX walls, options
  // flow signals). All OFF by default — they are opt-in, so an existing user's
  // chart is unchanged until they turn one on.
  signature: { darkPoolLevels: false, gexWalls: false, flowSignals: false },
  // Engine state (Phase B). Nothing writes these yet -- they exist first so a
  // read-merge-write cycle from an un-migrated surface can never destroy engine
  // data. mergeChartSettings' return is an explicit allow-list: a key absent
  // from it is silently dropped on EVERY read.
  //
  // ⭐ VERSION 2 (B5 Task 9): the blob stops enumerating indicators. A stored
  // blob BELOW 2 gets its `indicators.<id>` folded into `indicatorInstances`
  // once, at read time. See `mergeChartSettings`.
  settingsVersion: 2,
  indicatorInstances: [],
  // ⭐ B5 TASK 4 — `engineEnabled` STOOD HERE, AND IT IS DELETED, NOT FLIPPED.
  // Record: `docs/decisions/2026-08-04-engine-enabled-deleted.md`.
  //
  // It said "THE ENGINE LANDS DARK", and it never did that job: `mergeChartSettings`
  // answered the flag from the STORED BLOB, never from this declaration, so this
  // line was consulted by nothing and flipping it to `true` would have healed
  // nobody. Its one remaining job was to tell a MIGRATED-but-UN-FLIPPED definition
  // from a FLIPPED one — a state that exists only inside a migration and that B5
  // never creates, because every migration in this phase flips in the same commit.
  //
  // ⛔ Left `?? true` it would have read as live logic: a guard on a key nothing
  // writes, taking the OFF branch forever, next to a comment claiming it decides
  // whether a whole render path runs.
  hideDrawings: false,  // hide all drawings without deleting them
  extendedHoursShading: true,  // "Extended hours" toggle — ON shows pre/post-market price data + shading on intraday; OFF = regular session only (9:30–4:00 ET) with overnight gaps
  sessionView: 'regular',      // D/W/M "Regular Hours" vs "Include pre/post-market" preview candle — PERSISTED so the user's choice sticks across refreshes/sessions
  volumeOverlayIndicators: [],   // oscillator keys rendered inside the volume pane (left axis)

  theme: 'dark', // 'dark' | 'light'

  positionCalc: {
    accountSize: 50000,   // user's account in $
    riskPct: 1,           // % of account to risk per trade (default 1%)
  },

  preset: 'classic',
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const PRESETS = {
  classic: {
    label: 'Classic Dark',
    desc: 'UCT signature dark theme',
    swatch: '#1a1c17',
    settings: { ...CHART_DEFAULTS, preset: 'classic' },
  },
  oled: {
    label: 'OLED Black',
    desc: 'Pure black for AMOLED screens',
    swatch: '#000000',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'oled',
      background: '#000000',
      textColor: '#666666',
      grid: { color: 'rgba(255,255,255,0.06)', visible: true },
      crosshair: { color: '#555555', style: 3 },
      candles: {
        upColor: '#00c853',
        downColor: '#ff1744',
        upBorder: '#00c853',
        downBorder: '#ff1744',
        upWick: '#00c853',
        downWick: '#ff1744',
      },
      volume: {
        visible: true,
        upColor: 'rgba(0,200,83,0.3)',
        downColor: 'rgba(255,23,68,0.3)',
        hvcEnabled: true,
      },
    },
  },
  tradingview: {
    label: 'TradingView',
    desc: 'Standard TradingView dark',
    swatch: '#131722',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'tradingview',
      background: '#131722',
      textColor: '#787b86',
      grid: { color: 'rgba(42,46,57,0.5)', visible: true },
      crosshair: { color: '#787b86', style: 0 },
      candles: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        upBorder: '#26a69a',
        downBorder: '#ef5350',
        upWick: '#26a69a',
        downWick: '#ef5350',
      },
      overlays: [
        { enabled: true, type: 'EMA', period: 9,   color: '#2196f3' },
        { enabled: true, type: 'EMA', period: 20,  color: '#e040fb' },
        { enabled: true, type: 'SMA', period: 50,  color: '#ff9800' },
        { enabled: true, type: 'SMA', period: 200, color: '#f44336' },
      ],
      volume: {
        visible: true,
        upColor: 'rgba(38,166,154,0.35)',
        downColor: 'rgba(239,83,80,0.35)',
        hvcEnabled: true,
      },
    },
  },
  light: {
    label: 'Light',
    desc: 'Clean white light theme',
    swatch: '#ffffff',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'light',
      background: '#ffffff',
      textColor: '#555555',
      grid: { color: 'rgba(0,0,0,0.08)', visible: true },
      crosshair: { color: '#999999', style: 3 },
      candles: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        upBorder: '#26a69a',
        downBorder: '#ef5350',
        upWick: '#26a69a',
        downWick: '#ef5350',
      },
      overlays: [
        { enabled: true, type: 'EMA', period: 9,   color: '#2196f3' },
        { enabled: true, type: 'EMA', period: 20,  color: '#e040fb' },
        { enabled: true, type: 'SMA', period: 50,  color: '#ff9800' },
        { enabled: true, type: 'SMA', period: 200, color: '#f44336' },
      ],
      volume: {
        visible: true,
        upColor: 'rgba(38,166,154,0.3)',
        downColor: 'rgba(239,83,80,0.3)',
        hvcEnabled: true,
      },
    },
  },
}

// Theme-aware default for a NEW chart widget: a light-canvas version of the app's
// standard look (white canvas + contrasting text/grid, the same MA overlays) with
// the standard up/down colors, used when a chart widget is PLACED on the LIGHT app
// theme. Stamped into the widget's opts.settings at creation so it FREEZES — a later
// app-theme switch never recolors an existing chart — exactly like the other widgets.
// Dark themes keep CHART_DEFAULTS (the current default).
export const CHART_LIGHT_DEFAULT = {
  ...CHART_DEFAULTS,
  preset: 'custom',
  background: '#ffffff',
  textColor: '#1f2328',
  grid: { ...CHART_DEFAULTS.grid, color: 'rgba(0,0,0,0.08)' },
  crosshair: { ...CHART_DEFAULTS.crosshair, color: '#999999' },
  candles: {
    ...CHART_DEFAULTS.candles,
    upColor: '#17a917', downColor: '#db000b',   // green/red bodies
    upBorder: '#000000', downBorder: '#000000', // black borders
    upWick: '#000000', downWick: '#000000',     // black wicks
  },
  header: {
    ...CHART_DEFAULTS.header,
    titleMode: 'both',            // TICKER (Company Name)
    fields: [],                   // info row: nothing selected
    showMarketCap: false, showNextEarnings: false, showUctRating: false,
    colors: {
      title: '#000000',
      legend: '#000000',
      dayChangeUp: '#17a917',
      dayChangeDown: '#db000b',
    },
  },
  // Overlays merge POSITIONALLY — keep the same 5 slots/order, only recolor + toggle.
  overlays: [
    { enabled: true,  type: 'EMA', period: 9,   color: '#17a917', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true,  type: 'EMA', period: 20,  color: '#d24ba8', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true,  type: 'SMA', period: 50,  color: '#3f7fe0', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true,  type: 'SMA', period: 200, color: '#e0862f', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: false, type: 'SMA', period: 5,   color: 'rgba(168,162,144,0.55)', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
  ],
  volume: { ...CHART_DEFAULTS.volume, upColor: '#17a917', downColor: '#db000b', maColor: '#000000' },
  watermark: { ...CHART_DEFAULTS.watermark, color: '#9a9a9a', opacity: 1 },
  markers: { ...CHART_DEFAULTS.markers, earnings: true, earningsBeat: '#17a917', earningsMiss: '#db000b' },
  prevDayLevels: {
    ...CHART_DEFAULTS.prevDayLevels,
    high: { ...CHART_DEFAULTS.prevDayLevels.high, color: '#17a917' },
    low:  { ...CHART_DEFAULTS.prevDayLevels.low,  color: '#db000b' },
  },
}

/** The chart-settings blob a NEW chart widget starts from for the given app theme. */
export function chartDefaultsForTheme(theme) {
  return theme === 'light' ? CHART_LIGHT_DEFAULT : CHART_DEFAULTS
}

// ─── Deep merge user settings over defaults ──────────────────────────────────

export function mergeChartSettings(userSettings) {
  if (!userSettings) return { ...CHART_DEFAULTS }

  let parsed = userSettings
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return { ...CHART_DEFAULTS } }
  }

  // Heal the legacy DIM volume default. rgba(0,200,83,0.3) / rgba(255,23,68,0.3)
  // was a different hue from the candles AND only 30% opacity, so volume rendered
  // dim + mismatched over the black canvas. Snap it to the candle colors at full
  // opacity (the intended UCT-default look) so EVERY chart — new layouts and added
  // widgets included — matches out of the box, without the user re-applying "UCT
  // Default". Only the two exact legacy strings heal; a deliberate custom volume
  // color is never touched.
  const _candles = { ...CHART_DEFAULTS.candles, ...(parsed.candles || {}) }
  const _volume = { ...CHART_DEFAULTS.volume, ...(parsed.volume || {}) }
  const _norm = (c) => (c || '').replace(/\s+/g, '').toLowerCase()
  if (_norm(_volume.upColor) === 'rgba(0,200,83,0.3)') _volume.upColor = _candles.upColor
  if (_norm(_volume.downColor) === 'rgba(255,23,68,0.3)') _volume.downColor = _candles.downColor

  // The STORED legacy section, captured before the allow-list below destroys it.
  // A non-object (`null`, an array, a string) is not a section — treated as
  // absent rather than as data, so a malformed blob folds to nothing instead of
  // throwing on the read path every chart is on.
  const _legacyIndicators = (parsed.indicators && typeof parsed.indicators === 'object'
    && !Array.isArray(parsed.indicators)) ? parsed.indicators : null
  // The version the blob CLAIMS. Read once, here, because `out.settingsVersion`
  // is unconditionally 2 — the read heals.
  const _storedVersion = Number.isFinite(parsed.settingsVersion) ? parsed.settingsVersion : 1

  const out = {
    chartType: parsed.chartType || CHART_DEFAULTS.chartType,
    invertScale: parsed.invertScale ?? CHART_DEFAULTS.invertScale,
    candles: _candles,
    candleColorMode: parsed.candleColorMode || CHART_DEFAULTS.candleColorMode,
    background: parsed.background || CHART_DEFAULTS.background,
    bgMode: parsed.bgMode || CHART_DEFAULTS.bgMode,
    bgGradient: { ...CHART_DEFAULTS.bgGradient, ...(parsed.bgGradient || {}) },
    textColor: parsed.textColor || CHART_DEFAULTS.textColor,
    textSize: parsed.textSize ?? CHART_DEFAULTS.textSize,
    grid: { ...CHART_DEFAULTS.grid, ...(parsed.grid || {}) },
    crosshair: { ...CHART_DEFAULTS.crosshair, ...(parsed.crosshair || {}) },
    header: {
      ...CHART_DEFAULTS.header,
      ...(parsed.header || {}),
      timeframes: Array.isArray(parsed.header?.timeframes) ? parsed.header.timeframes : CHART_DEFAULTS.header.timeframes,
      customTimeframes: Array.isArray(parsed.header?.customTimeframes) ? parsed.header.customTimeframes : CHART_DEFAULTS.header.customTimeframes,
      // Deep-merge colors: the spread above replaces the whole `header` object, so a
      // stored partial `colors` (e.g. only marketCap set) would drop the others'
      // defaults. Same trap `timeframes` guards against — merge, never wholesale-swap.
      colors: { ...CHART_DEFAULTS.header.colors, ...(parsed.header?.colors || {}) },
      // ⭐ RESOLVED FROM THE STORED BLOB, and it must be — `legendModeOf(parsed)`,
      // never `legendModeOf(out)`. The spread above has already injected the
      // default `legendMode: 'always'`, so re-reading the merged object would
      // find that default and the legacy `showLegend: false` fallback would
      // never fire: every user who had turned the legend OFF would get it back
      // on their next page load. Same shape as `_legacyIndicators` below —
      // capture the stored value before the allow-list overwrites it.
      //
      // ⛔ The rule itself is NOT restated here. `legendModeOf` is the one
      // reader; this line only pre-resolves it so a merged blob and a raw blob
      // give the same answer.
      // ⭐ ONLY AN EXPLICIT CHOICE IS CARRIED THROUGH — never a resolved default.
      // `explicitLegendMode` returns undefined when the user never picked one, and
      // spreading `{}` leaves the key ABSENT so `legendModeOf` re-derives it on
      // every read. Emitting `legendModeOf(parsed)` here is what froze the old
      // default into real users' settings.
      ...(explicitLegendMode(parsed) ? { legendMode: explicitLegendMode(parsed) } : {}),
    },
    // Positional merge, PADDED to the defaults' length: a stored blob written before a
    // slot was added is shorter, and .map alone would drop the new slot forever.
    overlays: Array.isArray(parsed.overlays)
      ? CHART_DEFAULTS.overlays.map((d, i) => ({ ...d, ...(parsed.overlays[i] || {}) }))
        .concat(parsed.overlays.slice(CHART_DEFAULTS.overlays.length))
      : CHART_DEFAULTS.overlays.map(o => ({ ...o })),
    volume: _volume,
    watermark: {
      ...CHART_DEFAULTS.watermark,
      ...(parsed.watermark || {}),
      lines: { ...CHART_DEFAULTS.watermark.lines, ...((parsed.watermark || {}).lines || {}) },
    },
    drawingDefaults: { ...CHART_DEFAULTS.drawingDefaults, ...(parsed.drawingDefaults || {}) },
    // ⭐⭐ B5 TASK 9 — FIFTEEN LINES, NOW ONE. Ledger site #2, retired.
    //
    // ⛔ THIS IS A HARD ALLOW-LIST AND THAT IS THE MECHANISM, not a side effect:
    // a key absent from this return is DESTROYED on every read. So the fourteen
    // legacy sections are not "no longer merged", they are DELETED from every
    // blob the moment it is read — which is why the claim is asserted by what it
    // destroys (`settingsBlobMigration.test.js` → *the allow-list, asserted by
    // what it DESTROYS*) rather than by the text of this line. A source-text
    // guard cannot tell a deleted line from a renamed one, and this is the same
    // allow-list that nearly destroyed `indicatorInstances` in B1.
    //
    // ⚠️ THE FOLD BELOW READS `parsed.indicators`, NOT THIS. Reading this object
    // would fold `{volumeProfile}` — i.e. nothing — and stamp `settingsVersion: 2`
    // on the way out, so every user would silently lose every indicator with no
    // way to retry. `settingsBlobMigration.test.js` pins that ordering by name.
    indicators: {
      volumeProfile: { ...CHART_DEFAULTS.indicators.volumeProfile, ...(_legacyIndicators?.volumeProfile || {}) },
    },
    swingLabels: { ...CHART_DEFAULTS.swingLabels, ...(parsed.swingLabels || {}) },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    percentScale: parsed.percentScale ?? CHART_DEFAULTS.percentScale,
    comparisonSymbols: Array.isArray(parsed?.comparisonSymbols)
      ? parsed.comparisonSymbols
      : CHART_DEFAULTS.comparisonSymbols,
    compareHideBase: parsed.compareHideBase ?? CHART_DEFAULTS.compareHideBase,
    markers: { ...CHART_DEFAULTS.markers, ...(parsed.markers || {}) },
    prevDayLevels: {
      high:  { ...CHART_DEFAULTS.prevDayLevels.high,  ...(parsed.prevDayLevels?.high || {}) },
      low:   { ...CHART_DEFAULTS.prevDayLevels.low,   ...(parsed.prevDayLevels?.low || {}) },
      close: { ...CHART_DEFAULTS.prevDayLevels.close, ...(parsed.prevDayLevels?.close || {}) },
    },
    countdown: parsed.countdown ?? CHART_DEFAULTS.countdown,
    showPatterns: parsed.showPatterns ?? CHART_DEFAULTS.showPatterns,
    showPriceLabels: parsed.showPriceLabels ?? CHART_DEFAULTS.showPriceLabels,
    showMaLabels: parsed.showMaLabels ?? CHART_DEFAULTS.showMaLabels,
    darkPool: { ...CHART_DEFAULTS.darkPool, ...(parsed.darkPool || {}) },
    signature: { ...CHART_DEFAULTS.signature, ...(parsed.signature || {}) },
    // ⭐ ALWAYS 2 — the read heals, so what comes OUT is always the current
    // version whatever went in. `parsed.settingsVersion` is read once, above the
    // return, to decide whether the fold runs; echoing it here would make a
    // preset that writes `1` re-run the migration forever (record §6 R2) and
    // re-seed instances the user has since deleted.
    settingsVersion: 2,
    indicatorInstances: Array.isArray(parsed.indicatorInstances) ? parsed.indicatorInstances : [],
    // ⭐⭐ B5 TASK 4 — `engineEnabled: parsed.engineEnabled === true` STOOD HERE.
    //
    // 🔑 THIS LINE, NOT THE DECLARATION, WAS THE FLAG. It read the STORED BLOB,
    // so an absent key and an explicit `false` were the SAME ANSWER and every
    // `chart_settings` row in production — all of which predate the engine —
    // merged to `false`. That is why "flip the default" was the trap and not the
    // fix, and why the resolution is DELETION: this allow-list is hard, so with
    // the line gone the key is not emitted at all, and a stored `engineEnabled`
    // (`true`, `false`, or a `"1"` from a URL param) is destroyed on the next read
    // exactly like any other key nobody declared.
    //
    // ⚠️ THE READER THAT NEEDS TO KNOW IS `enumerationSites.test.js`, and it reads
    // this file COMMENT-STRIPPED on purpose — the biconditional it asserts (*the
    // record says OPEN ⟺ this line exists*) would otherwise read this tombstone as
    // the flag and stay green forever.
    hideDrawings: parsed.hideDrawings ?? CHART_DEFAULTS.hideDrawings,
    extendedHoursShading: parsed.extendedHoursShading ?? CHART_DEFAULTS.extendedHoursShading,
    sessionView: parsed.sessionView === 'extended' ? 'extended' : CHART_DEFAULTS.sessionView,
    volumeOverlayIndicators: Array.isArray(parsed.volumeOverlayIndicators)
      ? parsed.volumeOverlayIndicators
      : CHART_DEFAULTS.volumeOverlayIndicators,
    theme: parsed?.theme === 'light' ? 'light' : 'dark',
    positionCalc: { ...CHART_DEFAULTS.positionCalc, ...(parsed.positionCalc || {}) },
    preset: parsed.preset || 'classic',
  }

  // ─── v1 → v2: the blob stops enumerating indicators ────────────────────────
  //
  // A read-time, versioned migration (record §6 R1a). It heals on the next READ,
  // writes nothing by itself, and is a pure function — which is what makes it
  // testable against real blob STRINGS, the shape a fixture built as an object
  // skips.
  //
  // ⛔ IT RUNS ONLY BELOW THE NEW VERSION. A v2 blob is authoritative even when
  // it carries a stale `indicators` mirror: a user who removed RSI must not get
  // it back on every load, and R2's re-migration loop (a preset writing v1
  // forever) cannot exist if the rule is unconditional on version alone.
  //
  // ⛔ AND IT READS `_legacyIndicators` — the STORED section — not `out.indicators`,
  // which by this point is `{volumeProfile}`. Folding the wrong one loses every
  // indicator for every user and stamps version 2 so it can never be retried.
  //
  // `normalizeInstances` is what a stored TOMBSTONE survives through: the
  // migrator reserves its id (so a still-true legacy toggle cannot resurrect it)
  // and the normaliser routes it to `removed`, so it is re-attached below rather
  // than dropped — a tombstone that did not survive this fold would resurrect
  // the indicator on the next page load, which is far harder to notice than on
  // the next paint.
  if (_storedVersion < 2) {
    const stored = out.indicatorInstances
    // 🐛 A DEFINITION THE BLOB ALREADY DRAWS IS NOT SEEDED AGAIN, and this is the
    // §6.1 double-draw in its most permanent form. `migrateLegacyToInstances`
    // reserves ids PER INSTANCE ID (`legacy:rsi`), which is right for its own
    // contract — two instances of one definition are legal. But a legacy TOGGLE
    // is per DEFINITION and is a compatibility shim for a blob that has no
    // instance for that definition at all. A blob holding
    // `{instanceId: 'grid-cell-3:rsi', defId: 'rsi'}` plus `indicators.rsi.enabled`
    // would otherwise seed a SECOND `legacy:rsi` — two RSI lines, and unlike the
    // render-time version of this bug the answer would be WRITTEN BACK at v2 and
    // never re-migrated. `StockChart`'s `updateChart` applies the same rule to the
    // read-time projection; this is the write-shaped half of it.
    //
    // ⚠️ HIDDEN COUNTS, A TOMBSTONE DOES NOT. `normalizeInstances` keeps a hidden
    // instance and routes a tombstone to `removed`, which is exactly the line
    // "does this definition EXIST in the blob" needs — a tombstone's whole job is
    // to let "off" survive a still-true toggle, and it blocks the projection by
    // its id anyway inside the migrator's own `taken` set.
    const storedIds = new Set(
      stored.map(i => (i && typeof i === 'object' ? i.instanceId : undefined)),
    )
    //
    // ⭐⭐ PHASE C TASK 12 — `.filter(GLOBAL)` AND IT IS LOAD-BEARING, NOT TIDY.
    // "Already drawn" has to mean *drawn on every chart*, because that is the
    // question the legacy toggle asks: `cs.indicators.rsi.enabled` is a GLOBAL
    // fact with no chart id in it. A `scope`d instance draws on ONE chart, so
    // counting it here would suppress the global seed on its account and delete
    // the indicator from every OTHER chart — permanently, because the fold
    // stamps `settingsVersion: 2` on the way out and never runs again.
    //
    // ⛔ THE ALLOW-LIST IS HARD AT BOTH LEVELS AND THIS IS THE SECOND ONE.
    // `scope` belongs to the INSTANCE, inside `indicatorInstances` (which passes
    // through as an array), and never to the blob: a top-level `scope` would be
    // one chart id for a settings object that every chart reads.
    const liveStoredDefIds = new Set(
      normalizeInstances(stored, engineRegistry).kept
        .filter(i => instanceScope(i) === undefined)
        .map(i => i.defId),
    )
    const seeded = migrateLegacyToInstances(
      { indicatorInstances: stored,
        indicators: _legacyIndicators,
        volumeOverlayIndicators: out.volumeOverlayIndicators },
      engineRegistry,
    ).filter(i => (storedIds.has(i && i.instanceId)
      ? true                                        // stored: always
      : !liveStoredDefIds.has(i && i.defId)))       // seeded: not already drawn
    const { kept, removed } = normalizeInstances(seeded, engineRegistry)
    // ORDER: `migrateLegacyToInstances` returns existing instances first and then
    // the newly-seeded ones in `SHIPPED_STACK_ORDER`; `normalizeInstances`
    // preserves that order in `kept`. Tombstones come back on the end — they draw
    // nothing and reserve nothing, so their position carries no meaning, and
    // keeping them is what makes "off" survive the migration.
    out.indicatorInstances = removed.length ? [...kept, ...removed] : kept
  }
  return out
}

// Canonical per-cell chart style options (multi-chart grid): [value, label].
// gridLayouts derives its persisted-state whitelist from this list so the
// picker and the sanitizer can never drift apart. 'hlc' is rendered via
// OHLC_TYPES in StockChart; the older toolbar/settings pickers predate it.
export const CHART_TYPE_OPTIONS = [
  ['candles', 'Candles'], ['hollow', 'Hollow'], ['bars', 'Bars'],
  ['hlc', 'HLC'], ['line', 'Line'], ['area', 'Area'],
]

// ─── the instance shape and the override merge live in ONE module ────────────
//
// ⭐ B5 TASK 9 SPLIT THEM OUT — see `chart/instanceShape.js` for the measured
// reason (an eager-chunk regression, and an import cycle this file's new
// `engine/instances` import would otherwise create). They are RE-EXPORTED here,
// so every existing `from '.../chartDefaults'` keeps working and this is a move
// rather than a rename.
//
// ⚠️ MASTER'S `_OVERRIDE_SECTION_KEYS` ENTRY WENT WITH IT. The prev-day H/L/C
// lines (`93655d6a`) added `'prevDayLevels'` to that list while it still stood
// here; the list is the SECOND of this file's two hard allow-lists, so the entry
// had to move to `instanceShape.js` with the function or a per-cell override of
// `prevDayLevels` would have REPLACED the whole section instead of merging it.
export {
  instanceTombstone,
  isInstanceTombstone,
  mergeSettingsOverride,
} from './instanceShape'
