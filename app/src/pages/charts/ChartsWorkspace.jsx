import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import useMediaQuery from '../../hooks/useMediaQuery'
import useChartLayouts from '../../hooks/useChartLayouts'
import { useAuth } from '../../context/AuthContext'
import UIcon from '../../components/ui/UIcon'
import { WorkspaceContext } from './WorkspaceContext'
import { WATCHLIST_DEFAULTS, watchlistDefaultsForTheme } from '../watchlist/watchlistSettings'
import { THEME_TRACKER_DEFAULTS, mergeThemeTrackerSettings, themeTrackerDefaultsForTheme } from '../theme-tracker/themeTrackerSettings'
import { FUNDAMENTALS_DEFAULTS, mergeFundamentalsSettings, fundamentalsDefaultsForTheme } from './widgets/fundamentalsSettings'
import { BREADTH_WIDGET_DEFAULTS, mergeBreadthWidgetSettings, breadthDefaultsForTheme } from './widgets/breadthWidgetSettings'
import { mergeChartSettings, CHART_DEFAULTS, chartDefaultsForTheme } from '../../components/chart/chartDefaults'
import { dividerFor, chromeFor, panelFor, toolbarFor } from '../../utils/dividerColor'
import { widgetOwnChrome } from './widgetChrome'
import MergedSeamOverlay from './MergedSeamOverlay'
import WidgetHost from './WidgetHost'
import MobileWorkspace from './widgets/MobileWorkspace'
import { findPlacement } from './findOpenSlot'
import MultiChartGrid from './grid/MultiChartGrid'
import MultiChartMenu from './grid/MultiChartMenu'
import useMultiChartState from './grid/useMultiChartState'
import PopoutWindow from './popout/PopoutWindow'
import PopoutShell from './popout/PopoutShell'
import { useJournalToast, JournalToast } from '../journal-2-0/lib/useJournalToast'
import { readChartsLink, stripChartsLink } from '../../lib/chartDeepLink'
import PoppedLayout from './popout/PoppedLayout'
import PeriodSortPanel from './PeriodSortPanel'
import FloatingWidgetPanel from './FloatingWidgetPanel'
import CompareSymbolsPanel from './CompareSymbolsPanel'
import PeriodSortConfig from './PeriodSortConfig'
import ReplayPanel from './ReplayPanel'
import { addWidgetTab } from './widgetTabs'
import { computeRowHeight as rowHeightFor, FIXED_ROWS as _FIXED_ROWS, MARGIN_Y as _MARGIN_Y, BODY_PAD as _BODY_PAD } from './rowHeight'
import { WIDGET_REGISTRY, WORKSPACE_MENU_TYPES, labelMap } from '../../widgets/registry'
import styles from './ChartsWorkspace.module.css'

const ResponsiveGridLayout = WidthProvider(Responsive)


// 24-col grid (doubled from the original 12) so widgets can size in half-of-the-
// old-column steps — e.g. the Theme widget now has a width between the old "1 col
// (too thin)" and "2 cols". Every breakpoint is doubled in lockstep so relative
// sizing is unchanged; legacy 12-col saved layouts are migrated in parseLayout().
const GRID_COLS = 24
// EVERY breakpoint uses the SAME column count on purpose — do not re-introduce a
// narrowing ladder (md:20, sm:12, …). We persist ONE arrangement (layout.widgets),
// so a breakpoint whose col count differs made RGL re-map x/w to fit the narrower
// grid, fire onLayoutChange with those squeezed coords, and handleLayoutChange
// persisted them over the only layout we keep — permanently destroying it. Widening
// the window back could never restore it (the original x/w were gone), which is why
// widgets stayed bunched in the left of a maximized window after a shrink.
// With cols constant, a resize only changes colWidth (containerWidth / 24), so widgets
// scale proportionally and land back exactly where they were. This mirrors how
// rowHeight already scales vertically via the ResizeObserver below.
const COLS = { lg: GRID_COLS, md: GRID_COLS, sm: GRID_COLS, xs: GRID_COLS, xxs: GRID_COLS }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const FIXED_ROWS = _FIXED_ROWS   // viewport-locked row count (see ./rowHeight.js)
const MARGIN_Y = _MARGIN_Y       // px gap between widgets vertically
const BODY_PAD = _BODY_PAD       // px padding around the grid (matches .workspaceBody)

// New users (and Reset) land on an EMPTY workspace + the "get started" panel.
// Their most recent arrangement is persisted and restored on every later visit.
const DEFAULT_LAYOUT = {
  widgets: [],
  cols: GRID_COLS,
}

// The classic watchlist + chart + themes arrangement, offered as a one-click
// "Starter layout" on the get-started panel.
const STARTER_LAYOUT = {
  widgets: [
    { id: 'w-watchlist', type: 'watchlist', color: 'A', x: 0, y: 0, w: 4,  h: 7,  opts: {} },
    { id: 'w-chart',     type: 'chart',     color: 'A', x: 4, y: 0, w: 20, h: 20, opts: { tf: 'D' } },
    { id: 'w-themes',    type: 'themes',    color: 'B', x: 0, y: 7, w: 4,  h: 13, opts: {} },
  ],
  cols: GRID_COLS,
}

// ── LOCKED "UCT Default" template ──────────────────────────────────────────
// The canonical starting workspace, FROZEN in code. Clicking "UCT Default" under
// Open Layout loads these constants into the working board; applying never writes
// back to them, so nothing a user does in the app can mutate the default — only a
// code edit here can. To officially update the default, re-capture the owner's
// live layout + chart_settings and replace the two constants below.
//
// Option A (owner decision 2026-07-19): the layout SHELL (widget positions/sizes/
// types) + ALL chart settings are baked in; tickers/theme CONTENT load live/
// personal each time (color groups are left untouched on apply).
const UCT_DEFAULT_LAYOUT = {
  widgets: [
    { id: 'uctd-themes',       type: 'themes',       color: 'A', x: 0,  y: 0,  w: 3,  h: 20, opts: {} },
    { id: 'uctd-chart',        type: 'chart',        color: 'A', x: 3,  y: 0,  w: 17, h: 17, opts: {} },
    { id: 'uctd-fundamentals', type: 'fundamentals', color: 'A', x: 3,  y: 17, w: 17, h: 3,  opts: {} },
    { id: 'uctd-watchlist',    type: 'watchlist',    color: 'A', x: 20, y: 0,  w: 4,  h: 11, opts: {} },
    { id: 'uctd-aisearch',     type: 'aisearch',     color: 'A', x: 20, y: 11, w: 4,  h: 9,  opts: {} },
  ],
  cols: GRID_COLS,
}

// The exact chart_settings that are PART of the frozen default (captured from the
// owner's live workspace). JSON.parse keeps it byte-faithful; it's the full blob
// so applying it fully defines the chart look (header shows ticker + company via
// titleMode 'both'). Parsed fresh so the frozen source is never mutated in place.
//
// ⭐⭐ B5 TASK 9 RETIRED ENUMERATION SITE #22 (ledger row 14). This literal used
// to hand-list all FIFTEEN indicator sections — a third copy of ledger sites #1
// and #2, in a page component, and the one no chart-module walk had opened. All
// fourteen legacy sections are DELETED from it; `volumeProfile` alone survives,
// because it is the one key `mergeChartSettings` still emits.
//
// ⛔ THE DELETION IS BEHAVIOUR-NEUTRAL AND THAT WAS MEASURED, NOT ASSUMED: every
// one of the fourteen said `"enabled":false` in this capture, so the v1→v2 fold
// produced zero instances from them before the deletion and produces zero after.
// What changes is that the blob this writes stops being a fifteen-section list
// somebody has to remember to edit.
//
// Never write this to `chart_settings` directly: go through
// `uctDefaultChartSettings()` below, which stamps the engine keys the capture
// predates. See the comment there for why that is a ship-blocker and not a
// tidy-up.
const UCT_DEFAULT_CHART_SETTINGS_JSON = '{"chartType":"candles","candles":{"upColor":"#1ae51a","downColor":"#c41f2d","upBorder":"#1ae51a","downBorder":"#c41f2d","upWick":"#1ae51a","downWick":"#c41f2d","oneColor":"#1ae51a"},"candleColorMode":"netchange","background":"#0f0f0f","bgMode":"solid","bgGradient":{"top":"#001e5a","bottom":"#ffffff"},"textColor":"#cfcfcf","textSize":11,"grid":{"color":"#ffffff08","visible":true},"crosshair":{"color":"#9a9a9a","style":1,"width":1,"magnet":false},"header":{"titleMode":"both","showChange":true,"timeframes":["5","15","30","D","W","1","M","60"],"customTimeframes":[],"showMarketCap":true,"showNextEarnings":true,"showUctRating":true,"showLegend":true,"colors":{"dayChange":"#1ae51a","legend":"#cfcfcf","dayChangeUp":"#1ae51a","dayChangeDown":"#c41f2d","marketCap":"#c9a84c","nextEarnings":"#6dc9c0","uctRating":"#1ae51a"}},"overlays":[{"enabled":true,"type":"EMA","period":9,"color":"#4ade80"},{"enabled":true,"type":"EMA","period":20,"color":"#f472b6"},{"enabled":true,"type":"SMA","period":50,"color":"#60a5fa"},{"enabled":true,"type":"SMA","period":200,"color":"#fb923c"}],"volume":{"visible":true,"upColor":"#1ae51a","downColor":"#c41f2d","hvcEnabled":true,"separatePane":false,"paneHeightPct":22},"watermark":{"visible":true,"opacity":0.5176470588235295,"color":"#ffffff","sizeScale":1,"lines":{"ticker":true,"company":true,"sector":true,"industry":true,"theme":true},"x":0.5,"y":0.5},"drawingDefaults":{"color":"#c9a84c","width":1},"indicators":{"volumeProfile":{"enabled":false,"bins":24,"color":"rgba(120,160,100,0.25)","pocColor":"rgba(200,160,40,0.65)"}},"swingLabels":{"enabled":true,"sensitivity":"low","color":"#000000","tintByType":true,"upColor":"#cfcfcf","downColor":"#cfcfcf","bgEnabled":false,"bg":"#ffffff"},"heikinAshi":false,"logScale":false,"percentScale":false,"comparisonSymbols":[],"markers":{"earnings":true,"splits":false,"dividends":false,"news":false,"earningsBeat":"#1ae51a","earningsMiss":"#c41f2d"},"countdown":false,"showPatterns":false,"hideDrawings":false,"extendedHoursShading":false,"volumeOverlayIndicators":[],"theme":"dark","positionCalc":{"accountSize":50000,"riskPct":1},"preset":"custom"}'

// ── THE FROZEN CAPTURE MUST NOT FREEZE AN ENGINE KEY ────────────────────────
//
// `UCT_DEFAULT_CHART_SETTINGS_JSON` was captured from the owner's live workspace
// in July, so it contains no engine keys at all — the engine did not exist yet.
// Three first-class actions write this blob verbatim into the `chart_settings`
// preference: **Open Layout → UCT Default**, **New Layout**, and `applyTemplate`'s
// prebuilt fallback. So whatever this function does NOT stamp from the live
// default is pinned, forever, for everyone who clicks a menu item.
//
// `indicatorInstances` is therefore stamped from `CHART_DEFAULTS` at write time
// rather than frozen alongside the palette. It resets to the default empty list on
// purpose — this IS the immutable restore point, and a restore that left the
// previous board's instances behind would not be one.
//
// ⭐ B5 TASK 4 — THE SECOND STAMP IS GONE, AND SO IS THE SHIP-BLOCKER IT ANSWERED.
//
// A line `parsed.engineEnabled = CHART_DEFAULTS.engineEnabled` stood beside this
// one, and the paragraph above it explained a real Flip-B hazard: because
// `mergeChartSettings` read the flag from the PARSED BLOB and not from the
// default, an absent key and an explicit `false` were the same answer, so a user
// who clicked **UCT Default** landed on a workspace where the flag was pinned off,
// no legacy block drew, and RSI / MACD / BB / VWAP were undrawable.
//
// The flag is DELETED (`docs/decisions/2026-08-04-engine-enabled-deleted.md`), so
// there is nothing to stamp and nothing to pin. ⚠️ THE DELETION HAD TO BE THIS —
// removing the line, not assigning `undefined` to it. `JSON.stringify` DROPS an
// `undefined` value, so `parsed.engineEnabled = CHART_DEFAULTS.engineEnabled` with
// the key gone would have produced a byte-identical string and passed every test
// that reads the OUTPUT. Only a source scan can see the difference, which is why
// `engineEnabledMigration.test.js` runs one.
//
// ⭐⭐ B5 TASK 9 — `settingsVersion` IS STAMPED FOR THE SAME REASON, and it is the
// reason the fourteen sections could be deleted from the capture rather than
// merely ignored. The capture is v1 shaped (it predates versioning), so without
// a stamp every click of **UCT Default** would write a blob the read-time fold
// re-runs on — harmless while the capture's indicators are all off, and a
// resurrection machine the moment anybody edits the literal. Stamping the
// CURRENT version says "this blob is already in the new shape", which is true:
// it carries `indicators: {volumeProfile}` and an empty instance list, which is
// exactly what `mergeChartSettings` emits.
export function uctDefaultChartSettings() {
  const parsed = JSON.parse(UCT_DEFAULT_CHART_SETTINGS_JSON)
  parsed.indicatorInstances = Array.isArray(CHART_DEFAULTS.indicatorInstances)
    ? [...CHART_DEFAULTS.indicatorInstances]
    : []
  parsed.settingsVersion = CHART_DEFAULTS.settingsVersion
  return JSON.stringify(parsed)
}

// Widths/minW are in 24-col units (2 units = one old column). The values live
// on the widget registry (src/widgets/registry.js, pinned by registry.test.js);
// this is the id→defaults view the grid math below reads.
const WIDGET_DEFAULTS = Object.fromEntries(
  Object.entries(WIDGET_REGISTRY).map(([id, w]) => [id, w.defaults]),
)

// A blocked window.open returns null with no error, so this is the only way the
// user learns why their board didn't appear on the other monitor.
const POPUP_BLOCKED_MSG = 'Your browser blocked the pop-out window. Allow pop-ups for this site, then try again.'

// Docking makes room by SPLITTING an existing widget in two: `candidate` keeps the top
// half, the docked widget takes the bottom half (same column). Returns the adjusted
// widget list + the placement, or null if the candidate can't shrink below its min.
function splitToFit(widgets, defaults, candidate) {
  if (!candidate) return null
  const candMin = (WIDGET_DEFAULTS[candidate.type]?.minH) || 2
  const newH = Math.max(defaults.minH, Math.min(defaults.h, Math.floor(candidate.h / 2)))
  const shrunkH = candidate.h - newH
  if (shrunkH < candMin) return null
  const w = Math.max(defaults.minW, Math.min(defaults.w, candidate.w))
  return {
    widgets: widgets.map(x => (x.id === candidate.id ? { ...x, h: shrunkH } : x)),
    place: { x: candidate.x, y: candidate.y + shrunkH, w, h: newH },
  }
}

// Horizontal split: place the new widget to the LEFT of `candidate`, at its FULL height,
// shrinking the candidate to the right. Docking the Custom-Period Sort beside a full-screen
// chart should sit it on the LEFT with the chart on the right (owner preference), not stack
// it below. Returns null if the candidate can't spare the width.
function splitToSide(widgets, defaults, candidate) {
  if (!candidate) return null
  const candMinW = (WIDGET_DEFAULTS[candidate.type]?.minW) || 2
  const newW = Math.max(defaults.minW, Math.min(defaults.w, Math.floor(candidate.w / 2)))
  const shrunkW = candidate.w - newW
  if (shrunkW < candMinW) return null
  return {
    widgets: widgets.map(x => (x.id === candidate.id ? { ...x, x: candidate.x + newW, w: shrunkW } : x)),
    place: { x: candidate.x, y: candidate.y, w: newW, h: candidate.h },
  }
}

// NOTE: 'periodsort' is intentionally NOT in the Add Widget menu — it's reachable
// only from Tools → Custom-Period Sort (dock / add-as-tab). Membership + labels
// derive from the widget registry (menus.workspace: false keeps it out of the
// menu; it stays registered so docked instances render).
const WIDGET_TYPES = WORKSPACE_MENU_TYPES
const WIDGET_LABELS = labelMap('menu')

function parseLayout(raw) {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed?.widgets && Array.isArray(parsed.widgets)) {
      // Migrate legacy 12-col layouts to the 24-col grid. Detected by the
      // absence of the cols:GRID_COLS marker (old saves have cols:12 or none).
      // Double x AND w so every widget keeps its exact on-screen position + size,
      // then stamp the new marker so this runs exactly once per user.
      let widgets = parsed.widgets
      let cols = parsed.cols
      if (cols !== GRID_COLS) {
        widgets = widgets.map(w => ({
          ...w,
          x: (w.x || 0) * 2,
          w: Math.max(2, (w.w || 2) * 2),
        }))
        cols = GRID_COLS
      }
      // Auto-fit legacy layouts (h values < ~5) saved before the viewport-lock
      // change so they don't appear tiny on resume. Detect by checking if max
      // y+h is well below FIXED_ROWS — scale all h values up uniformly.
      const maxBottom = widgets.reduce((m, w) => Math.max(m, (w.y || 0) + (w.h || 0)), 0)
      if (maxBottom > 0 && maxBottom <= FIXED_ROWS / 2) {
        const scale = Math.floor(FIXED_ROWS / maxBottom)
        if (scale > 1) {
          widgets = widgets.map(w => ({
            ...w,
            y: (w.y || 0) * scale,
            h: Math.max(4, (w.h || 4) * scale),
          }))
        }
      }
      return { ...parsed, widgets: clampWidgetsToRows(widgets), cols }
    }
  } catch {}
  return null
}

// Keep every widget FULLY within the viewport-locked grid — no widget may hang
// off any edge. The body is overflow:hidden, so an overhang just vanishes (the
// fundamentals-widget bug), and a widget shoved below FIXED_ROWS by a neighbor
// disappears off the bottom. This clamps BOTH axes: x/w to the column count and
// y/h to the row count, shrinking to fit after first clamping the origin so at
// least the min size survives. Applied on load, add, template-open, seam-resize,
// and every RGL layout change before persist — the single guarantee that nothing
// leaves the visible canvas.
function clampWidgetsToRows(widgets) {
  return widgets.map(w => {
    const def = WIDGET_DEFAULTS[w.type] || {}
    const minH = def.minH || 3
    const minW = def.minW || 2
    // Horizontal (columns).
    const x = Math.max(0, Math.min(w.x || 0, GRID_COLS - minW))
    let cw = Math.max(minW, Math.min(w.w || minW, GRID_COLS))
    if (x + cw > GRID_COLS) cw = GRID_COLS - x  // x ≤ GRID_COLS-minW ⇒ cw ≥ minW
    // Vertical (rows).
    const y = Math.max(0, Math.min(w.y || 0, FIXED_ROWS - minH))
    let h = Math.max(minH, Math.min(w.h || minH, FIXED_ROWS))
    if (y + h > FIXED_ROWS) h = FIXED_ROWS - y  // y ≤ FIXED_ROWS-minH ⇒ h ≥ minH
    return { ...w, x, y, w: cw, h }
  })
}

// tallest / widest widget in a list — used to pick which one yields space when a
// new widget can't find a free slot (make-room strategies below).
const tallestOf = (arr) => (arr || []).reduce((a, b) => (!a || b.h > a.h ? b : a), null)
const widestOf  = (arr) => (arr || []).reduce((a, b) => (!a || b.w > a.w ? b : a), null)

// Reserve a full-width strip across the BOTTOM of the grid for a newcomer of
// height `needH`, shrinking every widget that crosses into the strip up so its
// bottom rests at the cut line. This is the "add a fundamentals widget when the
// grid is full" case: instead of the newcomer landing off the bottom, the chart
// (and anything else reaching the bottom) shrinks up to open a full-width slot.
// Returns { widgets, place } or null when it can't be done cleanly (a widget
// would fall below its min, or one already sits inside the strip) — caller then
// falls back to a single-widget split.
function reserveBottomStrip(widgets, needH, cols) {
  const stripH = Math.max(1, Math.min(needH, FIXED_ROWS - 1))
  const cutY = FIXED_ROWS - stripH
  const adjusted = []
  for (const w of widgets) {
    const minH = WIDGET_DEFAULTS[w.type]?.minH || 3
    if ((w.y || 0) >= cutY) return null            // already occupies the strip
    let h = w.h || minH
    if ((w.y || 0) + h > cutY) h = cutY - (w.y || 0)
    if (h < minH) return null                       // can't shrink this one enough
    adjusted.push({ ...w, h })
  }
  return { widgets: adjusted, place: { x: 0, y: cutY, w: cols, h: stripH } }
}

// ── Resize "yield": shrink a neighbour instead of blocking / ejecting it ──────
// When the user drags one widget's edge into a neighbour, the neighbour gives up
// exactly the space the active widget grew into — its FAR edge stays pinned (so it
// can never be pushed off-canvas), only the touched near-edge moves — down to the
// neighbour's own min size. Once the neighbour bottoms out at its min, the active
// widget's edge is pulled back so the resize STOPS there instead of overlapping.

// Resolution is DIRECTIONAL — it acts along the axis the user is dragging (the
// handle), never the "axis of least overlap". That distinction matters: a purely
// VERTICAL resize must not shrink a side-neighbour's width or drag the active
// sideways just because a widget sits beside it (the bug where a chart beside the
// watchlist blocked the watchlist's top-edge drag). `axis` is 'h' | 'v' derived
// from the handle; corners pass whichever the caller resolves first.
function _resizeAxis(handle) {
  const h = handle.includes('e') || handle.includes('w')
  const v = handle.includes('n') || handle.includes('s')
  return { h, v }
}

// Shrink neighbour B away from active widget A along the RESIZE axis. B's far edge
// stays pinned (never pushed off-canvas); only the touched near edge moves, down to
// B's own min. No overlap on the resize axis ⇒ B is untouched.
function shrinkAwayFromActive(B, A, handle) {
  const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)
  const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
  if (ox <= 0 || oy <= 0) return B  // no overlap → untouched
  const def = WIDGET_DEFAULTS[B.type] || {}
  const minW = def.minW || 2
  const minH = def.minH || 3
  const { h: horiz, v: vert } = _resizeAxis(handle)
  const useH = horiz && (!vert || ox <= oy)   // corner → axis of least overlap
  if (useH) {
    // B is only in a HORIZONTAL resize's path if it substantially shares ROWS with
    // A (≥ half the smaller height). A widget merely beside A with a sliver of
    // vertical overlap must not be dragged into the resize.
    if (oy < 0.5 * Math.min(A.h, B.h)) return B
    if ((B.x + B.w / 2) >= (A.x + A.w / 2)) {   // B is to the RIGHT of A
      const right = B.x + B.w
      const nx = Math.min(A.x + A.w, right - minW)
      return { ...B, x: nx, w: right - nx }
    }
    return { ...B, w: Math.max(minW, A.x - B.x) }  // B is to the LEFT of A
  }
  if (vert) {
    // B is only in a VERTICAL resize's path if it substantially shares COLUMNS with
    // A (≥ half the smaller width) — the fix for a chart beside the watchlist
    // blocking the watchlist's top-edge drag on a 1-column artifact overlap.
    if (ox < 0.5 * Math.min(A.w, B.w)) return B
    if ((B.y + B.h / 2) >= (A.y + A.h / 2)) {    // B is BELOW A
      const bottom = B.y + B.h
      const ny = Math.min(A.y + A.h, bottom - minH)
      return { ...B, y: ny, h: bottom - ny }
    }
    return { ...B, h: Math.max(minH, A.y - B.y) } // B is ABOVE A
  }
  return B
}

// After neighbours have shrunk as far as they can, pull the ACTIVE widget's edge
// back out of any neighbour it STILL overlaps (that neighbour hit its min), along
// the resize axis, so the resize stops flush instead of overlapping.
function clampActiveToNeighbors(widgets, activeId, handle) {
  const idx = widgets.findIndex(w => w.id === activeId)
  if (idx < 0) return widgets
  const A = { ...widgets[idx] }
  const aMinW = WIDGET_DEFAULTS[A.type]?.minW || 2
  const aMinH = WIDGET_DEFAULTS[A.type]?.minH || 3
  const { h: horiz, v: vert } = _resizeAxis(handle)
  for (const B of widgets) {
    if (B.id === activeId) continue
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
    if (ox <= 0 || oy <= 0) continue
    const useH = horiz && (!vert || ox <= oy)
    if (useH) {
      if (oy < 0.5 * Math.min(A.h, B.h)) continue   // beside, not stacked horizontally
      if ((A.x + A.w / 2) <= (B.x + B.w / 2)) {  // A grew RIGHT into B
        A.w = Math.max(aMinW, B.x - A.x)
      } else {                                    // A grew LEFT into B
        const aRight = A.x + A.w
        A.x = B.x + B.w
        A.w = Math.max(aMinW, aRight - A.x)
      }
    } else if (vert) {
      if (ox < 0.5 * Math.min(A.w, B.w)) continue   // beside, not stacked vertically
      if ((A.y + A.h / 2) <= (B.y + B.h / 2)) {   // A grew DOWN into B
        A.h = Math.max(aMinH, B.y - A.y)
      } else {                                     // A grew UP into B
        const aBot = A.y + A.h
        A.y = B.y + B.h
        A.h = Math.max(aMinH, aBot - A.y)
      }
    }
  }
  return widgets.map(w => (w.id === activeId ? A : w))
}

// Full resize resolution: apply the active item's new geometry, shrink neighbours
// to yield the space along the resize axis, stop the active at any neighbour that
// hit its min, and clamp to the viewport. `active` is {i,x,y,w,h}; `handle` gives
// the resize direction.
function resolveResize(widgets, active, handle) {
  const withActive = widgets.map(w =>
    (w.id === active.i ? { ...w, x: active.x, y: active.y, w: active.w, h: active.h } : w))
  const A = withActive.find(w => w.id === active.i)
  if (!A) return clampWidgetsToRows(withActive)
  const shrunk = withActive.map(B => (B.id === active.i ? B : shrinkAwayFromActive(B, A, handle)))
  return clampWidgetsToRows(clampActiveToNeighbors(shrunk, active.i, handle))
}

// Custom resize-handle geometry — 4 edges (thin strips) + 4 corners (small
// squares), positioned against each widget's RGL-item box. `dir` uses n/s/e/w
// letters that applyResize tests with String.includes.
const _RH = 8   // edge thickness (px)
const _RC = 14  // corner size (px)
const CUSTOM_RESIZE_HANDLES = [
  { dir: 'n',  cursor: 'ns-resize',   style: { top: 0, left: _RC, right: _RC, height: _RH } },
  { dir: 's',  cursor: 'ns-resize',   style: { bottom: 0, left: _RC, right: _RC, height: _RH } },
  { dir: 'e',  cursor: 'ew-resize',   style: { top: _RC, bottom: _RC, right: 0, width: _RH } },
  { dir: 'w',  cursor: 'ew-resize',   style: { top: _RC, bottom: _RC, left: 0, width: _RH } },
  { dir: 'nw', cursor: 'nwse-resize', corner: true, style: { top: 0, left: 0, width: _RC, height: _RC } },
  { dir: 'ne', cursor: 'nesw-resize', corner: true, style: { top: 0, right: 0, width: _RC, height: _RC } },
  { dir: 'sw', cursor: 'nesw-resize', corner: true, style: { bottom: 0, left: 0, width: _RC, height: _RC } },
  { dir: 'se', cursor: 'nwse-resize', corner: true, style: { bottom: 0, right: 0, width: _RC, height: _RC } },
]

// The watchlist column config (added columns / widths / order) lives in
// localStorage (WL_COLS_LS in Watchlists.jsx), not a pref — read it for
// template capture. null when unset/unreadable (JSON drops the key).
function readWatchlistColumns() {
  try {
    const v = JSON.parse(localStorage.getItem('uct.watchlist.cols'))
    return (v && typeof v === 'object') ? v : null
  } catch { return null }
}

function nextColor(currentColors) {
  // Cycle A→B→C→D→A based on what's already in use.
  const order = ['A', 'B', 'C', 'D']
  for (const c of order) {
    if (!currentColors.includes(c)) return c
  }
  return 'A'
}

// Color to assign a NEWLY added widget. Prefer the group of an existing chart
// that already has a symbol (so the new widget lands on the ticker you're
// looking at — not an empty group showing a blank Fundamentals panel or a chart
// stuck on the SPY fallback). Fall back to the first populated group, then to
// the next free color for a genuinely empty board.
function pickWidgetColor(widgets, groupSyms) {
  const g = groupSyms || {}
  const chartW = widgets.find((w) => w.type === 'chart' && g[w.color])
  if (chartW) return chartW.color
  const anyW = widgets.find((w) => g[w.color])
  if (anyW) return anyW.color
  return nextColor(widgets.map((w) => w.color))
}

// Inline "Delete?" confirm shown in place of a layout's ✕ so an accidental click
// can't wipe a saved layout. Yes deletes; Go back cancels.
function DeleteConfirm({ onYes, onCancel }) {
  return (
    <span className={styles.delConfirm} role="group" aria-label="Confirm delete layout">
      <span className={styles.delConfirmMsg}>Delete?</span>
      <button type="button" className={styles.delConfirmYes} onClick={onYes}>Yes</button>
      <button type="button" className={styles.delConfirmNo} onClick={onCancel}>Go back</button>
    </span>
  )
}

export default function ChartsWorkspace() {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const { prefs, setPref, loading: prefsLoading } = usePreferences()
  // Current app theme, read live by handleAddWidget to STAMP a new widget with the
  // theme it was placed under (persists in opts so a theme-following widget keeps its
  // placement color across reloads; only NEW widgets pick up the current theme).
  const themeRef = useRef(prefs?.theme)
  themeRef.current = prefs?.theme

  // "Merge widgets": lock the board in place (no move / resize / delete / color
  // edits), drop every widget border + header bar, and tighten the inter-widget gap
  // to a thin 1px seam so the widgets blend together TC2000-style. Persisted so the
  // merged view survives reloads until the user unmerges.
  const merged = parsePref(prefs?.charts_merged, false) === true
  // Merged: zero gap so adjacent widget borders TOUCH into one continuous thin grey
  // line (no dark seam showing between them).
  const gridGap = merged ? 0 : MARGIN_Y
  const toggleMerged = useCallback(() => setPref('charts_merged', JSON.stringify(!merged)), [merged, setPref])

  // Viewport-locked sizing: measure the workspace body and divide its height
  // by FIXED_ROWS so the grid always fills the visible area exactly. The page
  // itself never scrolls — widget max size = visible chart area.
  const bodyRef = useRef(null)
  const [rowHeight, setRowHeight] = useState(34)
  // Grid content width (px) — needed to convert a merged-mode seam-drag from
  // pixels to whole grid columns. Merged has no body padding, so the grid inner
  // width IS the body width; unmerged we still track it (harmless, unused there).
  const [gridWidth, setGridWidth] = useState(0)
  const [resizingId, setResizingId] = useState(null)  // widget being custom-resized → shows the gold placeholder

  // The viewport-lock row-height math, extracted so a popped-out board can run
  // it against ITS OWN window. Sharing the main tab's rowHeight would size a
  // board on a second monitor to the main window's height — the 20 rows would
  // either overflow it or leave dead space.
  // The formula lives in ./rowHeight.js so the popped board runs the identical math
  // and so the "grid always fits inside the measured body" invariant is testable.
  const computeRowHeight = useCallback(
    (clientHeight) => rowHeightFor(clientHeight, merged),
    [merged],
  )

  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const bodyPad = merged ? 0 : BODY_PAD
      setRowHeight(computeRowHeight(el.clientHeight))
      setGridWidth(el.clientWidth - bodyPad * 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeRowHeight, merged])

  // Layout state — seed from prefs or default.
  const [layout, setLayout] = useState(() => parseLayout(prefs?.charts_workspace_layout) || DEFAULT_LAYOUT)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // If prefs arrive AFTER initial render (async fetch), pick them up.
  const loadedFromPrefsRef = useRef(false)
  useEffect(() => {
    if (loadedFromPrefsRef.current) return
    const parsed = parseLayout(prefs?.charts_workspace_layout)
    if (parsed) {
      setLayout(parsed)
      loadedFromPrefsRef.current = true
    }
  }, [prefs?.charts_workspace_layout])

  // Hydration gate: don't persist until server prefs have settled, so RGL's
  // on-mount onLayoutChange can't clobber a returning user's saved layout with the
  // default before it loads (the "resets to default" bug).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!prefsLoading) hydratedRef.current = true
  }, [prefsLoading])

  // Color-group state — seed from prefs or empty.
  const [groupSyms, setGroupSymsState] = useState(() => {
    try {
      const raw = prefs?.charts_workspace_groups
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && typeof parsed === 'object') {
          return { A: null, B: null, C: null, D: null, ...parsed }
        }
      }
    } catch {}
    return { A: null, B: null, C: null, D: null }
  })

  // The linked ticker updates INSTANTLY (state), but persisting it is debounced —
  // otherwise fast arrow-scanning fires a POST /api/auth/preferences per keypress
  // (+ an optimistic SWR mutate that re-renders every prefs consumer). 400ms trailing.
  const groupsSaveTimerRef = useRef(null)
  const setGroupSym = useCallback((color, sym) => {
    setGroupSymsState(prev => {
      const next = { ...prev, [color]: sym }
      if (groupsSaveTimerRef.current) clearTimeout(groupsSaveTimerRef.current)
      groupsSaveTimerRef.current = setTimeout(() => {
        setPref('charts_workspace_groups', JSON.stringify(next))
      }, 400)
      return next
    })
  }, [setPref])

  // If prefs arrive AFTER initial render (the SWR fetch usually resolves a beat after
  // mount), pick up the saved group syms — otherwise the useState seed above ran while
  // prefs was still undefined, left every group null, and the chart widget fell back to
  // SPY on every refresh (owner report: "charts revert to SPY"). Mirrors the layout
  // re-hydration above; one-shot so it never clobbers a live in-session ticker change.
  const groupsLoadedFromPrefsRef = useRef(false)
  useEffect(() => {
    if (groupsLoadedFromPrefsRef.current) return
    const raw = prefs?.charts_workspace_groups
    if (raw == null) return
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object') {
        setGroupSymsState({ A: null, B: null, C: null, D: null, ...parsed })
        groupsLoadedFromPrefsRef.current = true
      }
    } catch { /* malformed pref → keep current */ }
  }, [prefs?.charts_workspace_groups])

  // Crosshair sync bus: a stable pub/sub so a hovered chart can broadcast its
  // crosshair to same-color-group siblings WITHOUT re-rendering the grid at
  // mouse-move rate (only the receiving widgets re-render via local state).
  const crosshairBusRef = useRef(null)
  if (!crosshairBusRef.current) {
    const listeners = new Set()
    crosshairBusRef.current = {
      emit: (color, sourceId, payload) => listeners.forEach((fn) => fn({ color, sourceId, payload })),
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    }
  }

  // Active chart widget (hotkey dedupe): the last-hovered ChartWidget's id.
  // Ref (not state) so hover crossings never re-render anything; each widget's
  // StockChart reads it through a hotkeysActive callback at keydown time.
  const activeChartRef = useRef(null)
  // widgetId → imperative chart API ({getComparison,setComparison,getPercentScale,
  // setPercentScale}). Each ChartWidget registers here on mount; the Compare
  // Symbols tool reads/writes the active chart's comparison overlays through it.
  const chartApiByIdRef = useRef(new Map())
  // Same idea for watchlists: the last hovered/focused Watchlist widget owns the
  // arrow keys + its own scroll-into-view, so 4 watchlists don't all fight over one
  // keypress (first-mounted-wins race) or all force a reflow on every selection.
  const activeWatchlistRef = useRef(null)

  // AI-search bus: a chart's "AI search" context action routes a query to any
  // mounted AI Search widget; request() returns false when none exist so the
  // caller can fall back to a temporary popup.
  const aiSearchBusRef = useRef(null)
  if (!aiSearchBusRef.current) {
    const subs = new Set()
    aiSearchBusRef.current = {
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
      request: (query) => { if (subs.size === 0) return false; subs.forEach((fn) => fn(query)); return true },
    }
  }

  // Workspace-wide chart theme ('default' | 'sunrise'), persisted like the layout.
  const chartsTheme = prefs.charts_theme || 'default'
  const setChartsTheme = useCallback((t) => setPref('charts_theme', t), [setPref])

  // Each widget's chrome (panel + border, header row, and its own top rows) paints
  // the canvas color of THAT widget's settings, published to the widget subtree as
  // --widget-canvas by WidgetHost. Keyed by widget type — a type absent here gets no
  // variable and keeps the default tokens (AI Search / Scanner have no canvas setting
  // of their own yet). (This was briefly set on the WORKSPACE root, which cascaded the
  // chart's color into every widget — do NOT hoist it back up.)
  // Resolution mirrors each surface's own: a gradient contributes its TOP stop, since
  // that's the edge the header actually meets; otherwise the solid color.
  // ── Pop-out state (declared up here so the per-widget chrome map below can
  // include popped widgets — a popped-out layout's widgets are removed from
  // layout.widgets, so without this their canvas-colored borders reverted to the
  // default when popped). Both kinds are React portals owned by this tab.
  const [poppedWidgetIds, setPoppedWidgetIds] = useState([])
  const [poppedLayouts, setPoppedLayouts] = useState([])
  // In-canvas floating widgets: same idiom as poppedWidgetIds — the widget stays in
  // layout.widgets (its grid geometry is preserved for docking) and is merely hidden
  // from the grid, then rendered in a FloatingWidgetPanel on top of the canvas.
  const [floatingWidgetIds, setFloatingWidgetIds] = useState([])

  const widgetCanvasByType = useMemo(() => {
    const cs = mergeChartSettings(prefs.chart_settings)
    const chart = chartsTheme === 'sunrise'
      ? '#eaf1fa'
      : (cs.bgMode === 'gradient' ? (cs.bgGradient?.top || cs.background) : cs.background)
    const tt = mergeThemeTrackerSettings(parsePref(prefs.theme_tracker_settings, null) ?? themeTrackerDefaultsForTheme(prefs.theme))
    const themes = tt.bgMode === 'gradient' ? (tt.bgGradient?.top || tt.bg) : tt.bg
    const fw = mergeFundamentalsSettings(parsePref(prefs.fundamentals_settings, null) ?? fundamentalsDefaultsForTheme(prefs.theme))
    const fundamentals = fw.bgMode === 'gradient' ? (fw.bgGradient?.top || fw.bg) : fw.bg
    const bw = mergeBreadthWidgetSettings(parsePref(prefs.breadth_widget_settings, null) ?? breadthDefaultsForTheme(prefs.theme))
    const breadth = bw.bgMode === 'gradient' ? (bw.bgGradient?.top || bw.bg) : bw.bg
    // News / Profile / WATCHLIST are NOT here: their appearance is fully per-widget
    // (opts.settings, resolved via widgetCanvasById); an uncustomized one has no
    // type-level canvas so it falls through to the app-theme --bg (OLED-black /
    // light), which is the whole point. Theme Tracker / Fundamentals / Breadth
    // publish ONLY when the user actually customized their canvas.
    const ttCustom = tt.bgMode === 'gradient' || String(tt.bg).toLowerCase() !== THEME_TRACKER_DEFAULTS.bg
    const fwCustom = fw.bgMode === 'gradient' || String(fw.bg).toLowerCase() !== FUNDAMENTALS_DEFAULTS.bg
    const bwCustom = bw.bgMode === 'gradient' || String(bw.bg).toLowerCase() !== BREADTH_WIDGET_DEFAULTS.bg
    const entry = (canvas) => ({
      canvas, divider: dividerFor(canvas), dividerStrong: dividerFor(canvas, { strong: true }),
      chrome: chromeFor(canvas), panel: panelFor(canvas), rowHover: toolbarFor(canvas)?.bg,
    })
    return {
      chart: entry(chart),
      ...(ttCustom ? { themes: entry(themes) } : {}),
      ...(fwCustom ? { fundamentals: entry(fundamentals) } : {}),
      ...(bwCustom ? { breadth: entry(breadth) } : {}),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartsTheme, prefs.theme, prefs.chart_settings, prefs.watchlist_settings, prefs.theme_tracker_settings, prefs.fundamentals_settings, prefs.breadth_widget_settings])

  // Per-WIDGET chrome canvas (keyed by widget id). Every chart/watchlist widget
  // now owns its settings, so its border/header/dividers must follow ITS canvas,
  // not the one-per-type global. Only diverged widgets get an entry; the rest
  // fall back to widgetCanvasByType (the global default) in WidgetHost. This is
  // what makes "changing one widget's canvas never touches another" true for the
  // chrome, matching the isolated list/chart surfaces.
  const widgetCanvasById = useMemo(() => {
    const out = {}
    // Include popped-out layout widgets too — they're removed from layout.widgets
    // while popped, but their per-widget chrome (canvas-colored border) must still
    // resolve in the popped window's WidgetHost.
    const all = [...(layout.widgets || []), ...poppedLayouts.flatMap(pl => pl.widgets || [])]
    for (const w of all) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    return out
  }, [layout.widgets, poppedLayouts, chartsTheme])

  // ── Custom-Period Sort ────────────────────────────────────────────────────
  // Tools → Custom-Period Sort arms drag-to-highlight on every chart (periodSortMode).
  // A completed drag opens the config popover (periodSortSel); "Sort" opens the results
  // panel (periodSortPanel) ranking every US common stock over that span.
  const [periodSortMode, setPeriodSortMode] = useState(false)
  const [periodSortSel, setPeriodSortSel] = useState(null)     // { sym, start, end, pct } | null
  const [periodSortPanel, setPeriodSortPanel] = useState(null) // { start, end, group } | null
  // Tools → Compare Symbols: the floating panel that overlays other tickers' % on
  // the active chart (auto-opens a chart widget if none exists).
  const [compareOpen, setCompareOpen] = useState(false)
  // Replay mode: an ISO 'YYYY-MM-DD' cutoff — linked charts hide every bar after it.
  const [replayCutoff, setReplayCutoff] = useState(null)
  // Tools → Replay Mode: the dedicated replay dialog (separate from Custom-Period Sort;
  // it writes the SAME shared `replayCutoff` chart prop but edits no CPS file).
  const [replayOpen, setReplayOpen] = useState(false)
  // "Pick on chart": arm click/drag on the active chart to choose the replay cutoff.
  const [replayArmPick, setReplayArmPick] = useState(false)
  // "Mark start date": an ISO 'YYYY-MM-DD' + style ('line' gold vertical line | 'candle'
  // gold start-date candle) — linked charts mark the sort's start date.
  const [startMarker, setStartMarker] = useState(null)
  const [startMarkerStyle, setStartMarkerStyle] = useState('line')
  const handlePeriodSelected = useCallback((sym, start, end, pct) => {
    setPeriodSortMode(false)
    setPeriodSortSel({ sym, start, end, pct })
  }, [])
  const handlePeriodCancel = useCallback(() => setPeriodSortMode(false), [])
  const exitReplay = useCallback(() => { setReplayCutoff(null); setStartMarker(null) }, [])
  // Replay Mode "Pick on chart" — defined here (before workspaceValue) since the memo
  // exposes them to the charts. A picked cutoff sets the shared cutoff, disarms the pick,
  // and reopens the dialog (now showing the picked date) so the timeframe can be adjusted.
  const handleReplayCutoffPicked = useCallback((iso) => { setReplayCutoff(iso || null); setReplayArmPick(false); setReplayOpen(true) }, [])
  const cancelReplayPick = useCallback(() => { setReplayArmPick(false); setReplayOpen(true) }, [])

  const workspaceValue = useMemo(
    () => ({ groupSyms, setGroupSym, chartsTheme, widgetCanvasByType, widgetCanvasById, crosshairBus: crosshairBusRef.current, aiSearchBus: aiSearchBusRef.current, activeChartRef, chartApiById: chartApiByIdRef, activeWatchlistRef, periodSortMode, onPeriodSelected: handlePeriodSelected, onPeriodCancel: handlePeriodCancel, replayCutoff, exitReplay, startMarker, startMarkerStyle, replayArmPick, onReplayCutoffPicked: handleReplayCutoffPicked, onReplayPickCancel: cancelReplayPick }),
    [groupSyms, setGroupSym, chartsTheme, widgetCanvasByType, widgetCanvasById, periodSortMode, handlePeriodSelected, handlePeriodCancel, replayCutoff, exitReplay, startMarker, startMarkerStyle, replayArmPick, handleReplayCutoffPicked, cancelReplayPick],
  )

  // Debounced layout persist (500ms).
  const saveTimerRef = useRef(null)
  const scheduleSave = useCallback((nextLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref('charts_workspace_layout', JSON.stringify(nextLayout))
    }, 500)
  }, [setPref])

  // Flush any pending debounced save when leaving the page (SPA nav / unmount) so
  // the last arrangement is always what loads next time — no dependence on the
  // 500ms window having elapsed before the user navigates away.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current && hydratedRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        setPref('charts_workspace_layout', JSON.stringify(layoutRef.current))
      }
    }
  }, [setPref])

  // react-grid-layout fires onLayoutChange with the new x/y/w/h array.
  // Merge it back into our widget objects.
  // Drag-move + programmatic changes. RGL never reports overlaps here (drag-move is
  // preventCollision-guarded, resize is our own overlay), so a straight merge +
  // bounds-clamp is all this needs.
  const handleLayoutChange = useCallback((newGridLayout) => {
    setLayout(prev => {
      const byId = Object.fromEntries(newGridLayout.map(l => [l.i, l]))
      const widgets = prev.widgets.map(w => {
        const l = byId[w.id]
        if (!l) return w
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h }
      })
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      // Don't persist until prefs have hydrated — RGL fires onLayoutChange on
      // mount with the (empty) default, which would otherwise clobber a returning
      // user's saved layout before it loads.
      if (hydratedRef.current) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // ── Custom resize (replaces RGL's) ────────────────────────────────────────
  // RGL cannot shrink a neighbour during a live resize — it only blocks or
  // push-moves, and it ignores layout-prop changes while a drag is active
  // (getDerivedStateFromProps returns null). So we own the resize: our handles
  // drive layout state directly, resolveResize shrinks the neighbour we grow into
  // (far edge pinned → never off-canvas) and stops the active widget once the
  // neighbour hits its min. Because there's no RGL activeDrag, every tick renders.
  const resizeRef = useRef(null)
  // Turn a pointer position into the widget's clamped target geometry (grid units).
  const resizeGeomAt = useCallback((st, clientX, clientY) => {
    const dCols = Math.round((clientX - st.startX) / st.unitW)
    const dRows = Math.round((clientY - st.startY) / st.unitH)
    let { x, y, w, h } = st.geom
    const H = st.handle
    if (H.includes('e')) w = st.geom.w + dCols
    if (H.includes('s')) h = st.geom.h + dRows
    if (H.includes('w')) { x = st.geom.x + dCols; w = st.geom.w - dCols }
    if (H.includes('n')) { y = st.geom.y + dRows; h = st.geom.h - dRows }
    const def = WIDGET_DEFAULTS[st.type] || {}
    const minW = def.minW || 2, minH = def.minH || 3
    if (w < minW) { if (H.includes('w')) x -= (minW - w); w = minW }   // keep anchored edge fixed
    if (h < minH) { if (H.includes('n')) y -= (minH - h); h = minH }
    if (x < 0) { w += x; x = 0 }
    if (y < 0) { h += y; y = 0 }
    if (x + w > GRID_COLS) w = GRID_COLS - x
    if (y + h > FIXED_ROWS) h = FIXED_ROWS - y
    return { i: st.id, x, y, w, h }
  }, [])
  // PIXEL-SMOOTH active widget: write the exact mouse-following box straight to the
  // widget's DOM element (no React, no grid-snap) so its corner tracks the cursor
  // 1:1 with zero lag — mirrors how react-grid-layout moved the real element during
  // a resize. Grid-snap only decides where NEIGHBOURS yield + where it lands on drop.
  const applyActivePx = useCallback((st) => {
    const p = st.pixel, el = st.el
    if (!p || !el) return
    // transition:none is ESSENTIAL — .react-grid-item ships a `transition: all
    // 200ms`, so without this every write animates over 200ms and the widget
    // visibly lags the cursor. (RGL kills it via a `.resizing` class during its
    // own drags; ours isn't RGL's, so we kill it ourselves — also via the
    // .charts-resizing container class for the neighbours.)
    el.style.transition = 'none'
    el.style.left = `${p.left}px`; el.style.top = `${p.top}px`
    el.style.width = `${p.width}px`; el.style.height = `${p.height}px`
    el.style.zIndex = '7'
  }, [])
  // Re-assert the pixel box AFTER any React re-render during the resize (a neighbour
  // shrink re-renders the grid, and RGL would repaint the active widget at its
  // snapped size for one frame → a visible stutter). Runs before paint, so no flicker.
  useLayoutEffect(() => { const st = resizeRef.current; if (st) applyActivePx(st) })
  const startResize = useCallback((e, widget, handle) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget.parentElement
    const op = el?.offsetParent
    if (!el || !op || !widget.w || !widget.h) return
    const gap = MARGIN_Y
    const unitW = (el.offsetWidth + gap) / widget.w   // column pitch (colWidth + gap)
    const unitH = (el.offsetHeight + gap) / widget.h  // row pitch
    const aL = el.offsetLeft, aT = el.offsetTop
    // Full-grid pixel bounds derived from the pitch — NOT op.clientHeight, which is
    // RGL's content-fit container height (a short widget → short container → the
    // pixel clamp would stop the bottom mid-canvas). originL/T is grid cell (0,0).
    const originL = aL - widget.x * unitW
    const originT = aT - widget.y * unitH
    const def = WIDGET_DEFAULTS[widget.type] || {}
    // The layout at resize START — the STABLE base every tick resolves against, so
    // neighbour shrink never compounds and the resolve is deterministic.
    const baseWidgets = layoutRef.current?.widgets || []
    const st = {
      id: widget.id, type: widget.type, handle, baseWidgets,
      startX: e.clientX, startY: e.clientY,
      geom: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      el, unitW, unitH,
      // Pixel-follow is bounded ONLY by the canvas (+ the widget's own min) so it
      // NEVER gets stuck against a neighbour mid-drag — it tracks the mouse the whole
      // way. The neighbour still shrinks live, and the RELEASE (resolveResize) snaps
      // the widget flush beside a genuine neighbour (or free of a side-neighbour).
      minL: originL, minT: originT,
      maxR: originL + GRID_COLS * unitW - gap,
      maxB: originT + FIXED_ROWS * unitH - gap,
      aL, aT, aW: el.offsetWidth, aH: el.offsetHeight,
      minWpx: (def.minW || 2) * unitW - gap,
      minHpx: (def.minH || 3) * unitH - gap,
      pixel: null, snapKey: '', resolved: null, raf: 0,
    }
    const onMove = (ev) => {
      if (resizeRef.current !== st) return
      const dx = ev.clientX - st.startX, dy = ev.clientY - st.startY
      // 1) Pixel box — exact mouse follow, written straight to the DOM every event.
      let left = st.aL, top = st.aT, width = st.aW, height = st.aH
      if (handle.includes('e')) width = st.aW + dx
      if (handle.includes('s')) height = st.aH + dy
      if (handle.includes('w')) { left = st.aL + dx; width = st.aW - dx }
      if (handle.includes('n')) { top = st.aT + dy; height = st.aH - dy }
      if (width < st.minWpx) { if (handle.includes('w')) left -= (st.minWpx - width); width = st.minWpx }
      if (height < st.minHpx) { if (handle.includes('n')) top -= (st.minHpx - height); height = st.minHpx }
      // Bound to the CANVAS only (never a neighbour) so the drag can't get stuck.
      if (left < st.minL) { width += left - st.minL; left = st.minL }
      if (top < st.minT) { height += top - st.minT; top = st.minT }
      if (left + width > st.maxR) width = st.maxR - left
      if (top + height > st.maxB) height = st.maxB - top
      st.pixel = { left, top, width, height }
      applyActivePx(st)
      // 2) Snapped grid target — only re-render (neighbour shrink) on cell crossing,
      //    resolved against the STABLE base so shrink never compounds.
      const g = resizeGeomAt(st, ev.clientX, ev.clientY)
      const key = `${g.x},${g.y},${g.w},${g.h}`
      if (key !== st.snapKey) {
        st.snapKey = key
        // Keep the ACTIVE widget's React geom FROZEN at its start value during the
        // drag — only the neighbours update live. Its box is owned entirely by the
        // pixel-follow (applyActivePx + the useLayoutEffect), so letting RGL repaint
        // it at interim snapped sizes just churns its contents (the chart's bottom
        // jumping mid-corner-drag). It commits to its final geom on release.
        const full = resolveResize(st.baseWidgets, g, handle)
        st.resolved = full.map(w => (w.id === st.id
          ? { ...w, x: st.geom.x, y: st.geom.y, w: st.geom.w, h: st.geom.h } : w))
        if (!st.raf) st.raf = requestAnimationFrame(() => {
          st.raf = 0
          if (resizeRef.current === st && st.resolved) {
            setLayout(prev => ({ ...prev, widgets: st.resolved }))
          }
        })
      }
    }
    const onUp = (ev) => {
      if (resizeRef.current !== st) return
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0 }
      const g = resizeGeomAt(st, ev.clientX, ev.clientY)
      const resolved = resolveResize(st.baseWidgets, g, handle)
      const rg = resolved.find(w => w.id === st.id) || g
      // Pin the element to the RESOLVED (flush-against-neighbour) pixel box so it
      // matches the committed grid geom exactly — do NOT clear width/left (that
      // collapses the item to CSS `auto` width, and React skips the no-op re-render
      // so it stays stuck narrow until an unrelated repaint).
      el.style.left = `${st.minL + rg.x * st.unitW}px`
      el.style.top = `${st.minT + rg.y * st.unitH}px`
      el.style.width = `${rg.w * st.unitW - MARGIN_Y}px`
      el.style.height = `${rg.h * st.unitH - MARGIN_Y}px`
      el.style.zIndex = ''; el.style.transition = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      resizeRef.current = null
      setResizingId(null)
      setLayout(prev => {
        const next = { ...prev, widgets: resolved }
        if (hydratedRef.current) scheduleSave(next)
        return next
      })
    }
    resizeRef.current = st
    setResizingId(widget.id)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [resizeGeomAt, applyActivePx, scheduleSave])

  const handleRemoveWidget = useCallback((id) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.filter(w => w.id !== id) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Merged-mode seam drag: MergedSeamOverlay hands back the whole widgets array
  // with the two sides of the dragged seam resized. Preview on every move
  // (commit=false → no persist thrash); persist once on release (commit=true).
  const minWFor = useCallback((w) => WIDGET_DEFAULTS[w.type]?.minW || 2, [])
  const minHFor = useCallback((w) => WIDGET_DEFAULTS[w.type]?.minH || 3, [])
  const handleSeamResize = useCallback((nextWidgets, commit) => {
    setLayout(prev => {
      // `nextWidgets` is derived from the merged board's VISIBLE widgets only —
      // floated + popped widgets were filtered out of that set. Re-append any
      // widget not present in `nextWidgets` UNCHANGED, or a seam drag would drop
      // them from layout.widgets and the floating/popped panel would vanish.
      const seamIds = new Set(nextWidgets.map(w => w.id))
      const preserved = prev.widgets.filter(w => !seamIds.has(w.id))
      const next = { ...prev, widgets: clampWidgetsToRows([...nextWidgets, ...preserved]) }
      if (commit) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleColorChange = useCallback((id, color) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, color } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleOptsChange = useCallback((id, opts) => {
    setLayout(prev => {
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === id ? { ...w, opts } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Custom-Period Sort → Timeframe selector: force EVERY chart (base widget + any
  // chart wtab) to the chosen TF (D/W/M). ChartWidget derives its tf from opts.tf,
  // so writing opts.tf re-renders the chart at that timeframe; the user can still
  // switch it manually afterward. Composes with replay (cutoff is by date, TF-agnostic).
  const applyTfToCharts = useCallback((tf) => {
    if (!tf) return
    setLayout(prev => {
      let changed = false
      const withTf = (o) => ({ ...(o || {}), tf })
      const widgets = prev.widgets.map(w => {
        let nw = w
        if (w.type === 'chart') { nw = { ...nw, opts: withTf(nw.opts) }; changed = true }
        if (Array.isArray(w.wtabs) && w.wtabs.some(t => t?.type === 'chart')) {
          nw = { ...nw, wtabs: nw.wtabs.map(t => (t?.type === 'chart' ? { ...t, opts: withTf(t.opts) } : t)) }
          changed = true
        }
        return nw
      })
      if (!changed) return prev
      const next = { ...prev, widgets }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // ── "Open on Charts" deep link (/charts?sym=AMD&tf=15) ───────────────────
  // The reverse direction of the capture flow: a journal embed (or any other
  // surface) can point the workspace at what it is showing. Applied through
  // the authorities that already own these values — setGroupSym for the
  // ticker, applyTfToCharts for the timeframe — never by writing layout here,
  // so there stays ONE writer per value.
  // ⏳ Waits for hydration: prefs land a beat after mount and would otherwise
  // overwrite the applied symbol with the saved one (the same race the
  // groups-from-prefs one-shot exists for).
  // 🧹 Strips the params after applying, so a refresh is not a second
  // instruction fighting whatever the user changed since.
  // ⛔ Declared AFTER applyTfToCharts on purpose (it reads it).
  const deepLinkAppliedRef = useRef(false)
  useEffect(() => {
    if (deepLinkAppliedRef.current || prefsLoading) return
    const link = readChartsLink(typeof window !== 'undefined' ? window.location.search : '')
    deepLinkAppliedRef.current = true
    if (!link) return
    if (link.symbol) setGroupSym('A', link.symbol)
    if (link.tf) applyTfToCharts(link.tf)
    try {
      const rest = stripChartsLink(window.location.search)
      window.history.replaceState({}, '', `${window.location.pathname}${rest}`)
    } catch { /* history unavailable — lingering params are harmless */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoading])

  // Replace a whole widget object in place — used by the widget-level tab system,
  // which routes every tab add/close/select and per-active-tab color/opts edit
  // through one atomic swap (the reducer already computed the next widget). Keeps
  // the widget's grid position (x/y/w/h) since those live on the same object.
  const handleReplaceWidget = useCallback((id, nextWidget) => {
    setLayout(prev => {
      // Take the reducer's widget WHOLESALE (so closing the last tab, which drops
      // the wtabs/activeWtab keys entirely, actually clears them) but keep the LIVE
      // grid geometry from `prev` — the reducer computed from a render-time snapshot
      // that could be stale if a drag/resize landed in between.
      const widgets = prev.widgets.map(w => (
        w.id === id ? { ...nextWidget, x: w.x, y: w.y, w: w.w, h: w.h } : w
      ))
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleAddWidget = useCallback((type, seedOpts) => {
    setLayout(prev => {
      const color = pickWidgetColor(prev.widgets, groupSyms)
      const defaults = WIDGET_DEFAULTS[type]
      // Place into the first logical open spot (row-major scan), not column 0:
      // RGL vertical compaction preserves x, so a hardcoded x:0 stacks new
      // widgets below the left column and overflows. findPlacement shrinks the
      // widget toward its min size to squeeze into a smaller gap rather than
      // falling off-screen; it bottom-packs only when the grid is genuinely full.
      const fit = findPlacement(prev.widgets, defaults, COLS.lg, FIXED_ROWS)
      let widgets = prev.widgets
      let place = fit
      // Grid full → findPlacement returns y:Infinity (would land off the bottom).
      // Make room instead: reserve a full-width bottom strip (shrinks the chart /
      // whatever reaches the bottom UP so the newcomer sits below it, on-screen —
      // the "add fundamentals under the chart" case). Fall back to shrinking a
      // single widget (below-split of the tallest, then side-split of the widest).
      if (!Number.isFinite(fit.y) || fit.y + fit.h > FIXED_ROWS) {
        const needH = Math.max(defaults.minH || 3, Math.min(defaults.h, Math.floor(FIXED_ROWS / 2)))
        const room = reserveBottomStrip(prev.widgets, needH, COLS.lg)
          || splitToFit(prev.widgets, defaults, tallestOf(prev.widgets))
          || splitToSide(prev.widgets, defaults, widestOf(prev.widgets))
        if (room) { widgets = room.widgets; place = room.place }
        else { place = { x: 0, y: 0, w: defaults.w, h: defaults.h } }  // last resort (clamped below)
      }
      // Stamp the app theme at placement so a theme-following widget freezes its
      // look here (WidgetHost/usePlacedTheme read opts.placedTheme). seedOpts wins
      // if it already carries a value.
      const newOpts = { placedTheme: themeRef.current, ...(seedOpts && typeof seedOpts === 'object' ? seedOpts : {}) }
      // A CHART widget placed on the LIGHT theme freezes into the light-canvas chart
      // default (the chart has its own settings system, not the themeFollow class path).
      // Dark placement keeps the current default (no stamp → the theme-invariant seed).
      if (type === 'chart' && themeRef.current === 'light' && !newOpts.settings) {
        newOpts.settings = chartDefaultsForTheme('light')
      }
      const newWidget = {
        id: `w-${type}-${Date.now()}`,
        type, color,
        x: place.x, y: place.y, w: place.w, h: place.h,
        opts: newOpts,
      }
      const next = { ...prev, widgets: clampWidgetsToRows([...widgets, newWidget]) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave, groupSyms])

  // Tools → Compare Symbols: overlay other tickers' % on the active chart. If no
  // chart widget is open, auto-open one first (it registers its API on mount and
  // the panel picks it up). Then open the floating panel.
  const openCompare = useCallback(() => {
    if (!layout.widgets.some(w => w.type === 'chart')) handleAddWidget('chart')
    setCompareOpen(true)
  }, [layout, handleAddWidget])

  // Tools → Replay Mode. Auto-adds a chart if none exists (like openCompare), then opens
  // the dialog. `startReplay` sets the shared cutoff + switches every chart to the chosen
  // timeframe (deep intraday is fetched date-anchored via the chart's ?to= path).
  const openReplay = useCallback(() => {
    if (!layout.widgets.some(w => w.type === 'chart')) handleAddWidget('chart')
    setReplayOpen(true)
  }, [layout, handleAddWidget])
  const startReplay = useCallback((cutoffIso, tf) => {
    setReplayCutoff(cutoffIso || null)
    if (tf) applyTfToCharts(tf)
    setReplayOpen(false)
  }, [applyTfToCharts])
  const exitReplayMode = useCallback(() => { setReplayCutoff(null); setStartMarker(null); setReplayOpen(false); setReplayArmPick(false) }, [])
  // "Pick on chart": close the dialog + arm the drag so the chart is visible to click on.
  const armReplayPick = useCallback(() => { setReplayOpen(false); setReplayArmPick(true) }, [])

  // Custom-Period Sort → dock the floating results as a real grid widget (carrying the
  // highlighted range), or fold it into an existing widget as a Period-Sort tab.
  const handleDockPeriodSort = useCallback((start, end, group = null) => {
    setPeriodSortPanel(null)
    setLayout(prev => {
      const defaults = WIDGET_DEFAULTS.periodsort
      const fit = findPlacement(prev.widgets, defaults, COLS.lg, FIXED_ROWS)
      let widgets = prev.widgets
      let place = fit
      // If the normal placement would land off-screen (grid full), open room by splitting
      // an existing widget. Prefer putting the sort to the LEFT of the WIDEST widget (a
      // full-screen chart) so it sits beside the chart at full height; then fall back to a
      // below-split of a non-chart widget, then any widget.
      if (fit.y + fit.h > FIXED_ROWS) {
        const tallestOf = (arr) => arr.reduce((a, b) => (!a || b.h > a.h ? b : a), null)
        const widestOf = (arr) => arr.reduce((a, b) => (!a || b.w > a.w ? b : a), null)
        const nonChart = prev.widgets.filter(w => w.type !== 'chart')
        const split = splitToSide(prev.widgets, defaults, widestOf(prev.widgets))
          || splitToFit(prev.widgets, defaults, tallestOf(nonChart))
          || splitToFit(prev.widgets, defaults, tallestOf(prev.widgets))
        if (split) { widgets = split.widgets; place = split.place }
      }
      const color = pickWidgetColor(widgets, groupSyms)
      const newWidget = {
        id: `w-periodsort-${Date.now()}`,
        type: 'periodsort', color,
        x: place.x, y: place.y, w: place.w, h: place.h,
        opts: { start, end, group: group || null },
      }
      const next = { ...prev, widgets: clampWidgetsToRows([...widgets, newWidget]) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave, groupSyms])
  const handlePeriodSortToTab = useCallback((widgetId, start, end, group = null) => {
    setPeriodSortPanel(null)
    setLayout(prev => {
      const target = prev.widgets.find(w => w.id === widgetId)
      if (!target) return prev
      const nextWidget = addWidgetTab(target, { type: 'periodsort', color: 'N', opts: { start, end, group: group || null } })
      const next = { ...prev, widgets: prev.widgets.map(w => w.id === widgetId ? { ...nextWidget, x: w.x, y: w.y, w: w.w, h: w.h } : w) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const [savedFlash, setSavedFlash] = useState(false)
  const savedFlashTimerRef = useRef(null)
  const flashSaved = useCallback(() => {
    setSavedFlash(true)
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1600)
  }, [])

  // ── Named layout templates (prebuilt + personal) ──
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { global: globalLayouts, mine: myLayouts, saveLayout, deleteLayout, isLoading: templatesLoading } = useChartLayouts()
  const [, setOpenMenuOpen] = useState(false)  // menu now nested under Layouts ▾
  const [, setSaveMenuOpen] = useState(false)  // nested under Layouts ▾
  // Which template's ✕ is awaiting delete confirmation (id), or null.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saveAsName, setSaveAsName] = useState('')
  const [saveAsScope, setSaveAsScope] = useState('user')  // 'user' | 'global' (admin)
  const [saveErr, setSaveErr] = useState('')

  // Apply a saved/prebuilt layout: restore the arrangement (+ its color-group
  // tickers) and persist so it sticks across refreshes. Runs through parseLayout
  // so any older-shaped template is normalized to the current grid.
  const applyTemplate = useCallback((tpl) => {
    if (!tpl?.layout?.widgets) return
    // PREBUILT (global-scope) templates are LOCKED: opening one must reset EVERY
    // per-user override so nothing from the previously-open layout — theme, chart
    // styling, watchlist columns, volume-pane height — carries over. Personal
    // templates keep the current styling (they don't force a reset).
    const isPrebuilt = (tpl.scope || 'user') === 'global'
    // Switch the ARRANGEMENT only — keep whatever tickers are currently loaded in
    // each color group. A template must not swap the stock you're looking at.
    // parseLayout keeps extra fields (`...parsed`), so pull chartSettings OUT of
    // the board layout — it belongs in the chart_settings pref, not the
    // charts_workspace_layout arrangement blob.
    const { chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns, ...boardLayout } = parseLayout(tpl.layout) || tpl.layout
    setLayout(boardLayout)
    setPref('charts_workspace_layout', JSON.stringify(boardLayout))
    // Restore the template's WIDGET appearance blobs (or defaults for a prebuilt/older
    // template that carries none) so a locked/prebuilt template never inherits the
    // user's personal widget styling. Watchlist / Theme Tracker / Fundamentals all
    // follow the same rule.
    setPref('watchlist_settings', JSON.stringify(watchlistSettings || WATCHLIST_DEFAULTS))
    setPref('theme_tracker_settings', JSON.stringify(themeTrackerSettings || THEME_TRACKER_DEFAULTS))
    setPref('fundamentals_settings', JSON.stringify(fundamentalsSettings || FUNDAMENTALS_DEFAULTS))
    setPref('breadth_widget_settings', JSON.stringify(breadthSettings || BREADTH_WIDGET_DEFAULTS))
    // Watchlist COLUMN config (added columns / widths / order — localStorage, not a
    // pref) rides the template too: owner-reported bug — added columns vanished after
    // switching layouts and back, because Save captured them nowhere and opening a
    // prebuilt wiped the localStorage key. Widgets remount on layout switch (new
    // widget ids), so they re-read this key on mount.
    try {
      if (watchlistColumns && typeof watchlistColumns === 'object') {
        localStorage.setItem('uct.watchlist.cols', JSON.stringify(watchlistColumns))
      } else if (isPrebuilt) {
        localStorage.removeItem('uct.watchlist.cols')
      }
    } catch { /* ignore */ }
    // Restore the chart settings the template was saved with, if it has them. A
    // PREBUILT template that carries none resets to the frozen default (never inherit
    // the previous layout's chart styling); a personal arrangement-only template
    // leaves the current settings untouched.
    if (chartSettings) {
      setPref('chart_settings', chartSettings)
    } else if (isPrebuilt) {
      setPref('chart_settings', uctDefaultChartSettings())
    }
    if (isPrebuilt) {
      // Wipe the standalone per-user overrides so a prebuilt layout always opens
      // clean: theme (e.g. TSDR Sunset), volume-pane height. (Watchlist columns
      // are handled by the watchlistColumns conditional above — restore when the
      // template carries them, wipe when a prebuilt carries none.)
      setChartsTheme('default')
      setPref('charts_vol_pane_pct', '')
    }
    // Remember which named template is now open, so "Save current arrangement"
    // can update THIS template in place with later edits. Persisted so the link
    // survives a refresh.
    setPref('charts_active_template', JSON.stringify({ id: tpl.id, name: tpl.name, scope: tpl.scope || 'user' }))
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, setChartsTheme, flashSaved])

  // Apply the LOCKED "UCT Default" template: the frozen layout shell + the frozen
  // chart_settings + the default theme. Everything is loaded FROM the in-code
  // constants and written to the working prefs; the constants are never written
  // back, so this is the immutable restore point — any edits the user made are
  // wiped by re-opening it. Color-group tickers are left as-is (Option A: content
  // loads live/personal, only the shell + settings are frozen).
  const applyUctDefault = useCallback(() => {
    const normalized = parseLayout(UCT_DEFAULT_LAYOUT) || UCT_DEFAULT_LAYOUT
    setLayout(normalized)
    setPref('charts_workspace_layout', JSON.stringify(normalized))
    // On the LIGHT app theme, UCT Default paints a WHITE chart (chartDefaultsForTheme
    // 'light') and light-theme widget appearances; on dark it keeps the frozen owner
    // capture + the dark defaults. Parsed fresh each apply so the constants are never
    // mutated.
    const appTheme = prefs.theme === 'light' ? 'light' : 'dark'
    setPref('chart_settings', appTheme === 'light' ? JSON.stringify(chartDefaultsForTheme('light')) : uctDefaultChartSettings())
    // Watchlist / Theme Tracker / Fundamentals / Breadth appearance are part of the
    // default too → reset them to the theme-appropriate defaults (light = white canvas
    // + #17a917/#db000b up/down), so no personal widget styling leaks onto UCT Default.
    setPref('watchlist_settings', JSON.stringify(watchlistDefaultsForTheme(appTheme)))
    setPref('theme_tracker_settings', JSON.stringify(themeTrackerDefaultsForTheme(appTheme)))
    setPref('fundamentals_settings', JSON.stringify(fundamentalsDefaultsForTheme(appTheme)))
    setPref('breadth_widget_settings', JSON.stringify(breadthDefaultsForTheme(appTheme)))
    setChartsTheme('default')
    try { localStorage.removeItem('uct.watchlist.cols') } catch { /* ignore */ }  // reset columns too (mirrors WL_COLS_LS)
    // Volume-pane height is a SEPARATE global per-user override (charts_vol_pane_pct)
    // that otherwise survives — reset it so a dragged pane snaps back to the default.
    setPref('charts_vol_pane_pct', '')
    // UCT Default is the frozen default, not a saved template → no active template.
    setPref('charts_active_template', 'null')
    setOpenMenuOpen(false)
    flashSaved()
  }, [setPref, setChartsTheme, flashSaved, prefs.theme])

  // The "default" layout (new users / no saved layout) = the frozen UCT Default
  // arrangement. (A DB "chart" prebuilt template, if one is ever added, still wins.)
  const resolveDefaultLayout = useCallback(() => {
    const byName = (arr) => arr.find(t => (t.name || '').trim().toLowerCase() === 'chart')
    const tpl = byName(globalLayouts) || byName(myLayouts)
    if (tpl?.layout?.widgets?.length) {
      return { layout: parseLayout(tpl.layout) || tpl.layout, groups: tpl.groups || null }
    }
    return { layout: parseLayout(UCT_DEFAULT_LAYOUT) || UCT_DEFAULT_LAYOUT, groups: null }
  }, [globalLayouts, myLayouts])

  // New users (no saved layout) open on the default; returning users keep their
  // most recent layout. Runs once, after prefs + templates settle.
  const appliedDefaultRef = useRef(false)
  useEffect(() => {
    if (appliedDefaultRef.current) return
    if (prefsLoading || templatesLoading) return
    if (parseLayout(prefs?.charts_workspace_layout)) { appliedDefaultRef.current = true; return }
    appliedDefaultRef.current = true
    const d = resolveDefaultLayout()
    setLayout(d.layout)
    if (d.groups) setGroupSymsState({ A: null, B: null, C: null, D: null, ...d.groups })
  }, [prefsLoading, templatesLoading, prefs?.charts_workspace_layout, resolveDefaultLayout])

  // New layout → wipe to a blank workspace (no widgets) so the user can build a
  // fresh board from scratch. Clears the color groups too. Persisted like any edit,
  // so a returning user stays on the blank board until they add a widget or open a
  // saved layout. (Named/saved layouts are untouched — only the working board is.)
  const handleNewLayout = useCallback(() => {
    const blank = { widgets: [], cols: GRID_COLS }
    setLayout(blank)
    setPref('charts_workspace_layout', JSON.stringify(blank))
    const g = { A: null, B: null, C: null, D: null }
    setGroupSymsState(g)
    setPref('charts_workspace_groups', JSON.stringify(g))
    // Reset the shared styling to the UCT DEFAULT so every widget you add to the new
    // board matches the default look instead of inheriting the previous layout's
    // personal styling (chart colors/volume, watchlist appearance + columns, theme).
    // Layout stays blank; a freshly-added watchlist widget mounts and re-reads the
    // reset column config from localStorage.
    setPref('chart_settings', uctDefaultChartSettings())
    setPref('watchlist_settings', JSON.stringify(WATCHLIST_DEFAULTS))
    setPref('theme_tracker_settings', JSON.stringify(THEME_TRACKER_DEFAULTS))
    setPref('fundamentals_settings', JSON.stringify(FUNDAMENTALS_DEFAULTS))
    setPref('breadth_widget_settings', JSON.stringify(BREADTH_WIDGET_DEFAULTS))
    setChartsTheme('default')
    try { localStorage.removeItem('uct.watchlist.cols') } catch { /* ignore */ }  // mirrors WL_COLS_LS in Watchlists.jsx
    // Blank board is not a named template.
    setPref('charts_active_template', 'null')
  }, [setPref, setChartsTheme])

  const handleSaveAsTemplate = useCallback(async () => {
    const nm = saveAsName.trim()
    if (!nm) { setSaveErr('Name required'); return }
    try {
      // Templates store the arrangement + the current CHART SETTINGS (so opening
      // one restores the exact chart look you saved) — but NEVER the tickers, so
      // opening a template never swaps the stock you're viewing. chartSettings is
      // nested in the layout blob (backend persists it as layout_json);
      // applyTemplate restores it. The frozen default settings are applied ONLY by
      // "UCT Default".
      const chartSettings = parsePref(prefs?.chart_settings, null)
      const watchlistSettings = parsePref(prefs?.watchlist_settings, null)
      const themeTrackerSettings = parsePref(prefs?.theme_tracker_settings, null)
      const fundamentalsSettings = parsePref(prefs?.fundamentals_settings, null)
      const breadthSettings = parsePref(prefs?.breadth_widget_settings, null)
      const watchlistColumns = readWatchlistColumns()
      const scope = isAdmin ? saveAsScope : 'user'
      const saved = await saveLayout({
        name: nm,
        layout: { ...layout, chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns },
        groups: null,
        scope,
      })
      // The just-saved template becomes the active one, so "Save current
      // arrangement" updates it going forward.
      if (saved?.id != null) {
        setPref('charts_active_template', JSON.stringify({ id: saved.id, name: saved.name || nm, scope: saved.scope || scope }))
      }
      setSaveAsName(''); setSaveErr(''); setSaveMenuOpen(false)
      flashSaved()
    } catch (e) {
      setSaveErr(e.message || 'Save failed')
    }
  }, [saveAsName, layout, prefs?.chart_settings, prefs?.watchlist_settings, prefs?.theme_tracker_settings, prefs?.fundamentals_settings, isAdmin, saveAsScope, saveLayout, setPref, flashSaved])

  // Explicit "Save current arrangement" — flush the debounced auto-save + persist
  // the working board immediately (the auto-save is debounced 500ms, so a refresh
  // within that window could otherwise lose the last change). If a NAMED template
  // is currently open, ALSO update that template in place with the current widgets
  // + chart settings, so reopening it reflects the edits. Only updates a template
  // the user can write (their own, or a global one when admin); a stale/deleted
  // active ref is ignored (just saves the working board).
  const handleSaveLayout = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setPref('charts_workspace_layout', JSON.stringify(layout))
    setPref('charts_workspace_groups', JSON.stringify(groupSyms))
    const active = parsePref(prefs?.charts_active_template, null)
    if (active?.id != null && (active.scope !== 'global' || isAdmin)) {
      const list = active.scope === 'global' ? globalLayouts : myLayouts
      if (list.some(t => t.id === active.id)) {
        const chartSettings = parsePref(prefs?.chart_settings, null)
        const watchlistSettings = parsePref(prefs?.watchlist_settings, null)
        const themeTrackerSettings = parsePref(prefs?.theme_tracker_settings, null)
        const fundamentalsSettings = parsePref(prefs?.fundamentals_settings, null)
        const breadthSettings = parsePref(prefs?.breadth_widget_settings, null)
        const watchlistColumns = readWatchlistColumns()
        try {
          await saveLayout({ name: active.name, layout: { ...layout, chartSettings, watchlistSettings, themeTrackerSettings, fundamentalsSettings, breadthSettings, watchlistColumns }, groups: null, scope: active.scope })
        } catch { /* surfaced by SWR revalidate */ }
      }
    }
    flashSaved()
  }, [layout, groupSyms, setPref, flashSaved, prefs?.charts_active_template, prefs?.chart_settings, prefs?.watchlist_settings, prefs?.theme_tracker_settings, prefs?.fundamentals_settings, isAdmin, globalLayouts, myLayouts, saveLayout])

  const handleDeleteTemplate = useCallback(async (id) => {
    try { await deleteLayout(id) } catch { /* surfaced by SWR revalidate */ }
    // If the layout you just deleted was the one open on screen, fall back to the
    // UCT Default so you're never left staring at a now-gone layout.
    const active = parsePref(prefs?.charts_active_template, null)
    if (active?.id === id) applyUctDefault()
  }, [deleteLayout, prefs?.charts_active_template, applyUctDefault])

  const [, setAddMenuOpen] = useState(false)  // nested under Widgets ▾

  const [popoutNotice, setPopoutNotice] = useState(null)

  // A popped widget stays in layout.widgets — it's only hidden from the grid — so
  // its position survives the trip and it docks straight back where it was.
  const handlePopOutWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const handleDockWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => prev.filter(x => x !== id))
  }, [])
  // Closing a widget from inside its own window should delete it, not dock it.
  const handleRemovePoppedWidget = useCallback((id) => {
    setPoppedWidgetIds(prev => prev.filter(x => x !== id))
    handleRemoveWidget(id)
  }, [handleRemoveWidget])

  // ── In-canvas float: pop a widget onto another widget, dock it back, move it
  //    into another widget's tabs, or close it. Mirrors the pop-out handlers. ──
  const handleFloatWidget = useCallback((id) => {
    setFloatingWidgetIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const handleDockFloatWidget = useCallback((id) => {
    // Drop the float flag → the widget snaps back to its saved grid slot (its
    // geometry never left layout.widgets).
    setFloatingWidgetIds(prev => prev.filter(x => x !== id))
  }, [])
  const handleRemoveFloatWidget = useCallback((id) => {
    setFloatingWidgetIds(prev => prev.filter(x => x !== id))
    handleRemoveWidget(id)
  }, [handleRemoveWidget])
  const handleFloatWidgetToTab = useCallback((floatId, targetId) => {
    if (floatId === targetId) return
    setFloatingWidgetIds(prev => prev.filter(x => x !== floatId))
    setLayout(prev => {
      const src = prev.widgets.find(w => w.id === floatId)
      const target = prev.widgets.find(w => w.id === targetId)
      if (!src || !target) return prev
      // Move the source widget's base definition in as a new tab of the target,
      // then delete the source (it now lives inside the target's tab group).
      const nextTarget = addWidgetTab(target, { type: src.type, color: src.color, opts: src.opts })
      const widgets = prev.widgets
        .filter(w => w.id !== floatId)
        .map(w => (w.id === targetId ? { ...nextTarget, x: w.x, y: w.y, w: w.w, h: w.h } : w))
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Deliberately NOT done inside a setLayout updater: React invokes updaters
  // twice under StrictMode, which would queue a second popped board and open a
  // duplicate window.
  const handlePopOutLayout = useCallback(() => {
    const live = layout.widgets.filter(w => !poppedWidgetIds.includes(w.id))
    if (!live.length) return
    setPoppedLayouts(ls => [...ls, { id: `pl-${Date.now()}`, widgets: live }])
    // Main goes back to a blank board so another layout can be built and popped
    // onto the next monitor.
    const next = { ...layout, widgets: layout.widgets.filter(w => poppedWidgetIds.includes(w.id)) }
    setLayout(next)
    scheduleSave(next)
  }, [layout, poppedWidgetIds, scheduleSave])

  const handleDockLayout = useCallback((popId, returning) => {
    setPoppedLayouts(ls => ls.filter(l => l.id !== popId))
    setLayout(prev => {
      // Straight back into an empty board. If a new layout has been built here
      // meanwhile, re-place the returning widgets so they don't land on top of it.
      let widgets
      if (!prev.widgets.length) {
        widgets = returning
      } else {
        widgets = [...prev.widgets]
        for (const w of returning) {
          // minW/minH come from the type defaults, but w/h must be the widget's
          // OWN size — spreading the defaults last would resize every docking
          // widget back to its type's default dimensions.
          const spec = { ...(WIDGET_DEFAULTS[w.type] || {}), w: w.w, h: w.h }
          widgets.push({ ...w, ...findPlacement(widgets, spec, COLS.lg, FIXED_ROWS) })
        }
      }
      const next = { ...prev, widgets: clampWidgetsToRows(widgets) }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // ── Multi-Chart grid mode (fixed N×M grid of independent chart cells) ──
  const mc = useMultiChartState()
  const [, setMcMenuOpen] = useState(false)  // nested under Layouts ▾
  // Consolidated top-level toolbar dropdowns: "Widgets" and "Layouts". Each shows a small
  // action list; `*Sub` picks a nested panel (e.g. the widget-type list or the save form).
  const [widgetsMenuOpen, setWidgetsMenuOpen] = useState(false)
  const [widgetsSub, setWidgetsSub] = useState(null)   // null | 'add'
  const [layoutsMenuOpen, setLayoutsMenuOpen] = useState(false)
  const [layoutsSub, setLayoutsSub] = useState(null)   // null | 'open' | 'save' | 'mc'
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false)
  const closeToolbarMenus = useCallback(() => {
    setWidgetsMenuOpen(false); setWidgetsSub(null)
    setLayoutsMenuOpen(false); setLayoutsSub(null); setToolsMenuOpen(false)
    setAddMenuOpen(false); setOpenMenuOpen(false); setSaveMenuOpen(false); setMcMenuOpen(false)
  }, [])
  // (Flyout grace-timer machinery removed: Multi Chart is now its own header
  // button with a plain click-toggled dropdown — the hover flyout it guarded
  // no longer exists, which structurally fixes mega-review #10/#16.)
  // ?gridspike=N (admin-only) forces grid mode for the perf harness.
  const gridSpikeRequested = isAdmin && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('gridspike')
  const gridMode = mc.state.mode === 'grid' || gridSpikeRequested

  // Ctrl+Alt+J with NO hovered chart: every ChartWidget declines (capture
  // demands an explicit owner — see the widget's own listener) and the press
  // died silently (panel finding: a no-op hotkey teaches "it's broken"). One
  // workspace-level listener names the gesture. Grid cells don't implement
  // capture, so the hint would mislead there.
  const [jwHotkeyMsg, setJwHotkeyMsg] = useJournalToast()
  const jwHotkeyCtx = useRef({ gridMode })
  jwHotkeyCtx.current = { gridMode }
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey && e.altKey && (e.key === 'j' || e.key === 'J'))) return
      if (jwHotkeyCtx.current.gridMode) return
      if (activeChartRef.current != null) return
      e.preventDefault()
      setJwHotkeyMsg('Hover a chart first — Ctrl+Alt+J captures the hovered chart')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Grid-kind templates live in the same /api/charts/layouts store; keep them
  // out of the workspace Open-layout menu (their {widgets:[]} shape would
  // apply as a blank board) — the Multi Charts dropdown lists them instead.
  const wsGlobalLayouts = globalLayouts.filter(t => t.layout?.kind !== 'multichart')
  const wsMyLayouts = myLayouts.filter(t => t.layout?.kind !== 'multichart')

  if (isMobile) {
    // Phone: tabbed widget stack (RGL drag/resize doesn't fit a phone). Rendered
    // inside the provider so widgets keep color-group ticker linking. Grid mode
    // renders as a vertically stacked cell list (its own @media CSS).
    return (
      <WorkspaceContext.Provider value={workspaceValue}>
        {gridMode ? (
          <div className={styles.workspace} data-charts-theme={chartsTheme} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Phone toolbar: grid mode persists from desktop, and without an
                exit control a phone user is TRAPPED in it (mega-review #15 —
                the desktop entry flyout doesn't exist on phone). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #2a3340)', flex: '0 0 auto' }}>
              <span style={{ fontSize: 12, color: 'var(--ut-gold, #c9a84c)', fontWeight: 600 }}>▦ Multi Chart</span>
              <button
                type="button"
                className={styles.toolbarBtn}
                style={{ marginLeft: 'auto' }}
                onClick={() => mc.exitGrid()}
              >Exit Multi Chart</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <MultiChartGrid mc={mc} />
            </div>
          </div>
        ) : (
          <MobileWorkspace
            widgets={layout.widgets}
            onRemove={handleRemoveWidget}
            onColorChange={handleColorChange}
            onOptsChange={handleOptsChange}
            onAddWidget={handleAddWidget}
          />
        )}
      </WorkspaceContext.Provider>
    )
  }

  // A popped-out widget is hidden from the board but KEPT in layout.widgets: its
  // slot frees up and the grid recompacts while it's away, and its stored
  // position is still there to dock back into.
  const visibleWidgets = layout.widgets.filter(w => !poppedWidgetIds.includes(w.id) && !floatingWidgetIds.includes(w.id))
  const poppedWidgets = layout.widgets.filter(w => poppedWidgetIds.includes(w.id))
  // Floating widgets stay in layout.widgets (geometry preserved for docking) but are
  // hidden from the grid and rendered in FloatingWidgetPanels over the canvas.
  const floatingWidgets = layout.widgets.filter(w => floatingWidgetIds.includes(w.id) && !poppedWidgetIds.includes(w.id))

  // ONE grid renderer, shared by the main board and every popped-out board. The
  // RGL configuration (viewport lock, 24 columns, computed row height) is
  // defined once here so a board on another monitor can't drift out of sync with
  // the workspace it came from.
  const renderGrid = (widgets, h, rowHeightOverride, widthOverride) => {
    // A popped-out board passes an explicit width (measured against its OWN
    // window); the main board leaves it undefined and uses WidthProvider's
    // auto-measurement.
    const GridComp = widthOverride > 0 ? Responsive : ResponsiveGridLayout
    const widthProps = widthOverride > 0 ? { width: widthOverride } : {}
    return (
    <GridComp
      className={`layout${resizingId ? ' charts-resizing' : ''}`}
      {...widthProps}
      layouts={{
        lg: widgets.map(w => {
          const defaults = WIDGET_DEFAULTS[w.type] || {}
          return {
            i: w.id, x: w.x, y: w.y, w: w.w, h: w.h,
            minW: defaults.minW || 4, minH: defaults.minH || 3,
          }
        }),
      }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={rowHeightOverride ?? rowHeight}
      maxRows={FIXED_ROWS}
      isBounded={true}
      onLayoutChange={h.onLayoutChange}
      draggableHandle=".charts-widget-drag-handle"
      isDraggable={!merged}
      /* RGL's own resize is OFF when we supply custom handles (main board) — see
         the "Custom resize" comment on startResize for why. Popped-out boards
         (no onStartResize) keep RGL's built-in resize. */
      isResizable={!merged && !h.onStartResize}
      /* Free placement (no vertical compaction): a widget stays exactly where the
         user drops or sizes it. Under the old "vertical" compaction, shrinking a
         widget from its top edge made it float back up to fill the space above —
         it wouldn't stay on the bottom half where the user put it. */
      compactType={null}
      /* DRAG-move: preventCollision keeps a dragged widget from shoving a neighbour
         off the fixed-row viewport (it just can't drop onto occupied space).
         Resize yield (shrink the neighbour) is handled by our custom overlay, not
         RGL. Make-room-on-ADD is handled in handleAddWidget (reserveBottomStrip). */
      preventCollision={true}
      margin={[gridGap, gridGap]}
      resizeHandles={['nw', 'ne', 'sw', 'se']}
      /* Position grid items with top/left, NOT transform: translate().
         RGL's default CSS-transform positioning composites each widget's
         chart <canvas> onto a GPU layer that, under fractional Windows
         display scaling, gets resampled at a non-integer device-pixel
         offset — blurring + desaturating the candles. top/left keeps the
         canvas on the root layer so it paints crisp (matches Setup Library). */
      useCSSTransforms={false}
    >
      {widgets.map(w => {
        // Another widget sits DIRECTLY above this one (its bottom edge touches
        // this widget's top edge and their columns overlap) → drop this widget's
        // header to the bottom so the two blend at the seam.
        const hasAbove = widgets.some(o =>
          o.id !== w.id
          && (o.y + o.h) === w.y
          && o.x < w.x + w.w && w.x < o.x + o.w,
        )
        return (
          <div key={w.id}>
            <WidgetHost
              widget={w}
              headerAtBottom={hasAbove}
              merged={merged}
              onRemove={() => h.onRemove(w.id)}
              onColorChange={(c) => h.onColorChange(w.id, c)}
              onOptsChange={(opts) => h.onOptsChange(w.id, opts)}
              onReplaceWidget={h.onReplaceWidget}
              onPopOut={h.onPopOut ? () => h.onPopOut(w.id) : undefined}
              onFloat={h.onFloat ? () => h.onFloat(w.id) : undefined}
            />
            {/* Custom resize handles (main board only) — drive layout state
                directly so a neighbour shrinks live as you drag an edge into it.
                8 handles: 4 edges + 4 corners (corners carry the gold "L" mark). */}
            {!merged && h.onStartResize && CUSTOM_RESIZE_HANDLES.map(({ dir, style, cursor, corner }) => (
              <div
                key={dir}
                onPointerDown={(e) => h.onStartResize(e, w, dir)}
                className={corner ? `${styles.rzHandle} ${styles.rzCorner} ${styles['rz_' + dir]}` : styles.rzHandle}
                style={{ ...style, cursor }}
              />
            ))}
            {/* Gold placeholder highlight while THIS widget is being resized. */}
            {resizingId === w.id && <div className={styles.rzPlaceholder} />}
          </div>
        )
      })}
    </GridComp>
    )
  }

  const mainGridHandlers = {
    onLayoutChange: handleLayoutChange,
    onStartResize: startResize,
    onRemove: handleRemoveWidget,
    onColorChange: handleColorChange,
    onOptsChange: handleOptsChange,
    onReplaceWidget: handleReplaceWidget,
    onPopOut: handlePopOutWidget,
    onFloat: handleFloatWidget,
  }

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div className={styles.workspace} data-charts-theme={chartsTheme}>
        {/* Workspace-level capture-hotkey hint (fixed: it answers a keypress
            that has no widget anchor). Below the popup band (8500+). */}
        <JournalToast msg={jwHotkeyMsg} style={{ position: 'fixed', top: 58, right: 16, zIndex: 8400 }} />
        <header className={styles.workspaceHeader}>
          <span className={styles.workspaceTitle}><UIcon name="equity" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Charts</span>
          {/* WIDGETS — add a widget (opens the widget-type menu) or merge the board. */}
          {!gridMode && (
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => { const n = !widgetsMenuOpen; closeToolbarMenus(); setWidgetsMenuOpen(n) }}
            >Widgets ▾</button>
            {widgetsMenuOpen && (
              <div className={styles.addMenu} onMouseLeave={() => { setWidgetsMenuOpen(false); setWidgetsSub(null) }}>
                {widgetsSub === 'add' ? (<>
                  <button type="button" className={styles.addMenuItem} onClick={() => setWidgetsSub(null)}>‹ Back</button>
                  <div className={styles.menuDivider} />
                  {WIDGET_TYPES.map(t => (
                    <button
                      key={t}
                      type="button"
                      className={styles.addMenuItem}
                      onClick={() => { handleAddWidget(t); setWidgetsMenuOpen(false); setWidgetsSub(null) }}
                    >{WIDGET_LABELS[t]}</button>
                  ))}
                </>) : (<>
                  <button type="button" className={styles.addMenuItem} onClick={() => setWidgetsSub('add')}>＋ Add Widget ▸</button>
                  <button
                    type="button"
                    className={styles.addMenuItem}
                    style={merged ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
                    onClick={() => { toggleMerged(); setWidgetsMenuOpen(false) }}
                    title={merged
                      ? 'Unlock the board and restore widget borders'
                      : 'Lock the board in place, remove all borders, and blend every widget together'}
                  >{merged ? '⧉ Unmerge Widgets' : '⧉ Merge Widgets'}</button>
                </>)}
              </div>
            )}
          </div>
          )}

          {/* LAYOUTS — new / open / save / multi-chart / pop-out. Shown in BOTH modes;
              grid mode surfaces only the layout-relevant actions (Open + Multi Chart). */}
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              style={gridMode ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
              onClick={() => { const n = !layoutsMenuOpen; closeToolbarMenus(); setLayoutsMenuOpen(n) }}
            >Layouts ▾</button>
            {layoutsMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 230 }} onMouseLeave={() => { setLayoutsMenuOpen(false); setLayoutsSub(null); setConfirmDeleteId(null) }}>
                {layoutsSub === 'open' ? (<>
                  <button type="button" className={styles.addMenuItem} onClick={() => setLayoutsSub(null)}>‹ Back</button>
                  <div className={styles.menuDivider} />
                  <div className={styles.menuSection}>Prebuilt</div>
                  <div className={styles.menuRow}>
                    <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => { applyUctDefault(); closeToolbarMenus() }}>UCT Default</button>
                  </div>
                  {wsGlobalLayouts.map(t => (
                    <div key={`g${t.id}`} className={styles.menuRow}>
                      <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => { applyTemplate(t); if (gridMode) mc.exitGrid(); closeToolbarMenus() }}>{t.name}</button>
                      {isAdmin && (confirmDeleteId === t.id ? (
                        <DeleteConfirm onYes={() => { handleDeleteTemplate(t.id); setConfirmDeleteId(null) }} onCancel={() => setConfirmDeleteId(null)} />
                      ) : (
                        <button type="button" className={styles.menuDel} title="Delete prebuilt template" onClick={() => setConfirmDeleteId(t.id)}>✕</button>
                      ))}
                    </div>
                  ))}
                  {wsMyLayouts.length > 0 && <div className={styles.menuSection}>My layouts</div>}
                  {wsMyLayouts.map(t => (
                    <div key={`m${t.id}`} className={styles.menuRow}>
                      <button type="button" className={styles.addMenuItem} style={{ flex: 1 }} onClick={() => { applyTemplate(t); if (gridMode) mc.exitGrid(); closeToolbarMenus() }}>{t.name}</button>
                      {confirmDeleteId === t.id ? (
                        <DeleteConfirm onYes={() => { handleDeleteTemplate(t.id); setConfirmDeleteId(null) }} onCancel={() => setConfirmDeleteId(null)} />
                      ) : (
                        <button type="button" className={styles.menuDel} title="Delete" onClick={() => setConfirmDeleteId(t.id)}>✕</button>
                      )}
                    </div>
                  ))}
                </>) : layoutsSub === 'save' ? (<>
                  <button type="button" className={styles.addMenuItem} onClick={() => setLayoutsSub(null)}>‹ Back</button>
                  <div className={styles.menuDivider} />
                  <button type="button" className={styles.addMenuItem} onClick={() => { handleSaveLayout(); closeToolbarMenus() }}>Save current arrangement</button>
                  <div className={styles.menuDivider} />
                  <div className={styles.menuForm}>
                    <div className={styles.menuSection} style={{ padding: 0 }}>Save as template</div>
                    <input
                      className={styles.menuInput}
                      placeholder="Template name"
                      value={saveAsName}
                      maxLength={60}
                      onChange={e => { setSaveAsName(e.target.value); setSaveErr('') }}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveAsTemplate() }}
                    />
                    {isAdmin && (
                      <label className={styles.menuCheck}>
                        <input type="checkbox" checked={saveAsScope === 'global'} onChange={e => setSaveAsScope(e.target.checked ? 'global' : 'user')} />
                        Prebuilt (available to all users)
                      </label>
                    )}
                    <button type="button" className={styles.toolbarBtn} style={{ alignSelf: 'flex-start' }} onClick={handleSaveAsTemplate}>Save template</button>
                    {saveErr && <div className={styles.menuErr}>{saveErr}</div>}
                  </div>
                </>) : layoutsSub === 'mc' ? (
                  <MultiChartMenu mc={mc} onClose={() => { setLayoutsMenuOpen(false); setLayoutsSub(null) }} />
                ) : (<>
                  {!gridMode && <button type="button" className={styles.addMenuItem} onClick={() => { handleNewLayout(); closeToolbarMenus() }}>New Layout</button>}
                  <button type="button" className={styles.addMenuItem} onClick={() => setLayoutsSub('open')}>Open Layout ▸</button>
                  {!gridMode && <button type="button" className={styles.addMenuItem} onClick={() => setLayoutsSub('save')}>{savedFlash ? 'Saved ✓' : 'Save Layout ▸'}</button>}
                  <button
                    type="button"
                    className={styles.addMenuItem}
                    style={gridMode ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
                    onClick={() => setLayoutsSub('mc')}
                  >{gridMode ? '✓ ' : ''}▦ Multi Chart ▸</button>
                  {!gridMode && (
                    <button type="button" className={styles.addMenuItem} disabled={!visibleWidgets.length} onClick={() => { handlePopOutLayout(); closeToolbarMenus() }}>⧉ Pop Out Layout</button>
                  )}
                </>)}
              </div>
            )}
          </div>

          {/* TOOLS — chart-analysis utilities. Custom-Period Sort ranks the whole US
              market by % change over a time period you highlight on the chart. */}
          {!gridMode && (
          <div className={styles.toolbarBtnGroup} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.toolbarBtn}
              style={periodSortMode ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
              onClick={() => { const n = !toolsMenuOpen; closeToolbarMenus(); setToolsMenuOpen(n) }}
            >Tools ▾</button>
            {toolsMenuOpen && (
              <div className={styles.addMenu} style={{ minWidth: 200 }} onMouseLeave={() => setToolsMenuOpen(false)}>
                <button
                  type="button"
                  className={styles.addMenuItem}
                  style={periodSortMode ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
                  onClick={() => { setPeriodSortSel(null); setPeriodSortMode(true); closeToolbarMenus() }}
                >{periodSortMode ? '✓ ' : ''}Custom-Period Sort</button>
                <button
                  type="button"
                  className={styles.addMenuItem}
                  style={compareOpen ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
                  onClick={() => { openCompare(); closeToolbarMenus() }}
                >{compareOpen ? '✓ ' : ''}Compare Symbols</button>
                <button
                  type="button"
                  className={styles.addMenuItem}
                  style={replayCutoff ? { color: 'var(--ut-gold, #c9a84c)' } : undefined}
                  onClick={() => { openReplay(); closeToolbarMenus() }}
                >{replayCutoff ? '✓ ' : ''}Replay Mode</button>
              </div>
            )}
          </div>
          )}

          {gridMode && (
            <button type="button" className={styles.toolbarBtn} onClick={mc.exitGrid}>
              Workspace
            </button>
          )}
        </header>
        <main className={`${styles.workspaceBody} ${merged ? styles.workspaceBodyMerged : ''}`} ref={bodyRef}>
          {gridMode ? (
            <MultiChartGrid mc={mc} />
          ) : renderGrid(visibleWidgets, mainGridHandlers)}
          {/* Merged mode: draggable seams between adjacent widgets (TC2000-style
              split-pane resize). RGL's own drag/resize is off while merged, so
              these bars are the only way to resize — grow one widget, shrink its
              neighbor, board stays gapless. */}
          {merged && !gridMode && gridWidth > 0 && (
            <MergedSeamOverlay
              widgets={visibleWidgets}
              cols={GRID_COLS}
              rows={FIXED_ROWS}
              colWidth={gridWidth / GRID_COLS}
              rowHeight={rowHeight}
              minWFor={minWFor}
              minHFor={minHFor}
              onResize={handleSeamResize}
            />
          )}
        </main>

        {/* Pop-outs live OUTSIDE <main> but INSIDE the provider: each renders
            through a portal into its own OS window, while its state, hooks and
            data subscriptions stay in this tab. That's what lets every monitor
            share this tab's single live-price/bars stream pool. */}
        {poppedWidgets.map(w => (
          <PopoutWindow
            key={w.id}
            title={`UCT — ${WIDGET_LABELS[w.type] || w.type}`}
            width={900}
            height={700}
            onClose={() => handleDockWidget(w.id)}
            onBlocked={() => { handleDockWidget(w.id); setPopoutNotice(POPUP_BLOCKED_MSG) }}
          >
            <PopoutShell theme={chartsTheme}>
              <WidgetHost
                widget={w}
                merged={false}
                onRemove={() => handleRemovePoppedWidget(w.id)}
                onColorChange={(c) => handleColorChange(w.id, c)}
                onOptsChange={(opts) => handleOptsChange(w.id, opts)}
                onReplaceWidget={handleReplaceWidget}
              />
            </PopoutShell>
          </PopoutWindow>
        ))}

        {poppedLayouts.map(pl => (
          <PoppedLayout
            key={pl.id}
            title="UCT — Layout"
            theme={chartsTheme}
            initialWidgets={pl.widgets}
            renderGrid={renderGrid}
            computeRowHeight={computeRowHeight}
            initialRowHeight={rowHeight}
            merged={merged}
            onClose={(widgets) => handleDockLayout(pl.id, widgets)}
            onBlocked={(widgets) => { handleDockLayout(pl.id, widgets); setPopoutNotice(POPUP_BLOCKED_MSG) }}
          />
        ))}

        {popoutNotice && (
          <div className={styles.popoutNotice} role="alert">
            {popoutNotice}
            <button type="button" onClick={() => setPopoutNotice(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Custom-Period Sort: config popover (after a drag) → results panel. */}
        {periodSortSel && (
          <PeriodSortConfig
            sel={periodSortSel}
            onCancel={() => setPeriodSortSel(null)}
            onSort={(start, end, replay, group, tf, markStart) => {
              setPeriodSortSel(null)
              setPeriodSortPanel({ start, end, group: group || null })
              // Replay: cut every linked chart off at the End date (ISO). Off = clear it.
              const s = String(end)
              setReplayCutoff(replay ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)
              // Mark start date on every chart: gold vertical line ('line') or gold start
              // candle ('candle'). 'off' → no marker.
              const st = String(start)
              setStartMarker(markStart && markStart !== 'off' ? `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}` : null)
              if (markStart === 'line' || markStart === 'candle') setStartMarkerStyle(markStart)
              // Timeframe: switch every chart to the chosen D/W/M (composes with replay).
              applyTfToCharts(tf)
            }}
          />
        )}
        {periodSortPanel && (
          <PeriodSortPanel
            start={periodSortPanel.start}
            end={periodSortPanel.end}
            group={periodSortPanel.group}
            onClose={() => setPeriodSortPanel(null)}
            onDock={() => handleDockPeriodSort(periodSortPanel.start, periodSortPanel.end, periodSortPanel.group)}
            tabTargets={visibleWidgets.map(w => ({ id: w.id, label: WIDGET_LABELS[w.type] || w.type }))}
            onAddAsTab={(widgetId) => handlePeriodSortToTab(widgetId, periodSortPanel.start, periodSortPanel.end, periodSortPanel.group)}
          />
        )}
        {/* In-canvas floating widgets — popped off the grid to sit on top of another
            widget (e.g. a Watchlist over a Chart). Each opens near the size of the
            grid slot it left. Its header carries dock / move-to-tab / close. */}
        {floatingWidgets.map((w, i) => (
          <FloatingWidgetPanel
            key={w.id}
            offset={i * 28}
            initialW={Math.max(260, Math.round((w.w || 6) * (gridWidth / GRID_COLS)))}
            initialH={Math.max(200, Math.round((w.h || 8) * rowHeight))}
          >
            {({ onDragPointerDown }) => (
              <WidgetHost
                widget={w}
                merged={false}
                floating
                onHeaderDragStart={onDragPointerDown}
                onDock={() => handleDockFloatWidget(w.id)}
                onRemove={() => handleRemoveFloatWidget(w.id)}
                floatTabTargets={visibleWidgets.map(t => ({ id: t.id, label: WIDGET_LABELS[t.type] || t.type }))}
                onFloatToTab={(targetId) => handleFloatWidgetToTab(w.id, targetId)}
                onColorChange={(c) => handleColorChange(w.id, c)}
                onOptsChange={(opts) => handleOptsChange(w.id, opts)}
                onReplaceWidget={handleReplaceWidget}
              />
            )}
          </FloatingWidgetPanel>
        ))}
        {compareOpen && (
          <CompareSymbolsPanel
            chartApiById={chartApiByIdRef}
            activeChartRef={activeChartRef}
            onClose={() => setCompareOpen(false)}
          />
        )}
        {replayOpen && (
          <ReplayPanel
            active={!!replayCutoff}
            cutoff={replayCutoff}
            onStart={startReplay}
            onArmPick={armReplayPick}
            onExit={exitReplayMode}
            onClose={() => setReplayOpen(false)}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  )
}
