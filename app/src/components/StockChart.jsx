// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, BaselineSeries, ColorType, LineType, LineStyle } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings, mergeSettingsOverride } from './chart/chartDefaults'
import { createWatermarkPrimitive, composeWatermarkLines } from './chart/watermarkPrimitive'
import useTickerMeta from '../hooks/useTickerMeta'
import useWatermarkDrag from '../hooks/useWatermarkDrag'
import { panelFor, toolbarFor, sampleGradient, parseColor, luminance, menuThemeVars } from '../utils/dividerColor'
// ⛔⭐ THIS FILE IMPORTS **ZERO** `compute*` FUNCTIONS — B5 TASK 8, AND THAT IS
// THE WHOLE STATEMENT. All fourteen series-expressible natives are FLIPPED, so
// every column is computed once, by the definition that declares it, at bind
// time, from the same `filteredBars`. A `compute*` name reappearing in this
// import is a silent duplicate whose only observable effect is CPU — the classic
// way a "migrated" indicator keeps costing what it cost before — and it is now a
// BEHAVIOURAL assertion rather than a comment: `enumerationSites.test.js` reads
// this import list and demands it be empty, with a non-vacuity control that finds
// TEN names at `084eeded`. (The count went 10 → 8 → 5 → 3 → 0 across Tasks 5, 6,
// 7 and 8; only the last of those is a shape a format-exact regex could not fake.)
//
// `toHeikinAshi` is NOT an indicator — it is a candle transform that rewrites the
// OHLC the price series draws — so it stays, and it is the only thing left here.
import { toHeikinAshi } from './chart/indicators'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import ChartCalloutOverlay from './chart/ChartCalloutOverlay'
import ChartVLineOverlay from './chart/ChartVLineOverlay'
import SetupMoveOverlay from './chart/SetupMoveOverlay'
import { classifyLiveBar } from './chart/liveBarClassify'
import { applySessionCandle, computeSessionTagLines, etMinutes } from './chart/sessionPreview'
import { etDayOf, snapSyncedBar } from './chart/crosshairSync'
import useMarketOpen from '../hooks/useMarketOpen'
import { getExtSessionCached, anchorNoonSec } from '../utils/extSession'
import useSessionExtBars from '../hooks/useSessionExtBars'
import EarningsMarkerPopover from './chart/EarningsMarkerPopover'
import { createEarningsBadgePrimitive } from './chart/earningsBadgePrimitive'
import { ThinVolumeSeries } from './chart/thinVolumeSeries'
import PatternOverlay from './chart/PatternOverlay'
import PatternSidePanel from './chart/PatternSidePanel'
import ChartToolbar from './chart/ChartToolbar'
import { VOLUME_PANE_SURFACE_FIXED } from './chart/indicatorRegistry'
import { resolveChartRegion, resolveChartRegionFromPanes } from './chart/chartRegion'
import { clampVolPct, resolveVolPanePct, latchOnDrag } from './chart/volumePaneDrag'
// ⚠️ `INDICATOR_LABELS` USED TO BE IMPORTED FROM `chartRegion` ALONGSIDE THESE.
// B4 retired that nine-row table into the catalogue; `labelFor` is the reader.
import { catalogRows, labelFor, oscillatorIds } from './chart/indicatorCatalog'
import { createSessionShadingPrimitive, computeSessionBands } from './chart/sessionShadingPrimitive'
import { createSwingLabelsPrimitive } from './chart/swingLabelsPrimitive'
import { createLevelZonesPrimitive } from './chart/levelZonesPrimitive'
import { createPrevDayLevelsPrimitive, computePrevDayLevels, buildPrevDayLines } from './chart/prevDayLevelsPrimitive'
import { detectSwingPivots, sensitivityToParams } from './chart/swingPivots'
import { createBinder } from './chart/engine/binder'
import { resolvePlacement, resolvePreset } from './chart/engine/placement'
import { registerManifestChart } from './chart/engine/paneLayout'
// ⚠️ `engineOwnedDefIds` is NOT imported here any more (B5 Task 4). It is not
// dead — it keeps its own suite in `engine/instances.test.js` — but StockChart's
// call was its last production use, and the value that call produced had had ZERO
// readers since Flip B deleted the guarded blocks.
import { normalizeInstances, legacyInstanceId, migrateLegacyToInstances } from './chart/engine/instances'
import { eligibleInstances } from './chart/engine/eligibility'
import { ENGINE_OWNED, engineDrawsAnything, engineDrawnDefIds } from './chart/engine/flipState'
// ⭐ FLIP C, APPLIED (B5 Task 12). `paneMode()` is `'panes'`. `computePaneLayout`
// is now the ONE geometry authority — it answers both "which pane" and, through
// `layout.bands`, the band question `chart/paneMargins.js` used to answer before
// Flip C retired it.
import {
  paneMode, computePaneLayout, paneStackHeightPx, SEPARATOR_PX, NO_STACK_MAIN_MARGINS,
} from './chart/engine/paneLayout'
// ⭐ chart-UX-walls TASK 4 — `setInstanceHidden` / `removeInstance` join the two
// readers already here. They are DOOR EIGHT (the per-INSTANCE door), and the chip
// strip is its second caller after `IndicatorSettingsDialog`;
// `engine/__tests__/controlDoorCensus.test.js` ledgers this file BY NAME with the
// reason, and went red the moment the names appeared.
// ⭐ chart-UX-walls TASK 6 — `addInstance` joins them, for the chip menu's
// Duplicate row. It shipped at Task 1 with ZERO call sites and the census
// asserted that zero rather than assuming it; this is the caller it was built for.
import {
  setIndicatorEnabled, isIndicatorEnabled, findInstance,
  setInstanceHidden, removeInstance, withInstances, addInstance,
} from './chart/engine/instanceControls'
// ⭐ `legendChips`, NOT `engineChips` (chart-UX-walls Task 3). `engineChips`
// walks BINDINGS and `planBindings` drops a hidden instance, so a hidden
// indicator had no chip — and a chip you cannot see is one you cannot un-hide
// from. `legendChips` walks the INSTANCE list and calls `engineChips` for the
// valued half, so there is still exactly one formatting pipeline.
import { legendChips } from './chart/engine/readout'
import * as engineRegistry from './chart/engine/nativeRegistry'
import IndicatorChip from './chart/legend/IndicatorChip'
import chipStyles from './chart/legend/IndicatorChip.module.css'
import { chipMenuItems } from './chart/legend/chipMenu'
// ⭐ THE PER-PLOT REPAINT VERDICT — DERIVED BY THE LINTER, NEVER READ OFF A
// BADGE. See `engine/repaintVerdict.js`'s header for why it is computed rather
// than stored and how it relates to the definition's own `meta.repaint`.
import { plotRepaintNotice, repaintNotices } from './chart/engine/repaintVerdict'
import ContextPopover from './mobile/ContextPopover'
import IndicatorSettingsDialog from './chart/IndicatorSettingsDialog'
import { usePatternDetections } from '../hooks/usePatternDetections'
import { useSignatureIndicators } from '../hooks/useSignatureIndicators'
import { useInstalledUserDefinitions } from '../hooks/useUserDefinitions'
import { useIsPaid } from '../context/AuthContext'
import useRealtimePrices from '../hooks/useRealtimePrices'
import { getSnapshot as getLivePriceStoreSnapshot } from '../hooks/livePriceStore'
import useRealtimeBars from '../hooks/useRealtimeBars'
import * as realtimeCandle from '../lib/realtimeCandle'
import * as barsStreamManager from '../lib/barsStreamManager'
import { publishChartReadout } from '../lib/chartReadoutStore'
import { shouldApplyRange } from '../pages/charts/grid/rangeGuard'
// The engine's "nothing to draw" answer. Module-scope and frozen so a chart with
// no instances allocates nothing per paint and nobody can mutate the "no engine"
// answer into a "some engine" one.
//
// ⚠️ `EMPTY_OWNED` stood beside this and went with `engineOwned` at B5 Task 4 —
// it had exactly two occurrences, its declaration and that one `else` arm.
const EMPTY_INSTANCES = Object.freeze([])
// The crosshair legend's "nothing to print" answer. Frozen and module-scope for
// the same reason as the one above: the hover path runs once per animation frame
// and must allocate nothing when there are no indicators on the chart.
const EMPTY_CHIPS = Object.freeze([])

/** Spec §7: ">4 chips collapses to +N". Four is the shipped number and it is a
 *  DESIGN constant, not a tuning knob — a fifth chip is where a 200px-wide strip
 *  starts middle-truncating labels.
 *
 *  ⚠️ THE SPEC'S FOUR IS PER PANE AND THE SHIPPED LEGEND IS ONE BOX FOR THE
 *  WHOLE CHART (controller ruling: per-pane placement is out of scope). So the
 *  tail is FOLDED, not dropped — `chipStyles.chipFolded` takes it out of the
 *  layout and out of the accessibility tree, the `+N` button brings it back, and
 *  the chips stay mounted. See that class's comment for the two reasons. */
const CHIP_COLLAPSE_AT = 4

/**
 * One `chipMenu` row → one `ContextPopover` row.
 *
 * ⛔ THE ICON IS A `UIcon` NAME IN `chipMenu.js` AND A `UIcon` ELEMENT HERE, and
 * that split is deliberate: `chipMenu.js` is pure (no React, so it can be driven
 * against the real placement resolver in a plain unit test), while
 * `ContextPopover` renders `it.icon` VERBATIM — its own doc example passes an
 * emoji, which this codebase does not do (`UIcon` is the single source of
 * iconography). The name crosses the boundary; the element is built here.
 *
 * ⛔ AND A REFUSED ROW SHOWS ITS REASON. `chipMenu`'s `disabled` is a SENTENCE,
 * not a boolean, precisely so the user is told why "Move to → Volume pane" is
 * dead instead of clicking a grey line repeatedly. `ContextPopover` renders the
 * label node as-is, so the reason rides along beside it.
 */
function chipMenuRowToPopoverRow(it) {
  if (it.separator) return it
  const icon = it.icon ? <UIcon name={it.icon} size={13} gold={false} /> : undefined
  if (!it.disabled) return { ...it, icon }
  return {
    ...it,
    icon,
    label: (
      <>
        <span>{it.label}</span>
        <span style={{ display: 'block', fontSize: 10.5, opacity: 0.62, lineHeight: 1.35, marginTop: 1 }}>
          {it.disabled}
        </span>
      </>
    ),
  }
}

// ⛔ `LEGACY_CHIP_ORDER` STOOD HERE AND IS DELETED (B5 Task 6). It was the order
// the LEGACY lane's chips appeared in, derived from the registry so that a chart
// which turned an indicator on late could not push its chips to the end of the
// legend (a `Map` orders by FIRST set). With `sar` and `ichimoku` flipped there
// are no legacy registrations left to order — every chip comes from
// `engineChips`, whose order is the BINDING order, which is instance order ×
// plot order. See the note where `legacyChipEntriesRef` used to be.

// THE DOUBLE-DRAW RAIL, and the toolbar's "am I still connected to anything?"
// predicate. Both live in `engine/flipState.js` because `ChartToolbar` is
// rendered BY this file and cannot import from it — see that module's header.
// Re-exported here so the ledger + wiring tests keep their import path.
// `ENGINE_OWNED` rides along for the same reason — the plan names
// `StockChart.jsx` as its home, and `flipState.js` is where it can actually live
// without `ChartToolbar` importing from the component that renders it.
export { ENGINE_OWNED }
// ⛔ `indPoint` STOOD HERE, AND IT WENT WITH THE `indicatorData` MEMO (B5 Task
// 8) — its only caller. It turned each NaN-padded compute output into an LWC
// WHITESPACE item (`{time}` with no `value`), because LWC rejects `value: NaN`
// outright and a leaked NaN renders as a line diving to zero. That conversion is
// not gone from the app, it moved: `binder.js`'s `toPoints` does it for every
// engine-drawn series, once, from the Float64Array column.
// True for an LWC whitespace item (no value, and no OHLC either — candle and
// volume data go through the same _applyData).
const isWhitespacePoint = (p) => !!p && p.value === undefined && p.open === undefined
// ⛔ NO `MACD_HIST_UP` / `MACD_HIST_DOWN` — MACD is FLIPPED (B3 Task 11) and its
// `indicatorData` branch, the only reader those two literals had, is deleted.
// The two colours live in ONE place now: `nativeRegistry`'s macd histogram plot,
// which is where the sign test that chooses between them also lives.
// `grep -rn "MACD_HIST_" app/src/` returns `nativeRegistry.js` (as `colorUp` /
// `colorDown` literals) plus the two test files that keep their own copies so a
// silent edit there fails.

// The renderer surface the indicator engine's binder asks for: the four series
// constructors any v1 plot can need, plus the two style enums. Assembled from
// NAMED imports rather than `import * as` so lightweight-charts still tree-shakes
// — a namespace object indexed dynamically (`LWC[ctorName]`) pins the whole
// library into the bundle.
//
// Built on FIRST USE, not at module scope, and memoised so its identity is stable
// across paints. Lazily because the dark contract is worth taking literally: with
// the engine off StockChart does not so much as READ these exports, which also
// means it cannot break a caller whose lightweight-charts double predates them.
let _engineLwc = null
const engineLwc = () => (_engineLwc || (_engineLwc = {
  LineSeries, HistogramSeries, AreaSeries, BaselineSeries, LineStyle, LineType,
}))

// Beyond this, a Massive bar tick is considered stale and the legend falls back
// to the Finnhub price (mirrors BAR_TICK_FRESH_MS in useRealtimeBarPrices).
const LIVE_TICK_FRESH_MS = 6000
// Default-zoom: place the LAST candle at this fraction of the plot width on EVERY
// timeframe so flipping D/W/M/intraday never drifts it left/right. (A fixed
// bars-of-right-pad drifts because bar spacing widens as fewer bars show.)
const LAST_CANDLE_POS = 0.96
// …but 4% of the plot is ~40px on a full-width chart and only ~12px inside a
// narrow workspace widget, which parks the newest candle right on top of the
// price-scale tags (most visibly the pre-market "Pre" label). So treat the gap
// as a PIXEL minimum instead of a pure fraction: wide charts keep the exact
// 0.96 anchor, narrow ones give the last candle real clearance. Capped so a
// very thin widget doesn't spend a sixth of its width on blank space.
const MIN_RIGHT_GAP_PX = 34
const MAX_RIGHT_GAP_FRAC = 0.16
function lastCandlePos(plotWidthPx) {
  if (!Number.isFinite(plotWidthPx) || plotWidthPx <= 0) return LAST_CANDLE_POS
  const gap = Math.min(MAX_RIGHT_GAP_FRAC, Math.max(1 - LAST_CANDLE_POS, MIN_RIGHT_GAP_PX / plotWidthPx))
  return 1 - gap
}
// The candle plot's own width in px (excludes the right price axis). On a cold
// mount the time scale can still report 0, and falling through to the fixed
// fraction there would leave a freshly-opened narrow widget with no clearance —
// so approximate from the container (minus a typical price axis) instead.
// Null only when neither is measurable.
function plotWidthOf(chart, containerEl = null) {
  try {
    const w = chart?.timeScale?.().width?.()
    if (Number.isFinite(w) && w > 0) return w
  } catch { /* not laid out */ }
  const cw = containerEl?.clientWidth
  return Number.isFinite(cw) && cw > 70 ? cw - 62 : null
}

// Per-timeframe default number of visible bars (Daily on the workspace is
// overridden to ~126 ≈ 6 months via dailyDefaultBars).
const DEFAULT_VISIBLE_BARS = {
  '1': 390,   // ~1 trading day of 1min bars
  '5': 78,    // ~1 trading day of 5min bars
  '15': 78,   // ~3 trading days of 15min bars
  '30': 65,   // ~5 trading days of 30min bars
  '60': 65,   // ~10 trading days of 1hr bars
  'D': 65,    // ~3 months of daily bars
  'W': 52,    // ~1 year of weekly bars
  'M': 36,    // ~3 years of monthly bars
}

// Decide whether a captured visible range still DESCRIBES THE OLD DATA EXTENT
// (safe to re-anchor bars-from-right against the old count) or was ALREADY
// re-mapped by LWC to the new extent during setData (re-anchoring against the
// stale old count would extrapolate the view thousands of bars off the data —
// the blank multi-chart cells on series-length swaps). Any range whose right
// edge sits within the old extent's plausible window — which includes EVERY
// scrolled-back position — is treated as old, so scrolled-back users always
// keep the bars-from-right re-anchor. Only a range that is impossible for the
// old extent AND hugs the new extent's right edge is trusted as re-mapped;
// anything else falls back to the re-anchor (whose validity guard drops
// out-of-range results safely).
function rangeDescribesOldExtent(oldRange, oldCount, newCount) {
  if (!oldRange) return false
  if (oldRange.to <= oldCount + 8) return true
  const padNew = newCount - oldRange.to
  return !(padNew >= -8 && padNew <= 8)
}

// The canonical default-zoom visible logical range: the newest candle anchored at
// a CONSTANT fraction (LAST_CANDLE_POS) of the plot width, showing the timeframe's
// default history. Shared by the initial framing, the snap-back safety guard, and
// the right-click "Reset view" so all three land on the exact same window.
function computeDefaultLogicalRange(barsLen, tf, { dailyDefaultBars = null, leftBarPad = 0, rightPadBars = 3, visibleBarsOverride = null, plotWidthPx = null } = {}) {
  // visibleBarsOverride wins on ANY timeframe (the Sunday Scan hourly export
  // wants a wider window than the interactive default); dailyDefaultBars stays
  // Daily-only so the Charts workspace is untouched.
  const visibleBars = (visibleBarsOverride && visibleBarsOverride > 0)
    ? visibleBarsOverride
    : ((tf === 'D' && dailyDefaultBars) ? dailyDefaultBars : (DEFAULT_VISIBLE_BARS[tf] || 65))
  // Always size the window to `visibleBars` and anchor the newest candle at
  // LAST_CANDLE_POS. For a SHORT-history ticker (IPO/new ETF like SPCX/DRAM,
  // barsLen < visibleBars) `from` goes NEGATIVE → the few bars keep a normal
  // candle width with blank space to their left, instead of being STRETCHED to
  // fill the whole pane. Identical to before for normal tickers (barsLen >
  // visibleBars). LWC renders logical indices < 0 as leading whitespace.
  const from = barsLen - visibleBars - leftBarPad
  const hist = (barsLen - 1) - from
  const to = hist > 0 ? from + hist / lastCandlePos(plotWidthPx) : barsLen + rightPadBars
  return { from, to }
}

import useJ2ChartMarkers from '../pages/journal-2-0/hooks/useJ2ChartMarkers'
import CountdownTimer from './chart/CountdownTimer'
import styles from './StockChart.module.css'
import { streamStatus } from '../utils/streamStatus'
import brandMark from './intro/assets/compass-mark.png'
import { idbGet, idbPut, mergeDelta } from '../utils/barsIDB'
import { memPeek, memPut } from '../utils/barsMemCache'
import { resample, resampleForSpec } from '../utils/resampleBars'
import { isNativeTf, fetchTf, resampleSpec } from './chart/timeframes'
import { barsRenderPlan } from './chart/renderPlan'
import ChartSkeleton from './chart/ChartSkeleton'
import { normalizeToPctChange } from './chart/comparisonUtils'
import { composeScreenshot, downloadBlob, copyBlobToClipboard, chartStateToUrl, urlToChartState } from './chart/chartScreenshot'
import ScreenshotPopover from './chart/ScreenshotPopover'
import { INDICATOR_CHORDS, matchShortcut, resolveTfCycle } from './chart/keyboardShortcuts'
import KeyboardHelpOverlay from './chart/KeyboardHelpOverlay'
import PositionPanel from './chart/PositionPanel'
import UIcon from './ui/UIcon'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill, nextBackfillDepth } from '../utils/barsBackfill'

const NOOP = () => {}

// Stable empty Journal 2.0 overlay — used by curated book charts that opt out
// of the viewer's personal trade markers/price lines (hideJournalOverlay).
const EMPTY_J2 = { markers: [], priceLines: [] }

// Parse an ISO date / unix-seconds / unix-ms value to epoch milliseconds.
const _dateToMs = (v) => {
  if (v == null) return NaN
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

// Date-range presets for the bottom-left range bar (TC2000-style). Value = months
// back from the newest bar; 'ytd' = since Jan 1 of the newest bar's year. 12M and 1Y
// are intentionally both present (same ~12-month window) per the requested button set.
const RANGE_OPTS = [
  ['3M', 3], ['6M', 6], ['YTD', 'ytd'], ['1Y', 12], ['5Y', 60],
]

// Bars-worth of blank space to render on the LEFT when a framed window's start
// date predates the earliest loaded bar — e.g. a Setup Library / Model Book
// example whose frame start is before the stock's IPO (first-ever trading day).
// Lightweight-charts accepts a NEGATIVE `from` logical index, which paints empty
// space before bar 0, so the chart honors the requested start instead of clamping
// to the IPO bar and zooming in too far. Returns 0 when the start is not earlier
// than the first bar (the normal case — charts with lead-in/warm-up bars).
const PERIOD_MS = { D: 86400000, W: 604800000 }
const leadingBlankBars = (startMs, firstBarMs, tf) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(firstBarMs) || startMs >= firstBarMs) return 0
  const calDays = (firstBarMs - startMs) / 86400000
  if (tf === 'W') return Math.round(calDays / 7)            // one bar per week
  if (tf === 'D') return Math.round((calDays * 5) / 7)      // skip weekends
  const per = PERIOD_MS[tf] || 86400000                     // intraday book charts don't occur
  return Math.round((firstBarMs - startMs) / per)
}

// Throw on !ok so SWR's onErrorRetry sees a real error and backs off.
// Without this, a 503 with a JSON body parses as a successful response
// with bars=[], the chart paints blank, and SWR never retries. The bars
// route now returns 503 during transient SQLite-swap windows precisely
// so this retry loop can heal automatically. Also enforces a client-side
// timeout so a hung cold Massive fetch can't tie up the chart indefinitely.
const fetcher = async (url) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25000)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.status = r.status
      throw err
    }
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

// Conservative retry for transient (5xx / aborted-network) failures.
// Cold Massive fetches can legitimately take 5–15s, so aggressive 1s
// retries multiply in-flight load across many mounted charts → a normally-
// slow request becomes a stampede that's MUCH slower. Floor 15s, exponential
// up to 60s, hard cap 4 retries (~3 min). During retry, the chart's existing
// bars selector falls back to idbBars — user sees last-known data, not blank.
// 4xx skip retry: real client errors.
const barsSwrOnErrorRetry = (error, _key, _config, revalidate, { retryCount }) => {
  const status = error?.status
  if (status && status >= 400 && status < 500) return
  if (retryCount >= 4) return
  const delay = Math.min(15000 * Math.pow(1.5, retryCount), 60000)
  setTimeout(() => revalidate({ retryCount }), delay)
}

// ─── Legend helpers ─────────────────────────────────────────────────────────

function formatLegendTime(time) {
  if (typeof time === 'string') return time
  const d = new Date(time * 1000)
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

// ─── Time-axis formatting ───────────────────────────────────────────────────
// Intraday bar times are pre-shifted to ET (adjustTime adds _ET_OFFSET), so we
// read the UTC parts of the shifted value to get ET wall-clock. Daily+ times are
// 'YYYY-MM-DD' strings (or business-day objects) with no time-of-day.
const _WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const _MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function _fmt12(d) {
  let h = d.getUTCHours(); const m = d.getUTCMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// Parse a daily+ time (string or business-day object) → a UTC Date, or null.
function _dayDate(time) {
  let y, mo, day
  if (typeof time === 'string') { const p = time.split('-'); y = +p[0]; mo = +p[1]; day = +p[2] }
  else if (time && typeof time === 'object') { y = time.year; mo = time.month; day = time.day }
  else return null
  if (!y) return null
  return new Date(Date.UTC(y, (mo || 1) - 1, day || 1))
}

// Bottom-axis TICK labels: 12-hour time on intraday, dates otherwise.
// tickMarkType (LWC): 0=Year 1=Month 2=DayOfMonth 3=Time 4=TimeWithSeconds.
function chartTickMarkFormatter(time, tickMarkType) {
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    if (tickMarkType >= 3) return _fmt12(d)                       // time tick → 12-hour
    return `${_MO[d.getUTCMonth()]} ${d.getUTCDate()}`           // intraday day-boundary
  }
  const d = _dayDate(time)
  if (!d) return String(time)
  if (tickMarkType === 0) return String(d.getUTCFullYear())       // Year
  if (tickMarkType === 1) return _MO[d.getUTCMonth()]            // Month
  return String(d.getUTCDate())                                  // DayOfMonth
}

// CROSSHAIR time label (the hover box on the axis): weekday + date [+ 12-hour].
// e.g. "Tue 14 Jul '26 12:00 AM"  (daily: "Tue 14 Jul '26").
function chartCrosshairTimeFormatter(time) {
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    const yy = String(d.getUTCFullYear()).slice(2)
    return `${_WD[d.getUTCDay()]} ${d.getUTCDate()} ${_MO[d.getUTCMonth()]} '${yy} ${_fmt12(d)}`
  }
  const d = _dayDate(time)
  if (!d) return String(time)
  const yy = String(d.getUTCFullYear()).slice(2)
  return `${_WD[d.getUTCDay()]} ${d.getUTCDate()} ${_MO[d.getUTCMonth()]} '${yy}`
}

function formatVolume(v) {
  if (!v) return '0'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toLocaleString()
}

// Volume PRICE-SCALE label formatter — the abbreviated axis/last-value tag
// ("150M", "33.23M", "1.2B"). Applied via priceFormat:{type:'custom'} on the
// volume series so BOTH the built-in HistogramSeries (columns) AND the custom
// ThinVolumeSeries (histogram/thin bars) format identically: the custom series
// does NOT honor the library's built-in type:'volume' formatter, so its axis
// rendered raw ("150000000.00") — this is the single source of truth for both.
// Up to 2 decimals, trailing zeros trimmed (150M not 150.00M; 33.23M for a tag).
function formatVolumeAxis(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const trim = (x, suf) => (x.toFixed(2).replace(/\.?0+$/, '')) + suf
  if (abs >= 1e9) return trim(n / 1e9, 'B')
  if (abs >= 1e6) return trim(n / 1e6, 'M')
  if (abs >= 1e3) return trim(n / 1e3, 'K')
  return String(Math.round(n))
}

// Format dollar notional for dark pool bars: "$120.5M", "$1.2B", "$45K"
function formatDpNotional(v) {
  if (!Number.isFinite(v) || v <= 0) return '$0'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toLocaleString()
}

// ─── Indicator computations ──────────────────────────────────────────────────

// O(n*period) SMA via full window re-sum at every bar. The naive approach,
// kept because the rolling-window optimization (sum += in - out) accumulates
// floating-point error that can flip .toFixed(2) results at cent boundaries
// — verified empirically on cent-rounded prices producing ~1c divergence vs
// the reference in ~24% of bars on SMA200 over 8000 bars. Even periodic
// re-sync of the rolling sum doesn't fully eliminate it because the subtract
// itself introduces drift between syncs.
//
// For the period sizes used here (5-200) and bar counts up to 8000, this
// runs in ~2ms after JIT warmup, well within the 50ms budget. If/when chart
// jank from this becomes measurable, the fix is integer-cents arithmetic
// (Math.round(price*100) → integer sum → divide at output) which is exact,
// or moving the compute to a Web Worker.
// `fromStart`: emit a value for EVERY bar from index 0 instead of waiting for
// the first full `period` window. The leading bars use an expanding-window
// average (SMA of bars[0..i]) so the line begins at the chart's first bar —
// used by the intraday popup, where a single session is too short to "waste"
// the first `period` bars on warmup.
export function computeSMA(bars, period, fromStart = false) {
  if (bars.length < period && !fromStart) return []
  const result = []
  const start = fromStart ? 0 : period - 1
  for (let i = start; i < bars.length; i++) {
    // Re-sum the full window at every bar (exact, no rolling-subtract drift).
    // Keep FULL precision — rounding the MA to cents stair-steps the line on
    // low-priced (split-adjusted) names; TradingView renders it full-precision.
    const from = Math.max(0, i - period + 1)
    let sum = 0
    for (let j = from; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: sum / (i - from + 1) })
  }
  return result
}

// `fromStart`: seed the EMA from the first bar's close (rather than an SMA over
// the first `period` bars) so the line begins at the chart's first bar.
function computeEMA(bars, period, fromStart = false) {
  if (bars.length < period && !fromStart) return []
  if (!bars.length) return []
  const k = 2 / (period + 1)
  // Full precision (no cent rounding) so the line stays smooth on low-priced names.
  if (fromStart) {
    let ema = bars[0].c
    const result = [{ time: bars[0].t, value: ema }]
    for (let i = 1; i < bars.length; i++) {
      ema = bars[i].c * k + ema * (1 - k)
      result.push({ time: bars[i].t, value: ema })
    }
    return result
  }
  let sum = 0
  for (let i = 0; i < period; i++) sum += bars[i].c
  let ema = sum / period
  const result = [{ time: bars[period - 1].t, value: ema }]
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].c * k + ema * (1 - k)
    result.push({ time: bars[i].t, value: ema })
  }
  return result
}

// O(n) HVC detection via monotonic deque — replaces O(n × lookback) slice+spread
function computeHVC(bars) {
  const hvcSet = new Set()
  const lb = Math.min(252, bars.length - 1)
  const startIdx = Math.max(20, lb)
  if (startIdx >= bars.length) return hvcSet
  // Monotonic decreasing deque: front holds index of max volume in window
  const deque = [] // [{idx, vol}]
  // Pre-fill deque with bars before the check window
  for (let i = 0; i < startIdx; i++) {
    const vol = bars[i].v || 0
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  for (let i = startIdx; i < bars.length; i++) {
    const windowStart = Math.max(0, i - lb)
    // Expire elements outside the lookback window
    while (deque.length && deque[0].idx < windowStart) deque.shift()
    const vol = bars[i].v || 0
    // Front of deque = max of [windowStart .. i-1] (prior bars only)
    if (deque.length && vol > deque[0].vol) hvcSet.add(bars[i].t)
    // Maintain decreasing invariant
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  return hvcSet
}


// ─── ET timezone offset for intraday charts ─────────────────────────────────
// LW Charts displays unix timestamps as UTC. We offset intraday timestamps
// so the chart axis shows Eastern Time (handles EDT/EST automatically).

function getETOffset() {
  const now = new Date()
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return Math.round((et - utc) / 1000) // -14400 for EDT, -18000 for EST
}

const _ET_OFFSET = getETOffset()

// Phase C single-writer ENABLE gate. Resolves per browser: explicit localStorage
// 'uct.barsPush.enabled'='1' (force on) / '0' (force off — instant per-browser revert), else a
// staged percentage rollout keyed by a stable per-browser bucket. When enabled, the developing
// bar is handed to the Massive push writer and the Finnhub writers early-return.
// WIDEN DIAL — % of browsers that get push BY DEFAULT (no explicit opt-in/out).
// CURRENTLY 100 = FULLY ROLLED OUT (2026-07-06): every eligible intraday chart streams push by
// default; a user opts OUT with localStorage 'uct.barsPush.enabled'='0'. (History: ramped
// 0→25→100 under monitoring.) Each eligible chart holds ONE /api/stream/bars loop on the single
// shared event loop, so CHANGING this is a SCALING step. Narrow = lower this + deploy (~10min);
// full backend kill = STREAM_BARS_ENABLED=0; instant per-browser = the localStorage '0' opt-out.
export const BARS_PUSH_ROLLOUT_PCT = 100

// Stable per-browser rollout bucket [0,100), assigned once + persisted so a browser's in/out
// status doesn't flip between renders (or as the dial ramps) — a user won't flap push↔Finnhub.
function _rolloutBucket() {
  try {
    let b = localStorage.getItem('uct.barsPush.bucket')
    if (b == null) { b = String(Math.floor(Math.random() * 100)); localStorage.setItem('uct.barsPush.bucket', b) }
    const n = parseInt(b, 10)
    return Number.isFinite(n) ? n : 100
  } catch { return 100 }  // no storage → out of rollout (safe default-off)
}

export function _barsPushEnabled() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('uct.barsPush.enabled') : null
    if (ls === '1') return true     // explicit opt-in (canary / power user)
    if (ls === '0') return false    // explicit opt-out (per-browser revert)
    return _rolloutBucket() < BARS_PUSH_ROLLOUT_PCT   // default: staged percentage rollout
  } catch { return false }
}

// Operator/canary helper: set OR clear the canary flag AND dispatch the same-tab event
// so open charts re-evaluate immediately (no reload — the plan's instant runtime revert).
// From DevTools: window.__uctBarsPush(true) to canary, window.__uctBarsPush(false) to revert.
export function setBarsPushEnabled(on) {
  try {
    if (on) localStorage.setItem('uct.barsPush.enabled', '1')
    else localStorage.removeItem('uct.barsPush.enabled')
    window.dispatchEvent(new Event('uct-barspush-change'))
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') window.__uctBarsPush = setBarsPushEnabled

// ─── Bar period computation (for real-time new candle creation) ──────────────

const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

function computeBarTime(tf, tickTimeSec) {
  if (tf === 'D') {
    // Daily: ET date string "YYYY-MM-DD" (matches LW Charts BusinessDay format)
    return new Date(tickTimeSec * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  }
  if (tf === 'W') {
    // Weekly: Friday (close) of current week in ET — matches the backend
    // resample + chart/barTime.js. Walk to Monday, then +4 days = Friday.
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    et.setDate(et.getDate() - day + (day === 0 ? -6 : 1) + 4)
    return et.toISOString().split('T')[0]
  }
  if (tf === 'M') {
    // Monthly: first of current month in ET
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-01`
  }
  // Intraday: floor to period boundary in UTC, then offset to ET for display
  const period = PERIOD_SECONDS[tf] || 300
  return Math.floor(tickTimeSec / period) * period + _ET_OFFSET
}

// ─── Series type helpers ─────────────────────────────────────────────────────

const OHLC_TYPES = new Set(['candles', 'hollow', 'bars', 'hlc'])
// Shared frozen empty so "shading off" is one stable identity across renders —
// a fresh [] would defeat the band-change guard in updateChart.
const EMPTY_BANDS = Object.freeze([])

// ⛔ NO `VWAP_TFS`, NO `_withVwapOpacity` — VWAP is FLIPPED (B3 Task 11) and the
// legacy block that read both is deleted. `engine/eligibility.js` carries the
// transcription of each (`VWAP_TIMEFRAMES` and `withOpacity`), with the reason
// each one cannot be expressed in the definition schema written next to it, and
// `eligibility.test.js` pins them against `def.meta.timeframes`.
// `grep -rn "VWAP_TFS\|_withVwapOpacity" app/src/` returns COMMENTS only —
// eligibility.js naming what it transcribed, and the pointers that used to name
// a line number in this file. No code reads either name any more.

function isOhlcType(chartType) {
  return !chartType || OHLC_TYPES.has(chartType)
}

// ─── Live-tick sanity (SINGLE source of truth) ───────────────────────────────
// Every developing-bar update path MUST gate through this. Divergent
// inline guards are exactly how the DDOG 20798 (=100x) phantom slipped a
// path. Rejects non-finite / non-positive, and any value deviating >50%
// from EITHER the last painted bar OR the poison-proof last *server*
// close (lastBarRef can itself get baked bad; the server close cannot).
function isSaneLivePrice(p, lastClose, serverClose) {
  if (!Number.isFinite(p) || p <= 0) return false
  if (lastClose && lastClose > 0 && Math.abs(p - lastClose) / lastClose > 0.5) return false
  if (serverClose && serverClose > 0 && Math.abs(p - serverClose) / serverClose > 0.5) return false
  return true
}

// The price to paint the developing candle with. During an extended session
// (pre/post-market) the snapshot's `price`/`day_close` FREEZES at the 4pm
// regular-session close while `ext_price` carries the live pre/post-market
// print — so using `.price` after the close stamps the STALE RTH close onto the
// last extended-hours bar (QQQ 7:55pm painted 719.69 instead of the real 722.09;
// AEHR dragged 93→72 on an earnings pop). Prefer ext_price whenever the feed
// flags an extended session and it's a sane positive number; else the regular
// `price`. Mirrors TradingView/TC2000 extended-hours behaviour.
function _effLivePrice(snap) {
  if (!snap) return undefined
  const ext = snap.ext_price
  if (snap.ext_session && Number.isFinite(ext) && ext > 0) return ext
  return snap.price
}

// Format the time span between two bar timestamps for the drag-measure readout.
// Bar `.t` is 'YYYY-MM-DD' for D/W/M (→ days) or an epoch-seconds number for
// intraday (→ h/m; any consistent offset cancels in the diff).
function _formatMeasureSpan(t1, t2) {
  let secs
  if (typeof t1 === 'string' && typeof t2 === 'string') {
    const d1 = Date.parse(t1 + 'T00:00:00Z'), d2 = Date.parse(t2 + 'T00:00:00Z')
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) return ''
    secs = Math.abs(d2 - d1) / 1000
  } else {
    secs = Math.abs(Number(t2) - Number(t1))
    if (!Number.isFinite(secs)) return ''
  }
  const days = secs / 86400
  if (days < 1) {
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60)
    if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`
    return `${m}m`
  }
  if (days < 30) { const d = Math.round(days); return d === 1 ? '1 day' : `${d} days` }
  if (days < 365) return `${(days / 30.44).toFixed(1)} months`
  return `${(days / 365.25).toFixed(1)} years`
}

// ─── Volume Profile canvas draw ──────────────────────────────────────────────

function drawVolumeProfile(canvas, chart, series, filteredBars, vpCfg) {
  if (!canvas || !chart || !series || !filteredBars?.length) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  if (!vpCfg?.enabled) return

  const visRange = chart.timeScale().getVisibleLogicalRange()
  if (!visRange) return

  const startIdx = Math.max(0, Math.floor(visRange.from))
  const endIdx = Math.min(filteredBars.length - 1, Math.ceil(visRange.to))
  const visBars = filteredBars.slice(startIdx, endIdx + 1)
  if (!visBars.length) return

  let minP = Infinity, maxP = -Infinity
  for (const b of visBars) { if (b.l < minP) minP = b.l; if (b.h > maxP) maxP = b.h }
  if (maxP <= minP) return

  const N = Math.max(8, Math.min(50, vpCfg.bins || 24))
  const bucketSize = (maxP - minP) / N
  const bins = new Float64Array(N)
  for (const b of visBars) {
    const tp = (b.h + b.l + b.c) / 3
    const idx = Math.min(N - 1, Math.floor((tp - minP) / bucketSize))
    bins[idx] += b.v
  }

  let maxVol = 0
  let poc = 0
  for (let i = 0; i < N; i++) { if (bins[i] > maxVol) { maxVol = bins[i]; poc = i } }
  if (!maxVol) return

  const maxBarW = width * 0.15
  for (let i = 0; i < N; i++) {
    if (!bins[i]) continue
    const pLow  = minP + i * bucketSize
    const pHigh = pLow + bucketSize
    const yTop  = series.priceToCoordinate(pHigh)
    const yBot  = series.priceToCoordinate(pLow)
    if (yTop == null || yBot == null) continue
    const barH = Math.max(1, Math.abs(yBot - yTop))
    const barW = (bins[i] / maxVol) * maxBarW
    ctx.fillStyle = i === poc ? (vpCfg.pocColor || 'rgba(200,160,40,0.65)') : (vpCfg.color || 'rgba(120,160,100,0.25)')
    ctx.fillRect(width - barW, Math.min(yTop, yBot), barW, barH)
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

// Bold candle/volume palette (shared base — the intraday popup's modelBookLook).
const BOLD_UP = '#21c45c'
const BOLD_DOWN = '#f23645'

// Model Book "Throughout the Years" palette — tuned to pop like TC2000:
// a brighter, bolder green that leaps off the chart, a deeper darker red that
// recedes, all over a deep-navy canvas. Scoped to boldCandles instances ONLY
// (the Model Book stock detail + Setup Library / Bottoms charted examples), so
// no other chart on the site is touched.
const MB_UP = '#1ae51a'      // pure vivid TC2000 spring-green (low blue → really pops)
const MB_DOWN = '#c41f2d'    // deep darker red
const SUNRISE_UP = '#0a5c22'   // very dark green for the Sunrise LIGHT theme (candles + volume)
const SUNRISE_DOWN = '#7d1620' // very dark red for the Sunrise LIGHT theme (candles + volume)
// Continuous sky gradient painted on the chart CONTAINER (behind a transparent LWC
// canvas) so it flows unbroken through the price pane AND the volume pane.
const SUNRISE_GRADIENT = 'linear-gradient(to bottom, #cbe6f7 0%, #e6eede 52%, #fbf1c9 100%)'
const MB_BG = '#0e0f0d'      // matches the app page background (--bg) so the canvas blends with the rest of the screen
const MB_UP_RGB = '26,229,26', MB_DOWN_RGB = '196,31,45'
const VOL_MA_COLOR = 'rgba(255,255,255,0.45)'   // volume-pane MA line (subtle white)
const SESSION_EXT_COLOR = '#f5a623'  // pre/post-market price tag (TradingView "Pre"/"Post" orange)
const SESSION_PREVIEW_COLOR = '#d8d6cf'  // muted (not-bright) white for the pre-market preview daily candle
const _candleRgba = (up, a) => `rgba(${up ? MB_UP_RGB : MB_DOWN_RGB},${a})`
// Re-express any hex / rgb / rgba color at the given alpha (for the MA tail fade).
function colorWithAlpha(color, a) {
  if (!color) return color
  if (color[0] === '#') {
    let h = color.slice(1)
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})` }
  return color
}
// Like colorWithAlpha but MULTIPLIES the existing alpha (volume bars already
// carry a dimmed alpha — the fade scales it rather than replacing it).
function colorMulAlpha(color, mul) {
  if (!color) return color
  if (color[0] === '#') {
    let h = color.slice(1)
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${mul})`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map(s => s.trim())
    const baseA = p[3] != null ? parseFloat(p[3]) : 1
    return `rgba(${p[0]},${p[1]},${p[2]},${baseA * mul})`
  }
  return color
}

// Main price-scale margins, with optional caller overrides of the top/bottom
// margin (the global default reserves 0.30 headroom; some surfaces want a
// tighter fit, plus a small bottom gap above a separate volume pane).
//
// ⭐ B5 TASK 12 — IT TAKES THE LAYOUT AND NOTHING ELSE. It used to take a
// settings blob (the PROJECTED one, `csPanes`, because Task 9 had folded
// `cs.indicators` away and the retired `computePaneMargins` read exactly that
// key), a volume
// flag, and the layout. `computePaneLayout` answers BOTH modes now, so there is
// one argument and no chance of handing it the wrong blob.
//
// ⭐ FLIP C, AND WHY THE TWO MODES READ DIFFERENT FIELDS. Under
// `paneMode() === 'panes'` there are no bands left in pane 0 to reserve space
// for, but the candle rectangle must land on the SAME ABSOLUTE PIXELS it did
// under bands — that identity is what keeps the parity gate's `price_plot`
// region down to one grid line instead of a re-fit. Pane 0 is SHORTER by the
// oscillator stack, so "0.30 of the chart" and "0.30 of pane 0" are different
// rectangles, and the layout returns the candle rectangle already re-expressed
// as fractions of pane 0's own height. In `'bands'` mode pane 0 IS the plot
// area, so the answer is the band map's `main` — the numbers
// `computePaneMargins` returned, off the same quantised stack.
//
// ⚠️ A `null` LAYOUT IS THE FIRST FRAME, NOT AN ERROR. The chart-options effect
// builds `rightPriceScale.scaleMargins` BEFORE `updateChart` has measured one,
// which is exactly why `updateChart` re-asserts the candles' margins itself (B5
// Task 10). Until it does, the answer is the no-stack rectangle.
function _mainMargins(layout, topOverride, bottomOverride) {
  const m = _layoutMainMargins(layout)
  if (topOverride == null && bottomOverride == null) return m
  return {
    top: topOverride != null ? topOverride : m.top,
    bottom: bottomOverride != null ? bottomOverride : m.bottom,
  }
}

function _layoutMainMargins(layout) {
  if (!layout) return NO_STACK_MAIN_MARGINS
  return paneMode() === 'panes' ? layout.pane0.mainMargins : layout.bands.main
}

// ⛔ `_subPaneTopFrac` STOOD HERE AND IS DELETED BY THE MASTER MERGE, not by a
// Flip-C decision. It answered "where does the sub-pane stack START, as a
// fraction of the whole plot area" for exactly ONE caller: the price-scale
// (A/L/%) toggle's CSS `bottom`. Master's `ee1de33e` docked that toggle at the
// date axis (`bottom: '3px'`) and stopped tracking the stack, so the function
// lost its only reader. Phase B's version of that line was a mechanical rewrite
// of the retired `computePaneMargins(…)` call — no intent to preserve.
//
// If a future piece of chrome needs the candles' bottom edge again, note the
// Flip-C subtlety it encoded: in `'bands'` mode the edge is `bands.main.bottom`
// because pane 0 IS the plot area, but under `'panes'` pane 0 is only the top of
// it, so a pane-0 fraction has to be converted back to a whole-plot fraction
// (`1 - pane0.heightPx * (1 - pane0.mainMargins.bottom) / chartHeight`). The
// edge is the same absolute pixel in both modes by construction.

// Smoothly animate the chart's visible logical range from wherever it is now to
// `target` ({from,to} in bar-index space) over `duration` ms.
// rafRef holds the in-flight requestAnimationFrame id so a new call (or unmount)
// can cancel the previous animation. autoScale on the right price scale makes the
// vertical axis ride along, so the candles grow as the window narrows.
//
// The right edge eases linearly, but the window WIDTH is interpolated
// geometrically (exponentially) — a zoom reads as smooth only when the
// magnification changes at a constant *ratio* per frame, not a constant number
// of bars per frame. Linear width made the motion lurch (fast at the start,
// crawling at the end); geometric width + easeInOutSine gives a gliding feel.
function _animateVisibleRange(chart, rafRef, target, duration = 1150) {
  if (!chart) return
  if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  const ts = chart.timeScale()
  let start
  try { start = ts.getVisibleLogicalRange() } catch { start = null }
  if (!start) { try { ts.setVisibleLogicalRange(target) } catch { /* out of range mid-load */ } return }
  const startWidth = start.to - start.from
  const endWidth = target.to - target.from
  const geom = startWidth > 0 && endWidth > 0   // geometric width only when both ends are sane
  const ratio = geom ? endWidth / startWidth : 1
  const t0 = performance.now()
  const ease = x => -(Math.cos(Math.PI * x) - 1) / 2   // easeInOutSine — gentlest start/stop
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration)
    const e = ease(p)
    const to = start.to + (target.to - start.to) * e
    const width = geom ? startWidth * Math.pow(ratio, e) : startWidth + (endWidth - startWidth) * e
    const from = to - width
    try { ts.setVisibleLogicalRange({ from, to }) } catch { /* ignore transient */ }
    if (p < 1) rafRef.current = requestAnimationFrame(step)
    else rafRef.current = null
  }
  rafRef.current = requestAnimationFrame(step)
}

// Price min/max (raw lows/highs) of the bars spanned by a logical [from,to]
// window. Used to give the focus zoom a continuously-interpolated vertical so
// the price axis glides instead of stair-stepping as taller/shorter bars scroll
// into view (default per-frame autoScale only changes at those discrete events).
function _windowPriceRange(bars, from, to, overlays) {
  if (!bars || !bars.length) return null
  const s = Math.max(0, Math.floor(from))
  const e = Math.min(bars.length - 1, Math.ceil(to))
  let lo = Infinity, hi = -Infinity
  const winTimes = new Set()
  for (let i = s; i <= e; i++) {
    const b = bars[i]
    if (!b) continue
    winTimes.add(b.t)
    if (b.l < lo) lo = b.l
    if (b.h > hi) hi = b.h
  }
  // Include overlay (MA) values in the window so the interpolated target matches
  // the chart's default autoScale fit (which fits candles + overlays). Without
  // this, the end-of-zoom hand-off to autoScale snaps the scale to include MAs
  // that dip below / poke above the candles — and the price-anchored annotations
  // skip with it. (Focus zoom only runs in Model Book at daily/weekly, where the
  // overlay's `time` equals the raw bar `t`.)
  if (overlays?.length) {
    for (const ov of overlays) {
      if (!ov?.data) continue
      for (const p of ov.data) {
        if (p.value == null || !winTimes.has(p.time)) continue
        if (p.value < lo) lo = p.value
        if (p.value > hi) hi = p.value
      }
    }
  }
  return (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) ? { lo, hi } : null
}

// Focus zoom with BOTH axes animated: horizontal logical range (geometric width,
// like _animateVisibleRange) AND a vertical price range interpolated in log space
// from the start framing to the target framing. The vertical is driven through an
// autoscaleInfoProvider on the candle series reading priceRangeRef — set per frame
// here, cleared at the end so normal autoScale resumes. Falls back to the plain
// horizontal-only animation when the price ranges can't be computed.
function _animateFocusZoom(chart, series, rafRef, priceRangeRef, bars, target, duration = 1150, onDone = null, overlays = null, textFadeRef = null, targetTextVisible = null, sRangeOverride = null, tRangeOverride = null) {
  // Text annotations fade only in the last sliver of the zoom (see step()) so they
  // land right as the animation settles on a setup / vanish right as it lands on
  // the year. endFade is the settled target; snap to it on any non-animated path.
  const endFade = targetTextVisible == null ? null : (targetTextVisible ? 1 : 0)
  const snapFade = () => { if (textFadeRef && endFade != null) textFadeRef.current = endFade }
  // NOTE: do NOT null priceRangeRef here. The previous zoom left it pinned to its
  // final range; nulling it before the first frame opens a window where any
  // autoScale recompute (e.g. the gold-candle setData when toggling fast between
  // setups) falls back to the default rounded scale → a one-frame flash. We keep
  // the prior range until the first animation frame overwrites it, and only reset
  // to default on the genuine fallback paths below.
  if (!chart || !series) { priceRangeRef.current = null; snapFade(); _animateVisibleRange(chart, rafRef, target, duration); onDone && onDone(); return }
  if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  const ts = chart.timeScale()
  let start
  try { start = ts.getVisibleLogicalRange() } catch { start = null }
  if (!start) { priceRangeRef.current = null; snapFade(); try { ts.setVisibleLogicalRange(target) } catch { /* mid-load */ } onDone && onDone(); return }
  // Callers can supply explicit price windows (Setup⇄Result flip): the horizontal
  // target carries replay right-padding, but the VERTICAL must be fit to the real
  // candles only — never the blank pad (or the other frame's bars held in the
  // series mid-transition), which would otherwise inflate the scale and crunch
  // the candles. Falls back to deriving from the logical windows when unset.
  const sRange = sRangeOverride || _windowPriceRange(bars, start.from, start.to, overlays)
  const tRange = tRangeOverride || _windowPriceRange(bars, target.from, target.to, overlays)
  if (!sRange || !tRange) { priceRangeRef.current = null; snapFade(); _animateVisibleRange(chart, rafRef, target, duration); onDone && onDone(); return }
  const startFade = textFadeRef ? (textFadeRef.current ?? 0) : 0
  const startWidth = start.to - start.from
  const endWidth = target.to - target.from
  const geom = startWidth > 0 && endWidth > 0
  const ratio = geom ? endWidth / startWidth : 1
  // Interpolate price-range endpoints in log space (prices are > 0) so the
  // vertical motion reads uniform on a log axis.
  const logLerp = (a, b, e) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * e)
  const t0 = performance.now()
  const ease = x => -(Math.cos(Math.PI * x) - 1) / 2   // easeInOutSine
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration)
    const e = ease(p)
    const to = start.to + (target.to - start.to) * e
    const width = geom ? startWidth * Math.pow(ratio, e) : startWidth + (endWidth - startWidth) * e
    const from = to - width
    priceRangeRef.current = { lo: logLerp(sRange.lo, tRange.lo, e), hi: logLerp(sRange.hi, tRange.hi, e) }
    try { ts.setVisibleLogicalRange({ from, to }) } catch { /* ignore transient */ }
    // Text fade is quick (15% of the animation) and edge-anchored: on zoom-IN it
    // eases in over the LAST 15% so it lands right as the chart settles on the
    // setup; on zoom-OUT it eases out over the FIRST 15% so it clears immediately
    // instead of lingering through the whole zoom-out.
    if (textFadeRef && endFade != null) {
      const fp = targetTextVisible
        ? Math.max(0, Math.min(1, (p - 0.85) / 0.15))
        : Math.max(0, Math.min(1, p / 0.15))
      textFadeRef.current = startFade + (endFade - startFade) * fp
    }
    if (p < 1) {
      rafRef.current = requestAnimationFrame(step)
    } else {
      rafRef.current = null
      snapFade()
      // KEEP the final interpolated range in the provider (do NOT null it / re-fit
      // via autoScale). Handing back to the chart's default autoScale re-rounds the
      // range to "nice" tick values — a one-frame snap that drags the candles AND
      // the price-anchored annotations as the chart "lands". Leaving the provider
      // pinned to the exact final range means there's no landing jump at all. The
      // ref is reset at the start of the next focus zoom and cleared on a
      // stock/timeframe switch (the year pin), so autoScale resumes when needed.
      onDone && onDone()
    }
  }
  rafRef.current = requestAnimationFrame(step)
}

/**
 * The FIRST LIVE instance of a definition, or null.
 *
 * The right-click region menu is keyed by `defId` — a pane belongs to a
 * definition, `orderedPaneKeys` dedupes by `def.id` — but the settings dialog is
 * per INSTANCE, so the menu row has to resolve one. First-live matches what
 * `indicatorRegistry.liveInstanceFor` already does for the generated settings
 * rows, so the two surfaces open on the same copy.
 *
 * ⛔ LIVENESS IS ASKED OF `findInstance`, NEVER RE-DERIVED. A tombstone is an
 * element of `indicatorInstances` with a matching `defId`; taking it would open
 * the dialog on an indicator that is not on the chart. `isLiveInstance` is
 * module-private to `instanceControls`, and `findInstance` returning null for a
 * tombstone is exactly the same question asked through the exported door.
 */
function firstLiveInstanceId(cs, defId) {
  const list = Array.isArray(cs && cs.indicatorInstances) ? cs.indicatorInstances : []
  for (const i of list) {
    if (!i || typeof i !== 'object' || i.defId !== defId) continue
    if (findInstance(cs, i.instanceId)) return i.instanceId
  }
  return null
}

export default function StockChart({
  sym,
  tf,
  height = '100%',
  markers = null,
  priceLines = null,
  showVolume: showVolumeProp,
  overlays: overlaysProp,
  watermark = null,
  watermarkOpacity = null,   // override the settings watermark opacity (Model Book uses a brighter mark)
  watermarkX = null,         // override watermark X (0..1 pane fraction; Model Book pins it top-right)
  watermarkY = null,         // override watermark Y (0..1 pane fraction)
  watermarkPad = null,       // px inset used for BOTH the left/right gutter and the top when corner-pinned (Setup Library — even top-left gap). null = default (14px sides, flush top).
  watermarkCenterX = null,   // px from the pane's left edge — when set, pins the watermark's horizontal CENTER here on every chart (no edge clamp) so it stays tucked in the top-left corner and never drifts by name width or pane width (Setup Library)
  watermarkPadTop = null,    // px top inset, independent of the side gutter (watermarkPad). Charts workspace uses this to drop the mark below the floating drawing toolbar. Falls back to watermarkPad when null.
  onWatermarkCommit = null,  // (pos:{x,y}) => void — when set, a watermark drag persists HERE (per-example) instead of writing the global chart_settings (Setup Library)
  watermarkName = null,      // Model Book: curated company name for the watermark. For a REUSED ticker (e.g. WTW = Weight Watchers in 2017, now Willis Towers Watson) the live ticker meta is the wrong company — this overrides the name (and drops the then-wrong sector/industry).
  watermarkSector = null,    // Model Book: curated historical sector — used when the live ticker meta is the wrong/absent company (renamed/delisted), so the watermark still shows sector below the name like every other stock.
  watermarkIndustry = null,  // Model Book: curated historical industry (paired with watermarkSector).
  className = '',
  showDrawingTools = true,
  onSymbolChange = null,
  onBarContextMenu = null,  // Journal 2.0: right-click a bar → callback({bar, clientX, clientY})
  entryDate = null,         // ISO date string — zoom centers on trade holding period
  exitDate = null,          // ISO date string — end of holding period zoom
  priceScaleTopMargin = null, // override the default 0.30 top headroom (0..0.9)
  dailyDefaultBars = null,  // override the Daily default-zoom bar count (Charts workspace: ~126 ≈ 6 months). Daily only; other TFs keep their own defaults.
  visibleBarsOverride = null, // override the default-zoom bar count on ANY timeframe. null = each TF keeps its own default. Used by the headless /r/chart export, where the hourly default (65 bars) spans only ~4 days once pre/post-market candles are included.
  forceExtendedHours = null,  // null = follow the user's extendedHoursShading setting (today's behavior). false = REGULAR HOURS ONLY, true = force extended. The headless export has no saved settings, so it silently took the ?? true default and rendered pre/post shading bands the owner does not publish.
  ema9MatchCandle = false,  // Charts workspace: paint the 9-EMA overlay in the candle up-color (MB_UP) so the fast MA matches the candles. Reliable regardless of saved overlay colors; scoped so Model Book is unaffected.
  carryDragPlacement = true, // carry the user's drag-repositioned vertical candle placement across ticker switches. false = each ticker autoscales fresh to the default margins (Charts workspace: prevents the price scale ballooning to a sliver and STICKING when scrolling tickers).
  keepPresentOnSymbolChange = false, // on a symbol switch, keep the zoom LEVEL but re-anchor the newest candle to the right so a newly-typed ticker always loads at present day (never inherits the prior symbol's scrolled-back/past view). Charts workspace opts in.
  centerWatermarkOnPlot = false, // center the watermark on the CANDLE PLOT AREA (chart.timeScale().width()/2), not 0.5×pane-width — the pane width includes the right price axis, so a plain 0.5 reads right-of-center. Exact at any widget width.
  rightPadBars = 3,          // bars of empty space between the last candle and the right price scale (rightOffset + default-zoom right pad). Charts workspace uses more for breathing room.
  exactDateRange = false,   // zoom to exactly [entryDate, exitDate] with no padding
  frameRightPadFrac = 0,    // exactDateRange only: leave this fraction of the window as blank space to the RIGHT of the last framed candle (replay-style room to annotate)
  keepBarsAfterExit = false, // exactDateRange only: DON'T slice bars past exitDate — keep real price history rendering into the right-pad space instead of cutting off (Setup Library "Result" view: exitDate stays framed in place, the ensuing candles fill the screen)
  candleFrameFade = false,  // Setup Library: when exitDate moves (Setup⇄Result), crossfade the candles PAST the highlighted setup day in/out instead of popping them
  instantFrameFlip = false, // exactDateRange only: a frame change (Setup⇄Result) SNAPS to the new frame instead of gliding — an instant cut, like loading a fresh chart
  fitPriceToCandles = false, // price scale fits the CANDLES only — MA overlays don't expand it (they clip off-screen, TC2000-style), so price sits at the same spot regardless of where the 200MA is
  forceLogScale = false,    // default the price scale to logarithmic
  forceScaleMode = null,    // 'arith' | 'log' | 'pct' — pin a default scale regardless of user settings (A/L/% still toggles locally)
  frozen = false,           // static exhibit: no pan/zoom/scale-drag — wheel scrolls the PAGE (Setup Library examples)
  boldCandles = false,      // bold solid green/red candles (Model Book look)
  userCandleColors = false, // Charts workspace: the "bold" candle/volume colors come from the user's cs.candles (upColor/downColor) instead of the hardcoded MB palette, so the settings-modal color pickers actually paint. Model Book (no prop) keeps its fixed MB colors.
  userCanvas = false,       // Charts workspace: the canvas (background solid/gradient, grid, crosshair, text) comes from the user's cs settings instead of the hardcoded MB background. Model Book keeps MB_BG.
  colorByNetChange = false, // color candles by NET CHANGE (close vs previous close, TC2000/StockCharts style) instead of LWC's default close-vs-open
  candlesOnTop = false,     // TradingView-style: draw candle bodies ABOVE the MA/BB/VWAP overlays so the lines pass behind the bodies instead of overlapping them
  hideLastValue = false,    // hide the last-price axis tag on the price series
  volumeLastValue = false,  // show the current-volume axis tag on the volume pane's right scale (like the price tag on the main chart). Opt-in so Model Book (which deliberately hides it) is unaffected.
  volumeSeparatePane = false, // force volume into its own draggable bottom pane
  priceScaleBottomMargin = null, // small gap below price (above a separate vol pane)
  markVolumeExtremes = false, // gold the highest-volume-ever bar (Model Book)
  disableHvc = false,         // force the 52W-volume-high gold bars OFF (intraday popup)
  hidePriceLine = false,      // hide the dashed last-price line on price AND the volume value line/label (intraday popup)
  hideWatermark = false,      // force the symbol watermark OFF regardless of settings (intraday popup)
  subtleSeparator = false,    // thin grey pane divider (matches the Model Book main chart) even without boldCandles
  hideLegend = false,         // suppress the crosshair OHLCV/overlay legend on hover (intraday popup)
  legendColor = null,         // workspace: override the base OHLCV legend text color (time + O/H/L/C/V). null = CSS default. Change%/overlay/indicator colors keep their own (semantic) colors.
  savedColors = [],           // shared saved-color swatches (workspace) → the drawing color picker reuses the same list as Chart Settings
  onSaveColor = null,         //   (hex) => void
  onDeleteColor = null,       //   (hex) => void
  hideCrosshair = false,      // suppress the hover crosshair lines + axis labels entirely (Setup Library examples)
  dragMeasure = false,        // Charts workspace: plain left-drag draws a transient measure line + % / bars / time readout (TC2000-style) instead of panning. Cursor mode only; mouse only.
  periodSelect = false,       // Custom-Period Sort: plain left-drag highlights a time period (translucent band) instead of panning; fires onPeriodSelected(startYmd, endYmd) on release.
  onPeriodSelected = null,    // (startYmd:int, endYmd:int, pct:number) => void — the highlighted [start, end] as YYYYMMDD ints + the symbol's close-to-close % move.
  onPeriodCancel = null,      // () => void — the ✕ on the "Highlight time period" banner cancels the mode.
  replayCutoff = null,        // Replay mode: 'YYYY-MM-DD' — hide every bar after this calendar day + re-frame to default zoom + freeze live. null = normal chart.
  onExitReplay = null,        // () => void — when set + replayCutoff/startMarker active, shows an "Exit Replay Mode" pill centered in the chart's clear top area.
  startMarker = null,         // 'YYYY-MM-DD' — Custom-Period Sort: draw a thin gold vertical line at this date on the chart. null = none.
  verticalLegend = false,     // Charts workspace: stack the crosshair OHLCV legend single-file down the left instead of a horizontal row near the toolbar.
  lockWatermark = false,      // Charts workspace: disable the watermark hover-arm + drag so hovering it never moves it.
  alwaysShowLegend = false,   // Charts workspace: keep the legend visible with the latest bar's values when the cursor is off the chart (instead of hiding).
  leftBarPad = 0,             // bars of empty space before the first bar on the default zoom (intraday popup: matches the right padding)
  overlaysFromStart = false,  // MA overlays begin at the chart's first bar (expanding-window warmup) instead of after `period` bars (intraday popup)
  modelBookLook = false,      // match the Model Book main chart's NON-candle styling (thin 0.5px curved MAs + VWAP, fuller-opacity volume) without the bold candle bodies (intraday popup)
  volumePaneHeightPct = null, // override the separate volume pane height (%)
  showRangeSelector = false, // show the TC2000-style date-range bar (3M/6M/YTD/12M/1Y/5Y) bottom-left, above the volume pane
  canvasTheme: canvasThemeProp = null,  // workspace chart-theme override: 'sunrise' = light gradient canvas (keeps green/red candles); null = follow the app theme (see the derived `canvasTheme` below)
  showSma5 = false,          // workspace: add a faint 5-period SMA overlay (legend included). Very low-opacity so it's barely visible.
  onVolumePaneResize = null,  // (pct) => void — fired when the user drags the price/volume separator, so the caller can persist the new height
  volumeMa = 0,             // N-period SMA line drawn on the volume pane (0 = off). Overridden by cs.volume.maPeriod when set (Indicators tab).
  liveUpdates = true,       // false = skip SSE subscription (e.g. closed-trade historical charts)
  backgroundWarm = true,    // false = skip the speculative background warms (all-TF warm chain + D/W/M full-depth dwell-warm). Multi-chart grid cells pass false so a cold 16-cell open is 16 shallow fetches, not ~130+ (the 2026-05-24 herd class). On-demand paths (primary fetch, pan backfill, TF switch) unaffected.
  deepWarm = false,         // true = run ONLY the deep-history dwell-warm (not the all-TF chain) even when backgroundWarm=false. Multi-chart grid passes true for the MAXIMIZED cell so its scroll-back is instant; the all-TF chain stays off (herd guard).
  onBarsReady = null,       // optional () => void — fired at most once per mount, when the chart first has renderable bars OR reaches fatal error (first loading=false). The grid mount queue uses it to release a concurrency slot.
  onTfChange = null,        // optional callback(tf) — called when keyboard TF shortcut fires
  hotkeysActive = true,     // boolean | () => boolean — gates this instance's document-level keydown shortcuts at dispatch time (read via latest-ref: neither form re-subscribes, the callback form never re-renders). Multi-chart surfaces pass a callback reading the container's active-cell ref so one keypress doesn't retime every mounted chart. Absent/true = today's always-active behavior.
  onOpenSettings = null,    // optional () => void — when set, the "Chart settings" context-menu item opens THIS instead of the old toolbar panel (charts workspace uses the new centered modal)
  compareSymbol = null,     // optional secondary symbol for % return comparison overlay
  onCompareChange = null,   // callback(sym) — parent manages compareSymbol state
  // ── Optional multi-chart sync hooks (additive — all behavior unchanged when absent) ──
  onCrosshairMove = null,   // (payload: {time, price}) => void — fires when local user hovers chart
  onTimeRangeChange = null, // (payload: {from, to}) => void — fires when visible time range changes
  externalCrosshair = null, // {time, price} | null — render external crosshair from sync context
  subscribeCrosshair = null, // optional (cb) => unsubscribe — IMPERATIVE sync channel. Preferred over externalCrosshair: the parent hands crosshair payloads straight to this chart with no React state in between, so a linked crosshair glides instead of stepping once per re-render.
  externalTimeRange = null, // {from, to} | null — apply external time range from sync context
  hideReplay = false,       // hide the Replay / Time Machine button
  hidePatterns = false,     // hide the pattern-recognition toggle button
  disablePatterns = false,  // fully disable pattern detection on this instance: no /api/patterns fetch or 30s poll, no PatternOverlay mount, toolbar toggle forced hidden. hidePatterns only hides the button; this kills the data path (grid cells — 16 instances × 30s polls otherwise).
  showSavedDrawings = false, // render the user's saved per-symbol drawings as a READ-ONLY layer when the drawing tools are off (multi-chart grid cells: a member's trendlines must not vanish there). Inert when showDrawingTools is on — the editable overlay already renders them.
  settingsOverride = null,  // optional PARTIAL chart_settings blob merged over the user's global settings for THIS instance only (multi-chart grid: per-cell chart type). Precedence defaults < global < override; overridden keys are restored from the un-overridden base before any settings write persists, so an override can never leak into the global blob. MUST be identity-stable (useMemo) — it's a memo dep.
  onSettingsPersist = null,  // optional (nextFullSettings) => void — when provided, ALL in-chart settings writes (gear, indicators, overlays, ext-hours, log/pct scale, right-click toggles) route HERE instead of the global chart_settings pref. Used by a Chart widget's EXTRA tabs so each tab's edits persist to that tab's own blob in isolation, never touching the global settings or another tab. `settingsOverride` should carry this tab's full settings so `cs` reflects it.
  hideCompare = false,      // hide both compare-symbol entry points (text input + popover)
  hideCountdown = false,    // hide the intraday bar-close countdown badge
  // ── Animated "focus a setup" zoom (Model Book) ──
  focusDate = null,         // ISO date — smoothly zoom so this bar is the last candle; null = zoom back to [entryDate,exitDate]
  focusStartDate = null,    // ISO date — optional left edge of the focus frame; overrides focusBarsBack when set
  focusNonce = 0,           // bump to (re)trigger the focus zoom even when focusDate is unchanged
  focusBarsBack = 80,       // lead-up bars shown to the left of the focus bar (fallback when focusStartDate unset)
  // ── Per-setup annotations (Model Book) — additive, default-off ──
  callouts = null,              // array of {time, text} leader-line labels (Model Book catalysts) — placed in blank space with a diagonal line to the candle
  setupMoves = null,            // sorted array of {date, anchor} per setup (Model Book) — draws a "+X%" advance label at the start of each setup's lines vs the previous one
  annotations = null,           // array of chart drawings to render for the focused setup (null = layer off)
  annotationsVisible = false,   // fade the annotation layer in/out (tied to the focus zoom)
  annotationsOpacity = 1,       // extra opacity multiplier (Model Book setup→setup crossfade)
  annotationsFadeWhole = false, // Model Book show-all OFF: fade the WHOLE setup layer with the zoom (not just text)
  annotationsEditable = false,  // admin authoring: enable the drawing toolbar + editing
  annotationsTextVisible = null, // Setup Library: drive the TEXT-annotation fade directly (true=show / false=fade out) when there's no focus zoom to do it. null = leave it to the focus-zoom path (Model Book).
  staticAnnotations = null,     // Model Book: stock-level drawings shown always on the full-year view (read-only, independent of any setup)
  onAnnotationsChange = null,   // (drawings[]) => void — called when admin adds/edits/removes an annotation
  onAnnotationsMigrate = null,  // (drawings[]) => void — called once when a legacy volume-pane annotation is re-anchored to the pane (so it can be persisted)
  highlightBarTime = null,      // ISO/time (or array of them) of bar(s) to paint (Model Book: focused setup's day, or all setup/catalyst days)
  highlightColor = '#e6b800',   // color for highlighted bars (gold for setups; Model Book passes white for catalysts)
  highlightBodyOnly = false,    // true = recolor only the BODY, leave border/wick to the chart's own settings (Custom-Period Sort start-candle marker); false = recolor body+border+wick (Model Book)
  onHighlightClick = null,      // Model Book: ({ date, clientX, clientY }) => void — clicking a highlighted setup/catalyst candle (opens the intraday 5-min popup)
  vwapOverride = null,          // force the session-VWAP indicator on regardless of user settings: { color } (Model Book intraday popup uses white)
  onFocusEscape = null,         // called when the user manually zooms/pans while a setup focus is active → parent should clear focus
  // ── Index comparison pane (Model Book) — additive, default-off ──
  indexPaneSymbol = null,       // e.g. '^IXIC' — draws that symbol's close as a line in a pane ON TOP of the price pane (relative-strength reference vs the index)
  indexPaneColor = '#ffffff',   // line color for the index pane
  indexPaneHeightPct = 18,      // height of the index pane as % of chart
  indexPaneLabel = null,        // top-left label text for the index pane (defaults to the symbol sans caret)
  barsOverride = null,          // Model Book: explicit bars (uploaded historical data for a delisted stock). When set, skip ALL fetching/IDB/delta and render these directly — for tickers the data providers no longer carry.
  barsOverridePending = false,  // Model Book: an override is expected but still loading — suppress the provider fetch (don't flash the wrong/penny data) and show the spinner until it arrives.
  indexAnnotations = null,      // Model Book: GLOBAL drawings (measure marks for Nasdaq corrections) on the index pane — read-only for all, editable for admin
  indexAnnotationsEditable = false, // admin authoring: enable the measure toolbar on the index pane
  onIndexAnnotationsChange = null,  // (drawings[]) => void — called when admin adds/edits/removes an index-pane annotation
  // ── Dark Pool volume profile bars (DarkPool page) ──
  // Renders horizontal bars on the right edge of the chart at the price levels
  // of dark pool prints. Bar width + height scale with $ notional. Latest = gold,
  // older = gray with opacity by relative size. Top 5 by notional get gold tier.
  // Uses series.priceToCoordinate() so bars align pixel-perfect with candles
  // and follow zoom/pan automatically.
  darkPoolBars = null,            // array of {price, notional, isLatest, date, dateLong, pctAvgVol}
  darkPoolMaxBarWidth = 350,      // max bar width in pixels — wider gives
                                  // the $ labels more horizontal room to
                                  // breathe and reduces label collision at
                                  // clustered price levels. Was 250; bumped
                                  // because real charts with 10+ prints near
                                  // the current price had labels stacking on
                                  // top of each other in the small right
                                  // strip. Bars are transparent enough now
                                  // (top tier max 0.50 opacity) that the
                                  // extra width doesn't visually dominate.
  // ── Override candle series priceFormat (e.g. integer-only axis labels) ──
  // Pass { type: 'price', precision: 0, minMove: 1 } to show "200" instead of "200.00"
  priceFormat = null,
  // Curated book charts (Setup Library / Model Book examples) should show ONLY
  // the admin-authored setup overlays — NOT the viewer's own Journal 2.0 trade
  // markers/price lines, which would "randomly" appear on any ticker the viewer
  // happens to have traded. Set true to suppress the personal journal overlay.
  hideJournalOverlay = false,
  // ── Extended-hours session preview (Charts workspace only) ──
  // null on every other surface (feature off). 'regular' | 'extended' from the
  // workspace's "Regular Hours / Include pre-market" toggle. Drives the synthetic
  // pre/post-market daily candle + the locked-close / Pre-Post price tags. Only
  // meaningful on D/W/M — inert on intraday.
  sessionView = null,
  hideExtHoursToolbarToggle = false,  // charts workspace moves the intraday EXT/RTH toggle into the widget header, so hide the toolbar one
  // ⭐ PHASE C TASK 12 — WHICH CHART THIS IS. A stable per-surface id: the
  // `/charts` widget slot (`WidgetHost`'s `groupId`) or a Multi-Chart grid
  // cell's persisted `cell.id`. Forwarded to `ChartToolbar` → the alert
  // popover, which is what makes the alert listing request carry `?scope=` —
  // the parameter `indicator_alert_service.list_for_user` has implemented since
  // Task 12 and that no client had ever sent.
  //
  // ⚠️ IT MUST BE STABLE ACROSS RELOADS, not per-mount. A random id would scope
  // an alert to a chart that ceases to exist the moment the tab is refreshed —
  // which is worse than no scoping at all. Both producers persist theirs
  // (`charts_workspace_layout`, `multichart_state`); a surface without one
  // passes nothing and stays global.
  chartId = null,
}) {
  const { prefs, setPref } = usePreferences()
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  // NOTE: the chart canvas deliberately does NOT follow the app theme. The light app
  // theme restyles the page chrome only (nav, page background, toolbars); charts keep
  // their own look, controlled by the /charts theme toggle (charts_theme -> the
  // 'sunrise' prop) or an explicit caller override. An earlier build derived this from
  // prefs.theme and recolored every chart the moment Light was selected, which is not
  // wanted — the widgets must look identical in every app theme.
  const canvasTheme = canvasThemeProp


  // ── Chart settings from user preferences ──
  const csBase = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])
  const cs = useMemo(
    () => (settingsOverride ? mergeSettingsOverride(csBase, settingsOverride) : csBase),
    [csBase, settingsOverride],
  )

  // ⛔⭐ B5 TASK 12 — `csPanes` STOOD HERE AND IS GONE, WITH ITS SUBJECT.
  //
  // Task 9 folded `cs.indicators` into `indicatorInstances`, and `computePaneMargins`
  // read `cs.indicators[key].enabled` — so every call site had to be handed a blob
  // with the instance list projected BACK onto it, which is what `csPanes` was.
  // `computePaneLayout` reads the INSTANCE LIST directly, so there is nothing to
  // project and no second blob to keep honest: the four sites that used to take
  // `csPanes` now take the LAYOUT, which is the same object the binder and the
  // renderer are working from. `engine/paneMarginsProjection.js` retires with it.

  // Volume MA is editable from the Indicators tab; the `volumeMa` prop stays the
  // fallback for callers that don't use chart settings (Model Book, popups).
  const volMaPeriodEff = Number.isFinite(Number(cs?.volume?.maPeriod)) ? Number(cs.volume.maPeriod) : volumeMa
  // Effective candle/volume up-green: darkened for the Sunrise light theme so it
  // stands out on the bright canvas; on the Charts workspace (userCandleColors) it
  // comes from the user's saved candle color so the settings pickers actually paint;
  // the normal vivid MB_UP everywhere else (Model Book, popups).
  const mbUp = canvasTheme === 'sunrise' ? SUNRISE_UP : (userCandleColors ? (cs.candles.upColor || MB_UP) : MB_UP)
  const mbDown = canvasTheme === 'sunrise' ? SUNRISE_DOWN : (userCandleColors ? (cs.candles.downColor || MB_DOWN) : MB_DOWN)
  // The ema9MatchCandle overlay borrows the candle up-HUE, but a moving average must
  // stay fully opaque — the candle's per-color opacity (8-digit #rrggbbaa from the
  // color picker) must NOT bleed into the MA line. Strip any trailing alpha.
  const mbUpOpaque = /^#[0-9a-f]{8}$/i.test(mbUp) ? mbUp.slice(0, 7) : mbUp
  // ema9MatchCandle is a DEFAULT, not a lock: it repaints the 9-EMA to the candle
  // up-color only while the overlay still wears its stock default color. The moment
  // the user picks a custom color in Chart Settings → Indicators, that color wins.
  // All three consumers (line series, always-on legend, crosshair legend) read this
  // one predicate so the line and its legend labels can never disagree.
  const _EMA9_STOCK_COLOR = '#4ade80'   // CHART_DEFAULTS.overlays[0].color
  const ema9CandleColorFor = (ov) => (
    ema9MatchCandle && ov?.type === 'EMA' && Number(ov?.period) === 9
      && (!ov.color || String(ov.color).toLowerCase() === _EMA9_STOCK_COLOR)
  ) ? mbUpOpaque : null
  // Volume bars keep the FIXED bold palette regardless of the user's candle color —
  // volume gets its own color control later, so changing candle colors must not
  // touch it. (This is the original mbUp/mbDown, before userCandleColors.)
  const mbVolUp = canvasTheme === 'sunrise' ? SUNRISE_UP : MB_UP
  const mbVolDown = canvasTheme === 'sunrise' ? SUNRISE_DOWN : MB_DOWN

  // ── Theme colors (light / dark) layered over user chart settings ──
  // Returns layout/grid/crosshair/candle colors based on cs.theme. Used in
  // chartOpts below and re-applied via useEffect when theme changes.
  const themeColors = useMemo(() => {
    if (canvasTheme === 'sunrise') {
      // TSDR — Sunrise: a light sky-gradient canvas (blue top → sun-yellow bottom),
      // dark ink for text/scales, faint grid. Candles KEEP the current green/red.
      return {
        background: '#eaf3fb',    // crosshair axis-label background (solid, light)
        layoutTransparent: true,  // canvas transparent → the container's CSS sky-gradient shows through unbroken across BOTH panes
        textColor: '#243040',
        gridColor: 'transparent',   // no grid lines on the Sunrise theme
        borderColor: 'rgba(20,35,55,0.22)',
        crosshairColor: '#586573',
        candleUp: boldCandles ? mbUp : cs.candles?.upColor,
        candleDown: boldCandles ? mbDown : cs.candles?.downColor,
      }
    }
    if (cs.theme === 'light') {
      return {
        background: '#ffffff',
        textColor: '#1f2937',
        gridColor: '#e5e7eb',
        borderColor: '#d1d5db',
        crosshairColor: '#6b7280',
        candleUp: '#10b981',
        candleDown: '#ef4444',
      }
    }
    return {
      // Model Book charts (boldCandles) ride a deep-navy canvas to make the
      // bold green/red candles pop (TC2000 look). The Charts workspace (userCanvas)
      // instead reads the user's background — solid OR a top→bottom gradient (shown
      // via the container CSS + a transparent LWC canvas, like Sunrise). Every other
      // surface keeps the user's configured background.
      background: (userCanvas || !boldCandles) ? cs.background : MB_BG,
      layoutTransparent: userCanvas && cs.bgMode === 'gradient',
      textColor: cs.textColor,
      gridColor: cs.grid?.color,
      borderColor: cs.grid?.color,
      crosshairColor: cs.crosshair?.color,
      candleUp: cs.candles?.upColor,
      candleDown: cs.candles?.downColor,
    }
  }, [cs.theme, cs.background, cs.bgMode, cs.textColor, cs.grid?.color, cs.crosshair?.color, cs.candles?.upColor, cs.candles?.downColor, boldCandles, canvasTheme, userCanvas])

  // The floating panels drawn ON the canvas — crosshair OHLC legend, volume legend,
  // range-selector bar — are the canvas color at partial alpha (that's where the
  // hardcoded rgba(14,15,13,0.72) came from: #0e0f0d, the default canvas). Hardcoded,
  // they stayed dark blobs on a light canvas; derived, they flip with it and their
  // text/border stay legible. Published as CSS vars on the wrapper; the stylesheet
  // keeps the original literals as fallbacks so any unparseable canvas is a no-op.
  // The canvas sampled at the two heights chrome actually sits at. A GRADIENT canvas has
  // no single color: the crosshair legend and toolbar ride the TOP, while the range bar,
  // volume legend and the price/volume pane separator sit ~80% down, which on a
  // navy→white ramp is the opposite end. Sampling per-height is what stops a dark slab
  // landing on a near-white area. On a solid canvas both collapse to the same color.
  const canvasSample = useMemo(() => {
    const isGradient = userCanvas && cs.bgMode === 'gradient' && canvasTheme !== 'sunrise'
    const gTop = cs.bgGradient?.top || MB_BG
    const gBottom = cs.bgGradient?.bottom || MB_BG
    const top = canvasTheme === 'sunrise'
      ? '#eaf1fa'
      : isGradient
        ? gTop
        : ((userCanvas || !boldCandles) ? (cs.background || MB_BG) : MB_BG)
    const low = isGradient ? (sampleGradient(gTop, gBottom, 0.8) || top) : top
    return { top, low }
  }, [canvasTheme, userCanvas, boldCandles, cs.bgMode, cs.background, cs.bgGradient?.top, cs.bgGradient?.bottom])

  // Price/volume pane separator. Was hardcoded near-white, so it vanished against the
  // pale bottom of a light or gradient canvas. Derived from the canvas AT THE
  // SEPARATOR'S OWN HEIGHT; the dark values are the originals, so the default is
  // visually unchanged.
  const separatorColors = useMemo(() => {
    const rgb = parseColor(canvasSample.low)
    const light = rgb ? luminance(rgb) > 0.5 : false
    return light
      ? { color: 'rgba(0, 0, 0, 0.22)', hover: 'rgba(0, 0, 0, 0.38)' }
      : { color: 'rgba(255, 255, 255, 0.18)', hover: 'rgba(255, 255, 255, 0.32)' }
  }, [canvasSample])

  // ── Axis auto-ink + crosshair-label canvas blend ────────────────────────────
  // The date/time + price scale text and the crosshair's pop-up axis labels
  // follow the CANVAS, not the user's scale-color setting (owner request
  // 2026-07-23): the label background blends into the canvas and the ink
  // auto-flips white/black by canvas luminance — white text on a dark canvas,
  // black on a light one. The scale color picker can no longer render the axes
  // unreadable against the canvas. Crosshair label TEXT needs no explicit
  // color: LWC contrast-picks it from labelBackgroundColor, and layout.textColor
  // (the ink below) agrees with it by construction either way.
  const axisAuto = useMemo(() => {
    const isGradient = userCanvas && cs.bgMode === 'gradient' && canvasTheme !== 'sunrise'
    // The time axis sits at the BOTTOM of the canvas — blend its labels with the
    // gradient's END color (a solid canvas collapses to the same value).
    const labelBg = canvasTheme === 'sunrise'
      ? '#fbf1c9'
      : isGradient
        ? (cs.bgGradient?.bottom || MB_BG)
        : ((userCanvas || !boldCandles) ? (cs.background || MB_BG) : MB_BG)
    const rgb = parseColor(labelBg)
    const light = rgb ? luminance(rgb) > 0.5 : false
    return { labelBg, ink: light ? '#1f2937' : '#ffffff', light }
  }, [userCanvas, boldCandles, cs.bgMode, cs.background, cs.bgGradient?.bottom, canvasTheme])

  const panelVars = useMemo(() => {
    const { top: solidTop, low: solidLow } = canvasSample
    const p = panelFor(solidTop)
    const pLow = panelFor(solidLow) || p
    const t = toolbarFor(solidTop)
    if (!p) return undefined
    return {
      ...(t ? {
        '--chart-toolbar-bg': t.bg,
        '--chart-toolbar-bg-hover': t.bgHover,
        '--chart-toolbar-text': t.text,
        '--chart-toolbar-text-hover': t.textHover,
      } : {}),
      '--chart-panel-bg': p.bg,
      '--chart-panel-bg-soft': p.bgSoft,
      '--chart-panel-border': p.border,
      '--chart-panel-text': p.text,
      '--chart-panel-text-strong': p.textStrong,
      '--chart-panel-hover': p.hover,
      // Bottom-anchored variants (identical to the above on a solid canvas).
      '--chart-panel-bg-low': pLow.bg,
      '--chart-panel-bg-soft-low': pLow.bgSoft,
      '--chart-panel-border-low': pLow.border,
      '--chart-panel-text-low': pLow.text,
      '--chart-panel-text-strong-low': pLow.textStrong,
      '--chart-panel-hover-low': pLow.hover,
    }
  }, [canvasSample])

  // ── Price-scale: forceLogScale (Model Book) defaults to log without touching
  // the user's global chart-settings pref. A per-instance override lets the
  // A/L/% toggle still switch locally. 'arith' | 'log' | 'pct' | null. ──
  const [scaleOverride, setScaleOverride] = useState(null)
  const _forcedScale = forceScaleMode || (forceLogScale ? 'log' : null)
  const effectiveScale = scaleOverride
    || _forcedScale
    || (cs.percentScale ? 'pct' : (cs.logScale ? 'log' : 'arith'))
  const setScale = (kind) => {
    if (_forcedScale) {
      setScaleOverride(kind)  // local only — don't rewrite the global pref
    } else {
      handleUpdateChartSettings({ ...cs, logScale: kind === 'log', percentScale: kind === 'pct', preset: 'custom' })
    }
  }
  // The price pane's right scale, addressed via the candle series so it's always
  // the PRICE scale even when an index-comparison pane sits at pane 0 (where
  // chart.priceScale('right') would otherwise resolve). Falls back to the bare
  // lookup before the series exists. Identical object when no index pane.
  const mainPriceScale = useCallback(
    () => candleSeriesRef.current?.priceScale?.() ?? chartRef.current?.priceScale('right') ?? null,
    []
  )
  // When an index pane sits on top, the PRICE pane is pushed down. The canvas
  // overlays (annotations + catalyst callouts) draw with pane-relative
  // priceToCoordinate (0 = top of the price pane), so their wrapper must be
  // offset to the price pane's box or every drawing lands too high. null = no
  // index pane → wrapper stays inset:0 (every other chart unchanged).
  const [overlayBounds, setOverlayBounds] = useState(null) // {top, height} | null
  const overlayWrapStyle = (extra) => (
    overlayBounds
      ? { position: 'absolute', top: overlayBounds.top, left: 0, right: 0, height: overlayBounds.height, ...extra }
      : { position: 'absolute', inset: 0, ...extra }
  )
  // Same idea for the INDEX pane (top): a drawing overlay there maps Y via the
  // index series' priceToCoordinate (0 = top of the INDEX pane), so its wrapper
  // is offset to the index pane's measured box. null until measured.
  const [indexOverlayBounds, setIndexOverlayBounds] = useState(null) // {top, height} | null
  const indexOverlayWrapStyle = (extra) => (
    indexOverlayBounds
      ? { position: 'absolute', top: indexOverlayBounds.top, left: 0, right: 0, height: indexOverlayBounds.height, ...extra }
      : { position: 'absolute', inset: 0, ...extra }
  )

  // ── Keyboard help overlay state ──
  const [helpOpen, setHelpOpen] = useState(false)
  // Flips true once the LWC chart instance is first created (in updateChart).
  // Used by the crosshair-legend effect to subscribe exactly once, instead of
  // re-subscribing on every render of updateChart (which would happen ~once
  // per real-time tick and visibly stutter the crosshair).
  const [chartReady, setChartReady] = useState(false)

  // ── Dark Pool overlay state ──────────────────────────────────────────────
  // Hover tooltip — fixed-position div near the cursor when hovering a bar.
  const [dpHover, setDpHover] = useState(null)
  const dpBarsContainerRef = useRef(null)

  // Memoize the bar layout so onMouseEnter handlers don't recompute every
  // render. Sorts by notional desc, picks top 25, computes width/height/color
  // tier based on each bar's $ size relative to the largest in the set.
  const darkPoolBarsLayout = useMemo(() => {
    if (!darkPoolBars || darkPoolBars.length === 0) return []
    const sorted = [...darkPoolBars]
      .filter(b => b && b.price != null && b.notional != null && Number.isFinite(b.notional))
      .sort((a, b) => (b.notional || 0) - (a.notional || 0))
      .slice(0, 25)
    if (sorted.length === 0) return []
    const maxN = Math.max(...sorted.map(b => b.notional || 0))
    if (maxN <= 0) return []
    const MIN_BAR_H = 4
    const MAX_BAR_H = 11
    return sorted.map((b, idx) => {
      const ratio = (b.notional || 0) / maxN
      const isGoldTier = idx < 5
      const showLabel = idx < 3   // only label the top 3 by notional
      return {
        ...b,
        idx,
        ratio,
        width: ratio * darkPoolMaxBarWidth,
        height: MIN_BAR_H + ratio * (MAX_BAR_H - MIN_BAR_H),
        color: isGoldTier ? '#c9a84c' : '#9c9588',
        // Bar opacity scales with notional ratio so the largest print is still
        // the most visible. Ceiling was 1.0 which fully solid-colored the top
        // 5 against dark candles — too dominant, drowned out the price action.
        // Iterated down: first cut to 0.65 was still bright, dropped again to
        // 0.50 max for the top tier (≈50% less bright than original at max),
        // 0.40 max for smaller bars.
        opacity: isGoldTier ? 0.20 + ratio * 0.30 : 0.14 + ratio * 0.26,
        isGoldTier,
        showLabel,
      }
    })
  }, [darkPoolBars, darkPoolMaxBarWidth])

  // Position bars vertically by calling series.priceToCoordinate() on each
  // animation frame. Only the chart instance knows the exact pixel Y for a
  // given price (especially after pan/zoom). By running in rAF, bars stay
  // glued to candles regardless of how the user interacts with the chart.
  //
  // Label policy (after several iterations):
  //   - Only the top-3 prints get labels. These are the most important $
  //     amounts on the chart. With only 3 of them, collisions are rare in
  //     practice (you'd need 3 of the biggest prints all at near-identical
  //     prices, which is uncommon).
  //   - Top 4-5 still render as gold bars (visually distinct) but with no
  //     label clutter. Hover for $ amount via the existing tooltip.
  //   - Smaller bars stay as visual reference markers showing WHERE
  //     activity is concentrated. Hover to read the $ amount.
  //   - No staggering — earlier iterations pushed labels far from their
  //     bars and created the "floating disconnected label" failure mode.
  //   - On the rare collision between top-3 labels, they overlap at their
  //     natural Y; the user can zoom in or hover to disambiguate. Still
  //     better than 200px of staggered orphans.
  useEffect(() => {
    if (!chartReady) return
    if (!darkPoolBarsLayout || darkPoolBarsLayout.length === 0) return
    const container = dpBarsContainerRef.current
    if (!container) return
    let raf = 0
    const update = () => {
      const series = candleSeriesRef.current
      if (series) {
        const els = container.querySelectorAll('[data-dp-bar]')
        for (const el of els) {
          const price = parseFloat(el.dataset.price || '')
          if (!Number.isFinite(price)) continue
          let y
          try { y = series.priceToCoordinate(price) } catch { y = null }
          if (y == null || !Number.isFinite(y)) {
            el.style.display = 'none'
          } else {
            el.style.display = 'block'
            el.style.top = `${y}px`
          }
        }
      }
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [chartReady, darkPoolBarsLayout])

  // ── Chart event markers (earnings + splits + dividends) — /api/chart/markers ──
  const markersEnabled = cs.markers?.earnings || cs.markers?.splits || cs.markers?.dividends
  const { data: markersData } = useSWR(
    // Request the full window so earnings markers load back to inception alongside
    // the deep price history (backend caps + post-filters; badges cull off-screen).
    markersEnabled && sym ? `/api/chart/markers/${encodeURIComponent(sym)}?days=36500` : null,
    fetcher,
    {
      dedupingInterval: 43_200_000,  // 12 hours — matches backend cache TTL
      revalidateOnFocus: false,
    }
  )

  // ── News markers — /api/chart-news ──
  const showNews = !!cs.markers?.news
  const { data: newsData } = useSWR(
    showNews && sym ? `/api/chart-news/${encodeURIComponent(sym)}?days=60` : null,
    (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : { news: [] }),
    {
      dedupingInterval: 30 * 60 * 1000,  // 30 minutes
      revalidateOnFocus: false,
    }
  )
  const newsMarkers = useMemo(() => {
    if (!showNews || !newsData?.news) return []
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    // News timestamps are unix seconds; LW Charts expects ET-offset for intraday and date strings for daily/weekly.
    return newsData.news.map(n => {
      const tsRaw = typeof n.time_published === 'number' ? n.time_published : Number(n.time_published)
      if (!Number.isFinite(tsRaw)) return null
      // For daily/weekly, convert to YYYY-MM-DD date string in ET so it aligns with daily bars
      let time
      if (isDailyWeekly) {
        time = new Date(tsRaw * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      } else {
        time = tsRaw + _ET_OFFSET
      }
      return {
        time,
        position: 'aboveBar',
        color: '#3b82f6',
        shape: 'circle',
        text: 'N',
        size: 0.8,
        id: `news-${tsRaw}`,
        _newsData: n,
        _tsRaw: tsRaw,
      }
    }).filter(Boolean)
  }, [showNews, newsData, resolvedTf])
  const chartEventMarkers = useMemo(() => {
    // Only show event markers on daily/weekly — intraday bars don't line up with quarter dates
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!markersData || !isDailyWeekly) return []
    // Earnings, splits, and dividends are all drawn as bottom-row "E"/"S"/"D"
    // badges by the badge primitives (see earningsEvents/splitEvents/dividendEvents
    // below), NOT as LWC candle markers. Nothing to emit here for them.
    return []
  }, [markersData, cs.markers, resolvedTf])

  // { data, x, y } while an earnings popover is open (null = closed).
  // (earningsEvents itself is derived AFTER filteredBars is declared — see below.)
  const [earningsPopup, setEarningsPopup] = useState(null)

  // The INSTANCE whose settings dialog is open (null = closed). One instance id,
  // never a defId: "RSI(7) settings" and "RSI(14) settings" are two different
  // forms over one definition, and the write door has addressed instances since
  // Task 1. Task 4's chip gear sets this too.
  const [settingsInstanceId, setSettingsInstanceId] = useState(null)

  // ── chart-UX-walls TASK 4 — THE CHIP MENU ────────────────────────────────
  //
  // `{instanceId, anchor:{x,y}}` while a chip's ContextPopover is open, else null.
  // Anchored per chip because the popover is per INSTANCE: with two RSIs on the
  // chart, "which one did you right-click" is the only thing that distinguishes
  // Hide from Hide.
  const [chipMenu, setChipMenu] = useState(null)
  // Which PAGE of that one popover is showing: null = the six rows, 'move' = the
  // three placement targets. ⛔ A PAGE, NOT A NESTED MENU — `ContextPopover`
  // renders a flat list and IGNORES an `it.submenu`, so a "Move to ▸" row handed
  // to it verbatim would render as a live button that does nothing at all. That
  // is the exact defect this task exists to remove, one layer up.
  const [chipPage, setChipPage] = useState(null)
  // The instance whose ABOUT page the same popover is showing (spec §6's About
  // row). A second PAGE of one popover rather than a second popover: the text is
  // `def.meta.description`, which every definition already declares.
  const [chipAbout, setChipAbout] = useState(null)

  // ── Journal 2.0 markers + entry/stop price lines for this symbol ──
  // Returns empty arrays for unauth'd users. Merged with prop-supplied
  // markers/priceLines below so consumers (e.g. TradeDrawer) keep working.
  const j2Raw = useJ2ChartMarkers(sym, resolvedTf)
  // Curated book charts opt out of the viewer's personal Journal 2.0 overlay so
  // their own BUY/SELL trade markers don't bleed onto setup examples.
  const j2 = hideJournalOverlay ? EMPTY_J2 : j2Raw

  // ── Signature indicators (dark-pool levels · GEX walls · flow-confirmed breakouts) ──
  // Sits with the other overlay data hooks that feed the two merge memos below.
  // Everything is `[]` unless the viewer is paid AND that toggle is on — the hook
  // nulls its SWR keys otherwise, so an off/unpaid chart makes no request at all
  // (the usePatternDetections suppression idiom). Each array is memoized on its
  // payload, so the reference-guarded appliers below don't rebuild per tick.
  //
  // OFF on a date-framed historical chart (`exactDateRange`: Model Book years,
  // Setup Library / Bottoms examples). Those truncate `filteredBars` at the
  // framed year-end (see the exactSliceEnd slice), and lightweight-charts does
  // NOT drop a marker past the end — it snaps it to the nearest bar — so a 2026
  // FCB signal would plant a confident arrow on the last candle of a 2016
  // teaching chart. An undefined cfg nulls all three SWR keys, which also saves
  // three paid fetches on every curated-chart view.
  const isPaidUser = useIsPaid()
  const { dpLines, dpZones, gexLines, flowMarkers } =
    useSignatureIndicators(sym, exactDateRange ? undefined : cs.signature, isPaidUser, resolvedTf)

  // ── 🔴 PHASE D TASK 16 — USER DEFINITIONS, INSTALLED BEFORE THE BINDER READS ──
  //
  // The hook fetches this user's saved formulas and installs the ones that still
  // VALIDATE into `engineRegistry`, DURING RENDER. Until Task 16 nothing did:
  // `registerUserDefinitions` (now `validateUserDefinitions`) returned a checked
  // definition and installed it nowhere, so `getDefinition('u_…')` answered null,
  // `normalizeInstances(…, engineRegistry).kept` DROPPED the instance below, and
  // a saved formula drew nothing on any surface. Measured by the parity case
  // `ast_user_formula_sma20`, which read 0 changed pixels with AND without its
  // own perturbation.
  //
  // ⚠️ `userDefsGeneration` IS IN `updateChart`'s DEPENDENCY LIST, AND IT IS
  // REDUNDANT TODAY — MEASURED, NOT ASSUMED. The rows arrive from SWR after the
  // first paint, so the repaint that already dropped the instance has to run
  // again; the number changes iff the installed set changed, which is the
  // React-idiomatic way to depend on module state a hook mutates. Task 16's
  // gauntlet then REMOVED it (mutation M3) and every test stayed green: some
  // other entry in that 38-item list is already unstable across renders, so
  // `updateChart` is recreated on every render of this component anyway and the
  // repaint happens without this dep. It is reported as **SURVIVED**, not
  // dressed up as a kill.
  //
  // ⛔ IT STAYS ANYWAY, and the reason is the direction of the risk. It is the
  // ONLY entry in that list that names this dependency, and the redundancy is an
  // accident of a perf property nobody declared — the day somebody stabilises
  // whatever is unstable there (this repo runs perf passes), a chart that reads
  // module state with no dependency on its version stops drawing user formulas
  // with nothing to say so. What actually PROTECTS the feature is
  // `userDefinitionDraws.test.jsx`'s ordering case, which fails on the composite;
  // this is the declaration beside it. `errors` is not surfaced here: an invalid
  // stored definition is the BUILDER's sentence to say (this chart's honest
  // behaviour is to draw nothing for it), and a toast on a render path would fire
  // on every chart.
  const { generation: userDefsGeneration } = useInstalledUserDefinitions()

  const mergedMarkers = useMemo(
    () => {
      const all = [...(markers || []), ...(j2.markers || []), ...chartEventMarkers, ...newsMarkers, ...flowMarkers]
      // Lightweight Charts requires markers sorted ascending by time. Daily/weekly
      // use date strings (sortable lexicographically), intraday uses unix seconds.
      return all.sort((a, b) => {
        const ta = a?.time
        const tb = b?.time
        if (ta == null && tb == null) return 0
        if (ta == null) return -1
        if (tb == null) return 1
        if (typeof ta === 'number' && typeof tb === 'number') return ta - tb
        return String(ta).localeCompare(String(tb))
      })
    },
    [markers, j2.markers, chartEventMarkers, newsMarkers, flowMarkers],
  )
  const mergedPriceLines = useMemo(
    () => [...(priceLines || []), ...(j2.priceLines || []), ...dpLines, ...gexLines],
    [priceLines, j2.priceLines, dpLines, gexLines],
  )

  // Prop overrides — memoized to prevent unstable references
  const showVolume = showVolumeProp !== undefined ? showVolumeProp : cs.volume.visible
  // Volume in its own pane (no bottom band reserved on the price scale).
  const volInSeparatePane = volumeSeparatePane || !!cs.volume?.separatePane
  // When the SURFACE passes these props they WIN over the saved prefs — the OR
  // above ignores a saved `false`, and the height reads `volumePaneHeightPct ??
  // cs.volume.paneHeightPct`. That's deliberate (the charts-workspace recipe tunes
  // its price-scale margins for a separate pane, and sets the height by dragging the
  // separator), so tell the settings panel to render those two controls inert rather
  // than leaving them looking live. DERIVED from the props that do the forcing, so it
  // can never drift from the actual behavior.
  const volumePaneFixed = (volumeSeparatePane || volumePaneHeightPct != null)
    ? VOLUME_PANE_SURFACE_FIXED
    : null
  const resolvedOverlays = useMemo(
    () => {
      const base = overlaysProp !== undefined ? overlaysProp : cs.overlays.filter(o => o.enabled)
      // showSma5 is a LEGACY fallback from before SMA 5 was a real, editable overlay.
      // Only inject the synthetic faint SMA 5 when the user has NO SMA 5 overlay AT ALL
      // — checked against the UNFILTERED cs.overlays. Otherwise a DISABLED real SMA 5
      // (dropped from the enabled-filtered `base`) got re-added here as a faint phantom,
      // whose near-invisible legend row read as a blank GAP that never collapsed.
      const hasRealSma5 = (cs.overlays || []).some(o => o.type === 'SMA' && Number(o.period) === 5)
      if (!showSma5 || hasRealSma5 || base.some(o => o.type === 'SMA' && Number(o.period) === 5)) return base
      // A very faint 5-SMA (barely visible). Dark on the light Sunrise canvas, light on
      // the dark canvas — either way just a whisper of a line. Appended so it's included
      // in the legend + line rendering like any other overlay.
      const sma5 = { enabled: true, type: 'SMA', period: 5, color: canvasTheme === 'sunrise' ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.16)' }
      // Prepend so the legend lists it above the 9-EMA (numerical order: 5, 9, 20, 50, 200).
      return [sma5, ...base]
    },
    [overlaysProp, cs.overlays, showSma5, canvasTheme]
  )

  const containerRef = useRef(null)
  const wmCtrlRef = useRef(null)        // watermark primitive controller
  const wmAttachedRef = useRef(false)   // guard: primitive attached once
  const sessionShadeRef = useRef(null)      // extended-hours shading primitive (price pane)
  const sessionShadeAttachedRef = useRef(false)
  const sessionShadeVolRef = useRef(null)   // second instance for the separate VOLUME pane
  const sessionShadeVolAttachedRef = useRef(false)
  const lastShadeBandsVolRef = useRef(null)
  const swingCtrlRef = useRef(null)       // swing-label series primitive controller
  const swingAttachedRef = useRef(false)  // guard: re-attach on candle-series swap
  const swingPointsRef = useRef([])       // latest swing pivots — redrawn into the PNG screenshot
  const zonesCtlRef = useRef(null)        // dark-pool level-zones series primitive controller
  const zonesAttachedRef = useRef(false)  // guard: re-attach on candle-series swap
  const lastDpZonesRef = useRef(undefined) // identity guard — see the setZones call
  const pdlCtlRef = useRef(null)          // previous-day H/L/C lines series primitive controller
  const pdlAttachedRef = useRef(false)    // guard: re-attach on candle-series swap
  const earnBadgeRef = useRef(null)       // earnings "E" badge series primitive controller
  const earnBadgeAttachedRef = useRef(false)  // guard: re-attach on candle-series swap
  const splitBadgeRef = useRef(null)      // splits "S" badge primitive controller
  const splitBadgeAttachedRef = useRef(false)
  const divBadgeRef = useRef(null)        // dividends "D" badge primitive controller
  const divBadgeAttachedRef = useRef(false)
  const tickerMeta = useTickerMeta(sym)
  // Watermark meta. Three cases (Model Book curates name/sector/industry):
  //  1. No curated name → use live ticker meta, but let a curated sector/industry
  //     fill any GAPS the live lookup left blank.
  //  2. Curated name that token-overlaps the live name (same company, just a tidier
  //     label) → keep the accurate live GICS sector/industry, curated fills gaps.
  //  3. Curated name that does NOT match the live name (a REUSED / renamed /
  //     delisted ticker — e.g. SQ=Square→Block, WTW=Weight Watchers, delisted WWE)
  //     → the live meta is the WRONG company, so use the curated name AND the
  //     curated historical sector/industry (so the watermark still shows them like
  //     every other stock, instead of dropping them).
  const watermarkMeta = useMemo(() => {
    const withCuratedGaps = (base) => ({
      ...base,
      sector: base?.sector || watermarkSector || null,
      industry: base?.industry || watermarkIndustry || null,
    })
    if (!watermarkName) {
      return (watermarkSector || watermarkIndustry) ? withCuratedGaps(tickerMeta) : tickerMeta
    }
    const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
    const curated = toks(watermarkName), live = toks(tickerMeta?.name)
    const sameCompany = curated.length > 0 && curated.some(w => live.includes(w))
    if (sameCompany) return withCuratedGaps({ ...tickerMeta, name: watermarkName })
    return { name: watermarkName, sector: watermarkSector || null, industry: watermarkIndustry || null }
  }, [watermarkName, watermarkSector, watermarkIndustry, tickerMeta])

  // ── Crosshair-legend layout ────────────────────────────────────────────────
  // Only surfaces that opt into the workspace legend (`verticalLegend`) follow the
  // user's Chart Settings → Header → Legend layout choice; everywhere else
  // (Model Book, popups, gallery charts…) keeps its own inline row untouched.
  //   vertical   → the stacked label/value table  (.legendVertical)
  //   horizontal → a flat, box-less two-line strip (.legendFlat)
  const legendFlat = verticalLegend && cs.header?.legendLayout === 'horizontal'
  const legendStacked = verticalLegend && !legendFlat
  // Width (px) of the right price axis — reserved so a horizontal legend wraps to
  // the next row BEFORE it slides under the price scale (measured reactively below).
  const [legendAxisReserve, setLegendAxisReserve] = useState(0)

  useWatermarkDrag({
    containerRef,
    controllerRef: wmCtrlRef,
    locked: lockWatermark,
    getActiveTool: () => activeToolRef.current,
    onCommit: ({ x, y }) => {
      // Setup Library: persist the new position on THIS example only, never the
      // global chart_settings (so other charts site-wide keep their watermark).
      if (onWatermarkCommit) { onWatermarkCommit({ x, y }); return }
      const next = mergeChartSettings(prefs.chart_settings)
      next.watermark = { ...next.watermark, x, y }
      next.preset = 'custom'
      setPref('chart_settings', JSON.stringify(next))
    },
  })
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)

  // Keep the plot-centered watermark centered the INSTANT the chart resizes (e.g.
  // a sibling widget is added and this chart narrows). hardCenterXPx is otherwise
  // recomputed only when updateChart next runs (on a data poll), leaving the mark
  // visibly off-center for seconds after a resize. subscribeSizeChange fires on
  // every time-scale width change.
  useEffect(() => {
    if (!chartReady || !centerWatermarkOnPlot) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let ts
    try { ts = chart.timeScale() } catch { return undefined }
    const onSize = () => {
      try {
        const tw = ts.width()
        let aw = 0; try { aw = chart.priceScale('right').width() || 0 } catch { /* no right axis */ }
        if (tw > 0 && wmCtrlRef.current) wmCtrlRef.current.setOptions({ hardCenterXPx: (tw + aw) / 2 })
      } catch { /* noop */ }
    }
    try { ts.subscribeSizeChange(onSize) } catch { return undefined }
    onSize()  // sync once on (re)subscribe
    return () => { try { ts.unsubscribeSizeChange(onSize) } catch { /* noop */ } }
  }, [chartReady, centerWatermarkOnPlot])

  // Reserve the right price-axis width for the HORIZONTAL legend so a long MA row
  // wraps to the next line before reaching the price scale (instead of the last
  // chip sliding UNDER it). timeScale().width() = plot width, so the axis width
  // change (bigger price labels → narrower plot) fires subscribeSizeChange.
  useEffect(() => {
    if (!chartReady) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let ts
    try { ts = chart.timeScale() } catch { return undefined }
    const onSize = () => {
      let aw = 0
      try { aw = chart.priceScale('right').width() || 0 } catch { /* no right axis */ }
      setLegendAxisReserve((prev) => (Math.abs(prev - aw) > 1 ? aw : prev))
    }
    try { ts.subscribeSizeChange(onSize) } catch { return undefined }
    onSize()
    return () => { try { ts.unsubscribeSizeChange(onSize) } catch { /* noop */ } }
  }, [chartReady])

  // ⭐ FLIP C. The pane geometry the last `updateChart` pass computed, or `null`
  // in `'bands'` mode — which is every user today, so every reader below takes
  // the branch it always took. It is a REF and not a memo because the layout
  // needs the LIVE pane-stack height (the chart's height minus the time axis,
  // which only the renderer knows) and the instance list, and `updateChart` is
  // the one place both are in hand. ⚠️ That makes it one paint stale for the
  // render-pass readers when the chart is RESIZED — the trade B5 Task 9 refused
  // for the now-retired `csPanes`, taken here because the alternative is re-deriving the
  // renderer's own time-axis height in the component body. The binder's height
  // check is what makes a stale layout loud instead of silent.
  const paneLayoutRef = useRef(null)
  const indexPaneSeriesRef = useRef(null) // LineSeries for the index-comparison pane (Model Book ^IXIC)
  const indexMaSeriesRef = useRef(null)   // 50-period SMA line drawn on the index pane (matches the price chart's 50 SMA color)
  const indexScaleRef = useRef({ range: null, pin: false })  // fixed price range for the index pane's autoscaleInfoProvider (pins it steady across ticker switches; pin=false in Percent mode)
  const lastIndexSigRef = useRef(null)  // signature of the last-drawn index line/MA so we SKIP setData+relayout when flipping tickers in the same year (the index line is identical → no millisecond glitch)
  const volumeSeparatePaneRef = useRef(false)  // tracks current volume render mode so a toggle recreates the series in the right pane
  // ⛔ `indScaleRef` STOOD HERE AND WENT WITH `ensureIndTarget` (B5 Task 8). It
  // remembered each indicator's last price-scale id so the volume-overlay toggle
  // could DESTROY and recreate its series in the right pane — the exact
  // destroy/recreate #2049 forbids. The engine relocates a pooled series with
  // `moveToPane` + `moveSeriesToScale` instead, keeping the same series object,
  // and `binder.js` owns that bookkeeping.
  // The indicator engine (Phase B), as `{ chart, binder }`. NULL while the chart
  // holds no instances — nothing is constructed and nothing is called, which is the
  // lands-dark contract (it used to say "while the flag is off"; B5 Task 4 deleted
  // the flag and `engineNeeded` is the honest predicate). The chart handle is stored
  // alongside so a destroyed→recreated chart drops the binder rather than inheriting
  // series that no longer exist (the same latch-reset discipline every other ref in
  // `updateChart` follows).
  const engineRef = useRef(null)
  // The pane manifest's unregister thunk (Task 3's one-slot registry in
  // `engine/paneLayout.js`). Held in a ref so the unmount cleanup — which is the
  // effect that owns `chart.remove()` — can undo exactly what the create branch did.
  const unregisterManifestRef = useRef(null)
  // The declutter toggle's state, as a REF, so `updateChart` can read it without
  // taking it as a dependency. `visible` is part of the complete option set the
  // binder re-asserts on every bind, so the binder has to know what the toggle
  // says or the next paint (~1×/sec in extended hours) would silently re-show a
  // hidden indicator. Making it a dep instead would re-run the entire chart
  // update on every Alt+Shift+I — a behaviour change the parity gate would be
  // right to flag. Written in the render body, below the `useState` that owns it.
  const indicatorsHiddenRef = useRef(false)
  const overlaySeriesRefs = useRef([])
  const overlayTailSeriesRefs = useRef([])   // candleFrameFade: post-setup MA tail segments whose opacity crossfades on Setup⇄Result
  const frameFadeAlphaRef = useRef(1)        // mirror of frameFadeAlpha for the (deps-light) updateChart overlay loop
  // ⛔ NO `bbUpperRef` / `bbMiddleRef` / `bbLowerRef` / `rsiSeriesRef` (Task 10),
  // and NO `vwapSeriesRef` / `macdLineRef` / `macdSignalRef` / `macdHistRef`
  // (Task 11). All four pilots are FLIPPED — the engine's binding map owns their
  // series, and a ref here would be a second, stale handle to something the pool
  // re-purposes. See the flip note where their render blocks used to be.
  // ⛔ AND NO `stochKRef` / `stochDRef` / `atrSeriesRef` (B5 Task 5) — same
  // reason, same deletion. The engine's binding map owns those three series.
  // ⛔ AND NO `sarSeriesRef` / `ichimoku{Tenkan,Kijun,SpanA,SpanB,Chikou}Ref`
  // (B5 Task 6) — six more, same reason. `sar` is the first `markers` plot the
  // pool has ever held, and a stale ref to a series the pool may hand to an RSI
  // line is exactly the leak `pool.js`'s complete-key-set rule exists for.
  // ⛔ AND NO `mfiSeriesRef` / `cciSeriesRef` / `williamsRSeriesRef` (B5 Task 7)
  // — three more, same reason. `mfi` is the RECEIVING half of the measured
  // `stoch.d → mfi.mfi` pool leak in `pool.js`'s header, so a second handle to a
  // series the pool re-purposes is precisely the shape that leak takes.
  //
  // ⛔⭐ AND NO `adxSeriesRef` / `adxPlusDIRef` / `adxMinusDIRef` /
  // `obvSeriesRef` / `donchianUpperRef` / `donchianMiddleRef` /
  // `donchianLowerRef` (B5 TASK 8) — THE LAST SEVEN, WHICH IS WHY THE LEDGER ROW
  // *"the series useRef declarations"* RETIRES HERE RATHER THAN MOVING ITS ANCHOR
  // A FOURTH TIME. There is no indicator series in this component that the
  // engine's binding map does not own, so this is not a shrinking list any more:
  // it is a deleted region, and `enumerationSites.test.js`'s `RETIRED_BY_B5_TASK8`
  // re-runs its anchor and demands ZERO matches.
  const compareSeriesRef = useRef(null)
  const comparisonSeriesRefs = useRef(new Map()) // sym -> LineSeries (multi-symbol comparison overlays)
  const vpCanvasRef = useRef(null)
  const priceLineRefs = useRef([])
  // Identity guard so updateChart doesn't tear down + rebuild price lines on
  // every real-time tick. mergedPriceLines is useMemo'd, so when its deps
  // (priceLines prop, j2 markers) are stable across ticks the reference is
  // stable too — skipping the rebuild saves significant LWC canvas work on
  // charts with many lines + axis labels (e.g. the GEX chart with 8-12).
  const lastPriceLinesRef = useRef(undefined)
  // The live session (Pre/Post + locked-close) tags own their OWN price lines,
  // separate from priceLineRefs, so each applier only ever removes what it created.
  // sessionTagSeriesRef pins WHICH series they were created on: a destroyed→recreated
  // chart (grid cells do this) drops its price lines, so a series swap must force a
  // rebuild instead of applyOptions-ing handles that belong to a dead series.
  const sessionTagRefs = useRef([])
  const sessionTagSeriesRef = useRef(null)
  // Identity of the marker array last handed to the controller — see the guard in
  // updateChart. Reset with the chart, since a new chart has no marker layer.
  const lastMarkersSrcRef = useRef(undefined)
  const markersControllerRef = useRef(null)  // lightweight-charts SeriesMarkers controller — must be reused/detached, not recreated
  // One-way axis-width ratchet: the widest right-axis column MEASURED this
  // sym/tf session. The static _axisMinWidth floor is an empirical calibration
  // (76 @ fontSize 11 @ DPR 1.5) that has now been out-drifted three separate
  // times (raw floor → textSize scaling → volume-pane pin); whenever any tag
  // measures even 1px past the floor, LWC auto-sizes the shared column per
  // live write and the sub-pixel re-measure jitter shakes the whole plot
  // left-right. Ratcheting the floor up to the widest observed width lets the
  // column grow but never shrink mid-session — immune to DPR/zoom/font drift.
  const axisWidthRatchetRef = useRef(0)
  const volMaSeriesRef = useRef(null)  // 50-MA line on the volume pane
  const volMaDataRef = useRef([])      // latest volMaData (avg-volume series) for the crosshair legend
  const volLegendRef = useRef(null)    // volume-pane top-left legend ($ vol + avg vol) — positioned live
  const legendRef = useRef(null)       // main OHLC/MA legend — captured into the PNG screenshot
  // Volume-pane height % last APPLIED via setStretchFactor. Gate re-applies on it
  // so a 30s data poll can't reset the pane and fight a user's separator drag; the
  // drag sampler compares the live pane % against it to detect a user resize.
  const lastAppliedVolPctRef = useRef(null)
  // ⭐ FLIP C: a user's separator DRAG, as `{from, pct}` — see chart/volumePaneDrag.js.
  // `lastAppliedVolPctRef` gates the writer below; it does NOT gate the binder's
  // `applyPaneStretch`, which re-asserts `paneLayout.above` at the end of EVERY
  // sync and so put a dragged divider straight back. The layout is computed from
  // this latch, so the drag becomes the setting rather than fighting it.
  const volDragLatchRef = useRef(null)
  // The settings value the latch has to out-rank, stamped where the layout reads
  // it so the 300 ms sampler does not have to take `cs` as a dependency and
  // re-subscribe on every settings object identity change.
  const volPctSettingRef = useRef(null)
  const volMaTailSeriesRef = useRef(null)  // candleFrameFade: post-setup tail of the volume MA (crossfades with everything else)
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
  const lastTfRef = useRef(null)   // Last resolved timeframe — distinguishes tf change from ticker switch
  const pendingTfReframeRef = useRef(null)  // On a TF switch, holds { tf, pos, width } of the OUTGOING view; re-asserts that exact anchor+zoom on every commit until the bar count settles, so flipping timeframes doesn't move the chart (and can't snap hard-left during the phased load)
  const lastBarCountRef = useRef(0) // Last bar count — lets a ticker switch right-anchor the preserved view
  const lastCfgSigRef = useRef(null) // A2: render-config signature at last paint — an incremental (last-bar-only) update is only safe when the config is byte-identical to the last paint
  const prevBarsRef = useRef(null) // Previous render's bars — used to measure outgoing vertical placement
  // A2: the bars actually PAINTED at the last setData (i.e. displayBars, which carries
  // the session-preview candle). Distinct from prevBarsRef (pure regular-session bars):
  // the no-op/incremental render plan must be measured against what's on screen, or a
  // change that lives only on the display path — the pre/post-market preview candle —
  // is read as "nothing changed" and never paints. See the plan comment in updateChart.
  const prevPaintBarsRef = useRef(null)
  // True only while a Shift+drag measure is in progress — every handleScroll site
  // reads it so a data-poll re-applyOptions can't unlock the chart mid-measure.
  const measureLockRef = useRef(false)
  // ── User view-interaction latch ──
  // Set the moment the user pans/zooms this chart themselves; cleared on a
  // symbol/timeframe switch and on an explicit "Reset view". Read by the
  // pinned-right safety net in updateChart, which must correct DRIFT but never
  // undo a deliberate pan (that was the "drag left and it snaps straight back"
  // bug — the net re-fired on the next live data commit).
  const userViewMovedRef = useRef(false)
  // REPLAY view lock: once the user pans/zooms while in replay, every subsequent ticker
  // in the sort keeps that exact view (right-relative) instead of snapping back to the
  // default replay frame. Persists across ticker switches; cleared by "Reset view" or on
  // exit replay. (userViewMovedRef is re-armed each sym switch, so it can't hold this.)
  const replayViewLockedRef = useRef(false)
  // The locked view's RIGHT-RELATIVE params {barsFromRight, width}, captured on the
  // CURRENT ticker at pan/zoom time — NOT derived from oldRange after a sym switch (that
  // range is clamped to the new ticker's extent, so a short-history name like ROOT loses
  // the deep scroll-back a long-history name like QQQ had). Applied to every new ticker.
  const replayLockedViewRef = useRef(null)
  const viewPointerRef = useRef(null)       // {x, y} of the in-flight press, else null
  const lastPointerDownAtRef = useRef(0)    // ms of the last press anywhere on the chart
  // Is the user's pointer physically over THIS chart? The ONLY trustworthy
  // "am I the hovered chart" signal. LWC's crosshair subscription is not: an
  // externally-applied crosshair (setCrosshairPosition, multi-chart sync) fires
  // the same event shape as a real hover, so deriving hover from it made a
  // synced chart declare itself hovered and then refuse every further sync
  // update — the "other widget's crosshair freezes" bug.
  const pointerOverRef = useRef(false)
  const focusRafRef = useRef(null)        // in-flight focus-zoom animation frame id
  const focusActiveRef = useRef(false)    // true while a setup-focus zoom owns the view (suppresses the year-range pin)
  const focusKeyRef = useRef(null)        // sym+tf the focus belongs to — a change releases focus back to the pin
  const lastFocusNonceRef = useRef(0)     // last processed focusNonce — only act when it actually changes
  const yearFramedRef = useRef(null)      // sym+tf the exact-range year frame has been rAF-reapplied for (first-load layout race)
  const yearRangeRef = useRef(null)       // latest {from,to} logical range for the framed year — re-asserts read this so staged data loads can't lock in stale indices
  const focusRangeRef = useRef(null)      // settled {from,to} logical range of the active setup-focus zoom — updateChart re-asserts this so a bars refetch can't snap the horizontal view back while the vertical stays pinned
  const focusPriceRangeRef = useRef(null) // {lo,hi} interpolated price range during a focus zoom (smooth vertical via autoscaleInfoProvider); null = default autoscale
  const focusProviderInstalledRef = useRef(false) // whether the candle series has the focus autoscale provider attached
  const textFadeRef = useRef(0)           // 0..1 opacity for setup TEXT annotations — driven by the focus zoom (Model Book): hidden zoomed out, eases in as it lands on a setup
  const exactPinSigRef = useRef(null)     // `${sym}_${tf}|${entryDate}|${exitDate}` last pinned exact-range frame — a same-chart date change (Setup ⇄ Result flip) glides instead of snapping
  const annRedrawRef = useRef(null)       // set by the annotation overlay; called right after an instant frame snap so the price-anchored lines re-resolve to the new mapping in the same frame (no 1-frame position pop)
  const hadHighlightRef = useRef(false)   // whether a gold highlight bar is currently applied (so we only clear when needed)
  const vertMarginsRef = useRef(null) // Captured proportional candle placement {top,bottom}; null = default headroom
  const latestLiveRef = useRef(null)  // Latest live price — used to re-apply after setData() wipes
  const liveBarRef = useRef(null)     // Developing bar OHLCV tracked tick-by-tick (survives setData)
  const lastServerCloseRef = useRef(null)  // Last close from CLEAN server bars — poison-proof live-tick baseline
  // ── colorByNetChange (TC2000/StockCharts coloring) ── Track the closes needed to
  // color the DEVELOPING bar on live ticks: netPrevCloseRef = close of the bar BEFORE
  // the current last bar (the developing bar's reference); lastNetCloseRef/lastNetTimeRef
  // track the current last bar so a live rollover to a NEW bar re-bases the reference.
  const netPrevCloseRef = useRef(null)
  const lastNetCloseRef = useRef(null)
  // Live candle colors read by the net-change wrapper (see updateChart). Kept in a
  // ref + off the price-style key so a COLOR change repaints via setData instead of
  // destroying+recreating the price series (that recreation re-fit the price scale =
  // the "chart shakes up/down when I change a color" bug). Type/theme still recreate.
  const netColorsRef = useRef({})
  // {high,low} of the last bar + the bar before it — for the Sunrise inside-bar check
  // on the developing (live) bar (setData tracks these inline for historical bars).
  const lastNetBarRef = useRef(null)
  const netPrevBarRef = useRef(null)
  const lastNetTimeRef = useRef(null)
  // ── Phase C single-writer invariant (updated each render below the useRealtimeBars
  // call) ── When barsPushActiveRef.current is true, the Massive push writer is the SOLE
  // developing-bar writer; the Finnhub-fed writers early-return. A ref so writers read the
  // latest without re-subscribing.
  //
  // ⚠️ EVERY developing-bar writer MUST consult this flag, or be DISJOINT from push by
  // construction and say so. A writer that forgets the guard dual-writes or paints the
  // wrong candle — exactly how the Heikin-Ashi raw-candle bug shipped (retro audit 2026-07-06).
  //
  // ⛔ THIS INDEX IS NO LONGER MAINTAINED BY HAND, AND THE REASON IS THAT IT ROTTED.
  // It said "the FOUR that exist today, and any FIFTH one added later" and listed A-D with
  // line numbers (~L2748 / ~L2890 / ~L5785 / ~L3336). Measured 2026-08-07: there are SIX
  // writers, and all four cited line numbers were off by 2,300-4,700 lines in an
  // 11,700-line file. Both E and F were CORRECT when found — the defect was the artifact
  // the next engineer audits against, which is the very bug class the paragraph above
  // cites. The set is now DERIVED from this file's AST by
  // `engine/__tests__/singleWriterIndex.test.js` (every `.update()` on
  // `candleSeriesRef.current`, alias-resolved), which pins the count and each writer's
  // guard. Adding a seventh writer fails that test by name. This list is the reader's
  // map; that test is the authority.
  //   • Writer A — livePrices tick effect (Finnhub)  : if (barsPushActiveRef.current) return
  //   • Writer B — onRealtimeBar, Massive push       : if (!barsPushActiveRef.current) return  ← B IS the writer
  //   • Writer C — realtimeCandle registry (Finnhub) : if (barsPushActiveRef.current) return
  //   • Writer D — updateChart post-setData re-top   : branch — push-owned re-top vs Finnhub re-top
  //   • Writer E — fast D/W/M candle on the bars-WS 1-min tick : folded into the daily-plus guard
  //   • Writer F — custom-TF live developing bar     : NO GUARD, and must not have one.
  //       `_pushOptIn` requires `realtimeTfEligible`, a membership test against the five
  //       NATIVE intraday codes, so barsPushActiveRef is structurally false on a custom TF.
  //       A guard there would be dead code, which is worse than none: it reads as protection.
  const barsPushActiveRef = useRef(false)
  // When true, the on-screen bars are a PROVISIONAL stale-intraday cache paint
  // (instant sym-switch, forced full refetch in flight). Writers A/B/C/D FREEZE while this
  // is set so a live tick can't grow a phantom candle on the stale tail before
  // authoritative bars swap in. Set in the `bars` selector each render.
  // ⚠️ It said "all FOUR live-bar writers" when four was also the writer count; those are
  // two different numbers now. E and F do NOT consult this ref and do not need to:
  // `provisionalStaleRef` is `isIntraday &&`-gated on the same five native intraday codes,
  // E is daily-plus only and F is custom-TF only, so it is structurally false in both.
  // That disjointness is asserted in `singleWriterIndex.test.js`, not assumed here.
  const provisionalStaleRef = useRef(false)
  // Self-heal throttle: when a live push bar arrives >1 interval ahead of the frozen
  // series tail (the steady-state SWR delta poll stalled — e.g. a deploy dropped the
  // SSE + the visibility-gated refresh paused), the contiguity guard forces an SWR
  // revalidation to pull the missing bars. Throttled so it fires at most once per
  // window instead of on every push tick while the chart is catching up.
  const gapHealAtRef = useRef(0)
  const barsMutateRef = useRef(null)  // latest SWR mutate() for the bars key (stale-closure-safe)
  const barStartVolRef = useRef(0)    // Cumulative volume at start of current bar (for per-bar delta)
  // Session preview owns the D/W/M developing bar during pre/post market on the
  // workspace (synthetic pre-market candle / frozen-at-4pm regular candle) — a
  // 5th writer-ownership condition alongside barsPushActive. Writers A + D read
  // this ref to yield the D/W/M last bar to the memo-driven setData.
  const sessionOwnsDailyRef = useRef(false)
  const sessionViewRef = useRef(sessionView)  // latest sessionView, read by live-tick writers

  // ── Extended hours (single toggle: pre/post shading AND price data) ──
  // Driven by the ONE `extendedHoursShading` chart setting (labeled "Extended
  // hours" in the UI). ON = pre/post-market candles + shading show; OFF = only
  // the regular session (9:30–4:00 ET) renders on intraday charts, with overnight
  // gaps — the pre/post PRICE DATA is filtered out, not just the shading.
  // handleToggleExtended (the toolbar EXT/RTH button) is defined just below,
  // after handleUpdateChartSettings, and writes the same setting.
  // forceExtendedHours (when not null) overrides the saved setting. This is the
  // ONE place the flag is derived, and it drives both the shading primitive AND
  // the pre/post PRICE FILTER, so false gives an RTH-only chart in one move.
  const showExtended = (forceExtendedHours === null || forceExtendedHours === undefined)
    ? (cs.extendedHoursShading ?? true)
    : !!forceExtendedHours
  // Latest showExtended, read by the live-tick writers (which are callbacks and
  // would otherwise close over a stale value). When false (RTH), the live path
  // must not paint pre/post-market intraday bars — mirroring the sessionBars fetch
  // filter — or the current ext session leaks onto an RTH-only chart.
  const showExtendedRef = useRef(showExtended)
  showExtendedRef.current = showExtended
  // Latest "is it pre/post market right now (ET clock)", same latest-ref reason.
  // Assigned next to _inExtWindow's derivation further down.
  const inExtWindowRef = useRef(false)

  // ── Drawing tools state ──
  // ── Crosshair legend state ──
  const [crosshairData, setCrosshairData] = useState(null)
  // The `+N` fold, expanded in place. False on every mount on purpose: a strip
  // that reopens itself is a strip the user closed for nothing.
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const legendHoveringRef = useRef(false)
  // True while a SYNCED (external) crosshair is applied to this chart. The
  // always-show-legend refreshers below must stand down for it exactly as they
  // do for a local hover — otherwise they'd overwrite the synced bar's readout
  // with the latest bar's several times a second.
  const externalCrosshairAppliedRef = useRef(false)
  // In-flight rAF that releases applyingExternalRef. Held in a ref (not an
  // effect-scoped local) because the applier now runs off the sync bus, outside
  // any effect's lifetime — each apply supersedes the previous frame's release.
  const applyingExternalRafRef = useRef(null)
  // Fastest available developing-bar close, written imperatively (NO re-render)
  // from the Massive bars WS — the SAME reliable feed the theme tracker + header
  // gain use. computeLatestCrosshair prefers this so the legend's price / change
  // match the theme tracker instead of the laggy Finnhub feed.
  const liveTickRef = useRef(null)
  /**
   * The chips for the LAST bar — no crosshair, so no `seriesData`.
   *
   * ⚠️ `engineInstancesRef` is declared BELOW this function, and that is safe:
   * `latestChips` is only ever CALLED from effects and handlers, long after
   * every `useRef` in the component body has run. Do not "fix" it by moving the
   * ref — the declaration order below it is what the rest of the file depends on.
   */
  const latestChips = () => {
    try {
      const engine = engineRef.current
      if (!engine) return EMPTY_CHIPS
      const chips = legendChips(engine.binder.bindings(), null, engineRegistry, engineInstancesRef.current)
      return chips.length ? chips : EMPTY_CHIPS
    } catch { return EMPTY_CHIPS }
  }
  // Build the legend payload for the LATEST bar (used when the cursor is off the
  // chart and alwaysShowLegend is on). Reads live refs; safe to call from effects.
  const computeLatestCrosshair = () => {
    const bars = prevBarsRef.current
    if (!bars || !bars.length) return null
    const last = bars[bars.length - 1]
    let o = last.o, h = last.h, l = last.l
    let c = last.c
    // Prefer the live developing bar the CANDLE is showing (lastBarRef), so the
    // legend tracks the candle exactly rather than a separate/stale source.
    const lb = lastBarRef.current
    if (lb && lb.time === adjustTime(last.t) && Number.isFinite(lb.close)) {
      o = lb.open; h = lb.high; l = lb.low; c = lb.close
    }
    const lp = livePricesRef.current?.[symRef.current]
    // Fast Massive tick (ref, no re-render) wins for the close when RECENT +
    // sane — this makes the legend tick as fast as the theme tracker. When the
    // Massive feed gaps (periodic ~15s), fall back to the always-fresh Finnhub
    // price so the legend never freezes.
    const ft = liveTickRef.current
    const fastFresh = ft && ft.price != null && (Date.now() - ft.ts) < LIVE_TICK_FRESH_MS
    // Regular/RTH-only mode during an extended session: the developing candle is
    // frozen at the RTH close, so keep the LEGEND on it too — don't fold the live
    // pre/post-market price into close/high/low (else the legend disagrees with the
    // frozen candle). D/W/M keys off sessionView; intraday off the EXT/RTH toggle.
    const _nowMin = etMinutes(Math.floor(Date.now() / 1000))
    const _nowExt = _nowMin < 570 || _nowMin >= 960
    const _isDWMtf = ['D', 'W', 'M'].includes(resolvedTfRef.current)
    const _rthLock = _nowExt && (
      (_isDWMtf && sessionViewRef.current === 'regular')
      || (!_isDWMtf && !showExtendedRef.current)
    )
    if (_rthLock) {
      // keep c / h / l from the frozen RTH bar
    } else if (fastFresh && isSaneLivePrice(ft.price, c, lastServerCloseRef.current)) {
      c = ft.price
      if (Number.isFinite(h)) h = Math.max(h, ft.price)
      if (Number.isFinite(l)) l = Math.min(l, ft.price)
    } else if (lp?.price && isSaneLivePrice(lp.price, c, lastServerCloseRef.current)) {
      c = lp.price
    }
    let vol = last.v
    // The developing bar's volume comes from /api/bars and does NOT tick live —
    // it only refreshes on the slow SWR interval, so the legend/pane lagged the
    // (live, 2s) watchlist by millions of shares intraday. The live feed's day
    // volume is as-fresh-or-fresher, and intraday volume only grows, so take the
    // larger. Safe on ANY bar without a date check: for a historical last bar
    // (e.g. Friday on a weekend) the feed carries that same last session's volume,
    // never a larger "today" value — so max() can't over-count it.
    // ONLY on D/W/M, where the developing bar IS the day/week/month so the live
    // feed's cumulative DAY volume equals that bar's volume. On intraday the day
    // total is NOT the 5m/1m bucket's volume — applying it painted the whole day's
    // ~30M onto the developing intraday bar (the phantom volume spike). Intraday
    // per-bar volume ticks live via the push feed (Writer B/D from liveBarRef).
    if (['D', 'W', 'M'].includes(resolvedTf) && lp?.volume != null && Number.isFinite(lp.volume) && lp.volume > (vol || 0)) {
      vol = lp.volume
    }
    // Change is close-vs-PREVIOUS-BAR-close ON THE CURRENT TIMEFRAME, so the
    // legend reflects the selected TF (weekly = vs last week, 5m = vs the prior
    // 5m bar), not always "today". DAILY is the special case where the prior bar
    // IS yesterday, so there we prefer the live feed's OFFICIAL prev_close to
    // match the theme tracker / brokers exactly. `c` is the live price.
    const feedPrev = (lp && Number.isFinite(lp.prev_close) && lp.prev_close > 0) ? lp.prev_close : null
    const feedPct = (lp && Number.isFinite(lp.change_pct)) ? lp.change_pct : null
    const feedChg = (lp && Number.isFinite(lp.change)) ? lp.change : null
    const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null
    const prevBarClose = (prevBar && prevBar.c != null) ? prevBar.c : null
    const prevClose = (resolvedTfRef.current === 'D')
      ? (feedPrev ?? prevBarClose)
      : (prevBarClose ?? feedPrev)
    // DAILY: trust the feed's SERVER-computed today % (change_pct / change) — the
    // regular-session move vs the official prev close. Deriving it from
    // (livePrice − prevClose) reads 0.00% whenever the streamed live price sits at
    // the reference (weekends / after-hours, where the live price IS the last
    // close) — the recurring "goes to 0.00%" bug. Other TFs stay bar-vs-prior-bar.
    let change, changePct
    if (resolvedTfRef.current === 'D' && feedPct != null) {
      changePct = feedPct
      change = feedChg != null ? feedChg : (prevClose != null ? c - prevClose : c - o)
    } else {
      change = prevClose != null ? c - prevClose : c - o
      changePct = (prevClose != null && prevClose) ? (change / prevClose) * 100 : (o ? (change / o) * 100 : 0)
    }
    const ovData = overlayDataRef.current || []
    const rovs = resolvedOverlaysRef.current || []
    const overlays = rovs.map((ov, i) => {
      const d = ovData[i]?.data
      const pt = (d && d.length) ? d[d.length - 1] : null
      // Drop DISABLED overlays (they can still carry stale computed data) so a
      // toggled-off MA vanishes from the always-on legend and the grid collapses —
      // matching the live/crosshair builder's `ov.enabled === false` guard.
      if (!pt || !ov || ov.enabled === false) return null
      const color = ema9CandleColorFor(ov) ?? ov.color
      return { label: `${ov.type} ${ov.period}`, value: pt.value, color, _period: Number(ov.period) }
    }).filter(Boolean).sort((a, b) => a._period - b._period)   // legend always in ascending-period order
    const vma = volMaDataRef.current
    return {
      time: last.t, open: o, high: h, low: l, close: c, volume: vol,
      change: change.toFixed(2), changePct: changePct.toFixed(2),
      dollarVol: (Number.isFinite(vol) && Number.isFinite(c)) ? vol * c : null,
      volAvg: (vma && vma.length) ? vma[vma.length - 1].value : null,
      volMaPeriod: volMaPeriodEff || null,
      // ⭐ THE CHIPS THE OFF-CURSOR LEGEND NOW PRINTS. This line read
      // `chips: EMPTY_CHIPS` with a comment saying "the always-on legend has
      // never printed an indicator value" — which was true, and was Wall 1's
      // display half in one field: `alwaysShowLegend` ships on 12 ChartPane
      // mount modules and on `/r/chart`, and the OHLCV half of this same box
      // already prints the last bar off-cursor, so a blank indicator row
      // disagreed with the row directly above it.
      //
      // `legendChips` walks the INSTANCE list (not the bindings) so a hidden
      // instance still gets a chip to un-hide from, and takes its value from
      // `binding.lastValue`, the binder's own record of the final point it set.
      // Wrapped inside `latestChips` because a disposed binder throwing here
      // would take the legend down; EMPTY_CHIPS is the honest fallback, and it
      // is still the frozen shared one when there is nothing to print.
      overlays, chips: latestChips(), compare: null,
    }
  }
  const crosshairSubRef = useRef(null)
  const crosshairRafRef = useRef(null)
  const crosshairParamRef = useRef(null)
  // True while we're applying an externally-synced crosshair, so the resulting
  // (point-less) crosshair event doesn't echo a clear back to the sync bus.
  const applyingExternalRef = useRef(false)
  // Same pattern as applyingExternalRef, but for the time-range sync bus
  // (Task 3 of Groups phase 3): true while WE are applying an externally-synced
  // visible range, so the resulting subscribeVisibleTimeRangeChange event
  // doesn't echo a re-broadcast back to the bus. lastAppliedRangeRef feeds the
  // epsilon gate (shouldApplyRange) so near-identical ranges from a chart with
  // different bar spacing don't cause the bus to oscillate forever.
  const applyingExternalRangeRef = useRef(false)
  const lastAppliedRangeRef = useRef(null)
  // Refs mirror rapidly-changing values so the crosshair handler can read
  // current data without forcing a tear-down+resubscribe on every tick.
  // Without this, useRealtimeBars updates → bars change → indicatorData
  // re-memoizes → crosshair useEffect re-runs → unsubscribe/subscribe cycle
  // happens on every live tick, causing visible crosshair stutter.
  // Refs initialize to null — the dedicated mirror useEffect below populates
  // them on the first commit, BEFORE the user can hover the chart. Cannot
  // initialize them to the actual values here because most are declared
  // (useMemo) later in the function body — using them at this point would
  // hit a TDZ ReferenceError.
  const overlayDataRef = useRef(null)
  // ⛔ `indicatorDataRef` STOOD HERE AND WENT WITH THE MEMO IT MIRRORED (B5
  // Task 8). The crosshair read it for the nine indicator chips; those became
  // `crosshairData.chips`, built by handing the engine's BINDINGS to
  // `readout.engineChips`, at B4 Task 10. A ref mirroring a value that no
  // longer exists is a null nothing reads.
  const comparisonDataRef = useRef(null)
  const livePricesRef = useRef(null)
  const resolvedTfRef = useRef(null)   // current tf, for the imperative daily-candle fast writer (writer E)
  const resolvedOverlaysRef = useRef(null)
  const symRef = useRef(null)
  const onCrosshairMoveRef = useRef(null)
  // The instance list the engine last drew, for the crosshair handler — which
  // reads refs, not props, so the subscription survives a live tick without a
  // tear-down/resubscribe (see the block comment above `overlayDataRef`).
  // It is written inside `updateChart`, where `engineInstances` is a local, and
  // NOT in the mirror effect below: the mirror can only copy component-scope
  // values, and reading `cs.indicatorInstances` here instead would give the
  // legend the RAW blob — including the records `normalizeInstances` dropped and
  // the definitions the engine is not allowed to draw.
  const engineInstancesRef = useRef(EMPTY_INSTANCES)
  // ── ⛔ THE LEGACY LANE'S CHIP ENTRIES ARE GONE (B5 Task 6) ──────────────────
  //
  // `legacyChipEntriesRef`, `registerLegacyChip`, `csIndicatorsRef` and the
  // module-scope `LEGACY_CHIP_ORDER` stood here. B4 Task 10 built them because
  // six of the nine shipped chips belonged to definitions that were NOT migrated
  // and had no bindings, so rendering `engineChips()` alone would have deleted
  // those six chips for every user, invisibly — a headless capture has no cursor.
  //
  // Task 5 moved three of the six onto the engine and Task 6 moved the last three
  // (`sar::sar`, `ichimoku::tenkan`, `ichimoku::kijun`). With zero registrations
  // left the map, the registrar, the inputs ref and the order constant have no
  // callers, and dead code that used to be a mechanism reads as a mechanism — so
  // they are DELETED rather than left empty. All nine chips now come out of
  // `engineChips`, off the same `plots[].legend` blocks, character for character.
  //
  // ⚠️ `readout.chipsFrom` KEEPS its second-source shape and its `inputsFor`
  // parameter. It is not vestigial: `engineChips` is one caller of it, and the
  // reason it was extracted — a second lane with its own series source and its
  // own inputs — is exactly what Phase C's server lane needs.

  const [activeTool, setActiveTool] = useState(null)
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const [positionTool, setPositionTool] = useState({ entry: '', stop: '', target: '', risk: 200, direction: 'long' })
  const positionPriceLines = useRef([])
  const [drawColor, setDrawColor] = useState(canvasTheme === 'sunrise' ? '#000000' : cs.drawingDefaults.color)
  // Sunrise defaults the drawing color to black (reads on the bright canvas); other
  // themes use the user's configured default. A manual palette pick persists until the
  // theme (or the saved default) changes.
  useEffect(() => {
    setDrawColor(canvasTheme === 'sunrise' ? '#000000' : cs.drawingDefaults.color)
  }, [canvasTheme, cs.drawingDefaults.color])
  const [drawWidth, setDrawWidth] = useState(cs.drawingDefaults.width)
  const [magnet, setMagnet] = useState(false)  // snap drawings to nearest O/H/L/C
  const [selectedId, setSelectedId] = useState(null)
  const [repeatMode, setRepeatMode] = useState(() => {
    // Default OFF: after placing a drawing the tool reverts to no-tool, so you can
    // immediately hover-and-drag annotations without clicking the cursor button.
    // Users who explicitly enabled repeat (localStorage 'true') keep it.
    try { return localStorage.getItem('uct-draw-repeat') === 'true' } catch { return false }
  })
  const handleSetRepeatMode = useCallback((val) => {
    setRepeatMode(val)
    try { localStorage.setItem('uct-draw-repeat', val ? 'true' : 'false') } catch {}
  }, [])
  const handleUpdateChartSettings = useCallback((newSettings) => {
    // Isolated-persist path (Chart widget extra tabs): route the whole new blob
    // to the owner instead of the global pref, so a tab's edits stay on that tab.
    // `newSettings` is already the fully-merged settings ({...cs, ...change}), so
    // it's exactly what the tab should store — no override-restore dance needed
    // (the tab IS the authoritative blob, not a partial over global).
    if (onSettingsPersist) { onSettingsPersist(newSettings); return }
    // Every settings write site spreads {...cs}, which carries any per-instance
    // settingsOverride — restore overridden top-level keys from the
    // un-overridden base so an override never leaks into the GLOBAL blob.
    // Restore ONLY keys the write carried through unchanged (Object.is vs cs):
    // a key the user deliberately edited differs from cs and must persist —
    // blanket-restoring would silently drop their global edit. Section-object
    // overrides would need sub-key diffing here; today's only override is the
    // primitive per-cell chartType. (The watermark-drag commit builds from
    // mergeChartSettings(prefs) directly and cannot leak — keep it that way.)
    let persisted = newSettings
    if (settingsOverride) {
      persisted = { ...newSettings }
      for (const k of Object.keys(settingsOverride)) {
        if (k in csBase && Object.is(newSettings[k], cs[k])) persisted[k] = csBase[k]
      }
    }
    setPref('chart_settings', JSON.stringify(persisted))
  }, [setPref, settingsOverride, csBase, cs, onSettingsPersist])

  // ═══ chart-UX-walls TASK 4 — EVERY CHIP ACTION, THROUGH ONE WRITER ════════
  //
  // ⭐ ONE WRITER. Every chip action routes at `instanceControls` — the same
  // module the right-click doors, the four keyboard chords, the generated
  // settings rows, the library dialog and the voice bus already share. A REFUSED
  // write returns the settings object BY IDENTITY (a dead instance id, an illegal
  // value), so the guard below is `!==` and nothing persists.
  //
  // ⛔ THE IDENTITY GUARD IS NOT AN OPTIMISATION. `handleUpdateChartSettings`
  // WRITES THE GLOBAL PREF. Persisting `cs` back over itself on a refused write
  // would stamp `preset: 'custom'` on a user who never successfully changed
  // anything — and on a grid cell it would flush the whole blob through
  // `onSettingsPersist` for a no-op.
  const writeInstance = useCallback((next) => {
    if (next !== cs) handleUpdateChartSettings({ ...next, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])

  const handleChipHidden = useCallback((instanceId) => {
    const inst = findInstance(cs, instanceId)
    if (!inst) return
    writeInstance(setInstanceHidden(cs, instanceId, !inst.hidden, engineRegistry))
  }, [cs, writeInstance])

  // ⛔ `removeInstance`, NOT `setIndicatorEnabled(defId, false)`. The second one
  // TOMBSTONES EVERY LIVE INSTANCE OF THE DEFINITION (`instanceControls:225`), so
  // × on one of two RSIs would delete both — silently, and identically to the
  // correct behaviour while only one exists. See the report: that substitution
  // SURVIVES today's tests and its kill belongs to the task that ships a second
  // instance.
  const handleChipRemove = useCallback((instanceId) => {
    writeInstance(removeInstance(cs, instanceId, engineRegistry))
  }, [cs, writeInstance])

  // ⭐ chart-UX-walls TASK 6 — DUPLICATE. The first caller `addInstance` has ever
  // had, and the reason `handleChipRemove` above can finally be told apart from
  // `setIndicatorEnabled(defId, false)`: until a user could produce two instances
  // of one definition, the two were byte-identical.
  //
  // ⛔ THE DEF ID IS RESOLVED FROM THE INSTANCE, NOT TAKEN FROM THE CHIP. The chip
  // carries a `defId` and it would work today, but the instance is what has to
  // still EXIST for a duplicate to mean anything: `findInstance` refuses a dead or
  // tombstoned id, and without it a stale menu (a chip whose × another surface
  // already fired) would silently mint a fresh RSI the user never asked for.
  const handleChipDuplicate = useCallback((instanceId) => {
    const inst = findInstance(cs, instanceId)
    if (!inst) return
    writeInstance(addInstance(cs, inst.defId, engineRegistry))
  }, [cs, writeInstance])

  // ⛔ NO RAW `{...cs, indicatorInstances}` HERE. `withInstances` is the writer's
  // own list-setter: it re-sorts by definition stack order and stamps
  // `preset: 'custom'`, and a hand-spread list would silently drop the sort — the
  // panes and the legend read that ONE list and would stop agreeing.
  //
  // ⛔ AND IT REFUSES BY IDENTITY, exactly like every other door: a dead instance
  // id, or a target this instance cannot resolve, returns `cs` and persists
  // nothing. `chipMenu.moveTargetRefusal` is what stops such a row being offered
  // at all; this is the belt behind it.
  const handleChipMove = useCallback((instanceId, target) => {
    const inst = findInstance(cs, instanceId)
    if (!inst) return
    if ((inst.placement && inst.placement.target) === target) return
    const list = (cs.indicatorInstances || []).map(i => (
      i && i.instanceId === instanceId
        ? { ...i, placement: { ...(i.placement || {}), target } }
        : i))
    writeInstance(withInstances(cs, list, engineRegistry))
  }, [cs, writeInstance])

  // Toolbar EXT/RTH button — flips the same "Extended hours" setting the settings
  // panel toggles, so both stay in lockstep (one logical state, two entry points).
  const handleToggleExtended = useCallback((val) => {
    handleUpdateChartSettings({ ...cs, extendedHoursShading: val, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])

  // ── Region-aware right-click menu: build settings sections per region ──
  // Imperative handle to ChartToolbar so a menu item can open its settings
  // panel. Refs are stable, so the builder below can stay pure-ish.
  const toolbarRef = useRef(null)
  // addDrawing is created later (useChartDrawings, below); bridge via ref so a
  // menu item can draw a horizontal line at the clicked price.
  const addDrawingRef = useRef(null)

  // ⭐ chart-UX-walls TASK 4 — "Add alert on <label>…", from the chip AND from the
  // right-click region menu, through the SAME popover the 🔔 button opens.
  //
  // ⛔ ONE POPOVER, NOT A SECOND MOUNT. `ChartToolbar` owns `IndicatorAlertPopover`
  // (it is the surface that knows the symbol and the read-only gate), so this is
  // an imperative call onto the existing one, exactly like `openIndicatorLibrary`
  // and `openSettings` above. A second mount would be a second alert form that
  // could disagree with the first about which chart's instances it is offering.
  //
  // It returns FALSE when there is no toolbar or no symbol, and the caller turns
  // that into a DISABLED row rather than a live one that opens nothing.
  const chipAlertsRefusal = showDrawingTools && sym
    ? undefined
    : 'this chart has no alert form (read-only mount)'
  const handleChipAlerts = useCallback((instanceId, plotKey) => {
    try { toolbarRef.current?.openAlerts({ instanceId, plotKey }) } catch { /* noop */ }
  }, [])

  const handleChipMenu = useCallback((chip, anchor) => {
    setChipPage(null)
    setChipAbout(null)
    setChipMenu({ chip, anchor })
  }, [])

  /** The chip's four handlers, or NULL on a read-only mount.
   *
   * ⛔ THE SAME GATE THE REGION MENU'S `<label> settings…` ROW USES, and for the
   * same reason it gives: a mount with no drawing tools (Model Book, a grid cell,
   * the `/r/chart` export route) renders no toolbar and is not the surface a user
   * edits their chart on. `IndicatorChip` renders NO control at all when it gets
   * no handlers, so those surfaces keep exactly the inert chip Task 3 shipped —
   * and the export route keeps a legend with no buttons in it. */
  const chipHandlers = useMemo(() => (showDrawingTools ? {
    onToggleHidden: handleChipHidden,
    onOpenSettings: setSettingsInstanceId,
    onRemove: handleChipRemove,
    onMenu: handleChipMenu,
  } : null), [showDrawingTools, handleChipHidden, handleChipRemove, handleChipMenu])
  const buildRegionSections = useCallback((region, clickPrice) => {
    const setCs = (path, value) => {
      const next = { ...cs }
      const parts = path.split('.')
      if (parts.length === 3) {
        const [a, b, c] = parts
        next[a] = { ...next[a], [b]: { ...next[a][b], [c]: value } }
      } else if (parts.length === 2) {
        const [a, b] = parts
        next[a] = { ...next[a], [b]: value }
      } else {
        next[path] = value
      }
      next.preset = 'custom'
      handleUpdateChartSettings(next)
    }
    // Charts workspace passes onOpenSettings → route the "Chart settings" menu item
    // to the new centered modal; other surfaces fall back to the old toolbar panel.
    const openSettings = () => {
      if (onOpenSettings) { try { onOpenSettings() } catch {} return }
      try { toolbarRef.current?.openSettings() } catch {}
    }
    // Reset view: reframe to the timeframe's default window (Daily on the workspace
    // = dailyDefaultBars ≈ 6 months), newest candle anchored at LAST_CANDLE_POS —
    // NOT LWC's resetTimeScale() (which fit-all-ed to ~1 year). Falls back to
    // resetTimeScale when there aren't enough bars to frame.
    const resetView = () => {
      try {
        // VERTICAL first: clear any manual price-scale drag / locked placement and
        // re-enable auto-scale so the candles are always re-framed. Dragging the price
        // axis pins a fixed price range that the horizontal reframe alone can't undo —
        // that's the "reset does nothing / candles gone off-screen" bug.
        vertMarginsRef.current = null
        focusPriceRangeRef.current = null
        try {
          mainPriceScale()?.applyOptions({
            autoScale: true,
            scaleMargins: _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
          })
        } catch {}
        // HORIZONTAL: reframe to the timeframe default.
        const ts = chartRef.current?.timeScale(); if (!ts) return
        const len = lastBarCountRef.current || 0
        if (len > 1) {
          const { from, to } = computeDefaultLogicalRange(len, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride, plotWidthPx: plotWidthOf(chartRef.current, containerRef.current) })
          ts.setVisibleLogicalRange({ from, to })
        } else {
          ts.resetTimeScale()
        }
        // Explicit reset — the view is back at the canonical window, so the
        // "user moved the view" latch is cleared and the pinned-right safety
        // net is live again (see userViewMovedRef). Also release the replay view
        // lock so the next replay ticker returns to the default replay frame.
        userViewMovedRef.current = false
        replayViewLockedRef.current = false; replayLockedViewRef.current = null
      } catch {}
    }
    const autoScale = () => {
      try {
        // Clear any locked vertical placement and restore the default candle band.
        vertMarginsRef.current = null
        mainPriceScale()?.applyOptions({
          autoScale: true,
          scaleMargins: _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
        })
      } catch {}
    }
    const settingsLink = (id, label) =>
      showDrawingTools ? [{ id, label, onSelect: openSettings }] : []
    // ⭐ THE THIRD ENTRY POINT ONTO THE LIBRARY (spec §6: *labelled toolbar
    // button · right-click → "Add indicator…" · one chord*). It is a USE of the
    // launcher, not a door: it writes nothing itself, so there is no
    // `cs.indicators` write here to get wrong. Every add it leads to goes through
    // the dialog, i.e. through `setIndicatorEnabled`.
    //
    // ORDER IS THE SAME CONTRACT `Alt+Shift+A` carries, and it is the same call:
    // ask the library first, fall through to the settings surface ONLY on a
    // non-`true` answer. `openIndicatorLibrary` returns `false` on a read-only
    // mount (it checks the same `chartSettings && onUpdateSettings` pair the
    // toolbar's own button does), and `toolbarRef.current` is null when the
    // toolbar was never mounted — the two ways the door can be absent, both
    // landing on the fallback rather than on nothing.
    const openIndicatorLibrary = () => {
      let opened = false
      try { opened = toolbarRef.current?.openIndicatorLibrary() === true } catch { /* noop */ }
      if (!opened) openSettings()
    }
    // ⛔ AND ITS PRESENCE IS THE READ-ONLY GATE, exactly as `settingsLink`'s is.
    // A mount with no drawing tools (Model Book, a grid cell) renders no toolbar,
    // so there is no library and no settings panel to reach — offering the item
    // there would be a menu row that does nothing, which is the defect class this
    // phase is retiring, not a smaller version of it.
    const addIndicatorItem = showDrawingTools ? {
      id: 'ind-add',
      label: <><UIcon name="plus" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Add indicator…</>,
      onSelect: openIndicatorLibrary,
    } : null

    // Price-level + picker helpers (used by the price area / axis regions).
    const hasPrice = Number.isFinite(clickPrice)
    const fmtPrice = (p) => (p >= 1 ? p.toFixed(2) : p.toFixed(4))
    const drawLineItem = hasPrice ? {
      id: 'draw-hline',
      label: <><UIcon name="ruler" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{`Draw line at $${fmtPrice(clickPrice)}`}</>,
      onSelect: () => { try { addDrawingRef.current?.({ type: 'horizontal', points: [{ price: clickPrice }], color: canvasTheme === 'sunrise' ? '#000000' : (cs.drawingDefaults?.color || '#c9a84c'), lineWidth: cs.drawingDefaults?.width || 1 }) } catch {} },
    } : null
    const copyPriceItem = hasPrice ? {
      id: 'copy-price',
      label: <><UIcon name="copy" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{`Copy $${fmtPrice(clickPrice)}`}</>,
      onSelect: () => { try { navigator.clipboard?.writeText(fmtPrice(clickPrice)) } catch {} },
    } : null
    const priceActions = hasPrice
      ? [{ id: 'priceactions', title: `At $${fmtPrice(clickPrice)}`, items: [drawLineItem, copyPriceItem] }]
      : []
    const TF_OPTS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M']]
    const CT_OPTS = [['candles', 'Candles'], ['hollow', 'Hollow'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area']]
    const tfSection = typeof onTfChange === 'function' ? {
      id: 'tf', title: 'Timeframe',
      items: TF_OPTS.map(([code, label]) => ({ id: 'tf-' + code, label, kind: 'toggle', checked: resolvedTf === code, onSelect: () => onTfChange(code) })),
    } : null
    const ctSection = {
      id: 'ctype', title: 'Chart type',
      items: CT_OPTS.map(([val, label]) => ({ id: 'ct-' + val, label, kind: 'toggle', checked: (cs.chartType || 'candles') === val, onSelect: () => setCs('chartType', val) })),
    }
    // ── FLIP B: THE THIRD AND FOURTH DOORS ONTO THE SAME SWITCH ──────────────
    //
    // The right-click **Indicators ▸** submenu and **Hide <label>** both wrote
    // `cs.indicators.<key>.enabled` directly. For a FLIPPED id that is the MIRROR,
    // not the switch — so the menu would tick a box the chart disagreed with, and
    // "Hide RSI" would clear the mirror while the instance kept drawing. One
    // reader (`indEnabled`) and one writer (`setIndEnabled`) for every door.
    const indEnabled = (key) => isIndicatorEnabled(cs, key, ENGINE_OWNED)
    const setIndEnabled = (key, on) => {
      if (ENGINE_OWNED.has(key)) {
        const next = setIndicatorEnabled(cs, key, on, engineRegistry)
        if (next !== cs) handleUpdateChartSettings(next)
        return
      }
      setCs(`indicators.${key}.enabled`, on)
    }
    // Every settings section, labelled once, in registry order. Adding a
    // definition adds a menu entry; there is no second place to edit. The
    // hand-written eight this replaced offered rsi/macd/bb/vwap/stoch/atr/obv/adx
    // — `sar`, `ichimoku`, `mfi`, `cci`, `williamsR`, `donchian` and
    // `volumeProfile` each had a settings section AND a toolbar row and no way
    // into the menu a user actually right-clicks. 8 -> 15 is the measured cost
    // of the hand-written list, not a refactor artefact.
    const indicatorsItem = {
      id: 'indicators', label: <><UIcon name="breadth" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Indicators</>, kind: 'submenu',
      submenu: catalogRows().map((row) => ({
        id: 'ind-' + row.id, label: row.shortName, kind: 'toggle', checked: indEnabled(row.id),
        onSelect: () => setIndEnabled(row.id, !indEnabled(row.id)),
      })),
    }
    // "Overlay on volume": a PANE oscillator that is currently ON. `placement.target`
    // is what `resolvePlacement` reads, so the menu and the renderer agree by
    // construction — a price overlay (bb/vwap/sar/ichimoku/donchian) shares the
    // candles' scale and can never be moved here.
    const volOverlayCur = Array.isArray(cs.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : []
    // …through the same reader, so a flipped oscillator the user deleted cannot
    // still offer "overlay it on the volume pane".
    const enabledOsc = oscillatorIds().filter((key) => indEnabled(key))
    const volumeOverlayItem = (showVolumeProp === undefined && cs.volume?.visible && enabledOsc.length) ? {
      id: 'voloverlay', label: <><UIcon name="link" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Overlay on volume</>, kind: 'submenu',
      submenu: enabledOsc.map((key) => ({
        id: 'vo-' + key, label: labelFor(key), kind: 'toggle', checked: volOverlayCur.includes(key),
        onSelect: () => setCs('volumeOverlayIndicators', volOverlayCur.includes(key)
          ? volOverlayCur.filter((k) => k !== key)
          : [...volOverlayCur, key]),
      })),
    } : null

    const secs = []

    if (region.type === 'volume') {
      const items = []
      if (showVolumeProp === undefined) {
        items.push({ id: 'v-show', label: 'Show volume', kind: 'toggle', checked: !!cs.volume.visible, onSelect: () => setCs('volume.visible', !cs.volume.visible) })
      }
      items.push({ id: 'v-sep', label: 'Separate pane', kind: 'toggle', checked: !!cs.volume.separatePane, onSelect: () => setCs('volume.separatePane', !cs.volume.separatePane) })
      items.push({ id: 'v-hvc', label: 'HVC highlight', kind: 'toggle', checked: !!cs.volume.hvcEnabled, onSelect: () => setCs('volume.hvcEnabled', !cs.volume.hvcEnabled) })
      if (volumeOverlayItem) items.push(volumeOverlayItem)
      items.push(...settingsLink('v-set', 'Volume settings…'))
      secs.push({ id: 'region', title: 'Volume', items })
    } else if (region.type === 'indicator') {
      const key = region.key
      // The region title and its `Hide <label>` take the SAME short name the
      // Indicators submenu, the toolbar strip and the legend take. One label,
      // four surfaces, one source.
      const label = labelFor(key)
      // ⭐ "<label> settings…" NOW OPENS THE PER-INSTANCE DIALOG, not the global
      // five-tab modal. A menu row that named ONE indicator and opened a
      // chart-wide surface (Price Style / Canvas / Indicators / Header / Markers)
      // was the third of spec §6's missing containers.
      //
      // ⛔ THE READ-ONLY GATE IS UNCHANGED — it is `settingsLink`'s, reused: a
      // mount with no drawing tools (Model Book, a grid cell) renders no toolbar
      // and persists nothing, so it gets no settings row at all rather than one
      // that writes nowhere. And with no LIVE instance to scope to (a definition
      // drawing only through the legacy projection) the row falls back to the
      // global surface rather than opening a dialog on nothing.
      const instId = firstLiveInstanceId(cs, key)
      const settingsRow = (showDrawingTools && instId)
        ? [{ id: 'i-set', label: `${label} settings…`, onSelect: () => setSettingsInstanceId(instId) }]
        : settingsLink('i-set', `${label} settings…`)
      // ⭐ chart-UX-walls TASK 4 — the region menu's own alert door, beside
      // `Hide <label>` and `<label> settings…`. It opens the SAME popover the 🔔
      // button and the chip's Alerts row open (`toolbarRef.openAlerts`), scoped to
      // the same live instance the settings row resolved — so right-clicking the
      // RSI pane offers an RSI alert rather than whatever the catalog lists first.
      //
      // ⛔ SAME READ-ONLY GATE AS THE ROW ABOVE IT, and for the same reason: with
      // no toolbar there is no popover, and a row that opens nothing is the defect
      // class this phase retires rather than a smaller version of it.
      const alertRow = (showDrawingTools && instId)
        ? [{
            id: 'i-alert',
            label: `Add alert on ${label}…`,
            onSelect: () => { try { toolbarRef.current?.openAlerts({ instanceId: instId }) } catch { /* noop */ } },
          }]
        : []
      secs.push({ id: 'region', title: label, items: [
        { id: 'i-hide', label: `Hide ${label}`, kind: 'toggle', checked: true, onSelect: () => setIndEnabled(key, false) },
        ...settingsRow,
        ...alertRow,
      ] })
    } else if (region.type === 'overlay') {
      const ov = resolvedOverlays?.[region.index]
      const label = ov ? `${ov.type} ${ov.period}` : 'Moving average'
      const csIndex = ov ? cs.overlays.indexOf(ov) : -1
      const items = []
      if (csIndex >= 0) {
        items.push({ id: 'o-hide', label: `Hide ${label}`, kind: 'toggle', checked: true, onSelect: () => {
          const next = { ...cs, overlays: cs.overlays.map((o, i) => i === csIndex ? { ...o, enabled: false } : o), preset: 'custom' }
          handleUpdateChartSettings(next)
        } })
      }
      items.push(...settingsLink('o-set', 'Moving averages…'))
      secs.push({ id: 'region', title: label, items })
    } else if (region.type === 'priceAxis') {
      secs.push(...priceActions)
      secs.push({ id: 'region', title: 'Price scale', items: [
        { id: 'p-log', label: 'Logarithmic scale', kind: 'toggle', checked: !!cs.logScale, onSelect: () => setCs('logScale', !cs.logScale) },
        { id: 'p-auto', label: 'Auto-scale', onSelect: autoScale },
      ] })
    } else if (region.type === 'timeAxis') {
      // Reset view comes from the common section below; nothing region-specific.
    } else {
      // Open price area.
      secs.push(...priceActions)
      const items = [
        { id: 'pr-log', label: 'Logarithmic scale', kind: 'toggle', checked: !!cs.logScale, onSelect: () => setCs('logScale', !cs.logScale) },
        { id: 'pr-magnet', label: 'Magnet crosshair', kind: 'toggle', checked: !!cs.crosshair?.magnet, onSelect: () => setCs('crosshair.magnet', !cs.crosshair?.magnet) },
      ]
      if (['1', '5', '15', '30', '60'].includes(resolvedTf)) {
        items.push({ id: 'pr-eh', label: 'Extended hours', kind: 'toggle', checked: !!cs.extendedHoursShading, onSelect: () => setCs('extendedHoursShading', !cs.extendedHoursShading) })
      }
      items.push({ id: 'pr-swing', label: 'Swing price labels', kind: 'toggle', checked: !!cs.swingLabels?.enabled, onSelect: () => setCs('swingLabels.enabled', !cs.swingLabels?.enabled) })
      if (showVolumeProp === undefined && !cs.volume.visible) {
        items.push({ id: 'pr-vol', label: 'Show volume', kind: 'toggle', checked: false, onSelect: () => setCs('volume.visible', true) })
      }
      items.push(indicatorsItem)
      if (addIndicatorItem) items.push(addIndicatorItem)
      if (volumeOverlayItem) items.push(volumeOverlayItem)
      secs.push({ id: 'region', title: 'Chart', items })
      if (tfSection) secs.push(tfSection)
      secs.push(ctSection)
    }

    // Common view section — always present.
    const viewItems = [{ id: 'reset', label: 'Reset view', onSelect: resetView }]
    if (showDrawingTools) {
      viewItems.push({ id: 'hide-draw', label: 'Hide drawings', kind: 'toggle', checked: !!cs.hideDrawings, onSelect: () => setCs('hideDrawings', !cs.hideDrawings) })
    }
    viewItems.push(...settingsLink('chart-set', 'Chart settings…'))
    secs.push({ id: 'view', items: viewItems })

    return secs
  }, [cs, handleUpdateChartSettings, showDrawingTools, showVolumeProp, resolvedOverlays, resolvedTf, onTfChange, onOpenSettings])

  // ── Pattern overlay state (Phase 5 Tasks 1, 3, 4) ──
  // Toggle persists via chart_settings (usePreferences). Local UI state mirrors
  // the persisted flag so toggle feels instant; handleTogglePatterns writes through.
  const persistedShowPatterns = !!cs.showPatterns
  const [showPatterns, setShowPatterns] = useState(persistedShowPatterns)
  useEffect(() => { setShowPatterns(persistedShowPatterns) }, [persistedShowPatterns])
  const handleTogglePatterns = useCallback((next) => {
    setShowPatterns(next)
    handleUpdateChartSettings({ ...cs, showPatterns: next, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])
  const [activeDetection, setActiveDetection] = useState(null)
  const { detections: patternDetections } = usePatternDetections(sym, resolvedTf, showPatterns && !disablePatterns, 50)

  // ── Screenshot + Share state ──
  const [screenshotPopoverOpen, setScreenshotPopoverOpen] = useState(false)
  const lastPriceRef = useRef(null)
  const lastChangePctRef = useRef(null)
  // Last (and prior) REGULAR-session close, for the PNG export header — so a downloaded
  // chart shows the RTH close (e.g. Friday's 226.73) rather than the live after-hours price.
  const rthCloseRef = useRef(null)
  const rthPrevCloseRef = useRef(null)

  // Assemble the branded-screenshot options: header data + the container (so the
  // compositor can grab the drawing/callout overlay canvases) + the live legend
  // element positions so the OHLC/MA + $Vol legends get redrawn into the PNG.
  const buildScreenshotOpts = useCallback(() => {
    const cont = containerRef.current
    const contRect = cont?.getBoundingClientRect()
    const relPos = (el) => {
      if (!el || !contRect) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - contRect.left, y: r.top - contRect.top }
    }
    // Swing labels are a top-zOrder LWC primitive that takeScreenshot() doesn't
    // capture, so pre-compute their pixel positions here and let the compositor
    // redraw them (mirrors swingLabelsPrimitive).
    const ts = chartRef.current?.timeScale?.()
    const series = candleSeriesRef.current
    const sl = cs.swingLabels || {}
    const swingLabels = (ts && series ? (swingPointsRef.current || []) : []).map((p) => {
      const x = ts.timeToCoordinate(p.time)
      const y = series.priceToCoordinate?.(p.price)
      return (x != null && y != null) ? { x, y, label: Number(p.price).toFixed(2), type: p.type } : null
    }).filter(Boolean)
    // Effective chart background so the header/footer blend with the canvas.
    const bgColor = canvasTheme === 'sunrise'
      ? '#eaf1fa'
      : (userCanvas && cs.bgMode === 'gradient')
        ? (cs.bgGradient?.top || MB_BG)
        : ((userCanvas || !boldCandles) ? (cs.background || MB_BG) : MB_BG)
    // Header price = the last REGULAR-session close (RTH), not the live/after-hours price —
    // "current intraday price OR close of the last regular session". On D/W/M the change %
    // is recomputed against the prior regular close so it stays consistent with that price;
    // intraday keeps the existing daily change.
    let _price = lastPriceRef.current
    let _changePct = lastChangePctRef.current
    if (Number.isFinite(rthCloseRef.current)) {
      _price = rthCloseRef.current
      if (DWM.includes(resolvedTf) && Number.isFinite(rthPrevCloseRef.current) && rthPrevCloseRef.current) {
        _changePct = ((rthCloseRef.current - rthPrevCloseRef.current) / rthPrevCloseRef.current) * 100
      }
    }
    // The change-% follows the user's candle up/down colors (Model Book / bold look use
    // their fixed palette; otherwise the chosen candle colors).
    const _upColor = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor
    const _downColor = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor
    return {
      sym, tf: resolvedTf, price: _price, changePct: _changePct,
      upColor: _upColor, downColor: _downColor,
      companyName: watermarkMeta?.name || tickerMeta?.name || null,
      container: cont,
      crosshairData,
      volPos: relPos(volLegendRef.current),
      bgColor,
      textColor: axisAuto.ink,   // canvas-contrast axis ink → header blends with it
      swingLabels,
      swingStyle: {
        color: sl.color, tintByType: sl.tintByType, upColor: sl.upColor, downColor: sl.downColor,
        // Mirror the live primitive EXACTLY (swingLabelsPrimitive setOptions):
        // showBg is keyed off `bgEnabled`, and the box color defaults to the chart
        // background — an invisible plate that hides candles behind the label,
        // NOT a visible box.
        showBg: sl.bgEnabled !== false,
        bg: sl.bg || bgColor,
        fontPx: sl.fontPx,
      },
    }
  }, [sym, resolvedTf, watermarkMeta, tickerMeta, crosshairData, cs, canvasTheme, userCanvas, boldCandles, modelBookLook, axisAuto])

  const handleDownload = useCallback(async () => {
    if (!chartRef.current) return
    try {
      const blob = await composeScreenshot(chartRef.current, buildScreenshotOpts())
      const filename = `${sym || 'chart'}-${resolvedTf}-${new Date().toISOString().slice(0, 10)}.png`
      downloadBlob(blob, filename)
    } catch (err) {
      console.warn('Screenshot failed:', err)
    }
  }, [sym, resolvedTf, buildScreenshotOpts])

  const handleCopyImage = useCallback(async () => {
    if (!chartRef.current) return false
    try {
      const blob = await composeScreenshot(chartRef.current, buildScreenshotOpts())
      return await copyBlobToClipboard(blob)
    } catch (err) {
      console.warn('Copy failed:', err)
      return false
    }
  }, [buildScreenshotOpts])

  // ── ENUMERATION SITE #20 — RETIRED AT B4 TASK 5, AND WHY IN TWO STEPS ──────
  //
  // ⚠️ THE TWO HALVES LANDED A PHASE APART, so the tense matters: B3 added the
  // engine keys, B4 Task 5 ended the hand-list. Until B3 this carried NEITHER
  // `indicatorInstances` NOR `engineEnabled`; until B4 it still enumerated
  // exactly the four pilots, and "Copy chart link" silently dropped everything
  // else — a link shared from a chart with Stochastic and ATR on arrived with
  // neither. It now enumerates NOTHING: see the comment on `indicators:` below.
  //
  // The instance/flag half, which is B3's and still load-bearing:
  // At Flip A a hand-list was merely incomplete —
  // `cs.indicators.<id>.enabled` was still the authority, so a shared link
  // reproduced the chart. **At Flip B `enabled` stops being the authority**: the
  // sender's RSI may exist only as an instance (a tombstone can even make a
  // still-true toggle mean "off"), so "Copy chart link" would have silently
  // dropped RSI and Bollinger Bands from every shared chart — and the recipient's
  // own tombstone would have swallowed the toggle the link did carry.
  //
  // Both halves are carried now: the ENABLED bits go through the one reader every
  // other door uses, and the instances travel verbatim so the recipient's blob is
  // overwritten rather than merged-around.
  //
  // ⚠️ A THIRD KEY USED TO RIDE ALONG AND NO LONGER DOES: `engineEnabled`, "because
  // a recipient on a flag-off blob must still be able to draw a MIGRATED-but-not-
  // flipped indicator the sender had on". B5 Task 4 deleted the flag; that category
  // has been empty since Flip B and B5 may not re-create it.
  const handleCopyShareUrl = useCallback(() => {
    const state = {
      sym,
      tf: resolvedTf,
      chartType: cs.chartType,
      heikinAshi: cs.heikinAshi,
      logScale: cs.logScale,
      // Every settings section, answered through the ONE reader (B4 Task 5).
      // Hand-listing the four B3 pilots meant a link shared from a chart with
      // Stochastic or ATR on arrived with them OFF and nothing said so — the
      // recipient's chart simply drew neither. `catalogRows()` is
      // `definitions ∪ CARVED_OUT_INDICATOR_KEYS`, so `volumeProfile` (a canvas
      // overlay with no definition) travels too.
      //
      // ⚠️ `isIndicatorEnabled` rather than the raw `cs.indicators[id].enabled`,
      // and that is not defensive style: for a FLIPPED id the instance is the
      // authority, so a tombstoned RSI whose legacy mirror still says `true`
      // would otherwise come back ON on the recipient's chart.
      indicators: Object.fromEntries(catalogRows().map((row) => [
        row.id, { enabled: isIndicatorEnabled(cs, row.id, ENGINE_OWNED) },
      ])),
      // ⚠️ `engineEnabled: cs.engineEnabled === true` STOOD HERE (B5 Task 4).
      // It rode along "because a recipient on a flag-off blob must still be able
      // to draw a MIGRATED-but-not-flipped indicator the sender had on" — and that
      // category has been empty since Flip B and can never be created again (B5
      // migrates and flips together). The key it carried is deleted, so sending it
      // would put an unknown key in the link that `mergeChartSettings` destroys on
      // arrival.
      indicatorInstances: Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [],
      comparisonSymbols: cs.comparisonSymbols || [],
      markers: cs.markers || {},
    }
    const encoded = chartStateToUrl(state)
    const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`
    try {
      navigator.clipboard.writeText(url)
    } catch {}
  }, [sym, resolvedTf, cs])

  // ── Apply share-URL chart state on mount ──
  // Reads ?state=<encoded> once on mount. If absent, skips silently.
  // If parse fails, logs warning and skips. NEVER includes `cs` in deps —
  // would re-fire and overwrite user-driven changes.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const encoded = params.get('state')
      if (!encoded) return
      const decoded = urlToChartState(encoded)
      if (!decoded) return
      const next = {
        ...cs,
        ...(decoded.chartType ? { chartType: decoded.chartType } : {}),
        ...(typeof decoded.heikinAshi === 'boolean' ? { heikinAshi: decoded.heikinAshi } : {}),
        ...(typeof decoded.logScale === 'boolean' ? { logScale: decoded.logScale } : {}),
        ...(decoded.indicators ? { indicators: { ...cs.indicators, ...decoded.indicators } } : {}),
        // ⚠️ REPLACED, NOT MERGED. `mergeSettingsOverride`'s union-by-id is right
        // for a grid cell holding a partial blob; a share link is a complete
        // description of somebody else's chart, and unioning would leave the
        // RECIPIENT's tombstones in place — turning the sender's RSI back off on
        // arrival, which is the exact defect Flip B makes possible.
        ...(Array.isArray(decoded.indicatorInstances) ? { indicatorInstances: decoded.indicatorInstances } : {}),
        // ⚠️ AND THE FLAG IS NOT DECODED EITHER (B5 Task 4). An OLD link, minted
        // before this commit, still carries `engineEnabled` in its payload —
        // ignoring it here is the correct read, because the key no longer exists
        // and `mergeChartSettings` would drop it on the very next read anyway.
        // Copying it forward would put a key in the user's stored blob that
        // nothing declares and nothing removes until they next save.
        ...(decoded.comparisonSymbols ? { comparisonSymbols: decoded.comparisonSymbols } : {}),
        ...(decoded.markers ? { markers: { ...cs.markers, ...decoded.markers } } : {}),
        preset: 'custom',
      }
      handleUpdateChartSettings(next)
      if (decoded.sym && decoded.sym !== sym && typeof onSymbolChange === 'function') {
        onSymbolChange(decoded.sym)
      }
      if (decoded.tf && decoded.tf !== resolvedTf && typeof onTfChange === 'function') {
        onTfChange(decoded.tf)
      }
    } catch (err) {
      console.warn('Failed to apply share URL state:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { drawings, addDrawing, removeDrawing, updateDrawing, clearAll, reorderDrawing, undo, redo, snapshotHistory, canUndo, canRedo } = useChartDrawings(sym)
  addDrawingRef.current = addDrawing

  // "Set alert" from a line/trendline's right-click menu → create a server-side
  // watchlist alert (fires the bell/email/Discord like any price alert; appears in
  // the Alerts widget). A horizontal line = a fixed-price 'line' alert; a sloped
  // line = a 'trendline' alert carrying its two anchors (real unix-seconds + price)
  // so the checker can interpolate the line's level over time. A point placed past
  // the last candle (futureBars) is resolved to a real future time via the bar cadence.
  const handleSetDrawingAlert = useCallback(async (drawing, direction) => {
    if (!sym || !drawing) return
    const pts = drawing.points || []
    const kind = (drawing.type === 'horizontal' || drawing.type === 'hray') ? 'line' : 'trendline'
    const arr = drawBarsRef.current || []
    // Exact per-bar spacing for THIS timeframe (matches how the chart lays out its
    // uniform logical axis), so a point placed past the last candle resolves to a
    // real future time consistent with the visual line — not a fragile median.
    const barSec = PERIOD_SECONDS[resolvedTf] || (resolvedTf === 'W' ? 604800 : resolvedTf === 'M' ? 2592000 : 86400)
    // A drawing point's `time` is in the chart's DISPLAY epoch, NOT true UTC:
    //  • intraday = UTC-floored + _ET_OFFSET (fake-ET shift for the axis)
    //  • D/W/M    = a "YYYY-MM-DD" ET date STRING
    // The server-side checker compares against true-UTC time.time(), so we MUST
    // convert here or the trendline evaluates hours off (intraday) or not at all
    // (daily → Math.round(string) = NaN → alert never created).
    const toUtcSec = (t) => {
      if (typeof t === 'number' && Number.isFinite(t)) return t - _ET_OFFSET          // reverse the intraday ET shift
      if (typeof t === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 16, 0, 0) / 1000               // D/W/M date → ~noon ET (16:00 UTC)
      }
      return NaN
    }
    const anchorUtc = (p) => {
      const fb = Number.isFinite(p?.futureBars) ? p.futureBars : 0
      if (fb > 0 && arr.length) {
        const lastUtc = toUtcSec(arr[arr.length - 1].t)
        return Number.isFinite(lastUtc) ? lastUtc + fb * barSec : NaN
      }
      return toUtcSec(p?.time)
    }
    const body = { sym, direction, alert_type: kind }
    if (kind === 'line') {
      const price = pts[0]?.price
      if (!Number.isFinite(price)) return
      body.target_price = price
    } else {
      const a = pts[0], b = pts[1]
      if (!Number.isFinite(a?.price) || !Number.isFinite(b?.price)) return
      const t1 = anchorUtc(a), t2 = anchorUtc(b)
      if (!Number.isFinite(t1) || !Number.isFinite(t2)) return
      body.target_price = b.price   // display fallback (latest anchor); server falls back to it if t1==t2
      body.anchor_t1 = Math.round(t1); body.anchor_p1 = a.price
      body.anchor_t2 = Math.round(t2); body.anchor_p2 = b.price
    }
    try {
      const res = await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const created = res.ok ? await res.json().catch(() => null) : null
      // Instant: prepend into the Alerts widget's SWR cache, then revalidate every
      // watchlist-alerts cache so the new alert shows immediately (no 30s poll wait).
      if (created?.id) {
        globalMutate(
          '/api/watchlist-alerts?active_only=false',
          (cur) => (Array.isArray(cur) ? [created, ...cur] : cur),
          { revalidate: true },
        )
      }
      globalMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))
    } catch { /* non-fatal */ }
  }, [sym, resolvedTf])

  // ── Annotation CRUD (Model Book) — operate on the `annotations` prop and
  // bubble the new array to the parent via onAnnotationsChange (no localStorage).
  const annAdd = useCallback((d) => {
    const id = crypto.randomUUID()
    onAnnotationsChange?.([...(annotations || []), { ...d, id }])
    return id
  }, [annotations, onAnnotationsChange])
  const annUpdate = useCallback((id, updates) => {
    onAnnotationsChange?.((annotations || []).map(d => (d.id === id ? { ...d, ...updates } : d)))
  }, [annotations, onAnnotationsChange])
  const annRemove = useCallback((id) => {
    onAnnotationsChange?.((annotations || []).filter(d => d.id !== id))
  }, [annotations, onAnnotationsChange])
  const annClear = useCallback(() => { onAnnotationsChange?.([]) }, [onAnnotationsChange])
  // Setup Library text-annotation fade. No focus zoom runs here to drive textFadeRef,
  // so drive it directly off the Setup⇄Result toggle: snap on mount (text shows
  // immediately), ease over ~260ms on a later toggle (fade out on Result, back in on
  // Setup). Inert when annotationsTextVisible is null (Model Book keeps the zoom path).
  const annTextFadeRafRef = useRef(null)
  const annTextSeenRef = useRef(false)
  useEffect(() => {
    if (annotationsTextVisible == null) return
    const target = annotationsTextVisible ? 1 : 0
    if (!annTextSeenRef.current) { annTextSeenRef.current = true; textFadeRef.current = target; return }
    const from = textFadeRef.current ?? 0
    if (annTextFadeRafRef.current != null) cancelAnimationFrame(annTextFadeRafRef.current)
    if (from === target) { textFadeRef.current = target; return }
    const t0 = performance.now()
    const dur = 260
    const ease = x => -(Math.cos(Math.PI * x) - 1) / 2  // easeInOutSine
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      textFadeRef.current = from + (target - from) * ease(p)
      if (p < 1) annTextFadeRafRef.current = requestAnimationFrame(step)
      else { textFadeRef.current = target; annTextFadeRafRef.current = null }
    }
    annTextFadeRafRef.current = requestAnimationFrame(step)
    return () => { if (annTextFadeRafRef.current != null) { cancelAnimationFrame(annTextFadeRafRef.current); annTextFadeRafRef.current = null } }
  }, [annotationsTextVisible])
  // Index-pane annotation CRUD (GLOBAL ^IXIC measure marks) — mirrors annAdd/etc.
  // but bubbles through onIndexAnnotationsChange. Its own activeTool/selection so
  // it never fights the price-pane drawing state.
  const [indexActiveTool, setIndexActiveTool] = useState('advance')
  const [indexSelectedId, setIndexSelectedId] = useState(null)
  const idxAnnAdd = useCallback((d) => {
    const id = crypto.randomUUID()
    onIndexAnnotationsChange?.([...(indexAnnotations || []), { ...d, id }])
    return id
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnUpdate = useCallback((id, updates) => {
    onIndexAnnotationsChange?.((indexAnnotations || []).map(d => (d.id === id ? { ...d, ...updates } : d)))
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnRemove = useCallback((id) => {
    onIndexAnnotationsChange?.((indexAnnotations || []).filter(d => d.id !== id))
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnClear = useCallback(() => { onIndexAnnotationsChange?.([]) }, [onIndexAnnotationsChange])
  // Current line style for NEW annotation lines; also re-styles the selected line.
  const [drawLineStyle, setDrawLineStyle] = useState('solid')
  const setAnnLineStyle = useCallback((style) => {
    setDrawLineStyle(style)
    if (selectedId) annUpdate(selectedId, { lineStyle: style })
  }, [selectedId, annUpdate])
  // Text annotation font size — applies to new text and (if a text drawing is
  // selected) the selected one.
  const [drawFontSize, setDrawFontSize] = useState(13)
  const setAnnFontSize = useCallback((size) => {
    setDrawFontSize(size)
    if (selectedId) annUpdate(selectedId, { fontSize: size })
  }, [selectedId, annUpdate])

  // ── Position tool price lines ──
  useEffect(() => {
    const cs2 = candleSeriesRef.current
    if (!cs2) return
    for (const pl of positionPriceLines.current) {
      try { cs2.removePriceLine(pl) } catch {}
    }
    positionPriceLines.current = []
    if (activeTool !== 'position') return
    const { entry, stop, target } = positionTool
    const e = parseFloat(entry), s = parseFloat(stop), t = parseFloat(target)
    const acct = parseFloat(cs.positionCalc?.accountSize) || 0
    const riskPct = parseFloat(cs.positionCalc?.riskPct) || 0
    const riskPerShare = (e > 0 && s > 0) ? Math.abs(e - s) : 0
    const rewardPerShare = (e > 0 && t > 0) ? Math.abs(t - e) : 0
    const maxRisk = (acct * riskPct) / 100
    const shares = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0
    const rrRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0
    const entryTitle = shares > 0 ? `Entry · ${shares.toLocaleString()} sh` : 'Entry'
    const stopTitle = (shares > 0 && riskPerShare > 0) ? `Stop · -$${Math.round(shares * riskPerShare).toLocaleString()}` : 'Stop'
    const targetTitle = (shares > 0 && rewardPerShare > 0)
      ? `Target · +$${Math.round(shares * rewardPerShare).toLocaleString()} · 1:${rrRatio.toFixed(2)}R`
      : 'Target'
    if (e > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: e, color: '#60a5fa', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: entryTitle }))
    if (s > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: s, color: '#f87171', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: stopTitle }))
    if (t > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: t, color: '#4ade80', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: targetTitle }))
  }, [activeTool, positionTool, cs.positionCalc?.accountSize, cs.positionCalc?.riskPct])

  // ── Cleanup position lines on tool deactivation/unmount ──
  useEffect(() => {
    return () => {
      const cs2 = candleSeriesRef.current
      if (!cs2) return
      for (const pl of positionPriceLines.current) {
        try { cs2.removePriceLine(pl) } catch {}
      }
      positionPriceLines.current = []
    }
  }, [])

  // ── Position tool: auto-populate entry from last bar close when activated ──
  useEffect(() => {
    if (activeTool === 'position' && !positionTool.entry) {
      const lastBar = filteredBars?.at(-1)
      if (lastBar) setPositionTool(p => ({ ...p, entry: lastBar.c.toFixed(2) }))
    }
  }, [activeTool]) // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: the keyboard shortcuts, replay auto-advance, and replay-reset
  // useEffects were originally here but referenced `sessionBars`,
  // `replayMode`, `replayPlaying`, `replaySpeed`, and the replay setter
  // functions in their deps arrays — all declared further down the file.
  // Deps arrays evaluate immediately at the useEffect call site, so those
  // identifiers were in the temporal dead zone, throwing
  //   ReferenceError: Cannot access 'X' before initialization
  // on every render of any chart-bearing page (theme tracker, watchlists,
  // ticker pages, etc.). Moved below `filteredBars` declaration so all the
  // referenced consts exist before the deps arrays are evaluated.

  // Viewport-first payload (Phase 2): fetch a shallow window first (fetchDepth =
  // FIRST_PAINT_BARS), bump to the full target only when the user pans into deep
  // history (see the backfill effect below). Reset to shallow on sym/tf change
  // via a render-time key guard (React "adjust state on prop change" pattern).
  // Overlay modes (compare / index pane / multi-symbol comparisons) keep the
  // full fetch so their overlays align across the whole range.
  const [fetchDepth, setFetchDepth] = useState(FIRST_PAINT_BARS)
  const _depthKeyRef = useRef(null)
  const _fullTarget = fullBarsFor(resolvedTf)
  const _overlayActive = !!(
    compareSymbol || indexPaneSymbol ||
    (cs.comparisonSymbols || []).some(c => c && c.enabled && c.sym)
  )
  const _depthKey = `${sym}_${resolvedTf}`
  if (_depthKeyRef.current !== _depthKey) {
    _depthKeyRef.current = _depthKey
    if (fetchDepth !== FIRST_PAINT_BARS) setFetchDepth(FIRST_PAINT_BARS)
  }
  // Pinned book charts (entryDate / exactDateRange) frame a specific historical
  // year that the shallow first-paint window can miss entirely (a 2020 example
  // would silently frame "now"), and they skip the pan-to-backfill path — so
  // they must fetch the full depth up front.
  //
  // Replay mode (replayCutoff) is the same situation: the shallow window is the ~600
  // bars ending TODAY, but replay hides everything after the cutoff, so most of that
  // window is thrown away and almost NO pre-cutoff history is loaded (the "nothing
  // before ~March 2024" bug). Depending on the dwell-warm/prefetch race to backfill it
  // is unreliable — pin full depth so the whole history up to the cutoff loads at once.
  const _pinnedFull = !!(entryDate || exactDateRange || replayCutoff)
  const barCount = (_overlayActive || _pinnedFull) ? _fullTarget : fetchDepth

  // Intraday refetches more often to keep candles current during market hours
  const isIntraday = ['1', '5', '15', '30', '60'].includes(resolvedTf)
  const dedupMs = isIntraday ? 15000 : 60000  // 15s intraday, 60s daily/weekly

  // ── IndexedDB layer — instant renders on repeat visits ────────────────────
  // On every sym/tf change: read IDB (~0 ms) BEFORE firing SWR.
  // idbSinceRef holds the last cached `t` value as a ref (not state) so
  // the SWR URL is stable after the first fire — prevents the double-fetch
  // that would occur if `since` were state and changed after IDB resolved.
  //
  // CRITICAL: idbReadyForRef tracks WHICH sym+tf the IDB state currently
  // belongs to. State updates (setIdbLoaded etc.) are async; on a sym/tf
  // change the FIRST render after the click still sees stale idbLoaded=true
  // and stale idbSinceRef from the previous ticker. Without this gate,
  // swrUrl would be computed as `/api/bars/NEW?since=<OLD's lastT>`, the
  // backend returns an empty delta, mergeDelta(OLD_bars, []) = OLD_bars,
  // and we idbPut(NEW, OLD_bars) — corrupting IDB so NEW chart shows OLD
  // ticker's data forever. This is the "blended" data bug.
  const [idbBars, setIdbBars]   = useState(null)
  const [idbLoaded, setIdbLoaded] = useState(false)
  const idbSinceRef     = useRef(null)
  const idbReadyForRef  = useRef(null)  // string `${sym}_${tf}` once IDB load completes
  // Always-current mirror of idbBars. The SWR-merge effect keys on [data] and would
  // otherwise read a STALE closured idbBars: when the shallow full set resolves right
  // after a deep IDB paint, the closure can still be pre-deep → the deep-preserve check
  // misfires and truncates (the "deep flashes then reloads" bug). Declared BEFORE the
  // merge effect so within any single commit this sync runs first.
  const idbBarsRef = useRef(null)
  useEffect(() => { idbBarsRef.current = idbBars }, [idbBars])
  // TEMP DIAGNOSTIC (window.__uctBarsDebug) — the sym this chart last PAINTED, so
  // updateChart can log ticker transitions. Captures the "random chart appears for
  // a blip then goes away when switching to BLZE with a 2nd widget" report: a blip
  // shows up as an unexpected paint-sym transition sequence (e.g. A -> X -> BLZE).
  const paintSymRef = useRef(null)

  useEffect(() => {
    if (!sym || !resolvedTf) return
    setIdbBars(null)
    setIdbLoaded(false)
    idbSinceRef.current = null
    idbReadyForRef.current = null  // synchronous — invalidates the gate immediately
    axisWidthRatchetRef.current = 0  // new sym/tf → let the axis column re-fit once
    const key = `${sym}_${resolvedTf}`
    idbGet(sym, resolvedTf).then(entry => {
      if (entry?.bars?.length) {
        setIdbBars(entry.bars)
        idbSinceRef.current = entry.lastT ?? null
      }
      idbReadyForRef.current = key
      setIdbLoaded(true)
    }).catch(() => { idbReadyForRef.current = key; setIdbLoaded(true) })
  }, [sym, resolvedTf])

  // SWR URL: only set if IDB state is for the CURRENT sym+tf. Stale idbLoaded
  // from a previous ticker (before the IDB effect runs) is rejected by the ref
  // check, preventing the cross-ticker mergeDelta corruption described above.
  //
  // For Daily/Weekly/Monthly: ALWAYS full-fetch (no `since`). Payloads are
  // ~16KB which is trivial, and any prior IDB entry might contain stale
  // intraday-snapshot OHLC for past days that delta-fetches (server filter
  // is strict `>` so older bars never re-request) cannot heal. With no
  // `since`, server returns full set, the merge branch evaluates delta=false
  // and OVERWRITES the IDB bars array with authoritative server values —
  // healing every prior-day stale bar in one shot. Symptom this fixes:
  // dashboard chart shows wrong H/C for past days (intraday peeks frozen
  // into IDB at whatever moment the user first opened the chart that day).
  //
  // For intraday: keep delta-fetch (payloads can be 400KB+ at 5000 bars)
  // but back off `since` by one second so the boundary bar gets re-fetched.
  // mergeDelta deduplicates by timestamp; fresh server value wins.
  // A cached intraday series whose newest bar is >~23h old is missing at
  // least the most recent session. The `since`-delta CAN heal it (server
  // is authoritative), but a rapid sym/tf flip drops the delta (the
  // sameSymTf race below) leaving the stale cache rendered with a live-
  // price "spike" bar fused onto week-old history — the exact artifact
  // seen in production on 5min. Force a full (no-`since`) refetch so the
  // response REPLACES idbBars with authoritative data (identical to the
  // technique already used for D/W/M above), and don't paint the stale
  // series meanwhile (brief spinner beats a wrong chart). 23h errs toward
  // full-fetch; only cost is one larger payload for already-fresh weekend
  // data — correctness over bandwidth.
  // Threshold is tf-proportional (was a flat 23h). 23h only caught a MISSING
  // SESSION, but an INTRA-session stale cache (missing the last few bars, e.g.
  // a prewarmed entry that aged, or a stale-cache revisit) slipped through as
  // a DELTA — and the initial delta on load races/drops (the "missing candles
  // until the next 30s poll" stall), leaving a gap that reads as a detached
  // developing candle floating to the right of the fetched tail. A stale tail
  // now forces a full (no-`since`) refetch that REPLACES the data (bypasses the
  // flaky delta-merge) so it fills in ~300ms, not 30s — AND (via `_idbFresh`
  // below, which keys off this flag) suppresses painting the stale IDB copy
  // first, so there's no gap-flash before the network lands.
  //
  // 3× the tf interval, not 6× (and no 20-min floor): during RTH the newest
  // COMPLETE bar sits ~1-2 intervals behind "now" (the current bucket is still
  // developing), so 3× clears that fresh window without false positives, yet
  // catches a real gap of even a single missing bar. The old 6×/20-min floor let
  // a 1-min chart's tail sit up to 20 MIN behind before refetching — the visible
  // gap-on-load / gap-on-tf-switch bug. Small ≤1-bar gaps still delta (cheap).
  const _tfSecStale = Math.max(60, (Number(resolvedTf) || 5) * 60)
  const idbStaleIntraday = isIntraday
    && typeof idbSinceRef.current === 'number'
    && (Date.now() / 1000 - idbSinceRef.current) > Math.max(3 * _tfSecStale, 180)
  let _sinceParam = null
  if (isIntraday && typeof idbSinceRef.current === 'number' && !idbStaleIntraday) {
    _sinceParam = Math.max(0, idbSinceRef.current - 1)
  }
  // Viewport-first backfill: once we've bumped PAST the shallow first-paint depth
  // (any progressive step, not only the full target), drop `since` so the server
  // returns the full (older) range. `since` only returns the newer tail, which
  // would never load the deep history the user panned to see — so a progressive
  // intermediate depth MUST also full-fetch or it would delta-fetch nothing. The
  // bar count grows and the existing same-ticker re-anchor holds the view steady.
  if (fetchDepth > FIRST_PAINT_BARS || _pinnedFull) _sinceParam = null
  // Custom (non-native) timeframe → the native path fetches nothing; the isolated
  // custom SWR below fetches the base + resamples. Declared here so swrUrl can defer.
  const _isCustomTf = !!sym && !isNativeTf(resolvedTf)
  const _customBaseTf = _isCustomTf ? fetchTf(resolvedTf) : null
  const _customSpec = useMemo(() => (_isCustomTf ? resampleSpec(resolvedTf) : null), [_isCustomTf, resolvedTf])
  // barsOverride (Model Book uploaded data) short-circuits all fetching.
  const _overrideArr = Array.isArray(barsOverride) && barsOverride.length > 0
  const _hasOverride = _overrideArr || barsOverridePending
  // Replay mode: fetch the bars ENDING AT the cutoff (server serves this pre-cutoff
  // window fast from SQLite) instead of the full 'ending today' set — which for an old
  // cutoff is a big, slow fetch that paints nothing until it lands (the "chart stuck on
  // the previous ticker" bug). `to` implies a full window (no `since`).
  const _toParam = replayCutoff && !_isCustomTf ? replayCutoff : null
  const swrUrl = (_hasOverride || _isCustomTf)
    ? null
    : ((sym && idbLoaded && idbReadyForRef.current === `${sym}_${resolvedTf}`)
        ? (_toParam != null
            ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}&to=${encodeURIComponent(_toParam)}`
            : `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}${_sinceParam != null ? `&since=${encodeURIComponent(String(_sinceParam))}` : ''}`)
        : null)

  // Self-healing poll cadence: with no refreshInterval, the chart was frozen
  // at first-fetch data until the component unmounted. That trapped users on
  // partial sessions (the noon-cutoff symptom), masked silent WS drops, and
  // missed server-side bar corrections. 30s intraday is comfortably under
  // any one-tf threshold yet long enough that the in-flight request rate stays
  // bounded even with many charts open. D/W/M evolve slowly — 5min is enough.
  // refreshWhenHidden:false stops backgrounded tabs from burning ticks.
  const refreshInterval = isIntraday ? 30_000 : 300_000
  const { data, error, mutate } = useSWR(
    swrUrl,
    fetcher,
    {
      dedupingInterval: dedupMs,
      revalidateOnFocus: false,
      refreshInterval,
      refreshWhenHidden: false,
      onErrorRetry: barsSwrOnErrorRetry,
    }
  )
  // Expose the latest mutate() to the live-bar writers (stale-closure-safe) so the
  // contiguity-guard self-heal can force an immediate revalidation. mutate() fires
  // even when refreshInterval polling is paused (hidden/popped-out window), which is
  // exactly the stall it recovers from.
  barsMutateRef.current = mutate

  // ── Custom timeframe: fetch the NATIVE base, resample client-side ──
  // (_isCustomTf / _customBaseTf / _customSpec are declared ABOVE the native SWR so
  // it can null itself out for a custom TF; the fetch + resample happen here.)
  const _customBaseIntraday = ['1', '5', '15', '30', '60'].includes(_customBaseTf)
  // Pull a generous base window so the resampled series has enough bars to fill the view.
  const _customBaseBars = _customBaseIntraday ? 5000 : 6000
  const customSwrUrl = _isCustomTf
    ? `/api/bars/${encodeURIComponent(sym)}?tf=${_customBaseTf}&bars=${_customBaseBars}`
    : null
  const { data: customBaseData } = useSWR(customSwrUrl, fetcher, {
    dedupingInterval: dedupMs,
    revalidateOnFocus: false,
    refreshInterval: _customBaseIntraday ? 30_000 : 300_000,
    refreshWhenHidden: false,
    onErrorRetry: barsSwrOnErrorRetry,
  })
  const customBars = useMemo(
    () => (_isCustomTf && customBaseData?.bars?.length ? resampleForSpec(customBaseData.bars, _customSpec) : null),
    [_isCustomTf, customBaseData, _customSpec],
  )
  // "Intraday-like": native intraday OR a custom TF resampled from an intraday base.
  // Drives the RTH (extended-hours) filter + session shading so custom minute/hour
  // charts hide pre/post market on Regular Hours and shade it on Extended — exactly
  // like the native intraday codes. (The native single-writer live path stays gated
  // on `isIntraday` alone; custom TFs get their own live writer below.)
  const _intradayLike = isIntraday || (_isCustomTf && _customBaseIntraday)

  // ── Comparison symbol SWR fetch ──
  const compareSwrUrl = compareSymbol
    ? `/api/bars/${encodeURIComponent(compareSymbol.toUpperCase())}?tf=${resolvedTf}&bars=${barCount}`
    : null
  const { data: compareData } = useSWR(compareSwrUrl, fetcher, { dedupingInterval: 60_000, revalidateOnFocus: false })

  // Persist to IDB and merge delta when SWR returns.
  useEffect(() => {
    if (!data?.bars || !sym || !resolvedTf) return
    // Guard against stale closure: if sym changed between fetch-start and resolve,
    // the server's `ticker` field reveals the mismatch — skip to avoid storing
    // e.g. AAPL bars under MSFT when the user switches tickers rapidly.
    if (data.ticker && data.ticker !== sym.toUpperCase()) return
    // Belt-and-suspenders: only merge if idbBars is known to belong to this sym+tf.
    // Without this, a delta response could merge with leftover bars from another
    // ticker still sitting in idbBars state (the cross-ticker race).
    const sameSymTf = idbReadyForRef.current === `${sym}_${resolvedTf}`
    // TEMP DIAGNOSTIC (enable in DevTools: window.__uctBarsDebug = true) — traces
    // the delta-sync path to find the "missing candles until ~10s later" stall on
    // a stale-cache revisit. Logs the since sent, the delta response, the cached
    // tail, and the merge outcome. Remove once the gap-fill delay is root-caused.
    const _dbg = typeof window !== 'undefined' && window.__uctBarsDebug
    if (_dbg) console.log('[bars-delta]', sym, resolvedTf,
      '| resp:', { delta: data.delta, n: data.bars.length, firstT: data.bars[0]?.t, lastT: data.bars[data.bars.length - 1]?.t },
      '| idb:', { n: idbBars?.length ?? 0, lastT: idbBars?.[idbBars.length - 1]?.t },
      '| sinceRef:', idbSinceRef.current, '| sameSymTf:', sameSymTf)
    if (data.delta && idbBars?.length && sameSymTf) {
      const merged = mergeDelta(idbBars, data.bars)
      // refreshInterval flicker guard: when the 30s poll returns no new bars
      // and no overlapping-timestamp updates (the common case during low-vol
      // hours), the merged array is referentially+structurally identical to
      // idbBars. Skipping setIdbBars + idbPut here keeps updateChart's setData
      // from firing — no 1-frame "blank → restored" gap on every poll.
      const lastIdb = idbBars[idbBars.length - 1]
      const lastMerged = merged[merged.length - 1]
      const sameLength = merged.length === idbBars.length
      const sameTail = lastIdb && lastMerged
        && lastIdb.t === lastMerged.t
        && lastIdb.c === lastMerged.c
        && lastIdb.h === lastMerged.h
        && lastIdb.l === lastMerged.l
        && lastIdb.v === lastMerged.v
      if (sameLength && sameTail) {
        if (_dbg) console.log('[bars-delta]', sym, resolvedTf, '=> SKIPPED (delta added nothing new; gap NOT filled)')
        return  // nothing changed — don't repaint
      }
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf, `=> MERGED ${idbBars.length} -> ${merged.length}`)
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      idbPut(sym, resolvedTf, merged)
      memPut(sym, resolvedTf, merged)
    } else if (!data.delta && data.bars.length) {
      // If IDB already holds a DEEPER history than this (shallow, recent) full set —
      // e.g. the Custom-Period-Sort deep prefetch pre-warmed the full pre-2024 tail —
      // don't truncate it back to the first-paint window. mergeDelta keeps the deep
      // bars and lets the fresh server bars WIN on the overlapping recent tail (same
      // healing as a replace, minus the truncation), so scrolling into deep history
      // is instant instead of paying a cold deep fetch. Only when the fresh set is a
      // recent SUFFIX of the deeper one (same sym/tf, starts at/after the deep start).
      // Read the authoritative CURRENT idb bars from the ref, not the [data]-closured
      // state (which can lag a just-committed deep IDB paint and cause the truncation).
      const curIdb = idbBarsRef.current
      const deeperInIdb = sameSymTf && curIdb?.length > data.bars.length
        && data.bars[0] && curIdb[0] && data.bars[0].t >= curIdb[0].t
      const next = deeperInIdb ? mergeDelta(curIdb, data.bars) : data.bars
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf,
        deeperInIdb ? `=> KEPT DEEP (${curIdb.length}) + healed tail (${data.bars.length})` : `=> REPLACED (full) with ${data.bars.length}`)
      idbBarsRef.current = next        // keep the mirror current for any same-tick re-run
      setIdbBars(next)
      idbSinceRef.current = next[next.length - 1]?.t ?? null
      idbPut(sym, resolvedTf, next)
      memPut(sym, resolvedTf, next)
    }
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background prefetch — all other timeframes when sym changes ───────────
  // After the primary chart loads, fetch every other TF into IDB so switching
  // timeframes is instant. Fetches run STRICTLY SEQUENTIAL (one at a time,
  // wait for previous to finish before starting next) — fixed-delay staggering
  // doesn't work because some TFs are slow (e.g. VIX 1min ≈ 7s due to yfinance
  // fallback) and end up overlapping anyway. Sequential = backend sees exactly
  // 1 prefetch in flight per chart at a time.
  //
  // Order: the COMMONLY-clicked TFs first — Daily then 5min (the two the user
  // scans on) so those switches are instant, then the rest of intraday, then the
  // rarely-clicked W/M/1. (5min used to be 7th → clicking it before the chain
  // reached it was a cold fetch = the "only 5min lags" report.)
  useEffect(() => {
    if (!sym || !backgroundWarm) return
    const ORDER = ['D', '5', '60', '30', '15', 'W', 'M', '1']
    const tfs   = ORDER.filter(t => t !== resolvedTf)
    let cancelled = false

    async function runSequential() {
      // 600ms initial delay so the primary chart's fetch goes out alone first.
      await new Promise(r => setTimeout(r, 600))
      if (cancelled) return  // user may have switched tickers during the sleep
      for (const tf of tfs) {
        if (cancelled) return
        try {
          const entry = await idbGet(sym, tf)
          // A cached intraday entry whose newest bar is >23h old is
          // missing >=1 session — must refetch FULL (no since) so the
          // response replaces it, or this stale copy gets rendered later
          // with a fused live-price spike. Mirrors idbStaleIntraday.
          const _et = entry?.lastT
          const _tfSecEntry = Math.max(60, (Number(tf) || 5) * 60)
          // 3× interval (matches idbStaleIntraday above) — a warm-stored tail more
          // than a few bars behind is refetched FULL so a later tf-switch paints
          // current data instead of a detached developing candle over a stale tail.
          const entryStaleIntraday = !['D', 'W', 'M'].includes(tf)
            && typeof _et === 'number'
            && (Date.now() / 1000 - _et) > Math.max(3 * _tfSecEntry, 180)
          // Skip if IDB has fresh data (D/W: 24 h; intraday: 4 h) — but
          // never skip a stale intraday entry just because it was saved
          // recently (savedAt tracks write time, not bar freshness).
          const maxAge = (['D', 'W'].includes(tf) ? 86400 : 14400) * 1000
          if (!entryStaleIntraday && entry?.bars?.length
              && Date.now() - (entry.savedAt || 0) < maxAge) continue
          const bc    = FIRST_PAINT_BARS  // viewport-first: warm the shallow window; backfill loads deep history on pan
          const since = entryStaleIntraday ? null : entry?.lastT
          const url   = `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bc}${since != null ? `&since=${encodeURIComponent(String(since))}` : ''}`
          const r = await fetch(url)
          if (cancelled || !r.ok) continue
          const d = await r.json()
          if (cancelled || !d.bars?.length) continue
          const next = (d.delta && entry?.bars?.length) ? mergeDelta(entry.bars, d.bars) : d.bars
          idbPut(sym, tf, next)
          memPut(sym, tf, next)   // warm the sync mem cache too → instant TF switch
        } catch {
          // Single-TF failures shouldn't kill the whole prefetch chain.
        }
      }
    }
    runSequential()

    return () => { cancelled = true }
  }, [sym, backgroundWarm])  // eslint-disable-line react-hooks/exhaustive-deps

  // Bars: IDB renders instantly; full SWR data replaces it when available.
  // BUT never paint a stale intraday IDB series — that's what fuses a
  // live-price spike onto week-old history. When stale we force a full
  // refetch (no `since`, above) and show a brief spinner until it lands.
  //
  // Cross-ticker guard: on a sym switch, setIdbBars(null) only lands NEXT
  // render, and a stale-closure `data` may still describe the OLD ticker — so
  // for one render the naive selector would serve the previous stock's candles
  // (the "random candles flashing" on flip). Gate IDB on idbReadyForRef and
  // network on data.ticker so a mismatched render yields null (clean blank +
  // updateChart clears the series) instead of the wrong stock.
  const _symU = sym ? sym.toUpperCase() : ''
  const _netMatches = data?.bars?.length && (!data.ticker || data.ticker === _symU)
  const _idbFresh = idbBars?.length && idbReadyForRef.current === `${sym}_${resolvedTf}` && !idbStaleIntraday
  // Provisional stale-intraday paint: cached bars for THE CURRENT sym+tf that are
  // too stale to trust as live (idbStaleIntraday) are normally suppressed to avoid
  // fusing a live-price spike onto an old tail — but that left an intraday sym-switch
  // showing a 2-3s spinner while the forced full refetch lands, when Daily paints its
  // cache instantly. So we DO paint them, but only as the LAST-RESORT layer (real
  // net/mem/agg bars always win above it) AND we FREEZE the live-bar writers while
  // this layer is the one on screen (provisionalStaleRef below), so no phantom
  // developing candle can grow on the stale tail before authoritative bars swap in.
  const _idbProvisional = (idbStaleIntraday && idbBars?.length
    && idbReadyForRef.current === `${sym}_${resolvedTf}`) ? idbBars : null
  // A2/A1: synchronous in-memory hit for THIS exact sym+tf. Used only as the
  // last fallback (when net+IDB haven't resolved for the current key yet) so a
  // warm switch paints on the first frame instead of flashing the loading
  // overlay. Keyed to the current sym+tf → cannot show another ticker's data.
  const _memBars = (!_overrideArr && !barsOverridePending) ? memPeek(sym, resolvedTf) : null
  // Phase-A A4: optimistic same-frame TF switch. Switching to Weekly/Monthly on a
  // ticker whose Daily is already in the sync mem cache normally still costs a
  // full /api/bars round-trip (skeleton flash) for the W/M payload. Instead,
  // synthesize W/M from the cached Daily and paint it on the FIRST frame; the
  // normal SWR fetch then replaces it with authoritative server bars. The
  // resampler mirrors the server's ISO-Friday / 1st-of-month bucketing exactly
  // (cross-checked bar-for-bar vs prod), so the swap is seamless for the visible
  // range. Only as the LAST fallback — real net/IDB/mem W/M data always wins — so
  // this paints ONLY during the brief load window. Memoized on the Daily array
  // identity so it doesn't churn updateChart every render.
  const _dailyForAgg = (!_overrideArr && !barsOverridePending
                        && (resolvedTf === 'W' || resolvedTf === 'M'))
    ? memPeek(sym, 'D')
    : null
  const _aggBars = useMemo(
    () => (_dailyForAgg ? resample(_dailyForAgg, 'D', resolvedTf) : null),
    [_dailyForAgg, resolvedTf],
  )
  const bars = _isCustomTf
    ? customBars   // custom TF: the resampled base bars (null until the base loads)
    : _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            // Server returned a full (non-delta) set. Normally render it — it's the
            // authoritative heal. BUT if fresh IDB holds a strictly DEEPER history than
            // this (shallow first-paint) fetch, render THAT: otherwise a deep-warmed
            // chart flashes its full history from IDB, then this shallow fetch truncates
            // it back to ~600 bars until the dwell-warm re-fetches deep (the "cuts off
            // pre-2024 then reloads" flicker). The merge effect still heals idbBars's
            // recent tail from data.bars (server wins on overlap), so this stays correct.
            ? ((_idbFresh && idbBars.length > data.bars.length) ? idbBars : data.bars)
            : (_idbFresh
                ? idbBars
                : (_netMatches
                    ? data.bars
                    : (_memBars?.length
                        ? _memBars
                        : (_aggBars?.length ? _aggBars : (_idbProvisional || null)))))))
  // The live-bar writers consult this to freeze until a CURRENT-session payload
  // replaces the data — BUT only when the stale tail is from a PRIOR session
  // (>8h old: overnight / weekend / multi-day), which is the "fuse a live spike
  // onto old history" danger this gate exists for. A SAME-SESSION tail that's
  // merely >15min stale is safely EXTENDED by a live tick (isSaneLivePrice already
  // rejects a wrong price), so freezing there just left the price permanently stuck
  // with the feed connected until a timeframe flip (owner report: 5m loads only to
  // 3:15pm, LIVE badge green but price frozen). Same-session → keep ticking so the
  // developing candle advances.
  // Freeze the live-bar writers whenever the intraday series ON SCREEN ends on a
  // PRIOR-SESSION tail (>8h old) — regardless of whether that tail came from the
  // IDB provisional layer OR a stale NETWORK response the backend served before
  // today's bars landed. The old form keyed off `!_netMatches`, so the freeze
  // dropped the instant ANY network payload matched — even a stale one whose
  // newest bar is yesterday's close — and a live tick then fused a giant
  // developing candle onto that stale tail (the QQQ "yesterday's full session +
  // one huge candle up to now" / SPCX "only yesterday" reports). Keying purely on
  // the chosen `bars` tail age keeps the freeze on until a CURRENT-session payload
  // replaces it (the forced full refetch), then writers resume. 8h is well above
  // same-session staleness (a normal developing tail is ≤ a couple intervals old),
  // so an active RTH chart is never falsely frozen; only a missing-session tail is.
  const _barsTailT = (Array.isArray(bars) && bars.length)
    ? (typeof bars[bars.length - 1]?.t === 'number' ? bars[bars.length - 1].t : null)
    : null
  const _barsTailSecs = (typeof _barsTailT === 'number') ? (Date.now() / 1000 - _barsTailT) : 0
  provisionalStaleRef.current = isIntraday && _barsTailT != null && _barsTailSecs > 8 * 3600
  // Mirror the exact array the drawing overlay indexes (its `bars` prop) so the
  // Ctrl+drag trendline below maps x → bar time the SAME way toChart does — its
  // point.time is then guaranteed to resolve in the overlay's timeToIndex.
  const drawBarsRef = useRef(null)
  drawBarsRef.current = bars
  const loading = !bars && !error
  // First-bars latch: fire onBarsReady exactly once per mount, on the first
  // render where loading settles false — renderable bars OR fatal error both
  // count, so a dead ticker never starves the grid mount queue waiting on it.
  // Latest-callback ref per the codebase's stale-closure convention.
  const onBarsReadyRef = useRef(onBarsReady)
  onBarsReadyRef.current = onBarsReady
  const barsReadyFiredRef = useRef(false)
  useEffect(() => {
    if (!loading && !barsReadyFiredRef.current) {
      barsReadyFiredRef.current = true
      try { onBarsReadyRef.current?.() } catch {}
    }
  }, [loading])
  // Only surface the "Failed to load chart" overlay when we have NOTHING
  // to render. If IDB has cached bars (or the SWR data was already painted
  // before the error), keep showing them and let the 30s SWR refresh
  // recover silently. Otherwise a transient backend 5xx pins the chart at
  // a hard-fail state for the user even though usable history is sitting
  // in IndexedDB. The retry button below still mutate()'s on click.
  const showFatalError = !!error && !bars?.length

  // Real-time price streaming for live candle updates
  const { prices: livePrices, staleSymbols, isStreaming } = useRealtimePrices(liveUpdates && sym ? [sym] : [])
  const isStale = !!(sym && staleSymbols && staleSymbols.has(String(sym).toUpperCase()))
  const feed = streamStatus({ isStreaming, isStale })

  // ── Frozen-chart watchdog (independent of the live-bar writers) ──
  // Uses the existing livePricesRef (assigned each render below) — stale-closure-safe.
  // The live-bar writers only self-heal a stalled chart when they actually FIRE
  // (a push/Finnhub tick arrives AND isn't suppressed). But the exact reported bug
  // — "price keeps updating in the header + watchlist, yet the chart is frozen and
  // the tick isn't moving" — is a state where the developing-bar writer isn't
  // advancing the series while the live-price feed clearly IS live. The header/
  // watchlist price rides the /api/live-prices path (livePrices here), so when that
  // price is running MORE than ~2 intervals ahead of the chart's rendered tail, the
  // bars SWR poll has stalled (post-deploy SSE drop + visibility-gated refresh not
  // resuming). Force a throttled revalidation — mutate() fires even while interval
  // polling is paused, and the backend is authoritative + proven fresh, so the tail
  // catches up. Runs only for intraday; a same-session live price naturally sits
  // within a bar or two of the tail, so this never fires on a healthy chart.
  useEffect(() => {
    if (!sym || !isIntraday) return
    const id = setInterval(() => {
      try {
        const lp = livePricesRef.current?.[sym]
        const tail = lastBarRef.current
        if (!lp || !Number.isFinite(lp.updated_at) || !tail || !Number.isFinite(tail.time)) return
        const period = PERIOD_SECONDS[resolvedTf] || 300
        // tail.time is (server unix seconds + _ET_OFFSET); lp.updated_at is raw unix
        // seconds — undo the offset to compare like-for-like.
        const tailServerSec = tail.time - _ET_OFFSET
        if (lp.updated_at - tailServerSec <= 2.5 * period) return
        const nowMs = Date.now()
        if (nowMs - gapHealAtRef.current <= 6000) return
        gapHealAtRef.current = nowMs
        // Fetch the fresh FULL series directly (no `since`) and INJECT it into SWR's
        // cache via mutate(payload, {revalidate:false}). This deterministically drives
        // the `[data]` effect's non-delta REPLACE branch → setData → the tail advances,
        // instead of relying on mutate()'s revalidation actually re-firing the paused
        // poll. Bounded: throttled 6s, only while the chart is demonstrably behind the
        // live feed, and a no-op REPLACE once caught up (the price sits within 2.5
        // intervals of the tail again → this branch stops firing).
        const _sym = sym, _tf = resolvedTf
        fetch(`/api/bars/${encodeURIComponent(_sym)}?tf=${_tf}&bars=${barCount}`)
          .then(r => (r.ok ? r.json() : null))
          .then(payload => {
            // Guard against a ticker/tf switch mid-fetch, and against a stale payload.
            if (!payload?.bars?.length) return
            if (sym !== _sym || resolvedTf !== _tf) return
            if (payload.ticker && payload.ticker !== String(_sym).toUpperCase()) return
            barsMutateRef.current?.(payload, { revalidate: false })
          })
          .catch(() => { /* transient — next tick retries */ })
      } catch { /* watchdog must never throw */ }
    }, 8000)
    return () => clearInterval(id)
  }, [sym, resolvedTf, isIntraday, barCount])

  // Keep lastPriceRef / lastChangePctRef in sync for screenshot composition.
  // Prefers live stream values; falls back to last bar close / intra-bar change.
  useEffect(() => {
    const live = sym ? livePrices[sym] : null
    const _livePx = _effLivePrice(live)
    if (live && Number.isFinite(_livePx)) {
      lastPriceRef.current = _livePx
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.close)) {
      lastPriceRef.current = lastBarRef.current.close
    }
    if (live && Number.isFinite(live.change_pct)) {
      lastChangePctRef.current = live.change_pct
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.close)) {
      // Fallback with no live feed: change vs PREVIOUS bar's close (true daily
      // move), not intra-bar close-minus-open.
      const _bars = prevBarsRef.current
      const _prev = _bars && _bars.length >= 2 ? _bars[_bars.length - 2] : null
      if (_prev && Number.isFinite(_prev.c) && _prev.c) {
        lastChangePctRef.current = ((lastBarRef.current.close - _prev.c) / _prev.c) * 100
      } else if (Number.isFinite(lastBarRef.current.open) && lastBarRef.current.open) {
        lastChangePctRef.current = ((lastBarRef.current.close - lastBarRef.current.open) / lastBarRef.current.open) * 100
      }
    }
  }, [livePrices, sym])

  // Bar-correction flash (P4-7): pulses briefly when SSE bar_correction event
  // fires for the current symbol, signaling minute-close reconciliation
  // overrode the WS-built bar.
  const [correctionFlash, setCorrectionFlash] = useState(false)

  // ── Memoized data transforms (only recompute when bars change) ─────────────

  // Offset intraday timestamps from UTC → ET so chart axis shows Eastern Time
  const adjustTime = useCallback(
    (t) => typeof t === 'number' ? t + _ET_OFFSET : t,
    []
  )

  // Extend the MA overlays out to the developing/live bar so they NEVER lag behind
  // the live candle. The live writers advance the candle series tick-by-tick (and
  // roll it into new buckets), but overlayData is a memo over the FETCHED bars, so
  // between SWR refreshes the MA line stopped a few bars short of the newest candle
  // (user report: "moving averages should always extend to current bar"). Given the
  // developing bar (tSec, close c), recompute each overlay's value AT that bar and
  // update()/append its series point. EXACT for both SMA (mean of the last `period`
  // closes ending at the live bar) and EMA (one recurrence step from the prior bar's
  // stored EMA) — no windowed approximation, so it lands exactly where the next full
  // recompute will. Cheap: O(overlays × period) per tick, no full-series walk. Shared
  // by every live writer (A Finnhub tick + B Massive push) so the MA tracks the
  // developing bar regardless of which feed owns it.
  const _extendOverlaysLive = useCallback((tSec, c) => {
    const defs = resolvedOverlaysRef.current
    const ovAll = overlayDataRef.current
    const series = overlaySeriesRefs.current
    const bars = prevBarsRef.current
    if (!defs || !defs.length || !ovAll || !series || !series.length || !bars || !bars.length) return
    if (!Number.isFinite(c)) return
    const sameBucket = adjustTime(bars[bars.length - 1].t) === tSec
    for (let i = 0; i < series.length && i < defs.length; i++) {
      const def = defs[i]
      const period = def ? Number(def.period) : NaN
      if (!series[i] || !(period > 0)) continue
      let val = null
      if (def.type === 'EMA') {
        const arr = ovAll[i]?.data
        // Prior bar's EMA: the point before the developing bar (same bucket → its
        // stored point is the stale developing value, so step from the one before),
        // or the last stored point (a brand-new bucket).
        const priorIdx = (arr?.length || 0) - (sameBucket ? 2 : 1)
        const prior = priorIdx >= 0 ? arr[priorIdx]?.value : null
        if (prior != null && Number.isFinite(prior)) {
          const k = 2 / (period + 1)
          val = c * k + prior * (1 - k)
        }
      } else {
        // SMA: mean of the last `period` closes ENDING at the developing bar (live
        // close = the tail value; skip the stale developing bar when same-bucket).
        let sum = c, cnt = 1
        let j = bars.length - (sameBucket ? 2 : 1)
        while (j >= 0 && cnt < period) { sum += bars[j].c; cnt++; j-- }
        if (cnt === period) val = sum / period
      }
      if (val != null && Number.isFinite(val)) {
        try { series[i].update({ time: tSec, value: val }) } catch { /* time regressed / disposed */ }
      }
    }
    // VWAP rides the same live-extend (it's a session cumulative, not in overlaySeriesRefs):
    // hold its newest value to the developing bar so the line reaches the current candle
    // exactly like the MAs, instead of stopping a bar short between SWR refreshes.
    //
    // ⭐ MASTER'S `a2dc2f07` (item 2) SHIPPED THIS AGAINST `vwapSeriesRef` +
    // `lastVwapValueRef`, AND BOTH ARE GONE — B3 Task 11 flipped VWAP onto the
    // engine, so the series belongs to the binder's pool and a component-held ref
    // would be a stale second handle to something the pool re-purposes. The BINDING
    // is the replacement for both: it carries the `series` and, in `lastValue`, the
    // newest point of the very array the binder just applied — which is exactly
    // what the retired ref cached, sourced one step closer to the data.
    //
    // ⚠️ `lastValue` CAN BE `undefined`: `toPoints` emits WHITESPACE for bars
    // before the session starts, and `lastPointValue` reads `last.value` off
    // whatever the tail is. `Number.isFinite` is the same guard master wrote, kept
    // for the same reason — `Number(undefined)` is `NaN`, but `Number(null)` is 0,
    // and a 0 written here would drag the VWAP line to the axis floor.
    const _engine = engineRef.current
    if (_engine) {
      try {
        for (const b of _engine.binder.bindings()) {
          if (b.defId !== 'vwap' || !b.series) continue
          if (!Number.isFinite(b.lastValue)) continue
          try { b.series.update({ time: tSec, value: b.lastValue }) } catch { /* time regressed / disposed */ }
        }
      } catch { /* binder disposed mid-tick */ }
    }
  }, [adjustTime])

  // Filter bars to regular session only when extended hours hidden
  const sessionBars = useMemo(() => {
    if (!bars || !_intradayLike || showExtended) return bars

    const getETMins = (t) => {
      const d = new Date(t * 1000)
      const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      const [h, m] = etStr.split(':').map(Number)
      return h * 60 + m
    }

    return bars.filter(b => {
      if (typeof b.t !== 'number') return true
      const mins = getETMins(b.t)
      // All intraday RTH: 9:30 AM (570 min) to 4:00 PM (960 min) ET
      return mins >= 570 && mins < 960
    })
  }, [bars, _intradayLike, showExtended, resolvedTf])

  // ── Replay / Time Machine state ──
  const [replayMode, setReplayMode] = useState(false)
  // Replay-cutoff (Custom-Period Sort replay): a live ref so the developing-bar writers
  // freeze the moment a cutoff is set, without re-subscribing on every cutoff change.
  const replayCutoffRef = useRef(null)
  replayCutoffRef.current = replayCutoff
  const [replayIndex, setReplayIndex] = useState(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)

  // ── Extended-hours session preview (Charts workspace; D/W/M only) ──────────
  // `sessionView` is non-null only on the workspace. `marketSession` is the live
  // ET session. Three activation flags drive the behavior; see sessionPreview.js.
  const marketState = useMarketOpen()
  // Extended session with the overnight-post extension: 'post' spans 4pm ET → 4am
  // (post-market + overnight), then 'pre' at 4am. anchorDate = the trading day
  // whose extended data to show (the just-closed day, even after midnight).
  const _extSess = getExtSessionCached()
  const marketSession = _extSess.session   // 'pre' | 'post' | 'rth'
  const _isDWM = ['D', 'W', 'M'].includes(resolvedTf)
  const _sessionActive = sessionView != null && _isDWM
  const _inExtWindow = marketSession === 'pre' || marketSession === 'post'
  inExtWindowRef.current = _inExtWindow
  const _sessionLive = sym ? livePrices?.[sym] : null
  // Live extended-hours print (null until the feed flags a real pre/post trade).
  const sessionExtPrice = (_sessionLive && _sessionLive.ext_session
    && Number.isFinite(_sessionLive.ext_price) && _sessionLive.ext_price > 0)
    ? _sessionLive.ext_price : null
  // Include-mode: synthesize/extend the D/W/M candle from extended-hours data.
  // replayCutoff (Custom-Period Sort replay) suppresses ALL live extended-hours session
  // preview — the candle, the freeze, and the Pre/Post right-axis tags — just like the
  // internal replayMode does: a live "Post" price tag is meaningless on a replayed
  // historical period (owner request). Restored the moment replay is exited.
  const sessionCandleActive = _sessionActive && sessionView === 'extended' && _inExtWindow && !replayMode && !replayCutoff
  // Regular-mode post-market: freeze today's candle at the 4pm close (don't let
  // the live writers fold post-market prints into it). Pre-market regular mode
  // already leaves yesterday's bar untouched (day_open==0 → classifyLiveBar skip).
  const sessionFreezeActive = _sessionActive && sessionView === 'regular' && marketSession === 'post' && !replayMode && !replayCutoff
  // Show the locked-close + Pre/Post tags whenever it's pre/post market on the
  // workspace, regardless of the toggle (matches TradingView).
  const sessionTagsActive = _sessionActive && _inExtWindow && !replayMode && !replayCutoff
  // Same two right-axis tags on INTRADAY charts (1m..1h) on the workspace — the
  // prev-day close + live Pre/Post price — regardless of the Regular/Extended
  // toggle. Intraday has no synthetic session candle (that's D/W/M only); it just
  // gets the price-scale references, sourced straight from the live feed.
  const sessionTagsIntraday = sessionView != null && !_isDWM && _inExtWindow && !replayMode && !replayCutoff
  // (sessionPreviewLastBar — the muted-white preview paint — is derived below, once
  // we know whether the session candle actually got applied to the bars.)
  // Writers A + D yield the D/W/M last bar to the memo-driven setData while owned.
  // Kept in a ref (read by the live-tick callbacks); updated in an effect so we
  // never write a ref during render. Effects run top-to-bottom, and the writer
  // callbacks only fire on a later live tick, so the ref is always current by then.
  useEffect(() => {
    sessionOwnsDailyRef.current = sessionCandleActive || sessionFreezeActive
    sessionViewRef.current = sessionView
  }, [sessionCandleActive, sessionFreezeActive, sessionView])
  // Today's extended-hours aggregate (only fetched while the preview candle is on).
  // `ready` gates the paint below — see the memo. Until this symbol's fetch lands we
  // have only the live ext price, which is not enough to draw an honest candle.
  const { agg: sessionExtAgg, ready: sessionExtReady } = useSessionExtBars(sym, sessionCandleActive ? marketSession : null, sessionCandleActive, _extSess.anchorDate)

  // Exact-range frame flips (Setup ⇄ Result) animate — see the exact-range pin
  // effect below. While the framed window SHRINKS (Result → Setup) keep slicing
  // at the OLD wider end so the outgoing candles stay in the series and visibly
  // glide off-screen instead of vanishing; the hold is dropped (and the tail
  // re-cut) once the animation lands.
  const sliceHoldRef = useRef(null)     // { key, end } — wider slice end held during a shrink glide
  const prevExactEndRef = useRef(null)  // { key, end } — last exact-range exitDate seen for this chart
  const [, setSliceGen] = useState(0)   // bump after the glide lands to re-render with the hold released
  const _exKey = `${sym}_${resolvedTf}`
  {
    const prev = prevExactEndRef.current
    // The shrink-hold exists ONLY to let outgoing candles glide off-screen during
    // the animated flip. With instantFrameFlip there's no glide (we snap), so never
    // engage it — otherwise it holds the wider slice, then a re-render releases it,
    // which lands the view a beat AFTER the snap (the "moves ¼s later" glitch).
    if (!instantFrameFlip
        && exactDateRange && exitDate && prev && prev.key === _exKey && prev.end
        && String(prev.end) > String(exitDate)
        && (!sliceHoldRef.current || sliceHoldRef.current.key !== _exKey
            || String(sliceHoldRef.current.end) < String(prev.end))) {
      sliceHoldRef.current = { key: _exKey, end: prev.end }
    }
    if (!prev || prev.key !== _exKey || prev.end !== exitDate) {
      prevExactEndRef.current = { key: _exKey, end: exitDate }
    }
  }
  const _sliceHold = sliceHoldRef.current
  const exactSliceEnd = (exactDateRange && exitDate && _sliceHold && _sliceHold.key === _exKey
      && String(_sliceHold.end) > String(exitDate)) ? _sliceHold.end : exitDate

  // Restore filteredBars as the replay-sliced version.
  // All downstream code continues to use `filteredBars` unchanged.
  const filteredBars = useMemo(
    () => {
      let src = sessionBars
      // Model Book (exactDateRange): never render bars AFTER the framed year-end.
      // A stock still trading has next-year bars in the loaded series, and the
      // first one peeks a sliver past the right edge of the year / setup-focus
      // view (the right edge sits on a bar index). Drop them — the chart never
      // shows past the year anyway. LEADING bars are kept for MA warm-up.
      //   • keepBarsAfterExit (Setup Library Result view): keep the post-exit
      //     history so the candles continue into the right-pad space instead of
      //     cutting off at exitDate — but ONLY a pad's worth, never the whole
      //     tail out to today.
      //   • a held slice (_sliceHold, a Setup⇄Result shrink glide in flight):
      //     keep that same pad so the outgoing candles past the new exitDate
      //     glide off-screen instead of vanishing on the first frame.
      // CRITICAL: keeping the ENTIRE tail out to `today` (years past the framed
      // result) let a transient re-frame during a data-phase swap snap the view
      // to the latest bar — the "jumps years into the future, then lands on the
      // result" glitch — and bloated every animation frame. Cap it to the pad.
      const _holdActive = !!(_sliceHold && _sliceHold.key === _exKey && String(_sliceHold.end) > String(exitDate))
      if (exactDateRange && exactSliceEnd && src?.length) {
        const cut = src.findIndex(b => String(b.t) > exactSliceEnd)  // first bar after frame-end
        if (cut > 0) {
          if (keepBarsAfterExit || _holdActive) {
            // Keep just enough real candles past the end to fill the right pad
            // (frameRightPadFrac of the framed window) plus a small margin.
            const startIdx = entryDate ? src.findIndex(b => String(b.t) >= entryDate) : 0
            const winBars = cut - Math.max(0, startIdx)
            const extra = Math.ceil(winBars * (frameRightPadFrac || 0)) + 6
            src = src.slice(0, cut + extra)
          } else {
            src = src.slice(0, cut)
          }
        }
      }
      let out = (replayMode && replayIndex != null) ? src?.slice(0, replayIndex + 1) : src
      // Replay-cutoff (Custom-Period Sort replay mode): drop every bar AFTER the cutoff
      // calendar day, so the chart ends exactly on the selected end date. Compared by
      // calendar day — daily/weekly/monthly `t` is already 'YYYY-MM-DD'; intraday `t` is
      // unix seconds, converted to its ET day (so all of the cutoff day's bars are kept).
      if (replayCutoff && out?.length) {
        out = out.filter(b => (
          typeof b.t === 'number'
            ? new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) <= replayCutoff
            : String(b.t).slice(0, 10) <= replayCutoff
        ))
      }
      return out
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- _sliceHold/_exKey/exitDate are render-derived (mutated in the block above); exactSliceEnd already tracks the hold
    [sessionBars, replayMode, replayIndex, replayCutoff, exactDateRange, exactSliceEnd, keepBarsAfterExit, entryDate, frameRightPadFrac]
  )

  // Capture the last + prior REGULAR-session close for the PNG export. filteredBars is
  // RTH-only (pre/post excluded), so its last close is the current intraday print during
  // RTH and the locked regular close after hours (e.g. Friday's 226.73, not the 228.38 post).
  useEffect(() => {
    const fb = filteredBars
    if (Array.isArray(fb) && fb.length) {
      const lastC = fb[fb.length - 1]?.close ?? fb[fb.length - 1]?.c
      rthCloseRef.current = Number.isFinite(lastC) ? lastC : null
      const prevC = fb.length > 1 ? (fb[fb.length - 2]?.close ?? fb[fb.length - 2]?.c) : null
      rthPrevCloseRef.current = Number.isFinite(prevC) ? prevC : null
    }
  }, [filteredBars])

  // Curated book charts (exactDateRange) frame a specific historical window.
  // For a REUSED ticker with a data gap (e.g. CGC: a different company's data
  // through 2011, then real Canopy Growth from 2018 — NOTHING in between), a
  // selected window that lands entirely in the gap has no bars to show. Rather
  // than silently framing an unrelated era (the old fallback showed the last
  // ~year of whatever bars survived the slice — i.e. the wrong company), detect
  // the empty window and surface it so the date selection is never misrepresented.
  const selectedRangeEmpty = useMemo(() => {
    if (!exactDateRange || !entryDate || !bars || bars.length === 0) return false
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    const lo = toMs(entryDate)
    const hi = exitDate ? toMs(exitDate) : Infinity
    return !bars.some(b => {
      const t = toMs(b.t)
      return t >= lo && t <= hi
    })
  }, [exactDateRange, entryDate, exitDate, bars])

  // Extended-hours shading bands. Memoized HERE rather than computed inside
  // updateChart: the pass is O(bars) and updateChart runs on every settings/data
  // change (and, before the session-tag split above, on every live tick), so an
  // inline call re-walked the whole bar array — which extended hours makes ~2.5×
  // longer — for a result that only changes when the bars do. Returns a stable []
  // when shading is off, so the identity guard at the call site also catches the
  // toggle flipping.
  const _shadeOn = !!cs.extendedHoursShading && _intradayLike
  const sessionShadeBands = useMemo(
    () => (_shadeOn ? computeSessionBands(filteredBars, adjustTime) : EMPTY_BANDS),
    [_shadeOn, filteredBars, adjustTime],
  )
  const lastShadeBandsRef = useRef(undefined)

  // Earnings events (daily/weekly only) with the reporting bar's LOW, so the badge
  // primitive can hug just under the candle and click-matching has the dates. The
  // date string maps 1:1 to a daily/weekly bar time (adjustTime is identity there).
  // MUST live after filteredBars is declared (it reads it) — declaring it earlier
  // hit filteredBars' temporal dead zone and crashed the whole chart (ReferenceError).
  const earningsEvents = useMemo(() => {
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!cs.markers?.earnings || !markersData?.earnings || !isDailyWeekly || !filteredBars?.length) return []
    // Snap each earnings DATE to the bar whose PERIOD contains it. Daily bars are
    // keyed by the exact day, but WEEKLY bars are keyed by the week's Friday and
    // MONTHLY by the month — so an exact date-match only ever hit on daily (and by
    // coincidence when a report happened to land on a Friday). Bucket both the
    // bars and the earnings dates the same way, then look up the containing bar.
    const tf = resolvedTf
    const bucket = (dstr) => {
      const s = String(dstr).slice(0, 10)
      if (tf === 'W') {
        const dt = new Date(`${s}T00:00:00Z`)
        if (isNaN(dt.getTime())) return s
        dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)) // → Monday of its ISO week
        return dt.toISOString().slice(0, 10)
      }
      if (tf === 'M') return s.slice(0, 7)   // YYYY-MM
      return s                                // daily: the exact day
    }
    const barByBucket = new Map()
    for (const b of filteredBars) barByBucket.set(bucket(b.t), b)
    const out = []
    const seen = new Set()
    for (const e of markersData.earnings) {
      if (!e.date) continue
      const bar = barByBucket.get(bucket(e.date))
      if (!bar) continue                      // no bar in that period (outside loaded range)
      const low = +bar.l
      if (!Number.isFinite(low) || seen.has(bar.t)) continue  // 1 badge/bar (≤1 report/period)
      seen.add(bar.t)
      // Position the badge at the BAR's time (not the raw report date, which isn't
      // a weekly/monthly bar key); the popup still shows the real report date via `data`.
      out.push({ date: bar.t, low, beat: e.beat, data: e })
    }
    return out
  }, [markersData, cs.markers?.earnings, resolvedTf, filteredBars])

  // Splits + dividends: snap each event date to its containing bar (same bucketing
  // as earnings) so they render as bottom-row "S"/"D" badges, one per bar.
  const _bucketEventDate = useCallback((dstr, tf) => {
    const s = String(dstr).slice(0, 10)
    if (tf === 'W') {
      const dt = new Date(`${s}T00:00:00Z`)
      if (isNaN(dt.getTime())) return s
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)) // → Monday of its ISO week
      return dt.toISOString().slice(0, 10)
    }
    if (tf === 'M') return s.slice(0, 7)   // YYYY-MM
    return s
  }, [])

  const splitEvents = useMemo(() => {
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!cs.markers?.splits || !Array.isArray(markersData?.splits) || !isDailyWeekly || !filteredBars?.length) return []
    const barByBucket = new Map()
    for (const b of filteredBars) barByBucket.set(_bucketEventDate(b.t, resolvedTf), b)
    const out = []
    const seen = new Set()
    for (const s of markersData.splits) {
      if (!s.date) continue
      const bar = barByBucket.get(_bucketEventDate(s.date, resolvedTf))
      if (!bar || seen.has(bar.t)) continue
      seen.add(bar.t)
      out.push({ date: bar.t, low: +bar.l, ratio: s.ratio })
    }
    return out
  }, [markersData, cs.markers?.splits, resolvedTf, filteredBars, _bucketEventDate])

  const dividendEvents = useMemo(() => {
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!cs.markers?.dividends || !Array.isArray(markersData?.dividends) || !isDailyWeekly || !filteredBars?.length) return []
    const barByBucket = new Map()
    for (const b of filteredBars) barByBucket.set(_bucketEventDate(b.t, resolvedTf), b)
    const out = []
    const seen = new Set()
    for (const d of markersData.dividends) {
      if (!d.date || d.amount == null) continue
      const bar = barByBucket.get(_bucketEventDate(d.date, resolvedTf))
      if (!bar || seen.has(bar.t)) continue
      seen.add(bar.t)
      out.push({ date: bar.t, low: +bar.l, amount: Number(d.amount) })
    }
    return out
  }, [markersData, cs.markers?.dividends, resolvedTf, filteredBars, _bucketEventDate])

  // ── Countdown to bar close — last bar start time + tf-seconds ──
  const currentBarStart = useMemo(() => {
    if (!filteredBars?.length) return null
    const last = filteredBars[filteredBars.length - 1]
    return typeof last?.t === 'number' ? last.t : null
  }, [filteredBars])
  const countdownTfSec = useMemo(() => {
    const map = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, 'D': 23400, 'W': null, 'M': null }
    return map[resolvedTf] || null
  }, [resolvedTf])

  // ── Unified keyboard shortcut handler ──
  // Uses matchShortcut() from chart/keyboardShortcuts.js as the single source
  // of truth. Covers timeframes, drawing tools, display toggles, indicator
  // toggles, replay controls, and the help overlay. Replaces the older
  // hand-rolled handler that lived here previously.
  // Bridge for Alt-key actions whose callbacks are defined later in the component
  // (the keydown effect is declared up here). Assigned each render further down.
  const altActionsRef = useRef({})
  const hotkeysActiveRef = useRef(hotkeysActive)
  hotkeysActiveRef.current = hotkeysActive
  // Repeat-press timeframe cycling: remembers which timeframe key was pressed
  // last and which rung of TF_ORDER it landed on. Per-instance (a ref, not
  // module state) so two chart widgets walk the ladder independently, and not
  // state because a cycle position must never trigger a re-render.
  const tfCycleRef = useRef({ command: null, index: null })
  // ⭐ ONE CONSUMER FOR ALL FOUR INDICATOR CHORDS (B4 Task 4).
  //
  // `Ctrl+I` / `Ctrl+O` / `Ctrl+B` arrive through `matchShortcut` as `toggle:<id>`
  // and `Alt+U` arrives through the `e.altKey` block below, because `matchShortcut`
  // rejects Alt. Two entry paths, ONE writer: `setIndicatorEnabled` is the writer
  // the toolbar checkbox, both right-click doors and the settings row already
  // share — it creates or TOMBSTONES the instance AND mirrors `cs.indicators.<id>`,
  // so a FLIPPED id's chart follows and an UN-FLIPPED id's legacy block still
  // reads the flag it has always read. Writing the raw flag is what made Alt+U
  // tick a box over a chart that disagreed (B3 Task 11).
  const toggleIndicatorById = useCallback((defId) => {
    const on = isIndicatorEnabled(cs, defId, ENGINE_OWNED)
    const next = setIndicatorEnabled(cs, defId, !on, engineRegistry)
    if (next !== cs) handleUpdateChartSettings(next)
  }, [cs, handleUpdateChartSettings])
  useEffect(() => {
    const onKey = (e) => {
      // Instance gate: multi-chart surfaces hand every cell this prop so only
      // the ACTIVE cell handles a keypress (otherwise 'D' retimes all N cells
      // and settings toggles fire N duplicate pref POSTs). Read via latest-ref
      // so the callback form costs zero re-subscribes and zero re-renders.
      const ha = hotkeysActiveRef.current
      if (typeof ha === 'function' ? !ha() : ha === false) return
      // Ignore when typing in inputs/textareas/contentEditable
      const target = e.target
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      // Alt-based chart toggles. Alt is rejected by matchShortcut (so browser
      // Alt shortcuts keep working), so these are handled here. Keyed on e.code
      // for layout independence (Mac emits special chars with Alt).
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        // The ALT indicator chords — today that is `Alt+U` → VWAP, and it is the
        // one chord `matchShortcut` can never deliver (it rejects Alt on its first
        // line, so `toggle:vwap` never reaches the switch below). Looked up in
        // `INDICATOR_CHORDS` rather than hand-written, so this block and the help
        // sheet cannot disagree about which key it is.
        //
        // ⛔ `modifier === 'alt'` IS LOAD-BEARING, not decoration. RSI's chord
        // code is `KeyI` — the same code as Alt+I (invert scale) below — so a
        // lookup on `code` alone would toggle RSI on Alt+I and never reach the
        // invert branch.
        const altChord = INDICATOR_CHORDS.find(c => c.modifier === 'alt' && c.code === e.code)
        if (!e.shiftKey && altChord) {
          e.preventDefault()
          toggleIndicatorById(altChord.defId)
          return
        }
        // Alt+Shift+W → toggle the symbol watermark.
        if (e.shiftKey && e.code === 'KeyW') {
          e.preventDefault()
          handleUpdateChartSettings({ ...cs, watermark: { ...cs.watermark, visible: !cs.watermark?.visible }, preset: 'custom' })
          return
        }
        // Alt+I → invert the price scale (flip upside-down).
        if (!e.shiftKey && e.code === 'KeyI') {
          e.preventDefault()
          handleUpdateChartSettings({ ...cs, invertScale: !cs.invertScale, preset: 'custom' })
          return
        }
        // Alt+, → open chart settings (workspace modal, when wired).
        if (!e.shiftKey && e.code === 'Comma' && typeof onOpenSettings === 'function') {
          e.preventDefault()
          onOpenSettings()
          return
        }
        // Alt+Shift+A → add indicator: opens the library dialog (B4 Task 7).
        // ORDER IS THE CONTRACT, not a preference. `openIndicatorLibrary`
        // returns false on a read-only mount site — it checks the same
        // `chartSettings && onUpdateSettings` pair the toolbar's button does, so
        // the chord and the button can never disagree about where the library
        // exists. Only a false answer falls through to the settings panel, which
        // is what this chord did before the dialog existed; swapping the order
        // would open a panel on top of a chart that has a library.
        if (e.shiftKey && e.code === 'KeyA') {
          let opened = false
          try { opened = toolbarRef.current?.openIndicatorLibrary() === true } catch { /* noop */ }
          if (opened) {
            e.preventDefault()
            return
          }
          if (typeof onOpenSettings === 'function') {
            e.preventDefault()
            onOpenSettings()
            return
          }
          // Neither door exists on this mount: do NOT preventDefault — swallowing
          // the key here would make Alt+Shift+A a silent no-op instead of falling
          // through to whatever else listens.
        }
        // Alt+G → open the go-to-date box.
        if (!e.shiftKey && e.code === 'KeyG') {
          e.preventDefault()
          setDateJumpOpen(true)
          return
        }
        // Alt+Shift+I → hide / show all indicators (declutter toggle).
        if (e.shiftKey && e.code === 'KeyI') {
          e.preventDefault()
          altActionsRef.current.toggleIndicatorsHidden?.()
          return
        }
        // Alt+Q → add the current ticker to a watchlist (quick picker).
        if (!e.shiftKey && e.code === 'KeyQ') {
          e.preventDefault()
          altActionsRef.current.openAddList?.()
          return
        }
        // Alt+N → drop a price alert at the cursor's price level.
        if (!e.shiftKey && e.code === 'KeyN') {
          e.preventDefault()
          altActionsRef.current.createAlertAtCursor?.()
          return
        }
        // Alt+S → download a PNG screenshot of the chart (LWC panes: candles,
        // volume, indicators). Drawing overlays are not composited in v1.
        if (!e.shiftKey && e.code === 'KeyS') {
          const chart = chartRef.current
          if (chart && typeof chart.takeScreenshot === 'function') {
            e.preventDefault()
            try {
              const canvas = chart.takeScreenshot()
              canvas.toBlob((blob) => {
                if (!blob) return
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${sym || 'chart'}_${resolvedTf || ''}.png`
                document.body.appendChild(a); a.click(); a.remove()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              })
            } catch { /* screenshot unsupported */ }
          }
          return
        }
      }

      // Zoom the time axis around its center: + / = zoom in, - zoom out.
      if ((e.key === '+' || e.key === '=' || e.key === '-') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const chart = chartRef.current
        if (chart) {
          let r = null; try { r = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
          if (r && r.to > r.from) {
            e.preventDefault()
            const center = (r.to + r.from) / 2
            const half = ((r.to - r.from) * (e.key === '-' ? 1.25 : 0.8)) / 2
            try { chart.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half }) } catch { /* transient */ }
          }
        }
        return
      }

      const cmd = matchShortcut(e)
      if (!cmd) return

      if (cmd === 'help') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      if (cmd.startsWith('tf:')) {
        // Holding the key auto-repeats ~30x/sec; without this guard each repeat
        // would advance a rung and fire a bars fetch.
        if (e.repeat) return
        if (typeof onTfChange !== 'function') return
        const next = resolveTfCycle({
          command: cmd,
          currentTf: resolvedTf,
          lastCommand: tfCycleRef.current.command,
          lastIndex: tfCycleRef.current.index,
        })
        if (!next) return
        e.preventDefault()
        tfCycleRef.current = { command: cmd, index: next.index }
        onTfChange(next.tf)
        return
      }

      if (cmd.startsWith('tool:')) {
        if (!showDrawingTools) return
        const tool = cmd.slice(5)
        e.preventDefault()
        if (tool === 'cursor') {
          // Escape / V — clear active tool (returns to default cursor)
          setActiveTool(null)
        } else {
          setActiveTool(t => t === tool ? null : tool)
        }
        return
      }

      if (cmd.startsWith('toggle:')) {
        const target = cmd.slice(7)
        e.preventDefault()
        const updateField = (key, value) => {
          handleUpdateChartSettings({ ...cs, [key]: value, preset: 'custom' })
        }
        // ⭐ EVERY INDICATOR CHORD LEAVES BEFORE THE SWITCH. `case 'rsi'` /
        // `case 'macd'` / `case 'bb'` were three cases calling one local helper
        // that wrote `cs.indicators[key].enabled` raw for an un-flipped id; the
        // helper is DELETED rather than left guarded, because an inert helper
        // reads as live logic. `ma` and `volume` stay cases — neither is a
        // definition, so neither has an instance to write.
        const chord = INDICATOR_CHORDS.find(c => c.defId === target)
        if (chord) { toggleIndicatorById(target); return }
        switch (target) {
          case 'log': updateField('logScale', !cs.logScale); break
          case 'theme': updateField('theme', cs.theme === 'light' ? 'dark' : 'light'); break
          case 'countdown': updateField('countdown', !cs.countdown); break
          case 'ma': {
            // Toggle all moving-average overlays at once. If any are on, turn
            // them all off; otherwise turn them all on.
            const overlays = Array.isArray(cs.overlays) ? cs.overlays : []
            const anyEnabled = overlays.some(o => o?.enabled)
            const next = overlays.map(o => ({ ...o, enabled: !anyEnabled }))
            handleUpdateChartSettings({ ...cs, overlays: next, preset: 'custom' })
            break
          }
          case 'volume':
            handleUpdateChartSettings({
              ...cs,
              volume: { ...cs.volume, visible: !cs.volume?.visible },
              preset: 'custom',
            })
            break
          default: break
        }
        return
      }

      if (cmd.startsWith('replay:')) {
        if (!replayMode) return
        const action = cmd.slice(7)
        e.preventDefault()
        switch (action) {
          case 'playpause':
            setReplayPlaying(p => !p)
            break
          case 'back':
            setReplayPlaying(false)
            setReplayIndex(i => Math.max(0, (i ?? 0) - 1))
            break
          case 'forward':
            setReplayPlaying(false)
            setReplayIndex(i => Math.min((sessionBars?.length || 1) - 1, (i ?? 0) + 1))
            break
          default: break
        }
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // `toggleIndicatorById` is memoised on `[cs, handleUpdateChartSettings]`, both
    // of which are already deps here — so naming it re-subscribes the listener
    // exactly as often as this effect already did, and never more.
  }, [cs, onTfChange, showDrawingTools, replayMode, sessionBars?.length, handleUpdateChartSettings, resolvedTf, onOpenSettings, toggleIndicatorById])

  // Apply the inverted price scale (Alt+I) — on toggle and on chart (re)creation.
  useEffect(() => {
    if (!chartReady) return
    try { mainPriceScale()?.applyOptions({ invertScale: !!cs.invertScale }) } catch { /* disposed */ }
  }, [cs.invertScale, chartReady, mainPriceScale])

  // Double-click the price axis → reset it to auto-scale (after a manual drag).
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady) return undefined
    const onDbl = (e) => {
      const chart = chartRef.current
      if (!chart) return
      let axisW = 0; try { axisW = chart.priceScale('right').width() || 0 } catch { /* no axis */ }
      const r = el.getBoundingClientRect()
      if (axisW > 0 && (e.clientX - r.left) >= r.width - axisW - 2) {
        try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* disposed */ }
      }
    }
    el.addEventListener('dblclick', onDbl)
    return () => el.removeEventListener('dblclick', onDbl)
  }, [chartReady, mainPriceScale])

  // ── Replay auto-advance interval ──
  useEffect(() => {
    if (!replayPlaying || !replayMode) return
    const intervalMs = replaySpeed === 20 ? 50 : replaySpeed === 5 ? 100 : 500
    const id = setInterval(() => {
      setReplayIndex(idx => {
        const maxIdx = (sessionBars?.length || 1) - 1
        if (idx >= maxIdx) { setReplayPlaying(false); return idx }
        return idx + 1
      })
    }, intervalMs)
    return () => clearInterval(id)
  }, [replayPlaying, replayMode, replaySpeed, sessionBars?.length])

  // ── Reset replay when sym/tf changes ──
  useEffect(() => {
    setReplayMode(false)
    setReplayPlaying(false)
    setReplayIndex(null)
  }, [sym, resolvedTf])

  // Extended-hours preview: in include-mode (pre/post market on the workspace),
  // append a new pre-market candle or extend today's candle from the ext-hours
  // aggregate + live ext price. filteredBars stays pure (regular-session only);
  // the synthetic bar rides only the candle/volume/overlay data path so the
  // green tag can read the true RTH close off filteredBars. When the toggle
  // flips off (or the 9:30 bell auto-reverts it) this is a no-op.
  const sessionAppliedBars = useMemo(() => {
    if (!sessionCandleActive || !filteredBars?.length) return filteredBars
    // Wait for THIS symbol's ext-hours aggregate before painting anything. The live
    // ext price lands almost immediately (warm shared live-prices cache) while the
    // aggregate is a per-symbol fetch (~1s). Painting on price alone gives
    // applySessionCandle nothing to build a range from, so it collapses to o=h=l=c:
    // a flat doji at the live price that visibly grows its body + wicks when the
    // aggregate arrives — on every ticker open/search. One late-but-complete candle
    // beats a fast wrong one. (Post-market has the same tell: h/l would jump.)
    if (!sessionExtReady) return filteredBars
    // During pre/post (incl. overnight) anchor the session candle to the trading
    // day the extended data belongs to — so at 2am we extend YESTERDAY's daily bar
    // with its post-market prints, not spawn a new (empty) calendar-today bar.
    const _curSec = (marketSession === 'pre' || marketSession === 'post')
      ? anchorNoonSec(_extSess.anchorDate)
      : Date.now() / 1000
    const curTime = computeBarTime(resolvedTf, _curSec)
    return applySessionCandle(filteredBars, { curTime, extAgg: sessionExtAgg, extPrice: sessionExtPrice })
  }, [filteredBars, sessionCandleActive, resolvedTf, sessionExtAgg, sessionExtPrice, sessionExtReady])

  // The pre-market "include pre-market" preview candle is painted a muted white so it
  // reads as a not-yet-real preview of where the stock sits on pre-market prints; at
  // 9:30 the toggle auto-reverts and the real red/green daily candle takes over.
  // Keyed on the candle having actually been APPLIED, not merely on the toggle being
  // on: while the aggregate is still loading (above) the last bar is YESTERDAY's real
  // RTH candle, and whiting that out for a second is exactly the flash we're killing.
  const sessionPreviewLastBar = sessionCandleActive && marketSession === 'pre'
    && sessionAppliedBars !== filteredBars

  const displayBars = useMemo(() => {
    if (!sessionAppliedBars?.length) return sessionAppliedBars
    return cs.heikinAshi ? toHeikinAshi(sessionAppliedBars) : sessionAppliedBars
  }, [sessionAppliedBars, cs.heikinAshi])

  // Right-axis session tags — green locked at the last RTH close (from the pure
  // regular-session bars) + orange Pre/Post tag at the live ext price. Merged
  // into the price-line applier via allPriceLines below.
  const sessionTagLines = useMemo(() => {
    if (!sessionTagsActive || !filteredBars?.length) return null
    const effUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor
    const effDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor
    return computeSessionTagLines({
      rthBars: filteredBars, session: marketSession, extPrice: sessionExtPrice,
      upColor: effUp, downColor: effDown, extColor: SESSION_EXT_COLOR,
    })
  }, [sessionTagsActive, filteredBars, marketSession, sessionExtPrice, boldCandles, modelBookLook, cs.candles.upColor, cs.candles.downColor])

  // Intraday (1m..1h) version of the Pre/Post tag. ONE tag only, by owner request:
  // during pre/post the price scale carries just the orange Pre/Post price — no
  // green last-price tag (suppressed below via `lastValueVisible`) and no green
  // prev-close tag. Three stacked labels on top of each other were unreadable on a
  // narrow widget, and only one of the three is the number that matters right now.
  // At 9:30 `_inExtWindow` goes false, this returns null, and the normal last-price
  // label comes straight back. D/W/M keeps BOTH tags (locked close + Pre/Post) —
  // that's the session-preview design and it has room for them.
  // PERF: deps are the SCALARS this actually reads, deliberately NOT `_sessionLive`.
  // `_sessionLive` is `livePrices[sym]` — a freshly-allocated object on every quote
  // publish (~1/s) — so depending on it churned this array's identity every tick,
  // which churned `allPriceLines`, which churned `updateChart`, which re-ran the
  // whole ~1900-line repaint body once a second in extended hours (the reported
  // pre-market crosshair/pan stutter). `sessionExtPrice` is null unless
  // `_sessionLive` exists, so the object check it replaced was redundant anyway.
  const intradaySessionTagLines = useMemo(() => {
    if (!sessionTagsIntraday) return null
    // Seed price only. The chip's live PRICE is driven by the rAF sync effect below,
    // which glues it to the developing candle's drawn close (liveBarRef) so the chip
    // and candle move in unison regardless of which feed/clock paints the bar. This
    // per-tick memo just keeps the chip existing + titled; it must NOT fight the rAF
    // on price (the effect that applies it skips `price` for this tag — see below).
    const extPx = sessionExtPrice
    if (!Number.isFinite(extPx) || extPx <= 0) return null
    return [{
      price: extPx, color: SESSION_EXT_COLOR, lineWidth: 1, lineStyle: 0,
      axisLabelVisible: true, lineVisible: false,
      title: marketSession === 'post' ? 'Post' : 'Pre', _sessionTag: 'ext',
    }]
  }, [sessionTagsIntraday, sessionExtPrice, marketSession])

  // The dynamic session tags (daily OR intraday — mutually exclusive by timeframe).
  // These are applied by their OWN effect below, NOT folded into `allPriceLines`:
  // they move with the live ext price, and the price-line applier inside
  // updateChart is reference-guarded, so sharing one array meant every ext-price
  // change dragged the entire repaint body along with it.
  const activeSessionTags = sessionTagLines?.length ? sessionTagLines
    : (intradaySessionTagLines?.length ? intradaySessionTagLines : null)

  // User/journal price lines only — stable across live ticks.
  const allPriceLines = mergedPriceLines

  const ohlcData = useMemo(
    () => {
      if (!displayBars) return []
      const arr = displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c }))
      // Sunrise: an INSIDE BAR (its whole high–low sits within the PREVIOUS bar's
      // high–low, wicks included) is painted solid black regardless of direction.
      // Data-level (uses displayBars directly) so it's deterministic for every bar,
      // including today's developing bar. The net-change paint wrapper preserves an
      // explicit color, so this black survives.
      if (canvasTheme === 'sunrise') {
        for (let i = 1; i < arr.length; i++) {
          const cur = arr[i], prev = arr[i - 1]
          if (cur.high != null && cur.low != null && prev.high != null && prev.low != null
              && cur.high <= prev.high && cur.low >= prev.low) {
            arr[i] = { ...cur, color: '#000000', borderColor: '#000000', wickColor: '#000000' }
          }
        }
      }
      // Paint the pre-market preview candle (the appended last bar) in the user's
      // chosen up/down candle color (owner ask — was a muted white). "Up" = the
      // pre-market price sits above the prior RTH close (net-change basis, what a
      // trader means by up/down in pre-market), falling back to open/close.
      if (sessionPreviewLastBar && arr.length) {
        const i = arr.length - 1
        const c = arr[i]
        const effUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor
        const effDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor
        const prevC = i > 0 ? arr[i - 1].close : c.open
        const isUp = (c.close != null && prevC != null) ? c.close >= prevC : (c.close >= c.open)
        const bodyCol = isUp ? effUp : effDown
        // Match the user's SEPARATE border + wick colors too (same derivation as the
        // live candle series options), not just the body color — falls back to the
        // body color when no distinct border/wick is set or on bold/Model-Book looks.
        const borCol = userCandleColors ? (isUp ? (cs.candles.upBorder || bodyCol) : (cs.candles.downBorder || bodyCol)) : bodyCol
        const wickCol = userCandleColors ? (isUp ? (cs.candles.upWick || bodyCol) : (cs.candles.downWick || bodyCol)) : bodyCol
        arr[i] = { ...c, color: bodyCol, borderColor: borCol, wickColor: wickCol }
      }
      return arr
    },
    [displayBars, adjustTime, sessionPreviewLastBar, canvasTheme, boldCandles, modelBookLook, mbUp, mbDown, userCandleColors, cs.candles.upColor, cs.candles.downColor, cs.candles.upBorder, cs.candles.downBorder, cs.candles.upWick, cs.candles.downWick]
  )
  // MarketSurge-style swing high/low pivots — recompute only when the data,
  // sensitivity, or timeframe changes (not per render or live tick). Forming
  // right-edge bars are never pivots, so live updates can't make labels flicker.
  // Swing labels are a Daily/Weekly/Monthly feature only — the pivots are noise on
  // intraday bars (1m..1h), so gate them off there regardless of the toggle.
  const swingLabelsOn = !!cs.swingLabels?.enabled && _isDWM
  const swingSensitivity = cs.swingLabels?.sensitivity || 'medium'
  const swingPoints = useMemo(
    () => swingLabelsOn ? detectSwingPivots(ohlcData, sensitivityToParams(swingSensitivity, resolvedTf)) : [],
    [swingLabelsOn, swingSensitivity, resolvedTf, ohlcData]
  )
  swingPointsRef.current = swingPoints  // expose to the (later-defined) screenshot builder
  // Gold-tinted copy with the highlighted bar(s) (Model Book: the focused
  // setup's day, or — with "show all" on — every setup's day) painted gold.
  // Kept separate from ohlcData so updateChart's normal setData path (and every
  // other chart) is untouched — the dedicated effect below applies/clears the
  // gold with a candle-only setData (no full re-render). highlightBarTime accepts
  // a single ISO/time value or an array of them.
  // Resolve each highlight date to the ACTUAL bar time present in the series.
  // On daily/intraday the setup day equals a bar time exactly. On WEEKLY/MONTHLY
  // the setup day falls INSIDE a multi-day bar (the provider anchors the bar at
  // the period start, so the exact daily date is never a bar time) — resolve to
  // the enclosing bar (largest bar time <= the date) so the setup candle still
  // paints white. Without this, weekly/monthly examples lost the highlight.
  const highlightResolved = useMemo(() => {
    if (highlightBarTime == null) return null
    const arr = Array.isArray(highlightBarTime) ? highlightBarTime : [highlightBarTime]
    const times = ohlcData.map(d => d.time)
    const exact = new Set(times)
    const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
      ? a - b
      : (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    const out = []
    for (const raw of arr) {
      if (raw == null) continue
      const target = adjustTime(raw)
      if (exact.has(target)) { out.push({ time: target, orig: raw }); continue }
      // No exact bar: resolve to the ENCLOSING bar (largest bar time <= the date). Covers
      // W/M period-interior days AND a daily start-marker date that lands on a weekend/holiday
      // (exact still wins for real trading days, so Model Book setups are unaffected).
      let best = null
      for (const t of times) if (cmp(t, target) <= 0 && (best == null || cmp(t, best) > 0)) best = t
      if (best != null) out.push({ time: best, orig: raw })
    }
    return out.length ? out : null
  }, [highlightBarTime, adjustTime, ohlcData, resolvedTf])
  const highlightTimeSet = useMemo(
    () => highlightResolved ? new Set(highlightResolved.map(e => e.time)) : null,
    [highlightResolved],
  )
  // Reverse map: the chart-space (adjusted) time of each highlighted candle back
  // to the ORIGINAL date string passed in — so a click on a setup candle can be
  // resolved to the YYYY-MM-DD used to fetch that day's intraday bars.
  const highlightTimeMap = useMemo(() => {
    if (!highlightResolved) return null
    const m = new Map()
    for (const e of highlightResolved) m.set(e.time, e.orig)
    return m.size ? m : null
  }, [highlightResolved])
  const goldOhlc = useMemo(() => {
    if (!highlightTimeSet) return ohlcData
    return ohlcData.map(d => (highlightTimeSet.has(d.time)
      // Body-only leaves borderColor/wickColor unset so the highlighted candle keeps the
      // chart's own border + wick colors (owner wants the gold START candle to have the
      // same black border/wick as every other candle); Model Book paints all three.
      ? (highlightBodyOnly
          ? { ...d, color: highlightColor }
          : { ...d, color: highlightColor, borderColor: highlightColor, wickColor: highlightColor })
      : d))
  }, [ohlcData, highlightTimeSet, highlightColor, highlightBodyOnly])

  // Setup⇄Result candle crossfade. The bars PAST the highlighted setup day fade
  // in (Setup→Result) / out (Result→Setup) instead of popping. Cutoff = the
  // latest highlighted (setup) day; direction is driven off exitDate moving
  // later (fade in) or earlier (fade out). Inert unless candleFrameFade is set,
  // and a no-op at full opacity (steady state), so no other chart is touched.
  const [frameFadeAlpha, setFrameFadeAlpha] = useState(1)
  const fadeRafRef = useRef(null)
  const prevFadeExitRef = useRef(undefined)
  const fadeCutoff = useMemo(() => {
    if (!candleFrameFade || !highlightResolved?.length) return null
    return highlightResolved.reduce((m, e) => (m == null || String(e.time) > String(m) ? e.time : m), null)
  }, [candleFrameFade, highlightResolved])
  useLayoutEffect(() => {
    if (!candleFrameFade) return
    const prev = prevFadeExitRef.current
    prevFadeExitRef.current = exitDate
    if (prev === undefined || prev === exitDate) { setFrameFadeAlpha(1); frameFadeAlphaRef.current = 1; return }
    const fadeIn = String(exitDate ?? '') > String(prev ?? '')   // window grew → reveal the result run
    const from = fadeIn ? 0 : 1, to = fadeIn ? 1 : 0
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current)
    // Drive the candle/volume/MA-tail crossfade IMPERATIVELY (ref + direct setData
    // in the rAF tick) instead of through React state. Calling setFrameFadeAlpha on
    // every frame forced a full re-render of this (large) component + a rebuild of
    // the whole OHLC/volume arrays + a setData on every frame — and that ran
    // concurrently with the zoom glide's OWN rAF loop, so frames dropped and the
    // Setup⇄Result transition felt choppy. Here only the ref moves per frame; React
    // state is settled ONCE at the end so the steady-state memos/effects stay
    // correct. Duration matches the zoom glide (900ms) so motion + colour land
    // together instead of the colour finishing ~180ms early. Inputs (goldOhlc /
    // volData / fadeCutoff / highlightTimeSet / overlayData) are stable across a
    // flip (same example, same bars), captured fresh each time this re-runs.
    frameFadeAlphaRef.current = from   // sync before any updateChart overlay repaint in this commit reads it
    const cut = fadeCutoff == null ? null : String(fadeCutoff)
    const buildCandles = a => (cut == null ? goldOhlc : goldOhlc.map(d => {
      if (highlightTimeSet?.has(d.time) || String(d.time) <= cut) return d
      const col = _candleRgba(d.close >= d.open, a)
      return { ...d, color: col, borderColor: col, wickColor: col }
    }))
    const buildVol = a => (cut == null ? volData : volData.map(d => (String(d.time) <= cut ? d : { ...d, color: colorMulAlpha(d.color, a) })))
    const paint = a => {
      frameFadeAlphaRef.current = a
      try { candleSeriesRef.current?.setData(a >= 1 ? goldOhlc : buildCandles(a)) } catch { /* range out of bounds mid-load */ }
      try { volumeSeriesRef.current?.setData(a >= 1 ? volData : buildVol(a)) } catch { /* range out of bounds mid-load */ }
      const tails = overlayTailSeriesRefs.current
      for (let i = 0; i < tails.length; i++) {
        const base = overlayData?.[i]?.color
        if (tails[i] && base) { try { tails[i].applyOptions({ color: colorWithAlpha(base, a) }) } catch { /* disposed mid-anim */ } }
      }
      if (volMaTailSeriesRef.current) { try { volMaTailSeriesRef.current.applyOptions({ color: colorMulAlpha(VOL_MA_COLOR, a) }) } catch { /* disposed mid-anim */ } }
    }
    const t0 = performance.now(), dur = 900
    const ease = x => -(Math.cos(Math.PI * x) - 1) / 2
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      paint(from + (to - from) * ease(p))
      if (p < 1) fadeRafRef.current = requestAnimationFrame(tick)
      else { fadeRafRef.current = null; setFrameFadeAlpha(to) }   // settle React steady state once, at the end
    }
    fadeRafRef.current = requestAnimationFrame(tick)
    return () => { if (fadeRafRef.current) { cancelAnimationFrame(fadeRafRef.current); fadeRafRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captured inputs are stable across a Setup⇄Result flip; re-running only on exitDate keeps the fade in lockstep with the frame change
  }, [exitDate, candleFrameFade])
  // Apply the crossfade alpha to the post-setup bars. Untouched at full opacity.
  const fadedOhlc = useMemo(() => {
    if (!candleFrameFade || frameFadeAlpha >= 1 || fadeCutoff == null) return goldOhlc
    const a = Math.max(0, Math.min(1, frameFadeAlpha))
    const cut = String(fadeCutoff)
    return goldOhlc.map(d => {
      if (highlightTimeSet?.has(d.time) || String(d.time) <= cut) return d
      const col = _candleRgba(d.close >= d.open, a)
      return { ...d, color: col, borderColor: col, wickColor: col }
    })
  }, [goldOhlc, candleFrameFade, frameFadeAlpha, fadeCutoff, highlightTimeSet])
  const closeData = useMemo(
    () => {
      if (!displayBars) return []
      const isLineArea = cs.chartType === 'line' || cs.chartType === 'area'
      const mode = cs.candleColorMode || 'netchange'
      // Per-segment green/red for line & area in net-change / open-close modes. One
      // color (and every non-line/area type) stays a plain value series.
      if (!isLineArea || mode === 'onecolor') {
        return displayBars.map(b => ({ time: adjustTime(b.t), value: b.c }))
      }
      let prevClose = null
      return displayBars.map(b => {
        let up
        if (mode === 'netchange') up = prevClose == null ? true : b.c >= prevClose
        else up = (b.o != null) ? b.c >= b.o : true
        prevClose = b.c
        const col = up ? mbUp : mbDown
        // `color` is read by LineSeries, `lineColor` by AreaSeries — set both.
        return { time: adjustTime(b.t), value: b.c, color: col, lineColor: col }
      })
    },
    [displayBars, adjustTime, cs.chartType, cs.candleColorMode, mbUp, mbDown],
  )
  const hvcSet = useMemo(
    () => cs.volume.hvcEnabled && !disableHvc && filteredBars?.length > 20 ? computeHVC(filteredBars) : new Set(),
    [filteredBars, cs.volume.hvcEnabled, disableHvc]
  )
  // Highest-Volume-Ever bar (across all loaded bars). Coloured gold, no label —
  // only highlighted when it falls within the visible year.
  const volExtremes = useMemo(() => {
    if (!markVolumeExtremes || !filteredBars?.length) return null
    const inYear = b => (!entryDate || b.t >= entryDate) && (!exitDate || b.t <= exitDate)
    let hve = null
    for (const b of filteredBars) if (b.v != null && (!hve || b.v > hve.v)) hve = b
    if (!hve || !inYear(hve)) return null
    return { goldTimes: new Set([hve.t]) }
  }, [markVolumeExtremes, filteredBars, entryDate, exitDate])
  // Live day volume for THIS symbol (RTH day.v / pre-market aggregate). Used to
  // keep the developing volume bar + its pane label live instead of frozen at the
  // slow-SWR fetched value (which lagged the watchlist by millions intraday).
  const liveVolForSym = Number(livePrices?.[sym]?.volume)
  const volData = useMemo(() => {
    if (!sessionAppliedBars?.length) return []
    // Volume bars track the candle palette EXACTLY so the red/green of the
    // volume pane matches the red/green of the candles above it (a dimmed alpha
    // composites darker over the near-black canvas and reads as a mismatched hue).
    const upC = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
    const downC = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
    const gold = '#e6b800'
    const lastIdx = sessionAppliedBars.length - 1
    return sessionAppliedBars.map((b, i) => {
      // Up/down follows the SAME rule as the candles: net change (close vs the
      // PREVIOUS close) when colorByNetChange is on, else close-vs-open. This is
      // why a gap-up-then-fade day (AEHR +22% on the day but red open→close) shows
      // a GREEN volume bar — it's up on net change. First bar has no prior close.
      const prevC = i > 0 ? sessionAppliedBars[i - 1].c : b.o
      const isUp = colorByNetChange ? (b.c >= prevC) : (b.c >= b.o)
      // Developing (last) bar: prefer the live feed volume when it's ahead of the
      // fetched value (intraday volume only grows), so the pane tracks the
      // watchlist in real time. Historical bars keep their own volume.
      // Overlay the live DAY volume ONLY on D/W/M (where the developing bar spans
      // the whole day). On intraday the day total is NOT the bucket's volume —
      // overlaying it painted the day's ~30M onto the developing 5m/1m bar (the
      // phantom volume spike). Intraday per-bar live volume rides the push feed
      // (Writer B writes data.bar.v; Writer D re-tops from liveBarRef.volume).
      const useLiveDayVol = ['D', 'W', 'M'].includes(resolvedTf) &&
        Number.isFinite(liveVolForSym) && liveVolForSym > (b.v || 0)
      const value = (i === lastIdx && useLiveDayVol) ? liveVolForSym : b.v
      return {
        time: adjustTime(b.t),
        value,
        color: volExtremes?.goldTimes.has(b.t)        // HVE / HV1 bars → gold
          ? gold
          : (!boldCandles && hvcSet.has(b.t))         // legacy HVC highlight
            ? 'rgba(201,168,76,0.9)'
            : isUp ? upC : downC,
      }
    })
  }, [sessionAppliedBars, hvcSet, cs.volume.upColor, cs.volume.downColor, adjustTime, boldCandles, modelBookLook, volExtremes, colorByNetChange, canvasTheme, liveVolForSym, resolvedTf])
  // Volume bars past the setup day crossfade with the candles on Setup⇄Result
  // (each bar's existing alpha scaled by the fade). No-op at full opacity. The
  // re-tint effect lives AFTER updateChart (below) so its setData wins over
  // updateChart's full-opacity volume paint — otherwise the bars flicker.
  const fadedVolData = useMemo(() => {
    if (!candleFrameFade || frameFadeAlpha >= 1 || fadeCutoff == null) return volData
    const a = Math.max(0, Math.min(1, frameFadeAlpha)), cut = String(fadeCutoff)
    return volData.map(d => (String(d.time) <= cut ? d : { ...d, color: colorMulAlpha(d.color, a) }))
  }, [volData, candleFrameFade, frameFadeAlpha, fadeCutoff])
  // Smooth N-SMA line for the volume pane (subtle, white).
  const volMaData = useMemo(() => {
    if (!volMaPeriodEff || volMaPeriodEff < 2 || !sessionAppliedBars?.length) return []
    const out = []
    const q = []
    let sum = 0
    for (const b of sessionAppliedBars) {
      const v = b.v || 0
      q.push(v); sum += v
      if (q.length > volMaPeriodEff) sum -= q.shift()
      if (q.length === volMaPeriodEff) out.push({ time: adjustTime(b.t), value: sum / volMaPeriodEff })
    }
    return out
  }, [sessionAppliedBars, volMaPeriodEff, adjustTime])
  const overlayData = useMemo(() => {
    if (!sessionAppliedBars?.length || !resolvedOverlays?.length) return []
    return resolvedOverlays.map(ov => {
      const raw = ov.type === 'EMA'
        ? computeEMA(sessionAppliedBars, ov.period, overlaysFromStart)
        : computeSMA(sessionAppliedBars, ov.period, overlaysFromStart)
      return { data: raw.map(p => ({ time: adjustTime(p.time), value: p.value })), color: ov.color }
    })
  }, [sessionAppliedBars, resolvedOverlays, adjustTime, overlaysFromStart])
  // Drive the MA tail opacity each frame of the Setup⇄Result crossfade (the
  // overlay loop in updateChart owns the tail DATA; this only re-tints it as the
  // alpha animates). No-op for charts that don't fade.
  useEffect(() => {
    if (!candleFrameFade) return
    const tails = overlayTailSeriesRefs.current
    for (let i = 0; i < tails.length; i++) {
      const base = overlayData?.[i]?.color
      if (tails[i] && base) { try { tails[i].applyOptions({ color: colorWithAlpha(base, frameFadeAlpha) }) } catch { /* disposed mid-anim */ } }
    }
    if (volMaTailSeriesRef.current) {
      try { volMaTailSeriesRef.current.applyOptions({ color: colorMulAlpha(VOL_MA_COLOR, frameFadeAlpha) }) } catch { /* disposed mid-anim */ }
    }
  }, [frameFadeAlpha, candleFrameFade, overlayData])

  // ⛔⭐ THE `indicatorData` MEMO STOOD HERE, AND B5 TASK 8 DELETED THE WHOLE OF
  // IT — the ledger row *"the indicatorData memo — compute calls + shape
  // mapping"* retires with it.
  //
  // It was the hand-written lane's compute stage: for each un-migrated native it
  // read `cs.indicators.<id>.enabled`, called that native's `compute*` with the
  // stored period, and mapped the result into LWC point arrays through `indPoint`
  // and `adjustTime`. Every one of those steps now happens once, inside the
  // engine: `nativeRegistry.computeFor` calls the SAME function from the SAME
  // `filteredBars`, `binder.js`'s `toPoints` does the whitespace conversion, and
  // the binder threads the same `adjustTime`. There is nothing left to compute
  // here, and a `compute*` call reappearing in this file is a silent duplicate
  // whose only observable effect is CPU.
  //
  // ⚠️ ITS DEPENDENCY ARRAY OUTLIVED ITS BODY BY THREE TASKS, WHICH IS WORTH
  // RECORDING RATHER THAN QUIETLY DROPPING. The last version read
  // `[filteredBars, cs.indicators, resolvedTf, adjustTime, vwapOverride]` while
  // the body referenced only the first, second and fourth: `resolvedTf` and
  // `vwapOverride` had been dead deps since B3 Task 11 deleted the VWAP branch
  // that read them. They are checked, not assumed, before this deletion —
  // `vwapOverride` in particular has its own forced-instance path (`:5908`, which
  // Model Book's `IntradayDayPopover` depends on and which B3 Task 11 nearly
  // broke for every user), and it does NOT route through this memo. `grep -n
  // "indicatorData" StockChart.jsx` returns nothing but this paragraph.
  //
  // ⛔ AND THE MACD HEAD-MASK IS NOT AFFECTED. `MACD_HEAD_MASK` lost its second
  // reader at B3 Task 11 (`docs/decisions/2026-08-02-macd-head-mask.md`);
  // `nativeRegistry`'s `COLUMN_HOLDS` has been its only one since.

  // ── Comparison symbol % return data ──
  const comparisonData = useMemo(() => {
    const cmpBars = compareData?.bars || (Array.isArray(compareData) ? compareData : null)
    if (!cmpBars?.length || !filteredBars?.length) return []
    // Build a timestamp-keyed map for the comparison symbol
    const cmpMap = new Map(cmpBars.map(b => [b.t, b.c]))
    // Find the first filteredBar date that exists in comparison data
    let baseCmp = null
    for (const bar of filteredBars) {
      if (cmpMap.has(bar.t)) {
        baseCmp = cmpMap.get(bar.t)
        break
      }
    }
    if (!baseCmp) return []
    // Build % return series aligned to filteredBars timeline
    const result = []
    for (const bar of filteredBars) {
      const cmpClose = cmpMap.get(bar.t)
      if (cmpClose != null) {
        result.push({
          time: adjustTime(bar.t),
          value: parseFloat(((cmpClose / baseCmp - 1) * 100).toFixed(3)),
        })
      }
    }
    return result
  }, [compareData, filteredBars, adjustTime])

  // ── Multi-symbol comparison overlays (cs.comparisonSymbols) ──
  // Independent of legacy single-symbol compareSymbol. Each enabled comparison
  // is fetched in parallel, normalized to % change from first valid close, and
  // drawn on a dedicated 'comparison' price scale (left side).
  const enabledComparisons = useMemo(
    () => (cs.comparisonSymbols || []).filter(c => c && c.enabled && c.sym),
    [cs.comparisonSymbols]
  )
  // Stable cache key: sorted sym list + tf + barCount. Sorted so reorder doesn't refetch.
  const comparisonsKey = useMemo(
    () => enabledComparisons.map(c => String(c.sym).toUpperCase()).sort().join(',') || null,
    [enabledComparisons]
  )
  const { data: comparisonsData } = useSWR(
    comparisonsKey ? ['comparison-bars', comparisonsKey, resolvedTf, barCount] : null,
    async () => {
      const syms = enabledComparisons.map(c => String(c.sym).toUpperCase())
      const results = await Promise.allSettled(
        syms.map(s =>
          fetch(`/api/bars/${encodeURIComponent(s)}?tf=${resolvedTf}&bars=${barCount}`)
            .then(r => (r.ok ? r.json() : { bars: [] }))
            .catch(() => ({ bars: [] }))
        )
      )
      const out = {}
      results.forEach((r, i) => {
        out[syms[i]] = r.status === 'fulfilled' ? (r.value?.bars || []) : []
      })
      return out
    },
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  )

  // Per-enabled-comparison normalized {time, value} points with adjustTime applied.
  const comparisonSeries = useMemo(() => {
    if (!comparisonsData) return []
    return enabledComparisons.map(c => {
      const symKey = String(c.sym).toUpperCase()
      const rawBars = comparisonsData[symKey] || []
      const points = normalizeToPctChange(
        rawBars.map(b => ({ t: adjustTime(b.t), c: b.c }))
      )
      return { sym: symKey, color: c.color, points }
    })
  }, [comparisonsData, enabledComparisons, adjustTime])

  // ── Index comparison pane (indexPaneSymbol, e.g. ^IXIC) ──
  // Fetch the index's bars for the same tf + bar count and draw its CLOSE as a
  // line in a dedicated pane on top of the price pane. Unlike the % comparison
  // overlay, this is its own auto-scaled pane (the shape is what matters for
  // spotting relative strength). Indices route through yfinance server-side.
  const { data: indexPaneData } = useSWR(
    indexPaneSymbol ? ['index-pane-bars', String(indexPaneSymbol).toUpperCase(), resolvedTf, barCount] : null,
    async () => {
      const s = String(indexPaneSymbol).toUpperCase()
      const res = await fetch(`/api/bars/${encodeURIComponent(s)}?tf=${resolvedTf}&bars=${barCount}`)
        .then(r => (r.ok ? r.json() : { bars: [] }))
        .catch(() => ({ bars: [] }))
      return res?.bars || []
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )
  // Keep ONLY index points whose time exists in the stock's own bars. The index
  // series shares the chart's logical time scale; if it added points the stock
  // lacks, those extra positions would shift every candle's logical index. That
  // breaks reused/gappy tickers hard: e.g. SNDK (SanDisk delisted 2016 →
  // relisted 2025) has a multi-year hole that ^IXIC fills with continuous data —
  // those gap points expanded the logical space so the year-framing (computed
  // from the stock's gap-less bar array) landed IN the gap, showing an empty
  // chart at the wrong dates. Restricting to the stock's bar times keeps the
  // logical indices 1:1 with the stock; the index line simply skips the gap too.
  const indexPaneSeries = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !ohlcData?.length) return []
    const stockTimes = new Set(ohlcData.map(b => b.time))
    // Also bound to the framed window (Model Book book-year) when provided. A
    // reused ticker (SNDK/BE) has an OLD pre-delisting segment in stockTimes too;
    // including its index points makes the line draw one segment straight across
    // the multi-year gap — a spike at the left edge of the year view. Keeping only
    // the framed window drops the old segment so the line starts cleanly.
    const toMs = (t) => typeof t === 'number'
      ? (t < 1e12 ? t * 1000 : t)
      : Date.parse(String(t).length <= 10 ? `${t}T00:00:00Z` : String(t))
    // Extend the lower bound ~13 months before the book year so the index line
    // also covers the PRIOR-year lead-up a setup/catalyst focus-zoom reveals
    // (e.g. Nov–Dec 2024 on a 2025 chart) — while still excluding a reused
    // ticker's MULTI-year-old segment (its delisting gap is years, not months).
    const YEAR_MS = 365 * 24 * 3600 * 1000
    const loMs = entryDate ? toMs(entryDate) - Math.round(YEAR_MS * 1.1) : -Infinity
    const hiMs = exitDate ? toMs(exitDate) + Math.round(YEAR_MS * 0.25) : Infinity
    return indexPaneData
      .map(b => ({ time: adjustTime(b.t), value: b.c }))
      .filter(p => {
        if (p.value == null || !Number.isFinite(p.value) || !stockTimes.has(p.time)) return false
        const ms = toMs(p.time)
        return ms >= loMs && ms <= hiMs
      })
  }, [indexPaneSymbol, indexPaneData, ohlcData, adjustTime, entryDate, exitDate])

  // Fixed price range for the index pane, computed from the FULL ^IXIC data over
  // the BOOK YEAR ONLY (entryDate..exitDate, NOT the extended lead-up window and
  // NOT clipped to the stock's bar times). Year-only = the Nasdaq line fills the
  // pane (the lead-up window dragged in 2020/2022 lows that wasted the bottom
  // half); full-data (not stock-clipped) = identical for every stock in a year so
  // the scale stays pinned/steady across ticker switches. NaN-time + non-positive
  // guards keep yfinance's 1970s ^IXIC history (period='max', lows near 50) from
  // leaking in past the date filter (NaN comparisons are false → would slip through).
  const indexPaneRange = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !entryDate || !exitDate) return null
    const toMs = (t) => typeof t === 'number'
      ? (t < 1e12 ? t * 1000 : t)
      : Date.parse(String(t).length <= 10 ? `${t}T00:00:00Z` : String(t))
    const loMs = toMs(entryDate)
    const hiMs = toMs(exitDate)
    if (!Number.isFinite(loMs) || !Number.isFinite(hiMs)) return null
    let min = Infinity, max = -Infinity
    for (const b of indexPaneData) {
      if (b.c == null || !Number.isFinite(b.c) || b.c <= 0) continue
      const ms = toMs(adjustTime(b.t))
      if (!Number.isFinite(ms) || ms < loMs || ms > hiMs) continue
      if (b.c < min) min = b.c
      if (b.c > max) max = b.c
    }
    if (!(min <= max)) return null
    // Pad the pinned range with HEADROOM below the line (and a touch above) so the
    // "-X%" decline annotations placed under the Nasdaq line aren't clipped at the
    // pane's bottom edge. The pinned provider range overrides the price-scale's
    // bottom scaleMargin, so the room has to come from the range itself — 28% of
    // the span below, 6% above.
    const span = (max - min) || Math.abs(max) || 1
    return { min: min - span * 0.28, max: max + span * 0.06 }
  }, [indexPaneSymbol, indexPaneData, adjustTime, entryDate, exitDate])
  // Keep the autoscaleInfoProvider's source current (it reads this ref). Pin only
  // in arithmetic/log modes; in Percent mode LWC rebases to the visible window, so
  // a fixed range would fight it — let it autoscale there.
  indexScaleRef.current = { range: indexPaneRange, pin: effectiveScale !== 'pct' }

  // 50-period SMA of the index pane (e.g. ^IXIC). Computed on the FULL index
  // history then clipped to exactly the index line's plotted time set, so the
  // MA is already fully populated at the window's left edge (no 50-bar ramp-in)
  // AND introduces no time points the stock lacks (same 1:1 logical-index rule
  // as the index line — see indexPaneSeries above).
  const indexPaneMaSeries = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !indexPaneSeries.length) return []
    const keepTimes = new Set(indexPaneSeries.map(p => p.time))
    const bars = indexPaneData
      .filter(b => b.c != null && Number.isFinite(b.c))
      .map(b => ({ t: adjustTime(b.t), c: b.c }))
    return computeSMA(bars, 50).filter(p => keepTimes.has(p.time))
  }, [indexPaneSymbol, indexPaneData, indexPaneSeries, adjustTime])

  // Color the index-pane MA the same blue as the price chart's 50 SMA overlay
  // (falls back to the default 50-SMA blue if no such overlay is enabled).
  const indexMaColor = useMemo(() => {
    const ov = resolvedOverlays?.find(o => o.type === 'SMA' && Number(o.period) === 50)
    return ov?.color || '#60a5fa'
  }, [resolvedOverlays])

  // Reset all live tracking refs on symbol or timeframe change.
  // CRITICAL: latestLiveRef must also be cleared — without it, a leftover live
  // tick from the previous ticker (e.g. AAPL price) gets re-applied to the new
  // ticker's first bar in the post-setData re-apply at the bottom of updateChart,
  // producing a wrong wick on the first candle of the new ticker.
  useEffect(() => {
    lastBarRef.current = null
    liveBarRef.current = null
    barStartVolRef.current = 0
    latestLiveRef.current = null
  }, [sym, resolvedTf])

  // Real-time candle updates — tick-by-tick via WebSocket.
  // Detects bar period boundaries and creates NEW candles automatically.
  // Handles both OHLC types (candles/bars) and close-only types (line/area).
  useEffect(() => {
    const liveData = livePrices[sym]
    if (!liveData?.price) return
    // Skip live updates when replay mode is active — don't corrupt historical view.
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    // HA bars depend on the full series history — skip tick-by-tick updates.
    // The chart still refreshes every 15s via SWR, which re-runs toHeikinAshi on
    // the full filteredBars array and calls setData() — accurate enough for HA.
    if (cs.heikinAshi) return
    // Writer A of the single-writer invariant (index @ barsPushActiveRef decl): when the
    // Massive push feed is authoritative, freeze this Finnhub tick writer ENTIRELY — no
    // series write AND no latestLiveRef update (the post-setData re-apply reads latestLiveRef;
    // a stale value there would repaint an old developing bar over the fresh push bar = the
    // 30s seam the plan review flagged).
    if (barsPushActiveRef.current) return
    // Freeze while a provisional stale-intraday cache is on screen — no live tick
    // may grow a phantom candle on the old tail before the full refetch swaps in.
    if (provisionalStaleRef.current) return
    // NOTE: the D/W/M "defer the candle write to Writer E" early-return USED to sit
    // here — above the latestLiveRef update below. That stranded latestLiveRef at the
    // mount-time price on D/W/M (Writer A returned before ever updating it once Writer
    // E's tick went fresh), and Writer D's post-setData re-top then stamped that stale
    // price onto the daily candle every ~2s. The defer now runs AFTER latestLiveRef is
    // refreshed (search "defer the candle WRITE to Writer E" below).
    // Defensive: drop ticks with bad price BEFORE they touch liveBarRef.
    // Mirror of onRealtimeBar's guard. A single NaN / 0 / extreme price baked
    // into liveBarRef.current.high or .low persists across setData() refreshes
    // because the post-setData re-apply (~line 1170) trusts liveBarRef as the
    // authoritative developing-bar state. Without this guard the chart can
    // get stuck with a low of 0 (or extreme) until full page reload, dragging
    // EMA/SMA series into a V-shape collapse on intraday charts.
    const _p = _effLivePrice(liveData)
    // Single sanity chokepoint (see isSaneLivePrice): non-finite/<=0, or
    // >50% deviation from the last painted bar OR the poison-proof clean
    // server close. Mirror of the WS-bar path so they cannot diverge.
    if (!isSaneLivePrice(_p, lastBarRef.current?.close, lastServerCloseRef.current)) return
    // ── GHOST-WICK GUARD (intraday, pre/post window) ──
    // It IS pre/post market by the ET clock, yet this snapshot carries no
    // extended session. That never means "the extended session ended" — it's a
    // poll where Massive returned an empty `lastTrade`, so the server's `price`
    // fell through to day.c / prevDay.c: the RTH or PRIOR close. isSaneLivePrice
    // can't catch it (a prior close is well within 50% of the live price), and
    // folding it into the developing pre-market candle is the reported bug — a
    // wick shooting down to the SAME price every few seconds with the axis tag
    // snapping to it, then both reverting on the next good poll. Dropped BEFORE
    // latestLiveRef so the post-setData re-top (writer D) can't repaint it from
    // there either. Bailing costs nothing: the next poll is ~2s away, and a
    // ticker with no extended print genuinely hasn't traded, so its bar
    // shouldn't move. (live_prices.py::_EXT_LAST now also re-serves the last
    // known ext print, so this should rarely fire — it's the belt to that
    // suspenders, and it holds if a future provider change reopens the hole.)
    if (!['D', 'W', 'M'].includes(resolvedTf) && inExtWindowRef.current && !liveData.ext_session) return
    // day_high / day_low can also arrive zero or stale during the first ticks
    // after market open. Treat 0 / negative / non-finite as "not provided" so
    // the bar's H/L don't snap to 0.
    const _dh = Number.isFinite(liveData.day_high) && liveData.day_high > 0 ? liveData.day_high : null
    const _dl = Number.isFinite(liveData.day_low) && liveData.day_low > 0 ? liveData.day_low : null
    const _do = Number.isFinite(liveData.day_open) && liveData.day_open > 0 ? liveData.day_open : null
    // prev_close is carried so the new-session classifier can recover a fresh
    // daily bar from the snapshot when the SSE stream is down (REST floor has
    // no updated_at) — last.close ≈ prev_close proves a new session is underway.
    const _pc = Number.isFinite(liveData.prev_close) && liveData.prev_close > 0 ? liveData.prev_close : null
    latestLiveRef.current = { sym, price: _p, updated_at: liveData.updated_at,
      day_open: _do, day_high: _dh, day_low: _dl, prev_close: _pc,
      ext_session: !!liveData.ext_session }
    // ── D/W/M: defer the candle WRITE to Writer E (the fast Massive 1-min tick) ──
    // Writer E owns the D/W/M developing candle; defer to it while its tick is fresh
    // so the two don't fight over the bar's close. CRITICAL: this runs AFTER the
    // latestLiveRef update above (not before it, as it once did) — latestLiveRef must
    // stay live because Writer D's post-setData re-top reads it. When it was stranded
    // at the mount-time price, Writer D stamped that stale close onto the daily candle
    // every ~2s (a live-volume-driven repaint) while Writer E corrected it: the "daily
    // snaps back to the price it showed at open every other tick" bug. Now only the
    // candle write is skipped; the ref tracks live, so Writer D re-tops with the
    // current price. Falls through to Writer A's own D/W/M write if Massive goes stale.
    if (!realtimeTfEligible) {
      const _ft = liveTickRef.current
      if (_ft && _ft.price != null && (Date.now() - _ft.ts) < LIVE_TICK_FRESH_MS) return
    }
    if (!candleSeriesRef.current || !lastBarRef.current) return
    if (['D', 'W', 'M'].includes(resolvedTf)) {
      // Writer A yields the D/W/M developing bar to the session-preview memo path
      // while it owns the bar (pre/post-market preview candle or frozen-at-4pm
      // regular candle). latestLiveRef stays updated above; only the candle write
      // is skipped so the two paths can't fight over the last bar's close/high/low.
      if (sessionOwnsDailyRef.current) return
      // Regular Hours mode: NEVER fold an extended-hours print into the daily
      // candle — even in the up-to-60s window after 4pm before useMarketOpen flips
      // isExtended (sessionFreezeActive gates off that laggy clock). ext_session is
      // a per-tick truth from the feed, and _effLivePrice already returned the ext
      // price into _p, so without this the post price seams the RTH candle.
      if (sessionViewRef.current === 'regular' && liveData.ext_session) return
    } else if (!showExtendedRef.current && liveData.ext_session) {
      // RTH-only intraday (EXT/RTH toggle off): same as Writer B — never fold a
      // pre/post-market print into the live intraday bar. (Writer A only reaches
      // intraday when the push feed isn't delivering; this is the fallback path.)
      return
    }
    const price = _p
    const last = lastBarRef.current
    const useOhlc = isOhlcType(cs.chartType)

    // Compute which bar period this tick belongs to.
    // CRITICAL: do NOT fall back to Date.now() — if a tick arrives without
    // updated_at (reconnect, stale cache, weekend straggler), wall-clock time
    // can land on a non-trading day and spawn a phantom Saturday/Sunday candle
    // next to Friday's real one. When the timestamp is missing, just keep
    // updating the last known bar in place.
    const tickSec = liveData.updated_at
    const live = latestLiveRef.current || {}
    const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
    // Single source of truth for the new-bar / update / skip decision (shared
    // with the post-setData re-apply below). For D/W/M it creates today's bar
    // from session OHLC even when the SSE stream is down and the tick carries
    // no timestamp (REST floor) — recovering the new session from the snapshot
    // (last.close ≈ prev_close) instead of fusing today's price onto a stale
    // prior-session candle (the "Frankenstein" bug, PAYO 2026-06-15). 'skip'
    // means a new D/W/M day with no confirmed session — leave yesterday alone.
    const decision = classifyLiveBar({
      tf: resolvedTf, last, live, tickSec, nowSec: Date.now() / 1000,
    })
    const barTime = decision.time != null ? decision.time : last.time

    try {
      if (decision.kind === 'skip') {
        // Intraday 'skip' from classifyLiveBar means the tick's bucket is PAST the
        // tail (its contiguity / REST-floor behind-guard fired) → the series has
        // stalled behind live (the stalled-SWR-poll freeze; same class Writer B
        // self-heals). Force a throttled SWR revalidation to pull the missing bars.
        // D/W/M 'skip' is an unconfirmed-session case (not a gap) — don't heal there.
        if (isIntradayTf) {
          const _nowMs = Date.now()
          if (_nowMs - gapHealAtRef.current > 4000) {
            gapHealAtRef.current = _nowMs
            try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
          }
        }
        return
      }
      if (decision.kind === 'new') {
        // ── NEW CANDLE ──
        const isDailyWeekly = !isIntradayTf
        // Daily/Weekly: use session OHLC. Intraday: use current tick as open (closest to actual first trade)
        const openPrice = (isDailyWeekly && live.day_open) ? live.day_open : price
        const highPrice = isDailyWeekly ? Math.max(live.day_high || openPrice, price) : price
        const lowPrice = isDailyWeekly ? Math.min((live.day_low && live.day_low > 0) ? live.day_low : openPrice, price) : price

        // Initialize tick-accurate tracking for this bar
        liveBarRef.current = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: price }
        barStartVolRef.current = liveData.volume || 0

        if (useOhlc) {
          candleSeriesRef.current.update(liveBarRef.current)
          lastBarRef.current = { ...liveBarRef.current, volume: 0 }
        } else {
          candleSeriesRef.current.update({ time: barTime, value: price })
          lastBarRef.current = { ...liveBarRef.current, volume: 0 }
        }
        if (volumeSeriesRef.current) {
          // Full-opacity default color (matches closed bars + volData) — no lighter
          // "developing" tint. Value is 0 here so it's invisible until the next tick.
          const _vUpN = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
          volumeSeriesRef.current.update({ time: barTime, value: 0, color: _vUpN })
        }
        _extendOverlaysLive(barTime, price)
      } else {
        // ── SAME CANDLE (decision.kind === 'update') ──
        // The "new D/W/M day without confirmed session" case is now handled by
        // decision.kind === 'skip' above (returns early), so reaching here means
        // the tick genuinely belongs to the current last bar.

        // Track in liveBarRef (survives setData wipes)
        if (liveBarRef.current && liveBarRef.current.time === last.time) {
          liveBarRef.current.high = Math.max(liveBarRef.current.high, price)
          liveBarRef.current.low = Math.min(liveBarRef.current.low, price)
          liveBarRef.current.close = price
        }

        const updated = {
          time: last.time,
          open: last.open,
          high: liveBarRef.current ? liveBarRef.current.high : Math.max(last.high, price),
          low: liveBarRef.current ? liveBarRef.current.low : Math.min(last.low, price),
          close: price,
        }
        if (useOhlc) {
          candleSeriesRef.current.update(updated)
        } else {
          candleSeriesRef.current.update({ time: last.time, value: price })
        }

        // Volume: don't override — let API-provided volume stand (refreshes every 15s)
        // The API has accurate per-bar volume; live delta calculations are unreliable
        lastBarRef.current = { ...updated, volume: last.volume }
        _extendOverlaysLive(last.time, price)
      }
    } catch (e) {
      if (e?.message) console.warn('[StockChart] live update error:', e.message)
    }
  }, [livePrices, sym, resolvedTf, cs.chartType, replayMode, _extendOverlaysLive])

  // Real-time bar streaming (Phase 4) — Massive AM events.
  // 60-min was added 2026-05-22 once the backend rollup adopted the canonical
  // ET-anchored bucket function (bars_fetch.bucket_60_et_unix_seconds) — the
  // same one the REST resample uses — so WS bars and REST bars now align bit-
  // identically and can't drift across DST or the 9:30 RTH-open anchor.
  // Keep this list in sync with backend ROLLUP_TFS (api/services/bar_broadcaster.py)
  // and the tf allow-list in api/routers/stream.py:stream_bars.
  // Coexists with the tick-driven useEffect above:
  //  - Tick logic drives sub-second flicker on the current developing candle
  //  - AM events deliver authoritative just-closed minute bars (1m chart) or
  //    server-rolled partial bucket bars (5/15/30/60m charts)
  //  - When an AM bar matches liveBarRef/lastBarRef.time, we sync them so the
  //    next tick iteration doesn't overwrite the authoritative values
  const realtimeTfEligible = ['1', '5', '15', '30', '60'].includes(resolvedTf)

  const onRealtimeBar = useCallback((data) => {
    if (!candleSeriesRef.current) return
    // Never paint a live bar onto a historical replay (mirror of writers A + C). When
    // push is authoritative B is THE writer, so without this it would append a live
    // candle onto the replayed slice (review #4).
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    // Defensive: a POOLED bars connection carries many (sym,tf) pairs. The pool
    // dispatches by key, but never apply a bar that isn't ours — cross-symbol
    // application (MSFT's OHLC on the AAPL series) is a data-doubt bug, so guard
    // here too (belt-and-suspenders against any future pool regression).
    if (data?.sym && String(data.sym).toUpperCase() !== String(sym).toUpperCase()) return
    if (data?.tf != null && String(data.tf) !== String(resolvedTf)) return
    // Writer B of the single-writer invariant (index @ barsPushActiveRef decl) — B IS the
    // push writer, so it paints ONLY when push is AUTHORITATIVE (delivering). In the transient
    // connected-but-not-yet-delivering window (the first bar; a flap near the recency boundary)
    // the Finnhub writers are still active, so painting here too would DUAL-WRITE the developing
    // bar (jitter on thin tickers). delivering is tracked independently by the pool, so this is a
    // clean one-bar handoff — Finnhub covers the transition bar, then B takes over.
    if (!barsPushActiveRef.current) return
    // Freeze while the provisional stale-intraday cache is on screen (see Writer A).
    if (provisionalStaleRef.current) return
    // AM `t` is bucket-start in ms. Convert to seconds AND add _ET_OFFSET so
    // the time matches the rest of the chart series — REST bars stored via
    // setData(ohlcData) where ohlcData uses adjustTime(b.t) = b.t + _ET_OFFSET.
    // Without this offset, Phase 4 update() lands at a time that conflicts
    // with the series and is silently dropped by lightweight-charts.
    const tSec = Math.floor(data.bar.t / 1000) + _ET_OFFSET
    const useOhlc = isOhlcType(cs.chartType)

    // RTH-only intraday (EXT/RTH toolbar toggle = off): drop live pre/post-market
    // bars, the same 9:30–16:00 ET window sessionBars filters the FETCHED data to.
    // Without this the CURRENT extended session leaks onto an RTH-only chart via
    // the live push feed (past ext sessions are already filtered out of history).
    if (!showExtendedRef.current && !['D', 'W', 'M'].includes(resolvedTf)) {
      const mins = etMinutes(Math.floor(data.bar.t / 1000))
      if (mins < 570 || mins >= 960) return
    }

    // Defensive: skip bars with invalid OHLC. WS sources can occasionally
    // emit zero / NaN / nonsensical values at bar boundaries or during
    // reconnect; without this guard the chart paints a tall bar spanning
    // from 0 to the current price, throwing off auto-scale and producing
    // the "extreme thin vertical bar at right edge" rendering bug the user
    // has reported repeatedly across intraday charts (60min especially).
    const o = data.bar.o, h = data.bar.h, l = data.bar.l, c = data.bar.c
    const allFinitePositive = [o, h, l, c].every(v => Number.isFinite(v) && v > 0)
    if (!allFinitePositive || l > h) {
      return  // silently drop the bad bar — next tick will repaint correctly
    }
    // Single sanity chokepoint (see isSaneLivePrice) — same gate as the
    // snapshot-tick path so the two can never diverge (divergent inline
    // guards are exactly how the 100x phantom slipped through).
    if (!isSaneLivePrice(c, lastBarRef.current?.close, lastServerCloseRef.current)) {
      return
    }

    // ── Contiguity guard (mirror of classifyLiveBar's intraday guard) ──
    // Writer B plants push bars by their OWN bucket time via series.update(). If the
    // on-screen tail (lastBarRef, seeded from the fetched series on every setData) is
    // MORE than one interval behind this push bar, the buckets in between are missing
    // — the REST/SWR series is stale or still loading (post-deploy cold start, a slow
    // ticker-switch, an in-flight full refetch). Planting here drops a LONE developing
    // candle detached from the stale tail: the reported "yesterday's full session +
    // one giant candle up to now" and "4-5 candles missing before the live one"
    // artifacts. classifyLiveBar already guards the Finnhub writers against exactly
    // this, but Writer B bypasses it — so replicate the guard here. SKIP; the
    // stale-tail full refetch (idbStaleIntraday, keyed off the same tail) fills the
    // gap, then push bars land contiguously. Intraday only — D/W/M new-session
    // handling differs (see classifyLiveBar). Also skips the legit overnight/weekend
    // session jump until the refetch lands the new session's earlier bars.
    if (!['D', 'W', 'M'].includes(resolvedTf)) {
      const _pbTail = lastBarRef.current
      const _periodB = PERIOD_SECONDS[resolvedTf] || 300
      if (_pbTail && Number.isFinite(_pbTail.time) && tSec - _pbTail.time > _periodB) {
        // Behind: the series tail lags this live push bar by >1 interval, so the
        // steady-state advance (the 30s SWR delta poll) has STALLED — e.g. a deploy
        // dropped every SSE and the visibility-gated refreshInterval never resumed,
        // freezing the chart at its load point (reported: half a watchlist stuck at
        // the same minute, tick not moving, across TSLA/NVDA/MU). Skipping alone
        // would keep it frozen forever (every push bar stays ahead of the stale
        // tail). Self-heal: force an immediate SWR revalidation (throttled) — mutate()
        // fires even while interval polling is paused, and the backend is
        // authoritative + proven fresh, so the refetch replaces/merges the missing
        // closed bars; once the tail catches up, push bars plant contiguously again.
        const _nowMs = Date.now()
        if (_nowMs - gapHealAtRef.current > 4000) {
          gapHealAtRef.current = _nowMs
          try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
        }
        return
      }
    }

    // Merge, don't overwrite: a Massive WS rollup for the CURRENT bucket may have only
    // accumulated since we subscribed (fresh ticker / tf switch), so its o/h/l can be a
    // partial slice of the bucket. Preserve the true OPEN and only EXTEND high/low from
    // the developing bar we already have (seeded from the fetched partial bar), so the
    // current candle keeps its full-so-far range instead of collapsing to the WS window.
    const _pbB = lastBarRef.current
    const _sameB = _pbB && _pbB.time === tSec && Number.isFinite(_pbB.open)
    const _oB = _sameB ? _pbB.open : o
    const _hB = _sameB ? Math.max(_pbB.high, h) : h
    const _lB = _sameB ? Math.min(_pbB.low, l) : l
    try {
      if (useOhlc) {
        candleSeriesRef.current.update({
          time: tSec,
          open: _oB, high: _hB, low: _lB, close: c,
        })
      } else {
        candleSeriesRef.current.update({ time: tSec, value: c })
      }
      if (volumeSeriesRef.current) {
        const _pb = prevBarsRef.current
        const _prevC = colorByNetChange && _pb && _pb.length >= 2 ? _pb[_pb.length - 2].c : null
        const _up = _prevC != null ? (data.bar.c >= _prevC) : (data.bar.c >= data.bar.o)
        // Full-opacity default color (same derivation as volData) — the developing
        // bar matches the closed bars instead of a lighter tint.
        const _vUp = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
        const _vDown = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
        volumeSeriesRef.current.update({
          time: tSec,
          // The incoming push-bar's volume. (A phantom `_volB` shipped 2026-07-21
          // here — the surrounding try/catch swallowed the ReferenceError, which
          // silently killed writer B's volume update AND the liveBarRef/lastBarRef
          // advancement below it on every push tick.)
          value: data.bar.v,
          color: _up ? _vUp : _vDown,
        })
      }
      // B is the SOLE writer here (gated on barsPushActive above), so it OWNS these refs —
      // create-or-advance for THIS bar unconditionally, so at a bucket rollover they follow the
      // new bar even though the Finnhub writers are suppressed. Carry VOLUME on liveBarRef so the
      // post-setData re-top can restore it (else the developing bar shows ~30s-stale server
      // volume until the next AM push — a volume flicker every SWR poll, retro-audit #5).
      liveBarRef.current = { time: tSec, open: _oB, high: _hB, low: _lB, close: c, volume: data.bar.v }
      lastBarRef.current = { time: tSec, open: _oB, high: _hB, low: _lB, close: c, volume: data.bar.v }
      // Drag the MA overlays out to this developing bar (see _extendOverlaysLive).
      _extendOverlaysLive(tSec, c)
    } catch {
      // lightweight-charts throws if `time` regresses below the series' last bar.
      // Silently ignore — out-of-order frames are rare and self-correct on next bar.
    }
  }, [cs.chartType, sym, resolvedTf, replayMode, _extendOverlaysLive])

  const onRealtimeReconnect = useCallback((lastBarT) => {
    // On ANY (re)connect of the bars stream, ALSO revalidate the closed-bar SWR poll.
    // The `since` backfill below only patches the DEVELOPING candle (via onRealtimeBar);
    // the CLOSED bars come from the /api/bars SWR poll, which uses refreshWhenHidden:false
    // and does NOT auto-revalidate on an SSE reconnect (SWR's revalidateOnReconnect fires
    // only on navigator.onLine). So a backend restart — every deploy drops all SSE at once
    // — leaves the closed-bar series frozen at its load point until something kicks it (the
    // "frozen after deploy" class). mutate() fires even while interval polling is paused.
    // This is what makes a reconnect invisible for the chart, the way the price feed's 2s
    // poll already makes reconnects invisible for the header/watchlist price.
    try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
    // Gap-backfill on reconnect — uses the existing `since` param of /api/bars.
    // `since` filters with strict > (see _get_bars_since_response). Subtract 1ms
    // so the bar at lastBarT is INCLUDED — covers the case where a bar updated
    // during the disconnect window and we need its authoritative server value.
    if (lastBarT == null || !sym) return
    const sinceMs = Math.max(0, lastBarT - 1)
    fetch(`/api/bars/${encodeURIComponent(sym)}?tf=${encodeURIComponent(resolvedTf)}&since=${sinceMs}`)
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        if (!payload?.bars?.length) return
        for (const b of payload.bars) {
          // /api/bars returns t in unix SECONDS, but onRealtimeBar expects ms
          // (matching the AM event shape). Multiply by 1000 to reconcile.
          onRealtimeBar({ sym, tf: resolvedTf, bar: { t: b.t * 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v } })
        }
      })
      .catch(e => {
        if (e?.message) console.warn('[StockChart] gap-backfill failed:', e.message)
      })
  }, [sym, resolvedTf, onRealtimeBar])

  // Revalidate the closed-bar poll when the tab/window becomes visible or refocuses.
  // The bars SWR uses refreshWhenHidden:false + revalidateOnFocus:false, so a backgrounded
  // tab silently pauses the 30s poll and never resumes on refocus — freezing the closed
  // bars while the live-price feed keeps updating (price moves in the header, chart stuck).
  // Force a revalidation on visibility/focus so the chart catches up the instant the user
  // looks at it (pro-tool behavior), independent of the 8s watchdog. Intraday only — D/W/M
  // evolve slowly and their 5-min poll is fine.
  useEffect(() => {
    if (typeof document === 'undefined' || !isIntraday) return
    const revalidate = () => {
      if (document.hidden) return
      try { barsMutateRef.current?.() } catch { /* mutate unbound mid-mount */ }
    }
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('focus', revalidate)
    return () => {
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('focus', revalidate)
    }
  }, [isIntraday])

  // Reactivity for the canary flag: setting/clearing localStorage 'uct.barsPush.enabled'
  // takes effect on the next render with NO page reload (the plan's instant runtime
  // revert). 'storage' fires cross-tab; a same-tab write dispatches 'uct-barspush-change'.
  const [, _bumpPushGate] = useState(0)
  useEffect(() => {
    const onChange = (e) => {
      if (!e || e.key == null || e.key === 'uct.barsPush.enabled' || e.type === 'uct-barspush-change') {
        _bumpPushGate(n => n + 1)
      }
    }
    window.addEventListener('storage', onChange)
    window.addEventListener('uct-barspush-change', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('uct-barspush-change', onChange)
    }
  }, [])

  // Whether THIS chart subscribes to the bars pool + paints push, per _barsPushEnabled()
  // (currently default-ON at 100% rollout; a browser opts out with localStorage
  // 'uct.barsPush.enabled'='0'). Gating the SUBSCRIPTION on it is what made the rollout %
  // the real cohort lever (review blocker #1). VITE_REALTIME_BARS is an additional
  // compile-time cohort gate inside the hook.
  // !cs.heikinAshi: HA needs the full-series toHeikinAshi() recompute (which the 15s SWR
  // refresh does), NOT incremental raw-OHLC push updates. Under HA the chart neither
  // subscribes nor suppresses Finnhub — writers A/C already `if (cs.heikinAshi) return`, and
  // without this push writer B would paint a RAW candle amid HA-smoothed bars (retro-audit bug).
  const _pushOptIn = _barsPushEnabled() && realtimeTfEligible && liveUpdates && !cs.heikinAshi
  const _barsPush = useRealtimeBars({
    symbol: _pushOptIn ? sym : null,
    tf: _pushOptIn ? resolvedTf : null,
    onBar: onRealtimeBar,
    onReconnect: onRealtimeReconnect,
  })
  // Single-writer gate: engage push ONLY when opted-in, AND the pool is actually
  // DELIVERING recent bars for this (sym,tf) — never suppress the Finnhub writers on a
  // merely-connected or silently-frozen feed (that would freeze the candle while ● LIVE
  // still shows). delivering is bar-recency-gated in barsStreamManager.
  barsPushActiveRef.current = _pushOptIn && _barsPush.delivering

  // ── Chart update — reuses chart instance, swaps data via setData() ─────────
  const updateChart = useCallback(() => {
    if (!containerRef.current) return
    // No bars yet for this sym/tf? Clear the existing series so the prior
    // ticker's data doesn't visually persist on screen during transitions.
    // Without this, switching tickers leaves the OLD ticker's candles drawn
    // until the new SWR fetch returns — that's the "blended data" the user
    // sees flipping between charts.
    if (!filteredBars?.length) {
      try { candleSeriesRef.current?.setData([]) } catch {}
      try { volumeSeriesRef.current?.setData([]) } catch {}
      for (const s of overlaySeriesRefs.current) {
        try { s.setData([]) } catch {}
      }
      lastCfgSigRef.current = null
      prevPaintBarsRef.current = null   // series were cleared — next paint must be full
      return
    }

    // ── A2: incremental last-bar render (kills the 30s full repaint) ──────────
    // During RTH the 30s SWR poll delivers a changed DEVELOPING bar, which re-runs
    // this whole function and full-`setData`s every series (candle + volume + all
    // MAs + all indicators + markers) — a periodic wholesale repaint. When ONLY
    // the last bar's OHLCV changed AND the render config is byte-identical to the
    // last paint, we instead `series.update()` just the last point of each series
    // (which also makes MAs/indicators track the developing bar in real time
    // instead of lagging 30s). `_applyData` below routes every setData call
    // through this decision; it self-corrects to a full setData on ANY edge
    // (empty series, timestamp mismatch) so a wrong incremental can't stick.
    // Config guard: a config-only change yields plan 'noop' (bars identical) →
    // not 'incremental' → full paint; a config change coinciding with a bar tick
    // is caught by the cfgSig compare. Bias is hard to 'full' — a needless full
    // repaint is a wasted frame; a wrong incremental would be a data bug.
    let _cfgSig
    try {
      _cfgSig = JSON.stringify({
        sym, resolvedTf, chartType: cs.chartType, showVolume,
        // canvasTheme (workspace theme toggle, e.g. Sunset↔Default) recolors the
        // candles + volume AND recreates the price series via _priceStyleKey below.
        // It is NOT part of `cs`, so without it here a theme-only flip keeps an
        // identical signature → plan 'noop' → the recreated series never gets its
        // setData (candles vanish) and volume keeps the old theme's colors until a
        // ticker change. Including it forces a full repaint on every theme switch.
        canvasTheme,
        cs, adjustTime, vwapOverride, hideWatermark, hidePriceLine, leftBarPad,
        modelBookLook, frozen, candleFrameFade, fadeCutoff, fitPriceToCandles,
        watermark, watermarkOpacity,
        // Covers ohlcData's remaining dep — the muted-white paint of the pre-market
        // preview candle, which changes colors without changing any bar VALUE (so the
        // render plan below can't see it).
        sessionPreviewLastBar,
        ovN: overlayData?.length ?? 0,
        mkN: mergedMarkers?.length ?? 0,
        plN: allPriceLines?.length ?? 0,
        cmpN: comparisonData?.length ?? 0,
      })
    } catch {
      // A non-serializable setting must never break the chart — fail safe to a
      // full paint (null cfgSig guarantees _incr is false this run).
      _cfgSig = null
    }
    // Plan against displayBars (what actually gets painted), NOT filteredBars. The
    // session-preview candle rides ONLY the display path by design — filteredBars stays
    // pure regular-session — so planning off filteredBars reports 'noop' the moment the
    // "Include pre/post-market" toggle flips (and on every ext-price tick), and the
    // synthetic candle never reaches the series. Intraday/RTH is unaffected: with no
    // session candle and no Heikin-Ashi, displayBars IS filteredBars (same reference),
    // so the extended-hours no-op guard this plan exists for behaves exactly as before.
    const _plan = barsRenderPlan(prevPaintBarsRef.current, displayBars)
    const _cfgSame = _cfgSig != null && _cfgSig === lastCfgSigRef.current
    // A chart/series that doesn't exist yet gets CREATED later in this run —
    // a 'noop'/'incremental' plan (latched from a destroyed predecessor with
    // content-identical bars) must never skip its first real paint.
    const _freshChart = !chartRef.current || !candleSeriesRef.current
    const _incr = _cfgSame && _plan.mode === 'incremental' && !_freshChart
    // Bars AND config byte-identical to the last paint → the series already hold
    // exactly this data; re-`setData`ing would be a pure wipe/repaint. CRITICAL in
    // EXTENDED HOURS: the live session price-tag (intradaySessionTagLines → allPriceLines)
    // recomputes on EVERY tick, re-running this whole effect ~1×/sec. A full setData
    // there erases the live-writer-painted DEVELOPING bar (which isn't in filteredBars
    // when the server hasn't served the current partial bucket) — it vanished and got
    // re-added every tick, shaking the chart. Skipping the no-op paint leaves the
    // developing bar (and the live-extended MAs) untouched; the price tags still
    // re-apply below.
    const _noop = _cfgSame && _plan.mode === 'noop' && !_freshChart
    lastCfgSigRef.current = _cfgSig
    // TEMP DIAGNOSTIC — log only when the painted ticker changes (transitions are
    // rare, so this is quiet). A phantom-chart blip = an unexpected extra hop here.
    if (typeof window !== 'undefined' && window.__uctBarsDebug && paintSymRef.current !== `${sym}_${resolvedTf}`) {
      console.log('[bars-paint]', 'PAINT', `${sym}_${resolvedTf}`, 'prev:', paintSymRef.current,
        '| bars:', filteredBars.length, 'firstT:', filteredBars[0]?.t, 'lastT:', filteredBars[filteredBars.length - 1]?.t,
        '| mode:', _incr ? 'incremental' : 'full')
      paintSymRef.current = `${sym}_${resolvedTf}`
    }
    const _applyData = (series, data) => {
      if (!series || !data) return
      // Nothing changed since the last paint — don't touch the series (see _noop).
      // A redundant setData here is what wiped the developing bar every tick in
      // extended hours; leaving the series as-is preserves the live-writer bar.
      if (_noop) return
      // A trailing WHITESPACE point means this series has nothing ON the newest
      // bar — Ichimoku's chikou is the real case: it plots each close 26 bars
      // BACK, so its head value sits 26 bars from the right and `update()` with
      // the newest (empty) point would leave that head frozen at the last full
      // paint. Fall through to setData for those; every other series still takes
      // the incremental path, which is the 30s-full-repaint fix.
      if (_incr && data.length && !isWhitespacePoint(data[data.length - 1])) {
        try { series.update(data[data.length - 1]); return } catch { /* fall through to full setData */ }
      }
      try { series.setData(data) } catch {}
    }

    let chart = chartRef.current

    // Capture the TRUE pre-update visible range, BEFORE any setData below shifts it.
    // The same-ticker backfill re-anchor (a depth jump like the 600→12025 dwell-warm)
    // uses THIS instead of a post-setData read — LWC re-anchors the range to the new
    // (much larger) extent during setData, so reading it afterward is unreliable and
    // was letting the view snap back to default when deep history loaded.
    let _preUpdateRange = null
    try { _preUpdateRange = chart?.timeScale().getVisibleLogicalRange() } catch { /* no chart yet */ }

    // ── Capture the OUTGOING ticker's vertical candle placement (proportional lock) ──
    // Runs only on a true ticker switch (same timeframe), BEFORE chartOpts re-applies
    // scaleMargins. We measure where the visible candles sit within the price pane as
    // top/bottom fractions. If that differs from the default headroom, the user has
    // dragged the price scale to reposition the candles — remember it so the next stock
    // lands in the same proportional spot (scaled to its own range). If it matches the
    // default, treat as "not customized" (null) so volume/indicator pane toggles still
    // re-flow normally.
    if (exactDateRange || !carryDragPlacement) {
      // Model Book frames each stock to a fixed year and should just autoscale —
      // the carry-the-drag-placement-across-tickers lock is inappropriate here and
      // compounds badly on huge back-adjusted/log-scale values (uploaded delisted
      // data), ballooning the price scale until the candles are a sliver.
      vertMarginsRef.current = null
    } else {
      const _zoomKey = `${sym}_${resolvedTf}`
      const _isFirstLoad = zoomKeyRef.current === null
      const _tfChanged = lastTfRef.current !== null && lastTfRef.current !== resolvedTf
      const _isSymSwitch = !_isFirstLoad && !_tfChanged && zoomKeyRef.current !== _zoomKey
      if (_isFirstLoad || _tfChanged) {
        vertMarginsRef.current = null
      } else if (_isSymSwitch && chart && candleSeriesRef.current) {
        try {
          const prevBars = prevBarsRef.current
          const vr = chart.timeScale().getVisibleLogicalRange()
          if (prevBars && prevBars.length && vr) {
            const s = Math.max(0, Math.floor(vr.from))
            const e = Math.min(prevBars.length - 1, Math.ceil(vr.to))
            let hi = -Infinity, lo = Infinity
            for (let i = s; i <= e; i++) {
              const b = prevBars[i]
              if (!b) continue
              if (b.h > hi) hi = b.h
              if (b.l < lo) lo = b.l
            }
            let paneH = 0
            try { paneH = chart.paneSize().height } catch {}
            if (!(paneH > 0)) { try { paneH = (containerRef.current?.clientHeight || 0) - chart.timeScale().height() } catch {} }
            const series = candleSeriesRef.current
            if (hi > lo && paneH > 8) {
              const yHi = series.priceToCoordinate(hi)
              const yLo = series.priceToCoordinate(lo)
              if (yHi != null && yLo != null) {
                let top = Math.min(0.9, Math.max(0, yHi / paneH))
                let bottom = Math.min(0.9, Math.max(0, (paneH - yLo) / paneH))
                if (top + bottom > 0.95) { const k = 0.95 / (top + bottom); top *= k; bottom *= k }
                const base = _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
                // Only treat as a custom placement if it meaningfully differs from default.
                if (Math.abs(top - base.top) < 0.03 && Math.abs(bottom - base.bottom) < 0.03) {
                  vertMarginsRef.current = null
                } else {
                  vertMarginsRef.current = { top: +top.toFixed(4), bottom: +bottom.toFixed(4) }
                }
              }
            }
          }
        } catch {}
      }
    }

    // ── Create or update chart instance ──
    // Axis-width pin, scaled with the user's scale text size. The 76px floor
    // below was verified at fontSize 11 (see the rightPriceScale comment); a
    // user-bumped cs.textSize widens every axis tag past that floor, un-pinning
    // the axis so it re-flows on each live tick — the ~1/sec left-right shake
    // came BACK for users with larger scale text. Scale the floor with the font
    // so the pin holds at any size (never below the verified 76) — then ratchet
    // it up to the widest column actually MEASURED this sym/tf, so even an
    // environment the static floor never anticipated (DPR/zoom/font fallback)
    // can only widen the axis once, never oscillate it (axisWidthRatchetRef).
    let _measuredAxis = 0
    try { _measuredAxis = chartRef.current?.priceScale('right')?.width() || 0 } catch { /* no chart yet */ }
    if (_measuredAxis > axisWidthRatchetRef.current) axisWidthRatchetRef.current = _measuredAxis
    const _axisMinWidth = Math.max(
      Math.ceil(76 * Math.max(1, (cs.textSize ?? 11) / 11)),
      axisWidthRatchetRef.current,
    )
    const chartOpts = {
      layout: {
        background: themeColors.layoutTransparent
          ? { type: ColorType.Solid, color: 'rgba(255,255,255,0)' }   // transparent → container gradient shows through (continuous across panes)
          : themeColors.backgroundGradient
            ? { type: ColorType.VerticalGradient, topColor: themeColors.backgroundGradient.top, bottomColor: themeColors.backgroundGradient.bottom }
            : { type: ColorType.Solid, color: themeColors.background },
        // Auto-contrast ink derived from the canvas — deliberately NOT the user's
        // scale color (see axisAuto).
        textColor: axisAuto.ink,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: cs.textSize ?? 11,
        attributionLogo: false,  // hide built-in TradingView logo; we overlay the UCT mark instead
        // Model Book: subtle (not bold gray) pane divider; still draggable.
        //
        // ⭐ FLIP C: SPEC §6 REQUIRES A DRAGGABLE DIVIDER, and under `'panes'`
        // every oscillator has one. `enableResize` was already declared for the
        // two surfaces that restyle the separator; in `'panes'` mode it is
        // declared for ALL of them, so the answer is in the chart's own options
        // rather than resting on the library default. (It is `!frozen` either
        // way: a Setup Library exhibit is a static picture and its panes are not
        // draggable — the one place spec §6 does not apply.)
        //
        // ⭐⭐ SUB-CHOICE 2.1, ANSWERED **TAKE THE TOKEN** BY THE OWNER ON
        // 2026-08-05 (record §5). **2,400 px on `rsi_only`** — exactly one
        // 1,200-px row per separator, and nothing else on the canvas moves
        // (builds `1667183abbe0` → `d361f1585243`). `separatorColors` is already
        // derived from the canvas AT THE SEPARATOR'S OWN HEIGHT and is what the
        // Model Book and bold-candle surfaces use; leaving LWC's `#2B2B43` in
        // place would put the app's one remaining hard-coded chrome colour
        // between every pair of panes — invisible against a dark canvas and
        // wrong against a light one, the exact defect `separatorColors` was
        // written to fix. ⚠️ It restyles a divider that ALREADY EXISTS (the
        // price/volume one), which is why it was priced as its own decision and
        // not folded into the cutover's number.
        ...((boldCandles || subtleSeparator || paneMode() === 'panes')
          ? { panes: { separatorColor: separatorColors.color, separatorHoverColor: separatorColors.hover, enableResize: !frozen } }
          : {}),
      },
      // Frozen (Setup Library examples): the chart is a static exhibit pinned to
      // its framed window — no pan/zoom/axis-drag, and the wheel is left alone so
      // it scrolls the PAGE instead of the chart.
      // Plain mouse-drag PANS the chart (default). Drag-to-measure is gated behind
      // Shift: onDown sets measureLockRef while Shift+dragging so the chart stays put.
      // Computed here (re-runs on data polls) so a poll can't unlock mid-measure.
      handleScroll: (frozen || measureLockRef.current) ? false : true,
      handleScale: frozen || measureLockRef.current ? false : true,
      grid: {
        vertLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
        horzLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
      },
      crosshair: hideCrosshair ? {
        mode: 0,
        // Fully suppress both crosshair lines + their axis labels (Setup Library examples).
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      } : {
        mode: cs.crosshair.magnet ? 1 : 0,  // 1 = Magnet (snaps to OHLC), 0 = Normal
        // Crosshair date/price labels blend with the canvas (gradient-bottom aware);
        // LWC auto-contrasts their text against this background (axisAuto).
        vertLine: { color: themeColors.crosshairColor, width: cs.crosshair.width ?? 1, style: cs.crosshair.style, labelBackgroundColor: axisAuto.labelBg },
        horzLine: { color: themeColors.crosshairColor, width: cs.crosshair.width ?? 1, style: cs.crosshair.style, labelBackgroundColor: axisAuto.labelBg },
      },
      rightPriceScale: {
        borderColor: themeColors.borderColor,
        // No vertical separator line between the plot and the axis — the values sit
        // right against the plot (also lets the volume-pane scale align cleanly under
        // the price scale, since both panes are now borderless).
        borderVisible: false,
        // Pin a stable minimum width so the axis can't re-flow as the developing
        // bar's live last-value label re-renders. At fractional display scaling
        // (e.g. Windows 125/150%) that label's sub-pixel width jitters every price
        // tick; a floating price-scale width makes the whole plot shift left/right
        // in lockstep with the quotes (the "chart jiggles on every tick" bug).
        // ⚠️ DO NOT LOWER below the widest last-value TAG width or the bug returns —
        // a $600–900 price ("695.34") + the tag's background padding overflows a
        // 64px axis, so it auto-sized per tick and the intraday WS push feed
        // (multiple ticks/sec) made it shake continuously. 76 is the value verified
        // against a DPR-1.5 live-tick repro (0 shifts). Tightening the axis is not
        // worth reintroducing the jitter. _axisMinWidth scales this floor with
        // cs.textSize (larger scale text = wider tags = the same overflow class).
        minimumWidth: _axisMinWidth,
        // Locked proportional placement (carried across ticker switches) wins over the
        // default headroom. vertMarginsRef is captured in fractions of the pane, so the
        // candles land in the same relative spot regardless of the stock's price.
        scaleMargins: vertMarginsRef.current || _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
      },
      localization: {
        // Crosshair time label (the hover box on the axis): weekday + date +
        // 12-hour time, e.g. "Tue 14 Jul '26 12:00 AM".
        timeFormatter: chartCrosshairTimeFormatter,
      },
      timeScale: {
        borderColor: themeColors.borderColor,
        // No horizontal separator line under the panes — matches the borderless right
        // price scale so the bottom edge stays a clean single hairline (the widget's
        // own border), not a doubled dark line.
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        // Bottom-axis tick labels: 12-hour on intraday (default is 24-hour).
        tickMarkFormatter: chartTickMarkFormatter,
        // Exact-range (Model Book) locks to a historical window, so don't pin the
        // latest bar to the right edge — that re-expands the view to "now".
        rightOffset: exactDateRange ? 0 : rightPadBars,
        rightBarStaysOnScroll: exactDateRange ? false : true,
        // Setup → Result appends the result-era bars while the view sits ON the
        // last bar; LWC's default then shifts the window to the new last bar
        // BEFORE the pin effect's glide starts — the "snaps right, then zooms"
        // bug. Exact-range charts are frozen historical windows: never
        // auto-shift them.
        shiftVisibleRangeOnNewBar: exactDateRange ? false : true,
      },
    }

    if (!chart) {
      // Pinned 5.2.0 default is `true`, which re-orders draw order within a pane on
      // hover. This chart stacks candles + MA overlays + VWAP + BB + Donchian + SAR
      // + comparison in pane 0, so hovering would silently restack them (and later,
      // float a band's constituent line above its own fill). Keep 5.1.0 rendering;
      // opt in deliberately if we ever want the hit-testing that comes with it.
      chart = createChart(containerRef.current, {
        ...chartOpts,
        autoSize: true,
        hoveredSeriesOnTop: false,
      })
      chartRef.current = chart
      // ⭐ THE PANE MANIFEST'S ONE LINE — the chart announces ITSELF (Task 3 → 4).
      //
      // `pages/ChartRender.jsx` publishes `window.__paneManifest` for the parity
      // harness, and it cannot reach this `IChartApi`: `StockChart` exposes it
      // through no prop, no ref and no callback. So `engine/paneLayout.js` carries a
      // one-slot registry and the renderer registers into it here, at creation,
      // which is the only place the identity of the chart changes.
      //
      // ⚠️ THE BINDINGS ARE A THUNK, NOT A VALUE. The manifest must read the
      // engine's CURRENT bindings at the moment the harness asks, and this line
      // runs once per chart while the binder is rebuilt whenever the instance list
      // moves. Reading `engineRef.current` inside the closure is what keeps the
      // `key` on each series (its POOL KEY — stable, derived from the instance id,
      // never object identity and never a shifting index) attached to the series
      // actually on the chart.
      //
      // ⚠️ It returns `[]`, never `null`, when no binder exists: `paneManifest`
      // treats a non-array as "no bindings" and would report every series' `key` as
      // null, which reads identically to a chart whose engine drew nothing.
      // Un-registering is the cleanup effect's job, beside `chart.remove()`.
      unregisterManifestRef.current = registerManifestChart(
        chart,
        () => (engineRef.current ? engineRef.current.binder.bindings() : []),
      )
      setChartReady(true)
    } else {
      // Re-apply cosmetic/config options on an EXISTING chart, but NOT the
      // view-scroll options (rightOffset / rightBarStaysOnScroll /
      // shiftVisibleRangeOnNewBar). Those are set once at creation; re-applying
      // rightOffset here RE-SCROLLS the chart to the right edge, snapping the
      // view back whenever the user has panned/zoomed/dragged the price scale
      // ("chart skips periods / jumps"). Omitting them from the partial
      // timeScale update leaves LWC's current scroll position untouched. The
      // zoom-anchoring logic below still sets the visible range explicitly on
      // sym/tf switches and data-phase swaps.
      const { rightOffset: _ro, rightBarStaysOnScroll: _rbs, shiftVisibleRangeOnNewBar: _svr, ...tsSafe } = chartOpts.timeScale
      chart.applyOptions({ ...chartOpts, timeScale: tsSafe })
    }

    // ── Symbol watermark (custom v5 pane primitive, behind series) ──
    if (!wmCtrlRef.current) {
      wmCtrlRef.current = createWatermarkPrimitive({ x: cs.watermark.x, y: cs.watermark.y })
    }
    if (!wmAttachedRef.current) {
      try {
        chart.panes()[0].attachPrimitive(wmCtrlRef.current.primitive)
        wmAttachedRef.current = true
      } catch { /* older pane API — primitive optional */ }
    }
    {
      const wmLines = (cs.watermark.visible && !hideWatermark)
        ? composeWatermarkLines(watermark ?? sym, watermarkMeta, cs.watermark.lines)
        : []
      // centerWatermarkOnPlot: pin the horizontal center to the middle of the
      // WHOLE widget — the candle plot PLUS the right price-axis gutter — measured
      // from the pane's left edge (= widget's left edge; there's no left axis). So
      // it's centered between the outer left/right edges of the widget, not just
      // the candle area. Falls back to watermarkCenterX otherwise.
      let _wmCenterX = watermarkCenterX
      if (centerWatermarkOnPlot) {
        try {
          const _tw = chart.timeScale().width()
          let _aw = 0; try { _aw = chart.priceScale('right').width() || 0 } catch { /* no right axis */ }
          if (_tw > 0) _wmCenterX = (_tw + _aw) / 2
        } catch { /* keep fallback */ }
      }
      wmCtrlRef.current.setOptions({
        lines: wmLines,
        color: cs.watermark.color,
        opacity: watermarkOpacity ?? cs.watermark.opacity,
        sizeScale: cs.watermark.sizeScale,
        x: watermarkX ?? cs.watermark.x,
        y: watermarkY ?? cs.watermark.y,
        ...(watermarkPad != null ? { padX: watermarkPad, padTop: watermarkPadTop ?? watermarkPad } : {}),
        hardCenterXPx: _wmCenterX,
      })
    }

    // ── Extended-hours shading (custom v5 pane primitive, behind series) ──
    if (!sessionShadeRef.current) {
      sessionShadeRef.current = createSessionShadingPrimitive({})
    }
    if (!sessionShadeAttachedRef.current) {
      try {
        chart.panes()[0].attachPrimitive(sessionShadeRef.current.primitive)
        sessionShadeAttachedRef.current = true
      } catch { /* older pane API — primitive optional */ }
    }
    {
      // `sessionShadeBands` is memoized on [filteredBars, adjustTime, shadeOn] — the
      // band pass is O(bars) and this block runs on every updateChart, so computing
      // it inline re-walked the whole (2.5×-longer, extended-hours) bar array on
      // every repaint. setOptions also forces a primitive redraw, so re-setting
      // identical bands was paying twice; skip when nothing changed.
      if (lastShadeBandsRef.current !== sessionShadeBands) {
        lastShadeBandsRef.current = sessionShadeBands
        sessionShadeRef.current.setOptions({ enabled: _shadeOn, bands: sessionShadeBands })
      }
    }

    // Price-scale mode (Normal/Log/Percent) is applied by a dedicated effect
    // keyed on `effectiveScale`, so the A/L/% toggle and the forceLogScale
    // default both take effect immediately (and survive data updates).

    // ── Price series — reuse if chart type unchanged, else swap ──
    // When swapping the candle series, the markers controller is bound to the
    // old series — detach it so the next markers update creates a fresh
    // controller against the new series.
    // Include the effective candle colors so a color-picker change recreates the
    // series (re-runs the `_bold` options + re-installs the net-change wrapper with
    // the new palette). mbUp/mbDown resolve to the user's colors when userCandleColors.
    // Effective candle colors — refreshed every run into netColorsRef so the wrapper
    // and the live series options below read the latest WITHOUT recreating the series.
    {
      const _m = cs.candleColorMode || 'netchange'
      const _u = boldCandles ? mbUp : (modelBookLook ? BOLD_UP : cs.candles.upColor)
      const _d = boldCandles ? mbDown : (modelBookLook ? BOLD_DOWN : cs.candles.downColor)
      // Sunrise is a fixed light theme: candle bodies are forced to SUNRISE_UP/DOWN
      // (_u/_d), so the wick + border MUST follow the body — NOT the user's saved
      // upWick/downWick/upBorder/downBorder (which are the dark-theme palette and
      // render a brighter, mismatched red/green wick on the Sunrise canvas). This
      // keeps NC in lockstep with the `_bold` sunrise series-creation options
      // (wick/border = mbUp/mbDown) so the live color-apply below can't re-split them.
      const _sruniform = canvasTheme === 'sunrise'
      netColorsRef.current = {
        mode: _m, up: _u, down: _d,
        one: (userCandleColors && cs.candles.oneColor) ? cs.candles.oneColor : _u,
        borUp: _sruniform ? _u : (userCandleColors ? (cs.candles.upBorder || _u) : _u),
        borDown: _sruniform ? _d : (userCandleColors ? (cs.candles.downBorder || _d) : _d),
        wickUp: _sruniform ? _u : (userCandleColors ? (cs.candles.upWick || _u) : _u),
        wickDown: _sruniform ? _d : (userCandleColors ? (cs.candles.downWick || _d) : _d),
        // Hollow bodies are a CANDLE-ONLY effect. A CandlestickSeries with a
        // transparent body still draws its border (borderVisible below), so the bar
        // stays visible as an outline — but BarSeries (chartType 'bars'/'hlc') has NO
        // border to fall back on, so a transparent "body" is the bar's only stroke and
        // the bar disappears outright. Left unguarded, every up-bar vanished under the
        // Sunset/light canvas while the MAs (same data) drew normally.
        hollow: (canvasTheme === 'sunrise' || cs.chartType === 'hollow')
          && (cs.chartType === 'candles' || cs.chartType === 'hollow'),
        insideBlack: canvasTheme === 'sunrise',
      }
    }
    // Only a change of the underlying LWC SERIES TYPE (+ theme) recreates the series.
    // candles↔hollow share a Candlestick series and bars↔hlc share a Bar series — the
    // difference (hollow body / hidden open tick) is applied live below, so toggling
    // them (and colors, and the color mode) never destroys the series = no shake.
    const _ct = cs.chartType || 'candles'
    const _seriesType = (_ct === 'candles' || _ct === 'hollow') ? 'candle'
      : (_ct === 'bars' || _ct === 'hlc') ? 'bar' : _ct
    const _priceStyleKey = `${_seriesType}|${canvasTheme || ''}`
    if (prevChartTypeRef.current !== _priceStyleKey && candleSeriesRef.current) {
      try { chart.removeSeries(candleSeriesRef.current) } catch {}
      candleSeriesRef.current = null
      try { markersControllerRef.current?.detach?.() } catch {}
      markersControllerRef.current = null
      focusProviderInstalledRef.current = false  // new series needs the focus autoscale provider re-attached
      swingAttachedRef.current = false           // swing-label primitive must re-attach to the new series
      earnBadgeAttachedRef.current = false       // earnings-badge primitive must re-attach to the new series
      splitBadgeAttachedRef.current = false      // split-badge primitive must re-attach
      divBadgeAttachedRef.current = false        // dividend-badge primitive must re-attach
      zonesAttachedRef.current = false           // level-zones primitive must re-attach to the new series
      pdlAttachedRef.current = false             // prev-day-levels primitive must re-attach to the new series
    }

    if (!candleSeriesRef.current) {
      let priceSeries
      switch (cs.chartType) {
        case 'hollow':
          priceSeries = chart.addSeries(CandlestickSeries, {
            upColor: 'transparent', downColor: cs.candles.downColor,
            borderUpColor: cs.candles.upColor, borderDownColor: cs.candles.downColor,
            wickUpColor: cs.candles.upWick, wickDownColor: cs.candles.downWick,
          })
          break
        case 'bars':
          priceSeries = chart.addSeries(BarSeries, {
            upColor: cs.candles.upColor, downColor: cs.candles.downColor,
            thinBars: cs.candles.thinBars !== false,
          })
          break
        case 'hlc':
          // HLC bar = OHLC bar with the left "open" tick hidden.
          priceSeries = chart.addSeries(BarSeries, {
            upColor: cs.candles.upColor, downColor: cs.candles.downColor,
            openVisible: false,
            thinBars: cs.candles.thinBars !== false,
          })
          break
        case 'line': {
          // One-color = the single color; net/open-close = per-segment (from
          // closeData's per-point `color`), with the up color as the base.
          const _lineBase = (cs.candleColorMode === 'onecolor')
            ? ((userCandleColors && cs.candles.oneColor) ? cs.candles.oneColor : mbUp)
            : mbUp
          priceSeries = chart.addSeries(LineSeries, { color: _lineBase, lineWidth: 2 })
          break
        }
        case 'area': {
          const _areaBase = (cs.candleColorMode === 'onecolor')
            ? ((userCandleColors && cs.candles.oneColor) ? cs.candles.oneColor : mbUp)
            : mbUp
          // The fill under an area chart is always a neutral, automatic transparent
          // gray (per request) — only the LINE follows the color mode.
          priceSeries = chart.addSeries(AreaSeries, {
            lineColor: _areaBase,
            topColor: 'rgba(140,140,140,0.16)',
            bottomColor: 'rgba(140,140,140,0.0)',
            lineWidth: 2,
          })
          break
        }
        default: // 'candles'
          priceSeries = chart.addSeries(CandlestickSeries, {
            upColor: cs.candles.upColor, downColor: cs.candles.downColor,
            borderUpColor: cs.candles.upBorder, borderDownColor: cs.candles.downBorder,
            wickUpColor: cs.candles.upWick, wickDownColor: cs.candles.downWick,
          })
      }
      candleSeriesRef.current = priceSeries
      // Model Book studies a past year — the current (latest) price line is
      // irrelevant there, so hide the dotted last-price line for exact-range.
      // boldCandles paints solid bright green/red; hideLastValue drops the
      // right-axis price tag. Both only apply to instances that opt in.
      try {
        // The intraday popup (modelBookLook) shares the Model Book main chart's
        // solid bold green/red so the two charts match exactly — without it the
        // popup falls back to the lighter default cs.candles palette.
        // Model Book (boldCandles) gets the punchier TC2000 palette (vivid green
        // / deep red); the intraday popup (modelBookLook) keeps the base bold one.
        const _bUp = boldCandles ? mbUp : BOLD_UP
        const _bDown = boldCandles ? mbDown : BOLD_DOWN
        const _bold = (canvasTheme === 'sunrise' && _seriesType === 'candle') ? {
          // Sunrise default = HOLLOW candles (TC2000 look): up = hollow body + dark
          // green outline; down = filled dark red. Same palette as the volume bars.
          upColor: 'rgba(0,0,0,0)', downColor: mbDown,
          borderVisible: true, borderUpColor: mbUp, borderDownColor: mbDown,
          wickUpColor: mbUp, wickDownColor: mbDown,
        } : canvasTheme === 'sunrise' ? {
          // Sunrise with a BAR series ('bars'/'hlc'): SOLID dark palette, never the
          // hollow treatment above. BarSeries has no border, so a transparent upColor
          // leaves the bar with no stroke at all and every up-bar disappears. The
          // per-bar painter hides this in netchange mode but is a passthrough in
          // open/close mode, where the series option is what actually paints.
          upColor: mbUp, downColor: mbDown,
        } : cs.chartType === 'hollow' ? {
          // HOLLOW chart type in a non-sunrise theme (e.g. the default bold workspace):
          // up = transparent body + colored outline, down = filled. Without this the
          // boldCandles branch below forces borderVisible:false + a solid up body, so
          // the hollow type rendered as normal filled candles (the reported bug).
          upColor: 'rgba(0,0,0,0)', downColor: _bDown,
          borderVisible: true, borderUpColor: _bUp, borderDownColor: _bDown,
          wickUpColor: _bUp, wickDownColor: _bDown,
        } : (boldCandles || modelBookLook) ? {
          upColor: _bUp, downColor: _bDown,
          // Workspace (userCandleColors): borders VISIBLE so the user's Border colors
          // render (default border = body color → still looks solid). Model Book keeps
          // pure solid bodies (no border line).
          borderVisible: !!userCandleColors,
          borderUpColor: userCandleColors ? (cs.candles.upBorder || _bUp) : _bUp,
          borderDownColor: userCandleColors ? (cs.candles.downBorder || _bDown) : _bDown,
          wickUpColor: userCandleColors ? (cs.candles.upWick || _bUp) : _bUp,
          wickDownColor: userCandleColors ? (cs.candles.downWick || _bDown) : _bDown,
        } : {}
        // Optional integer-only price axis (DarkPool page passes precision:0
        // for large-cap stocks so the axis shows "200" not "200.00").
        const _priceFormat = priceFormat ? { priceFormat } : {}
        priceSeries.applyOptions({ priceLineVisible: !exactDateRange && !hidePriceLine, lastValueVisible: !hideLastValue, ..._bold, ..._priceFormat })
      } catch { /* older LWC */ }

      // ── colorByNetChange ── Color each candle by close-vs-PREVIOUS-close (TC2000 /
      // StockCharts style) instead of LWC's built-in close-vs-open. LWC only auto-colors
      // by open/close at the series level, so net-change coloring requires a per-bar
      // color/borderColor/wickColor override on the DATA. Rather than touch the ~20
      // developing-bar writer sites, we wrap the series' setData/update ONCE here so every
      // write path (historical setData, gold setup/catalyst highlight, live ticks) is
      // colored consistently. Gated on the prop → only opted-in charts are affected; the
      // gold-highlight override is preserved (bars that already carry an explicit color
      // are left untouched). Candles + OHLC bars only (line/area/hollow have no net-change
      // notion). Same up/down palette the series itself uses so it looks identical apart
      // from the coloring rule.
      // Net-change eligibility: candles/bars always; on Sunrise ALSO 'hollow' (the
      // Sunrise look is hollow, and without this a saved 'hollow' chart type skips the
      // wrap entirely and LWC colors by close-vs-OPEN — the "up day shows red" bug).
      // Candle color mode (user-selectable): 'openclose' colors natively by
      // close-vs-open (LWC default) → NO per-bar wrap. 'netchange' (close-vs-prev-
      // close) and 'onecolor' (every bar one color) paint each bar here.
      const _netEligible = cs.chartType === 'candles' || cs.chartType === 'bars' || cs.chartType === 'hlc'
        || cs.chartType === 'hollow'
        || (canvasTheme === 'sunrise' && isOhlcType(cs.chartType))
      // Install the wrapper for EVERY OHLC type (regardless of color mode) so a mode
      // change doesn't need a recreate. In open-close mode _paintNet is a passthrough
      // and LWC colors natively from the live series options.
      if (colorByNetChange && _netEligible && !priceSeries.__uctNetWrap) {
        const _isInside = (bar, prevBar) => (
          prevBar
          && bar.high != null && bar.low != null && prevBar.high != null && prevBar.low != null
          && bar.high <= prevBar.high && bar.low >= prevBar.low
        )
        // Colors are read LIVE from netColorsRef (updated every render) so a color
        // change repaints via setData without recreating the series (no shake).
        const _paintNet = (bar, prevClose, prevBar) => {
          if (!bar || bar.close == null) return bar
          if (bar.color != null) return bar   // preserve an explicit override (gold highlight)
          const NC = netColorsRef.current
          // Sunrise's black inside-day candles are part of the theme's signature
          // look, so they paint in EVERY color mode — checked before the openclose
          // passthrough (below) which otherwise skips all per-bar painting. The
          // fill still follows close-vs-open (TC2000): an inside day that closed
          // above its open is a HOLLOW black outline, below = filled black.
          if (NC.insideBlack && _isInside(bar, prevBar)) {
            const openUpIn = bar.open != null ? bar.close >= bar.open : true
            return { ...bar, color: (NC.hollow && openUpIn) ? 'rgba(0,0,0,0)' : '#000000', borderColor: '#000000', wickColor: '#000000' }
          }
          if (NC.mode === 'openclose') return bar   // native close-vs-open coloring
          // One color: every bar the same body/border/wick (shape still hollow on up).
          if (NC.mode === 'onecolor') {
            const up = bar.open != null ? bar.close >= bar.open : true
            const body = (NC.hollow && up) ? 'rgba(0,0,0,0)' : NC.one
            return { ...bar, color: body, borderColor: NC.one, wickColor: NC.one }
          }
          // TC2000 hollow-candle semantics: COLOR and FILL are independent axes.
          // Direction (net-change close-vs-prev-close, or close-vs-open in that
          // mode) drives the green/red palette; close-vs-OPEN alone drives the
          // hollow/filled body. So a green candle that closed below its open is
          // FILLED green, and a red candle that closed above its open is HOLLOW
          // red — all four combinations render.
          let up
          if (NC.mode === 'netchange') {
            if (prevClose == null) return bar   // first bar — no prior close to compare
            up = bar.close >= prevClose
          } else {
            up = bar.open != null ? bar.close >= bar.open : true
          }
          const openUp = bar.open != null ? bar.close >= bar.open : up
          const body = (NC.hollow && openUp) ? 'rgba(0,0,0,0)' : (up ? NC.up : NC.down)
          return { ...bar, color: body, borderColor: (up ? NC.borUp : NC.borDown), wickColor: (up ? NC.wickUp : NC.wickDown) }
        }
        const _realSet = priceSeries.setData.bind(priceSeries)
        const _realUpd = priceSeries.update.bind(priceSeries)
        priceSeries.setData = (data) => {
          if (!Array.isArray(data)) return _realSet(data)
          let prev = null, lastPrev = null, prevBar = null, lastPrevBar = null
          const painted = data.map((b) => {
            if (b && b.close != null) {
              lastPrev = prev
              lastPrevBar = prevBar
              const out = _paintNet(b, prev, prevBar)
              prev = b.close
              prevBar = { high: b.high, low: b.low }
              return out
            }
            return b
          })
          // Refs the update() wrap reads for the developing bar: prev-of-last & the last bar.
          netPrevCloseRef.current = lastPrev
          lastNetCloseRef.current = prev
          netPrevBarRef.current = lastPrevBar
          lastNetBarRef.current = prevBar
          lastNetTimeRef.current = painted.length ? data[data.length - 1]?.time : null
          return _realSet(painted)
        }
        priceSeries.update = (bar) => {
          if (!bar || bar.close == null) return _realUpd(bar)
          const isNewBar = lastNetTimeRef.current != null && bar.time > lastNetTimeRef.current
          const prevClose = isNewBar ? lastNetCloseRef.current : netPrevCloseRef.current
          const prevBar = isNewBar ? lastNetBarRef.current : netPrevBarRef.current
          const out = _paintNet(bar, prevClose, prevBar)
          if (isNewBar) {
            netPrevCloseRef.current = lastNetCloseRef.current
            netPrevBarRef.current = lastNetBarRef.current
            lastNetTimeRef.current = bar.time
          }
          lastNetCloseRef.current = bar.close
          lastNetBarRef.current = { high: bar.high, low: bar.low }
          return _realUpd(out)
        }
        priceSeries.__uctNetWrap = true
      }
      prevChartTypeRef.current = _priceStyleKey
    }

    // ── Live color apply (no recreate) ── Colors are NOT in the price-style key, so
    // a color change reaches here without destroying the series. For the WRAPPER modes
    // (netchange/onecolor) the per-bar setData below repaints; for OPEN-CLOSE (native,
    // no wrapper) we push the up/down colors onto the series here so the change still
    // lands. Runs every render; cheap applyOptions, and it never re-fits the scale.
    try {
      const NC = netColorsRef.current
      if (_ct === 'candles' || _ct === 'hollow') {
        // Sunrise's TC2000 look = hollow up bodies, enforced at series creation
        // (the `_bold` sunrise options). This live-apply runs every render and
        // would clobber that with a solid NC.up in OPEN-CLOSE mode (where the
        // per-bar wrapper passes through) — so the transparent up body must be
        // kept for Sunrise here too, not just for the explicit 'hollow' type.
        candleSeriesRef.current.applyOptions({
          upColor: (_ct === 'hollow' || canvasTheme === 'sunrise') ? 'rgba(0,0,0,0)' : NC.up,
          downColor: NC.down,
          borderVisible: (_ct === 'hollow') ? true : (canvasTheme === 'sunrise' ? true : !!userCandleColors),
          borderUpColor: NC.borUp, borderDownColor: NC.borDown,
          wickUpColor: NC.wickUp, wickDownColor: NC.wickDown,
        })
      } else if (_ct === 'bars' || _ct === 'hlc') {
        // thinBars rides this same live-apply path (it isn't in the price-style key),
        // so toggling thickness repaints without destroying/recreating the series.
        candleSeriesRef.current.applyOptions({
          upColor: NC.up, downColor: NC.down, openVisible: _ct !== 'hlc',
          thinBars: cs.candles.thinBars !== false,
        })
      } else if (_ct === 'line') {
        candleSeriesRef.current.applyOptions({ color: NC.mode === 'onecolor' ? NC.one : NC.up })
      } else if (_ct === 'area') {
        candleSeriesRef.current.applyOptions({ lineColor: NC.mode === 'onecolor' ? NC.one : NC.up })
      }
    } catch { /* series may be mid-swap */ }

    // Set price data. The separate gold-recolor effect below re-applies the
    // setup-candle highlight right after every updateChart (it lists updateChart
    // as a dep), so we keep plain data here — pulling highlightTimeSet into THIS
    // effect's deps would re-run the whole updateChart (incl. the visible-range /
    // zoom logic) on every focus change and fight the setup focus zoom.
    _applyData(candleSeriesRef.current, isOhlcType(cs.chartType) ? ohlcData : closeData)

    // Store the last bar for live updates
    if (filteredBars.length) {
      const last = filteredBars[filteredBars.length - 1]
      // Use adjustTime so lastBarRef.time matches the chart series + computeBarTime
      lastBarRef.current = { time: adjustTime(last.t), open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 }
      // Trustworthy baseline for live-tick sanity gates: server bars are
      // validated/quarantined upstream and proven clean. Unlike
      // lastBarRef (which a bad tick can bake bad, then good ticks get
      // rejected and the phantom sticks — DDOG 20798 = 100x lock-in),
      // this is ONLY ever set from server data and can't be poisoned.
      if (Number.isFinite(last.c) && last.c > 0) lastServerCloseRef.current = last.c
      // Seed/merge liveBarRef (the ref the push re-top / Writer D re-applies from) with
      // the FETCHED partial bar's FULL open+high+low. Without this, the re-top re-paints
      // the developing bar from a WS rollup that only accumulated since we subscribed,
      // collapsing the current candle to the "since you opened it" window — the reported
      // "bar shows correct data for a moment, then loses it until ~10s after close" bug.
      // Intraday only.
      if (!['D', 'W', 'M'].includes(resolvedTf)) {
        const _lt = adjustTime(last.t)
        const _lb = liveBarRef.current
        if (!_lb || _lb.time !== _lt) {
          liveBarRef.current = { time: _lt, open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 }
        } else {
          // Reconcile the developing bar's H/L against the server bucket, PRESERVING
          // the accumulated live high/low. The live push feed IS the real-time tape
          // (Massive WS) and is now ghost-FILTERED at the source — T-tick prints pass
          // trade_conditions.classify (odd-lot / out-of-sequence / derivatively-priced
          // dropped) and A per-second aggregates no longer fold H/L at all — so the
          // accumulated _lb.high/_lb.low can be trusted. The server REST bucket LAGS the
          // WS by seconds, so trusting it over the live feed is backwards:
          //   Previously this did `Math.max(last.h, _lb.close)` (drop to the server high
          //   bounded by the live close) to heal ghost wicks. But once ghosts are filtered
          //   upstream that only DROPS a REAL fast wick the server hasn't ingested yet —
          //   and Writer D/B re-extend it from the push bar on the very next tick, so the
          //   real high FLICKERS on/off every ~2s reconcile cycle (the reported bug: a wick
          //   the price genuinely traded to, blinking while the candle is developing, then
          //   stable once it closes). Take the max/min of BOTH so a real live extension
          //   stays put and a server correction (higher/lower) is still respected.
          _lb.open = last.o
          _lb.high = Math.max(last.h, _lb.high)
          _lb.low = Math.min(last.l, _lb.low)
        }
      }
    }

    // For the Finnhub re-top below: prefer the frozen tick for THIS ticker; on a
    // ticker switch (latestLiveRef was just reset to null) seed from the
    // synchronously-available shared live cache (livePrices[sym]) so the developing
    // candle paints at the TRUE current price on the FIRST frame instead of the
    // stale server close that otherwise snapped ~1s later when the first tick
    // arrived. Cold/uncached ticker → null → prior ~1s behaviour, no regression.
    // Sane-price guard mirrors Writers A/B (baseline = the just-refreshed server close).
    let _retopLive = (latestLiveRef.current?.sym === sym && latestLiveRef.current?.price)
      ? latestLiveRef.current
      : null
    if (!_retopLive && !barsPushActiveRef.current) {
      // livePrices (the hook) is filtered to THIS chart's subscription, which on a
      // switch hasn't registered the new sym yet → empty on the switch frame. The
      // livePriceStore GLOBAL snapshot holds every ticker any widget tracks
      // (watchlist / movers / themes), synchronously → seed from it as a fallback.
      const _cached = livePrices[sym] || getLivePriceStoreSnapshot()[sym]
      const _cachedPx = _effLivePrice(_cached)
      if (_cachedPx && isSaneLivePrice(_cachedPx, lastBarRef.current?.close, lastServerCloseRef.current)) {
        _retopLive = {
          sym, price: _cachedPx, updated_at: _cached.updated_at,
          day_open: _cached.day_open, day_high: _cached.day_high,
          day_low: _cached.day_low, prev_close: _cached.prev_close,
          ext_session: !!_cached.ext_session,
        }
      }
    }

    // Writer D freeze: while a provisional stale-intraday cache is on screen, apply NO
    // live developing bar over the old tail — null the Finnhub re-top and skip the push
    // branch below. The forced full refetch swaps in fresh bars, then writers resume.
    if (provisionalStaleRef.current) _retopLive = null

    // Re-apply the live developing bar immediately after setData() to prevent snap-back —
    // setData() overwrites with API data (stale by seconds/minutes).
    if (barsPushActiveRef.current && !provisionalStaleRef.current) {
      // Writer D of the single-writer invariant (index @ barsPushActiveRef decl) — a BRANCH,
      // not a guard: push authoritative → re-top with the PUSH-owned developing bar (liveBarRef,
      // maintained by onRealtimeBar), NOT the frozen Finnhub latestLiveRef. Without this
      // the ~30s-stale server developing bar from _applyData would seam every SWR poll
      // (review #7). Guard time-regress (server tail may be ahead of the last push bar).
      const lb = liveBarRef.current
      if (lb && lb.time != null && Number.isFinite(lb.close) && lb.close > 0) {
        try {
          if (isOhlcType(cs.chartType)) {
            candleSeriesRef.current.update({ time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close })
          } else {
            candleSeriesRef.current.update({ time: lb.time, value: lb.close })
          }
          // Restore the push-owned volume too — else the volume bar shows ~30s-stale server
          // volume until the next AM push (a flicker every SWR poll, retro-audit #5).
          if (volumeSeriesRef.current && Number.isFinite(lb.volume)) {
            const _pbD = prevBarsRef.current
            const _prevCD = colorByNetChange && _pbD && _pbD.length >= 2 ? _pbD[_pbD.length - 2].c : null
            const _upD = _prevCD != null ? (lb.close >= _prevCD) : (lb.close >= lb.open)
            // Full-opacity default color (same derivation as volData) — no lighter tint.
            const _vUpD = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDownD = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            volumeSeriesRef.current.update({
              time: lb.time, value: lb.volume,
              color: _upD ? _vUpD : _vDownD,
            })
          }
        } catch { /* server tail newer than the last push bar — ignore, next push bar re-tops */ }
      }
    } else if (_retopLive?.price && lastBarRef.current
               && !(['D', 'W', 'M'].includes(resolvedTf)
                    && (sessionOwnsDailyRef.current
                        || (sessionViewRef.current === 'regular' && _retopLive.ext_session)))
               && !(!['D', 'W', 'M'].includes(resolvedTf)
                    && !showExtendedRef.current && _retopLive.ext_session)) {
      // Skip the D/W/M re-top while session preview owns the bar (the memo-driven
      // setData above already painted the synthetic/frozen candle) OR when a
      // Regular-Hours daily chart got an extended-hours print (same lag-independent
      // guard as Writer A). Also skip an RTH-only INTRADAY re-top of an ext print
      // (Writers B/C already drop the live ext bar; don't let the re-top re-add it).
      const lp = _retopLive.price
      const tickSec = _retopLive.updated_at
      const last = lastBarRef.current
      const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
      const liveSnap = _retopLive
      // Same shared classifier as the tick effect — start today's bar from the
      // snapshot even on the REST floor (no updated_at), never fuse onto a stale
      // prior-session candle. 'skip' = new D/W/M day, session unconfirmed.
      const decision = classifyLiveBar({
        tf: resolvedTf, last, live: liveSnap, tickSec, nowSec: Date.now() / 1000,
      })
      const barTime = decision.time != null ? decision.time : last.time

      // Use liveBarRef if available — it has tick-accurate high/low that survives setData()
      const lb = liveBarRef.current

      if (decision.kind === 'new') {
        const isDW = !isIntradayTf
        // A NEW bucket must NOT inherit O/H/L from liveBarRef — that's the PREVIOUS
        // bar (decision.kind==='new' ⇒ lb.time !== barTime). Fusing lb.low gave a
        // freshly-opened intraday candle the prior candle's low (the "current candle's
        // low extends to the last candle" glitch on a 5m switch, seeded by the stale
        // provisional tail in liveBarRef). Gate the fusion on a bucket-time match, so a
        // new intraday bar starts clean from the tick — matching Writers A + B.
        const _lbSame = lb && lb.time === barTime
        const openPrice = (isDW && liveSnap.day_open) ? liveSnap.day_open : (_lbSame ? lb.open : lp)
        const highPrice = isDW ? Math.max(liveSnap.day_high || openPrice, lp) : (_lbSame ? Math.max(lb.high, lp) : lp)
        const lowPrice = isDW ? Math.min((liveSnap.day_low && liveSnap.day_low > 0) ? liveSnap.day_low : openPrice, lp) : (_lbSame ? Math.min(lb.low, lp) : lp)
        const newBar = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: lp }
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update(newBar)
        } else {
          candleSeriesRef.current.update({ time: barTime, value: lp })
        }
        liveBarRef.current = { ...newBar }
        lastBarRef.current = { ...newBar, volume: 0 }
      } else if (decision.kind === 'skip') {
        // New day for D/W/M but no confirmed session — don't corrupt yesterday's bar
      } else {
        // Same bar — restore tick-tracked high/low from liveBarRef
        const high = lb ? Math.max(lb.high, lp) : Math.max(last.high, lp)
        const low = lb ? Math.min(lb.low, lp) : Math.min(last.low, lp)
        last.high = high
        last.low = low
        last.close = lp
        if (lb) { lb.high = high; lb.low = low; lb.close = lp }
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update({ time: last.time, open: last.open, high, low, close: lp })
        } else {
          candleSeriesRef.current.update({ time: last.time, value: lp })
        }
      }
    }

    // ── THE INDICATOR ENGINE (Phase B) — what it owns, decided here ───────────
    //
    // ⭐⭐ B5 TASK 4 DELETED THE FLAG THAT USED TO BE READ HERE.
    //
    // What stood here was `const engineOn = cs.engineEnabled === true`, with two
    // paragraphs explaining that the engine "LANDS DARK" until a user opts in.
    // It never landed dark for anybody: `mergeChartSettings` computed the flag
    // from the STORED BLOB, every blob in production predates the engine, and no
    // action a user could take set it — so the opt-in was permanently off and the
    // engine drew the flipped ids regardless, which is the only reason B3 shipped.
    // A flag in that state is not an off switch, it is a branch nothing reaches.
    // Record: `docs/decisions/2026-08-04-engine-enabled-deleted.md`.
    //
    // ⛔ THE DARK CONTRACT SURVIVES IT, AND MOVED TO A HONEST PREDICATE. A chart
    // with no instances still constructs no binder and makes zero
    // lightweight-charts calls — see `engineNeeded` below, which asks
    // `engineInstances.length > 0`. That is what the flag was supposed to mean and
    // it is now measured from the thing that decides it.
    //
    // ── FLIP B: A FLIPPED DEFINITION HAS NO OTHER RENDERER ───────────────────
    //
    // The engine is ACTIVE whenever something is flipped, because for a FLIPPED id
    // there is no hand-written block left: gating it on anything would not make
    // the engine dark, it would DELETE the indicator.
    //
    // ⚠️ `engineDrawsAnything()` IS A CONSTANT TODAY and is deliberately
    // still spelled as a read: it is the seam Task 13 turns into a registry lookup
    // once every native is flipped. The `sync` CALL is further down, immediately
    // before where the Bollinger block used to be — see the note there for why the
    // position is load-bearing.
    const engineActive = engineDrawsAnything()
    // Normalised on the way in: a tombstone or a malformed record must never
    // reach the planner. Cheap enough to do per paint at v1 instance counts, and
    // it only ever runs with the engine ON.
    //
    // …and then filtered to the definitions whose legacy block actually stands
    // down. See `ENGINE_OWNED`: an instance the engine DRAWS whose
    // legacy block still draws too is a double-drawn indicator, and nothing about
    // that is visible until a user reports a "bold" line. The filter makes the
    // pairing structural instead of a thing B3 has to remember.
    //
    // ── FLIP A: THE LEGACY TOGGLE IS STILL THE SWITCH ────────────────────────
    //
    // …and the instance is only the RENDERER. FOUR controls write
    // `cs.indicators.<id>.enabled`: the toolbar checkbox (`ChartToolbar.jsx:396`),
    // Ctrl+I (`keyboardShortcuts.js:99` → `:3495`), the right-click
    // **Indicators ▸** submenu (`:2214`) and right-click **Hide RSI** (`:2251`).
    // Without this line every one of them SILENTLY HALF-WORKED once the engine
    // owned the drawing: the flag reached the BAND LAYOUT and nothing else,
    // so turning RSI off removed its reserved BAND and left the line behind —
    // and `resolvePlacement` then fell through to `{top:0.82, bottom:0}`
    // (`placement.js:103`), which OVERLAPS volume's `{top:0.85, bottom:0}`. The
    // user pressed Ctrl+I and got an RSI drawn on top of the volume bars.
    //
    // `hidden`, not "dropped from the list": `engineOwnedDefIds` counted hidden
    // instances, so the legacy block stayed stood down and no toggle could hand the
    // drawing back to it mid-session. (It has no data to draw either way — a
    // legacy block's `indicatorData` branch is `[]` while its toggle is off — but
    // ownership is a rail, not a coincidence.) ⚠️ RSI is no longer the example:
    // it is FLIPPED, so it has no block, no branch and no toggle-as-switch. The
    // paragraph now describes `macd` and `vwap`, which are still Flip A.
    //
    // ── WHAT `hidden` COSTS, STATED CORRECTLY: IT IS `removeSeries`. ──────────
    //
    // An earlier version of this comment said the binder "releases the series to
    // the POOL, so this is an applyOptions-and-park, never the mass
    // `removeSeries` of #2049". **That was false**, and the branch's own test
    // proves it: `planBindings` drops a hidden instance on its first line
    // (`pool.js:652`), so nothing claims its binding, so it lands in
    // `release = prev.filter(p => !claimed.has(p))` (`pool.js:743`) and
    // `binder.sync` step 3 calls `chart.removeSeries` (`binder.js:316`) —
    // `stockChartWiring.test.jsx` asserts exactly that (`H.removedSeries`
    // contains it, and re-showing costs a second `addSeries`).
    //
    // **Removal is the RIGHT behaviour here, deliberately, and it is not the
    // #2049 pattern.** Three reasons, in order of what would break first:
    //
    //   1. **PARITY — a parked series would not be invisible, it would be a
    //      LAYOUT CHANGE.** MEASURED against the real bundle in
    //      `engine/__tests__/hiddenIsRemovedNotParked.test.js`: `visible:false`
    //      does NOT release the pane (`chart.panes()` still has it, it still
    //      owns the series, it still claims a stretch factor); `removeSeries`
    //      does. Park RSI and its pane survives the toggle — the price pane
    //      stays short with an empty band under it, while the legacy path gives
    //      the height back. Flip A's whole contract is pixel-identity with
    //      legacy, so parking would fail the gate, and `engine_rsi_toggle_off`
    //      is the pixel case that would catch it.
    //   2. **The churn #2049 is about is MASS removal, and the pool already
    //      prevents that.** `planBindings` releases only what NOTHING in the
    //      same pass can use: an exact-key carry-over keeps its series, and an
    //      unmatched binding re-purposes a compatible one from the pool FIRST
    //      (step 3), so "RSI off + BB on in one settings write" hands BB the
    //      line series RSI just gave up instead of removing one and creating
    //      another. What is left over is genuinely wanted by nobody.
    //   3. It is one series, on an explicit user action, matching what the
    //      legacy block has always done on the same keystroke.
    //
    // ⛔ SO THE RAIL IS: never make visibility a per-PAINT decision. Toggling on
    // a user action is fine; projecting `hidden` from something that recomputes
    // every frame (a hover, a crosshair move, an extended-hours tick) would turn one
    // removeSeries into fifteen a second, and THAT is #2049. Task 10 projects
    // four pilots and Phase B eventually fifteen — the number that matters is
    // removals per USER ACTION, not per indicator.
    //
    // ⭐ RESOLVED BY TASK 10, PER DEFINITION — not deleted wholesale. Flip B moves
    // the authority the other way for a FLIPPED id: the geometry reads the
    // INSTANCE LIST (through `computePaneLayout`; before Flip C it was
    // `csForPaneMargins` projecting that list onto a settings blob), and
    // `instanceControls` routes every write at the instance. The two rules are
    // mirror images and cannot both hold for one definition — an instance whose
    // legacy toggle is false would reserve a band (the projection) that this line
    // then made sure nothing drew into. So the `hidden` projection below now
    // SKIPS `ENGINE_OWNED` and still applies to `macd` and `vwap`,
    // which are Flip A and whose legacy toggle is still their switch. Deleting it
    // outright would have un-done Flip-A semantics for both of them in a task
    // whose gate is that only rsi and bb move.
    //
    // ⚠️ A migrated definition whose enable signal is NOT `indicators.<id>.enabled`
    // needs its own answer here before it joins `ENGINE_OWNED`. VWAP is
    // that definition, it joined in Task 8, and its answer is the `vwap` branch
    // below: the legacy memo reads `(vwapOverride || ind.vwap?.enabled)` (`:3962`),
    // so the OVERRIDE alone is an enable signal and the projection has to agree or
    // the Model Book popup would hand the engine a hidden instance and draw nothing.
    // …filtered to the definitions whose legacy block actually stands down (see
    // `ENGINE_OWNED`), then narrowed by ELIGIBILITY: a session
    // indicator does not exist above 60-minute bars, and the render context —
    // the Model Book's forced white, the bold-candle hairline — folds into the
    // instance's inputs here so nothing downstream has to know about it.
    //
    // `vwapOverride` also FORCES the indicator on, exactly as the legacy memo
    // does. That is an instance this blob does not contain, so it is manufactured
    // HERE where instances are built, never inside `eligibility` — a hook that
    // could invent instances would hand the binder an instance that never passed
    // through this list at all.
    const engineInstances = engineActive
      ? (() => {
          // ── READ-TIME MIGRATION, GATED ON THE FLIP SET ───────────────────────
          //
          // After Flip B the instance list is the authority, but a blob carrying
          // only the legacy toggle must still render — a grid cell's
          // `settingsOverride`, the `?indicators=` route, a user who has not
          // touched a control since the flip. `migrateLegacyToInstances` projects
          // the toggle into an instance, a STORED instance wins over the
          // projection, and a TOMBSTONE reserves the id so a still-true legacy
          // toggle cannot put a deleted indicator back. All three are pinned in
          // `instances.test.js`. It is a fixed point, so running it every paint is
          // safe; it is pure, so it writes nothing.
          //
          // ⛔ BUT IT CHANGES BEHAVIOUR THE MOMENT IT IS UNGATED, which is why it
          // is not. The migrator projects `cs.indicators.rsi.enabled` into an
          // instance even with nothing flipped, and `ENGINE_OWNED`
          // already held rsi/bb/macd/vwap — so an ungated version would have moved
          // all four onto the engine for every user, with no stored instance
          // anywhere. That is *correct* for Flip A (the engine draws the same
          // picture) but it was a behaviour change inside a task whose gate is
          // "nothing changed".
          //
          // ⚠️ AND THE GATE IS PER DEFINITION, NOT `size > 0`. A whole-set gate
          // is inert only until the FIRST flip, and then it moves all four pilots
          // at once — which is precisely what flipping one indicator at a time
          // with a pixel number each is supposed to prevent. So a PROJECTED
          // instance is accepted only for a flipped id; anything the blob already
          // STORED (including a tombstone) passes through untouched, exactly as
          // it does today. `flipBWithANonEmptySet.test.jsx` drives this with a
          // non-empty set and asserts an un-flipped `bb` is not projected.
          const stored = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
          const storedIds = new Set(
            stored.map(i => (i && typeof i === 'object' ? i.instanceId : undefined)),
          )
          // ⭐ …AND A DEFINITION THE BLOB ALREADY DRAWS IS NOT PROJECTED AGAIN.
          //
          // 🐛 THE DOUBLE-DRAW THIS PHASE EXISTS TO PREVENT, IN A NEW GUISE.
          // `migrateLegacyToInstances` reserves ids PER INSTANCE ID (`legacy:rsi`),
          // which is right for its own contract — two instances of one definition
          // are legal. But the legacy TOGGLE is per DEFINITION, and it is a
          // compatibility shim for a blob that has no instance for that definition
          // at all. A blob holding `{instanceId: 'engine-test:rsi', defId: 'rsi'}`
          // plus `indicators.rsi.enabled: true` therefore projected a SECOND
          // `legacy:rsi` and drew TWO RSI lines — a `?instances=` URL, a grid
          // cell's override or any custom-id instance is enough to reach it.
          // `isIndicatorEnabled` already answers "a LIVE instance of the
          // definition wins", so the migrator and the checkbox disagreed too.
          //
          // Applied HERE and not inside the migrator: the per-id contract is
          // correct for every other caller, and the rule that a projection is
          // outranked by a live instance of the same DEFINITION belongs to the
          // read that turns instances into pixels.
          // ⚠️ HIDDEN COUNTS. `normalizeInstances` keeps a hidden instance and
          // drops a tombstone — exactly the line "does this definition EXIST in
          // the blob" needs. A tombstone must NOT count (its whole job is to let
          // "off" survive a still-true toggle), and it blocks the projection by
          // its id anyway, inside the migrator's own `taken` set.
          const liveStoredDefIds = new Set(
            normalizeInstances(stored, engineRegistry).kept.map(i => i.defId),
          )
          const source = engineDrawsAnything()
            ? migrateLegacyToInstances(cs, engineRegistry)   // instances are the authority…
              .filter((i) => {
                if (storedIds.has(i && i.instanceId)) return true   // stored: always
                if (!ENGINE_OWNED.has(i && i.defId)) return false  // …projected: FLIPPED only
                return !liveStoredDefIds.has(i.defId)              // …and not already drawn
              })
            : cs.indicatorInstances                          // Flip A: only STORED instances draw
          const migrated = normalizeInstances(source, engineRegistry).kept
            // ⚠️ ONE GATE NOW, AND IT USED TO BE TWO (B5 Task 4). The second read
            // `|| (engineOn && ENGINE_OWNED.has(i.defId))` — a
            // MIGRATED-but-UN-FLIPPED id is the engine's only while the flag is on.
            // With the flag deleted that disjunct is `false && …` for every
            // instance, and the category it served has been empty since Flip B and
            // may not be re-created (`enumerationSites.test.js` refuses it while
            // FLIPPED === MIGRATED). Deleting it is behaviour-identical TODAY and
            // stops a dead disjunct reading as live logic.
            .filter(i => ENGINE_OWNED.has(i.defId))
            // ⛔ …AND FLIP A'S `hidden` PROJECTION IS GONE (B3 Task 11). It read
            // "an instance of a MIGRATED-but-UN-FLIPPED definition whose legacy
            // toggle is false is projected to hidden, because the toggle is still
            // that definition's switch". `ENGINE_OWNED` now EQUALS
            // `ENGINE_OWNED`, so the filter above cannot emit an
            // un-flipped instance and the branch was unreachable — an inert
            // `.map` whose absent subject nothing would have noticed. Deleted with
            // its `legacyEnabled` helper rather than left to read as live logic.
            //
            // ⚠️ IT COMES BACK IF B4 MIGRATES WITHOUT FLIPPING. `flipB.test.jsx`
            // asserts the two sets are EQUAL, so that day this decision is
            // re-opened by a red test rather than by a double-drawn indicator.
          // ⭐ `vwapOverride` FORCES A VWAP INSTANCE, UNCONDITIONALLY (B3 Task 11).
          // It used to be gated on the engine flag, because `vwap` was un-flipped
          // and its legacy block would otherwise have drawn a second copy. VWAP is
          // flipped now: there IS no legacy block, so the flag-gated version would
          // have taken the Model Book intraday popup's forced white VWAP off every
          // existing user's chart — the flag was false in every stored blob, and
          // the popup is a surface no user setting can turn off. B5 Task 4 deleted
          // the flag outright, which retires the question.
          // Driven in `flipB.test.jsx` ("vwapOverride still forces it on").
          const withForced = (vwapOverride && !migrated.some(i => i.defId === 'vwap'))
            ? [...migrated, {
                instanceId: legacyInstanceId('vwap'), defId: 'vwap',
                // ⚠️ FILTERED TO DECLARED INPUT KEYS. This instance never passes
                // through `validateInstance` — it is manufactured after
                // `normalizeInstances` has already run — so an undeclared key from
                // the blob (`enabled`, which every legacy indicator carries) would
                // reach `inputsSignature` and the folds unchecked. The validator
                // would have rejected it; this does the same job explicitly.
                inputs: Object.fromEntries(
                  (engineRegistry.getDefinition('vwap')?.inputs || [])
                    .map(d => d.key)
                    .filter(k => cs.indicators?.vwap?.[k] !== undefined)
                    .map(k => [k, cs.indicators.vwap[k]])),
                placement: { target: 'price' }, hidden: false,
              }]
            : migrated
          return eligibleInstances(withForced, engineRegistry, {
            tf: resolvedTf, vwapOverride, boldCandles, modelBookLook,
          }).kept
        })()
      : EMPTY_INSTANCES
    // Mirrored for the crosshair legend (B3 carry #2). The handler needs each
    // instance's INPUTS to print `RSI(7)` and to colour the chip the way the
    // line is coloured, and it reads refs rather than props so a live tick does
    // not tear down and re-subscribe it.
    engineInstancesRef.current = engineInstances
    // ── WHICH LEGACY BLOCKS STOOD DOWN — AND WHY THERE IS NO ARBITER HERE ────
    //
    // 🔴 A BINDING STOOD HERE AND IT HAD ZERO READERS. What was on this line was
    //
    //     const engineOwned = engineActive ? engineOwnedDefIds(…) : EMPTY_OWNED
    //
    // and — measured comment-stripped at B5 Task 1 — `engineOwned` occurred
    // exactly ONCE in this whole file: its own declaration. The import, the
    // `EMPTY_OWNED` constant and `engineOwnedDefIds`' only production call site in
    // `app/src` existed to compute a value nothing read. B5 Task 4 deleted the
    // chain; this paragraph replaces it, in the past tense, because "why is there
    // no arbiter?" is a question the next reader would otherwise ask of an empty
    // space.
    //
    // **What it was.** Flip A put the engine's series in the SAME band on the SAME
    // scale as the legacy block, and that band existed only while
    // `cs.indicators[key].enabled` was true (the retired `computePaneMargins`
    // read exactly that). So the legacy toggle had to stay ON for the layout to
    // be identical —
    // which meant the legacy block would draw a SECOND copy on top.
    // `engineOwnedDefIds` was the arbiter: an instance of definition `X` meant the
    // engine drew X, and X's legacy block guarded on `!engineOwned.has('X')`.
    //
    // **Why it died silently.** Flip B DELETED the blocks rather than guarding
    // them, so the last consumer went with `macd` and `vwap` at `400005ee`. And
    // `enumerationSites.test.js` → *"keeps no Flip-A guard for a flipped id — the
    // block should be GONE, not guarded"* asserts `engineOwned.has('<id>')` is
    // ABSENT for every flipped id while `FLIPPED === MIGRATED` — so that rail
    // DEMANDS the emptiness it produced, and the leftover it leaves behind is
    // invisible to it by construction. Five comment paragraphs in this file went on
    // calling it "the arbiter" for two phases.
    //
    // ⚠️ `engineOwnedDefIds` ITSELF IS NOT DEAD — it keeps its own suite in
    // `engine/instances.test.js`. Only StockChart's call was.

    // ── Volume-pane indicator overlay ──
    // Chosen oscillators render INSIDE the volume pane on its left axis (volume
    // keeps the right axis) instead of their own stacked band. This requires a
    // real volume pane, so any overlay forces separate-pane mode.
    const volOverlaySet = new Set(
      (showVolume && Array.isArray(cs.volumeOverlayIndicators)) ? cs.volumeOverlayIndicators : [],
    )

    // ── Volume series — overlay band in pane 0 (default) OR its own pane 1 ──
    // Separate-pane mode uses a real LW Charts pane (3rd addSeries arg) with a
    // draggable divider; overlay mode shares pane 0 via the layout's bands.
    const volSeparatePane = volInSeparatePane || volOverlaySet.size > 0
    const hasVolumeBand = showVolume && volData.length > 0 && !volSeparatePane
    const VOL_PANE_INDEX = 1

    // ── FLIP C, APPLIED: THE SAME STACK, AS REAL PANES ───────────────────────
    //
    // ⛔ COMPUTED IN BOTH MODES, WHICH IT WAS NOT BEFORE TASK 12. It used to be
    // `null` under `'bands'` because it duplicated a `computePaneMargins` call
    // nothing read. That second copy is what retired: the layout IS the band
    // arithmetic now (`layout.bands`), so computing it once per sync is strictly
    // cheaper than the two calls it replaces, and every consumer — the candles'
    // margins, the volume band, the right-click resolver, the binder — reads ONE
    // object instead of two that could disagree.
    //
    // The height comes from the RENDERER (`paneStackHeightPx`), not from the
    // container: the budget LWC distributes is the chart's height minus the time
    // axis, and the time axis' height is the renderer's own business. It is the
    // same number `paneManifest` reports as `chartHeight`, on purpose — a layout
    // and a manifest that disagree about the budget cannot be compared.
    //
    // `firstPaneIndex` says where the oscillator stack STARTS, because a separate
    // volume pane and the Model Book's index pane sit between it and pane 0. Both
    // are read from what exists RIGHT NOW; if that is ever wrong the binder's
    // height check says so by name rather than drifting a pixel.
    //
    // ⭐ AND `abovePct` SAYS WHAT THOSE PANES MEASURE IN BANDS MODE — the ONE
    // input `computePaneLayout` was missing, and the reason B5 Task 11 measured
    // three separate defects (see paneLayout.js "THE FRAME OF REFERENCE"). These
    // are the SAME two clamped percentages the volume block below applies with
    // `setStretchFactor`, hoisted so there is one authority rather than two
    // expressions that can drift; `stockChartWiring.test.jsx` asserts the layout
    // is handed exactly what the renderer is told.
    //
    // ⛔ SETTINGS, NOT THE RENDERER. Reading the live stretch factors back would
    // work on the first sync and never again: this layout WRITES pixel counts
    // into those factors, so pass two would read `[353, 99]` as if it were the
    // 78/22 the settings say and re-derive a different reference every pass.
    // ⭐ …AND A USER'S DRAG OUTRANKS THE SETTING, which is what makes the divider
    // stay where it was dropped. `layout.above` is re-asserted by the binder at
    // the end of every sync, so the ONLY way a drag survives is for the layout to
    // be computed from it. `resolveVolPanePct` falls back to the setting the
    // instant the setting itself moves, so Settings still wins a genuine change.
    // ⚠️ The other three readers of this expression (the index-pane effects and
    // the range-grip position) stay settings-only ON PURPOSE: they run on a prop
    // change, never on a data poll, so none of them can snap a drag back on its
    // own — and the layout must have exactly one authority.
    // `?? 22` because clampVolPct answers null for a value it cannot read; the
    // expression this replaced produced NaN there, which reaches the layout and
    // gives the volume pane 0 px.
    const _volPctSetting = clampVolPct(volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22) ?? 22
    volPctSettingRef.current = _volPctSetting
    const _volPct = resolveVolPanePct(_volPctSetting, volDragLatchRef.current)
    const _idxPct = Math.min(40, Math.max(8, indexPaneHeightPct ?? 18))
    // The index pane is hoisted to pane 0 (`s.getPane().moveTo(0)` below), so it
    // comes FIRST in pane order and the candles are pane 1 when it exists.
    const _hasIdxPane = !!indexPaneSeriesRef.current
    const _abovePct = _hasIdxPane
      ? (volSeparatePane
        ? [_idxPct, Math.max(20, 100 - _volPct - _idxPct), _volPct]
        : [_idxPct, 100 - _idxPct])
      : (volSeparatePane ? [100 - _volPct, _volPct] : [100])
    const paneLayout = computePaneLayout(engineInstances, {
      chartHeight: paneStackHeightPx(chart),
      hasVolumeBand,
      excludeKeys: volOverlaySet,
      separatorPx: SEPARATOR_PX,
      firstPaneIndex: 1 + (volSeparatePane ? 1 : 0) + (_hasIdxPane ? 1 : 0),
      abovePct: _abovePct,
      mainPaneIndex: _hasIdxPane ? 1 : 0,
    })
    paneLayoutRef.current = paneLayout
    // The BAND map — what `computePaneMargins(csMargins, hasVolumeBand,
    // volOverlaySet)` returned, key for key, off the same quantised stack. Read
    // by the volume band below, by `placement.js`'s `'bands'` branch through the
    // binder ctx, and by the right-click region resolver.
    const paneMargins = paneLayout.bands

    // ⛔ AND THE CANDLES' OWN MARGINS HAVE TO BE RE-ASSERTED HERE, NOT LEFT TO
    // THE OPTIONS EFFECT. MEASURED at B5 Task 10: `rightPriceScale.scaleMargins`
    // is built in the chart-options effect, which runs BEFORE this one on the
    // first paint — so `paneLayoutRef` is still `null` there and the FIRST
    // painted frame carries the wrong rectangle. Every parity case is a fresh
    // page load, so the first frame is the only one photographed: Task 12 would
    // have measured the price pane in the wrong place and the §A6 identity would
    // have looked broken when only the ordering was.
    //
    // ⚠️ WHAT THAT FIRST FRAME CARRIES CHANGED AT TASK 12, and the sentence above
    // used to name it: it was the BANDS rectangle, because `_mainMargins` fell
    // back to `computePaneMargins`. It is now `NO_STACK_MAIN_MARGINS` — the
    // no-stack answer — because the helper takes a layout and there isn't one
    // yet. Same defect, same fix, different wrong rectangle.
    //
    // A user who has DRAGGED the price axis outranks the layout, exactly as
    // `vertMarginsRef` outranks `_mainMargins` in the options effect.
    if (!vertMarginsRef.current) {
      try {
        mainPriceScale()?.applyOptions({
          scaleMargins: _mainMargins(
            paneLayout, priceScaleTopMargin,
            volInSeparatePane ? priceScaleBottomMargin : null,
          ),
        })
      } catch { /* one bad scale must not take the paint down */ }
    }
    // ⛔⭐ `indTarget` / `ensureIndTarget` / `applyIndScale` STOOD HERE AND WENT
    // WITH THE LAST THREE RENDER BLOCKS (B5 Task 8) — they had no other callers.
    // Together they were the legacy lane's placement: which pane and which named
    // price scale an oscillator lands on, whether the volume-overlay toggle moved
    // it to the volume pane's shared left axis, and what to assert on that scale.
    // `engine/placement.js` answers all three now, as a PURE function returning
    // `{paneIndex, scaleId, scaleOptions, autoscale}` — and `volOverlaySet` and
    // `VOL_PANE_INDEX` above are handed to it at the sync call rather than closed
    // over here.
    //
    // ⚠️ ONE OF THEM WAS A DESTROY/RECREATE AND THAT IS THE UPGRADE, not a
    // like-for-like move: `ensureIndTarget` REMOVED an indicator's series and
    // nulled its ref whenever its target scale changed, so every volume-overlay
    // toggle destroyed and rebuilt the series — the exact pattern LWC #2049
    // (still open) makes unsafe. The binder relocates the SAME series object with
    // `moveToPane` + `moveSeriesToScale`, which `stockChartWiring.test.jsx` drives
    // mid-session in both directions.

    if (showVolume && volData.length) {
      // Separate-pane volume sits on the pane's RIGHT axis (visible) so an
      // overlaid indicator can take the LEFT axis. Overlay mode keeps the
      // invisible overlay scale ('').
      const volScaleId = volSeparatePane ? 'right' : ''
      // Bar style: 'columns' = the built-in HistogramSeries (full-slot bars, the
      // long-standing look); 'histogram' = ThinVolumeSeries (custom series drawing
      // thin bars with a gap between each, TC2000-style).
      const volBarStyle = cs.volume?.barStyle === 'histogram' ? 'histogram' : 'columns'
      // priceScaleId / paneIndex / series TYPE are fixed at creation, so recreate
      // when the target scale OR the bar style changes. The ref stores a composite
      // key (was just the scale id) — only ever compared for equality.
      const volSeriesKey = `${volScaleId}|${volBarStyle}`
      if (volumeSeriesRef.current && volumeSeparatePaneRef.current !== volSeriesKey) {
        try { chart.removeSeries(volumeSeriesRef.current) } catch {}
        volumeSeriesRef.current = null
      }
      if (!volumeSeriesRef.current) {
        const volOpts = {
          // Custom (not type:'volume') so the ThinVolumeSeries custom series
          // abbreviates its axis too — see formatVolumeAxis. minMove:1 keeps the
          // gridlines on whole-share intervals (identical look to type:'volume').
          priceFormat: { type: 'custom', formatter: formatVolumeAxis, minMove: 1 },
          priceScaleId: volScaleId,
          // Model Book: no dashed last-volume price line / axis tag.
          priceLineVisible: !boldCandles && !hidePriceLine,
          // volumeLastValue opt-in shows the current-volume tag on the right scale
          // (mirrors the main chart's price tag) even in the bold/charts-workspace look.
          lastValueVisible: volumeLastValue || (!boldCandles && !hidePriceLine),
        }
        const vs = volBarStyle === 'histogram'
          ? chart.addCustomSeries(new ThinVolumeSeries(), volOpts, volSeparatePane ? 1 : 0)
          : chart.addSeries(HistogramSeries, volOpts, volSeparatePane ? 1 : 0)
        volumeSeriesRef.current = vs
        volumeSeparatePaneRef.current = volSeriesKey
        lastAppliedVolPctRef.current = null  // fresh pane → force the height (re)apply below
      }
      if (volSeparatePane) {
        // Own pane: small top margin so bars don't kiss the divider; size the
        // pane to ~22% of the chart via stretch factors (main pane gets the rest).
        // autoScale keeps the bars fitted to the SAME slice of the pane on every
        // ticker/timeframe (a dragged volume axis otherwise pins a fixed range that
        // makes a lower-volume name's bars tiny) — re-applied each pass so an
        // accidental axis drag always snaps back to a consistent auto-fit.
        // minimumWidth: v5 aligns all panes to one shared axis column — the VOLUME
        // pane's scale was never pinned, so its developing-bar tag ("185.71K" →
        // "1.02M") re-measuring on every ~1s live volume update could exceed the
        // main pane's pinned width and re-flow the shared column each tick — the
        // whole plot shakes left-right once a second. Pin it to the same floor.
        volumeSeriesRef.current.priceScale().applyOptions({ borderVisible: false, autoScale: true, minimumWidth: _axisMinWidth, scaleMargins: { top: 0.12, bottom: 0 } })
        try {
          // Stretch factors are relative. Address panes by their series' own
          // pane object (getPane) rather than raw index, so an index-comparison
          // pane on top (Model Book) doesn't get mis-sized when this re-runs.
          // ⛔ THE SAME `_volPct` / `_idxPct` THE LAYOUT WAS HANDED, not a second
          // copy of the clamps: `computePaneLayout`'s whole bands-mode reference
          // is "what these two `setStretchFactor` calls produce", so a drift
          // between the two expressions is a layout computed against a chart that
          // does not exist. One authority, declared above the layout call.
          const pct = _volPct
          const mainPane = candleSeriesRef.current?.getPane?.()
          const volPane = volumeSeriesRef.current?.getPane?.()
          // Only (re)apply when the TARGET height changed — otherwise a periodic
          // data-poll re-run would snap the pane back and undo a user's drag.
          if (mainPane && volPane && lastAppliedVolPctRef.current !== pct) {
            lastAppliedVolPctRef.current = pct
            if (indexPaneSeriesRef.current) {
              const idxPct = _idxPct
              try { indexPaneSeriesRef.current.getPane().setStretchFactor(idxPct) } catch {}
              volPane.setStretchFactor(pct)
              mainPane.setStretchFactor(Math.max(20, 100 - pct - idxPct))
            } else {
              mainPane.setStretchFactor(100 - pct)
              volPane.setStretchFactor(pct)
            }
          }
        } catch {}
      } else {
        // FLIP C: the volume row is still a BAND inside pane 0 (volume is not an
        // indicator instance and gets no pane of its own), but pane 0 is shorter,
        // so its fractions are the layout's — the same re-expression the candles'
        // own margins get above.
        const volMargins = (paneMode() === 'panes' ? paneLayout.pane0.volumeMargins : null)
          || paneMargins.volume || { top: 0.82, bottom: 0 }
        volumeSeriesRef.current.priceScale().applyOptions({ autoScale: true, scaleMargins: volMargins })
      }
      _applyData(volumeSeriesRef.current, volData)
      // Re-top the developing VOLUME bar to the live bucket, mirroring the candle
      // re-top above. On a settings change updateChart re-runs and this setData reverts
      // the volume series to volData; when a bucket has rolled LIVE but SWR hasn't
      // refetched yet, volData's last bar is the PREVIOUS (full, often HVC-gold) bucket,
      // so it renders as the current bar — the reported "volume bar shoots up then
      // reverts" spike. Only fires during that roll-gap (live bar strictly newer than
      // volData's last). Push tracks liveBarRef.volume; the Finnhub/REST path has no live
      // volume, so it paints ~0 until the next fetch fills it (Writer A's new-bar default).
      {
        const _lb = liveBarRef.current
        const _vLast = volData.length ? volData[volData.length - 1] : null
        if (_lb?.time != null && _vLast && _lb.time > _vLast.time) {
          const _vUpN = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
          const _vVal = Number.isFinite(_lb.volume) ? _lb.volume : 0
          try { volumeSeriesRef.current.update({ time: _lb.time, value: _vVal, color: _vUpN }) } catch { /* time regressed / disposed */ }
        }
      }

      // Subtle smooth volume MA line on the same pane/scale as the bars.
      if (volMaPeriodEff && volMaData.length) {
        // candleFrameFade: split the volume MA into base (≤ setup day) + a fading
        // tail past it, so it crossfades with the candles / volume / price MAs.
        const _vmFade = candleFrameFade && fadeCutoff != null
        const _vmCut = _vmFade ? String(fadeCutoff) : null
        const baseVM = _vmFade ? volMaData.filter(p => String(p.time) <= _vmCut) : volMaData
        const tailVM = _vmFade ? volMaData.filter(p => String(p.time) >= _vmCut) : null
        const _vmPane = volSeparatePane ? VOL_PANE_INDEX : 0
        const _vmOpts = {
          lineWidth: 1, lineType: LineType.Curved, priceScaleId: volScaleId,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
          // The volume price scale uses the formatter of its LOWEST-z-order series.
          // The volume MA line shares this scale, and with the custom ThinVolumeSeries
          // (histogram style) the MA line — not the bars — ends up the formatter
          // source, so WITHOUT this its default price formatter rendered the axis raw
          // ("2000000000.00"). Give every series on the scale the SAME volume
          // formatter so the axis abbreviates no matter which source wins.
          priceFormat: { type: 'custom', formatter: formatVolumeAxis, minMove: 1 },
        }
        const _vmColor = cs.volume?.maColor || VOL_MA_COLOR
        const _vmWidth = Number(cs.volume?.maLineWidth) || 1
        if (!volMaSeriesRef.current) {
          volMaSeriesRef.current = chart.addSeries(LineSeries, { color: _vmColor, lineWidth: _vmWidth, ..._vmOpts }, _vmPane)
        } else {
          // Was set only at creation → changing the Volume MA color/width in settings
          // had no effect until remount. Re-apply on every settings change.
          try { volMaSeriesRef.current.applyOptions({ color: _vmColor, lineWidth: _vmWidth }) } catch { /* disposed */ }
        }
        _applyData(volMaSeriesRef.current, baseVM)
        if (_vmFade) {
          const vmTailColor = colorMulAlpha(VOL_MA_COLOR, frameFadeAlphaRef.current)
          if (!volMaTailSeriesRef.current) {
            volMaTailSeriesRef.current = chart.addSeries(LineSeries, { color: vmTailColor, ..._vmOpts }, _vmPane)
          } else {
            volMaTailSeriesRef.current.applyOptions({ color: vmTailColor })
          }
          volMaTailSeriesRef.current.setData(tailVM)
        } else if (volMaTailSeriesRef.current) {
          try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}
          volMaTailSeriesRef.current = null
        }
      } else if (volMaSeriesRef.current) {
        try { chart.removeSeries(volMaSeriesRef.current) } catch {}
        volMaSeriesRef.current = null
        if (volMaTailSeriesRef.current) { try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}; volMaTailSeriesRef.current = null }
      }
    } else if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch {}
      volumeSeriesRef.current = null
      if (volMaSeriesRef.current) { try { chart.removeSeries(volMaSeriesRef.current) } catch {}; volMaSeriesRef.current = null }
      if (volMaTailSeriesRef.current) { try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}; volMaTailSeriesRef.current = null }
    }

    // ── Extended-hours shading in the VOLUME pane ──
    // The price-pane shading primitive (attached to pane 0 above) fills only its own
    // pane, so with volume in a SEPARATE pane the pre/post bands stopped at the volume
    // divider. Attach a SECOND shading instance to the volume pane so the bands extend
    // straight down through it too (owner ask). Only while that pane exists.
    {
      const _volPane = (volSeparatePane && showVolume && volData.length > 0) ? chart.panes()[VOL_PANE_INDEX] : null
      if (_volPane) {
        if (!sessionShadeVolRef.current) sessionShadeVolRef.current = createSessionShadingPrimitive({})
        if (!sessionShadeVolAttachedRef.current) {
          try { _volPane.attachPrimitive(sessionShadeVolRef.current.primitive); sessionShadeVolAttachedRef.current = true } catch { /* older pane API */ }
        }
        if (sessionShadeVolAttachedRef.current && lastShadeBandsVolRef.current !== sessionShadeBands) {
          lastShadeBandsVolRef.current = sessionShadeBands
          sessionShadeVolRef.current.setOptions({ enabled: _shadeOn, bands: sessionShadeBands })
        }
      } else if (sessionShadeVolRef.current && sessionShadeVolAttachedRef.current) {
        // Volume pane gone (overlay mode / hidden) — the primitive detached with the
        // pane; drop the flag so it re-attaches if the pane returns, and clear its bands.
        sessionShadeVolAttachedRef.current = false
        lastShadeBandsVolRef.current = null
        try { sessionShadeVolRef.current.setOptions({ enabled: false, bands: EMPTY_BANDS }) } catch {}
      }
    }

    // ── Overlay lines — reuse series where possible ──
    // Remove excess overlay series
    while (overlaySeriesRefs.current.length > overlayData.length) {
      const old = overlaySeriesRefs.current.pop()
      try { chart.removeSeries(old) } catch {}
    }
    // candleFrameFade: each MA is split into a base segment (up to the setup day,
    // always full) + a tail segment (past it) whose opacity crossfades with the
    // candles on a Setup⇄Result flip. At full opacity the two read as one line.
    const _fadeMA = candleFrameFade && fadeCutoff != null
    const _cut = _fadeMA ? String(fadeCutoff) : null
    const _tailAlpha = frameFadeAlphaRef.current
    while (overlayTailSeriesRefs.current.length > (_fadeMA ? overlayData.length : 0)) {
      const old = overlayTailSeriesRefs.current.pop()
      try { chart.removeSeries(old) } catch {}
    }
    // Update existing or add new overlay series. CRITICAL: when an existing
    // overlay's new data is empty (e.g. switched to a recent IPO with too few
    // bars to compute SMA200), we must explicitly clear it. The previous
    // `if (!ovData.length) continue` left the OLD ticker's overlay line visible.
    for (let i = 0; i < overlayData.length; i++) {
      const { data: ovData } = overlayData[i]
      let color = overlayData[i].color
      // Charts workspace: repaint the 9-EMA in the candle up-color (MB_UP) so the
      // fast MA matches the candles — but ONLY while it wears the stock default
      // color; a user-picked color from the Indicators tab wins (ema9CandleColorFor).
      const _ov = resolvedOverlays?.[i]
      const _ema9Match = ema9CandleColorFor(_ov)
      if (_ema9Match) color = _ema9Match
      // Split into base (≤ setup day) + tail (≥ setup day) when fading; the shared
      // cutoff point joins them so the line is seamless at full opacity.
      const baseData = _fadeMA ? ovData.filter(p => String(p.time) <= _cut) : ovData
      // The tail is the post-setup segment. In the steady SETUP view the frame ends
      // ON the setup day, so the filter yields exactly one point (the cutoff itself)
      // — and a single-point curved LineSeries renders as a stray flat horizontal
      // dash past the last candle. Collapse it to empty so the MA just ends cleanly
      // at the setup day; the tail only carries real data during the Setup⇄Result
      // fade and in the Result view (where it has many points).
      const _tailRaw = _fadeMA ? ovData.filter(p => String(p.time) >= _cut) : null
      const tailData = _tailRaw && _tailRaw.length >= 2 ? _tailRaw : []
      // Model Book renders MAs as smooth curves (TradingView look) instead of
      // the default straight-segment polyline.
      // Per-overlay width/style from the Indicators tab; unset falls back to the
      // instance-wide defaults so stored blobs and Model Book are unaffected.
      const _ovCfg = resolvedOverlays?.[i] || {}
      const _ovStyleMap = { solid: 0, dotted: 1, dashed: 2 }
      const _ovLineStyle = _ovStyleMap[_ovCfg.lineStyle] ?? 0
      const _ovLineType = (boldCandles || modelBookLook) ? LineType.Curved : LineType.Simple
      // 0.5 floors to a true 1px hairline on retina (lineWidth*dpr), thinner than
      // the standard 1; non-retina stays ~1px. Model Book (boldCandles) + the
      // intraday popup (modelBookLook) use it.
      const _ovLineWidth = Number(_ovCfg.lineWidth) > 0 ? Number(_ovCfg.lineWidth) : ((boldCandles || modelBookLook) ? 0.5 : 1)
      // fitPriceToCandles: MAs contribute NO price range, so the scale fits the
      // candles only and a far 200MA clips off-screen instead of squashing price.
      const _ovAutoscale = fitPriceToCandles ? () => ({ priceRange: null }) : () => null
      if (i < overlaySeriesRefs.current.length) {
        // Reuse existing series — always setData (even empty) to clear stale data
        overlaySeriesRefs.current[i].applyOptions({ color, lineType: _ovLineType, lineWidth: _ovLineWidth, lineStyle: _ovLineStyle, autoscaleInfoProvider: _ovAutoscale })
        _applyData(overlaySeriesRefs.current[i], baseData)
      } else if (baseData.length) {
        // Add new series only if there's data to show
        const ls = chart.addSeries(LineSeries, {
          color,
          lineWidth: _ovLineWidth,
          lineStyle: _ovLineStyle,
          lineType: _ovLineType,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          autoscaleInfoProvider: _ovAutoscale,
        })
        ls.setData(baseData)
        overlaySeriesRefs.current.push(ls)
      }
      // The fading tail (only the post-setup portion).
      if (_fadeMA) {
        const tailColor = colorWithAlpha(color, _tailAlpha)
        if (i < overlayTailSeriesRefs.current.length) {
          overlayTailSeriesRefs.current[i].applyOptions({ color: tailColor, lineType: _ovLineType, lineWidth: _ovLineWidth, autoscaleInfoProvider: _ovAutoscale })
          overlayTailSeriesRefs.current[i].setData(tailData)
        } else {
          const ts = chart.addSeries(LineSeries, {
            color: tailColor,
            lineWidth: _ovLineWidth,
            lineType: _ovLineType,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: _ovAutoscale,
          })
          ts.setData(tailData)
          overlayTailSeriesRefs.current.push(ts)
        }
      }
    }

    // ── THE INDICATOR ENGINE — the one call site ──────────────────────────────
    //
    // WHY IT IS EXACTLY HERE, AND NOT WHERE IT WAS. lightweight-charts z-orders
    // series by INSERTION ORDER within a pane, and under Flip A everything —
    // candles, volume, the MA overlays, every price overlay and every oscillator
    // band — shares pane 0. This call used to sit ~300 lines up, before the volume
    // block, so an engine-drawn price overlay was inserted BEFORE the volume
    // histogram and BEFORE the MA overlays, where its legacy twin is inserted
    // after them. Wherever a Bollinger band, a VWAP line or an Ichimoku span
    // crosses an MA or the volume bars, the crossing pixel changes colour. The
    // RSI rehearsal could not see it by construction: RSI has its own scale in its
    // own band and overlaps nothing.
    //
    // This position is the first legacy INDICATOR block, after volume, volume-MA
    // and the MA overlays. So a migrated indicator is inserted where the legacy
    // series it replaces was, relative to everything the engine does NOT draw:
    //   · above volume, volume-MA and the MA overlays              (as legacy)
    //   · below the comparison line, the pattern overlays and the index MA
    //   · below every still-legacy indicator, and BB — the first of them, and
    //     B3's first pilot — is precisely where this sits.
    // Among the engine's OWN series, order is instance order, and the registry
    // order a migrated blob is built in (bb, vwap, sar, ichimoku, donchian) is
    // already the legacy render order for the five price overlays.
    //
    // ⭐ AND AS OF B5 TASK 6 FOUR OF THOSE FIVE LAND HERE. `bb`, `vwap`, `sar` and
    // `ichimoku` are all engine-drawn and are inserted contiguously at this call,
    // in registry order; `donchian` is the one still-legacy price overlay and its
    // block runs BELOW, so it stays on top of the other four — which is exactly
    // the shipped stacking. That is why the two tasks could not be reordered:
    // migrating `donchian` first would have put the engine's copy of it UNDER
    // `sar` and `ichimoku` instead of over them, and LWC z-stacks by insertion.
    // `engine_price_overlay_zorder` is the pixel case for it.
    //
    // Everything it reads is still a LOCAL of `updateChart` — `chart`, the render
    // plan (`_noop`/`_incr`/`_freshChart`), `_applyData`, `paneMargins`, the
    // volume-overlay decision, `filteredBars`, `adjustTime`. That is why it is
    // inline here rather than in an effect of its own: an effect would have to
    // re-derive the render plan (a second copy of the decision that keeps the
    // developing bar alive in extended hours) and would create its panes at a
    // different point in the pass. Extraction is B5's job, when panes stop being
    // bands.
    //
    // ⚠️ `engineNeeded`, not `engineActive`: after Flip B the engine is active on
    // EVERY chart (something is always flipped), and constructing a binder for a
    // chart with no instances would trade the "zero lightweight-charts calls when
    // there is nothing to draw" property for nothing. A chart that later gains an
    // instance builds one then; a chart that loses its last one syncs
    // `enabled: false`, which releases what it held (`binder.js`) rather than
    // leaving ghosts.
    //
    // ⭐ AND THIS IS NOW THE WHOLE OF THE DARK CONTRACT (B5 Task 4). It used to
    // read `engineOn || engineInstances.length > 0`, where `engineOn` was the
    // deleted flag. The disjunct did nothing a user could observe — it built a
    // binder for a flag-on chart with no instances, and the flag was on for
    // nobody — and it made the honest predicate look like a fallback. What is left
    // says exactly what it means: no instances, no binder, zero library calls.
    const engineNeeded = engineInstances.length > 0
    if (engineRef.current && engineRef.current.chart !== chart) engineRef.current = null
    if (engineNeeded && !engineRef.current) {
      engineRef.current = { chart, binder: createBinder({ chart, LWC: engineLwc() }) }
    }
    if (engineRef.current) {
      engineRef.current.binder.sync({
        enabled: engineNeeded,
        cs,
        instances: engineInstances,
        registry: engineRegistry,
        // The SAME bars `indicatorData` computes from (`:3895`) — parity under
        // Flip A means the engine's column and the legacy one are the same array.
        bars: filteredBars,
        // ⭐ THE SERVER LANE'S ONLY REQUIREMENT (Phase C Task 13). A native
        // ignores both; a `compute.kind: 'server'` definition (the RS line) is
        // fetched per (symbol, timeframe) and cannot resolve without them.
        // `resolvedTf`, not the raw `tf` prop: the prop is optional and falls
        // back to a preference, and a null timeframe would key the lane's cache
        // differently from the request the hook actually makes.
        sym,
        tf: resolvedTf,
        adjustTime,
        applyData: _applyData,
        plan: { noop: _noop, incr: _incr, fresh: _freshChart },
        // The declutter toggle. `visible` is part of the option set the binder
        // re-asserts on every bind, so without this a hidden engine series would
        // reappear on the next paint. Read from a ref, not a dependency — see the
        // ref's declaration.
        indicatorsHidden: indicatorsHiddenRef.current,
        // Placement inputs. `resolvePlacement` reads these and nothing else, so
        // the engine lands in the legacy bands by construction.
        paneMargins,
        // FLIP C. `null` in `'bands'` mode, and `resolvePlacement` ignores it
        // there — asserted deep-equal to the pre-Flip-C answer for every pane
        // oscillator in `engine/__tests__/flipCGeometry.test.jsx`.
        paneLayout,
        volOverlaySet,
        volSeparatePane,
        VOL_PANE_INDEX,
        resolvePlacement,
        resolvePreset,
      })
    }

    // ── Bollinger Bands and RSI: FLIPPED (B3 Task 10) ────────────────────────
    //
    // Both are drawn by the ENGINE, from the instance list, at the sync call
    // above. Their hand-written blocks, their `useRef`s, their `indicatorData`
    // branches, their entries in the hide-all array and RSI's crosshair fallback
    // are all GONE — that deletion IS Flip B, and it is what stops each of them
    // being enumerated in six places. `ENGINE_OWNED` names them; the
    // enable signal reaches the geometry through the instance list itself, and
    // the engine is ACTIVE for them unconditionally because there is nothing else
    // left that could draw them. (It used to say "regardless of `engineEnabled`" —
    // B5 Task 4 deleted that flag, so there is no longer anything to be regardless
    // of.)
    //
    // ⚠️ RSI's block sat BELOW VWAP's and BB's ABOVE it. Order still matters for
    // the price overlays (LWC z-stacks by insertion), and it is preserved: the
    // engine inserts everything it owns at the sync call, which is where BB — the
    // FIRST legacy indicator block — used to be. RSI has its own scale in its own
    // band and crosses nothing.

    // ── Session VWAP: FLIPPED (B3 Task 11) ───────────────────────────────────
    //
    // Drawn by the ENGINE, from the instance list, at the sync call above — and
    // its whole render context (the intraday-only gate, colour × opacity, the
    // Model Book's forced white, the bold-candle hairline) is folded into the
    // instance's inputs by `engine/eligibility.js` before the binder sees it.
    // That is the module's entire reason to exist: four facts about the CHART
    // that no definition schema can state.
    //
    // ⚠️ ON A DAILY CHART NOTHING DRAWS AND NOBODY OWNS IT. The gate is
    // `def.meta.timeframes` (mirrored by `eligibility.VWAP_TIMEFRAMES`, which is
    // where `VWAP_TFS` went), so the instance is dropped above 60-minute bars —
    // it never reaches `engineInstances`, and the binder is handed nothing for it.

    // ── Stochastic sub-pane: FLIPPED (B5 Task 5) ─────────────────────────────
    //
    // %K, %D and the 80/20 guides are drawn by the ENGINE, from one instance, at
    // the sync call above. `stochKRef`/`stochDRef`, the `indicatorData.stoch`
    // branch and the hide-all entries are deleted with the block — that deletion
    // IS Flip B.
    //
    // ⚠️ ITS TWO LEGEND CHIPS DID NOT MOVE FILE, THEY MOVED LANE. `%K` and `%D`
    // used to be `registerLegacyChip('stoch', …)` calls right here; they are now
    // produced by `engineChips` from the SAME `plots[].legend` blocks, through
    // the same `chipsFrom` pipeline, with the same text to the character. The
    // developing-bar fallback rides `binding.lastValue` instead of the thunk that
    // closed over `indicatorDataRef`. `legendFromDefinitions.test.jsx` asserts
    // both the text AND the lane, because a chip drawn twice is invisible in text.

    // ── MACD sub-pane: FLIPPED (B3 Task 11) ──────────────────────────────────
    //
    // Line, signal AND histogram are drawn by the ENGINE, from one instance, at
    // the sync call above. The three `useRef`s, the `indicatorData.macd` IIFE,
    // the hide-all entries and the crosshair fallbacks are all deleted with the
    // block — that deletion IS Flip B.
    //
    // ⚠️ THE HISTOGRAM'S SIGN COLOURS AND THE HEAD-MASK LEFT THIS FILE WITH IT.
    // `MACD_HIST_UP`/`MACD_HIST_DOWN` and the `MACD_HEAD_MASK` read both lived in
    // that IIFE and both now exist only in `nativeRegistry` — one switch, one
    // reader, which is what "one switch, both lanes" turns into when there is
    // only one lane left.

    // ── ATR sub-pane: FLIPPED (B5 Task 5) ────────────────────────────────────
    //
    // ⚠️ AND IT IS NOT A SECOND STOCHASTIC, WHICH IS WHY THE TWO MIGRATED
    // TOGETHER RATHER THAN SEPARATELY. ATR's band is AUTOSCALED — the legacy
    // create branch passed `{autoScale: true}` where every 0-100 oscillator
    // passes `{autoScale: false, minimum: 0, maximum: 100}` — so it is the first
    // definition whose `placement` declares NO `scale` at all, and
    // `engine_atr_vs_legacy` is the first parity case on this branch to render an
    // autoscaled engine band. Its band is also SHORTER (`pane.height` 0.13 vs
    // 0.15, i.e. `{top: 0.87}` vs `{top: 0.85}`), it draws no guides, and its
    // chip carries the period in brackets where Stochastic's two carry none.

    // ── Parabolic SAR: FLIPPED (B5 Task 6) ───────────────────────────────────
    //
    // Drawn by the ENGINE, from the instance list, at the sync call above.
    // `sarSeriesRef`, the `indicatorData.sar` branch and the hide-all entry are
    // deleted with the block — that deletion IS Flip B.
    //
    // ⚠️ IT IS THE FIRST `markers` PLOT THE BINDER HAS EVER CREATED, and that is
    // not a spelling difference. `poolKey('markers') === 'line'` — a `markers`
    // plot IS a LineSeries with `lineWidth: 0` and point markers on, which is
    // what this block built by hand — so the POOL can re-purpose SAR's series as
    // any other line, and `pool.js`'s header records the measured leak that
    // follows: `sar → rsi` left `pointMarkersVisible: true` behind, i.e. an RSI
    // line with a dot on every bar. The complete-key-set rule closes it, and
    // `sarIchimokuFlipParity.test.js` asserts it on that exact pair.
    //
    // ⚠️ AND IT IS A PRICE OVERLAY ON THE CANDLES' SHARED SCALE, so
    // `autoscaleInfoProvider: () => null` — B3 Task 1's seam, measured at 38,491
    // changed pixels when a price overlay was allowed to drive the main scale —
    // is carried by `placement.target: 'price'` rather than by this call.

    // ── Ichimoku Cloud: FLIPPED (B5 Task 6) ──────────────────────────────────
    //
    // All FIVE lines are drawn by the ENGINE, from ONE instance, at the sync call
    // above. The five `useRef`s, the `indicatorData.ichimoku` branch and the five
    // hide-all entries are deleted with the block.
    //
    // ⚠️ THREE PRESERVED QUIRKS CAME ACROSS UNTOUCHED, and `indicators.js`
    // records all three deliberately: spanA and spanB are NOT forward-displaced
    // (every other product draws the cloud 26 bars ahead of price), and chikou IS
    // back-shifted 26 bars, so the last 26 slots of that column are the NaN pad.
    // TRANSCRIBED, NOT CORRECTED — correcting any of them is a measured,
    // owner-facing decision of the shape the MACD head-mask (88 px) and the VWAP
    // session anchor (2,590 px) got, never something a migration does in passing.
    //
    // ⚠️ AND THE THREE PERIODS ARE LIVE NOW. This block called
    // `computeIchimoku(filteredBars)` with NO arguments, so `tenkanPeriod`,
    // `kijunPeriod` and `senkouBPeriod` were declared by the definition, absent
    // from `CHART_DEFAULTS.indicators.ichimoku`, and the only greyed controls in
    // the whole app (`indicatorCatalog.unwiredKeys`). `computeIchimoku` DOES
    // honour its three arguments and the engine passes the instance's, whose
    // defaults are the same 9/26/52 the no-argument call fell back to — so they
    // become working controls at zero pixels.
    //
    // ⭐ ONE NAMED BEHAVIOUR CHANGE, AND IT IS THE ONLY ONE: TK and KJ now print
    // on the DEVELOPING bar. This block registered them with a series and NO
    // thunk, so on the newest bar — the one the bars-push writer appends before
    // the indicator series has a point — the two chips printed nothing. The
    // engine lane's `lastValue` is a number, so they print, which is the same gap
    // B3 closed for RSI (review finding I-3) and which every other chip already
    // had. No pixel case can see it; `legendFromDefinitions.test.jsx` asserts it
    // in the DOM, with the control that it really is the developing bar.

    // ⭐ FLIP B, B5 TASK 7 — MFI, CCI AND WILLIAMS %R ARE GONE FROM HERE.
    //
    // Three single-line pane oscillators, migrated and flipped in one commit
    // (with `engineEnabled` deleted at Task 4, a migrated-but-un-flipped
    // definition is drawn by NOTHING). Each was one `addSeries` plus a handful
    // of `createPriceLine` guides; all three are drawn by the ENGINE now, from
    // the instance list, at the sync call above. The three `useRef`s, the three
    // `indicatorData` branches and the three hide-all entries went with them.
    //
    // ⚠️ THE GUIDES WERE THE WHOLE JOB. The series halves are a repeat of ATR's;
    // what is not a repeat is that an omitted SERIES option means "keep what's
    // there" while an omitted `createPriceLine` option means LWC's OWN DEFAULT
    // — which for `lineStyle` is Dashed. That asymmetry cost 379 changed pixels
    // on RSI's 50-midline at B3, and this task carried SEVEN guides in THREE
    // shapes across it: MFI's 80/20 dashed pair, CCI's ±100 dashed bands with a
    // LARGE-dashed zero line (the only definition in the registry with two
    // guide styles), and Williams %R's −20/−80 on a NEGATIVE scale.
    //
    // ⚠️ ONE MEASURED DIFFERENCE, AND IT IS ORDER ONLY: this block created CCI's
    // three lines as `100, 0, -100`; the engine walks plots in declaration order
    // and each plot's levels in array order, so it creates them as `100, -100,
    // 0`. Three horizontal lines at three distinct prices never overlap, so
    // insertion order is invisible in the picture — stated here and asserted in
    // `mfiCciWilliamsFlipParity.test.js` rather than left to be re-discovered.
    //
    // ⚠️ AND WILLIAMS %R'S SCALE IS `-100..0`, WHOSE `max` IS ZERO. The engine
    // picks the pinned branch on `Number.isFinite(min) && Number.isFinite(max)`
    // (`placement.js`); a truthiness guard would send BOTH williamsR (max 0) and
    // mfi (min 0) down the `autoScale: true` branch and lose the `autoScale:
    // false` that freezes a pooled scale against re-invalidation.

    // ⭐⭐ FLIP B, B5 TASK 8 — ADX, OBV AND DONCHIAN ARE GONE FROM HERE, AND SO
    // IS THE LANE. There is not one hand-written indicator render block left in
    // this file: all fourteen series-expressible definitions are drawn by the
    // ENGINE, from the instance list, at the sync call above. Four ledger rows
    // retire together because they were ONE mechanism — the `useRef`s, the
    // `indicatorData` memo, these blocks, and the hide-all array.
    //
    // ⚠️ THREE DIFFERENT SHAPES, AND EACH NEEDED SOMETHING A SYMMETRY ARGUMENT
    // WOULD HAVE MISSED:
    //
    //   · `adx` — THREE lines on ONE named scale, plus a single guide at 25 on
    //     the ADX line (not on +DI). Its `fixedPane(0, 100)` has a **min of
    //     ZERO**, which is FALSY: `resolvePlacement` reaches the pinned branch on
    //     `Number.isFinite`, and a `scale.min && scale.max` guard would send it to
    //     `autoScale: true` and lose the `autoScale: false` that freezes a pooled
    //     scale (TRAP #2). Williams %R sprang the same trap from the `max` end at
    //     Task 7. ⚠️ The binder asserts a price scale per BINDING, so ADX's three
    //     lines make THREE identical `priceScale().applyOptions` calls where this
    //     block made one — a call count, not a picture, because all three carry
    //     `priceScaleId: 'adx'` and therefore share one scale object.
    //   · `obv` — the only definition with NO period input at all, and the only
    //     one whose values run to 1e8, so it is the case that actually exercises
    //     the autoscale seam on a REAL scale (B3 Task 1 measured `exclude` on an
    //     autoscaled band collapsing it to -0.5..0.5, moving a price of 30 from
    //     y=371 to y=-1640.78). ⭐ AND ITS ZERO SEED IS PRESERVED: `computeOBV`
    //     starts bar 0 at `0` where every other native NaN-pads its head, so OBV
    //     is the one series here with no whitespace at all. TRANSCRIBED, NOT
    //     CORRECTED — correcting it is a measured, owner-facing decision of the
    //     shape the MACD head-mask (88 px) and the VWAP anchor (2,590 px) got.
    //   · `donchian` — the LAST price overlay, which is why it lands last: LWC
    //     z-stacks by insertion and the engine draws its whole set contiguously
    //     where BB's block used to be, so migrating it ahead of `sar`/`ichimoku`
    //     would have put it UNDER two overlays it sits on top of today.
    //     ⛔⭐ AND ITS MIDDLE LINE IS `LargeDashed`, WHICH THE DEFINITION DID NOT
    //     SAY. This block built its three with `style: 0, 3, 0`; `donchian.middle`
    //     carried no `lineStyle` behind a comment calling LineStyle 3
    //     "unnameable" — true before `largeDashed` joined `PLOT_LINE_STYLES`,
    //     false after. `pool.seriesOptionsForPlot` resolves an absent plot style
    //     to SOLID (complete key set), so the engine would have drawn the mid-line
    //     solid. No series count and no scale assertion could see it; the
    //     definition names it now and `adxObvDonchianFlipParity.test.js` asserts
    //     it. This block also passed NO `priceScaleId` and no pane argument, so
    //     LWC defaulted both; `placement.js` resolves `price` to
    //     `MAIN_PRICE_SCALE_ID` explicitly — the same answer, and the explicit
    //     form is what stops a pooled band stranding on somebody else's scale.
    // ── Symbol comparison overlay ──
    if (comparisonData.length) {
      if (!compareSeriesRef.current) {
        compareSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'compare',
          color: '#fb923c',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        })
        chart.priceScale('compare').applyOptions({
          scaleMargins: { top: 0.1, bottom: 0.1 },
          borderVisible: false,
          visible: false,  // hide the right-axis label — value shown in legend instead
        })
      }
      _applyData(compareSeriesRef.current, comparisonData)
    } else if (compareSeriesRef.current) {
      try { chart.removeSeries(compareSeriesRef.current) } catch {}
      compareSeriesRef.current = null
    }

    // ── Price lines — remove old, add new (only when array reference changes) ──
    if (lastPriceLinesRef.current !== allPriceLines) {
      lastPriceLinesRef.current = allPriceLines
      for (const pl of priceLineRefs.current) {
        try { candleSeriesRef.current.removePriceLine(pl) } catch {}
      }
      priceLineRefs.current = []
      if (allPriceLines?.length && candleSeriesRef.current) {
        for (const pl of allPriceLines) {
          const ref = candleSeriesRef.current.createPriceLine({
            price: pl.price,
            color: pl.color || cs.textColor,
            lineWidth: pl.lineWidth || 1,
            lineStyle: pl.lineStyle ?? 2,
            axisLabelVisible: pl.axisLabelVisible ?? true,
            lineVisible: pl.lineVisible ?? true,   // session ext tag = chip only (no line)
            title: pl.title || '',
          })
          priceLineRefs.current.push(ref)
        }
      }
    }

    // ── Markers (BUY/SELL arrows) ──
    // Reuse a single controller per chart instance and feed it new markers.
    // Without this, each updateChart() call stacks new marker layers over old
    // ones — markers from the prior ticker leak into the new ticker's chart.
    // Always call setMarkers (even with []) so old markers clear when the new
    // ticker has none.
    // Guarded on the SOURCE array's identity (mergedMarkers is memoized, so it's
    // stable across live ticks) — the sort + dynamic import + full marker-layer
    // rebuild used to run on every repaint. A missing controller forces a rebuild,
    // which is what covers the two cases the identity check can't see: the series
    // was swapped (the swap nulls the controller, since it was bound to the old
    // series) and a fresh chart. Never skip on either, or markers silently vanish.
    const _markersDirty = lastMarkersSrcRef.current !== mergedMarkers
      || !markersControllerRef.current
      || _freshChart
    if (candleSeriesRef.current && _markersDirty) {
      lastMarkersSrcRef.current = mergedMarkers
      const allMarkers = [...(mergedMarkers || [])]
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
      import('lightweight-charts').then(({ createSeriesMarkers }) => {
        if (!createSeriesMarkers || !candleSeriesRef.current) return
        if (markersControllerRef.current && typeof markersControllerRef.current.setMarkers === 'function') {
          markersControllerRef.current.setMarkers(allMarkers)
        } else {
          markersControllerRef.current = createSeriesMarkers(candleSeriesRef.current, allMarkers)
        }
      }).catch(() => {})
    }

    // ── Swing high/low price labels (custom v5 series primitive, above series) ──
    if (candleSeriesRef.current) {
      if (!swingCtrlRef.current) swingCtrlRef.current = createSwingLabelsPrimitive({})
      if (!swingAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(swingCtrlRef.current.primitive)
          swingAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      const sl = cs.swingLabels || {}
      swingCtrlRef.current.setOptions({
        enabled: swingLabelsOn,   // D/W/M-gated (see swingLabelsOn) — never on intraday
        color: sl.color || '#d4d0c4',
        tintByType: !!sl.tintByType,
        upColor: sl.upColor || '#4ade80',
        downColor: sl.downColor || '#f87171',
        // The label's background box. showBg toggles it; a user-set color wins,
        // unset matches the canvas so it reads as a clean plate over candles.
        showBg: sl.bgEnabled !== false,
        bg: sl.bg || cs.background,
      })
      swingCtrlRef.current.setPoints(swingPoints)
    }

    // ── Dark-pool level zones (custom v5 series primitive, behind the series) ──
    // Attached to the CANDLE series, not the volume series: the band edges are
    // placed with priceToCoordinate, which maps against the series' own scale —
    // on the volume series these prices would map against the VOLUME scale.
    if (candleSeriesRef.current) {
      if (!zonesCtlRef.current) zonesCtlRef.current = createLevelZonesPrimitive({})
      if (!zonesAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(zonesCtlRef.current.primitive)
          zonesAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      // setZones forces a primitive redraw and this block runs on EVERY
      // updateChart, so re-setting an identical list pays for a repaint that
      // draws the same pixels — the lastShadeBandsRef guard, one primitive over.
      // `dpZones` is the single channel for data AND visibility: the hook nulls
      // its SWR key when the toggle is off or the viewer is unpaid, so "off" is
      // already `[]` (the primitive's own off switch) with a stable identity.
      if (lastDpZonesRef.current !== dpZones) {
        lastDpZonesRef.current = dpZones
        zonesCtlRef.current.setZones(dpZones)
      }
    }

    // ── Previous-day High / Low / Close lines (custom v5 series primitive) ──
    // INTRADAY only: each line anchors at the candle that made that level and
    // extends to the current candle (redrawn every frame → grows as bars form).
    // Off (empty draw-list) on D/W/M or when all three are disabled.
    if (candleSeriesRef.current) {
      if (!pdlCtlRef.current) pdlCtlRef.current = createPrevDayLevelsPrimitive()
      if (!pdlAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(pdlCtlRef.current.primitive)
          pdlAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      const pdl = cs.prevDayLevels
      const pdlIntraday = ['1', '5', '15', '30', '60'].includes(resolvedTf)
      const pdlOn = pdlIntraday && pdl && (pdl.high?.enabled || pdl.low?.enabled || pdl.close?.enabled)
      if (pdlOn) {
        const lv = computePrevDayLevels(ohlcData)
        pdlCtlRef.current.setLines(buildPrevDayLines(lv, pdl), lv?.endTime)
      } else {
        pdlCtlRef.current.setLines([], null)
      }
    }

    // ── Earnings "E" badge (custom v5 series primitive) ──
    if (candleSeriesRef.current) {
      if (!earnBadgeRef.current) earnBadgeRef.current = createEarningsBadgePrimitive({})
      if (!earnBadgeAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(earnBadgeRef.current.primitive)
          earnBadgeAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      const mk = cs.markers || {}
      earnBadgeRef.current.setOptions({
        enabled: earningsEvents.length > 0,
        // The glyph paints the CANVAS color so the 'E' reads as cut out of the pill,
        // showing the chart background through it at any canvas color.
        glyphColor: canvasSample.top,
        beatColor: mk.earningsBeat || '#1ae51a',
        missColor: mk.earningsMiss || '#c41f2d',
      })
      earnBadgeRef.current.setPoints(earningsEvents.map(e => ({ time: e.date, price: e.low, beat: e.beat })))
    }

    // ── Splits "S" + Dividends "D" badges (same bottom-row primitive as earnings) ──
    if (candleSeriesRef.current) {
      if (!splitBadgeRef.current) splitBadgeRef.current = createEarningsBadgePrimitive({ glyph: 'S', color: '#f59e0b' })
      if (!splitBadgeAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(splitBadgeRef.current.primitive)
          splitBadgeAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      splitBadgeRef.current.setOptions({ enabled: splitEvents.length > 0, glyphColor: canvasSample.top })
      splitBadgeRef.current.setPoints(splitEvents.map(s => ({ time: s.date, price: s.low })))

      if (!divBadgeRef.current) divBadgeRef.current = createEarningsBadgePrimitive({ glyph: 'D', color: '#3b82f6' })
      if (!divBadgeAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(divBadgeRef.current.primitive)
          divBadgeAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      divBadgeRef.current.setOptions({ enabled: dividendEvents.length > 0, glyphColor: canvasSample.top })
      divBadgeRef.current.setPoints(dividendEvents.map(d => ({ time: d.date, price: d.low })))
    }

    // View handling on initial load / timeframe change / ticker switch.
    // (NOT on SWR refetches — those keep zoomKey stable so the user never loses position.)
    //
    // LOCK BEHAVIOR (always on): when ONLY the ticker changes (same timeframe), we carry
    // the user's current view to the next chart instead of snapping back to a default fit:
    //   • Horizontal: re-anchor the visible logical range to the right edge so the same
    //     "scrolled-back distance + zoom width" lines up even when the two tickers have
    //     different history lengths.
    //   • Vertical: auto-fit the new ticker into the candle band defined by chartOpts'
    //     scaleMargins. When the user has dragged the candles to a custom spot, that band
    //     was captured above (vertMarginsRef), so the new stock lands in the same
    //     PROPORTIONAL position — scaled to its own price range, never showing the old
    //     stock's absolute prices. Double-click the axis won't clear it; use the
    //     "Auto-scale" context-menu item to reset to default headroom.
    // Fold the replay cutoff in so entering/leaving replay (or changing the cutoff) counts
    // as a "fresh load" → routes through the default-zoom path so the chart re-frames to the
    // default window with the cutoff bar as the newest visible candle.
    const zoomKey = `${sym}_${resolvedTf}_${replayCutoff ?? ''}`
    // Capture the outgoing view BEFORE deciding. setData() preserves the logical
    // range NUMERICALLY, so this reflects where the user was — on the previous
    // ticker (sym switch) or right now (same-ticker data-phase swap / backfill).
    let oldRange = null
    try { oldRange = chart.timeScale().getVisibleLogicalRange() } catch {}
    const oldBarCount = lastBarCountRef.current
    if (zoomKeyRef.current !== zoomKey) {
      const isFirstLoad = zoomKeyRef.current === null
      const tfChanged = lastTfRef.current !== null && lastTfRef.current !== resolvedTf

      zoomKeyRef.current = zoomKey
      lastTfRef.current = resolvedTf
      // Exiting replay (or a TF change) clears the replay view lock so the next frame
      // uses the normal default; a plain ticker switch WITHIN replay keeps it locked.
      if (!replayCutoff || tfChanged) { replayViewLockedRef.current = false; replayLockedViewRef.current = null }
      const _replayLocked = replayCutoff && replayViewLockedRef.current
      // New symbol/timeframe = a fresh view, so re-arm the pinned-right safety net that a
      // user pan on the PREVIOUS symbol had latched off — EXCEPT under the replay lock,
      // where keeping it latched is exactly what stops the settling/pinned-right guards
      // from snapping the locked view back to present on the next data commit.
      if (!_replayLocked) userViewMovedRef.current = false
      // A timeframe switch must PRESERVE the viewport: keep the last candle at the
      // exact same screen position AND the same zoom width, then just swap in the new
      // tf's bars — no reset to the tf default, no leftward snap ("just flip the
      // timeframe"). Capture the outgoing anchor + width now; the guard below re-asserts
      // it on every settling commit until the bar count stops changing.
      if (tfChanged) {
        // Preserve the zoom WIDTH from the outgoing view; the newest candle is re-pinned
        // to the fixed right anchor (LAST_CANDLE_POS) below. Do NOT derive the anchor from
        // oldRange + oldBarCount: after setData() with the new tf's bars, getVisibleLogicalRange
        // is clamped to the NEW data extent while oldBarCount is the OLD tf's count, so that
        // ratio is garbage when the two tfs have different bar counts — it snapped the chart
        // to the middle (SMH 1H bug).
        const _w = oldRange ? (oldRange.to - oldRange.from) : null
        pendingTfReframeRef.current = { tf: resolvedTf, width: (_w > 0 ? _w : null) }
      } else if (keepPresentOnSymbolChange && !isFirstLoad && !entryDate && !exactDateRange && !_replayLocked) {
        // SYMBOL switch on a "newest always at right" surface (Charts workspace). The
        // new ticker's bars arrive in PHASES (IDB cache → network → older-history
        // backfill), each a separate updateChart commit with a DIFFERENT bar count.
        // The keepPresent branch below frames the FIRST phase correctly, but later
        // phases were left to a fragile "was the user viewing latest" heuristic that
        // misjudged across tickers of different length — so the chart loaded correct
        // for ~0.5s then drifted to the middle (SNDK 5m bug). Reuse the exact TF-switch
        // mechanism: hold the outgoing zoom width and let the settling-guard re-assert
        // newest-at-LAST_CANDLE_POS on EVERY commit until the bar count stops changing.
        const _w = oldRange ? (oldRange.to - oldRange.from) : null
        pendingTfReframeRef.current = { tf: resolvedTf, width: (_w > 0 ? _w : null) }
      }

      // Vertical: always auto-fit the new ticker into the current candle band. chartOpts
      // already applied that band's scaleMargins (= the captured proportional placement,
      // or the default headroom), so autoScale fills it with THIS stock's own range.
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch {}

      let didPreserve = false
      if (!isFirstLoad && !tfChanged && !entryDate && oldRange && oldBarCount > 0) {
        const newBarCount = filteredBars.length
        const width = oldRange.to - oldRange.from
        // Symbol switch: keep the user's ZOOM LEVEL (width), but choose the anchor.
        // keepPresentOnSymbolChange (Charts workspace) always pins the newest candle to
        // the right so a newly-typed ticker loads at PRESENT DAY — never inheriting a
        // scrolled-back (past) position from the prior symbol. Otherwise preserve the
        // prior bars-from-right (flip tickers at the exact same historical view).
        let to, from
        // REPLAY view lock: once the user has moved the view in replay, keep the EXACT
        // right-relative view (same distance from the cutoff + same zoom) on every ticker,
        // overriding keepPresent's snap-to-present — until "Reset view" / exit replay. Use
        // the params CAPTURED at pan/zoom time (replayLockedViewRef) — oldRange here is
        // already clamped to the new ticker's extent, which loses the deep scroll-back.
        if (_replayLocked && replayLockedViewRef.current) {
          to = newBarCount - replayLockedViewRef.current.barsFromRight
          from = to - replayLockedViewRef.current.width
        } else if (keepPresentOnSymbolChange) {
          to = (newBarCount - 1) + width * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
          from = to - width
        } else if (rangeDescribesOldExtent(oldRange, oldBarCount, newBarCount)) {
          const barsFromRight = oldBarCount - oldRange.to
          to = newBarCount - barsFromRight
          from = to - width
        } else {
          // Captured range already re-mapped to the NEW series (see
          // rangeDescribesOldExtent) — bars-from-right vs the stale old count
          // would throw the view off the data. Keep the remapped range.
          to = oldRange.to
          from = oldRange.from
        }
        if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 1 && from < newBarCount) {
          try {
            chart.timeScale().setVisibleLogicalRange({ from, to })
            didPreserve = true
          } catch {}
        }
      }

      if (!didPreserve) {
        // Holding-period zoom: when entryDate is supplied (e.g. TradeDrawer),
        // center the view on the trade window with 20-bar padding each side.
        if (entryDate && exactDateRange && filteredBars.length > 0) {
          // Exact window: first bar >= entryDate .. last bar <= exitDate, no padding.
          // Used by Model Book to show exactly one calendar year's move.
          let startIdx = filteredBars.findIndex(b => b.t >= entryDate)
          let endIdx = filteredBars.length - 1
          if (exitDate) {
            for (let i = filteredBars.length - 1; i >= 0; i--) {
              if (filteredBars[i].t <= exitDate) { endIdx = i; break }
            }
          }
          // Reused-ticker guard (see the exact-range pin below): if the selected
          // year has no bars in the loaded series (it fell in a delisting gap),
          // show the most recent ~year instead of anchoring to the oldest
          // (delisted-era) bar. Without this, findIndex<0 → startIdx 0 streamed
          // 2016/2008-era data onto a recent-year view.
          const yearHasData = startIdx >= 0 && endIdx >= startIdx
            && (!exitDate || filteredBars[startIdx].t <= exitDate)
          if (!yearHasData) { endIdx = filteredBars.length - 1; startIdx = Math.max(0, endIdx - 251) }
          // Frame start predates the first bar (e.g. before an IPO): pad with
          // blank space on the left instead of clamping to bar 0.
          let fromIdx = startIdx
          if (yearHasData && startIdx === 0) {
            fromIdx = -leadingBlankBars(_dateToMs(entryDate), _dateToMs(filteredBars[0].t), resolvedTf)
          }
          const _padR = frameRightPadFrac > 0 ? Math.round((endIdx - fromIdx) * frameRightPadFrac) : 0
          chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: endIdx + _padR })
        } else if (entryDate && filteredBars.length > 0) {
          const entryIdx = filteredBars.findIndex(b => b.t >= entryDate)
          const exitIdx  = exitDate
            ? filteredBars.findIndex(b => b.t >= exitDate)
            : -1
          const fromBar = Math.max(0, (entryIdx >= 0 ? entryIdx : 0) - 20)
          const toBar   = (exitIdx >= 0 ? exitIdx : filteredBars.length - 1) + 28
          chart.timeScale().setVisibleLogicalRange({ from: fromBar, to: toBar })
        } else {
          const _pt = pendingTfReframeRef.current
          if (tfChanged && _pt && _pt.width > 0) {
            // TF switch: keep the same zoom WIDTH and pin the newest candle to the fixed
            // right anchor, so the chart doesn't move — only the timeframe flips.
            const lastIdx = filteredBars.length - 1
            const to = lastIdx + _pt.width * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
            const from = to - _pt.width
            chart.timeScale().setVisibleLogicalRange({ from, to })
          } else {
            // First load (no prior view): canonical default zoom — newest candle at
            // LAST_CANDLE_POS, the timeframe's default history. Shared with "Reset view".
            const { from: _from, to: _to } = computeDefaultLogicalRange(
              filteredBars.length, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride, plotWidthPx: plotWidthOf(chart, containerRef.current) }
            )
            chart.timeScale().setVisibleLogicalRange({ from: _from, to: _to })
          }
        }
      }
    } else if (!entryDate && !exactDateRange && _preUpdateRange && oldBarCount > 0
               && oldBarCount !== filteredBars.length) {
      // SAME ticker/tf, but the bar COUNT changed since the last render — the
      // IDB-cache → network full-fetch swap OR a viewport-first older-history
      // backfill / dwell-warm (FIRST_PAINT→full, 600→12025). A backfill only
      // PREPENDS older history — the newest bar is unchanged — so the user's view
      // is invariant in "bars-from-right + width". Re-anchor to exactly that using
      // the PRE-setData range (captured at updateChart top, before LWC could shift
      // it), so a big depth jump keeps the user exactly where they were instead of
      // snapping to the default window. (Model Book / entryDate have their own pins.)
      const newBarCount = filteredBars.length
      const pr = _preUpdateRange
      const barsFromRight = oldBarCount - pr.to
      const width = pr.to - pr.from
      const to = newBarCount - barsFromRight
      const from = to - width
      const lastIdx = newBarCount - 1
      // The bars-from-right remap ASSUMES a PREPEND (older history added at the
      // front, newest bar unchanged) → the view is invariant in bars-from-right.
      // A full no-`since` REPLACE refetch (more common since the intraday freshness
      // gate was tightened) can instead return a DIFFERENT count with a SLID window,
      // making `barsFromRight` stale and pushing the computed window ENTIRELY into
      // the empty right-pad — the chart then shows only the price axis until "Reset
      // view" (the pinned-right net below is disabled once the user has panned). So
      // apply the remap ONLY when it lands on REAL bars (the last bar stays in view:
      // to > 0 AND from < lastIdx). Otherwise the mapping is invalid → re-pin the
      // newest candle at its default on-screen position (keeping the zoom width) so
      // the view is NEVER left blank.
      if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 0 && from < lastIdx) {
        try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch {}
      } else if (width > 0 && lastIdx > 0) {
        const to2 = lastIdx + width * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
        const from2 = to2 - width
        try { chart.timeScale().setVisibleLogicalRange({ from: from2, to: to2 }) } catch {}
      }
    }

    // ── Keep-the-newest-candle-pinned-right safety net (workspace live charts) ──
    // After ALL the zoom branches above have run, if the user was viewing the
    // latest bars and the newest candle has drifted off the right edge, snap it
    // back. This is mechanism-agnostic: whatever repositioned the view (a
    // background data-count change re-anchor, LWC's own setData behavior, a
    // backfill, a resize settle), the end state is enforced — the view must not
    // move on its own (user requirement). A deliberately scrolled-back view (last
    // bar NOT near the right before this update) is left completely untouched.
    if (!entryDate && !exactDateRange && oldRange && oldBarCount > 0 && filteredBars.length > 1) {
      const preLastIdx = oldBarCount - 1
      const prePad = oldRange.to - preLastIdx      // empty bars right of the last bar, BEFORE the update
      const preWidth = oldRange.to - oldRange.from
      if (pendingTfReframeRef.current && pendingTfReframeRef.current.tf === resolvedTf) {
        // Just switched INTO this timeframe: deterministically re-assert the PRESERVED
        // viewport (same last-candle position + zoom width as the outgoing view) on every
        // settling commit (the bars arrive in phases — IDB cache → network → backfill —
        // each a separate commit). This keeps the chart from snapping during the load.
        // Once the count stops changing, data has settled; release control so ordinary
        // scroll/zoom is respected again.
        const _pt = pendingTfReframeRef.current
        let from, to
        if (_pt.width > 0) {
          const lastIdx = filteredBars.length - 1
          to = lastIdx + _pt.width * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
          from = to - _pt.width
        } else {
          ;({ from, to } = computeDefaultLogicalRange(
            filteredBars.length, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride, plotWidthPx: plotWidthOf(chart, containerRef.current) }
          ))
        }
        try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch { /* mid-load */ }
        // The session preview candle is part of SETTLING, not a post-settle live bar.
        // It lands ~1s after the RTH bars (separate per-symbol /api/bars?tf=5 fetch),
        // so keying release on the RTH count alone released the guard one commit too
        // early: the candle then appended with nothing re-asserting the range, and
        // shiftVisibleRangeOnNewBar walked the whole view left by a bar — the "opens,
        // then repositions once" jitter when flipping tickers in pre/post market.
        // Holding the guard until the aggregate resolves keeps the RTH bars exactly
        // put; the preview candle just appears in the right pad.
        const _sessionSettled = !sessionCandleActive || sessionExtReady
        if (filteredBars.length === oldBarCount && _sessionSettled) pendingTfReframeRef.current = null
      } else {
        // "Was viewing the latest": last bar visible with a normal (not huge) right gap.
        // Width-proportional floor (was a flat -1): LWC-side drift during a
        // warm-cache commit storm can park the newest candle ~2 bars past the
        // right edge (observed prePad -2.2 at width 90 on grid-cell remounts) —
        // still "viewing the latest". Proportional so a tightly-zoomed intraday
        // chart keeps the old -1 floor and a deliberate 2-bar nudge there is
        // never snapped back; wide windows are additionally protected by the
        // pos<0.85/pos>1.02 gate below, which a small nudge doesn't trip.
        const _padFloor = Math.max(1, preWidth * 0.03)
        const wasViewingLatest = preWidth > 0 && prePad >= -_padFloor && prePad <= Math.max(8, preWidth * 0.25)
        // …but ONLY when the user hasn't deliberately moved the view. This net
        // corrects DRIFT (LWC/data-commit side effects); a pan or zoom that walks
        // the newest candle left is the user's intent, and re-pinning it made the
        // chart snap back to the default window on the very next live commit —
        // i.e. panning left was impossible. The latch clears on symbol/timeframe
        // change and on an explicit "Reset view" (see userViewMovedRef).
        if (wasViewingLatest && !userViewMovedRef.current) {
          let fr = null
          try { fr = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
          if (fr) {
            const w = fr.to - fr.from
            const lastIdx = filteredBars.length - 1
            const pos = w > 0 ? (lastIdx - fr.from) / w : 1  // newest candle's 0..1 screen position
            // Drifted: newest candle pushed left into the middle (pos < 0.85) or shoved
            // off the right edge (pos > 1.02). Re-pin it to the standard load position.
            if (w > 0 && (pos < 0.85 || pos > 1.02)) {
              const to2 = lastIdx + w * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
              const from2 = to2 - w
              try { chart.timeScale().setVisibleLogicalRange({ from: from2, to: to2 }) } catch { /* out of range mid-load */ }
            }
          }
        }
      }
    }

    // Replay view lock — re-assert the captured right-relative view on EVERY commit so a
    // load PHASE that changes the bar count (IDB → network → backfill) can't shift it, and
    // no other guard can snap it to present. Skipped while the user is actively dragging
    // (pointer down), which would fight a live pan; the drag's own onUp re-captures.
    if (replayCutoff && replayViewLockedRef.current && replayLockedViewRef.current
        && !viewPointerRef.current && !entryDate && !exactDateRange && filteredBars.length > 1) {
      const _lw = replayLockedViewRef.current.width
      const _to = filteredBars.length - replayLockedViewRef.current.barsFromRight
      const _from = _to - _lw
      if (_lw > 0 && Number.isFinite(_from) && Number.isFinite(_to) && _to > 1 && _from < filteredBars.length) {
        try { chart.timeScale().setVisibleLogicalRange({ from: _from, to: _to }) } catch { /* mid-load */ }
      }
    }

    // ── NEVER-BLANK backstop (mechanism-agnostic) ──
    // A blank chart — the visible logical range landing so far off the data that NO
    // real candle is on screen (just the price axis) — is never intended, whatever
    // produced it: a series-length REPLACE re-anchor near-miss, a same-count slid
    // REPLACE with no re-anchor, or a far-ahead developing bar + shiftVisibleRange.
    // Unlike the pinned-right net above, this fires EVEN after a user pan
    // (userViewMovedRef), because it triggers ONLY when <0.5 of a real bar is
    // visible — a legitimately scrolled-back or zoomed view always shows bars and is
    // left untouched. Recovers what previously required a manual "Reset view".
    if (!entryDate && !exactDateRange && filteredBars.length > 1) {
      let fr = null
      try { fr = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
      if (fr) {
        const lastIdx2 = filteredBars.length - 1
        const visibleReal = Math.min(fr.to, lastIdx2) - Math.max(fr.from, 0)
        if (visibleReal < 0.5) {
          const w = Math.max(1, fr.to - fr.from)
          const to2 = lastIdx2 + w * (1 - lastCandlePos(plotWidthOf(chart, containerRef.current)))
          const from2 = to2 - w
          try { chart.timeScale().setVisibleLogicalRange({ from: from2, to: to2 }) } catch { /* mid-load */ }
        }
      }
    }

    // Model Book (exactDateRange): the year frame is DETERMINISTIC for this (stock,
    // year), so re-apply it on EVERY data update — not only on the sym/tf switch
    // handled above. The bars load in phases (IDB cache → network refetch), and a
    // later phase with a different bar count would otherwise leave the prior logical
    // range mapping to the wrong dates for one frame: the chart (and the ^IXIC pane
    // that rides its time scale) glitches to a wrong spot and snaps back while
    // scrolling fast. Applying it here, in the SAME effect as setData above, makes
    // the new bars + correct year frame paint atomically — no transient. Skipped
    // while a setup/catalyst focus zoom owns the view (focusActiveRef).
    if (exactDateRange && entryDate && filteredBars.length > 0) {
      if (focusActiveRef.current) {
        // A setup-focus zoom owns the view. A background bars refetch (SWR network
        // swap after the IDB cache) re-runs updateChart, and the setData() above
        // perturbs the horizontal logical range. Without re-asserting the focus
        // window here the chart snaps back to the default/year view (candles shift
        // left, empty space on the right) WHILE the vertical stays pinned to the
        // focus band via focusPriceRangeRef — the "glitches to the left" bug.
        // Re-pin to the settled focus range; the year re-pin below is skipped.
        const r = focusRangeRef.current
        if (r) { try { chart.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to }) } catch { /* out of range mid-load */ } }
      } else if (exactPinSigRef.current
                 && exactPinSigRef.current.startsWith(`${sym}_${resolvedTf}|`)
                 && exactPinSigRef.current !== `${sym}_${resolvedTf}|${entryDate}|${exitDate}`) {
        // The exact-range dates just changed on the SAME chart (Setup ⇄ Result
        // flip). Don't snap to the new frame here — leave the view at the
        // outgoing frame so the exact-range pin effect (which runs after this in
        // the same commit) can start its animated glide FROM it. Snapping first
        // would zero the animation's start range and kill the transition.
      } else {
        let _s = filteredBars.findIndex(b => b.t >= entryDate)
        let _e = filteredBars.length - 1
        if (exitDate) {
          for (let i = filteredBars.length - 1; i >= 0; i--) {
            if (filteredBars[i].t <= exitDate) { _e = i; break }
          }
        }
        const _has = _s >= 0 && _e >= _s && (!exitDate || filteredBars[_s].t <= exitDate)
        if (!_has) { _e = filteredBars.length - 1; _s = Math.max(0, _e - 251) }  // year fell in a delisting gap → recent ~year
        // Frame start predates the first bar (before an IPO) → blank-space pad.
        let _from = _s
        if (_has && _s === 0) {
          _from = -leadingBlankBars(_dateToMs(entryDate), _dateToMs(filteredBars[0].t), resolvedTf)
        }
        const _padR = frameRightPadFrac > 0 ? Math.round((_e - _from) * frameRightPadFrac) : 0
        try { chart.timeScale().setVisibleLogicalRange({ from: _from, to: _e + _padR }) } catch { /* out of range mid-load */ }
      }
    }

    // Track current bar count + bars so the next ticker switch can right-anchor the
    // preserved view and measure the outgoing vertical placement.
    lastBarCountRef.current = filteredBars.length
    prevBarsRef.current = filteredBars
    // Baseline for the next render plan — the bars this paint actually put on screen.
    prevPaintBarsRef.current = displayBars
    // ⚠️ `userDefsGeneration` IS A DEPENDENCY ON MODULE STATE, AND IT IS
    // REDUNDANT TODAY. This body resolves every instance through
    // `engineRegistry.getDefinition`, and a user's saved definition is installed
    // asynchronously (SWR) after the first paint — so the version of that state
    // belongs here. Task 16's gauntlet measured that removing it changes nothing
    // (mutation M3 SURVIVED): something else in this list is already unstable per
    // render. Kept as the one declaration that names this dependency; the full
    // reasoning is at the `useInstalledUserDefinitions` call site above.
  }, [filteredBars, displayBars, ohlcData, closeData, volData, overlayData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, allPriceLines, dpZones, sessionShadeBands, _shadeOn, watermark, watermarkOpacity, cs, adjustTime, resolvedTf, tickerMeta, watermarkMeta, vwapOverride, hideWatermark, hidePriceLine, leftBarPad, modelBookLook, frozen, candleFrameFade, fadeCutoff, fitPriceToCandles, dailyDefaultBars, visibleBarsOverride, canvasTheme, sessionPreviewLastBar, sessionCandleActive, sessionExtReady, userDefsGeneration])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

  // ── Live session tags (Pre/Post chip + locked RTH close) ──────────────────
  // Their own applier, deliberately OUTSIDE updateChart. These tags follow the live
  // extended-hours price, so while they rode `allPriceLines` every ext-price change
  // re-ran the entire repaint body (JSON.stringify of the settings blob, an O(n)
  // render-plan diff, an O(n) session-band pass, a marker-layer rebuild) — the
  // pre-market pan/crosshair stutter. Here a price move is a single applyOptions on
  // an existing price line: no teardown, no axis rebuild, no bar-array work.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!chartReady || !series) return
    // A recreated series has no price lines of ours; drop the stale handles so the
    // count check below rebuilds rather than applyOptions-ing into the void.
    if (sessionTagSeriesRef.current !== series) {
      sessionTagRefs.current = []
      sessionTagSeriesRef.current = series
    }
    const tags = activeSessionTags || []
    const opts = (t) => ({
      price: t.price,
      color: t.color || cs.textColor,
      lineWidth: t.lineWidth || 1,
      lineStyle: t.lineStyle ?? 2,
      axisLabelVisible: t.axisLabelVisible ?? true,
      lineVisible: t.lineVisible ?? true,   // ext tag = axis chip only, no line
      title: t.title || '',
    })
    // Same tag count = same tags in the same roles (daily = [locked close, ext],
    // intraday = [ext]); only their prices/titles move. Update in place.
    if (sessionTagRefs.current.length === tags.length) {
      tags.forEach((t, i) => {
        const o = opts(t)
        // The INTRADAY Pre/Post chip's live price is owned by the rAF sync effect
        // below (glued to the developing candle); this per-tick effect must not fight
        // it on price, or the chip flickers between two feeds. Keep title/color fresh.
        if (sessionTagsIntraday && t._sessionTag === 'ext') delete o.price
        try { sessionTagRefs.current[i].applyOptions(o) } catch { /* series gone */ }
      })
      return
    }
    for (const pl of sessionTagRefs.current) {
      try { series.removePriceLine(pl) } catch { /* series gone */ }
    }
    sessionTagRefs.current = tags.map((t) => series.createPriceLine(opts(t)))
  }, [chartReady, activeSessionTags, cs.textColor, sessionTagsIntraday])

  // Glue the intraday Pre/Post axis chip to the developing candle IN REAL TIME. The
  // candle is painted from liveBarRef by whichever writer owns it (Finnhub tick /
  // Massive push / realtimeCandle) — each on its OWN feed + throttle — while the chip
  // previously read sessionExtPrice, a DIFFERENT feed, so during a fast pre/post-market
  // move the two showed different prices. A rAF loop mirrors the chip to the candle's
  // exact drawn close (liveBarRef.close) every frame, so they move in unison with no
  // cross-feed lag. Intraday ext only; only writes when the value actually changes.
  useEffect(() => {
    if (!sessionTagsIntraday) return
    let raf = 0
    let lastPx = null
    const tick = () => {
      const line = sessionTagRefs.current?.[0]
      const px = liveBarRef.current?.close
      if (line && Number.isFinite(px) && px > 0 && px !== lastPx) {
        lastPx = px
        try { line.applyOptions({ price: px }) } catch { /* series gone */ }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [sessionTagsIntraday])

  // ── Writer F of the single-writer invariant (index @ barsPushActiveRef decl):
  // custom-TF live developing bar ──
  // Custom intraday TFs skip the native single-writer machinery (that's keyed on the
  // 8 native codes), so their candle+quote would freeze. Give them a lightweight live
  // writer: fold the live price into the last visible candle every tick. Runs AFTER
  // updateChart so it wins over the 30s setData; native TFs untouched (_isCustomTf).
  // ⚠️ IT CONSULTS NEITHER barsPushActiveRef NOR provisionalStaleRef, AND THAT IS
  // CORRECT — both are gated on the five NATIVE intraday codes (`realtimeTfEligible`
  // inside `_pushOptIn`; `isIntraday &&` on provisionalStaleRef), so both are
  // structurally false whenever this effect runs. It went unindexed until 2026-08-07;
  // `engine/__tests__/singleWriterIndex.test.js` now derives it and pins that premise.
  useEffect(() => {
    if (!_isCustomTf || !_customBaseIntraday || cs.heikinAshi) return   // HA shows transformed bars, not raw
    const series = candleSeriesRef.current
    if (!series || !filteredBars?.length) return
    const last = filteredBars[filteredBars.length - 1]
    if (typeof last.t !== 'number') return
    const lp = sym ? livePrices[sym] : null
    const px = lp && Number.isFinite(lp.price) && lp.price > 0 ? lp.price : null
    if (px == null) return
    // In Regular Hours, don't fold a pre/post print into the frozen RTH close.
    if (!showExtended) {
      const et = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      const [h, m] = et.split(':').map(Number)
      const nowMin = h * 60 + m
      if (nowMin < 570 || nowMin >= 960) return
    }
    const time = adjustTime(last.t)
    try {
      series.update({ time, open: last.o, high: Math.max(+last.h, px), low: Math.min(+last.l, px), close: px })
    } catch { /* time regressed / series mid-swap */ }
  }, [_isCustomTf, _customBaseIntraday, filteredBars, livePrices, sym, adjustTime, showExtended, cs.heikinAshi])

  // Suppress the native last-value axis tag while the session tags are shown, so
  // the green tag we render (locked at the RTH close) isn't doubled by LWC's
  // built-in tag following the developing bar. Re-applied on series recreation.
  // INTRADAY: same suppression while the Pre/Post tag is up, so pre/post shows
  // exactly one price label. Gated on the tag actually existing (a pre-market
  // session with no prints yet has none) — otherwise the scale would go bare.
  const intradayExtTagActive = !!intradaySessionTagLines?.length
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return
    const on = !hideLastValue && !sessionTagsActive && !intradayExtTagActive
    try { candleSeriesRef.current.applyOptions({ lastValueVisible: on }) } catch { /* older LWC */ }
  }, [sessionTagsActive, intradayExtTagActive, hideLastValue, chartReady, cs.chartType])

  // TradingView-style layering: keep the candle bodies ABOVE the MA / Bollinger /
  // VWAP overlays so those lines pass BEHIND the opaque bodies instead of drawing
  // on top of them. LWC stacks series by their pane index; setSeriesOrder(big)
  // clamps the candle series to the top of its pane. Runs after updateChart (its
  // dep) so it re-asserts the order whenever overlays/series are (re)built.
  useEffect(() => {
    if (!candlesOnTop) return
    const s = candleSeriesRef.current
    if (!s || typeof s.setSeriesOrder !== 'function') return
    try { s.setSeriesOrder(Number.MAX_SAFE_INTEGER) } catch { /* older LWC */ }
  }, [updateChart, candlesOnTop])

  // Gold/white setup-day candle (Model Book). Runs AFTER updateChart so it
  // overrides the plain candle data. A candle-only setData (range preserved) →
  // just a recolor, no flash, no zoom reset. `updateChart` is a dep so this
  // re-fires every time updateChart repaints plain candles (e.g. a markers /
  // indicators / watermark dep changed) — that's what keeps the highlight from
  // intermittently vanishing — WITHOUT pulling the highlight into updateChart's
  // own deps (which would re-run its visible-range logic and fight the focus
  // zoom). Scoped: does nothing unless a highlight is/was set.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series || !isOhlcType(cs.chartType)) return
    if (highlightTimeSet) {
      hadHighlightRef.current = true
      try { series.setData(fadedOhlc) } catch { /* range can be out of bounds mid-load */ }
    } else if (hadHighlightRef.current) {
      hadHighlightRef.current = false
      try { series.setData(ohlcData) } catch { /* clear gold back to normal */ }
    }
  }, [fadedOhlc, goldOhlc, ohlcData, highlightTimeSet, chartReady, cs.chartType, updateChart])

  // Volume crossfade re-tint (Setup⇄Result). Mirrors the candle recolor above and
  // MUST run AFTER updateChart so its setData wins over updateChart's full-opacity
  // volume paint (otherwise the post-setup bars flicker during the transition).
  useEffect(() => {
    const s = volumeSeriesRef.current
    if (!s || !candleFrameFade) return
    try { s.setData(fadedVolData) } catch { /* range can be out of bounds mid-load */ }
  }, [fadedVolData, candleFrameFade, chartReady, updateChart])

  // Pre-install the focus autoscale provider as soon as the chart is ready (for
  // glide-capable charts). The frameChanged glide otherwise installs it LAZILY on
  // the first Setup⇄Result flip, and that one applyOptions forces an autoscale
  // recompute mid-glide → the first transition "skips". Installing it up front
  // (inert — returns default autoscale until a glide sets focusPriceRangeRef)
  // makes the first transition as smooth as every later one.
  useEffect(() => {
    if (!chartReady || (!exactDateRange && !candleFrameFade)) return
    const series = candleSeriesRef.current
    if (!series || focusProviderInstalledRef.current) return
    try {
      series.applyOptions({
        autoscaleInfoProvider: (orig) => {
          const r = focusPriceRangeRef.current
          if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
            return { priceRange: { minValue: r.lo, maxValue: r.hi } }
          }
          return orig ? orig() : null
        },
      })
      focusProviderInstalledRef.current = true
    } catch { /* provider optional */ }
  }, [chartReady, exactDateRange, candleFrameFade, ohlcData])


  // Exact-range pin (Model Book): lock the view to [entryDate, exitDate].
  // MUST run AFTER updateChart() (above) so the series already holds the
  // current bars — otherwise our logical indices (computed from the new
  // filteredBars) wouldn't match the series and setData would snap the view
  // back to "now". Compares by epoch so it's robust to `t` being a
  // 'YYYY-MM-DD' string OR a unix timestamp number. Re-runs on every data
  // update so the network swap after the IDB cache can't revert it.
  useEffect(() => {
    if (!exactDateRange || !entryDate) return
    const chart = chartRef.current
    if (!chart || !filteredBars || filteredBars.length === 0) return
    // A setup-focus zoom (below) owns the view until the user toggles it off or
    // switches stock/timeframe. Releasing on a sym+tf change keeps the pin
    // correct for the new chart; otherwise yield so data refreshes don't snap
    // the zoomed-in view back to the full year.
    const fk = `${sym}_${resolvedTf}`
    if (focusKeyRef.current !== fk) {
      if (focusRafRef.current != null) { cancelAnimationFrame(focusRafRef.current); focusRafRef.current = null }  // a glide from the previous chart must not keep driving the new one
      focusActiveRef.current = false
      focusPriceRangeRef.current = null  // drop any in-flight focus vertical so the new chart autoscales cleanly
      focusRangeRef.current = null       // and its horizontal window so the year pin takes over
      focusKeyRef.current = fk
      sliceHoldRef.current = null        // a held wider slice belongs to the previous chart
    }
    // Same chart, but the framed dates changed (Setup ⇄ Result flip, or a year
    // switch landing on the same symbol): glide to the new frame instead of
    // snapping. Only when this chart was already framed once — a date change
    // arriving before the first framing (bars still loading) snaps as usual.
    const pinSig = `${fk}|${entryDate}|${exitDate}`
    const prevPinSig = exactPinSigRef.current
    const frameChanged = prevPinSig
      && prevPinSig !== pinSig
      && prevPinSig.startsWith(`${fk}|`)
      && String(yearFramedRef.current || '').startsWith(`${fk}:`)
    if (focusActiveRef.current && !frameChanged) return
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    const lo = toMs(entryDate)
    const hi = toMs(exitDate)
    let startIdx = filteredBars.findIndex(b => toMs(b.t) >= lo)
    let endIdx = filteredBars.length - 1
    if (!Number.isNaN(hi)) {
      for (let i = filteredBars.length - 1; i >= 0; i--) {
        if (toMs(filteredBars[i].t) <= hi) { endIdx = i; break }
      }
    }
    // Does the selected year actually have bars in the loaded series? Reused
    // tickers (e.g. SNDK, BE: an old delisted company, then a multi-year data
    // GAP, then the relisted company) can have the requested year fall entirely
    // in that gap — findIndex then points past the gap while endIdx is stuck
    // before it. The old code anchored startIdx to 0 in that case, which streamed
    // the DELISTED-ERA data (2016/2008) onto a recent-year view. Never do that:
    // if the year has no data, frame the most recent ~year of bars instead.
    const yearHasData = startIdx >= 0 && endIdx >= startIdx
      && toMs(filteredBars[startIdx].t) <= (Number.isNaN(hi) ? Infinity : hi)
    if (!yearHasData) {
      endIdx = filteredBars.length - 1
      startIdx = Math.max(0, endIdx - 251)
    }
    // Frame start predates the first loaded bar (e.g. before an IPO): pad the
    // left with blank space (negative logical index) so the chart honors the
    // requested start instead of clamping to bar 0 and over-zooming.
    let fromIdx = startIdx
    if (yearHasData && startIdx === 0) {
      fromIdx = -leadingBlankBars(lo, toMs(filteredBars[0].t), resolvedTf)
    }
    // Optional replay-style right margin: extend the framed window past the last
    // candle by a fraction of its width so there's blank space to annotate into
    // (Setup Library). Blank because the bars after exitDate are sliced out.
    const padRight = frameRightPadFrac > 0 ? Math.round((endIdx - fromIdx) * frameRightPadFrac) : 0
    // Store the LATEST computed range; the scheduled re-asserts below read this
    // ref (not captured locals) so a partial first data load can't lock stale
    // indices into the pending re-asserts (which showed the earliest bars).
    yearRangeRef.current = { from: fromIdx, to: endIdx + padRight }
    exactPinSigRef.current = pinSig
    const applyYear = () => {
      const r = yearRangeRef.current
      if (!r) return
      try {
        chart.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to })
        mainPriceScale()?.applyOptions({ autoScale: true })
      } catch { /* range can be out of bounds mid-load; next update re-pins */ }
    }
    if (frameChanged && instantFrameFlip) {
      // Instant cut (Setup Library): no glide — snap straight to the new frame,
      // like loading a fresh chart. Cancel any in-flight glide and pin the new
      // frame. yearFramedRef is stamped so the settle-window re-assert burst
      // doesn't fire on top of this.
      if (focusRafRef.current != null) { cancelAnimationFrame(focusRafRef.current); focusRafRef.current = null }
      focusActiveRef.current = false
      focusRangeRef.current = null
      // Let the chart snap via DEFAULT autoscale (it settles in the first painted
      // frame — pinning via the provider instead made LWC animate the price scale
      // over ~1s). Separately compute that SAME edge-to-edge range and hand it to
      // the annotation overlay so it places price-anchored lines at the correct
      // height in the same frame (LWC's own priceToCoordinate is async), then hand
      // back seamlessly once LWC's mapping catches up (identical by construction).
      focusPriceRangeRef.current = null
      const _ov = fitPriceToCandles ? null : overlayData
      const _tv = keepBarsAfterExit ? Math.min(endIdx + padRight, filteredBars.length - 1) : endIdx
      const _mmI = _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
      const _mt = Math.max(0, Math.min(0.45, _mmI?.top ?? 0))
      const _mb = Math.max(0, Math.min(0.45, _mmI?.bottom ?? 0))
      const _raw = _windowPriceRange(filteredBars, fromIdx, _tv, _ov)
      let targetVert = null
      if (_raw && (1 - _mt - _mb) > 0) {
        const _R = (_raw.hi - _raw.lo) / (1 - _mt - _mb)
        targetVert = { lo: _raw.lo - _mb * _R, hi: _raw.hi + _mt * _R }
      }
      applyYear()
      // Snap the price-anchored annotations to the same target range immediately.
      try { annRedrawRef.current?.(targetVert) } catch { /* overlay not mounted */ }
      yearFramedRef.current = `${fk}:${filteredBars.length}`
      if (sliceHoldRef.current) { sliceHoldRef.current = null; setSliceGen(g => g + 1) }
      return
    }
    if (frameChanged) {
      // Animated Setup ⇄ Result transition: same dual-axis glide as the setup
      // focus zoom — the window slides/stretches across the screen to the new
      // frame while the price scale rides along. focusActiveRef holds the view
      // for the duration so data refreshes / the scheduled re-asserts below
      // can't snap it mid-glide; updateChart's inline pin already skipped this
      // commit (it saw the date change), so the glide starts from the outgoing
      // frame. focusRangeRef stays null so mid-glide setData re-pins are no-ops.
      const series = candleSeriesRef.current
      if (series && !focusProviderInstalledRef.current) {
        try {
          series.applyOptions({
            autoscaleInfoProvider: (orig) => {
              const r = focusPriceRangeRef.current
              if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
                return { priceRange: { minValue: r.lo, maxValue: r.hi } }
              }
              return orig ? orig() : null
            },
          })
          focusProviderInstalledRef.current = true
        } catch { /* provider optional */ }
      }
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }
      // The vertical is fit to the real candles of each frame. Normally that's the
      // UNPADDED window (the replay pad to the right is blank, so including it would
      // crunch the candles). But in the Result view (keepBarsAfterExit) the pad is
      // filled with REAL post-result candles — a continued run (e.g. TASR) can peak
      // there, above the framed window's high — so the vertical must span the pad
      // too or those candles clip off the top of the settled view.
      const _glideOverlays = fitPriceToCandles ? null : overlayData
      const _tVEnd = keepBarsAfterExit ? Math.min(endIdx + padRight, filteredBars.length - 1) : endIdx
      // An explicit autoscaleInfoProvider price range is used EDGE-TO-EDGE by
      // lightweight-charts — it does NOT get the price scale's scaleMargins (those
      // only pad the default autoscale). So the raw candle high/low would sit flush
      // against the top/bottom of the pane (the tallest candle clipping off the top
      // in the Result view). Bake the same top/bottom headroom the default autoscale
      // would apply into the pinned range so the glide lands with proper margins.
      const _mm = _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
      const _padVert = (r) => {
        if (!r) return r
        const mt = Math.max(0, Math.min(0.45, _mm?.top ?? 0))
        const mb = Math.max(0, Math.min(0.45, _mm?.bottom ?? 0))
        const denom = 1 - mt - mb
        if (!(denom > 0)) return r
        const R = (r.hi - r.lo) / denom
        return { lo: r.lo - mb * R, hi: r.hi + mt * R }
      }
      const tRangeGlide = _padVert(_windowPriceRange(filteredBars, fromIdx, _tVEnd, _glideOverlays))
      let sRangeGlide = null
      // Start the glide FROM the outgoing frame, re-asserted explicitly (with the
      // same replay pad it's showing, so there's no pre-glide jump). The setData
      // for the new frame (Setup → Result appends bars) can leave the view
      // perturbed in this same commit; effects run before paint, so this restore
      // never flashes. Skipped when a glide is already in flight (rapid flipping)
      // — then we glide from wherever the view currently is.
      if (!focusActiveRef.current) {
        const [oldEntryRaw, oldExitRaw] = prevPinSig.slice(fk.length + 1).split('|')
        const oLo = toMs(oldEntryRaw === 'null' ? null : oldEntryRaw)
        const oHi = toMs(oldExitRaw === 'null' ? null : oldExitRaw)
        let oS = Number.isNaN(oLo) ? 0 : filteredBars.findIndex(b => toMs(b.t) >= oLo)
        if (oS < 0) oS = 0
        // The outgoing frame may have started before the first bar (pre-IPO blank
        // pad, e.g. CRWV's IPO-base setup view sits at a negative `from`). Start the
        // glide from where the view ACTUALLY is, not a snapped bar 0 — otherwise the
        // re-assert below jumps -N → 0 before the glide, glitching the transition.
        if (!Number.isNaN(oLo) && oS === 0) {
          oS = -leadingBlankBars(oLo, toMs(filteredBars[0].t), resolvedTf)
        }
        let oE = filteredBars.length - 1
        if (!Number.isNaN(oHi)) {
          for (let i = filteredBars.length - 1; i >= 0; i--) {
            if (toMs(filteredBars[i].t) <= oHi) { oE = i; break }
          }
        }
        sRangeGlide = _padVert(_windowPriceRange(filteredBars, oS, oE, _glideOverlays))
        const oPad = frameRightPadFrac > 0 ? Math.round((oE - oS) * frameRightPadFrac) : 0
        if (oE > oS) { try { chart.timeScale().setVisibleLogicalRange({ from: oS, to: oE + oPad }) } catch { /* mid-load */ } }
      }
      focusActiveRef.current = true
      focusRangeRef.current = null
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars,
        { from: fromIdx, to: endIdx + padRight }, 900, () => {
          focusActiveRef.current = false
          // Release a held wider slice (Result → Setup): the outgoing candles
          // are off-screen now, so the tail re-cut is invisible.
          if (sliceHoldRef.current) { sliceHoldRef.current = null; setSliceGen(g => g + 1) }
        }, overlayData, null, null, sRangeGlide, tRangeGlide)
      yearFramedRef.current = `${fk}:${filteredBars.length}`  // already framed — no settle-window re-assert burst needed
      return
    }
    applyYear()
    // First framing of this sym+tf: the chart created with autoSize keeps
    // re-laying-out for several frames after first paint (container 0→real
    // size, ResizeObserver, fonts), and each of those can override the range
    // back to the default latest view — the "shows 2026 until I click another
    // chart" bug. A single rAF fired too early. Re-assert across the whole
    // initial settle window. Guards (same sym+tf, no focus zoom) make a stock
    // switch or a setup click cancel the pending re-asserts; the user can't
    // have manually zoomed this early after load.
    // Re-assert across the settle window on the FIRST framing of this sym+tf AND
    // again whenever the bar count changes for it — the bars load in two phases
    // (instant IDB cache → delayed network swap), and an uncached still-trading
    // stock framed to a PAST year (e.g. the first 2016 name, data running to
    // today) gets its network bars AFTER the first re-assert window closes. Without
    // re-asserting on that swap, the post-network setData snaps the view to the
    // latest bars and it "scrolls back / stays on now until you click another
    // chart". Keying on bar count re-pins through every data phase. (Delisted/
    // custom-bar years end in-year and have a single phase, so they never showed
    // it — this makes every year behave identically.) Tail extended to 1.2s for
    // slow networks.
    const frameSig = `${fk}:${filteredBars.length}`
    if (yearFramedRef.current !== frameSig) {
      yearFramedRef.current = frameSig
      const reassert = () => { if (focusKeyRef.current === fk && !focusActiveRef.current) applyYear() }
      requestAnimationFrame(reassert)
      requestAnimationFrame(() => requestAnimationFrame(reassert))
      setTimeout(reassert, 120)
      setTimeout(reassert, 320)
      setTimeout(reassert, 650)
      setTimeout(reassert, 1200)
    }
    // `mergedMarkers`/`highlightTimeSet` are in the deps so a Model Book tab
    // switch (which swaps markers + highlighted candles → an internal setData
    // that snaps the view to the latest bars) re-runs this pin and re-frames the
    // year. The focusActiveRef guard above means a live setup/catalyst zoom is
    // untouched; all effects run before paint, so there's no flash of "now".
  }, [exactDateRange, entryDate, exitDate, filteredBars, sym, resolvedTf, mergedMarkers, highlightTimeSet, overlayData, frameRightPadFrac, instantFrameFlip])

  // Each stock starts at the year view with setup text hidden; the first focus
  // zoom then eases it in. Without this reset, switching from a focused stock
  // would leave textFadeRef at 1 and the next setup's text would pop in instantly.
  // When annotationsTextVisible drives the fade directly (Setup Library — no focus
  // zoom), seed from it instead of 0 so text is present on first paint (this effect
  // runs AFTER the snap effect above on mount and would otherwise clobber it).
  useEffect(() => {
    textFadeRef.current = annotationsTextVisible == null ? 0 : (annotationsTextVisible ? 1 : 0)
  }, [sym, resolvedTf])  // eslint-disable-line react-hooks/exhaustive-deps -- read at mount only; sym/tf are stable within an example

  // Animated "focus a setup" zoom (Model Book). On a focusNonce bump: if
  // focusDate is set, smoothly zoom so that bar is the last candle on screen
  // (with focusBarsBack bars of lead-up to its left); if focusDate is null,
  // zoom back out to the full [entryDate, exitDate] year and hand the view
  // back to the pin above. Only fires on an actual nonce change so routine
  // data refreshes never re-trigger it.
  useEffect(() => {
    if (focusNonce === lastFocusNonceRef.current) return
    const chart = chartRef.current
    // Leave the nonce unconsumed until we can actually act on it: an initial
    // mount-time focus (Setup Library examples open ON the setup view) fires
    // before the chart/bars exist, and this effect re-runs via the filteredBars
    // dep once they arrive.
    if (!chart || !filteredBars || filteredBars.length === 0) return
    lastFocusNonceRef.current = focusNonce
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    focusKeyRef.current = `${sym}_${resolvedTf}`
    // Install (once) the autoscale provider that lets the focus zoom drive a
    // smoothly-interpolated vertical via focusPriceRangeRef. When the ref is null
    // it defers to the chart's default autoscale, so it's inert outside a focus
    // animation. Model Book only — other charts never call _animateFocusZoom.
    const series = candleSeriesRef.current
    if (series && !focusProviderInstalledRef.current) {
      try {
        series.applyOptions({
          autoscaleInfoProvider: (orig) => {
            const r = focusPriceRangeRef.current
            if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
              return { priceRange: { minValue: r.lo, maxValue: r.hi } }
            }
            return orig ? orig() : null
          },
        })
        focusProviderInstalledRef.current = true
      } catch { /* provider optional */ }
    }
    try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }

    if (focusDate) {
      // Last bar on/at-or-before the setup date becomes the rightmost candle.
      const target = toMs(focusDate)
      let idx = -1
      for (let i = filteredBars.length - 1; i >= 0; i--) {
        if (toMs(filteredBars[i].t) <= target) { idx = i; break }
      }
      if (idx < 0) idx = filteredBars.length - 1
      const to = idx                           // integer index = the setup bar is the last fully-shown candle, nothing after it (same as the year pin)
      // Left edge: an explicit start date (first bar on/after it) wins; otherwise
      // fall back to a fixed lead-up. Guard against a start that isn't actually
      // left of the setup bar (bad input) by reverting to the bars-back default.
      let from = Math.max(0, to - focusBarsBack)
      if (focusStartDate) {
        const startMs = toMs(focusStartDate)
        if (!Number.isNaN(startMs)) {
          const sIdx = filteredBars.findIndex(b => toMs(b.t) >= startMs)
          if (sIdx >= 0 && sIdx < idx) from = sIdx
        }
      }
      focusActiveRef.current = true
      focusRangeRef.current = { from, to }   // settled window — updateChart re-asserts it on a bars refetch so the view can't snap back
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars, { from, to }, 850, null, overlayData, textFadeRef, true)
    } else {
      // Zoom back out to the framed year — same dual-axis glide as the zoom-in.
      // Hold the view (focusActiveRef stays true) until the animation finishes so
      // a data refresh can't snap the pin mid-zoom; release it in onDone.
      const lo = toMs(entryDate)
      const hi = toMs(exitDate)
      let startIdx = filteredBars.findIndex(b => toMs(b.t) >= lo)
      if (startIdx < 0) startIdx = 0
      let endIdx = filteredBars.length - 1
      if (!Number.isNaN(hi)) {
        for (let i = filteredBars.length - 1; i >= 0; i--) {
          if (toMs(filteredBars[i].t) <= hi) { endIdx = i; break }
        }
      }
      if (endIdx < startIdx) endIdx = filteredBars.length - 1
      // Frame start predates the first bar (before an IPO) → blank-space pad so
      // the zoom-out lands on the same framed window as updateChart's year pin.
      let fromIdx = startIdx
      if (startIdx === 0) {
        fromIdx = -leadingBlankBars(lo, toMs(filteredBars[0].t), resolvedTf)
      }
      focusActiveRef.current = true
      focusRangeRef.current = null   // zooming back out to the year — let updateChart's year re-pin resume
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars,
        { from: fromIdx, to: endIdx }, 850, () => { focusActiveRef.current = false }, overlayData, textFadeRef, false)
    }
  }, [focusNonce, focusDate, focusStartDate, focusBarsBack, filteredBars, entryDate, exitDate, sym, resolvedTf, overlayData])

  // Cancel any in-flight focus animation on unmount.
  useEffect(() => () => { if (focusRafRef.current != null) cancelAnimationFrame(focusRafRef.current) }, [])

  // Manual-interaction escape (Model Book): if the user wheel-zooms or drags the
  // chart while a setup focus is active, they've left the setup view — release
  // focus (annotations were lingering because they track the focus state, not
  // the live view). Skip while authoring annotations (drawing uses the chart).
  const annEditableRef = useRef(annotationsEditable)
  annEditableRef.current = annotationsEditable
  useEffect(() => {
    if (!onFocusEscape) return
    const el = containerRef.current
    if (!el) return
    const escape = () => {
      if (!focusActiveRef.current || annEditableRef.current) return
      focusActiveRef.current = false
      focusPriceRangeRef.current = null
      focusRangeRef.current = null
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }
      onFocusEscape()
    }
    // Wheel-zoom escapes immediately. For drag-pan, only escape once the pointer
    // actually moves past a threshold — a plain click (incl. clicking a setup
    // candle to open the intraday popup) shouldn't drop focus. 8px tolerates the
    // few px of jitter a real click carries; a deliberate pan moves far more.
    const onWheel = () => escape()
    let down = null
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY } }
    const onMove = (e) => {
      if (!down) return
      if (Math.abs(e.clientX - down.x) > 8 || Math.abs(e.clientY - down.y) > 8) { down = null; escape() }
    }
    const onUp = () => { down = null }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
  }, [onFocusEscape])

  // Apply the price-scale mode from effectiveScale (Normal/Log/Percent).
  // Owns the right scale's mode so the A/L/% toggle + forceLogScale default
  // both take effect immediately and persist across data updates.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const mode = effectiveScale === 'pct' ? 2 : (effectiveScale === 'log' ? 1 : 0)
    // Apply to the PRICE scale (via the candle series, robust to the index pane
    // at pane 0) AND the index-comparison pane, so the A/L/% toggle switches
    // both panes together. The index line is raw price, so log/percent are valid.
    try { mainPriceScale()?.applyOptions({ mode }) } catch { /* pre-init */ }
    try { indexPaneSeriesRef.current?.priceScale().applyOptions({ mode }) } catch { /* no index pane */ }
  }, [effectiveScale, chartReady, indexPaneSymbol, indexPaneSeries, mainPriceScale])

  // ── Multi-symbol comparison overlays — add/remove series ──
  // Uses left-side 'comparison' price scale (independent of right price + 'compare' scale).
  // Runs whenever `comparisonSeries` changes (sym list, fetched data, or colors).
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const map = comparisonSeriesRefs.current
    const wanted = new Set(comparisonSeries.map(s => s.sym))

    // Remove series no longer wanted
    for (const [sym, series] of map.entries()) {
      if (!wanted.has(sym)) {
        try { chart.removeSeries(series) } catch {}
        map.delete(sym)
      }
    }

    // Add or update wanted series
    for (const cmp of comparisonSeries) {
      let series = map.get(cmp.sym)
      if (!series) {
        try {
          series = chart.addSeries(LineSeries, {
            priceScaleId: 'left',
            color: cmp.color,
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3,
            title: cmp.sym,
          })
          map.set(cmp.sym, series)
        } catch {
          continue
        }
      } else {
        try { series.applyOptions({ color: cmp.color }) } catch {}
      }
      try { series.setData(cmp.points) } catch {}
    }

    // Toggle left price scale visibility based on whether any comparisons are active
    try {
      if (wanted.size > 0) {
        chart.priceScale('left').applyOptions({
          visible: true,
          scaleMargins: { top: 0.1, bottom: 0.1 },
          borderVisible: false,
        })
      } else {
        chart.priceScale('left').applyOptions({ visible: false })
      }
    } catch {}
  }, [comparisonSeries])

  // ── Index comparison pane (Model Book) — white line in a pane ON TOP ──
  // Creates a LineSeries in its own pane, moves that pane to index 0 (above the
  // price pane) and sizes the three panes [index | price | volume]. Fully
  // additive: when indexPaneSymbol is null, nothing here runs and the chart is
  // byte-identical. Main-pane references elsewhere use getPane() so they stay
  // correct with the extra pane on top. The line is raw price; its scale mode
  // (Normal/Log/Percent) follows the A/L/% toggle so both panes switch together.
  useEffect(() => {
    const chart = chartRef.current
    const mainPane = candleSeriesRef.current?.getPane?.()
    if (!chart || !mainPane) return

    // Tear down ONLY when the feature is turned off (symbol null). Do NOT remove
    // the pane just because the data is transiently empty during a ticker switch —
    // removing it shrinks the price pane and makes the watermark/annotations skip.
    if (!indexPaneSymbol) {
      if (indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      if (indexPaneSeriesRef.current) {
        try { chart.removeSeries(indexPaneSeriesRef.current) } catch {}
        indexPaneSeriesRef.current = null
        // Restore 2-pane (price + volume) or single-pane sizing.
        try {
          const volPane = volumeSeriesRef.current?.getPane?.()
          if (volPane && volPane !== mainPane) {
            const pct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))
            mainPane.setStretchFactor(100 - pct)
            volPane.setStretchFactor(pct)
          } else {
            mainPane.setStretchFactor(100)
          }
        } catch {}
      }
      return
    }
    // Data not ready yet (e.g. mid ticker-transition) — keep the pane mounted and
    // its current line, skip the update, so the layout (and the overlays pinned to
    // it) stays put instead of shrinking and snapping back.
    if (!indexPaneSeries.length) return

    // Create the series in a fresh bottom pane, then hoist that pane to the top.
    if (!indexPaneSeriesRef.current) {
      try {
        const paneCount = chart.panes().length
        const s = chart.addSeries(LineSeries, {
          color: indexPaneColor,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,  // no floating "IXIC <price>" box — label sits top-left of the pane instead
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 2,
          priceScaleId: 'right',
          // Pin the vertical scale to the year's FULL ^IXIC range (same for every
          // stock in the year) so the Nasdaq line + its % annotations stay put when
          // flipping tickers instead of re-autoscaling to each stock's clipped slice.
          autoscaleInfoProvider: () => {
            const sc = indexScaleRef.current
            return (sc.pin && sc.range)
              ? { priceRange: { minValue: sc.range.min, maxValue: sc.range.max } }
              : null
          },
        }, paneCount)
        indexPaneSeriesRef.current = s
        try { s.getPane().moveTo(0) } catch {}
        try { s.priceScale().applyOptions({ borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.2 } }) } catch {}
      } catch { /* pane API unavailable — index pane optional */ }
    }

    if (indexPaneSeriesRef.current) {
      try { indexPaneSeriesRef.current.applyOptions({ color: indexPaneColor }) } catch {}
      // Mode (Normal/Log/Percent) follows the A/L/% toggle — applied here too (not
      // just the mode effect) because that effect runs before this series exists on
      // first load. Cheap + doesn't move the pane, so always applied.
      try {
        const idxMode = effectiveScale === 'pct' ? 2 : (effectiveScale === 'log' ? 1 : 0)
        indexPaneSeriesRef.current.priceScale().applyOptions({ mode: idxMode })
      } catch {}

      // SKIP the line/MA setData + pane relayout when the index data is unchanged
      // since the last draw. Flipping tickers WITHIN a year yields the identical
      // ^IXIC line (same year window), so re-running setData + setStretchFactor only
      // caused a one-frame flicker/shift. A signature (length + sampled times/values
      // + pane sizes) detects a real change — a year switch, a settings change, or a
      // gappy reused ticker whose index coverage actually differs — and only THEN
      // redraws. Result: the Nasdaq pane sits perfectly still during fast scrolling.
      const _isig = indexPaneSeries
      const _mid = _isig[Math.floor(_isig.length / 2)]
      const sig = [
        _isig.length, _isig[0]?.time, _isig[0]?.value, _mid?.time, _mid?.value,
        _isig[_isig.length - 1]?.time, _isig[_isig.length - 1]?.value,
        indexPaneMaSeries.length, indexPaneHeightPct, volumePaneHeightPct, showVolume,
      ].join('|')
      if (sig === lastIndexSigRef.current) return  // identical — leave the pane untouched
      lastIndexSigRef.current = sig

      try { indexPaneSeriesRef.current.setData(indexPaneSeries) } catch {}
      // Keep extra room below the line so a decline's "-X%" label fits under the
      // trough without crowding the pane edge (idempotent — also set at creation).
      try { indexPaneSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } }) } catch {}

      // 50-period SMA line on the index pane. Shares the index line's pane +
      // 'right' price scale (so it tracks log/pct mode and aligns with the
      // index). Color AND line width/type match the price chart's 50 SMA
      // exactly (same hairline in Model Book's boldCandles mode) so the two
      // blues render as the identical shade — a thicker line dodges the
      // anti-aliasing dimming the hairline gets and would look brighter.
      // autoscaleInfoProvider null = the index line drives the pane's scale,
      // the MA just rides inside it.
      const _idxMaWidth = boldCandles ? 0.5 : 1
      const _idxMaLineType = boldCandles ? LineType.Curved : LineType.Simple
      if (indexPaneMaSeries.length) {
        if (!indexMaSeriesRef.current) {
          try {
            const idxPaneIndex = indexPaneSeriesRef.current.getPane().paneIndex()
            indexMaSeriesRef.current = chart.addSeries(LineSeries, {
              color: indexMaColor,
              lineWidth: _idxMaWidth,
              lineType: _idxMaLineType,
              priceScaleId: 'right',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              autoscaleInfoProvider: () => null,
            }, idxPaneIndex)
          } catch { /* pane API unavailable — index MA optional */ }
        }
        if (indexMaSeriesRef.current) {
          try { indexMaSeriesRef.current.applyOptions({ color: indexMaColor, lineWidth: _idxMaWidth, lineType: _idxMaLineType }) } catch {}
          try { indexMaSeriesRef.current.setData(indexPaneMaSeries) } catch {}
        }
      } else if (indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      // Size [index | price | volume].
      try {
        const idxPct = Math.min(40, Math.max(8, indexPaneHeightPct ?? 18))
        const idxPane = indexPaneSeriesRef.current.getPane()
        const volPane = volumeSeriesRef.current?.getPane?.()
        if (volPane && volPane !== mainPane) {
          const volPct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))
          idxPane.setStretchFactor(idxPct)
          volPane.setStretchFactor(volPct)
          mainPane.setStretchFactor(Math.max(20, 100 - idxPct - volPct))
        } else {
          idxPane.setStretchFactor(idxPct)
          mainPane.setStretchFactor(100 - idxPct)
        }
      } catch {}
    }
  }, [indexPaneSymbol, indexPaneSeries, indexPaneMaSeries, indexMaColor, indexPaneColor, indexPaneHeightPct, volumePaneHeightPct, cs, chartReady, effectiveScale])

  // Remove the index-pane series on unmount.
  useEffect(() => {
    return () => {
      const chart = chartRef.current
      if (chart && indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      if (chart && indexPaneSeriesRef.current) {
        try { chart.removeSeries(indexPaneSeriesRef.current) } catch {}
        indexPaneSeriesRef.current = null
      }
    }
  }, [])

  // Track the price pane's on-screen box so the annotation/callout overlays
  // align to it when the index pane shifts it down. Measures the pane's DOM
  // element (v5.1 getHTMLElement) vs the container; re-measures on container OR
  // pane resize plus a couple of post-layout ticks. No index pane → bounds null.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !indexPaneSymbol) { setOverlayBounds(null); return }
    let raf = null
    const measure = () => {
      try {
        const paneEl = candleSeriesRef.current?.getPane?.()?.getHTMLElement?.()
        if (!paneEl) return
        const c = container.getBoundingClientRect()
        const p = paneEl.getBoundingClientRect()
        const top = Math.max(0, p.top - c.top)
        const height = p.height
        if (!height) return
        setOverlayBounds(prev =>
          (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - height) < 0.5)
            ? prev : { top, height })
      } catch { /* pane not ready */ }
    }
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    const paneEl = candleSeriesRef.current?.getPane?.()?.getHTMLElement?.()
    if (paneEl) ro.observe(paneEl)
    const t1 = setTimeout(measure, 60)
    const t2 = setTimeout(measure, 300)
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); if (raf) cancelAnimationFrame(raf) }
    // NOTE: keyed on whether the index pane EXISTS (length>0), not on the data
    // itself — so a ticker switch (new data, pane unchanged) doesn't re-measure
    // and momentarily shift the overlays. The ResizeObserver catches real resizes.
  }, [indexPaneSymbol, indexPaneSeries.length > 0, indexPaneHeightPct, volumePaneHeightPct, showVolume, chartReady])

  // Track the INDEX pane's on-screen box (same approach as the price-pane
  // overlayBounds above, but measuring the index pane via indexPaneSeriesRef) so
  // the index annotation overlay aligns to the top pane. Only when an index
  // annotation layer is in use.
  const idxOverlayActive = indexAnnotations != null && indexPaneSymbol
    && (indexAnnotationsEditable || indexAnnotations.length > 0)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !idxOverlayActive) { setIndexOverlayBounds(null); return }
    let raf = null
    const paneOf = () => indexPaneSeriesRef.current?.getPane?.()?.getHTMLElement?.()
    const measure = () => {
      try {
        const paneEl = paneOf()
        if (!paneEl) return
        const c = container.getBoundingClientRect()
        const p = paneEl.getBoundingClientRect()
        const top = Math.max(0, p.top - c.top)
        const height = p.height
        if (!height) return
        setIndexOverlayBounds(prev =>
          (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - height) < 0.5)
            ? prev : { top, height })
      } catch { /* pane not ready */ }
    }
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    const paneEl = paneOf()
    if (paneEl) ro.observe(paneEl)
    const t1 = setTimeout(measure, 60)
    const t2 = setTimeout(measure, 300)
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); if (raf) cancelAnimationFrame(raf) }
  }, [idxOverlayActive, indexPaneSeries.length > 0, indexPaneHeightPct, volumePaneHeightPct, showVolume, chartReady])

  // ── Multi-symbol comparison overlays — cleanup on unmount ──
  useEffect(() => {
    return () => {
      const chart = chartRef.current
      const map = comparisonSeriesRefs.current
      if (chart) {
        for (const series of map.values()) {
          try { chart.removeSeries(series) } catch {}
        }
      }
      map.clear()
    }
  }, [])

  // ── Multi-symbol comparison overlays — live tick subscription ──
  // For each enabled comparison sym, subscribe to its realtimeCandle stream and
  // compute fresh % change vs the base close (first valid bar in the fetched series).
  useEffect(() => {
    if (!enabledComparisons.length || !comparisonsData) return
    const unsubs = []
    for (const c of enabledComparisons) {
      const symKey = String(c.sym).toUpperCase()
      const rawBars = comparisonsData[symKey] || []
      // Find first valid close (mirrors normalizeToPctChange base logic)
      let baseClose = null
      for (const b of rawBars) {
        if (b?.c != null && Number.isFinite(b.c)) { baseClose = b.c; break }
      }
      if (!baseClose) continue
      const unsub = realtimeCandle.subscribe(symKey, () => {
        const candle = realtimeCandle.getCandle(symKey, '1')
        if (!candle || !Number.isFinite(candle.c)) return
        const series = comparisonSeriesRefs.current.get(symKey)
        if (!series) return
        const pct = ((candle.c - baseClose) / baseClose) * 100
        try {
          series.update({ time: adjustTime(candle.t), value: pct })
        } catch {}
      })
      unsubs.push(unsub)
    }
    return () => { for (const u of unsubs) { try { u() } catch {} } }
  }, [enabledComparisons, comparisonsData, adjustTime])

  // Mirror rapidly-changing values into refs so processCrosshair reads them
  // without forcing the subscription useEffect below to re-run on every change.
  useEffect(() => {
    overlayDataRef.current = overlayData
    comparisonDataRef.current = comparisonData
    livePricesRef.current = livePrices
    resolvedOverlaysRef.current = resolvedOverlays
    symRef.current = sym
    resolvedTfRef.current = resolvedTf
    onCrosshairMoveRef.current = onCrosshairMove
    volMaDataRef.current = volMaData
    // ⛔ `csIndicatorsRef.current = cs.indicators` stood here — the LEGACY chip
    // lane's inputs. That lane has no producer after B5 Task 6, and the engine
    // lane resolves inputs per INSTANCE inside `engineChips`.
  })

  // ── Crosshair legend: subscribe to hover events ──
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove previous subscriber
    if (crosshairSubRef.current) {
      try { chart.unsubscribeCrosshairMove(crosshairSubRef.current) } catch {}
    }

    // Lightweight Charts can fire crosshair-move at 1000Hz on fast mouse
    // polling. Doing a React setState per event blocks the canvas paint loop
    // and the crosshair visibly lags behind the cursor. Coalesce via rAF so
    // we update at most once per animation frame (~60Hz). Read data from refs
    // so the subscription survives live ticks without tearing down.
    const processCrosshair = (param) => {
      const overlayData = overlayDataRef.current
      const comparisonData = comparisonDataRef.current
      const livePrices = livePricesRef.current
      const resolvedOverlays = resolvedOverlaysRef.current
      const sym = symRef.current
      const onCrosshairMove = onCrosshairMoveRef.current

      const priceData = candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : null
      if (!priceData) { legendHoveringRef.current = false; setCrosshairData(alwaysShowLegend ? computeLatestCrosshair() : null); return }

      // ── Multi-chart sync: broadcast FIRST, before the legend math ──
      // Everything below this point computes ~20 legend values and ends in a
      // setCrosshairData React render. Emitting after all that put the linked
      // charts a full render behind the cursor; emitting here hands them the
      // frame immediately (their apply is imperative — no render at all).
      // `!applyingExternalRef.current` stops the ECHO: setCrosshairPosition fires
      // this same handler with an event indistinguishable from a real hover, so a
      // receiver re-broadcast what it was just told. Two widgets made that a
      // ping-pong (harmless only because the origin's pointerOverRef swallowed the
      // return trip); at three or more it's an N² fan-out of full crosshair passes
      // on every mouse move. Only a genuine local hover broadcasts.
      if (!applyingExternalRef.current && typeof onCrosshairMove === 'function' && param.time) {
        // The CURSOR's price level, not the bar's close: linked charts must put
        // their horizontal line on the same dollar value (hover $1300 on the
        // daily → $1300 on the 30m), which a bar-close snap could never do.
        let cursorPrice = null
        try {
          if (candleSeriesRef.current && param.point) {
            cursorPrice = candleSeriesRef.current.coordinateToPrice(param.point.y)
          }
        } catch { /* older LWC / series mid-swap */ }
        onCrosshairMove({
          time: param.time,
          // Normalized so a receiver on ANY timeframe can map it (see etDayOf).
          day: etDayOf(param.time),
          t: typeof param.time === 'number' ? param.time : null,
          cursorPrice: Number.isFinite(cursorPrice) ? cursorPrice : null,
          price: priceData,
        })
      }

      const volSeriesData = volumeSeriesRef.current ? param.seriesData.get(volumeSeriesRef.current) : null
      // If volume is 0 or missing (developing bar), use session volume from live data
      let vol = volSeriesData?.value
      if ((!vol || vol === 0) && livePrices[sym]?.volume) {
        vol = livePrices[sym].volume
      }

      // Get overlay values (SMA/EMA) — if missing for current bar, use last available
      const ovValues = overlaySeriesRefs.current.map((s, i) => {
        let d = param.seriesData.get(s)
        if (!d && overlayData[i]?.data?.length) {
          // Developing bar has no MA point — use the last computed value
          const lastOv = overlayData[i].data[overlayData[i].data.length - 1]
          d = lastOv ? { value: lastOv.value } : null
        }
        const ov = resolvedOverlays?.[i]
        // Disabled overlays (and any without a finite value) must be dropped, not
        // rendered blank — the vertical legend is a CSS grid, so an empty entry
        // leaves a dead row where the MA used to be instead of collapsing.
        if (!d || !ov || ov.enabled === false || !Number.isFinite(Number(d.value))) return null
        // Match the DISPLAYED line color (ema9CandleColorFor: candle-up repaint only
        // while the 9-EMA wears its stock default; a user-picked color wins).
        const color = ema9CandleColorFor(ov) ?? ov.color
        return { label: `${ov.type} ${ov.period}`, value: d.value, color, _period: Number(ov.period) }
      }).filter(Boolean).sort((a, b) => a._period - b._period)   // legend always in ascending-period order (SMA 5 before EMA 9, etc.)

      // For OHLC types (candles/bars/hollow)
      const o = priceData.open ?? priceData.value
      const h = priceData.high ?? priceData.value
      const l = priceData.low ?? priceData.value
      const c = priceData.close ?? priceData.value
      // Change is vs the PREVIOUS bar's close (true daily/period % move), not
      // this bar's open. Pull the prior bar straight from the rendered series.
      let prevClose = null
      if (param.logical != null && candleSeriesRef.current) {
        try {
          const pb = candleSeriesRef.current.dataByIndex(param.logical - 1)
          if (pb) prevClose = pb.close ?? pb.value ?? null
        } catch { /* first bar / out of range */ }
      }
      const change = (prevClose != null) ? (c - prevClose) : (c - o)
      const changePct = (prevClose != null && prevClose) ? ((change / prevClose) * 100) : (o ? ((change / o) * 100) : 0)

      // ── THE INDICATOR CHIPS — ONE PIPELINE, ONE LANE (B5 Task 6) ──────────
      //
      // ⛔ THE PIXEL GATE CANNOT SEE ANY OF THIS, AND THAT IS THE WHOLE REASON
      // IT IS SHAPED THIS WAY. A headless capture has no cursor, so no chip is
      // drawn on either side and the diff is 0 whether this is right or wrong.
      // The gate is `engine/__tests__/legendFromDefinitions.test.jsx`.
      //
      // What used to be here: nine hand-written `<indicator>Ref.current` reads
      // producing nine numeric `crosshairData` fields, plus a `LEGACY_SLOTS`
      // bridge that let an engine-drawn chip land in the field its legacy twin
      // occupied. All of it is gone. `engineChips` hands `chipsFrom` a list of
      // `{defId, plotKey, series, lastValue}` entries and gets formatted chips
      // back — label, colour and precision from `plots[].legend` +
      // `meta.legendParams` + the INSTANCE's inputs.
      //
      // ⭐ AND THE SECOND LANE IS GONE. B4 Task 10 built a LEGACY lane because
      // six of the nine shipped chips belonged to definitions that were NOT
      // migrated and had no bindings, so rendering `engineChips()` alone would
      // have deleted those six for every user, invisibly. Task 5 moved three
      // (`stoch::k`, `stoch::d`, `atr::atr`) and Task 6 moved the last three
      // (`sar::sar`, `ichimoku::tenkan`, `ichimoku::kijun`), so all nine now come
      // from the bindings — a change of SOURCE that no assertion on the rendered
      // TEXT could see, which is why `legendFromDefinitions.test.jsx` records the
      // two call sites through a pass-through mock and asserts the lists with
      // `toEqual` (a chip drawn twice is invisible in text, and
      // `arrayContaining` was measured to let it through).
      //
      // Wrapped, because this runs on the rAF flush: a disposed binder throwing
      // here would take the whole legend down mid-hover.
      //
      // ⭐ AND IT IS `legendChips`, NOT `engineChips` (chart-UX-walls Task 3), so
      // the hovering legend and the OFF-CURSOR legend produce the same rows. The
      // difference is the hidden instance: `planBindings` drops it, so walking
      // the bindings printed nothing for it and the only way back from "Hide"
      // was the settings modal.
      let chips = EMPTY_CHIPS
      try {
        const engine = engineRef.current
          ? legendChips(engineRef.current.binder.bindings(), param.seriesData,
              engineRegistry, engineInstancesRef.current)
          : EMPTY_CHIPS
        if (engine.length) chips = engine
      } catch { /* disposed mid-hover */ }

      let compareValue = null
      if (compareSeriesRef.current) {
        const dc = param.seriesData.get(compareSeriesRef.current)
        compareValue = dc?.value ?? (comparisonData.at(-1)?.value ?? null)
      }

      let volAvg = null
      if (volMaSeriesRef.current) {
        const dm = param.seriesData.get(volMaSeriesRef.current)
        const vma = volMaDataRef.current
        volAvg = dm?.value ?? ((vma && vma.length) ? vma[vma.length - 1].value : null)
      }

      // ONLY a real local hover latches this. setCrosshairPosition (multi-chart
      // sync) fires an identical-looking event, and latching on that made the
      // synced chart think it was being hovered — after which its own
      // "don't override the local user" guard blocked every further sync update
      // and its crosshair froze one frame in. (applyingExternalRef can't cover
      // this: it's cleared on rAF, a frame before this flush runs.) The legend
      // still fills in below either way, so a synced chart shows the values.
      if (pointerOverRef.current) legendHoveringRef.current = true
      setCrosshairData({
        time: param.time,
        open: o, high: h, low: l, close: c,
        volume: vol,
        change: change.toFixed(2),
        changePct: changePct.toFixed(2),
        dollarVol: (Number.isFinite(vol) && Number.isFinite(c)) ? vol * c : null,
        volAvg,
        volMaPeriod: volMaPeriodEff || null,
        overlays: ovValues,
        compare: compareValue,
        // THE INDICATOR CHIPS, ALREADY FORMATTED. The legend renders these
        // directly — it does not know an indicator's name, colour or precision,
        // and there is nothing in it for a new indicator to be edited into.
        // ⚠️ `compare` above is NOT one of these on purpose: the comparison chip
        // is a SYMBOL overlay, not an indicator, has no definition, and prints a
        // signed percentage in a format no `plots[].legend` can express.
        chips,
      })

      // (The multi-chart sync broadcast moved to the TOP of this function —
      // linked charts must not wait on the legend math above.)
    }

    const flush = () => {
      crosshairRafRef.current = null
      const param = crosshairParamRef.current
      crosshairParamRef.current = null
      if (!param) return
      processCrosshair(param)
    }

    const handler = (param) => {
      // Empty-state events bypass the rAF queue so the legend clears immediately
      if (!param.point || !param.time) {
        if (crosshairRafRef.current != null) { cancelAnimationFrame(crosshairRafRef.current); crosshairRafRef.current = null }
        crosshairParamRef.current = null
        legendHoveringRef.current = false
        setCrosshairData(alwaysShowLegend ? computeLatestCrosshair() : null)
        // Tell the sync bus the local user left the chart — but not when this
        // empty event was self-induced by applying an external crosshair.
        if (!applyingExternalRef.current && typeof onCrosshairMoveRef.current === 'function') {
          onCrosshairMoveRef.current(null)
        }
        return
      }
      crosshairParamRef.current = param
      if (crosshairRafRef.current == null) {
        crosshairRafRef.current = requestAnimationFrame(flush)
      }
    }

    chart.subscribeCrosshairMove(handler)
    crosshairSubRef.current = handler

    return () => {
      try { chart.unsubscribeCrosshairMove(handler) } catch {}
      if (crosshairRafRef.current != null) {
        cancelAnimationFrame(crosshairRafRef.current)
        crosshairRafRef.current = null
      }
      crosshairParamRef.current = null
    }
  }, [chartReady])

  // Keep the off-chart legend fresh with the latest bar when the cursor isn't hovering.
  useEffect(() => {
    if (!alwaysShowLegend || !chartReady) return
    if (legendHoveringRef.current || externalCrosshairAppliedRef.current) return
    setCrosshairData(computeLatestCrosshair())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysShowLegend, chartReady, ohlcData, overlayData])

  // Live legend ticking. Two pieces, deliberately split so the legend tracks the
  // fast Massive feed (like the theme tracker) WITHOUT re-rendering the whole
  // chart per tick (that storm froze the UI — do NOT reintroduce it):
  //   1. A direct bars-WS subscription writes the newest tick to liveTickRef —
  //      a REF, so ticks cause NO re-render.
  //   2. A BOUNDED ~4/sec timer re-renders just the legend from that ref.
  useEffect(() => {
    if (!liveUpdates || !sym) return undefined
    const unsub = barsStreamManager.subscribe(sym, '1', {
      onBar: (data) => {
        const c = data?.bar?.c ?? data?.trade?.p
        if (!Number.isFinite(c)) return
        liveTickRef.current = { price: c, ts: Date.now() }
        // ── Writer E of the single-writer invariant (index @ barsPushActiveRef decl):
        // fast developing candle for D/W/M ──
        // The Massive PUSH feed (writer B) streams intraday rollups only, so on
        // D/W/M the developing candle otherwise crawls on the slow Finnhub feed.
        // Paint it imperatively here from the fast 1-min tick so the candle + the
        // right-edge price label tick as fast as the legend/theme tracker — NO
        // React re-render (same series.update() path). Guards mirror the other
        // writers: daily+ only, never fight writer B (intraday), skip HA.
        const tf = resolvedTfRef.current
        const isDailyPlus = tf === 'D' || tf === 'W' || tf === 'M'
        if (!isDailyPlus || cs.heikinAshi || barsPushActiveRef.current) return
        // Session-preview owns the D/W/M bar (Include-mode preview candle or the
        // Regular-mode frozen-at-4pm candle) — don't let this fast tick fight it.
        if (sessionOwnsDailyRef.current) return
        // Regular Hours: never fold a pre/post-market tick into the RTH daily
        // candle — even in the up-to-60s window before useMarketOpen flips (which
        // sessionOwnsDailyRef keys off). This tick is live, so wall-clock ET is an
        // accurate, lag-independent session check. (Writer E was the path still
        // seaming post-market onto the daily candle after Writers A/D were gated.)
        if (sessionViewRef.current === 'regular') {
          const _m = etMinutes(Math.floor(Date.now() / 1000))
          if (_m < 570 || _m >= 960) return
        }
        const series = candleSeriesRef.current
        const last = lastBarRef.current
        if (!series || !last) return
        if (!isSaneLivePrice(c, last.close, lastServerCloseRef.current)) return
        const updated = {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, c),
          low: Math.min(last.low, c),
          close: c,
        }
        try {
          if (isOhlcType(cs.chartType)) series.update(updated)
          else series.update({ time: last.time, value: c })
        } catch { /* out of range mid-load */ }
        lastBarRef.current = { ...updated, volume: last.volume }
      },
    })
    return () => { try { unsub() } catch { /* already gone */ } liveTickRef.current = null }
  }, [liveUpdates, sym, cs.heikinAshi, cs.chartType])

  useEffect(() => {
    if (!alwaysShowLegend || !chartReady) return undefined
    const id = setInterval(() => {
      // Hover — or a synced crosshair — owns the legend; don't fight it.
      if (legendHoveringRef.current || externalCrosshairAppliedRef.current) return
      // crosshairData lives on StockChart, so setting it re-renders this whole
      // (heavy) component. The old code set a FRESH object every 250ms
      // unconditionally → ~4 full re-renders/sec per chart, forever. With several
      // chart widgets open that constant churn janked the live-quote feed
      // (freezes) and destabilized the chart's redraw/resize (jitter). Only set
      // state when the displayed legend actually changed, at a calmer cadence.
      setCrosshairData(prev => {
        const next = computeLatestCrosshair()
        try { if (JSON.stringify(prev) === JSON.stringify(next)) return prev } catch { /* fall through */ }
        return next
      })
    }, 500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysShowLegend, chartReady, sym])

  // Publish the chart's EXACT displayed price + volume so the watchlist row for
  // this symbol can mirror it (real-time, to-the-share) instead of drifting on
  // its own polling feed. computeLatestCrosshair() is the same value the legend /
  // "Pre" tag / volume pane show; it's safe to call from an effect.
  //
  // Gated hard so we never poison the store with a value the watchlist can't
  // mean: only LIVE charts (not Model Book / replay historical) and only on the
  // DAILY timeframe, where the developing bar's volume IS today's session total
  // and its close IS the current price — matching the watchlist's daily columns.
  // Weekly/monthly bars carry a multi-day volume; intraday bars carry a single
  // bar's volume — neither is "today's volume", so those TFs don't publish.
  useEffect(() => {
    if (!chartReady || !liveUpdates) return undefined
    const id = setInterval(() => {
      if (replayMode || replayCutoffRef.current || resolvedTfRef.current !== 'D') return
      const r = computeLatestCrosshair()
      if (!r || !Number.isFinite(r.close)) return
      // ONLY publish today's live developing bar. A regular-hours daily chart (or
      // the brief moment a freshly-clicked ticker shows its last bar before the
      // pre-market developing bar loads) has a FROZEN prior-session bar as its
      // last bar — publishing it reverted the watchlist row to Friday's
      // close/volume. Compare ET day-indices (adjustTime is the chart's own
      // display shift; r.time is Unix seconds).
      if (typeof r.time !== 'number') return
      const barDay = Math.floor(adjustTime(r.time) / 86400)
      const nowDay = Math.floor(adjustTime(Math.floor(Date.now() / 1000)) / 86400)
      if (barDay !== nowDay) return
      publishChartReadout(symRef.current, {
        price: r.close,
        volume: Number.isFinite(r.volume) ? r.volume : null,
        changePct: (r.changePct != null && r.changePct !== '') ? Number(r.changePct) : null,
      })
    }, 500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartReady, liveUpdates, sym])

  // ── Multi-chart sync: report visible time-range changes to parent (Task 5 Step 3) ──
  // No-op when onTimeRangeChange is absent. Uses Lightweight Charts'
  // subscribeVisibleTimeRangeChange so we report in time-space (not logical-space),
  // which means cells with differing bar counts can still align.
  useEffect(() => {
    if (!chartRef.current || typeof onTimeRangeChange !== 'function') return
    const ts = chartRef.current.timeScale()
    const handler = (range) => {
      // Bail while WE are applying an external range — otherwise setVisibleRange
      // below re-fires this handler and the bus oscillates across every chart.
      if (range && !applyingExternalRangeRef.current) {
        onTimeRangeChange({ from: range.from, to: range.to })
      }
    }
    try { ts.subscribeVisibleTimeRangeChange(handler) } catch { return }
    return () => {
      try { ts.unsubscribeVisibleTimeRangeChange(handler) } catch {}
    }
  }, [onTimeRangeChange])

  // ── Multi-chart sync: apply external time range from parent (Task 5 Step 4) ──
  // No-op when externalTimeRange is null. Wrapped in try/catch because
  // setVisibleRange will throw if the range falls outside the loaded data.
  useEffect(() => {
    if (!chartRef.current || !externalTimeRange) return
    if (!shouldApplyRange(externalTimeRange, lastAppliedRangeRef.current)) return
    applyingExternalRangeRef.current = true
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: externalTimeRange.from,
        to: externalTimeRange.to,
      })
      lastAppliedRangeRef.current = { from: externalTimeRange.from, to: externalTimeRange.to }
    } catch {}
    // Clear on the next frame — mirrors the crosshair applier's rAF release, so
    // the subscribeVisibleTimeRangeChange fired by setVisibleRange is swallowed.
    const raf = requestAnimationFrame(() => { applyingExternalRangeRef.current = false })
    return () => { cancelAnimationFrame(raf); applyingExternalRangeRef.current = false }
  }, [externalTimeRange])

  // -- Multi-chart sync: render an external crosshair on THIS chart ----------
  // Uses Lightweight Charts v5's setCrosshairPosition / clearCrosshairPosition.
  // Wrapped in try/catch so charts on older LWC silently skip rather than crash.
  //
  // WARNING: setCrosshairPosition DOES fire the subscribed crosshair handler,
  // with an event that looks exactly like a real hover (an older comment here
  // claimed the opposite, and that assumption is what froze synced crosshairs).
  // Two guards stop the feedback: applyingExternalRef swallows the clear-echo,
  // and the hover latch keys off pointerOverRef (real pointer presence), not
  // the event.
  //
  // Applying is IMPERATIVE by design -- no setState, no re-render, no effect
  // scheduling -- so it can run straight off the sync bus at mouse-move rate.
  // Routing it through React state re-rendered this entire component on every
  // mouse move, which is what made a linked chart's crosshair step and skip
  // instead of glide.
  const applyExternalCrosshair = useCallback((payload) => {
    if (!chartRef.current || !candleSeriesRef.current) return
    // Never let the sync override the LOCAL user's crosshair while they're
    // actively hovering THIS chart -- it must follow their own mouse.
    if (pointerOverRef.current) return
    applyingExternalRef.current = true
    if (!payload?.time) {
      externalCrosshairAppliedRef.current = false
      try { chartRef.current.clearCrosshairPosition() } catch { /* older LWC */ }
    } else {
      try {
        // VERTICAL: map the incoming bar onto THIS chart's own series, across
        // timeframes (see crosshairSync.js). Hovering a 30m bar moves the daily
        // chart to that DAY's candle; hovering a daily candle moves the 30m
        // chart to that day. Same-timeframe still lands on the exact bar.
        const T = payload.time
        const day = payload.day ?? etDayOf(T)
        const tNum = Number.isFinite(payload.t)
          ? payload.t
          : (typeof T === 'number' ? T : null)
        // HORIZONTAL: the source cursor's own price level, verbatim, so both
        // charts read the SAME dollar value regardless of timeframe. (This used
        // to snap to the local bar's close, so the two lines never agreed.)
        // Older payloads without cursorPrice fall back to the bar data.
        const priceVal = Number.isFinite(payload.cursorPrice)
          ? payload.cursorPrice
          : (payload.price?.close ??
             payload.price?.value ??
             (typeof payload.price === 'number' ? payload.price : 0))
        const snapTime = snapSyncedBar(prevBarsRef.current, adjustTime, day, tNum)
        if (snapTime == null) {
          // That day isn't loaded here (e.g. the intraday window doesn't reach
          // back to the hovered daily bar) -- clear rather than park the
          // crosshair on an unrelated bar.
          externalCrosshairAppliedRef.current = false
          chartRef.current.clearCrosshairPosition()
        } else {
          externalCrosshairAppliedRef.current = true
          chartRef.current.setCrosshairPosition(priceVal, snapTime, candleSeriesRef.current)
        }
      } catch { externalCrosshairAppliedRef.current = false }
    }
    // Release the clear-echo suppressor on the next frame.
    if (applyingExternalRafRef.current != null) cancelAnimationFrame(applyingExternalRafRef.current)
    applyingExternalRafRef.current = requestAnimationFrame(() => {
      applyingExternalRafRef.current = null
      applyingExternalRef.current = false
    })
  }, [adjustTime])

  // Prop form -- parents that hold the crosshair in React state.
  useEffect(() => {
    applyExternalCrosshair(externalCrosshair)
  }, [externalCrosshair, applyExternalCrosshair])

  // Bus form -- subscribe straight to the parent's sync bus. PREFERRED: this is
  // the path that keeps linked crosshairs smooth (zero renders per move).
  useEffect(() => {
    if (typeof subscribeCrosshair !== 'function') return undefined
    const off = subscribeCrosshair(applyExternalCrosshair)
    return () => {
      try { off?.() } catch { /* parent tore the bus down first */ }
      // Sync switched off / bus swapped / symbol changed: drop any crosshair we
      // had applied, or it stays frozen on screen. The old state-based path got
      // this from the parent pushing null; an imperative subscription has to do
      // it itself.
      if (externalCrosshairAppliedRef.current) applyExternalCrosshair(null)
    }
  }, [subscribeCrosshair, applyExternalCrosshair, chartReady])
  //     `window`. The GlobalAddPositionProvider mounted at the app root
  //     catches it and shows the "+ Add to Portfolio" menu. Every StockChart
  //     across the dashboard gets the right-click-to-add flow for free,
  //     with zero Journal 2.0 coupling inside StockChart.
  //   • Pass `onBarContextMenu={() => {}}` to suppress both behaviors on a
  //     specific chart.
  //
  // Bar lookup strategy: track the hovered bar via the chart's crosshair
  // subscription. On contextmenu, read the ref. The data reported by
  // `param.seriesData.get(candleSeries)` IS the canonical bar as rendered
  // by LW Charts (time + OHLC), which means zero time-format guessing
  // across TFs — works uniformly on 1min through Monthly. Falls back to
  // coordinateToLogical if the cursor hasn't moved over a bar yet.
  const hoveredBarRef = useRef(null)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const sub = (param) => {
      const priceData = candleSeriesRef.current
        ? param?.seriesData?.get(candleSeriesRef.current)
        : null
      if (!priceData) {
        hoveredBarRef.current = null
        return
      }
      // priceData has { time, open, high, low, close } in LW Chart's own
      // format. Normalize `time` into a UTC-seconds number so the rest
      // of the pipeline (date rendering, prefill, etc.) can treat it
      // uniformly.
      let tUtcSec
      if (typeof priceData.time === 'number') {
        // Intraday: data was fed with +_ET_OFFSET; undo it.
        tUtcSec = priceData.time - _ET_OFFSET
      } else if (typeof priceData.time === 'string') {
        // "YYYY-MM-DD" — midnight UTC
        tUtcSec = Math.floor(new Date(priceData.time + 'T00:00:00Z').getTime() / 1000)
      } else if (priceData.time && typeof priceData.time === 'object') {
        // BusinessDay { year, month, day }
        const { year, month, day } = priceData.time
        tUtcSec = Math.floor(Date.UTC(year, month - 1, day) / 1000)
      } else {
        hoveredBarRef.current = null
        return
      }
      hoveredBarRef.current = {
        t: tUtcSec,
        o: priceData.open,
        h: priceData.high,
        l: priceData.low,
        c: priceData.close,
      }
    }
    chart.subscribeCrosshairMove(sub)
    return () => { try { chart.unsubscribeCrosshairMove(sub) } catch {} }
  }, [chartReady])

  // ── Drag-to-measure (Charts workspace, TC2000-style) ──────────────────────
  const dragMeasureCanvasRef = useRef(null)
  const dragMeasureStateRef = useRef(null)   // { startX, startY, startPrice, startLogical } while dragging
  const [measureReadout, setMeasureReadout] = useState(null)  // { x, y, pct, bars, span, flip } | null

  // The measure readout's gain/loss line wears the chart's OWN up/down candle
  // colors rather than a fixed green/red, so recoloring your candles recolors the
  // measurement with them. Same precedence chain as the session tags above
  // (bold/Model Book palettes win, else the user's cs.candles), which is what keeps
  // "the color of an up move" one answer across the whole chart.
  const measureColors = useMemo(() => ({
    up: boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor,
    down: boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor,
  }), [boldCandles, modelBookLook, mbUp, mbDown, cs.candles.upColor, cs.candles.downColor])

  // ── Ctrl+drag to draw a trendline (press A → drag → release B) ────────────
  const trendDragCanvasRef = useRef(null)
  const trendDragStateRef = useRef(null)   // { startX, startY, a: { time, price } } while dragging

  const periodSelectCanvasRef = useRef(null)
  const periodSelectStateRef = useRef(null)   // { startX, startLogical } while dragging a Custom-Period highlight
  const [periodDragging, setPeriodDragging] = useState(false)   // hide the hint banner once the drag starts

  // ── Go to date (Alt+G): a tiny date box that scrolls the chart to a session ──
  const [dateJumpOpen, setDateJumpOpen] = useState(false)
  const jumpToDate = useCallback((dateStr) => {
    const chart = chartRef.current
    const arr = drawBarsRef.current || []
    if (!chart || !arr.length || !dateStr) return
    const target = new Date(dateStr + 'T12:00:00').getTime() / 1000
    let bestIdx = 0, bestDiff = Infinity
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i].t
      const ts = typeof t === 'number' ? t : (new Date(String(t) + 'T12:00:00').getTime() / 1000)
      const diff = Math.abs(ts - target)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    }
    try { chart.timeScale().setVisibleLogicalRange({ from: bestIdx - 50, to: bestIdx + 50 }) } catch { /* out of range */ }
  }, [])

  // ── Hide all indicators (Alt+Shift+I) · add-to-watchlist (Alt+Q) · alert (Alt+N) ──
  const [indicatorsHidden, setIndicatorsHidden] = useState(false)
  // Mirrored into a ref during render (before any effect runs) so `updateChart`
  // — defined far above, and deliberately not re-created when this flips — can
  // tell the indicator engine whether its series should be visible. See the ref's
  // declaration for why this is not a dependency.
  indicatorsHiddenRef.current = indicatorsHidden
  const [addListOpen, setAddListOpen] = useState(false)
  const [addLists, setAddLists] = useState([])
  const cursorPriceRef = useRef(null)
  const [chartToast, setChartToast] = useState(null)
  const chartToastTimer = useRef(null)
  const showChartToast = useCallback((msg) => {
    setChartToast(msg)
    clearTimeout(chartToastTimer.current)
    chartToastTimer.current = setTimeout(() => setChartToast(null), 1900)
  }, [])

  const openAddList = useCallback(async () => {
    setAddListOpen(true)
    try {
      const r = await fetch('/api/watchlists')
      if (r.ok) { const d = await r.json(); setAddLists(Array.isArray(d) ? d : (d.watchlists || d.lists || [])) }
    } catch { /* offline / unauth */ }
  }, [])
  const addToList = useCallback(async (listId) => {
    setAddListOpen(false)
    try {
      const r = await fetch(`/api/watchlists/${listId}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, notes: '' }),
      })
      showChartToast(r.ok ? `${sym} added` : 'Could not add')
    } catch { showChartToast('Could not add') }
  }, [sym, showChartToast])
  const createAlertAtCursor = useCallback(async () => {
    const price = cursorPriceRef.current
    if (price == null || !Number.isFinite(price) || !sym) { showChartToast('Hover the chart, then press Alt+N'); return }
    const arr = drawBarsRef.current || []
    const last = arr.length ? arr[arr.length - 1]?.c : null
    const direction = (last != null && price < last) ? 'below' : 'above'
    try {
      const r = await fetch('/api/watchlist-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym, target_price: Number(price.toFixed(2)), direction }),
      })
      // Refresh every watchlist-alerts cache so the Alerts widget shows it instantly.
      if (r.ok) globalMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))
      showChartToast(r.ok ? `Alert ${direction} ${price.toFixed(2)}` : 'Alert failed')
    } catch { showChartToast('Alert failed') }
  }, [sym, showChartToast])
  altActionsRef.current = {
    toggleIndicatorsHidden: () => setIndicatorsHidden(h => !h),
    openAddList, createAlertAtCursor,
  }

  // Track the cursor's price level for the alert-at-cursor shortcut.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady) return undefined
    const onMove = (ev) => {
      const series = candleSeriesRef.current
      if (!series) return
      const r = el.getBoundingClientRect()
      try { cursorPriceRef.current = series.coordinateToPrice(ev.clientY - r.top) } catch { /* disposed */ }
    }
    el.addEventListener('mousemove', onMove)
    return () => el.removeEventListener('mousemove', onMove)
  }, [chartReady])

  // Apply hide/show to every indicator series. Re-runs when indicators are
  // recreated (settings/overlays/tf/symbol change) so the hidden state sticks.
  useEffect(() => {
    if (!chartReady) return
    const vis = !indicatorsHidden
    // ⭐⭐ THE HIDE-ALL REF ARRAY IS GONE (B5 Task 8), AND WITH IT THE FOURTH AND
    // LAST OF THE LEDGER ROWS THIS TASK RETIRES. It was `const set = (ref) => …`
    // over a hand-written list of every indicator series ref; it shrank at every
    // flip (B3 Task 10, B3 Task 11, B5 Tasks 5, 6, 7) and this task took its last
    // SEVEN entries — adx ×3, obv, donchian ×3. There is no indicator ref left to
    // list, so the array is not shorter, it is DELETED: every indicator series is
    // reached through the engine's binding map at the bottom of this effect,
    // which is why the declutter toggle keeps working for all fourteen without
    // anyone editing anything. The failure class the old NB described — a name in
    // that list that is not a declared ref is a ReferenceError at runtime and
    // nothing catches it at build time (it shipped once, 2026-07-22, and crashed
    // /charts on mount) — is now unreachable, because there is no list.
    //
    // ⚠️ VOLUME IS NOT AN INDICATOR AND DOES NOT RETIRE WITH THEM. It was the
    // FIRST entry in that array and it has no definition, no instance and no
    // binding, so deleting the array without this line would silently stop the
    // declutter toggle hiding the volume series — a behaviour change no pixel
    // case could see (the parity page draws no keystroke) and exactly the kind of
    // thing a `.forEach(set)` deletion takes with it by accident.
    try { volumeSeriesRef.current?.applyOptions?.({ visible: vis }) } catch { /* disposed */ }
    const setAll = (arr) => { if (Array.isArray(arr)) arr.forEach(s => { try { s?.applyOptions?.({ visible: vis }) } catch { /* disposed */ } }) }
    setAll(overlaySeriesRefs.current)
    setAll(overlayTailSeriesRefs.current)
    // Engine-owned series are ITERATED, never hand-listed — and as of B5 Task 8
    // that is the ONLY way an indicator is reached here. This is the first paint
    // after the hide-all array lost its last seven entries, so it is also the
    // proof that the binding map really does carry the toggle for all fourteen.
    if (engineRef.current) {
      try { setAll(engineRef.current.binder.bindings().map(b => b.series)) } catch { /* disposed */ }
    }
  }, [indicatorsHidden, chartReady, cs.indicators, resolvedOverlays, cs.volume, resolvedTf, sym,
    // The engine re-binds when its instance list changes; without this a newly-
    // bound series would keep the visibility of whatever came before it.
    // ⚠️ `cs.engineEnabled` was the second half of this dep and went with the flag
    // (B5 Task 4). It was a dep on a key `mergeChartSettings` no longer emits, so
    // it read `undefined` on every render and could never change — a dependency
    // that cannot fire is indistinguishable from one that is missing.
    cs.indicatorInstances])

  // Plain mouse-drag pans (default). The Shift+drag measure locks scrolling only for
  // the duration of the drag (in onDown/end below); frozen (Setup Library) stays
  // non-pannable. This effect just holds the default so a data-poll re-applyOptions
  // can't clobber it.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return
    if (measureLockRef.current) return   // don't clobber an in-progress measure lock
    try { chart.applyOptions({ handleScroll: frozen ? false : true }) } catch { /* not ready */ }
  }, [frozen, chartReady])

  // Press-drag A→B: dashed line on a transient canvas + a cursor-following
  // % / bars / time readout. Free cursor price (coordinateToPrice, unsnapped).
  // Everything clears on release. Move/up listen on window so a fast drag that
  // leaves the chart still tracks + always releases; no pointer-capture, so
  // LWC keeps updating its own crosshair underneath.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady || !dragMeasure) return
    if (activeTool && activeTool !== 'cursor') return

    const getPos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } }
    const clearLine = () => {
      const c = dragMeasureCanvasRef.current; if (!c) return
      const ctx = c.getContext('2d'); if (ctx) ctx.clearRect(0, 0, c.width, c.height)
    }
    const drawLine = (x1, y1, x2, y2, w, h) => {
      const c = dragMeasureCanvasRef.current; if (!c) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(w * dpr), H = Math.round(h * dpr)
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = w + 'px'; c.style.height = h + 'px' }
      const ctx = c.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // Match the chart crosshair's color so the drag line reads as part of the
      // same crosshair (falls back to the old theme default if the crosshair
      // color is unset/inherited from the LWC default).
      const _measC = themeColors.crosshairColor || (canvasTheme === 'sunrise' ? 'rgba(45,58,72,0.9)' : 'rgba(224,218,200,0.85)')
      ctx.strokeStyle = _measC; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.setLineDash([])
      // (No endpoint dots — just the bare dashed line, matching the crosshair.)
    }
    const onMove = (e) => {
      const st = dragMeasureStateRef.current; if (!st) return
      const series = candleSeriesRef.current, chart = chartRef.current
      if (!series || !chart) return
      const { x, y, w, h } = getPos(e)
      if (Math.abs(x - st.startX) < 3 && Math.abs(y - st.startY) < 3) { clearLine(); setMeasureReadout(null); return }
      const curPrice = series.coordinateToPrice(y)
      const curLogical = chart.timeScale().coordinateToLogical(x)
      if (curPrice == null || curLogical == null) return
      drawLine(st.startX, st.startY, x, y, w, h)
      const dollar = curPrice - st.startPrice
      const pct = st.startPrice ? dollar / st.startPrice * 100 : 0
      const barsN = Math.abs(Math.round(curLogical - st.startLogical))
      const arr = prevBarsRef.current || []
      const clamp = (i) => Math.max(0, Math.min(arr.length - 1, Math.round(i)))
      const b1 = arr[clamp(st.startLogical)], b2 = arr[clamp(curLogical)]
      const span = (b1 && b2) ? _formatMeasureSpan(b1.t, b2.t) : ''
      setMeasureReadout({ x, y, dollar, pct, bars: barsN, span, flip: x > w - 200 })
    }
    const end = () => {
      dragMeasureStateRef.current = null
      measureLockRef.current = false
      clearLine(); setMeasureReadout(null)
      // Restore pan + zoom after the Shift+drag measure.
      try { chartRef.current?.applyOptions({ handleScroll: frozen ? false : true, handleScale: !frozen }) } catch { /* noop */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    const onDown = (e) => {
      if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
      // Only measure while Shift is held — a plain drag pans the chart (LWC handles it).
      if (!e.shiftKey) return
      const series = candleSeriesRef.current, chart = chartRef.current
      if (!series || !chart) return
      const { x, y } = getPos(e)
      const startPrice = series.coordinateToPrice(y)
      const startLogical = chart.timeScale().coordinateToLogical(x)
      if (startPrice == null || startLogical == null) return
      // Lock the chart in place for the whole measure so it can't pan/zoom while
      // you drag A→B; end() restores it. measureLockRef also survives data-poll
      // re-applyOptions (see the creation handleScroll site).
      measureLockRef.current = true
      try { chart.applyOptions({ handleScroll: false, handleScale: false }) } catch { /* noop */ }
      dragMeasureStateRef.current = { startX: x, startY: y, startPrice, startLogical }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    el.addEventListener('pointerdown', onDown)
    return () => { el.removeEventListener('pointerdown', onDown); end() }
  }, [dragMeasure, chartReady, activeTool, frozen, canvasTheme, themeColors.crosshairColor])

  // ── Custom-Period Sort: drag to highlight a time period ───────────────────────
  // Plain left-drag while `periodSelect` is on paints a translucent gold band between
  // two vertical edges (TC2000-style) and, on release, reports the [start, end] calendar
  // dates (YYYYMMDD ints) so the workspace can rank the whole market over that span.
  // Locks pan/zoom for the drag; maps pixels→dates via the same coordinateToLogical →
  // drawBarsRef lookup the trendline/measure handlers use.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady || !periodSelect) return undefined

    const getPos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } }
    const ymdOf = (t) => {
      if (t == null) return null
      if (typeof t === 'number') {   // intraday: unix seconds → ET calendar day
        const s = new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        return parseInt(s.replace(/-/g, ''), 10)
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t))   // D/W/M: 'YYYY-MM-DD'
      return m ? parseInt(m[1] + m[2] + m[3], 10) : null
    }
    const barAtX = (x) => {
      const chart = chartRef.current; if (!chart) return null
      let logical = null; try { logical = chart.timeScale().coordinateToLogical(x) } catch { return null }
      if (logical == null) return null
      const arr = drawBarsRef.current || []
      if (!arr.length) return null
      const idx = Math.max(0, Math.min(arr.length - 1, Math.round(logical)))
      return arr[idx] || null
    }
    const clearBand = () => {
      const c = periodSelectCanvasRef.current; if (!c) return
      const ctx = c.getContext('2d'); if (ctx) ctx.clearRect(0, 0, c.width, c.height)
    }
    const drawBand = (x1, y1, x2, y2, w, h) => {
      const c = periodSelectCanvasRef.current; if (!c) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(w * dpr), H = Math.round(h * dpr)
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = w + 'px'; c.style.height = h + 'px' }
      const ctx = c.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const lo = Math.min(x1, x2), hi = Math.max(x1, x2)
      ctx.fillStyle = 'rgba(201,168,76,0.14)'
      ctx.fillRect(lo, 0, hi - lo, h)
      ctx.strokeStyle = 'rgba(201,168,76,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(lo + 0.5, 0); ctx.lineTo(lo + 0.5, h); ctx.moveTo(hi - 0.5, 0); ctx.lineTo(hi - 0.5, h); ctx.stroke()
      // Diagonal measure line from the press point to the cursor (same dashed look as the
      // Shift+drag measure tool) so you see the exact move you're highlighting.
      if (y1 != null && y2 != null) {
        const _measC = themeColors.crosshairColor || (canvasTheme === 'sunrise' ? 'rgba(45,58,72,0.9)' : 'rgba(224,218,200,0.85)')
        ctx.strokeStyle = _measC; ctx.setLineDash([5, 4])
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      }
      ctx.setLineDash([])
    }
    const onMove = (e) => {
      const st = periodSelectStateRef.current; if (!st) return
      const { x, y, w, h } = getPos(e)
      drawBand(st.startX, st.startY, Math.max(0, Math.min(w, x)), y, w, h)
      // Reuse the measure readout: show % move + bars/days as you highlight.
      const series = candleSeriesRef.current, chart = chartRef.current
      if (series && chart && st.startPrice != null) {
        const curPrice = series.coordinateToPrice(y)
        const curLogical = chart.timeScale().coordinateToLogical(x)
        if (curPrice != null && curLogical != null) {
          const dollar = curPrice - st.startPrice
          const pct = st.startPrice ? (dollar / st.startPrice) * 100 : 0
          const barsN = Math.abs(Math.round(curLogical - st.startLogical))
          const arr = prevBarsRef.current || []
          const clamp = (i) => Math.max(0, Math.min(arr.length - 1, Math.round(i)))
          const b1 = arr[clamp(st.startLogical)], b2 = arr[clamp(curLogical)]
          const span = (b1 && b2) ? _formatMeasureSpan(b1.t, b2.t) : ''
          setMeasureReadout({ x, y, dollar, pct, bars: barsN, span, flip: x > w - 200 })
        }
      }
    }
    const end = (e) => {
      const st = periodSelectStateRef.current
      periodSelectStateRef.current = null
      try { chartRef.current?.applyOptions({ handleScroll: frozen ? false : true, handleScale: !frozen }) } catch { /* noop */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      clearBand(); setMeasureReadout(null); setPeriodDragging(false)
      if (!st) return
      const { x: ex } = getPos(e)
      if (Math.abs(ex - st.startX) < 4) return   // a click, not a drag
      const bA = barAtX(st.startX), bB = barAtX(ex)
      const a = ymdOf(bA?.t), b = ymdOf(bB?.t)
      if (a == null || b == null || a === b) return
      // earlier date first; % change is this chart symbol's own close-to-close move.
      const [lo, hi, cLo, cHi] = a <= b ? [a, b, bA?.c, bB?.c] : [b, a, bB?.c, bA?.c]
      const pct = (cLo > 0 && cHi > 0) ? ((cHi - cLo) / cLo) * 100 : null
      onPeriodSelected?.(lo, hi, pct)
    }
    const onDown = (e) => {
      if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
      const chart = chartRef.current; if (!chart) return
      const { x, y } = getPos(e)
      let startLogical = null; try { startLogical = chart.timeScale().coordinateToLogical(x) } catch { return }
      if (startLogical == null) return
      let startPrice = null; try { startPrice = candleSeriesRef.current?.coordinateToPrice(y) } catch { /* noop */ }
      e.preventDefault()
      try { chart.applyOptions({ handleScroll: false, handleScale: false }) } catch { /* noop */ }
      periodSelectStateRef.current = { startX: x, startY: y, startLogical, startPrice }
      setPeriodDragging(true)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      clearBand(); setPeriodDragging(false)
    }
  }, [periodSelect, chartReady, frozen, onPeriodSelected, canvasTheme, themeColors.crosshairColor])

  // ── Ctrl+drag to draw a trendline ─────────────────────────────────────────
  // Mirrors the Shift+drag measure: listens on the chart container so it works
  // over empty chart space (the drawing overlay is pointer-events:none there),
  // locks pan/zoom for the drag, shows a solid preview line, and commits ONE
  // trendline drawing on release (clean single undo/redo — no create-then-reshape
  // degenerate-redo). Available wherever drawing is enabled (showDrawingTools).
  // Coordinate mapping matches ChartDrawingOverlay.toChart exactly (same chart
  // timeScale + the overlay's own `bars` via drawBarsRef) so the point.time
  // always resolves in the overlay's timeToIndex.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady || !showDrawingTools) return undefined
    if (activeTool && activeTool !== 'cursor') return undefined   // an armed tool owns clicks

    const getPos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } }
    const ptAt = (x, y) => {
      const series = candleSeriesRef.current, chart = chartRef.current
      if (!series || !chart) return null
      let price = null; try { price = series.coordinateToPrice(y) } catch { /* disposed */ }
      let logical = null; try { logical = chart.timeScale().coordinateToLogical(x) } catch { /* disposed */ }
      if (price == null || logical == null) return null
      const arr = drawBarsRef.current || []
      if (!arr.length) return null
      // Allow the endpoint to extend PAST the last candle, matching the overlay's
      // toChart→fromLogical: a logical index beyond the last bar is stored as the
      // last bar's time + a whole-bar `futureBars` offset (capped), so the point
      // maps into the empty right-pad instead of clamping to the last candle.
      const rounded = Math.round(logical)
      const lastIdx = arr.length - 1
      if (rounded > lastIdx) {
        const t = arr[lastIdx]?.t
        return t == null ? null : { time: t, price, futureBars: Math.min(500, rounded - lastIdx) }
      }
      const idx = Math.max(0, rounded)
      const t = arr[idx]?.t
      return t == null ? null : { time: t, price }
    }
    const clearPreview = () => {
      const c = trendDragCanvasRef.current; if (!c) return
      const ctx = c.getContext('2d'); if (ctx) ctx.clearRect(0, 0, c.width, c.height)
    }
    const drawPreview = (x1, y1, x2, y2, w, h) => {
      const c = trendDragCanvasRef.current; if (!c) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(w * dpr), H = Math.round(h * dpr)
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = w + 'px'; c.style.height = h + 'px' }
      const ctx = c.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const col = canvasTheme === 'sunrise' ? '#000000' : (cs.drawingDefaults?.color || '#c9a84c')
      ctx.strokeStyle = col; ctx.lineWidth = cs.drawingDefaults?.width || 1
      // Match the toolbar Trendline tool exactly: a clean line, NO endpoint dots,
      // honoring the saved dash style.
      if (cs.drawingDefaults?.style === 'dashed') ctx.setLineDash([6, 4]); else ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    }
    // Coalesce high-frequency pointermove into ONE render per animation frame so the
    // preview tracks the cursor smoothly — no per-event synchronous redraw jank on a
    // live-updating chart (the "snaps around" stutter).
    let previewRaf = null
    let lastPos = null
    const renderPreview = () => {
      previewRaf = null
      const st = trendDragStateRef.current
      if (!st || !lastPos) return
      drawPreview(st.startX, st.startY, lastPos.x, lastPos.y, lastPos.w, lastPos.h)
    }
    const onMove = (e) => {
      if (!trendDragStateRef.current) return
      lastPos = getPos(e)
      if (previewRaf == null) previewRaf = requestAnimationFrame(renderPreview)
    }
    const end = (e) => {
      const st = trendDragStateRef.current
      trendDragStateRef.current = null
      if (previewRaf != null) { cancelAnimationFrame(previewRaf); previewRaf = null }
      clearPreview()
      measureLockRef.current = false
      try { chartRef.current?.applyOptions({ handleScroll: frozen ? false : true, handleScale: !frozen }) } catch { /* noop */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (!st) return
      // Commit only on a real pointer-UP that actually dragged — a pointercancel
      // (browser interrupt) or a stray Ctrl+click that never moved makes no line.
      if (!e || e.type !== 'pointerup') return
      const p = getPos(e)
      if (Math.abs(p.x - st.startX) < 4 && Math.abs(p.y - st.startY) < 4) return
      const b = ptAt(p.x, p.y); if (!b) return
      const col = canvasTheme === 'sunrise' ? '#000000' : (cs.drawingDefaults?.color || '#c9a84c')
      addDrawingRef.current?.({
        type: 'trendline',
        points: [st.a, b],
        color: col,
        lineWidth: cs.drawingDefaults?.width || 1,
        lineStyle: cs.drawingDefaults?.style || 'solid',
      })
    }
    const onDown = (e) => {
      if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
      // Ctrl ONLY — Shift is the measure, Alt is the overlay's clone-drag.
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
      const { x, y } = getPos(e)
      const a = ptAt(x, y); if (!a) return
      e.preventDefault()
      // Lock pan/zoom for the whole drag; measureLockRef is also read by the
      // data-poll re-applyOptions so a poll can't unlock mid-draw.
      measureLockRef.current = true
      try { chartRef.current?.applyOptions({ handleScroll: false, handleScale: false }) } catch { /* noop */ }
      trendDragStateRef.current = { startX: x, startY: y, a }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    el.addEventListener('pointerdown', onDown)
    return () => { el.removeEventListener('pointerdown', onDown); end() }
    // addDrawing is read via addDrawingRef (stable) so a mid-drag re-render can't
    // tear this down; cs.drawingDefaults is memoized so it won't churn on ticks.
  }, [chartReady, showDrawingTools, activeTool, frozen, canvasTheme, cs.drawingDefaults])

  // ── Track deliberate user view interaction ────────────────────────────────
  // LWC exposes no "the user panned" event (its range-change subscription fires
  // for programmatic moves too, which is exactly what we must NOT count). So
  // watch the input instead: a press that travels, or a wheel over the chart.
  // Capture phase + window-level move/up so a drag that leaves the container
  // still registers. Cheap: three refs, no state, no re-render.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const onDown = (e) => {
      lastPointerDownAtRef.current = Date.now()
      viewPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    // Capture the CURRENT (settled) view as right-relative params for the replay lock.
    // rAF so we read AFTER lightweight-charts applies the pan/zoom, on THIS ticker's bars.
    const _captureReplayLock = () => {
      if (!replayCutoffRef.current) return
      replayViewLockedRef.current = true
      requestAnimationFrame(() => {
        try {
          const r = chartRef.current?.timeScale().getVisibleLogicalRange()
          const n = lastBarCountRef.current || 0
          if (r && n > 0 && (r.to - r.from) > 0) {
            replayLockedViewRef.current = { barsFromRight: n - r.to, width: r.to - r.from }
          }
        } catch { /* mid-load */ }
      })
    }
    const onMove = (e) => {
      const p = viewPointerRef.current
      if (!p) return
      if (Math.abs(e.clientX - p.x) > 4 || Math.abs(e.clientY - p.y) > 4) {
        userViewMovedRef.current = true
        if (replayCutoffRef.current) replayViewLockedRef.current = true   // lock this view for the whole sort
      }
    }
    const onUp = () => {
      if (viewPointerRef.current && replayCutoffRef.current && replayViewLockedRef.current) _captureReplayLock()
      viewPointerRef.current = null
    }
    const onWheel = () => {
      userViewMovedRef.current = true
      _captureReplayLock()
    }
    // Real pointer presence — see pointerOverRef. mouseenter/leave don't bubble,
    // so they fire exactly for THIS container.
    const onEnter = () => {
      pointerOverRef.current = true
      // The local user takes the crosshair back; any synced one is superseded.
      externalCrosshairAppliedRef.current = false
    }
    const onLeave = () => { pointerOverRef.current = false }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('wheel', onWheel, { passive: true, capture: true })
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('wheel', onWheel, true)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [])

  // ── Keep (and where possible persist) a user's volume-pane resize ─────────
  // LWC has no separator-drag event, so poll the actual volume-pane fraction; when
  // it diverges from what we last applied (the user dragged the separator), LATCH
  // it so the pane layout is computed from the drag, and fire onVolumePaneResize
  // so a caller that persists can feed it back as volumePaneHeightPct.
  //
  // ⛔ THIS NO LONGER REQUIRES `onVolumePaneResize`, AND THAT IS THE FLIP C FIX.
  // Exactly one surface passes that callback (ChartPane); the divider is
  // draggable on all of them, and under `'panes'` the binder re-asserts
  // `paneLayout.above` at the end of every sync — so on ChartWidget, the grid
  // cells, Model Book and the popover the drag was being undone about once a
  // second with nothing even watching for it. The latch is per-chart and costs no
  // backend; persistence is still opt-in and unchanged.
  useEffect(() => {
    if (!chartReady) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    const id = setInterval(() => {
      try {
        const mainPane = candleSeriesRef.current?.getPane?.()
        const volPane = volumeSeriesRef.current?.getPane?.()
        if (!mainPane || !volPane || mainPane === volPane) return
        const hMain = mainPane.getHeight(), hVol = volPane.getHeight()
        const total = hMain + hVol
        if (!(total > 0)) return
        const actual = Math.round((hVol / total) * 100)
        const applied = lastAppliedVolPctRef.current
        // ⚠️ ONLY a real separator DRAG may report a new height. The measured
        // fraction does not always equal the stretch factors we set — LWC clamps
        // panes to a minimum height, so on a short widget "apply 12 → measure 18"
        // is normal. Without the drag gate that mismatch fed itself: measure 18 →
        // persist 18 → prop feeds back → apply 18 → measure 24 → … and the volume
        // pane ratcheted up until it hit the 45% clamp. That's the "volume pane
        // randomly triples in size" bug, and because the pref is global it then
        // hit every widget. A pointer press within the last 1.5s is the only
        // thing that can move it; nothing else resizes the pane on its own.
        const dragging = Date.now() - lastPointerDownAtRef.current < 1500
        if (!dragging || applied == null) return
        // ⚠️ MOVEMENT is judged against what we last APPLIED (the height the pane
        // is at, exactly as before), while the latch RECORDS the setting it has to
        // out-rank — see latchOnDrag. A measurement failing the window is LWC's
        // minimum-height clamp on a short widget, not a user.
        const latch = latchOnDrag(volPctSettingRef.current, applied, actual)
        if (!latch) return
        // ⛔ AND `lastAppliedVolPctRef` MOVES WITH IT. The pane is ALREADY where
        // the user put it, so the writer in updateChart must not fire: leaving
        // the ref behind would make `lastApplied !== pct` true, re-apply the
        // just-latched height, let LWC's clamp move it again, and the next poll
        // would latch THAT — the "volume pane randomly triples in size" ratchet,
        // rebuilt. Equal refs mean the drag is recorded and nothing re-writes it.
        volDragLatchRef.current = latch
        lastAppliedVolPctRef.current = latch.pct
        // Persistence stays opt-in: only the workspace wants a global pref moved.
        onVolumePaneResize?.(latch.pct)
      } catch { /* not ready */ }
    }, 300)
    return () => clearInterval(id)
  }, [chartReady, onVolumePaneResize])

  // ── Time-scroll grip ──────────────────────────────────────────────────────
  // Because drag-pan is repurposed for measuring, this small grip (bottom-right,
  // at the time axis) lets the user drag left/right to scroll the chart through
  // time. Shown only with dragMeasure. Position tracks the price-axis width +
  // time-axis height so it sits just left of the axis, at the date row.
  const rangeBarRef = useRef(null)

  // Pin two volume-pane overlays to the LIVE price/volume pane boundary as the user
  // drags the separator: the date-range bar (3M/6M/YTD/…) just ABOVE the boundary,
  // and the volume legend ($ vol + avg vol) just BELOW it (top-left of the volume
  // pane). Positioning off the persisted paneHeightPct made them jump seconds late
  // (the setting only saves after the drag settles). A rAF sampler reads the actual
  // pane heights every frame and writes the offsets straight to the DOM (no React
  // re-render → no fight → smooth), so they slide with the divider in real time.
  const showVolLegend = showVolume && volInSeparatePane
  useEffect(() => {
    if ((!showRangeSelector && !showVolLegend) || !chartReady) return
    const chart = chartRef.current, container = containerRef.current
    if (!chart || !container) return
    // Track the last element too, not just the last value: on a symbol flip the
    // range-bar / legend divs remount (fresh DOM node with no inline position → it
    // falls back to the CSS default and lands INSIDE the volume pane). A value-only
    // guard would skip re-writing the new node because the computed value didn't
    // change; keying on the element as well re-pins it immediately after a remount.
    let raf = null, lastBottom = -1, lastTop = -1, lastRb = null, lastVl = null
    const tick = () => {
      try {
        const panes = chart.panes ? chart.panes() : null
        const h0 = (panes && panes[0] && panes[0].getHeight) ? panes[0].getHeight() : 0
        const H = container.clientHeight || 0
        if (h0 > 0 && H > 0) {
          const rb = rangeBarRef.current
          if (rb) {
            const bottom = Math.round(Math.max(30, H - h0 + 8)) // 8px above the boundary
            if (bottom !== lastBottom || rb !== lastRb) { lastBottom = bottom; lastRb = rb; rb.style.bottom = `${bottom}px` }
          }
          const vl = volLegendRef.current
          if (vl) {
            const top = Math.round(h0 + 5) // just below the boundary = volume pane top
            if (top !== lastTop || vl !== lastVl) { lastTop = top; lastVl = vl; vl.style.top = `${top}px` }
          }
        }
      } catch { /* pane API missing → CSS fallback */ }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [showRangeSelector, showVolLegend, chartReady])

  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    if (!el || !chart || !bars || bars.length === 0) return

    // Shared open-menu routine: invoked by desktop right-click (`contextmenu`)
    // and by touch long-press. Reads the anchor from `clientX`/`clientY` so it
    // works regardless of which input triggered it.
    const openMenuAt = (clientX, clientY, e) => {
      const rect = el.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top

      // Prefer the currently-hovered bar (from crosshair tracking). Falls
      // back to coordinateToLogical if crosshair hasn't fired yet (edge
      // case: user right-clicks immediately without moving the mouse).
      let closest = hoveredBarRef.current
      if (!closest) {
        let logical = null
        try { logical = chart.timeScale().coordinateToLogical(px) } catch { return }
        if (logical == null) return
        const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
        closest = bars[idx]
      }
      if (!closest) return

      // Only block the browser default menu once we know we have a bar.
      e?.preventDefault?.()

      // ── Resolve which region of the chart was clicked ──────────────────
      // Axis widths + pane heights come straight from the chart; the band map is
      // the RENDER PATH'S OWN (`paneLayoutRef`), not a second computation, so
      // the menu cannot be confidently right about a chart that is not on screen.
      const separateVolume = showVolume && (!!cs.volume.separatePane || (Array.isArray(cs.volumeOverlayIndicators) && cs.volumeOverlayIndicators.length > 0))
      let axisWidth = 0, timeAxisHeight = 0, pane0Height = rect.height
      try { axisWidth = (mainPriceScale()?.width?.()) ?? chart.priceScale('right').width() } catch {}
      try { timeAxisHeight = chart.timeScale().height() } catch {}
      try { pane0Height = (candleSeriesRef.current?.getPane?.()?.getHeight?.()) ?? chart.panes()[0]?.getHeight() ?? (rect.height - timeAxisHeight) } catch { pane0Height = rect.height - timeAxisHeight }
      const _layout = paneLayoutRef.current
      const paneMargins = (_layout && _layout.bands) || {}
      // ⭐ FLIP C: UNDER `'panes'` THE ANSWER COMES OFF THE RENDERER, NOT OFF A
      // SECOND COPY OF THE GEOMETRY. The bands resolver re-derives the layout from
      // `cs`, so it can be confidently right about a chart that is not on screen;
      // once oscillators own real panes there are rectangles to read, and reading
      // them is what makes the menu match what the user actually clicked. The
      // layout supplies each pane's KEY (the renderer does not know what an
      // indicator is) and the renderer supplies each pane's HEIGHT.
      let region
      if (paneMode() === 'panes' && _layout) {
        let livePanes = []
        try { livePanes = chart.panes() } catch { livePanes = [] }
        const keyAt = new Map(_layout.panes.map((p) => [p.index, p.key]))
        region = resolveChartRegionFromPanes({
          x: px, y: py, width: rect.width, height: rect.height,
          axisWidth, timeAxisHeight,
          panes: livePanes.map((p, i) => {
            let h = 0
            try { h = p.getHeight() } catch { h = 0 }
            return { key: keyAt.get(i) || null, height: h }
          }),
          pane0Bands: { volume: _layout.pane0.volumeMargins || undefined },
          separatorHeight: _layout.separatorPx,
        })
      } else {
        region = resolveChartRegion({
          x: px, y: py, width: rect.width, height: rect.height,
          axisWidth, timeAxisHeight, paneMargins, separateVolume, pane0Height,
        })
      }

      // Refine the open price area to a specific MA/overlay line when the
      // click lands within a few px of one. Only when overlays come from
      // chart settings (not a prop override on embedded charts).
      if (region.type === 'price' && overlaysProp === undefined) {
        let logical = null
        try { logical = chart.timeScale().coordinateToLogical(px) } catch {}
        if (logical != null) {
          const idx = Math.round(logical)
          let best = -1, bestDist = 7
          const series = overlaySeriesRefs.current || []
          for (let i = 0; i < series.length; i++) {
            let val = null, yc = null
            try { val = series[i].dataByIndex(idx)?.value } catch {}
            if (val == null) continue
            try { yc = series[i].priceToCoordinate(val) } catch {}
            if (yc == null) continue
            const dist = Math.abs(yc - py)
            if (dist < bestDist) { bestDist = dist; best = i }
          }
          if (best >= 0) region = { type: 'overlay', index: best }
        }
      }

      // Price under the cursor (for "draw line here" / "set alert here").
      // Only meaningful in price/axis regions where y maps to the price scale.
      let clickPrice = null
      if (region.type === 'price' || region.type === 'priceAxis') {
        try {
          const p = candleSeriesRef.current?.coordinateToPrice(py)
          if (Number.isFinite(p) && p > 0) clickPrice = p
        } catch {}
      }
      const currentPrice = Number.isFinite(lastPriceRef.current) ? lastPriceRef.current : (closest?.c ?? null)

      const sections = buildRegionSections(region, clickPrice)

      // Lazy chart screenshot: only invoked if the consumer actually needs
      // it (e.g. "Save to Notebook"). Lightweight Charts v5 exposes
      // takeScreenshot() → HTMLCanvasElement; we wrap it as a Promise<Blob>.
      const getScreenshotBlob = () => new Promise((resolve, reject) => {
        try {
          const c = chart.takeScreenshot()
          if (!c) return reject(new Error('no canvas'))
          c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png')
        } catch (err) {
          reject(err)
        }
      })

      if (onBarContextMenu) {
        onBarContextMenu({
          bar: closest,
          clientX,
          clientY,
          event: e,
          getScreenshotBlob,
          region,
          sections,
          clickPrice,
          currentPrice,
          resetView: () => {
            try {
              // VERTICAL: clear manual price-scale drag / locked placement + re-enable
              // auto-scale so candles are always re-framed (axis-drag pins a fixed
              // range the horizontal reframe can't undo — "reset does nothing" bug).
              vertMarginsRef.current = null
              focusPriceRangeRef.current = null
              try {
                mainPriceScale()?.applyOptions({
                  autoScale: true,
                  scaleMargins: _mainMargins(paneLayoutRef.current, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
                })
              } catch { /* noop */ }
              // HORIZONTAL: reframe to the timeframe default.
              const ts = chartRef.current?.timeScale(); if (!ts) return
              const len = lastBarCountRef.current || 0
              if (len > 1) {
                const { from, to } = computeDefaultLogicalRange(len, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride, plotWidthPx: plotWidthOf(chartRef.current, containerRef.current) })
                ts.setVisibleLogicalRange({ from, to })
              } else {
                ts.resetTimeScale()
              }
              userViewMovedRef.current = false   // explicit reset re-arms the pinned-right net
              replayViewLockedRef.current = false; replayLockedViewRef.current = null // and releases the replay view lock
            } catch { /* noop */ }
          },
          openSettings: () => { try { toolbarRef.current?.openSettings() } catch { /* noop */ } },
          clearDrawings: () => { try { clearAll?.() } catch { /* noop */ } },
          hasDrawings: (drawings?.length || 0) > 0,
        })
      } else {
        window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
          detail: {
            sym,
            tf: resolvedTf,
            bar: closest,
            clientX,
            clientY,
            getScreenshotBlob,
            region,
            sections,
            clickPrice,
            currentPrice,
          },
        }))
      }
    }

    // Desktop: native right-click fires immediately.
    const onContextMenu = (e) => openMenuAt(e.clientX, e.clientY, e)

    // Touch: long-press (≥450ms, no significant movement) opens the same menu.
    // Skipped while a drawing/position tool is armed so a long-press never
    // collides with placing/dragging a drawing. Mirrors useLongPress + the
    // TickerActions long-press pattern.
    let lpTimer = null
    let lpStart = { x: 0, y: 0 }
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } }
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') return            // mouse uses native contextmenu
      if (activeToolRef.current) return                // a drawing tool is armed — don't intercept
      lpStart = { x: e.clientX, y: e.clientY }
      const cx = e.clientX, cy = e.clientY
      clearLp()
      lpTimer = setTimeout(() => {
        lpTimer = null
        if (activeToolRef.current) return              // tool armed mid-press
        try { navigator.vibrate?.(10) } catch { /* noop */ }
        openMenuAt(cx, cy, null)
      }, 450)
    }
    const onPointerMove = (e) => {
      if (!lpTimer) return
      if (Math.abs(e.clientX - lpStart.x) > 10 || Math.abs(e.clientY - lpStart.y) > 10) clearLp()
    }

    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', clearLp)
    el.addEventListener('pointercancel', clearLp)
    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', clearLp)
      el.removeEventListener('pointercancel', clearLp)
      clearLp()
    }
  }, [onBarContextMenu, bars, sym, resolvedTf, cs, showVolume, showVolumeProp, overlaysProp, resolvedOverlays, showDrawingTools, handleUpdateChartSettings, buildRegionSections])

  // ── News marker click handler ──
  // Lightweight Charts doesn't expose a direct marker-click event, so we
  // subscribe to all clicks and match the clicked time against news markers
  // with a tolerance of half a bar. On match → open the article URL.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !newsMarkers?.length) return
    const tfSec = PERIOD_SECONDS[resolvedTf] || (resolvedTf === 'D' ? 23400 : 86400)
    const handler = (param) => {
      if (!param || param.time == null) return
      // Compare based on time-type alignment (number vs string).
      const matching = newsMarkers.find(m => {
        if (typeof m.time === 'number' && typeof param.time === 'number') {
          return Math.abs(m.time - param.time) < tfSec * 0.5
        }
        return String(m.time) === String(param.time)
      })
      if (matching?._newsData?.url) {
        window.open(matching._newsData.url, '_blank', 'noopener,noreferrer')
      }
    }
    chart.subscribeClick(handler)
    return () => {
      try { chart.unsubscribeClick(handler) } catch {}
    }
  }, [newsMarkers, resolvedTf])

  // ── Earnings marker click → themed earnings popover ──
  // Same time-match approach as news markers (LWC has no marker-click event).
  // Earnings markers only render on daily/weekly, whose time is a 'YYYY-MM-DD'
  // string, so match by string equality. Opens the popover at the click point.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !earningsEvents.length) { setEarningsPopup(null); return }
    const handler = (param) => {
      if (!param || !param.point) return
      // Prefer a pixel hit-test against the badge's actual pill (whole box is
      // clickable); fall back to exact bar-time match if the primitive has no
      // rects yet (e.g. first frame after a re-attach).
      let hit = null
      const hitTime = earnBadgeRef.current?.hitTest?.(param.point.x, param.point.y)
      if (hitTime != null) hit = earningsEvents.find(m => String(m.date) === String(hitTime))
      if (!hit && param.time != null) hit = earningsEvents.find(m => String(m.date) === String(param.time))
      if (!hit) return
      const rect = containerRef.current?.getBoundingClientRect()
      const px = rect && param.point ? rect.left + param.point.x + 12 : (rect?.left ?? 0) + 40
      const py = rect && param.point ? rect.top + param.point.y + 12 : (rect?.top ?? 0) + 40
      setEarningsPopup({ data: hit.data, x: px, y: py })
    }
    chart.subscribeClick(handler)
    return () => { try { chart.unsubscribeClick(handler) } catch {} }
  }, [earningsEvents])

  // Close the earnings popover when the symbol or timeframe changes out from under it.
  useEffect(() => { setEarningsPopup(null) }, [sym, resolvedTf])

  // ── Highlighted setup/catalyst candle click → onHighlightClick (Model Book) ──
  // Clicking a painted setup/catalyst candle opens the intraday 5-min popup. We
  // match the clicked time against the highlight set, resolve it back to the
  // original YYYY-MM-DD via highlightTimeMap, and hand the parent screen coords
  // (from the click point + container rect) to anchor the popover.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onHighlightClick || !highlightTimeMap || highlightTimeMap.size === 0) return
    const tfSec = PERIOD_SECONDS[resolvedTf] || (resolvedTf === 'D' ? 23400 : 86400)
    const handler = (param) => {
      if (!param || param.time == null) return
      const t = param.time
      let origDate = highlightTimeMap.get(t) ?? null
      if (origDate == null) {  // tolerance match (intraday number times / business-day objects)
        for (const [adj, orig] of highlightTimeMap) {
          if (typeof adj === 'number' && typeof t === 'number') {
            if (Math.abs(adj - t) < tfSec * 0.5) { origDate = orig; break }
          } else if (String(adj) === String(t)) { origDate = orig; break }
        }
      }
      if (origDate == null) return
      const rect = containerRef.current?.getBoundingClientRect()
      const clientX = rect && param.point ? rect.left + param.point.x : null
      const clientY = rect && param.point ? rect.top + param.point.y : null
      // Pin the main chart's view across the click. Clicking a setup/catalyst
      // candle only opens the intraday popup — it must NEVER move the underlying
      // chart. A bare click can still trip the focus-escape pan-detector (a few
      // px of pointer jitter), which drops the setup focus and lets the next
      // updateChart snap the view back to the full year ("glitches to the left").
      // Capturing the current logical range and re-asserting it across the settle
      // window makes the open visually inert regardless of what fired underneath.
      let pinned = null
      try { pinned = chart.timeScale().getVisibleLogicalRange() } catch { /* ignore */ }
      if (pinned) {
        const reassert = () => {
          try { chart.timeScale().setVisibleLogicalRange({ from: pinned.from, to: pinned.to }) } catch { /* out of range mid-load */ }
        }
        requestAnimationFrame(reassert)
        requestAnimationFrame(() => requestAnimationFrame(reassert))
        setTimeout(reassert, 60)
        setTimeout(reassert, 180)
      }
      onHighlightClick({ date: String(origDate), clientX, clientY })
    }
    chart.subscribeClick(handler)
    return () => { try { chart.unsubscribeClick(handler) } catch {} }
  }, [onHighlightClick, highlightTimeMap, resolvedTf])

  // ── Volume Profile canvas overlay ──
  // ⛔ NOT MIGRATABLE, BY DECISION. A canvas overlay, not a series: no compute
  // function, no plot style that expresses horizontal volume bins. It has no
  // engine definition and never will until a `primitive` compute kind exists
  // (see `engine/nativeRegistry.CARVED_OUT_INDICATOR_KEYS`). NO Flip A guard and
  // NO Flip B deletion applies here — a flip that silenced this effect would make
  // the volume profile vanish with nothing to replace it.
  useEffect(() => {
    const canvas = vpCanvasRef.current
    const chart = chartRef.current
    if (!chart || !canvas) return
    const vpCfg = cs.indicators?.volumeProfile
    const series = candleSeriesRef.current

    // Resize canvas to match container
    const container = containerRef.current
    if (container) {
      canvas.width  = container.offsetWidth
      canvas.height = container.offsetHeight
    }

    const redraw = () => drawVolumeProfile(canvas, chart, series, filteredBars, vpCfg)
    redraw()
    const unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(redraw)
    return () => {
      try { unsub() } catch {}
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [cs.indicators?.volumeProfile, filteredBars])

  // Viewport-first backfill (Phase 2): while at the shallow first-paint depth,
  // bump to the full target when the user pans toward the oldest loaded bar.
  // setFetchDepth changes the SWR key → a no-`since` full fetch lands the deeper
  // superset, and the same-ticker re-anchor holds the view. Disabled for overlay
  // modes (they already fetch full) and pinned charts (entryDate / exactDateRange
  // / barsOverride). Mirrors the existing visible-range subscription pattern.
  useEffect(() => {
    if (_overlayActive || entryDate || exactDateRange || _hasOverride || replayCutoff) return undefined
    if (fetchDepth >= _fullTarget) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let raf = null
    const onRange = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        let range = null
        try { range = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
        if (!range) return
        if (shouldBackfill({
          fromIndex: range.from,
          toIndex: range.to,
          loadedCount: lastBarCountRef.current,
          fullTarget: _fullTarget,
        })) {
          // Progressive: step to the next depth tier, not straight to full. A
          // deep intraday jump (600->20000) is a single ~20s fetch before any
          // history appears; stepping lands a fast first chunk and only fetches
          // full if the user keeps panning past it. The re-anchor holds the view
          // across each step. (D/W/M reach full in one step or via dwell-warm.)
          setFetchDepth(d => nextBackfillDepth(d, _fullTarget))
        }
      })
    }
    let unsub = null
    try { unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(onRange) } catch { /* ignore */ }
    return () => {
      if (unsub) { try { unsub() } catch { /* ignore */ } }
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget])

  // Proactive deep-history warm (dwell-gated) — makes scroll-back INSTANT.
  // The viewport-first first paint is shallow (FIRST_PAINT_BARS) for an instant
  // open; then we quietly bump to the FULL depth in the background so the whole
  // history is loaded without the user having to pan-and-wait. It reuses the same
  // setFetchDepth path as the pan-backfill, so the same-ticker re-anchor holds the
  // visible view (no jump) — by the time the user zooms/scrolls out, the deep
  // history is already there. Server SQLite caches it once for everyone.
  //
  // ALL timeframes warm (intraday included) — the user wants hourly/30m/15m/5m to
  // reach their full available history, not just the ~600-bar first-paint window
  // (that was the "hourly only goes back to May" symptom). Intraday deep windows
  // ARE large (up to ~20-30k bars, capped by the backend's per-TF lookback), so we
  // keep the short dwell delay to skip warming on quick ticker-flips, and multi-
  // chart grid cells still pass backgroundWarm=false to avoid a cold-open herd.
  useEffect(() => {
    if (_overlayActive || entryDate || exactDateRange || _hasOverride || replayCutoff) return undefined
    if (!backgroundWarm && !deepWarm) return undefined
    if (fetchDepth >= _fullTarget) return undefined
    const id = setTimeout(() => setFetchDepth(_fullTarget), 900)
    return () => clearTimeout(id)
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget, backgroundWarm, deepWarm, replayCutoff])

  // Cleanup: destroy chart only on unmount
  useEffect(() => {
    return () => {
      try { markersControllerRef.current?.detach?.() } catch {}
      markersControllerRef.current = null
      // The manifest registry holds ONE slot. Releasing it here — beside
      // `chart.remove()` — is what stops `currentPaneManifest()` calling `panes()`
      // on a disposed chart after an unmount. The unregister is identity-scoped, so
      // a chart that has already been superseded by another mount is a no-op rather
      // than erasing its successor's registration.
      try { unregisterManifestRef.current?.() } catch {}
      unregisterManifestRef.current = null
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        candleSeriesRef.current = null
        volumeSeriesRef.current = null
        overlaySeriesRefs.current = []
        priceLineRefs.current = []
        sessionTagRefs.current = []
        sessionTagSeriesRef.current = null
        lastShadeBandsRef.current = undefined   // primitive goes with the chart; bands must re-apply
        lastMarkersSrcRef.current = undefined
        // Reset every paint/framing latch alongside the chart they describe.
        // These survive a destroy→recreate cycle otherwise (StrictMode's
        // simulated remount, or any future remount path with warm caches):
        // chart #2 then comes up under an armed 'noop' render plan and an
        // already-consumed zoom key — created but never painted, never framed
        // (the blank multi-chart grid cells after a mode roundtrip).
        volMaSeriesRef.current = null
        volMaTailSeriesRef.current = null
        volumeSeparatePaneRef.current = false
        prevChartTypeRef.current = null
        wmAttachedRef.current = false
        sessionShadeAttachedRef.current = false
        sessionShadeVolAttachedRef.current = false
        lastShadeBandsVolRef.current = null
        zonesAttachedRef.current = false        // primitive goes with the chart; must re-attach
        lastDpZonesRef.current = undefined      // …and the zones must re-apply to the new one
        lastCfgSigRef.current = null
        prevBarsRef.current = null
        prevPaintBarsRef.current = null
        lastBarCountRef.current = 0
        zoomKeyRef.current = null
        lastTfRef.current = null
        pendingTfReframeRef.current = null
      }
    }
  }, [])

  // ── Clear drawing selection on symbol/tf change ──
  useEffect(() => {
    setActiveTool(null)
    setSelectedId(null)
  }, [sym, resolvedTf])

  // ── Bar-correction flash subscription (P4-7) ──
  // Fires the visible "Bar corrected" pill for 2s when minute-close
  // reconciliation overrides the WS-built bar for this symbol.
  useEffect(() => {
    if (!sym) return
    const unsub = realtimeCandle.onCorrection(sym, () => {
      setCorrectionFlash(true)
      setTimeout(() => setCorrectionFlash(false), 2000)
    })
    return unsub
  }, [sym])

  // ── Tick-by-tick developing-candle update via realtimeCandle registry ──
  // (Plan 4 / Goal 3) — drive series.update() on every SSE tick instead of
  // waiting for the 2s REST poll cycle. Coexists with the REST-driven live-
  // price effect above (line ~851) as a SAFETY FALLBACK; both paths write to
  // the same series and the latest write wins. SSE will dominate when the
  // stream is connected (target: tick-to-pixel <200ms); REST keeps the chart
  // alive when SSE drops or for tickers not in the WS subscription set.
  //
  // The registry stores tf="1" only (built from raw ticks). For:
  //   - resolvedTf="1": use registry candle directly.
  //   - resolvedTf in {5,15,30,60}: use the registry's latest tick price to
  //     update the developing bar tracked in liveBarRef (set by the REST/AM
  //     paths). We extend h/l and update close, mirroring the same logic the
  //     REST effect uses, but firing at SSE cadence.
  useEffect(() => {
    if (!sym) return
    if (!candleSeriesRef.current) return
    if (replayMode || replayCutoffRef.current) return   // replay/cutoff freezes the developing bar
    if (cs.heikinAshi) return
    const isIntradayTf = ['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!isIntradayTf) return

    const useOhlc = isOhlcType(cs.chartType)

    const update = () => {
      if (!candleSeriesRef.current) return
      // Writer C of the single-writer invariant (index @ barsPushActiveRef decl): the
      // Finnhub-fed registry is suppressed when the Massive push feed is the authoritative
      // developing-bar writer (onRealtimeBar owns it).
      if (barsPushActiveRef.current) return
      // Freeze while the provisional stale-intraday cache is on screen (see Writer A).
      if (provisionalStaleRef.current) return
      const candle = realtimeCandle.getCandle(sym, '1')
      if (!candle) return
      const price = candle.c
      if (!Number.isFinite(price) || price <= 0) return
      // RTH-only intraday (EXT/RTH toggle off): don't paint a pre/post-market
      // developing bar, matching sessionBars' 9:30–16:00 ET fetch filter.
      if (!showExtendedRef.current) {
        const _m = etMinutes(candle.t)
        if (_m < 570 || _m >= 960) return
      }
      // Sanity bound vs last known close — protects against bad ticks.
      const lastClose = lastBarRef.current?.close
      if (lastClose && lastClose > 0 && Math.abs(price - lastClose) / lastClose > 0.5) return

      try {
        if (resolvedTf === '1') {
          // Registry's 1m candle IS the developing bar. Apply it directly,
          // but offset to ET like all other series timestamps.
          const tSec = candle.t + _ET_OFFSET
          // Never apply a BACKWARDS update. The SSE tick feed and the 30s REST/SWR
          // poll have different latencies, so at a minute rollover the registry can
          // momentarily lag the series' newest bar; a stale/lagged tick applied at an
          // older time throws LWC "Cannot update oldest data" (once/minute console
          // spam) and is lost anyway. Skip it — equal time updates in place, newer
          // appends a legit new bar. (The deeper single-writer fix is Phase C.)
          const _lastT = lastBarRef.current?.time
          if (typeof _lastT === 'number' && tSec < _lastT) return
          // Forward-contiguity guard (mirror of classifyLiveBar / Writer B): don't
          // plant a 1m bar MORE than one interval past the tail — the minutes in
          // between are missing (stale/loading series), and a detached bar is the
          // "gap before the live candle" artifact. Skip; the refetch fills the gap.
          if (typeof _lastT === 'number' && tSec - _lastT > 60) return
          if (useOhlc) {
            candleSeriesRef.current.update({
              time: tSec,
              open: candle.o,
              high: candle.h,
              low: candle.l,
              close: candle.c,
            })
          } else {
            candleSeriesRef.current.update({ time: tSec, value: candle.c })
          }
          if (volumeSeriesRef.current) {
            // match the candle palette (same derivation as volData) so the
            // developing bar's volume color matches the historical bars
            const _vUp = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDown = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            const _pbC = prevBarsRef.current
            const _prevCC = colorByNetChange && _pbC && _pbC.length >= 2 ? _pbC[_pbC.length - 2].c : null
            const _upC = _prevCC != null ? (candle.c >= _prevCC) : (candle.c >= candle.o)
            // Same reset hazard as the push writer: the registry candle only counts
            // ticks seen since we subscribed, so on a fresh symbol/TF it restarts near
            // 0 mid-bucket. Floor it at the true volume we already hold for this same
            // bucket (fetched partial / last server refresh) — never paint LESS than
            // what has demonstrably already traded.
            const _regV = Number(candle.v) || 0
            const _knownV = (lastBarRef.current && lastBarRef.current.time === tSec
              && Number.isFinite(lastBarRef.current.volume)) ? lastBarRef.current.volume : 0
            volumeSeriesRef.current.update({
              time: tSec,
              value: Math.max(_regV, _knownV),
              color: _upC ? _vUp : _vDown,
            })
          }
          // Sync trackers so REST path stays consistent
          if (liveBarRef.current && liveBarRef.current.time === tSec) {
            liveBarRef.current = {
              time: tSec, open: candle.o, high: candle.h, low: candle.l, close: candle.c,
            }
          }
          if (lastBarRef.current && lastBarRef.current.time === tSec) {
            lastBarRef.current = { ...lastBarRef.current, open: candle.o, high: candle.h, low: candle.l, close: candle.c }
          }
        } else {
          // 5/15/30/60 — registry only has 1m bars, so use its latest price
          // to extend the developing bar's h/l and update close. Bar's `t`
          // comes from liveBarRef (set by REST/AM paths).
          const lb = liveBarRef.current
          const last = lastBarRef.current
          if (!lb || !last || lb.time !== last.time) return
          const newHigh = Math.max(lb.high, price)
          const newLow = Math.min(lb.low, price)
          liveBarRef.current = { ...lb, high: newHigh, low: newLow, close: price }
          const updated = {
            time: last.time,
            open: last.open,
            high: newHigh,
            low: newLow,
            close: price,
          }
          if (useOhlc) {
            candleSeriesRef.current.update(updated)
          } else {
            candleSeriesRef.current.update({ time: last.time, value: price })
          }
          lastBarRef.current = { ...updated, volume: last.volume }
        }
      } catch (e) {
        // "Cannot update oldest data" is the benign rollover race guarded above (the
        // candle is never corrupted — LWC just refuses the backwards write). Don't
        // spam the console for it; surface any other, genuinely unexpected error.
        if (e?.message && !/oldest data/i.test(e.message)) {
          console.warn('[StockChart] registry tick update error:', e.message)
        }
      }
    }

    // Fire once on subscribe in case a tick already landed before mount,
    // then subscribe to future ticks.
    update()
    const unsub = realtimeCandle.subscribe(sym, update)
    return unsub
  }, [sym, resolvedTf, replayMode, cs.heikinAshi, cs.chartType, cs.volume.upColor, cs.volume.downColor])

  // ── Render ──
  // Date-range bar (bottom-left, above the volume pane). Reframes the visible window
  // to the requested price-history span on the CURRENT bars via a date-based cutoff,
  // so it works precisely on daily (its intended use) and degrades gracefully to
  // "all available" on shorter-history intraday timeframes.
  const applyRange = (val) => {
    try {
      const ts = chartRef.current?.timeScale()
      const _bars = filteredBars
      if (!ts || !_bars || _bars.length < 2) return
      const lastMs = _dateToMs(_bars[_bars.length - 1].t)
      if (!Number.isFinite(lastMs)) return
      const d = new Date(lastMs)
      const cutoffMs = val === 'ytd'
        ? Date.UTC(d.getUTCFullYear(), 0, 1)
        : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - val, d.getUTCDate())
      const lastIdx = _bars.length - 1
      const firstMs = _dateToMs(_bars[0].t)
      if (!Number.isFinite(firstMs) || lastMs <= firstMs) return
      // Anchor the LEFT edge to the cutoff DATE, not to the first bar. For a
      // short-history ticker whose IPO is INSIDE the lookback (SPCX/DRAM on 3M,
      // 6M, …) the cutoff sits before bar 0, so `from` goes negative → the bars
      // keep their normal (period-appropriate) width with blank space to the
      // left, instead of the whole IPO history being stretched across the pane.
      // Window width = the lookback span converted to bars via the series' own
      // bar density (timeframe-agnostic: works for D/W/M).
      const msPerBar = (lastMs - firstMs) / lastIdx
      const windowBars = msPerBar > 0 ? (lastMs - cutoffMs) / msPerBar : lastIdx
      if (!(windowBars >= 1)) return
      ts.setVisibleLogicalRange({ from: lastIdx - windowBars, to: lastIdx + (rightPadBars || 3) })
    } catch { /* noop */ }
  }
  const _rangeVolPct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))

  return (
    <div className={`${styles.wrapper} ${className}`} style={{ height, ...panelVars }}>
      {replayMode && sessionBars?.length > 0 && (
        <div className={styles.replayBadge} title="Time Machine — historical replay active">
          <UIcon name="skipBack" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />REPLAY {Math.round(((replayIndex ?? 0) / Math.max(1, sessionBars.length - 1)) * 100)}%
        </div>
      )}
      {liveUpdates && realtimeTfEligible && (
        <div
          className={feed.state === 'live' ? styles.liveIndicator : styles.staleIndicator}
          title={
            feed.state === 'reconnecting' ? 'Reconnecting to the live feed…'
            : feed.state === 'stale' ? 'Live feed has paused — last tick is older than expected'
            : 'Live feed connected'
          }
        >
          {feed.state === 'live' ? '● LIVE' : feed.state === 'reconnecting' ? '⟳ RECONNECTING' : <><UIcon name="pause" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />STALE</>}
        </div>
      )}
      {correctionFlash && (
        <div className={styles.correctionFlash} title="Server corrected this bar after reconciliation">
          ↻ Bar corrected
        </div>
      )}
      {cs.countdown && !hideCountdown && countdownTfSec && currentBarStart && (
        <div className={styles.countdownPosition}>
          <CountdownTimer barStartTime={currentBarStart} tfSeconds={countdownTfSec} />
        </div>
      )}
      {earningsPopup && (
        <EarningsMarkerPopover
          data={earningsPopup.data}
          x={earningsPopup.x}
          y={earningsPopup.y}
          sym={sym}
          beatColor={cs.markers?.earningsBeat || '#1ae51a'}
          missColor={cs.markers?.earningsMiss || '#c41f2d'}
          themeVars={menuThemeVars(
            canvasSample.top,
            (userCanvas && cs.bgMode === 'gradient' && canvasTheme !== 'sunrise')
              ? { gradient: { top: cs.bgGradient?.top || MB_BG, bottom: cs.bgGradient?.bottom || MB_BG } }
              : undefined,
          ) || undefined}
          onClose={() => setEarningsPopup(null)}
        />
      )}
      {/* Spec §6's settings form, scoped to ONE instance. `Sheet` portals it to
          <body>, so its position in this tree is irrelevant to layout.

          ⚠️ NO `preset: 'custom'` STAMP HERE, and that is deliberate rather than
          an omission. Every door the dialog writes through — `setInstanceInput`,
          `setInstanceHidden`, `withInstances` — already marks the blob custom
          (`instanceControls.withInstances`). Re-stamping it in the mount would
          make Cancel restore a blob that differs from the one the dialog opened
          with by exactly that key, which is the byte-equality this task's whole
          gate rests on. Identity, not deep equality: a REFUSED write comes back
          as `cs` itself and must not persist. */}
      {settingsInstanceId && (
        <IndicatorSettingsDialog
          open
          instanceId={settingsInstanceId}
          settings={cs}
          registry={engineRegistry}
          onChange={(next) => { if (next !== cs) handleUpdateChartSettings(next) }}
          onClose={() => setSettingsInstanceId(null)}
        />
      )}
      {/* ─── chart-UX-walls TASK 4 — THE CHIP MENU (spec §6) ──────────────────
          Tap / right-click / long-press a chip → Settings · Hide · Move · Alerts
          · About · Remove. ONE shipped primitive, unmodified: `ContextPopover` is
          already a bottom sheet on touch and an anchored menu on desktop, with
          44px rows, outside-click and Escape (`mobile/ContextPopover`).

          ⛔ MOUNTED OUTSIDE THE LEGEND, AND THAT IS NOT THE CONTRADICTION IT
          LOOKS LIKE. Task 3's invariant is that a CHIP stays inside the legend
          container, because the export route hides `[class*="legend" i]` and a
          chip outside it would appear in every branded newsletter screenshot. A
          MENU is not part of the export frame at all — it only exists while a
          user is pointing at something — and `ContextPopover` portals to
          `<body>` regardless, so its position in this tree is inert.

          ⛔ AND IT IS RESOLVED FROM `cs` AT RENDER, not from the snapshot: the
          Move submenu's tick has to follow the placement the user just chose. */}
      {chipMenu && (() => {
        const c = chipMenu.chip
        const def = engineRegistry.getDefinition(c.defId)
        const inst = findInstance(cs, c.instanceId)
        const close = () => { setChipMenu(null); setChipPage(null) }
        const items = chipMenuItems(
          { ...c, placementTarget: inst && inst.placement && inst.placement.target },
          def,
          {
            onSettings: (id) => { close(); setSettingsInstanceId(id) },
            onToggleHidden: (id) => { close(); handleChipHidden(id) },
            onMove: (id, t) => { close(); handleChipMove(id, t) },
            onDuplicate: (id) => { close(); handleChipDuplicate(id) },
            onAlerts: (id) => { close(); handleChipAlerts(id, c.plotKey) },
            onAbout: () => { close(); setChipAbout({ chip: c, anchor: chipMenu.anchor }) },
            onRemove: (id) => { close(); handleChipRemove(id) },
          },
          { alertsRefusal: chipAlertsRefusal },
        )
        const move = items.find((i) => i.key === 'move')
        const page = (chipPage === 'move' && move && !move.disabled)
          ? [
              { key: '_back', label: c.label, icon: 'collapse', keepOpen: true,
                onClick: () => setChipPage(null) },
              { separator: true },
              ...move.submenu.map((s) => ({ ...s, icon: s.checked ? 'check' : 'expand' })),
            ]
          : items.map((it) => (it.key === 'move' && !it.disabled
              ? { ...it, keepOpen: true, onClick: () => setChipPage('move') }
              : it))
        return (
          <ContextPopover
            open
            onClose={close}
            anchor={chipMenu.anchor}
            title={c.label}
            width={260}
            items={page.map(chipMenuRowToPopoverRow)}
          />
        )
      })()}
      {/* ⭐ ABOUT — a second PAGE of the same popover, spec §6's sixth row. The
          text is `def.meta.description`, which every definition already declares,
          so this needs no new data and no new fetch.

          ⭐⭐ AND IT IS THE ONLY SURFACE ON THIS CHART THAT CAN REACH A PLOT WITH
          NO CHIP, WHICH IS WHY THE PER-PLOT REPAINT NOTICES LIVE HERE. Measured:
          `ichimoku`'s `chikou` declares no `plots[].legend` block, so `legendChips`
          emits nothing for it and it has no chip to mark — and `chikou` is the
          ONE column the owner's ruling is about. A chip-only surface would have
          shipped a per-plot badge that is invisible for the exact plot it exists
          for. This page is per DEFINITION, so it lists every column the linter
          measured, chip or no chip.

          ⛔ AND `meta.repaint` IS DELIBERATELY NO LONGER PRINTED HERE. It used to
          render as bare prose — "non repainting · Momentum" — on all seventeen
          definitions, and record §1 measured what that sentence actually is: a
          shared default from ONE helper that every native inherits and none
          overrides, i.e. an unset column wearing the costume of an audit.
          Printing an unaudited default as a fact to a trader is the defect the
          decision record is about, and on `ichimoku` it was printing a claim the
          machine linter contradicts. What renders now is the MEASUREMENT, and
          only when there is one: sixteen definitions show nothing at all, which
          is the owner's own reasoning — *"a badge that every indicator wears
          carries no information"* (record §4). `meta.repaint` keeps its meaning
          and its consumers (the library dialog's row badge; `validateAstLane`'s
          both-directions refusal on the one lane where it is checkable) — it is
          the definition's CLAIM, and this is the maths. */}
      {chipAbout && (() => {
        const def = engineRegistry.getDefinition(chipAbout.chip.defId)
        const meta = (def && def.meta) || {}
        const notices = repaintNotices(def)
        return (
          <ContextPopover
            open
            onClose={() => setChipAbout(null)}
            anchor={chipAbout.anchor}
            title={meta.name || chipAbout.chip.defId}
            width={280}
          >
            <div style={{ padding: '4px 10px 10px', fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary, #b8b3a5)' }}>
              {meta.description || 'This indicator declares no description.'}
              {meta.category && (
                <div style={{ marginTop: 8, fontSize: 11, opacity: 0.75 }}>{meta.category}</div>
              )}
              {notices.map((n) => (
                <div
                  key={n.plotKey}
                  data-repaint-plot={`${chipAbout.chip.defId}.${n.plotKey}`}
                  data-repaint={n.mode}
                  style={{
                    marginTop: 8, padding: '6px 8px', borderRadius: 4, fontSize: 11, lineHeight: 1.5,
                    background: 'rgba(240, 180, 41, 0.12)',
                    borderLeft: '2px solid var(--color-warning, #f0b429)',
                    color: 'var(--chart-panel-text-strong-low, #e2dfd6)',
                  }}
                >
                  <strong>{n.label} — {String(n.mode).replace(/-/g, ' ')}</strong>
                  <div style={{ opacity: 0.85 }}>{n.sentence}</div>
                </div>
              ))}
            </div>
          </ContextPopover>
        )
      })()}
      {enabledComparisons.length > 0 && (
        <div className={styles.comparisonLegend}>
          <span className={styles.legendLabel}>vs {sym}:</span>
          {comparisonSeries.map(s => {
            const last = s.points && s.points.length ? s.points[s.points.length - 1] : null
            const pct = last?.value
            const valid = Number.isFinite(pct)
            return (
              <span key={s.sym} className={styles.legendItem} style={{ color: s.color }}>
                {s.sym} {valid ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
              </span>
            )
          })}
        </div>
      )}
      {loading && <ChartSkeleton label={`Loading ${sym}…`} />}
      {showFatalError && (
        <div className={styles.error}>
          <span>Failed to load chart for {sym}</span>
          <button className={styles.retryBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}
      {!loading && !showFatalError && selectedRangeEmpty && (
        <div className={styles.error}>
          <span>No {sym} chart data for the selected dates.</span>
          <span style={{ fontSize: 10, opacity: 0.8, maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>
            The data provider has no bars in this window (the ticker may have been
            delisted, renamed, or not yet listed then). Pick a date range the ticker
            actually traded.
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.chart}
        style={{
          display: (showFatalError || selectedRangeEmpty) ? 'none' : 'block',
          // Sunrise (and any user gradient) paints a continuous gradient HERE, behind
          // the transparent LWC canvas, so it flows unbroken through the price + volume
          // panes. The user gradient (Canvas settings) works the same way. For a SOLID
          // canvas, match the container to the canvas color so a sub-pixel gap at the
          // right/bottom edge (the LWC canvas rounds short of the container at fractional
          // display scaling) blends in instead of exposing the dark --widget-canvas
          // behind it as a black line.
          background: canvasTheme === 'sunrise'
            ? SUNRISE_GRADIENT
            : (userCanvas && cs.bgMode === 'gradient'
                ? `linear-gradient(to bottom, ${cs.bgGradient?.top || '#16233b'} 0%, ${cs.bgGradient?.bottom || '#0e0f0d'} 100%)`
                : themeColors.background),
        }}
      />
      {/* ── Dark Pool volume profile bars — uses series.priceToCoordinate() to
          stay aligned with candles at any zoom/pan level. Updates every frame
          via rAF (see darkPoolBarsLayout effect above). The container is
          pointer-events:none so chart hover passes through; individual bars
          set pointer-events:auto so the hover tooltip works on them. ── */}
      {!showFatalError && chartReady && darkPoolBarsLayout.length > 0 && (
        <div
          ref={dpBarsContainerRef}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 10,
            overflow: 'hidden',
          }}
        >
          {darkPoolBarsLayout.map((b) => (
            <div
              key={`dp-${b.idx}-${b.price}`}
              data-dp-bar=""
              data-price={b.price}
              style={{
                position: 'absolute',
                right: 60,        // leave room for LWC's right price axis
                height: 0,
                display: 'none',  // rAF will set display:block once positioned
                pointerEvents: 'auto',
                cursor: 'help',
              }}
              onMouseEnter={(e) => setDpHover({ bar: b, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setDpHover({ bar: b, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setDpHover(null)}
            >
              <div style={{
                position: 'absolute',
                right: 0,
                top: -b.height / 2,
                width: b.width,
                height: b.height,
                background: b.color,
                opacity: b.opacity,
                borderRadius: 1,
              }}/>
              {b.showLabel && (
                <span
                  style={{
                    position: 'absolute',
                    right: b.width + 3,
                    top: -7,
                    fontSize: 9.5,
                    color: b.color,
                    fontWeight: 700,
                    // Top 3 always need to be legible — bar opacity caps at
                    // 0.50, so push label opacity to ~0.95 for high contrast.
                    opacity: Math.min(1, b.opacity + 0.45),
                    whiteSpace: 'nowrap',
                    fontFamily: "'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                    pointerEvents: 'none',
                  }}>
                  {formatDpNotional(b.notional)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Dark Pool hover tooltip — rendered into document.body via Portal
          so it always escapes any parent that has `transform`, `filter`, or
          `will-change` set (common CSS perf hacks that silently re-anchor
          `position: fixed` to the transformed ancestor instead of the
          viewport — which was making the tooltip clip off-screen no matter
          how we clamped the math).
          Position policy: always to the LEFT of the cursor, because dark
          pool bars are anchored to the chart's right edge so the cursor is
          guaranteed to be on the right side. Always-left is simpler and
          more predictable than a flip-based approach. Final left/top are
          clamped to the viewport so the tooltip can never overflow. */}
      {dpHover && typeof document !== 'undefined' && createPortal((() => {
        const TOOLTIP_W = 260
        const TOOLTIP_H = 150
        const vw = window.innerWidth || document.documentElement.clientWidth || 1920
        const vh = window.innerHeight || document.documentElement.clientHeight || 1080
        // Always position to the LEFT of cursor — bars sit on the chart's
        // right edge so cursor is always near the right side of the screen,
        // and opening leftward is the natural direction. Clamp to ≥8 so
        // even an edge-case left-side cursor doesn't push us off-screen.
        const rawLeft = dpHover.x - 14 - TOOLTIP_W
        const left = Math.max(8, Math.min(rawLeft, vw - TOOLTIP_W - 8))
        const top = Math.max(8, Math.min(dpHover.y - 90, vh - TOOLTIP_H - 8))
        return (
          <div style={{
            position: 'fixed',
            left,
            top,
            background: '#0e0f0d',
            border: '1px solid #c9a84c66',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 11,
            color: '#e0dac8',
            pointerEvents: 'none',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
            minWidth: 200,
            maxWidth: TOOLTIP_W,
            lineHeight: 1.5,
            fontFamily: "'Instrument Sans','SF Pro Display',system-ui,sans-serif",
          }}>
            <div style={{ fontWeight: 700, color: '#c9a84c', fontSize: 12, marginBottom: 5 }}>
              🟡 {dpHover.bar._isCluster
                    ? `Dark Pool Zone · ${dpHover.bar._clusterCount} prints`
                    : 'Dark Pool Print'}{dpHover.bar.isLatest ? ' · LATEST' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
              <span style={{ color: '#706b5e' }}>Date</span>
              <span style={{ color: '#e0dac8', fontWeight: 600 }}>
                {dpHover.bar.dateLong || dpHover.bar.dateRaw || dpHover.bar.date || '—'}
              </span>
              <span style={{ color: '#706b5e' }}>Price</span>
              <span style={{ color: '#c9a84c', fontWeight: 700 }}>
                ${Number(dpHover.bar.price).toFixed(2)}
              </span>
              <span style={{ color: '#706b5e' }}>Premium</span>
              <span style={{ color: '#6ba3be', fontWeight: 600 }}>
                {formatDpNotional(dpHover.bar.notional)}
              </span>
              {dpHover.bar.pctAvgVol > 0 && (
                <>
                  <span style={{ color: '#706b5e' }}>Vs avg vol</span>
                  <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                    {Math.round(dpHover.bar.pctAvgVol)}%
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })(), document.body)}
      {!showFatalError && (
        <img
          src={brandMark}
          alt="Uncharted Territory"
          className={styles.brandLogo}
          draggable={false}
        />
      )}
      {/* Price-scale mode toggle — sits on the right price axis, just above the
          volume/indicator pane stack (top of the sub-panes = main.bottom frac).
          26px allows for the time axis below the price-pane drawing area. */}
      {!showFatalError && chartReady && (
        <div
          className={styles.scaleToggle}
          /* Docked at the very bottom, lined up with the date axis (right: 6px keeps
             it just clear of the SE corner resize handle).
             ⭐ MASTER'S `ee1de33e` DECIDED THIS AND THE MERGE KEEPS IT. Phase B's
             side of this line only swapped the retired `computePaneMargins(…)`
             call for `_subPaneTopFrac(paneLayoutRef.current)` — a mechanical
             rewrite of the branch `ee1de33e` deleted, carrying no intent of its
             own. The toggle no longer tracks the sub-pane stack at all, so the
             helper went with it. */
          style={{ bottom: '3px' }}
          title="Price scale: Arithmetic / Logarithmic / Percent"
        >
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'arith' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('arith')}
            title="Arithmetic (linear) scale"
            aria-label="Arithmetic price scale"
          >A</button>
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'log' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('log')}
            title="Logarithmic scale"
            aria-label="Logarithmic price scale"
          >L</button>
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'pct' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('pct')}
            title="Percentage scale"
            aria-label="Percentage price scale"
          >%</button>
        </div>
      )}
      {crosshairData && !hideLegend && (() => {
        // User override for the BASE legend text (time + O/H/L/C/V). Inline so it beats
        // the base classes' own color; change%/overlays/indicators are intentionally
        // left to their semantic colors. undefined = keep the CSS-class default.
        const legBase = legendColor ? { color: legendColor } : undefined
        const legUp = parseFloat(crosshairData.change) >= 0
        // Day-change color: explicit setting wins; else the Sunset pair; else the
        // default green/red. Shared by all three layouts (they all read the same
        // Header setting — fixing one alone used to look like a no-op).
        const legChgColor = legUp
          ? (cs.header?.colors?.dayChangeUp || (canvasTheme === 'sunrise' ? '#0a5c22' : '#1ae51a'))
          : (cs.header?.colors?.dayChangeDown || (canvasTheme === 'sunrise' ? '#7d1620' : '#c41f2d'))
        // ── THE CHIPS, RENDERED — NOT ENUMERATED (B4 Task 10) ───────────────
        //
        // This was nine hand-written rows, each naming one indicator, its
        // `crosshairData` field, its colour path in `cs.indicators` and its
        // `toFixed` precision — the sixteenth place a new indicator had to be
        // edited into, and the one that formatted the chips an engine-drawn
        // indicator produced (`(e && e.text) || text`).
        //
        // Now it maps `crosshairData.chips`, which `processCrosshair` builds by
        // handing the engine's BINDINGS to `readout.engineChips`. Label, colour
        // and precision come from `plots[].legend`, `meta.legendParams` and the
        // INSTANCE's inputs. There is nothing here for a new indicator to be
        // edited into, and both layouts below render the same array so they still
        // cannot drift apart. (It said "BOTH lanes' entries" until B5 Task 6
        // retired the legacy lane's last three registrations — there is one lane.)
        //
        // ⚠️ THE COMPARISON CHIP STAYS HAND-WRITTEN, and that is not an oversight.
        // It is a SYMBOL overlay, not an indicator: no definition, no `plots[]`,
        // and a signed-percentage format (`AAPL +1.23%`) that no `legend` block
        // can express. It is appended AFTER the indicator chips, which is where
        // it shipped.
        //
        // ⭐ ONE ROW PER CHIP, AND THE ROW IS A COMPONENT NOW rather than a bare
        // `<span>`: it carries its own hidden state today and Task 4's hover
        // controls tomorrow. It renders INSIDE this container and that is an
        // invariant, not a preference — `ChartRender.jsx` hides
        // `[class*="legend" i]` from the export, so a chip rendered as a SIBLING
        // would appear in every branded newsletter screenshot and move all 46
        // pixel-parity baselines at once.
        //
        // `+N` COLLAPSE (spec §7): past `CHIP_COLLAPSE_AT` the tail is FOLDED —
        // it keeps its DOM node and loses its box — and one `+N` button expands
        // it in place. The spec's four is per PANE; the shipped legend is one box
        // for the whole chart, so the threshold is over the strip and the tail is
        // folded rather than dropped. See `CHIP_COLLAPSE_AT`.
        // ⛔ THE THREE BRANCHES INLINE THE STRIP, AND THE DUPLICATION IS THE
        // POINT. The first draft hoisted it into `renderChips()` / `moreButton`
        // consts — and `parityGateBlindness.test.js` immediately refused, because
        // the JSX then sits LEXICALLY OUTSIDE the legend element and no static
        // proof of containment is possible any more. A helper const is exactly
        // where a chip could later drift out of the legend without any gate
        // seeing it, and the export CSS is the only thing keeping the strip out
        // of every branded newsletter screenshot. Only these three values are
        // shared; the elements themselves stay inside the box that hides them.
        const indChips = crosshairData.chips || EMPTY_CHIPS
        const overflow = !chipsExpanded && indChips.length > CHIP_COLLAPSE_AT
        const foldedFrom = overflow ? CHIP_COLLAPSE_AT : indChips.length
        const moreCount = indChips.length - CHIP_COLLAPSE_AT
        return (
        <div
          ref={legendRef}
          className={`${styles.legend}${legendStacked ? ' ' + styles.legendVertical : ''}${legendFlat ? ' ' + styles.legendFlat : ''}`}
          /* Drop below the index pane so the OHLCV legend never covers it; reserve
             the right price-axis width so a horizontal legend wraps before it (the
             vertical stack is narrow + single-file, so it never needs the reserve). */
          style={{
            ...(overlayBounds ? { top: overlayBounds.top + 6 } : null),
            // max-width (NOT right) so the legend box stays shrink-to-fit for a short
            // row, but a long MA row wraps at the plot's right edge instead of under
            // the axis. 100% = container width; subtract left(8)+gap(6)+axis width.
            ...(!legendStacked && legendAxisReserve > 0
              ? { maxWidth: `calc(100% - ${14 + legendAxisReserve}px)` }
              : null),
          }}
        >
          {legendFlat ? (
            <>
              {/* Values only — the ticker/company/timeframe live in the widget
                  header already, so the strip sits where that title line was. */}
              <div className={styles.flRow}>
                <span className={styles.legendTime} style={legBase}>{formatLegendTime(crosshairData.time)}</span>
                <span className={styles.legendLabel} style={legBase}>O <span className={styles.legendVal} style={legBase}>{crosshairData.open?.toFixed(2)}</span></span>
                <span className={styles.legendLabel} style={legBase}>H <span className={styles.legendVal} style={legBase}>{crosshairData.high?.toFixed(2)}</span></span>
                <span className={styles.legendLabel} style={legBase}>L <span className={styles.legendVal} style={legBase}>{crosshairData.low?.toFixed(2)}</span></span>
                <span className={styles.legendLabel} style={legBase}>C <span className={styles.legendVal} style={legBase}>{crosshairData.close?.toFixed(2)}</span></span>
                <span className={styles.legendLabel} style={legBase}>Chg <span className={styles.legendVal} style={{ color: legChgColor }}>{legUp ? '+' : ''}{crosshairData.change}</span></span>
                <span className={styles.legendLabel} style={legBase}>Chg% <span className={styles.legendVal} style={{ color: legChgColor }}>{legUp ? '+' : ''}{crosshairData.changePct}%</span></span>
                {crosshairData.volume != null && (
                  <span className={styles.legendLabel} style={legBase}>Vol <span className={styles.legendVal} style={legBase}>{formatVolume(crosshairData.volume)}</span></span>
                )}
                {indChips.map((c, i) => (
                  <IndicatorChip
                    key={`${c.instanceId}::${c.plotKey}`}
                    chip={c}
                    className={i >= foldedFrom ? chipStyles.chipFolded : undefined}
                    /* ⛔ RESOLVED PER CHIP, AND PER CHIP MEANS PER (INSTANCE, PLOT).
                       `plotRepaintNotice` answers null unless the LINTER decided
                       this exact column is not clean — so a definition with one
                       repainting column marks that column and leaves its siblings
                       alone, which is the owner's per-plot ruling in the DOM. It is
                       memoised on the definition object, so this is a Map lookup
                       per chip per crosshair move and not a tree walk. */
                    repaint={plotRepaintNotice(engineRegistry.getDefinition(c.defId), c.plotKey)}
                    {...chipHandlers}
                  />
                ))}
                {overflow && (
                  <button type="button" className={chipStyles.chipMore}
                    onClick={() => setChipsExpanded(true)}
                    aria-label={`Show ${moreCount} more indicators`}
                  >+{moreCount}</button>
                )}
                {crosshairData.compare != null && compareSymbol && (
                  <span style={{ color: '#fb923c' }}>
                    {compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%
                  </span>
                )}
                {crosshairData.overlays.map((ov, i) => (
                  <span key={'ov' + i} style={{ color: ov.color }}>{ov.label} <strong>{ov.value?.toFixed(2)}</strong></span>
                ))}
              </div>
            </>
          ) : legendStacked ? (
            <>
              <span className={styles.vlHead} style={legBase}>{formatLegendTime(crosshairData.time)}</span>
              {/* VERTICAL legend variant. All three layouts share `legChgColor` so
                  they can't disagree about the Header day-change colors (fixing one
                  in isolation used to look like a no-op). */}
              <span className={styles.vlChange} style={{ color: legChgColor }}>
                {legUp ? '+' : ''}{crosshairData.change} ({crosshairData.changePct}%)
              </span>
              <span className={styles.vlLabel} style={legBase}>Open</span><span className={styles.vlVal} style={legBase}>{crosshairData.open?.toFixed(2)}</span>
              <span className={styles.vlLabel} style={legBase}>High</span><span className={styles.vlVal} style={legBase}>{crosshairData.high?.toFixed(2)}</span>
              <span className={styles.vlLabel} style={legBase}>Low</span><span className={styles.vlVal} style={legBase}>{crosshairData.low?.toFixed(2)}</span>
              <span className={styles.vlLabel} style={legBase}>Close</span><span className={styles.vlVal} style={legBase}>{crosshairData.close?.toFixed(2)}</span>
              {crosshairData.volume != null && (
                <><span className={styles.vlLabel} style={legBase}>Vol</span><span className={styles.vlVal} style={legBase}>{formatVolume(crosshairData.volume)}</span></>
              )}
              {crosshairData.overlays.flatMap((ov, i) => [
                <span key={'l' + i} className={styles.vlLabel} style={{ color: ov.color }}>{ov.label}</span>,
                <span key={'v' + i} className={styles.vlVal} style={{ color: ov.color }}>{ov.value?.toFixed(2)}</span>,
              ])}
              {indChips.map((c, i) => (
                <IndicatorChip
                  key={`${c.instanceId}::${c.plotKey}`}
                  chip={c}
                  className={`${styles.vlFull}${i >= foldedFrom ? ' ' + chipStyles.chipFolded : ''}`}
                  {...chipHandlers}
                />
              ))}
              {overflow && (
                <button type="button" className={chipStyles.chipMore}
                  onClick={() => setChipsExpanded(true)}
                  aria-label={`Show ${moreCount} more indicators`}
                >+{moreCount}</button>
              )}
              {crosshairData.compare != null && compareSymbol && (
                <span style={{ color: '#fb923c' }}>
                  {compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%
                </span>
              )}
            </>
          ) : (
          <>
          <span className={styles.legendTime} style={legBase}>{formatLegendTime(crosshairData.time)}</span>
          <span className={styles.legendLabel} style={legBase}>O <span className={styles.legendVal} style={legBase}>{crosshairData.open?.toFixed(2)}</span></span>
          <span className={styles.legendLabel} style={legBase}>H <span className={styles.legendVal} style={legBase}>{crosshairData.high?.toFixed(2)}</span></span>
          <span className={styles.legendLabel} style={legBase}>L <span className={styles.legendVal} style={legBase}>{crosshairData.low?.toFixed(2)}</span></span>
          <span className={styles.legendLabel} style={legBase}>C <span className={styles.legendVal} style={legBase}>{crosshairData.close?.toFixed(2)}</span></span>
          {crosshairData.volume != null && (
            <span className={styles.legendLabel} style={legBase}>V <span className={styles.legendVal} style={legBase}>{formatVolume(crosshairData.volume)}</span></span>
          )}
          {/* Same Day-change colors as the header row (Chart Settings -> Header): one
              setting drives both readouts. Unset falls through to the CSS class. */}
          <span
            className={parseFloat(crosshairData.change) >= 0 ? styles.legendUp : styles.legendDown}
            style={(() => {
              const c = parseFloat(crosshairData.change) >= 0
                ? cs.header?.colors?.dayChangeUp
                : cs.header?.colors?.dayChangeDown
              return c ? { color: c } : undefined
            })()}
          >
            {parseFloat(crosshairData.change) >= 0 ? '+' : ''}{crosshairData.change} ({crosshairData.changePct}%)
          </span>
          {crosshairData.overlays.map((ov, i) => (
            <span key={i} style={{ color: ov.color }}>{ov.label} <strong>{ov.value?.toFixed(2)}</strong></span>
          ))}
          {indChips.map((c, i) => (
            <IndicatorChip
              key={`${c.instanceId}::${c.plotKey}`}
              chip={c}
              className={i >= foldedFrom ? chipStyles.chipFolded : undefined}
              {...chipHandlers}
            />
          ))}
          {overflow && (
            <button type="button" className={chipStyles.chipMore}
              onClick={() => setChipsExpanded(true)}
              aria-label={`Show ${moreCount} more indicators`}
            >+{moreCount}</button>
          )}
          {crosshairData.compare != null && compareSymbol && (
            <span style={{ color: '#fb923c' }}>
              {compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%
            </span>
          )}
          </>
          )}
        </div>
        )
      })()}
      <canvas
        ref={vpCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
      />
      {/* Drag-to-measure: transient dashed line + cursor-following readout. */}
      {dragMeasure && (
        <canvas
          ref={dragMeasureCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}
        />
      )}
      {/* Ctrl+drag trendline: transient solid preview line while dragging. */}
      {showDrawingTools && (
        <canvas
          ref={trendDragCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}
        />
      )}
      {/* Custom-Period Sort: translucent highlight band while dragging + a hint banner
          (black canvas / white text to match the Chart Settings menu). */}
      {periodSelect && (<>
        <canvas
          ref={periodSelectCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 6 }}
        />
        <div style={{ position: 'absolute', top: 58, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          background: '#0e0f0d', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '9px 14px',
          boxShadow: '0 12px 32px -14px rgba(0,0,0,0.8)', pointerEvents: 'none', whiteSpace: 'nowrap',
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
          /* Fade out the moment the drag starts so it never blocks the chart. */
          opacity: periodDragging ? 0 : 1, transition: 'opacity 140ms ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#ededed', letterSpacing: '0.01em' }}>Highlight time period</span>
            <button
              type="button"
              onClick={() => onPeriodCancel?.()}
              title="Cancel"
              aria-label="Cancel"
              style={{ pointerEvents: 'auto', border: 'none', background: 'transparent', color: '#c9c9c9',
                fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 0 }}
            >✕</button>
          </div>
          <span style={{ fontSize: 11, color: '#c2c2c2', letterSpacing: '0.01em' }}>Click, hold, and drag across the chart</span>
        </div>
      </>)}
      {/* Replay mode: an "Exit Replay Mode" pill centered in THIS chart's TOOLBAR row
          (the ~30px drawing-toolbar band, between the drawing tools and Indicators) so it
          auto-positions per chart and never sits over the candles. */}
      {(replayCutoff || startMarker) && onExitReplay && (
        <button
          type="button"
          onClick={() => onExitReplay()}
          title="Exit replay mode — restore all bars + clear the start-date line"
          style={{ position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            background: '#c9a84c', color: '#ffffff', border: 'none', borderRadius: 999, padding: '4px 15px',
            font: "700 12px 'Instrument Sans', system-ui, sans-serif", letterSpacing: '0.02em',
            textShadow: '0 1px 3px rgba(0,0,0,0.55)', boxShadow: '0 8px 24px -8px rgba(201,168,76,0.6)',
            whiteSpace: 'nowrap' }}
        >⟲ Exit Replay Mode</button>
      )}
      {/* Go to date (Alt+G): pick a date, the chart scrolls to that session. */}
      {dateJumpOpen && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 30, display: 'flex', gap: 6, alignItems: 'center',
          background: 'rgba(20,22,28,0.96)', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 8, padding: '6px 8px', boxShadow: '0 8px 24px -12px rgba(0,0,0,0.7)' }}>
          <span style={{ font: '11px "Instrument Sans", sans-serif', color: '#c9a84c', letterSpacing: '0.04em' }}>GO TO</span>
          <input
            type="date"
            autoFocus
            onChange={(e) => { if (e.target.value) { jumpToDate(e.target.value); setDateJumpOpen(false) } }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setDateJumpOpen(false) } }}
            onBlur={() => setDateJumpOpen(false)}
            style={{ font: '12px "Instrument Sans", sans-serif', background: '#0c0d10', color: '#e8e6e0', border: '1px solid #333', borderRadius: 5, padding: '3px 6px' }}
          />
        </div>
      )}
      {/* Add-to-watchlist picker (Alt+Q). */}
      {addListOpen && (
        <div
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 30, minWidth: 160, maxHeight: 260, overflowY: 'auto',
            background: 'rgba(20,22,28,0.97)', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px -12px rgba(0,0,0,0.7)' }}
          onMouseLeave={() => setAddListOpen(false)}
        >
          <div style={{ font: '11px "Instrument Sans", sans-serif', color: '#c9a84c', letterSpacing: '0.04em', padding: '2px 6px 6px' }}>ADD {sym} TO…</div>
          {addLists.length === 0 && <div style={{ font: '12px "Instrument Sans", sans-serif', color: '#8a8a8a', padding: '4px 6px' }}>No watchlists</div>}
          {addLists.map(l => (
            <button
              key={l.id}
              type="button"
              onClick={() => addToList(l.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', font: '12.5px "Instrument Sans", sans-serif',
                background: 'transparent', color: '#e8e6e0', border: 0, borderRadius: 5, padding: '6px 8px', cursor: 'pointer' }}
              onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(201,168,76,0.12)' }}
              onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent' }}
            >{l.name || l.title || `List ${l.id}`}</button>
          ))}
        </div>
      )}
      {/* Brief action toast (add-to-list, alert). */}
      {chartToast && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          font: '600 12px "Instrument Sans", sans-serif', background: 'rgba(20,22,28,0.96)', color: '#e8e6e0',
          border: '1px solid rgba(201,168,76,0.4)', borderRadius: 8, padding: '7px 14px', pointerEvents: 'none' }}>
          {chartToast}
        </div>
      )}
      {(dragMeasure || periodSelect) && measureReadout && (
        <div style={{
          position: 'absolute',
          left: measureReadout.x, top: measureReadout.y,
          /* Positive/up move → readout sits top-left of the crosshair; negative/down
             move → bottom-right. Keeps it clear of the measure line either way. */
          transform: measureReadout.pct >= 0
            ? 'translate(calc(-100% - 12px), calc(-100% - 12px))'
            : 'translate(12px, 12px)',
          pointerEvents: 'none', zIndex: 6, whiteSpace: 'nowrap',
          fontFamily: "'Instrument Sans', system-ui, sans-serif", fontSize: 12, lineHeight: 1.35,
          /* Plain text on the canvas — no chip, no glow — so it reads like every
             other on-chart readout. Legibility comes from the colors themselves
             (the secondary line darkens on a light canvas, below). */
        }}>
          {/* Follows the chart's up/down candle colors (measureColors) — the
              readout is a measurement OF the candles, so a custom candle palette
              carries through instead of a hardcoded green/red. */}
          <div style={{ fontWeight: 700, color: measureReadout.pct >= 0 ? measureColors.up : measureColors.down }}>
            {measureReadout.dollar >= 0 ? '+' : '-'}${Math.abs(measureReadout.dollar).toFixed(2)}
            <span style={{ marginLeft: 8 }}>
              ({measureReadout.pct >= 0 ? '+' : ''}{measureReadout.pct.toFixed(2)}%)
            </span>
          </div>
          <div style={{ color: axisAuto.light ? '#3f4a57' : '#a8a290', fontSize: 11 }}>
            {measureReadout.bars} {measureReadout.bars === 1 ? 'bar' : 'bars'}{measureReadout.span ? ` · ${measureReadout.span}` : ''}
          </div>
        </div>
      )}
      {showRangeSelector && chartReady && filteredBars?.length > 1 && (
        <div ref={rangeBarRef} className={styles.rangeBar}>
          {RANGE_OPTS.map(([label, val], i) => (
            <button
              key={label + i}
              type="button"
              className={styles.rangeBtn}
              title={`Show ${label} of price history`}
              onClick={() => applyRange(val)}
            >{label}</button>
          ))}
        </div>
      )}
      {/* Volume-pane legend (top-left): dollar volume + average volume over the MA
          period. Follows the crosshair (or the latest bar), pinned live to the top
          of the volume pane. */}
      {showVolLegend && cs.volume?.labelVisible !== false && chartReady && crosshairData && (crosshairData.dollarVol != null || crosshairData.volAvg != null) && (
        <div ref={volLegendRef} className={styles.volLegend}>
          {crosshairData.dollarVol != null && (
            <span className={styles.volLegItem}>
              <span className={styles.volLegLabel}>$ Vol</span>
              <span className={styles.volLegVal}>{formatDpNotional(crosshairData.dollarVol)}</span>
            </span>
          )}
          {crosshairData.volAvg != null && crosshairData.volMaPeriod && (
            <span className={styles.volLegItem}>
              <span className={styles.volLegLabel}>Avg {crosshairData.volMaPeriod}D</span>
              <span className={styles.volLegVal}>{formatVolume(crosshairData.volAvg)}</span>
            </span>
          )}
        </div>
      )}
      {!disablePatterns && bars?.length > 0 && (
        <PatternOverlay
          chart={chartRef.current}
          series={candleSeriesRef.current}
          containerRef={containerRef}
          detections={patternDetections}
          enabled={showPatterns}
          onDetectionClick={setActiveDetection}
        />
      )}
      {/* Read-only saved-drawings layer (multi-chart grid cells): the member's
          per-symbol drawings render but can't be edited — same NOOP recipe as
          the Model Book staticAnnotations layer below. */}
      {showSavedDrawings && !showDrawingTools && !cs.hideDrawings && bars?.length > 0 && drawings.length > 0 && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            activeTool={null}
            setActiveTool={NOOP}
            color={drawColor}
            lineWidth={drawWidth}
            drawings={drawings}
            addDrawing={NOOP}
            updateDrawing={NOOP}
            removeDrawing={NOOP}
            selectedId={null}
            setSelectedId={NOOP}
            readOnly
          />
        </div>
      )}
      {showDrawingTools && bars?.length > 0 && (
        <>
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            lineStyle={cs.drawingDefaults?.style || 'solid'}
            fontSize={cs.drawingDefaults?.fontSize ?? 13}
            magnet={magnet}
            drawings={cs.hideDrawings ? [] : drawings}
            addDrawing={addDrawing}
            updateDrawing={updateDrawing}
            removeDrawing={removeDrawing}
            reorderDrawing={reorderDrawing}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
            undo={undo}
            redo={redo}
            snapshotHistory={snapshotHistory}
            onSaveDefaults={(d) => handleUpdateChartSettings({ ...cs, drawingDefaults: { ...cs.drawingDefaults, ...d } })}
            onSetAlert={handleSetDrawingAlert}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
          />
          <ChartToolbar
            ref={toolbarRef}
            /* ⭐ THE `instance_id` PRODUCER (Phase C Task 15). Task 10 shipped
               the column, the API field, the label and the deletion guard and
               left them without one, because the only surface that could supply
               a chart instance is the alert popover and the popover is mounted
               from here. This is the SAME list the binder was handed (written in
               `updateChart`), so the popover can never offer an instance this
               chart is not drawing. */
            chartInstances={engineInstancesRef.current}
            /* ⭐ WHICH CHART (Phase C Task 12) — see the `chartId` prop. */
            chartId={chartId}
            /* ⭐ THE WINDOW THE USER SEES (Phase D Task 13) — the concierge's
               compute stage runs on these. Same array the chart is drawing. */
            bars={bars}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            color={drawColor}
            setColor={setDrawColor}
            lineWidth={drawWidth}
            setLineWidth={setDrawWidth}
            hasSelection={!!selectedId}
            onDelete={() => { removeDrawing(selectedId); setSelectedId(null) }}
            onClearAll={clearAll}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            drawingCount={drawings.length}
            repeatMode={repeatMode}
            setRepeatMode={handleSetRepeatMode}
            magnet={magnet}
            setMagnet={setMagnet}
            chartSettings={cs}
            volumePaneFixed={volumePaneFixed}
            onUpdateSettings={handleUpdateChartSettings}
            /* Charts workspace has the new settings modal (onOpenSettings) — drop
               the legacy V1 toolbar gear + its inline panel there. Other surfaces
               (no modal) keep it as their only settings entry point. */
            hideSettingsButton={!!onOpenSettings}
            showExtended={isIntraday && !hideExtHoursToolbarToggle ? showExtended : null}
            onToggleExtended={isIntraday && !hideExtHoursToolbarToggle ? handleToggleExtended : null}
            onScreenshot={() => setScreenshotPopoverOpen(true)}
            onShowHelp={() => setHelpOpen(true)}
            tf={resolvedTf}
            currentSym={sym}
            compareSymbol={compareSymbol}
            onCompareChange={onCompareChange}
            replayMode={replayMode}
            replayPlaying={replayPlaying}
            replaySpeed={replaySpeed}
            replayDate={replayMode && filteredBars?.length ? filteredBars[filteredBars.length - 1]?.t : null}
            replayIndex={replayIndex ?? 0}
            replayTotal={sessionBars?.length || 0}
            onReplayToggle={() => {
              if (replayMode) {
                setReplayMode(false)
                setReplayPlaying(false)
                setReplayIndex(null)
              } else {
                setReplayMode(true)
                setReplayPlaying(false)
                setReplayIndex(Math.floor((sessionBars?.length || 1) * 0.7))
              }
            }}
            onReplayPlayPause={() => setReplayPlaying(p => !p)}
            onReplayStep={dir => {
              setReplayPlaying(false)
              setReplayIndex(i => {
                const max = (sessionBars?.length || 1) - 1
                return Math.max(0, Math.min(max, (i ?? 0) + dir))
              })
            }}
            onReplayIndexChange={idx => {
              setReplayPlaying(false)
              const max = (sessionBars?.length || 1) - 1
              setReplayIndex(Math.max(0, Math.min(max, idx)))
            }}
            onReplaySpeedChange={setReplaySpeed}
            showPatterns={showPatterns}
            onTogglePatterns={handleTogglePatterns}
            hideReplay={hideReplay}
            hidePatterns={hidePatterns || disablePatterns}
            hideCompare={hideCompare}
            hideCountdown={hideCountdown}
          />
          {screenshotPopoverOpen && (
            <ScreenshotPopover
              onDownload={handleDownload}
              onCopy={handleCopyImage}
              onShare={handleCopyShareUrl}
              onClose={() => setScreenshotPopoverOpen(false)}
            />
          )}
          {activeTool === 'position' && (
            <PositionPanel
              entry={positionTool.entry}
              stop={positionTool.stop}
              target={positionTool.target}
              accountSize={cs.positionCalc?.accountSize ?? 50000}
              riskPct={cs.positionCalc?.riskPct ?? 1}
              onChange={({ entry, stop, target }) => setPositionTool(p => ({ ...p, entry, stop, target }))}
              onConfigChange={({ accountSize, riskPct }) =>
                handleUpdateChartSettings({
                  ...cs,
                  positionCalc: { accountSize, riskPct },
                })
              }
              onClear={() => setPositionTool(p => ({ ...p, entry: '', stop: '', target: '' }))}
              onClose={() => setActiveTool(null)}
            />
          )}
        </>
      )}

      {/* Per-setup annotations (Model Book). Separate from the normal drawing
          tools (Model Book runs with showDrawingTools=false). Read-only by
          default — activeTool=null makes the overlay canvas pointer-transparent
          so the focus zoom still works underneath. The wrapper fades the whole
          layer in/out as the chart zooms onto / away from the setup. */}
      {annotations != null && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div
          style={overlayWrapStyle({
            zIndex: 4,
            opacity: annotationsVisible ? annotationsOpacity : 0,
            transition: 'opacity 150ms ease',
            pointerEvents: annotationsEditable ? 'auto' : 'none',
          })}
        >
          <ChartDrawingOverlay
            readOnly={!annotationsEditable}
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            hidePriceLabels
            redrawHandleRef={annRedrawRef}
            textFadeRef={annotationsEditable ? null : textFadeRef}
            fadeWholeLayer={!annotationsEditable && annotationsFadeWhole}
            activeTool={annotationsEditable ? activeTool : null}
            setActiveTool={setActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            lineStyle={drawLineStyle}
            fontSize={drawFontSize}
            magnet={magnet}
            drawings={annotations}
            addDrawing={annAdd}
            updateDrawing={annUpdate}
            removeDrawing={annRemove}
            onMigrate={onAnnotationsMigrate}
            selectedId={annotationsEditable ? selectedId : null}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
          />
          {annotationsEditable && (
            <ChartToolbar
              chartInstances={engineInstancesRef.current}
              chartId={chartId}
              bars={bars}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              color={drawColor}
              setColor={setDrawColor}
              lineWidth={drawWidth}
              setLineWidth={setDrawWidth}
              hasSelection={!!selectedId}
              onDelete={() => { annRemove(selectedId); setSelectedId(null) }}
              onClearAll={annClear}
              drawingCount={annotations.length}
              repeatMode={repeatMode}
              setRepeatMode={handleSetRepeatMode}
              chartSettings={cs}
              volumePaneFixed={volumePaneFixed}
              onUpdateSettings={handleUpdateChartSettings}
              hideSettingsButton={!!onOpenSettings}
              lineStyle={drawLineStyle}
              setLineStyle={setAnnLineStyle}
              fontSize={drawFontSize}
              setFontSize={setAnnFontSize}
              magnet={magnet}
              setMagnet={setMagnet}
              prominent
              hideReplay
              hidePatterns
              hideCompare
              hideCountdown
            />
          )}
        </div>
      )}
      {/* Stock-level annotations (Model Book): an always-on, read-only layer drawn
          on the full-year view, independent of any setup (text never fades). */}
      {staticAnnotations != null && staticAnnotations.length > 0 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <ChartDrawingOverlay
            readOnly
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            activeTool={null}
            setActiveTool={NOOP}
            color={drawColor}
            lineWidth={drawWidth}
            drawings={staticAnnotations}
            addDrawing={NOOP}
            updateDrawing={NOOP}
            removeDrawing={NOOP}
            selectedId={null}
            setSelectedId={NOOP}
          />
        </div>
      )}
      {/* Index-pane annotations (Model Book): GLOBAL measure marks on the ^IXIC
          line — read-only for everyone, a measure-only toolbar for admins.
          Bound to the index pane (indexPaneSeriesRef + its measured box) so the
          Y coords map to the top pane, not the price pane. */}
      {/* NOTE: gated on the (stable) measured bounds, NOT indexPaneSeries.length — the
          global Nasdaq marks stay put while flipping tickers. The index pane + line
          persist through a ticker switch (the index effect keeps them mounted on an
          empty-data frame), so requiring length>0 here only caused the overlay to
          unmount/remount on each switch = a blink. Bounds stay measured across the
          switch, so the canvas survives and just redraws as the chart reframes. */}
      {indexAnnotations != null && indexPaneSymbol && indexOverlayBounds
        && (indexAnnotationsEditable || indexAnnotations.length > 0) && (
        <div style={indexOverlayWrapStyle({ zIndex: 4, pointerEvents: indexAnnotationsEditable ? 'auto' : 'none' })}>
          <ChartDrawingOverlay
            readOnly={!indexAnnotationsEditable}
            chartRef={chartRef}
            seriesRef={indexPaneSeriesRef}
            bars={bars}
            lineData={indexPaneSeries}
            hidePriceLabels
            activeTool={indexAnnotationsEditable ? indexActiveTool : null}
            setActiveTool={setIndexActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            lineStyle={drawLineStyle}
            fontSize={drawFontSize}
            magnet={magnet}
            drawings={indexAnnotations}
            addDrawing={idxAnnAdd}
            updateDrawing={idxAnnUpdate}
            removeDrawing={idxAnnRemove}
            selectedId={indexAnnotationsEditable ? indexSelectedId : null}
            setSelectedId={setIndexSelectedId}
            repeatMode={repeatMode}
          />
          {indexAnnotationsEditable && (
            <ChartToolbar
              chartInstances={engineInstancesRef.current}
              chartId={chartId}
              bars={bars}
              activeTool={indexActiveTool}
              setActiveTool={setIndexActiveTool}
              color={drawColor}
              setColor={setDrawColor}
              lineWidth={drawWidth}
              setLineWidth={setDrawWidth}
              hasSelection={!!indexSelectedId}
              onDelete={() => { idxAnnRemove(indexSelectedId); setIndexSelectedId(null) }}
              onClearAll={idxAnnClear}
              drawingCount={indexAnnotations.length}
              repeatMode={repeatMode}
              setRepeatMode={handleSetRepeatMode}
              chartSettings={cs}
              volumePaneFixed={volumePaneFixed}
              onUpdateSettings={handleUpdateChartSettings}
              hideSettingsButton={!!onOpenSettings}
              magnet={magnet}
              setMagnet={setMagnet}
              toolFilter={['cursor', 'advance']}
              prominent
              hideReplay
              hidePatterns
              hideCompare
              hideCountdown
            />
          )}
        </div>
      )}
      {/* Custom-Period Sort: thin gold vertical line marking the sort's START date,
          full chart height. Spans price + volume panes; rides the time axis on pan/zoom. */}
      {startMarker && bars?.length > 0 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
          <ChartVLineOverlay chartRef={chartRef} seriesRef={candleSeriesRef} bars={bars} date={startMarker} color="#c9a84c" />
        </div>
      )}
      {/* Catalyst callouts (Model Book): labels in blank space + leader lines. */}
      {/* Wait for the price-pane box to be measured before mounting the callout
          overlay on an index-pane chart, so labels are placed with the correct
          bounds from the first paint (no first-click jump). */}
      {callouts != null && callouts.length > 0 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <ChartCalloutOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            callouts={callouts}
            bottomFrac={overlayBounds ? 0.96 : 0.82}
          />
        </div>
      )}
      {/* Setup-to-setup % advance labels (Model Book): "+X%" above each setup
          candle showing the move from the previous setup. */}
      {setupMoves != null && setupMoves.length > 1 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <SetupMoveOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            setups={setupMoves}
          />
        </div>
      )}
      {/* Index pane label — top-left of the pane (replaces the floating last-value box). */}
      {indexPaneSymbol && indexPaneSeries.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 4, left: 10, zIndex: 5, pointerEvents: 'none',
            font: '600 11px "Instrument Sans", system-ui, sans-serif',
            letterSpacing: '0.04em', color: cs.watermark.color, opacity: 0.85,
            textShadow: '0 0 3px rgba(0,0,0,0.85)',
          }}
        >
          {indexPaneLabel || String(indexPaneSymbol).replace(/^\^/, '')}
        </div>
      )}
      <KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <PatternSidePanel
        detection={activeDetection}
        onClose={() => setActiveDetection(null)}
      />
    </div>
  )
}
