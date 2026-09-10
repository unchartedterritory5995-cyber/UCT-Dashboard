// app/src/components/chart/ChartDrawingOverlay.jsx — Canvas overlay for chart annotations
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from './ColorPanel'
import isModalOpen from '../../utils/modalOpen'
import { matchOverlayTool } from './keyboardShortcuts'
import { hitThreshold, crossedDragSlop, useCoarsePointer } from './coarsePointer'
import { fmtLevel, visibleOnly } from './drawingObjects'
import { brightenAnnotationColor, autoLabelInk, UCT_DRAW_GOLD } from './drawingColors'
import {
  computeAdvanceMove, constrainPoints, handleDragGain, handlePointsFor,
  hitTestDrawing, offsetPoints, pointInBox,
} from './drawingGeometry'
import {
  advanceLines, fieldsFor, inferBarSeconds, labelPosOf, measureLines, measurementFor,
} from './drawingMeasure'
import { dashFor } from './drawingStyle'
import { priceFormatterFor } from './drawingLabels'
import { drawingProp } from './drawingSchema'
import { sectionsFor, defaultsPayloadFor, newDrawingProps } from './drawingSettingsSchema'
import {
  PRICE, resolveZones, paneKeyAtY, rectForKey, inferPaneKey,
  toPaneFraction, fromPaneFraction,
} from './drawingPanes'
import {
  renderTrendline, renderRay, renderExtended, renderHorizontal, renderHRay, renderVertical,
  renderRect, renderCircle, renderArrow, renderCup, renderText, renderAdvance,
  renderFib, renderFibExtension, renderPitchfork, renderChannel, renderMeasure,
  renderPosition, renderAnchoredVwap, renderSelectionHandles, renderCrosshair,
  renderBarsTime,
} from './drawingRenderers'

// ─── Tool definitions ────────────────────────────────────────────────────────
const POINT_COUNT = {
  trendline: 2, ray: 2, extended: 2, horizontal: 1, hray: 1, vertical: 1,
  rect: 2, circle: 2, arrow: 2, text: 1, fib: 2, fibext: 2, channel: 3, measure: 2, avwap: 1,
  pitchfork: 3, advance: 2, cup: 3,
  priceRange: 2, dateRange: 2, position: 3,
}

// ⛔ THE KEY→TOOL MAPS USED TO LIVE HERE, restating Alt chords that `SHORTCUTS`
// already declared and adding two of their own — `Shift+F` → fibext and
// `Shift+P` → pitchfork — which collided with the flag-ticker chord. They now
// live beside the help sheet as `matchOverlayTool`, one authority for both.

// How many bars past the last candle a drawing point may be placed/dragged (into
// the empty right-pad — e.g. extending a trendline forward). Bounded so a stray
// far-right click can't fling a point thousands of bars into the void.
const FUTURE_BARS_CAP = 500

// ⛔ THE RENDERERS, THE GEOMETRY, THE HIT TESTS AND THE COLOUR RULES USED TO
// LIVE HERE — roughly 750 lines of them, module-private inside a React
// component whose canvas maps no coordinates under jsdom. That is why this
// layer's tests read SOURCE TEXT instead of running anything, and why the audit
// could describe the Pitchfork and Parallel Channel geometry bugs but no test
// could fail on them. They now live beside this file as plain functions over
// plain numbers, MOVED VERBATIM (Phase 0 is behaviour-neutral by contract), and
// `drawingGeometry.test.js` / `drawingRenderers.test.js` execute them.
//
// What deliberately did NOT move: `resolveCatalystAnchor` and
// `placeCalloutPoint` below. They are News-widget callout PLACEMENT, not drawing
// tools, they are outside this project's blast radius, and one of them already
// has its own test importing it from here.
/**
 * Narrow the current clip to a pane rect.
 *
 * THE CALLER MUST ALREADY HAVE CALLED ctx.save(). Canvas clips only ever
 * INTERSECT - there is no "unclip" - so the only way back out is the matching
 * restore(), and this helper deliberately does not save() for you: a helper that
 * saved without restoring would be a stack leak that shows up three drawings
 * later, or in the share PNG and nowhere on screen.
 *
 * A null rect is a no-op rather than an error: the fallbacks in drawingPanes all
 * resolve to the whole plot, and "clip to nothing" would make a drawing vanish -
 * which is indistinguishable, to the user, from having lost it.
 */
function clipToPane(ctx, rect) {
  if (!rect) return
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0
  if (!(w > 0) || !(h > 0)) return
  ctx.beginPath()
  ctx.rect(rect.x0, rect.y0, w, h)
  ctx.clip()
}

const LEVEL_LINE_TYPES = new Set(['trendline', 'ray', 'extended', 'horizontal', 'hray'])
const ALERT_BIND_KEY = 'uct.chart.alertBind'   // 'bound' (default) | 'fixed'
const SLOPED_LINE_TYPES = new Set(['trendline', 'ray', 'extended'])
// Coarse pointers (finger/stylus) need a bigger grab radius than a mouse.
//
// ⛔ THESE ARE FUNCTIONS, NOT CONSTANTS, AND THAT IS THE POINT. They were
// `const HIT_THRESHOLD = _COARSE_POINTER ? 15 : 8` — evaluated ONCE at module
// import, so a chart could never change pointer type for the life of the
// bundle. An iPad that gains or loses a Magic Keyboard flips `(pointer: coarse)`
// mid-session, and an emulated coarse pointer could never reach this branch at
// all, which is why four coarse-pointer drawing behaviours were unverifiable in
// the 2026-09 mobile teardown. `coarsePointer.js` owns the live answer; call it
// at USE time and never hoist the result into a module-scope constant again.
//
// Selection-handle PAINT radius: the grab zone was already coarse-aware but the
// dot itself stayed 4px — finger users couldn't SEE what was grabbable. On touch
// the dot grows and renderSelectionHandles adds a halo sized to the real hit
// zone, so the affordance matches it.
const HIT_THRESHOLD = () => hitThreshold()
// Same shape as HIT_THRESHOLD: a FUNCTION, never a module-load constant — the
// pointer answer must be read when the gesture happens, not when the file loads.
const CROSSED_SLOP = (startPixel, pos) => crossedDragSlop(startPixel, pos)
// One-time "tap two points" coach chip for multi-point tools on touch —
// single flag across all tools (the voice.dictation.hintSeen idiom).
const TAP_HINT_LS = 'uct.drawings.tapHintSeen'

// In-memory clipboard for copy/paste of a drawing — module-level so a copy on one
// chart can be pasted onto another (any symbol). Holds a drawing minus its id.
let _drawingClipboard = null

// 'YYYY-MM-DD' in America/New_York for a unix-seconds bar time. Formatter built
// once (Intl construction is the expensive part).
const _etDateFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  : null
function etDateStr(tSeconds) {
  if (!_etDateFmt) return null
  try { return _etDateFmt.format(new Date(tSeconds * 1000)) } catch { return null }
}

// Resolve a catalyst's anchor to a bar index. A catalyst carries only a DATE
// ('YYYY-MM-DD'). On a DAILY/WEEKLY chart that maps straight to a bar via
// nearestIndex. On an INTRADAY chart the bars are numeric epochs, so the date
// would fail nearestIndex's type check (returning null → the callout never
// places). Instead we snap to the candle where the news actually broke: the FIRST
// high-volume candle of that ET session (fallback: the day's max-volume candle).
// Binary-searched to a mid-day seed so it's cheap even when the day isn't loaded.
export function resolveCatalystAnchor(anchorTime, bars, nearestIndex) {
  if (!bars?.length) return null
  const intraday = typeof bars[0].t === 'number'
  const isDate = typeof anchorTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchorTime)
  if (!intraday || !isDate) return nearestIndex(anchorTime)
  const day = anchorTime.slice(0, 10)
  const approx = Math.floor(Date.parse(`${day}T16:30:00Z`) / 1000)   // ~12:30 ET seed
  if (!Number.isFinite(approx)) return nearestIndex(anchorTime)
  let lo = 0, hi = bars.length - 1, seed = 0
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= approx) { seed = m; lo = m + 1 } else hi = m - 1 }
  const idxs = []
  for (let i = seed; i >= 0; i--) { if (etDateStr(bars[i].t) === day) idxs.unshift(i); else break }
  for (let i = seed + 1; i < bars.length; i++) { if (etDateStr(bars[i].t) === day) idxs.push(i); else break }
  if (!idxs.length) return null   // day not loaded → defer (don't fall back to a wrong bar)
  const volOf = (i) => Number(bars[i].v ?? bars[i].volume ?? 0)
  const rngOf = (i) => {
    const h = bars[i].h ?? bars[i].high, l = bars[i].l ?? bars[i].low
    return (h != null && l != null) ? Math.abs(h - l) : 0
  }
  // Session averages to measure EXPANSION against.
  let sumV = 0, sumR = 0, n = 0
  for (const i of idxs) { sumV += volOf(i); sumR += rngOf(i); n++ }
  const avgV = n ? sumV / n : 0
  const avgR = n ? sumR / n : 0
  // Where the news broke = the day's single biggest RANGE × VOLUME expansion — the
  // classic catalyst breakout/breakdown bar. Using the MAX (not the first candle to
  // cross a threshold) means an unrelated early-session spike (the 9:30 open) never
  // wins over the real news candle (owner: "first large range + volume expansion
  // candle... where the news broke" = the dominant move, e.g. the 12pm drop).
  if (avgV > 0 && avgR > 0) {
    let best = idxs[0], bestScore = -1
    for (const i of idxs) {
      const s = (volOf(i) / avgV) * (rngOf(i) / avgR)
      if (s > bestScore) { bestScore = s; best = i }
    }
    return best
  }
  // Last resort (no usable volume/range): first candle ≥50% of peak volume, else peak.
  let maxV = 0
  for (const i of idxs) maxV = Math.max(maxV, volOf(i))
  let target = maxV > 0 ? idxs.find(i => volOf(i) >= maxV * 0.5) : null
  if (target == null) { target = idxs[0]; for (const i of idxs) if (volOf(i) > volOf(target)) target = i }
  return target
}

// ─── Catalyst callout auto-placement (News widget) ───────────────────────────
// A News-widget catalyst is TWO linked drawings — a `text` label + a `trendline`
// leader — each independently editable. Both arrive with points:[] + a shared
// calloutId; the label carries calloutAnchorTime + calloutAutoPlace. This picks a
// blank spot near the anchor candle (same idea as the Model Book callout overlay:
// dodge every visible candle AND any callouts already placed) and returns the label
// box + the anchor pixel; the overlay converts those to chart points for BOTH
// drawings. Returns null when the anchor candle isn't on screen (placement is
// deferred until it scrolls in). PIXELS only — the caller does the pixel→chart map.
function placeCalloutPoint({ ctx, bars, toPixel, nearestIndex, drawings, anchorTime, text, fontSize, plotRight, h, vRange }) {
  if (!bars?.length) return null
  const ai = nearestIndex(anchorTime)
  if (ai == null || !bars[ai]) return null
  const b0 = bars[ai]
  const hi = b0.h ?? b0.high ?? b0.c
  const aHi = toPixel(b0.t, hi)
  if (!aHi || !Number.isFinite(aHi.x) || !Number.isFinite(aHi.y)) return null   // candle off-screen → defer
  const anchorX = aHi.x, anchorHiY = aHi.y
  // The leader connects at the candle's HIGH (top) for BOTH up and down catalysts, so
  // the headline floats UP into the blank space above the move (owner ask, matches the
  // reference). Anchoring a big down-breakdown at its LOW pushed the blank-space search
  // far to the right and dragged the leader off-screen — the reported bug.
  const anchorY = anchorHiY

  ctx.save()
  ctx.font = `${fontSize}px "Instrument Sans", sans-serif`
  // Multi-line labels (earnings: headline + EPS/REV lines): box = widest line ×
  // line count, so placement + the leader endpoint account for the full block.
  const tlines = String(text || '').split('\n')
  let tw = 24
  for (const ln of tlines) tw = Math.max(tw, ctx.measureText(ln).width)
  const firstLineW = tlines.length ? ctx.measureText(tlines[0]).width : tw   // headline width
  const boxW = tw + 2                                     // tight to the text
  const boxH = Math.max(1, tlines.length) * fontSize * 1.4
  // Visible candle high/low segments (pixels) so the label + line dodge candles.
  let from = 0, to = bars.length - 1
  if (vRange) { from = Math.max(0, Math.floor(vRange.from) - 1); to = Math.min(bars.length - 1, Math.ceil(vRange.to) + 1) }
  const segs = []
  for (let i = from; i <= to; i++) {
    const b = bars[i]; if (!b) continue
    const pH = toPixel(b.t, b.h ?? b.high ?? b.c)
    const pL = toPixel(b.t, b.l ?? b.low ?? b.c)
    if (!pH || !pL || !Number.isFinite(pH.x)) continue
    segs.push({ x: pH.x, top: Math.min(pH.y, pL.y), bottom: Math.max(pH.y, pL.y) })
  }
  // Callouts already on the chart → obstacle boxes so a 2nd catalyst doesn't stack.
  const obstacles = []
  for (const d of drawings) {
    if (d.type !== 'text' || !d.points?.length || d.calloutAnchorTime == null) continue
    const p = toPixel(d.points[0].time, d.points[0].price)
    if (!p || !Number.isFinite(p.x)) continue
    const olines = String(d.text || '').split('\n')
    let ow = 24
    for (const ln of olines) ow = Math.max(ow, ctx.measureText(ln).width)
    obstacles.push({ x: p.x, y: p.y, w: ow + 2, h: Math.max(1, olines.length) * (d.fontSize || 13) * 1.4 })
  }
  ctx.restore()

  const plotLeft = 4
  const pRight = Number.isFinite(plotRight) ? plotRight : 100000
  const priceBottom = h * 0.82   // keep labels in the price pane, above volume
  const hitsCandles = (x, y, bw, bh) => {
    for (const s of segs) {
      if (s.x < x - 2 || s.x > x + bw + 2) continue
      if (s.bottom < y || s.top > y + bh) continue
      return true
    }
    return false
  }
  const lineHitsCandles = (x0, y0, x1, y1) => {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1)
    for (const s of segs) {
      if (Math.abs(s.x - anchorX) < 3) continue          // its own candle — ok to touch
      if (s.x < minx - 0.5 || s.x > maxx + 0.5) continue
      const t = (x1 === x0) ? 0 : (s.x - x0) / (x1 - x0)
      const y = y0 + t * (y1 - y0)
      if (y >= s.top - 1 && y <= s.bottom + 1) return true
    }
    return false
  }
  const overlapsObstacle = (x, y, bw, bh) =>
    obstacles.some(o => !(x + bw < o.x - 6 || o.x + o.w < x - 6 || y + bh < o.y - 4 || o.y + o.h < y - 4))

  // Build a SMOOTH ~45° leader (owner ask): put the headline attach point on a 45°
  // ray from the candle open, then derive the box from it. `right` = the box sits
  // Place the headline near the anchor candle. DETERMINISTIC candidate set (not a
  // scored search): try a small set of fixed offsets around the candle, prefer the
  // first that sits FULLY on-screen and clears the candles/other labels, else the
  // first fully on-screen one, else a hard-clamped on-screen box. This can NEVER
  // degenerate into the off-screen "line streaks off the left with no headline" bug
  // the old scored search produced (it happily picked a blocked, edge-clamped spot).
  const fs = fontSize
  const G = 44                                   // leader length / gap from the candle
  const roomRight = anchorX < pRight - (boxW + G + 8)
  // Offsets are (attachDX, headDY, right?) where right? = box sits LEFT of the attach
  // point (leader meets its right edge). Prefer up-right blank space, then up-left,
  // then the down variants. When there's no room right, only the left variants apply.
  const CANDS = roomRight
    ? [{ dx: G, dy: -G, right: false }, { dx: -G, dy: -G, right: true }, { dx: G, dy: G, right: false }, { dx: -G, dy: G, right: true }]
    : [{ dx: -G, dy: -G, right: true }, { dx: -G, dy: G, right: true }]
  const boxFor = (c) => {
    const x = c.right ? (anchorX + c.dx - firstLineW) : (anchorX + c.dx)
    const y = anchorY + c.dy - fs * 0.9
    return { x, y, ax: c.right ? x + firstLineW : x, hy: y + fs * 0.9 }
  }
  const onScreen = (b) => b.x >= plotLeft && b.x <= pRight - boxW && b.y >= 6 && b.y <= priceBottom - boxH
  let best = null, firstOnScreen = null
  for (const c of CANDS) {
    const b = boxFor(c)
    if (!onScreen(b)) continue
    if (!firstOnScreen) firstOnScreen = b
    if (!hitsCandles(b.x, b.y, boxW, boxH) && !lineHitsCandles(anchorX, anchorY, b.ax, b.hy) && !overlapsObstacle(b.x, b.y, boxW, boxH)) {
      best = b; break
    }
  }
  if (!best) best = firstOnScreen
  if (!best) {
    // Anchor jammed in a corner (every candidate off-screen) → clamp a box on-screen,
    // preferring up-right; drop below the anchor if there's no vertical room above.
    let x = Math.max(plotLeft, Math.min(pRight - boxW, anchorX + (roomRight ? G : -G - boxW)))
    let y = Math.max(6, Math.min(priceBottom - boxH, anchorY - G - boxH))
    if (y <= 7 && anchorY + G + boxH < priceBottom) y = anchorY + G
    best = { x, y }
  }
  return {
    rect: { x: best.x, y: best.y, w: boxW, h: boxH },
    anchorPx: { x: anchorX, y: anchorY },   // leader anchors at the candle's high
    firstLineW,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartDrawingOverlay({
  chartRef, seriesRef, bars,
  volumeSeriesRef = null,    // the ONLY way to know where the volume pane/band is.
                             // Volume has two layouts (its own pane, or an overlay
                             // BAND inside pane 0 - and the band is the DEFAULT),
                             // and only the volume series itself knows which one it
                             // is in. Absent -> the chart has no volume zone and the
                             // whole plot is the price pane, which is right for the
                             // Model Book index pane and every embed.
  activeTool, setActiveTool,
  color, lineWidth,
  lineStyle = 'solid',
  magnet = false,
  drawings, addDrawing, updateDrawing, removeDrawing,
  // ⛔ `reorderDrawing` IS GONE FROM THIS SIGNATURE. It arrived from StockChart
  // solely to feed the menu's `canReorder` / `onBringFront` / `onSendBack`
  // props — which this component never read (eslint has flagged all three as
  // unused on every run). There is no z-order row in the drawing menu and
  // never has been. `drawingsStore.reorderDrawing` stays: it is tested and a
  // later surface may want it; what is removed is a thread that went nowhere.
  onMigrate = null,          // (drawings[]) => void — re-anchor legacy volume-pane points to paneRelY (called once when the view settles)
  selectedId, setSelectedId,
  repeatMode = true,
  hidePriceLabels = false,   // Model Book setup hrays: line only, no price label
  measurePctOnly = false,    // Model Book index pane: measure label shows ONLY the % move (drop the $ amount + bar count)
  lineData = null,           // Model Book index pane: [{time, value}] of the underlying LINE series. When set the overlay is in "line mode" — magnet snaps to the line, and the advance % is computed from the line values (not candle O/H) since the pane has no candles.
  fontSize = 13,             // default size for new text annotations
  textFadeRef = null,        // 0..1 opacity for text annotations (Model Book focus-zoom fade); null = always visible
  fadeWholeLayer = false,    // Model Book "show all" OFF: fade the WHOLE layer (lines + text) with the zoom, not just text
  redrawHandleRef = null,    // parent-held ref; the overlay assigns its redraw fn here so a chart snap (instant Setup⇄Result flip) can force the annotations to re-resolve to the NEW mapping in the same frame (no 1-frame position pop)
  undo = null,               // undo/redo/snapshotHistory — wired for the MAIN user-drawings
  redo = null,               //   overlay (useChartDrawings). Annotation overlays omit them
  snapshotHistory = null,    //   (no-op), so Ctrl+Z there does nothing.
  onSaveDefaults = null,     // (”Save as default”) persist {color,width,style} to cs.drawingDefaults
  toolDefaults = null,       // cs.drawingDefaults.byTool — the PER-TOOL half of the saved
                             //   defaults ({ rect: {fillColor}, arrow: {arrowSize}, … }).
                             //   Read only when a new drawing of that tool is created, so a
                             //   Rectangle's saved fill can never reach a Circle. Absent on
                             //   every read-only/annotation surface, which want the built-ins.
  savedColors = [],          // shared saved-color swatches (same list as Chart Settings)
  onSaveColor = null,        //   → the drawing color picker (ColorPanel) reuses them
  onDeleteColor = null,
  onSetAlert = null,         // (drawing, 'above'|'below') => void — "Set alert" on a line/trendline's
                             //   right-click menu. Provided only by the MAIN chart (it knows the symbol).
  readOnly = false,          // display-only layer (multi-chart grid cells): skip the window
                             //   keydown handler entirely — a NOOP-wired instance would still
                             //   preventDefault Escape/Ctrl+Z/Ctrl+V app-wide, ×N cells.
  quickBarInset = 10,        // px above the chart's bottom edge for the touch quick-action
                             //   bar — the phone shell raises it above its docked draw bar.
}) {
  // ⭐ LIVE, not frozen. Every touch affordance below (auto-select after placing,
  // the touch pointer-routing effect, the coach chip, the quick bar, sheet-vs-
  // popover) reads THIS, so attaching or detaching an iPad keyboard re-renders
  // them instead of stranding the chart in the pointer type it booted with.
  const coarsePointer = useCoarsePointer()
  const canvasRef = useRef(null)
  const [pendingPoints, setPendingPoints] = useState([])
  // First-use coach chip for touch: a multi-point tool places by TAP-TAP, and
  // a finger user's instinct is to drag. Shown until the first successful
  // placement (or its ✕) — a single flag across every multi-point tool. A
  // storage read failure counts as seen: never nag in private mode.
  const [tapHintSeen, setTapHintSeen] = useState(() => {
    try { return localStorage.getItem(TAP_HINT_LS) === '1' } catch { return true }
  })
  const markTapHintSeen = useCallback(() => {
    setTapHintSeen(true)
    try { localStorage.setItem(TAP_HINT_LS, '1') } catch { /* private mode */ }
  }, [])
  const [mouseCoords, setMouseCoords] = useState(null)
  const [textInput, setTextInput] = useState(null)
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, drawingId }
  const rafRef = useRef(null)
  // Instant frame-snap handling: LWC updates priceToCoordinate ASYNC (on its next
  // paint), so right after a snap the price mapping is stale. To keep price-anchored
  // annotations instant AND correct, the parent hands us the snap's TARGET price
  // range and we compute Y from it directly (edge-to-edge over the price pane) until
  // LWC's own mapping settles to the same range — then we hand back to
  // priceToCoordinate seamlessly. snapBaseYRef = the pre-snap sample used to detect
  // the settle.
  const snapActiveRef = useRef(false)   // formula-based Y active during the snap transient
  const snapVertRef = useRef(null)      // { lo, hi } edge-to-edge target price range
  const snapBaseYRef = useRef(null)
  const snapSafetyRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)
  // Motion detection: the off-screen guard is suspended while the view is moving
  // (focus zoom / pan) so lines transition WITH the candles, then re-applied once
  // the view settles (~140ms stable) so off-screen setups stay hidden at rest.
  const lastRangeKeyRef = useRef('')
  const movingRef = useRef(false)
  const settleTimerRef = useRef(null)

  // ── Drag state ──
  // { drawingId, handleIdx (null=whole, 0/1/2=specific point), startPixel, originalPoints }
  const dragRef = useRef(null)
  // ⭐ WHICH DRAWING HAS ITS MEASUREMENT ANCHORS TEMPORARILY EXPOSED.
  //
  // Price Move's anchors are DATA — two candles whose low→high is the run — and
  // they are usually nowhere near the label. Showing handles on them whenever
  // the label is selected put two gold dots in empty space, and a drag of one
  // silently restated the measurement the user thought they were just moving.
  // So they are off by default and revealed on request, for ONE drawing at a
  // time. A plain id, not a mode object: there is nothing else to remember, and
  // selecting anything else clears it.
  const [adjustingId, setAdjustingId] = useState(null)
  // The label boxes the LAST frame actually painted, per drawing id. Hit testing
  // and the selection handle both read this, so what you click and what you see
  // cannot drift apart — the alternative is a second derivation of "where is the
  // label", which is how an invisible hitbox is born.
  const labelBoxRef = useRef(new Map())
  // Touch support: track concurrent pointers (so a 2nd finger aborts a draw and
  // lets the chart pinch) + a long-press timer that opens the context menu.
  const activePointersRef = useRef(new Set())
  const longPressRef = useRef(null)
  // True only while a touch that landed ON a drawing is being routed through
  // handlePointerDown (from the wrapper touch listener). Lets the no-tool cursor
  // branch fire on touch the way `hoverActive` does for the mouse. Never true for
  // mouse input, so the shipped mouse path is unaffected.
  const touchHitRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverDrawingId, setHoverDrawingId] = useState(null)
  // Direct-manipulation: true when the mouse is over a drawing while NO tool is
  // armed. Flips the transparent overlay to interactive JUST for that moment so a
  // drawing can be grabbed / moved / reshaped / right-clicked without first
  // arming the cursor tool. Empty space keeps the overlay transparent (chart pans).
  const [hoverActive, setHoverActive] = useState(false)
  // Live drawings snapshot for the window-level keydown handler (avoids
  // re-subscribing the listener on every drawings change, incl. mid-drag).
  const drawingsRef = useRef(drawings)
  drawingsRef.current = drawings
  /* ⛔ EXPLICIT, NOT FILTERED AT THE PROP. Hiding must remove an object from the
     CANVAS and from HIT-TESTING, and from nothing else. Filtering `drawings`
     itself would have been one line and a silent data loss: the paneRelY
     migration below builds a WHOLE REPLACEMENT list from `drawings` and hands it
     to `onMigrate`, so a filtered prop would delete every hidden object the first
     time a chart migrated — with every test still green. Undo, the object
     manager and every mutation keep seeing the full list. */
  const visibleDrawings = useMemo(() => visibleOnly(drawings), [drawings])

  // ── Time → bar index lookup ──
  const timeToIndex = useMemo(() => {
    const map = new Map()
    bars?.forEach((b, i) => map.set(b.t, i))
    return map
  }, [bars])

  // Nearest bar index for a time that may not be an EXACT bar on the current
  // timeframe. A drawing placed on the daily chart anchors to a daily date
  // (e.g. '2025-08-15'); on the weekly chart that exact date isn't a bar, so an
  // exact lookup misses and the annotation/line would vanish or streak full
  // width. Snap to the bar whose period CONTAINS the date — the greatest bar
  // time <= the target (binary search; ISO 'YYYY-MM-DD' sorts chronologically).
  // Only snaps when the time type matches the bars' (both strings for D/W) so
  // intraday epoch-number bars are never mis-compared; same-timeframe lookups
  // hit the exact map and never reach the search.
  const nearestIndex = useCallback((time) => {
    if (time == null || !bars?.length) return null
    const exact = timeToIndex.get(time)
    if (exact != null) return exact
    if (typeof time !== typeof bars[0].t) return null
    let lo = 0, hi = bars.length - 1, res = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (bars[mid].t <= time) { res = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return res < 0 ? 0 : res   // before the first bar → first bar
  }, [bars, timeToIndex])

  // Bottom edge (CSS px) of the price pane = pane-0 height. Kept because the
  // instant-snap transient in `toPixel` needs the pane height directly.
  const pricePaneBottomPx = useCallback(() => {
    try { const h = seriesRef?.current?.getPane?.()?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    try { const h = chartRef?.current?.panes?.()?.[0]?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    return null
  }, [chartRef, seriesRef])

  // -- Pane geometry ----------------------------------------------------------
  //
  // MEASURED FROM THE RENDERER, ONCE PER REDRAW, AND CACHED IN A REF.
  // `redraw` runs on every frame the visible range changes; asking
  // lightweight-charts for pane heights and axis widths per DRAWING would repeat
  // half a dozen cross-boundary reads ~60 times a second x 50 drawings. It is
  // measured at the top of `redraw` and every drawing reads the same answer, so
  // it is also impossible for two drawings in one frame to disagree about where
  // the divider is.
  //
  // The ref is ALSO what pointer handlers read: a click has to resolve to the
  // same zones the last paint used, or a drawing could be created in a pane it
  // was not drawn in.
  const paneGeomRef = useRef(null)
  const measurePanes = useCallback(() => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    const { w, h } = sizeRef.current
    let axisWidth = 0, timeAxisHeight = 0, candlePaneIndex = 0
    const paneHeights = []
    let volumePaneIndex = null, volumeBandTop = null
    try { axisWidth = series?.priceScale?.()?.width?.() ?? 0 } catch { /* default 0 */ }
    try { timeAxisHeight = chart?.timeScale?.()?.height?.() ?? 0 } catch { /* default 0 */ }
    let panes = []
    try { panes = chart?.panes?.() || [] } catch { panes = [] }
    for (const pane of panes) {
      let ph = 0
      try { ph = pane.getHeight() } catch { ph = 0 }
      // ⚠️ A SUB-PANE CAN REPORT HEIGHT 0 WHILE IT IS STILL BEING LAID OUT.
      // Measured in-browser: right after mount `chart.panes()` gave `[668, 0]`
      // for a chart that settles at `[622, 85]`, and during that window the
      // volume zone has no height. `rectForKey` treats a zero-height zone as
      // "not laid out yet" and falls back to the plot, so drawings stay on
      // screen through the transient rather than blinking out.
      //
      // The element read below is a second opinion for the same window (it is
      // usually null then too). It costs a layout flush, so it runs ONLY when the
      // cheap answer is unusable, and `measurePanes` runs once per FRAME, never
      // once per drawing.
      if (!(ph > 0)) {
        try { ph = pane.getHTMLElement?.()?.clientHeight || 0 } catch { ph = 0 }
      }
      paneHeights.push(ph)
    }
    // WHICH PANE IS A SERIES IN? ASK `paneIndex()`, NOT `indexOf`.
    //
    // `chart.panes()` hands back a FRESH wrapper object on every call, so
    // `panes.indexOf(series.getPane())` compares two different wrappers around
    // the same pane and answers -1. It fails SILENTLY and it fails CONSISTENTLY:
    // the volume pane is simply never found, `zones` degrades to price-only, and
    // every volume-pane drawing resolves its `paneY` against the whole plot -
    // i.e. it renders up in the candles. (Measured in-browser: 106,152 ink pixels
    // in the price pane for six volume-pane drawings, 5 in the volume pane.)
    //
    // `paneIndex()` is the identity lightweight-charts actually exposes for this,
    // and it is what StockChart's own index-pane code uses. `indexOf` stays only
    // as a fallback for an older API that lacks it.
    const paneIdxOf = (sref) => {
      if (!sref) return -1
      try {
        const pane = sref.getPane?.()
        if (!pane) return -1
        const idx = pane.paneIndex?.()
        if (Number.isFinite(idx)) return idx
        return panes.indexOf(pane)
      } catch { return -1 }
    }
    const cIdx = paneIdxOf(series)
    if (cIdx >= 0) candlePaneIndex = cIdx
    // Which volume layout is this chart in? Ask the volume series, not the
    // settings: a chart can be forced into a separate pane by its HOST (grid
    // cells, Review cards) regardless of what cs.volume.separatePane says.
    const vs = volumeSeriesRef?.current
    if (vs) {
      const vIdx = paneIdxOf(vs)
      if (vIdx >= 0 && vIdx !== candlePaneIndex) volumePaneIndex = vIdx
      else {
        try {
          // Band layout: the overlay price scale's own top margin IS the divider.
          const m = vs.priceScale?.()?.options?.()?.scaleMargins
          if (m && Number.isFinite(m.top)) volumeBandTop = m.top
        } catch { /* no volume zone; price owns the plot */ }
      }
    }
    return resolveZones({
      width: w, height: h, axisWidth, timeAxisHeight,
      paneHeights, volumePaneIndex, volumeBandTop, candlePaneIndex,
    })
  }, [chartRef, seriesRef, volumeSeriesRef])

  /** The zones the last paint used; measured on demand if a pointer arrives first. */
  const paneGeom = useCallback(() => {
    if (!paneGeomRef.current) paneGeomRef.current = measurePanes()
    return paneGeomRef.current
  }, [measurePanes])

  // ── Coordinate conversion: chart → pixel ──
  // Uses refs at call-time so always gets latest chart/series
  const toPixel = useCallback((time, price, futureBars = null) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series) return null
    let x = null
    // FUTURE point: drawn/dragged into the empty right-pad PAST the last candle
    // (e.g. extending a trendline forward). It's anchored to the last bar's time +
    // a whole-bar offset; LWC maps logical indices beyond the data onto the
    // right-pad, so extrapolate there. Gated on `futureBars` so every in-data point
    // takes the byte-identical original path below — no regression to existing
    // drawings. Falls through to the normal mapping if extrapolation fails.
    if (Number.isFinite(futureBars) && futureBars > 0 && bars?.length) {
      const targetLogical = (bars.length - 1) + futureBars
      try { x = chart.timeScale().logicalToCoordinate(targetLogical) } catch {}
      // Robust fallback: logicalToCoordinate returns null for a logical index beyond
      // the extrapolatable right-pad (seen on INTRADAY), which then fell through to the
      // last bar's time below — snapping a future endpoint back onto the last candle
      // (or to a null x → off-screen). Project the pixel from the visible range's
      // px-per-bar instead, so the endpoint stays exactly where it was drawn.
      if (x == null) {
        try {
          const range = chart.timeScale().getVisibleLogicalRange()
          if (range) {
            const lo = Math.ceil(range.from), hi = Math.floor(range.to)
            const xa = chart.timeScale().logicalToCoordinate(lo)
            const xb = chart.timeScale().logicalToCoordinate(hi)
            if (xa != null && xb != null && hi !== lo) {
              x = xa + (targetLogical - lo) * ((xb - xa) / (hi - lo))
            }
          }
        } catch { /* fall through to the time-based mapping below */ }
      }
    }
    if (x == null && time != null) {
      try { x = chart.timeScale().timeToCoordinate(time) } catch {}
      // Fallback: extrapolate from logical index. Uses the CONTAINING bar so a
      // daily-anchored drawing maps onto the right weekly/monthly bar (and vice
      // versa) instead of disappearing when the exact date isn't a bar.
      if (x == null && bars?.length) {
        const idx = nearestIndex(time)
        if (idx != null) {
          try { x = chart.timeScale().logicalToCoordinate(idx) } catch {}
        }
      }
    }
    let y = null
    if (price != null) {
      // During an instant-snap transient, LWC's priceToCoordinate is still the
      // pre-snap mapping this frame. Compute Y directly from the snap's target
      // range (edge-to-edge over the price pane) so the line is instantly at its
      // correct height; hands back to priceToCoordinate once LWC settles (the tick
      // clears snapActiveRef), which equals this by construction — no jump.
      const sv = snapActiveRef.current ? snapVertRef.current : null
      if (sv && Number.isFinite(sv.lo) && Number.isFinite(sv.hi) && sv.hi > sv.lo) {
        const H = pricePaneBottomPx()
        if (H && H > 0) y = H * (sv.hi - price) / (sv.hi - sv.lo)
      }
      if (y == null) { try { y = series.priceToCoordinate(price) } catch {} }
    }
    return { x, y }
  }, [chartRef, seriesRef, bars, nearestIndex, pricePaneBottomPx])

  /**
   * Stored anchors -> pixels, ONE OUTPUT SLOT PER INPUT ANCHOR.
   *
   * TWO BUGS DIED HERE, AND BOTH WERE SILENT.
   *
   * 1. `.filter(p => p.x != null || p.y != null)` - note the OR. A point whose
   *    time could not be mapped kept `x: null`, passed the filter on the strength
   *    of its y, and every downstream expression (`p2.x - p1.x`) then read that
   *    null as **0**, because that is what JS does. The anchor snapped to the
   *    chart's left edge and snapped back when the mapping recovered: the
   *    Pitchfork "lines jump / skip around" report, and a whole class of
   *    "my drawing flew to the left" reports besides.
   * 2. When the filter DID drop a point the array shortened, so `pts[i]` stopped
   *    corresponding to `points[i]`. A three-point tool silently became a
   *    two-point one, and `handleIdx` - an index into the STORED points - started
   *    dragging the wrong anchor.
   *
   * SO NOTHING IS EVER DROPPED. Every anchor gets a slot, carrying an explicit
   * `valid`. Painters and hit tests ask (`ok(pts, n)`); nobody coerces.
   *
   * AND `paneY` IS PANE-RELATIVE WHILE `paneRelY` IS CANVAS-RELATIVE. They are
   * different units and both are live. `paneRelY` is the legacy field: a fraction
   * of the WHOLE CANVAS, which is why dragging the volume divider used to slide
   * every volume-pane drawing across the bars it was marking. It is read exactly
   * as it always was, so no existing drawing moves. `paneY` is the new one - a
   * fraction of the OWNING ZONE - and a drawing upgrades to it the first time the
   * user moves it. Nothing is rewritten on load.
   */
  const resolvePixels = useCallback((points, paneRect = null) => {
    const H = sizeRef.current.h || 0
    return (points || []).map((p) => {
      const px = toPixel(p.time, p.price, p.futureBars)
      let y = px?.y
      if (p.paneY != null && paneRect) y = fromPaneFraction(paneRect, p.paneY)
      else if (p.paneRelY != null && H) y = p.paneRelY * H
      const x = px?.x
      // `valid` is the BOTH-AXES answer most tools want; `pointsUsable(pts, n,
      // 'x'|'y')` asks for one axis where a tool genuinely only has one (a
      // Horizontal Line is a price with no time; a Vertical Line the reverse).
      const hasX = Number.isFinite(x)
      const hasY = Number.isFinite(y)
      return {
        x, y, hasX, hasY, valid: hasX && hasY,
        rawPrice: p.price, price: p.price, time: p.time, futureBars: p.futureBars,
      }
    })
  }, [toPixel])

  /** The pane rect a drawing owns. Legacy drawings (no `pane`) are inferred from
   *  their lowest resolved anchor - see `inferPaneKey` for why the LOWEST. */
  const rectForDrawing = useCallback((d, geom) => {
    const g = geom || paneGeom()
    if (!g) return null
    if (d?.pane) return rectForKey(g, d.pane)
    return rectForKey(g, inferPaneKey(g, resolvePixels(d?.points || [])))
  }, [paneGeom, resolvePixels])

  // One-time migration of LEGACY volume-pane annotations (saved before paneRelY
  // existed): they're price-anchored and jump onto the chart after a rescale.
  // Once the view has SETTLED at the correctly-positioned framing, capture each
  // below-the-price-pane point's pane-relative Y and bubble the patched set up so
  // it can be persisted. Idempotent — points that already have paneRelY are
  // skipped, so the re-render this triggers doesn't loop.
  const migratedRef = useRef(false)
  useEffect(() => { migratedRef.current = false }, [drawings])
  useEffect(() => {
    if (!onMigrate || !drawings?.length || !bars?.length) return
    let raf = null, tries = 0, sawMotion = false
    const attempt = () => {
      raf = null
      if (migratedRef.current) return
      tries++
      const H = sizeRef.current.h || 0
      const pb = pricePaneBottomPx()
      const series = seriesRef?.current
      // Wait for the chart to be ready AND the view to settle so we capture the
      // original, correct position — not a post-jump one. Settle = the framing
      // moved then stopped; or (rare, no motion at all) a few stable frames.
      if (!H || pb == null || !series) { if (tries < 180) raf = requestAnimationFrame(attempt); return }
      if (movingRef.current) { sawMotion = true; if (tries < 180) raf = requestAnimationFrame(attempt); return }
      if (!sawMotion && tries < 40) { raf = requestAnimationFrame(attempt); return }
      let changed = false
      const next = drawings.map(d => {
        if (!d.points?.length) return d
        let pchg = false
        const np = d.points.map(p => {
          if (p.paneRelY != null || p.price == null) return p
          let y = null
          try { y = series.priceToCoordinate(p.price) } catch { /* disposed */ }
          if (y != null && y > pb + 1) { pchg = true; return { ...p, paneRelY: y / H } }
          return p
        })
        if (pchg) { changed = true; return { ...d, points: np } }
        return d
      })
      migratedRef.current = true
      if (changed) onMigrate(next)
    }
    raf = requestAnimationFrame(attempt)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [onMigrate, drawings, bars, pricePaneBottomPx, seriesRef])

  // ── Coordinate conversion: pixel → chart ──
  // Robust: uses visible range + linear interpolation if coordinateToLogical fails
  const toChart = useCallback((pixelX, pixelY) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series || !bars?.length) return null

    let time = null
    let futureBars = null
    const lastIdx = bars.length - 1
    // Given a raw logical index, resolve to either an in-data bar time OR (when the
    // click is PAST the last candle, i.e. in the right-pad) a future point: anchor
    // to the last bar's time + a bounded whole-bar offset. This is what lets a
    // trendline endpoint be placed in the empty space to the right.
    const fromLogical = (logical) => {
      const rounded = Math.round(logical)
      if (rounded > lastIdx) { time = bars[lastIdx].t; futureBars = Math.min(FUTURE_BARS_CAP, rounded - lastIdx) }
      else { time = bars[Math.max(0, rounded)].t; futureBars = null }
    }
    // Method 1: try coordinateToLogical (LWC v5)
    try {
      const logical = chart.timeScale().coordinateToLogical(pixelX)
      if (logical != null) fromLogical(logical)
    } catch {}

    // Method 2: fallback — interpolate from visible range
    if (!time) {
      try {
        const range = chart.timeScale().getVisibleLogicalRange()
        if (range) {
          const startX = chart.timeScale().logicalToCoordinate(Math.ceil(range.from))
          const endX = chart.timeScale().logicalToCoordinate(Math.floor(range.to))
          if (startX != null && endX != null && endX !== startX) {
            const pxPerBar = (endX - startX) / (Math.floor(range.to) - Math.ceil(range.from))
            fromLogical(Math.ceil(range.from) + (pixelX - startX) / pxPerBar)
          }
        }
      } catch {}
    }

    let price = null
    try { price = series.coordinateToPrice(pixelY) } catch {}

    // Vertical anchor.
    //
    // OWNERSHIP IS DECIDED HERE, ONCE, FOR THE WHOLE DRAWING. It used to be
    // re-derived per POINT on every frame from "is this y below the price pane",
    // which is how a two-point line could end up with one anchor in each pane and
    // how dragging an endpoint across the divider silently converted half a
    // drawing. The caller stamps the returned `pane` onto the drawing at creation
    // and every later resolution reads that, not the pixels.
    //
    // `paneY` IS A FRACTION OF THE OWNING ZONE, not of the canvas. That is the
    // whole difference between a volume-pane drawing that stays on its bars when
    // the divider moves and one that slides across them. Only non-price zones get
    // it: a price-pane drawing is anchored to a PRICE, which is better than any
    // fraction because it tracks the data through a rescale.
    const geom = paneGeom()
    const paneKey = geom ? paneKeyAtY(geom, pixelY) : PRICE
    let paneY = null
    if (paneKey !== PRICE) {
      const rect = rectForKey(geom, paneKey)
      paneY = toPaneFraction(rect, pixelY)
    }

    // Allow partial coords: horizontal only needs price, vertical only needs time
    if (!time && price == null && paneY == null) return null
    const fb = futureBars ? { futureBars } : null
    return paneY != null
      ? { time, price, paneY, pane: paneKey, ...fb }
      : { time, price, pane: paneKey, ...fb }
  }, [chartRef, seriesRef, bars, paneGeom])

  // Line mode (index pane): time → line value, for magnet-snap-to-line + advance %.
  const timeToLineValue = useMemo(() => {
    const m = new Map()
    if (lineData) for (const p of lineData) if (p && p.value != null) m.set(p.time, p.value)
    return m
  }, [lineData])

  // ── Magnet: snap a point's price to the nearest O/H/L/C of the bar under it ──
  // (TradingView-style). When on, drawing near a candle locks to that exact
  // open/high/low/close. Time is already snapped to the bar by toChart.
  // In line mode (index pane has no candles), magnet snaps to the line value at
  // that time instead — so a click locks exactly onto the Nasdaq line.
  const snap = useCallback((coords) => {
    if (!magnet || !coords || coords.price == null || coords.time == null) return coords
    if (lineData) {
      const lv = timeToLineValue.get(coords.time)
      return lv == null ? coords : { ...coords, price: lv }
    }
    const idx = timeToIndex.get(coords.time)
    const b = idx != null ? bars[idx] : null
    if (!b) return coords
    let best = null, bestDist = Infinity
    for (const v of [b.o, b.h, b.l, b.c]) {
      if (v == null) continue
      const d = Math.abs(coords.price - v)
      if (d < bestDist) { bestDist = d; best = v }
    }
    return best == null ? coords : { ...coords, price: best }
  }, [magnet, timeToIndex, bars, lineData, timeToLineValue])

  // ── Canvas setup & resize ──
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!canvas || !wrapper) return

    const setSize = (width, height) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      sizeRef.current = { w: width, h: height }
    }

    // Set initial size immediately
    const rect = wrapper.getBoundingClientRect()
    setSize(rect.width, rect.height)

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(width, height)
      redrawRef.current?.()
    })
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [])

  // ── Track chart scroll/zoom and redraw in lockstep ──
  // Subscribe to the time scale's range change so drawings redraw on the SAME
  // frame the chart moves (fires synchronously from setVisibleLogicalRange) —
  // this keeps annotations glued to the candles during the smooth focus zoom
  // (the old 60ms/~16fps poll made them skip behind). A slow poll stays as a
  // belt-and-suspenders fallback for any movement the subscription misses.
  useEffect(() => {
    // Resolve the chart + series from the refs ON EVERY FRAME — never capture
    // them once. The overlay can mount BEFORE the chart exists (SWR-cached bars
    // render the wrapper in StockChart's first commit, and child effects run
    // before the parent effect that creates the chart) or the series can be
    // recreated later (chart-type switch). A one-time capture left this whole
    // tracker dead in those cases: on a frozen chart (Setup Library examples)
    // nothing else triggers a repaint, so the first view change (Setup ⇄ Result
    // flip) re-framed the candles while the canvas kept its STALE pixels — the
    // "trendline doesn't stay where I put it" bug.
    const onRange = () => redrawRef.current?.()
    let subscribedChart = null
    // A rAF loop samples the time range AND the price→pixel mapping each frame,
    // so drawings track VERTICAL price-scale changes too — the autoscale settling
    // after a focus zoom, or axis drags — not just horizontal range moves. (The
    // old time-only 200ms poll left annotations stuck at stale price levels for a
    // beat after the first zoom — the "2.70/5.42 in the wrong spot" glitch.)
    let raf = null
    let lastKey = ''
    const tick = () => {
      const chart = chartRef?.current
      const series = seriesRef?.current
      // (Re)subscribe whenever the chart instance appears or is replaced, so the
      // synchronous same-frame redraw on setVisibleLogicalRange is never lost.
      if (chart !== subscribedChart) {
        try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* gone */ }
        subscribedChart = null
        if (chart) {
          try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRange); subscribedChart = chart } catch { /* older API */ }
        }
      }
      if (chart) {
        try {
          const range = chart.timeScale().getVisibleLogicalRange()
          // A disposed series must not kill range-keyed redraws — sample it
          // separately and fall back to blank mapping values.
          let y0 = null, y1 = null
          try { y0 = series?.priceToCoordinate(1); y1 = series?.priceToCoordinate(100) } catch { /* disposed series */ }
          // Snap settled? Once the price mapping moves off its pre-snap sample,
          // LWC has repainted at the new scale (which equals our target range), so
          // drop the override and hand back to priceToCoordinate — no visible jump.
          if (snapActiveRef.current && y0 != null && snapBaseYRef.current != null
              && Math.abs(y0 - snapBaseYRef.current) > 0.5) {
            snapActiveRef.current = false
            if (snapSafetyRef.current) { clearTimeout(snapSafetyRef.current); snapSafetyRef.current = null }
          }
          // Include the text-fade value so the fade renders frame-by-frame even at
          // the very end of the zoom, where the range barely changes.
          const tf = textFadeRef ? (textFadeRef.current ?? 1).toFixed(3) : ''
          const key = `${range ? `${range.from.toFixed(2)}_${range.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}|${tf}`
          if (key !== lastKey) { lastKey = key; redrawRef.current?.() }
        } catch { /* chart torn down mid-frame */ }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef, textFadeRef])

  // ── Request redraw (debounced via rAF, uses ref for latest redraw) ──
  const requestRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => redrawRef.current?.())
  }, [])

  // ── Redraw all ──
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (w === 0 || h === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Clip everything to the plot area (exclude the right price axis) so no line,
    // ray, or label ever renders over the price scale — e.g. an hray streaking to
    // the edge while transitioning between setups. Restored at the end of redraw.
    // PANE GEOMETRY IS MEASURED EXACTLY ONCE PER FRAME. Every drawing below reads
    // the same object, so N drawings cost one set of cross-boundary reads into
    // lightweight-charts rather than N, and two drawings in one frame cannot
    // disagree about where the divider is.
    const geom = measurePanes()
    paneGeomRef.current = geom
    const plotRight = geom.plot.x1

    // Clip everything to the plot area (exclude the right price axis) so no line,
    // ray, or label ever renders over the price scale. Phase 1 adds a SECOND,
    // per-drawing clip INSIDE this one for the pane; this outer clip is unchanged
    // and still the thing that keeps drawings off the price scale.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, plotRight, h)
    ctx.clip()

    // Auto-ink for bare text labels (advance %) — white on dark canvas, black on
    // light — computed once from the chart's actual background for this frame.
    const autoInk = autoLabelInk(chartRef.current)

    // Focus-zoom fade (Model Book). `fadeVal` eases 0→1 over the last sliver of the
    // zoom-in (and out on zoom-out). When `fadeWholeLayer` (show-all OFF) the WHOLE
    // layer fades via globalAlpha; otherwise (show-all ON) only the text fades and
    // the lines stay put. Other charts (no ref) are always fully visible.
    const fadeVal = textFadeRef ? Math.max(0, Math.min(1, textFadeRef.current ?? 1)) : 1
    const layerAlpha = fadeWholeLayer ? fadeVal : 1
    const textOpacity = fadeWholeLayer ? 1 : fadeVal
    ctx.globalAlpha = layerAlpha

    // Visible logical range — used to hide a setup's annotations when its anchor
    // bar is off-screen (e.g. the next setup to the right while zoomed in on this
    // one). Only enforced for Model Book overlays (textFadeRef present), and only
    // once the view is SETTLED — while the chart is moving the guard is off so
    // lines/labels transition smoothly with the candles instead of popping in.
    let visFrom = -Infinity, visTo = Infinity
    let guardActive = false
    if (textFadeRef) {
      try {
        const r = chartRef?.current?.timeScale?.()?.getVisibleLogicalRange?.()
        if (r) { visFrom = r.from; visTo = r.to }
      } catch { /* keep unbounded */ }
      const key = `${visFrom.toFixed(2)}_${visTo.toFixed(2)}`
      if (key !== lastRangeKeyRef.current) {
        lastRangeKeyRef.current = key
        movingRef.current = true
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => { movingRef.current = false; redrawRef.current?.() }, 140)
      }
      guardActive = !movingRef.current
    }

    const toPixelY = (_, price) => {
      const p = toPixel(null, price)
      return p?.y
    }

    // ── Callout auto-placement (News-widget catalysts) ──
    // A catalyst is TWO linked drawings the News widget drops (shared calloutId):
    // a `text` LABEL (calloutRole 'label' + calloutAnchorTime + calloutAutoPlace)
    // and a `trendline` LINE ('line'), both with empty points. The label drives ONE
    // blank-space placement (dodging candles); we then fill BOTH — the label's box
    // point and the line from the anchor candle to a point that stops a small GAP
    // short of the text — via updateDrawing (idempotent by id, so N same-symbol
    // charts can't duplicate). After that they're two ordinary, separately editable/
    // deletable/colorable drawings. Only on the user-drawings overlay (real updateDrawing).
    if (typeof updateDrawing === 'function' && typeof toChart === 'function') {
      let vRange = null
      try { vRange = chartRef?.current?.timeScale?.()?.getVisibleLogicalRange?.() } catch { /* none */ }
      const asPoint = (p) => p && ({
        time: p.time, price: p.price,
        ...(p.futureBars != null ? { futureBars: p.futureBars } : {}),
        ...(p.paneY != null ? { paneY: p.paneY } : {}),
      })
      for (const d of drawings) {
        if (d.type !== 'text' || d.calloutRole !== 'label' || !d.calloutAutoPlace || d.calloutAnchorTime == null) continue
        if (d.points && d.points.length) continue
        // Size the placed callout from the chart's current drawing default (the
        // overlay's `fontSize` prop = cs.drawingDefaults.fontSize) unless this
        // drawing already carries its own size.
        const calloutFs = d.fontSize || fontSize
        // Resolve the anchor to a real candle FIRST — on an intraday chart a
        // catalyst's date snaps to the session's big-volume candle (where the news
        // broke); daily/weekly stay on the daily bar. Everything downstream anchors
        // to that candle's EXACT time so placeCalloutPoint + the leader line agree.
        const ai = resolveCatalystAnchor(d.calloutAnchorTime, bars, nearestIndex)
        const b = ai != null ? bars[ai] : null
        if (!b) continue
        const res = placeCalloutPoint({
          ctx, bars, toPixel, nearestIndex, drawings,
          anchorTime: b.t, text: d.text, fontSize: calloutFs,
          plotRight, h, vRange,
        })
        if (!res) continue
        // Leader connects at the candle's HIGH for both directions (matches
        // placeCalloutPoint's anchor) so the headline floats up into blank space.
        const anchorPrice = (b.h ?? b.high ?? b.c)
        const { rect, anchorPx } = res
        const fs = calloutFs
        const labelPt = asPoint(toChart(rect.x, rect.y))
        if (!labelPt) continue
        // Attach the leader to the HEADLINE (first line) — near its right end when the
        // candle sits to the right, else its left — at the first line's height, a small
        // GAP off the text. (Owner ask: the line meets the right of the headline, not
        // the bottom-right of the whole multi-line block.) Measured from where the
        // label ACTUALLY renders (its point re-snapped to a bar), not the search rect.
        const lp = toPixel(labelPt.time, labelPt.price)
        const bx = (lp && Number.isFinite(lp.x)) ? lp.x : rect.x
        const by = (lp && Number.isFinite(lp.y)) ? lp.y : rect.y
        const flw = Number.isFinite(res.firstLineW) ? res.firstLineW : rect.w
        const headY = by + fs * 0.9                          // ~vertical center of the headline
        const attachX = anchorPx.x >= bx + flw / 2 ? bx + flw : bx   // side facing the candle
        const ddx = anchorPx.x - attachX, ddy = anchorPx.y - headY
        const dlen = Math.hypot(ddx, ddy) || 1
        const GAP = 8
        const ex = attachX + (ddx / dlen) * GAP
        const ey = headY + (ddy / dlen) * GAP
        const endPt = asPoint(toChart(ex, ey))
        if (!endPt) continue
        // Stamp THIS chart's current drawing default (color + width) so a placed
        // catalyst matches whatever the user last "Saved as default" for drawings —
        // then each is a normal, independently-recolorable drawing.
        updateDrawing(d.id, { points: [labelPt], color, fontSize: fs, calloutAutoPlace: false }, { record: false })
        const line = drawings.find(x => x.calloutRole === 'line' && x.calloutId === d.calloutId)
        if (line) updateDrawing(line.id, { points: [{ time: b.t, price: anchorPrice }, endPt], color, lineWidth, calloutAutoPlace: false }, { record: false })
      }
    }

    // ⭐ ONE SPACING ESTIMATE PER FRAME, shared by every measurement on the
    // chart. Only used to extrapolate anchors that sit in empty future space.
    const barSeconds = inferBarSeconds(bars)
    // The label boxes this frame paints, keyed by drawing id and rebuilt from
    // scratch: a drawing deleted or scrolled away must not leave a hitbox behind.
    // (Distinct from `labelBoxes` below, which is the anti-overlap reservation
    // list for price tags and has no identity attached to its entries.)
    const paintedBoxes = new Map()

    // ── Label state for THIS frame ────────────────────────────────────────
    // ⭐ ONE FORMATTER PER FRAME, NOT PER LABEL. `priceFormatterFor` asks the
    // series for its own `IPriceFormatter`, so a drawing's price reads exactly
    // like the axis tag beside it. Built once here and handed down.
    const priceText = priceFormatterFor(seriesRef?.current)
    // Boxes already placed, so two price labels at nearly the same level step
    // apart instead of printing on top of each other. Per frame, thrown away
    // with the frame — see `avoidOverlap`, which is deliberately not a solver.
    const labelBoxes = []

    // Draw completed drawings
    for (const d of visibleDrawings) {
      // A text note being edited is HIDDEN on the canvas while its editor box is
      // open — otherwise the note renders BEHIND the (slightly offset) textarea and
      // reads as a duplicate "ghost" box (the reported double-click glitch).
      if (textInput?.editId === d.id) continue
      // AVWAP uses time-based lookup, doesn't need resolved pixels to render
      if (d.type === 'avwap' && d.points?.[0]?.time != null) {
        const rect = rectForDrawing(d, geom)
        const ink = brightenAnnotationColor(d.color) || UCT_DRAW_GOLD
        ctx.save()
        clipToPane(ctx, rect)
        ctx.strokeStyle = ink
        ctx.lineWidth = d.lineWidth || 1
        ctx.setLineDash([])
        renderAnchoredVwap(ctx, d.points[0], bars, timeToIndex, toPixel)
        if (d.id === selectedId) {
          renderSelectionHandles(ctx, resolvePixels(d.points, rect), ink)
        }
        ctx.restore()
        continue
      }

      // The drawing's OWN pane rect, and the anchors resolved against it. Both are
      // needed before anything is painted: `paneY` is a fraction of this rect.
      const rect = rectForDrawing(d, geom)
      const pts = resolvePixels(d.points || [], rect)
      if (!pts.length) continue
      // Off-screen guard (Model Book): if this drawing's anchor bar — its setup
      // candle (rightmost point / rightBoundTime) — is outside the visible range,
      // skip it so a neighbouring setup's label/lines don't bleed in at the edge.
      // Suspended while the view is moving (guardActive) so lines transition in.
      if (guardActive) {
        const idxs = []
        for (const p of (d.points || [])) { const i = nearestIndex(p.time); if (i != null) idxs.push(i) }
        if (d.rightBoundTime != null) { const ri = nearestIndex(d.rightBoundTime); if (ri != null) idxs.push(ri) }
        if (idxs.length) {
          const anchorIdx = Math.max(...idxs)
          if (anchorIdx > visTo + 0.5 || anchorIdx < visFrom - 0.5) continue
        }
      }
      ctx.save()
      // THE PANE CLIP. One call, here, for every tool - not a per-renderer
      // special case. It nests inside the plot-area clip established above, so a
      // drawing is bounded by BOTH: never over the price scale, never across the
      // volume divider. `ctx.restore()` at the bottom of this loop iteration is
      // what balances it, and `drawingRenderers.test.js` pins that every painter
      // leaves the stack even so the share/screenshot capture cannot be corrupted.
      clipToPane(ctx, rect)
      const ink = brightenAnnotationColor(d.color) || UCT_DRAW_GOLD
      ctx.strokeStyle = ink
      ctx.lineWidth = d.lineWidth || 1
      // Per-drawing line style (e.g. a dashed horizontal level). Most shapes set
      // their own dash internally; lines respect this before they draw.
      // ⭐ RESOLVED THROUGH `dashFor`, WHICH KNOWS ABOUT DOTTED — but nothing can
      // hand it 'dotted' yet, because `numToDrawStyle` (below) still turns the
      // picker's dotted code into 'dashed'. That is Phase 1's one-line fix; the
      // dash pattern it will need is already here and already under test. For
      // every value reachable today this is byte-identical to the ternary it
      // replaced: solid/undefined → [], dashed → [6, 4].
      ctx.setLineDash(dashFor(d.lineStyle))

      switch (d.type) {
        case 'trendline': renderTrendline(ctx, pts); break
        case 'ray': renderRay(ctx, pts, rect); break
        case 'extended': renderExtended(ctx, pts, rect); break
        // ⛔ TWO GATES, AND `hidePriceLabels` IS THE HARD ONE. The SURFACE can
        // veto the label outright (Model Book setup lines are line-only, by
        // design and not by the user's choice); only if it does not does the
        // DRAWING's own toggle get asked. Surface override wins, always.
        case 'horizontal':
          renderHorizontal(ctx, pts, rect, {
            showLabel: !hidePriceLabels && !!drawingProp(d, 'showPriceLabel'),
            ink, fmt: priceText, avoid: labelBoxes,
          })
          break
        case 'hray': {
          // Optional right bound (time-anchored): stop the ray at this bar
          // instead of running to the canvas edge. Model Book uses it so that,
          // when all setups are shown on the zoomed-out chart, each ray ends at
          // its setup candle rather than streaking across the whole year.
          let hrayRight = rect.x1
          if (d.rightBoundTime != null) {
            const bx = toPixel(d.rightBoundTime, pts[0].price)?.x
            if (bx != null) hrayRight = Math.max(pts[0].x ?? rect.x0, Math.min(rect.x1, bx))
          }
          renderHRay(ctx, pts, hrayRight, {
            showLabel: !hidePriceLabels && !!drawingProp(d, 'showPriceLabel'),
            ink, fmt: priceText, bounds: rect, avoid: labelBoxes,
          })
          break
        }
        case 'vertical': renderVertical(ctx, pts, rect); break
        case 'rect':
          renderRect(ctx, pts, d, {
            showPercent: !!drawingProp(d, 'showPercentChange'),
            bounds: rect,
          })
          break
        case 'circle': renderCircle(ctx, pts); break
        case 'arrow': renderArrow(ctx, pts, d); break
        case 'text': renderText(ctx, pts, d, textOpacity); break
        case 'fib': renderFib(ctx, pts, rect, toPixelY); break
        case 'fibext': renderFibExtension(ctx, pts, rect, toPixelY); break
        case 'pitchfork': renderPitchfork(ctx, pts, rect); break
        case 'channel': renderChannel(ctx, pts, rect); break
        case 'cup': renderCup(ctx, pts); break
        // ⛔ THE PAINTER NO LONGER DECIDES WHAT IT SAYS. It used to branch on
        // `d.type` to choose between four hard-coded text layouts; the content
        // is now resolved here, from one shared measurement, and the painter
        // draws whatever lines it is handed. That is what lets a Measure show
        // any of the sixteen combinations instead of the one its type implied.
        case 'measure':
        case 'priceRange': {
          const m = measurementFor(d.points, pts, { bars, indexOf: nearestIndex, barSeconds })
          // Model Book's index pane asks for the percentage alone — a SURFACE
          // override, so it wins over whatever the drawing itself says.
          const shown = measurePctOnly
            ? { ...d, showDollar: false, showPercent: true, showBars: false, showTime: false }
            : d
          renderMeasure(ctx, pts, d, { lines: measureLines(shown, m, priceText), bounds: rect })
          break
        }
        case 'dateRange': {
          const m = measurementFor(d.points, pts, { bars, indexOf: nearestIndex, barSeconds })
          renderBarsTime(ctx, pts, d, { lines: measureLines(d, m, priceText), bounds: rect })
          break
        }
        case 'position': renderPosition(ctx, pts); break
        case 'advance': {
          // Recompute the % from the live bars (candle mode) so EXISTING labels are
          // corrected — older ones were stored with a wrong formula (open→high,
          // direction-blind), which mis-stated declines. Also refreshes advHigh/
          // advLow so the label anchors correctly. Line-mode (index pane) keeps its
          // stored value (% between the two clicked line points).
          let ad = d
          if (!lineData && d.points?.length >= 2) {
            const ai = timeToIndex.get(d.points[0].time)
            const bi = timeToIndex.get(d.points[d.points.length - 1].time)
            if (ai != null && bi != null && bars[ai] && bars[bi]) {
              const mv = computeAdvanceMove(bars[ai], bars[bi])
              if (mv) ad = { ...d, advPct: mv.pct, advDelta: mv.delta, advHigh: bars[bi].h, advLow: bars[bi].l }
            }
          } else if (lineData && d.points?.length >= 2) {
            const a = d.points[0].price, b = d.points[d.points.length - 1].price
            if (a > 0 && b != null) ad = { ...d, advPct: ((b - a) / a) * 100, advDelta: b - a }
          }
          // ⭐ THE DOLLAR FIGURE IS ON THE SAME BASIS AS THE PERCENT. `advPct` is
          // measured low→high for a run and high→low for a drop, so deriving the
          // dollar move from the two ANCHOR prices instead would print a
          // percentage and an amount that do not describe the same move. It is
          // recovered from the percentage and its own start price, which is the
          // only way the two can agree by construction.
          const lines = advanceLines(ad, priceText)
          // Where the user PUT the label, if they have moved it. Resolved to
          // pixels through the same mapping as any other anchor, so it pans and
          // zooms with the chart rather than floating in screen space.
          const lp = d.labelPoint ? resolvePixels([d.labelPoint], rect)[0] : null
          const at = lp && lp.valid !== false ? { x: lp.x, y: lp.y } : null
          const box = renderAdvance(ctx, pts, ad, toPixelY, lineData ? 9 : 16, plotRight, autoInk, { lines, at })
          if (box) paintedBoxes.set(d.id, box)
          break
        }
      }

      // Handles inherit the drawing's RENDERED ink (the brightened value the
      // stroke used), so a green line gets green handles - and they are painted
      // inside the same pane clip, so a handle cannot sit in the other pane
      // either.
      // ⭐ AND THEY ARE NOT ALWAYS THE ANCHORS. `handlePointsFor` is the single
      // place a tool can put its handles somewhere the user can actually see
      // them — today that is the Circle, whose stored corners sit outside its own
      // ellipse. The hit test asks the SAME function, so what you grab is always
      // what you see.
      if (d.id === selectedId) {
        // ⛔ PRICE MOVE'S SELECTION BELONGS TO ITS LABEL. The visible object is
        // the label; the anchors are the measurement. A handle on each anchor
        // says "drag me to move this drawing" about two points that are not the
        // drawing and whose movement changes the number. One handle, on the
        // thing the user can see — and the anchors only while adjusting.
        if (d.type === 'advance') {
          const box = paintedBoxes.get(d.id)
          if (adjustingId === d.id) {
            renderSelectionHandles(ctx, pts, ink)
          } else if (box) {
            renderSelectionHandles(ctx, [{ x: box.cx, y: box.cy, valid: true }], ink)
          }
        } else {
          renderSelectionHandles(ctx, handlePointsFor(d.type, pts), ink)
        }
      }
      ctx.restore()
    }

    // Placed-but-uncommitted anchors are ALWAYS visible (wave 12). The preview
    // below is mouseCoords-gated, and on touch the finger LIFTS between taps —
    // so tap 1 of a tap-tap placement drew nothing at all and looked like it
    // didn't register (the coach chip says "tap 2 points", the canvas said
    // nothing). A dot + soft halo at every pending anchor, and a dashed ghost
    // polyline once two are down (a 3-point tool's first segment). Desktop is
    // unchanged in practice: the mouse is always moving, so the live preview
    // draws right over these.
    // The pane the tool is currently placing INTO - taken from the first anchor,
    // so a half-finished drawing previews inside the pane it will be created in.
    const previewRect = rectForKey(geom, pendingPoints[0]?.pane || mouseCoords?.pane || PRICE)

    // ⛔ EXCEPT FOR THE CIRCLE ON A MOUSE. The Circle's first anchor is a bbox
    // corner that ends up OUTSIDE the finished ellipse, so its marker read as a
    // stray dot the tool had left behind — the owner's "creation dot". A mouse
    // never needed it: the live preview under a moving cursor already shows the
    // ellipse being placed. A FINGER does — it lifts between taps, so with the
    // dot suppressed tap 1 would draw nothing at all and look like it had not
    // registered. Pointer type, not platform, decides.
    const hidePendingDots = activeTool === 'circle' && !coarsePointer
    if (activeTool && pendingPoints.length > 0 && !hidePendingDots) {
      const anchorPts = resolvePixels(pendingPoints, previewRect)
      if (anchorPts.length) {
        ctx.save()
        const ink = brightenAnnotationColor(color)
        ctx.strokeStyle = ink
        ctx.fillStyle = ink
        if (anchorPts.length > 1) {
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(anchorPts[0].x, anchorPts[0].y)
          for (let i = 1; i < anchorPts.length; i++) ctx.lineTo(anchorPts[i].x, anchorPts[i].y)
          ctx.stroke()
          ctx.setLineDash([])
        }
        for (const p of anchorPts) {
          ctx.globalAlpha = 0.25
          ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = 1
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill()
        }
        ctx.restore()
      }
    }

    // Draw in-progress preview
    if (activeTool && pendingPoints.length > 0 && mouseCoords) {
      const previewPts = resolvePixels([...pendingPoints, mouseCoords], previewRect)
      if (previewPts.length) {
        ctx.save()
        clipToPane(ctx, previewRect)
        ctx.strokeStyle = brightenAnnotationColor(color)
        ctx.lineWidth = lineWidth
        ctx.globalAlpha = 0.7
        ctx.setLineDash([])

        switch (activeTool) {
          case 'trendline': renderTrendline(ctx, previewPts); break
          case 'ray': renderRay(ctx, previewPts, previewRect); break
          case 'extended': renderExtended(ctx, previewPts, previewRect); break
          // The preview shows the label the FINISHED drawing will have, so what
          // you see while placing is what you get when you let go.
          case 'horizontal':
            renderHorizontal(ctx, previewPts, previewRect, {
              showLabel: !hidePriceLabels && !!newDrawingProps('horizontal', toolDefaults)?.showPriceLabel,
              ink: brightenAnnotationColor(color), fmt: priceText,
            })
            break
          case 'vertical': renderVertical(ctx, previewPts, previewRect); break
          case 'rect': renderRect(ctx, previewPts, newDrawingProps('rect', toolDefaults)); break
          case 'circle': renderCircle(ctx, previewPts); break
          case 'arrow': renderArrow(ctx, previewPts, newDrawingProps('arrow', toolDefaults)); break
          case 'fib': renderFib(ctx, previewPts, previewRect, toPixelY); break
          case 'fibext': renderFibExtension(ctx, previewPts, previewRect, toPixelY); break
          case 'pitchfork': renderPitchfork(ctx, previewPts, previewRect); break
          case 'channel': renderChannel(ctx, previewPts, previewRect); break
          case 'cup': renderCup(ctx, previewPts); break
          // ⭐ THE PREVIEW SHOWS THE FINISHED DRAWING'S FIELDS, not a reduced
          // placeholder — what you read while dragging is what you get when you
          // let go. Same measurement call, same formatter, same label builder.
          case 'measure':
          case 'priceRange': {
            const proto = { type: activeTool, ...(newDrawingProps(activeTool, toolDefaults) || {}) }
            const shown = measurePctOnly
              ? { ...proto, showDollar: false, showPercent: true, showBars: false, showTime: false }
              : proto
            const m = measurementFor([...pendingPoints, mouseCoords], previewPts, { bars, indexOf: nearestIndex, barSeconds })
            renderMeasure(ctx, previewPts, proto, { lines: measureLines(shown, m, priceText), bounds: previewRect })
            break
          }
          case 'dateRange': {
            const proto = { type: 'dateRange', ...(newDrawingProps('dateRange', toolDefaults) || {}) }
            const flat = constrainPoints('dateRange', [...pendingPoints, mouseCoords])
            const flatPx = resolvePixels(flat, previewRect)
            const m = measurementFor(flat, flatPx, { bars, indexOf: nearestIndex, barSeconds })
            renderBarsTime(ctx, flatPx, proto, { lines: measureLines(proto, m, priceText), bounds: previewRect })
            break
          }
          case 'position': renderPosition(ctx, previewPts); break
          case 'avwap': renderAnchoredVwap(ctx, pendingPoints[0] || mouseCoords, bars, timeToIndex, toPixel); break
          case 'advance': {
            // ⭐ THE CONNECTOR IS CONSTRUCTION GEOMETRY AND LIVES ONLY HERE. It
            // shows the span being measured WHILE placing; the finished drawing
            // is the label alone, and nothing draws a line between the anchors
            // once the second click lands. That was already true and Phase 5
            // keeps it — the audit's "no persistent construction line" is a
            // property of where this call sits, not of a flag.
            renderTrendline(ctx, previewPts)
            const proto = newDrawingProps('advance', toolDefaults) || {}
            let ad = null
            if (lineData) {
              const a = previewPts[0]?.rawPrice, b = previewPts[previewPts.length - 1]?.rawPrice
              if (a > 0 && b != null) ad = { type: 'advance', ...proto, advPct: ((b - a) / a) * 100, advDelta: b - a, advHigh: b }
            } else {
              const ai = timeToIndex.get(pendingPoints[0].time)
              const bi = timeToIndex.get(mouseCoords.time)
              if (ai != null && bi != null && bars[ai] && bars[bi]) {
                const mv = computeAdvanceMove(bars[ai], bars[bi])
                if (mv) ad = { type: 'advance', ...proto, advPct: mv.pct, advDelta: mv.delta, advHigh: bars[bi].h, advLow: bars[bi].l }
              }
            }
            if (ad) renderAdvance(ctx, previewPts, ad, toPixelY, lineData ? 9 : 16, plotRight, autoInk, { lines: advanceLines(ad, priceText) })
            break
          }
        }
        ctx.restore()
      }
    }

    // What this frame painted, for the hit test that runs between frames.
    labelBoxRef.current = paintedBoxes

    // Crosshair when tool active
    if (activeTool && mouseCoords) {
      const px = toPixel(mouseCoords.time, mouseCoords.price)
      if (px?.x != null && px?.y != null) {
        renderCrosshair(ctx, px.x, px.y, mouseCoords.price, geom.plot)
      }
    }
    ctx.restore()   // end plot-area clip
  }, [drawings, visibleDrawings, pendingPoints, mouseCoords, activeTool, color, lineWidth, fontSize, selectedId, toPixel, resolvePixels, timeToIndex, nearestIndex, textInput?.editId, measurePanes, rectForDrawing, coarsePointer, hidePriceLabels, toolDefaults, seriesRef, adjustingId])

  // Keep redrawRef in sync — always points to latest redraw
  redrawRef.current = redraw
  // The parent (StockChart) calls this right after an instant frame snap. We
  // can't just redraw — LWC's priceToCoordinate is still the pre-snap mapping
  // this frame (its scale updates on its own later paint). So BLANK the layer now
  // and let the rAF tick redraw it the moment the mapping actually changes; that
  // way the lines never appear at the wrong height, they just resolve into place.
  if (redrawHandleRef) redrawHandleRef.current = (vertRange) => {
    // vertRange = { lo, hi } edge-to-edge target price range for the snapped frame.
    // Draw Y from it directly (instant + correct) until LWC's own mapping settles
    // to the same range, at which point the tick clears snapActiveRef and we hand
    // back to priceToCoordinate. Without a valid range we can't compute Y, so fall
    // straight through to priceToCoordinate (may pop, but never blanks).
    if (vertRange && Number.isFinite(vertRange.lo) && Number.isFinite(vertRange.hi) && vertRange.hi > vertRange.lo) {
      snapVertRef.current = { lo: vertRange.lo, hi: vertRange.hi }
      snapActiveRef.current = true
      try { snapBaseYRef.current = seriesRef?.current?.priceToCoordinate(1) ?? null } catch { snapBaseYRef.current = null }
      if (snapSafetyRef.current) clearTimeout(snapSafetyRef.current)
      // Safety net: drop the override after a beat even if the settle isn't detected.
      snapSafetyRef.current = setTimeout(() => { snapActiveRef.current = false; redrawRef.current?.() }, 400)
    }
    redrawRef.current?.()   // paint now, at the correct height
  }

  // Trigger redraw when any drawing state changes
  useEffect(() => { redrawRef.current?.() }, [redraw])

  // ── Mouse helpers ──
  const getCanvasPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Screen box → the chart coordinate at its centre. Used once, at the moment a
  // never-moved Price Move label is first grabbed, so the drag has somewhere to
  // start from.
  const labelStartFrom = useCallback((box) => {
    if (!box) return null
    const c = toChart(box.cx, box.cy)
    return c ? { time: c.time, price: c.price, ...(c.paneY != null ? { paneY: c.paneY } : {}), ...(c.futureBars ? { futureBars: c.futureBars } : {}) } : null
  }, [toChart])

  // ── Hit test all drawings ──
  // Advance/decline % labels render above the candle's HIGH or below its LOW —
  // and frequently sit ON the candles. A point-only hit box misses them, so make
  // the WHOLE candle column (high→low, + a margin past each for the label)
  // right-clickable. Uses the same anchors the renderer does, backfilling the
  // low for older decline labels so they're deletable too.
  const hitTestAdvance = useCallback((d, pts, mx, my) => {
    // ⭐ THE LABEL IS THE TARGET, because the label is the drawing.
    //
    // ⚰️ WHAT THIS REPLACES was a 60×(wick+60) rectangle around the anchor
    // CANDLE — a hitbox big enough to swallow clicks on the candles themselves,
    // on any trendline crossing them, and on a neighbouring drawing, in a region
    // where the Price Move tool draws nothing at all. It existed because the
    // label's real position was not knowable outside the painter. It is now:
    // the painter returns the box it drew and the last frame's boxes are right
    // here, so the grab area is exactly the ink.
    const box = labelBoxRef.current.get(d.id)
    if (box) return pointInBox(box, mx, my, HIT_THRESHOLD() - 2)
    // No box this frame means the label was not painted (anchor off-screen, or
    // every field switched off) — and what is not drawn cannot be clicked.
    return false
  }, [])

  // ⛔ ADJUST MODE BELONGS TO ONE DRAWING AND ENDS WHEN THAT DRAWING IS NO
  // LONGER THE SELECTED ONE. Without this the anchors of a Price Move you have
  // moved on from stay live on the canvas, and a stray drag on one of them
  // edits a measurement you are not even looking at.
  useEffect(() => {
    if (adjustingId && selectedId !== adjustingId) setAdjustingId(null)
  }, [selectedId, adjustingId])

  const hitTestAll = useCallback((mx, my) => {
    const geom = paneGeom()
    // You cannot select what you cannot see - a hidden object must not steal a
    // tap from the visible one underneath it. THE SAME NOW GOES FOR THE CLIPPED
    // HALF OF A DRAWING: `hitTestDrawing` rejects a cursor outside the pane rect,
    // so a price trendline cannot keep swallowing clicks in the volume pane it is
    // no longer painted in. A clip without a matching hit test is an invisible
    // hitbox, which is the worse of the two bugs.
    for (let i = visibleDrawings.length - 1; i >= 0; i--) {
      const d = visibleDrawings[i]
      const rect = rectForDrawing(d, geom)
      const pts = resolvePixels(d.points || [], rect)
      const hit = d.type === 'advance'
        ? hitTestAdvance(d, pts, mx, my)
        : hitTestDrawing(d, pts, mx, my, rect)
      if (hit) return d.id
    }
    return null
  }, [visibleDrawings, resolvePixels, hitTestAdvance, paneGeom, rectForDrawing])

  // ── Hit test handles (control points) — returns { drawingId, handleIdx } or null ──
  const hitTestHandle = useCallback((mx, my) => {
    if (!selectedId) return null
    const d = drawings.find(d => d.id === selectedId)
    if (!d) return null
    // ⭐ THE VISIBLE HANDLE IS THE TARGET. `handlePointsFor` moves the Circle's
    // dots onto its border for painting; grabbing has to use the same positions
    // or the cursor would change over one place and the drag start at another.
    // Index correspondence survives the mapping, so `handleIdx` still names the
    // stored anchor the drag will move.
    let pts = handlePointsFor(d.type, resolvePixels(d.points || [], rectForDrawing(d)))
    if (d.type === 'advance') {
      // ⛔ AND THE ANCHORS ARE NOT GRABBABLE UNLESS THEY ARE VISIBLE. Outside
      // adjust mode a Price Move has exactly one handle — the label — and it is
      // moved by the body-drag path, not by a handle drag, because moving it
      // must write `labelPoint` and never touch the measurement.
      if (adjustingId !== d.id) return null
    }
    for (let i = 0; i < pts.length; i++) {
      // INDEX-STABLE: `i` is an index into the STORED points, which is exactly
      // what `handleIdx` means to the drag path. Skipping an unresolvable anchor
      // (rather than filtering it out of the array) is what keeps that true.
      if (!pts[i].valid) continue
      if (Math.hypot(mx - pts[i].x, my - pts[i].y) < HIT_THRESHOLD() + 2) {
        return { drawingId: d.id, handleIdx: i }
      }
    }
    return null
  }, [selectedId, drawings, resolvePixels, rectForDrawing, adjustingId])

  // ── Latest-value refs for the long-lived native listeners below ──
  // (window/canvas listeners are attached once with []; read live state via refs
  // so they never see a stale hit-test / tool / drag snapshot.)
  const hitTestAllRef = useRef(hitTestAll); hitTestAllRef.current = hitTestAll
  const hitTestHandleRef = useRef(hitTestHandle); hitTestHandleRef.current = hitTestHandle
  const hoverGuardRef = useRef(null)
  hoverGuardRef.current = { activeTool, isDragging, selectedId }
  // Live ctx-menu flag for the touch listener (so an open bottom-sheet isn't
  // fought by the drag path when a drawing sits behind it).
  const ctxMenuOpenRef = useRef(false)
  ctxMenuOpenRef.current = !!ctxMenu

  // ── Direct-manipulation hover (mouse only) ──
  // With NO tool armed the overlay canvas is pointer-transparent so the chart owns
  // pan/zoom. Here we watch the mouse (events bubble up through the transparent
  // canvas to its wrapper) and, when it's over a drawing, set hoverActive → the
  // overlay becomes interactive for that spot only. Touch has no hover, so those
  // devices stay on the existing tool-armed path (deferred follow-up).
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!wrapper) return
    const hasHover = window.matchMedia?.('(hover: hover)')?.matches
    if (!hasHover) return
    const onMove = (e) => {
      const g = hoverGuardRef.current
      // A tool is armed → overlay already interactive; mid-drag → don't re-hit-test
      // (would fight the drag and could flip pointerEvents out from under it).
      if (g.activeTool || g.isDragging) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left, y = e.clientY - rect.top
      let id = null, onHandle = false
      if (g.selectedId) {
        const hh = hitTestHandleRef.current(x, y)
        if (hh) { onHandle = true; id = hh.drawingId }
      }
      if (!id) id = hitTestAllRef.current(x, y)
      setHoverActive(!!id)
      setHoverDrawingId(id ? (onHandle ? '__handle__' : id) : null)
    }
    const onLeave = () => { setHoverActive(false); setHoverDrawingId(null) }
    wrapper.addEventListener('mousemove', onMove)
    wrapper.addEventListener('mouseleave', onLeave)
    return () => {
      wrapper.removeEventListener('mousemove', onMove)
      wrapper.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // ── Native right-click on a drawing ──
  // Attached directly to the canvas so it fires DURING bubble BEFORE the chart
  // container's own native `contextmenu` listener (which opens the big chart
  // settings menu). stopPropagation there keeps that menu from also opening — but
  // ONLY when the cursor is over a drawing; empty space falls through to the chart.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onCtx = (e) => {
      const rect = canvas.getBoundingClientRect()
      const hitId = hitTestAllRef.current(e.clientX - rect.left, e.clientY - rect.top)
      if (!hitId) return   // not on a drawing → let the chart's menu handle it
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(hitId)
      setCtxMenu({ x: e.clientX, y: e.clientY, drawingId: hitId })
    }
    canvas.addEventListener('contextmenu', onCtx)
    return () => canvas.removeEventListener('contextmenu', onCtx)
  }, [setSelectedId])

  // ── Mouse handlers ──
  const handlePointerDown = useCallback((e) => {
    // Right mouse button is the context-menu path, not draw/drag.
    if (e.pointerType === 'mouse' && e.button !== 0) return

    // Multi-touch: a 2nd finger means the user is pinch-zooming the chart —
    // abort any in-progress placement/drag so we don't fight the gesture.
    activePointersRef.current.add(e.pointerId)
    if (activePointersRef.current.size > 1) {
      if (isDragging) { dragRef.current = null; setIsDragging(false) }
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
      return
    }

    const pos = getCanvasPos(e)
    if (!pos) return

    // Capture so a drag keeps tracking even if the finger leaves the canvas.
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* noop */ }

    // Touch long-press over a drawing → open its context menu (no right-click on touch).
    if (e.pointerType !== 'mouse') {
      const lpHitId = hitTestAll(pos.x, pos.y)
      if (lpHitId) {
        const cx = e.clientX, cy = e.clientY
        longPressRef.current = setTimeout(() => {
          longPressRef.current = null
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          setSelectedId(lpHitId)
          setCtxMenu({ x: cx, y: cy, drawingId: lpHitId })
        }, 450)
      }
    }

    const coords = snap(toChart(pos.x, pos.y))

    // ── ERASER: click a drawing to delete it (stays armed for more) ──
    if (activeTool === 'eraser') {
      e.preventDefault()
      const hitId = hitTestAll(pos.x, pos.y)
      if (hitId) {
        const d = drawings.find(dr => dr.id === hitId)
        if (d && !d.locked) { removeDrawing(hitId); if (selectedId === hitId) setSelectedId(null) }
      }
      return
    }

    // ── CURSOR MODE: select + drag ──
    // Also the implicit no-tool case: the overlay only receives this pointerdown
    // (pointerEvents flipped to 'auto') because the mouse is hovering a drawing,
    // so treat it exactly like cursor mode — grab/reshape without arming a tool.
    if (activeTool === 'cursor' || (!activeTool && (hoverActive || touchHitRef.current))) {
      // Check handle drag first (move individual control point)
      const handle = hitTestHandle(pos.x, pos.y)
      if (handle) {
        const d = drawings.find(d => d.id === handle.drawingId)
        if (d) {
          if (d.locked) { setSelectedId(d.id); e.preventDefault(); return }   // locked → select, no reshape
          dragRef.current = {
            drawingId: handle.drawingId,
            handleIdx: handle.handleIdx,
            startPixel: pos,
            startCoords: coords,
            originalPoints: d.points.map(p => ({ ...p })),
          }
          setIsDragging(true)
          e.preventDefault()
          return
        }
      }

      // Check body drag (move entire drawing)
      const hitId = hitTestAll(pos.x, pos.y)
      if (hitId) {
        setSelectedId(hitId)
        const d = drawings.find(d => d.id === hitId)
        if (d) {
          if (d.locked) { e.preventDefault(); return }   // locked → selected but not movable
          // Alt-drag = clone: spawn a copy at the same spot and drag THAT, leaving
          // the original where it was (TradingView's duplicate-drag gesture).
          let dragId = hitId
          if (e.altKey) {
            const { id: _cid, ...rest } = d
            dragId = addDrawing({ ...rest, points: d.points.map(p => ({ ...p })), locked: false })
            setSelectedId(dragId)
          }
          dragRef.current = {
            drawingId: dragId,
            handleIdx: null, // null = whole body
            startPixel: pos,
            startCoords: coords,
            originalPoints: d.points.map(p => ({ ...p })),
            // ⭐ WHERE PRICE MOVE'S LABEL IS RIGHT NOW, in chart coordinates.
            //
            // A label the user has never moved has no stored position — it is
            // derived from the run's high or low. Dragging it therefore has to
            // start from where it is ON SCREEN, or the first pixel of movement
            // would teleport it to wherever a default happened to be. The
            // painter published the box it drew, so the answer is exact and the
            // drag is continuous from the very first frame.
            labelStart: d.type === 'advance'
              ? (d.labelPoint ? { ...d.labelPoint } : labelStartFrom(labelBoxRef.current.get(d.id)))
              : null,
          }
          setIsDragging(true)
          e.preventDefault()
          return
        }
      }

      // Clicked empty space — deselect
      setSelectedId(null)
      return
    }

    // ── DRAWING MODES ──
    if (!coords) return

    // Text tool: place text input (use fixed position via clientX/clientY to avoid overflow clip)
    if (activeTool === 'text') {
      setTextInput({ x: e.clientX, y: e.clientY, canvasX: pos.x, canvasY: pos.y, time: coords.time, price: coords.price, paneY: coords.paneY ?? null, pane: coords.pane || PRICE })
      return
    }

    // Add point for drawing tools
    if (activeTool && activeTool !== 'cursor') {
      const newPending = [...pendingPoints, coords]
      const needed = POINT_COUNT[activeTool] || 2

      if (newPending.length >= needed) {
        const drawingData = {
          type: activeTool,
          points: newPending,
          color,
          lineWidth,
          lineStyle,   // 'solid' | 'dashed' | 'dotted'
          // PANE OWNERSHIP IS A PROPERTY OF THE DRAWING, SET ONCE, HERE.
          // It comes from the FIRST anchor: that is the pane the user aimed at,
          // and using the first (rather than, say, the lowest) means a drawing
          // started in the candles stays a price drawing even if the second click
          // strays over the divider. A drawing can no longer be half-and-half.
          pane: newPending[0]?.pane || PRICE,
          // ⛔ NEW DRAWINGS CARRY THEIR OWN SETTINGS; OLD ONES CARRY NOTHING, AND
          // THAT IS THE DIFFERENCE. A new Horizontal Line is stamped
          // `showPriceLabel: true` here, while a line drawn last year has no such
          // property and resolves to the `false` in DRAWING_DEFAULTS. Same code
          // path, two answers, no migration — and the user's own saved tool
          // defaults override the built-in.
          ...(newDrawingProps(activeTool, toolDefaults) || {}),
        }
        // ⚰️ `barCount` IS NO LONGER WRITTEN, AND NO LONGER READ.
        //
        // It was frozen here at creation and printed forever: resize the box and
        // it stayed put, switch daily→weekly and a 25-bar measurement went on
        // claiming 25 bars while spanning five. `measurementFor` derives it from
        // the live anchors every frame instead. The property is not stripped
        // from drawings that already carry it — nothing writes on load — it is
        // simply no longer consulted.
        drawingData.points = constrainPoints(activeTool, drawingData.points)
        // Advance label: % from the OPEN of the FIRST clicked candle to the HIGH
        // of the SECOND — same basis as the auto setup-advance labels. Stored at
        // creation so it survives reload without needing a bar lookup. In line
        // mode (index pane) there are no candles, so use the LINE values at the
        // two clicked points (1st → 2nd) — gives the % advance/decline of the move.
        if (activeTool === 'advance' && newPending.length >= 2) {
          if (lineData) {
            const a = newPending[0].price, b = newPending[1].price
            if (a > 0 && b != null) {
              drawingData.advPct = ((b - a) / a) * 100
              drawingData.advDelta = b - a
              drawingData.advHigh = b
            }
          } else {
            const ai = timeToIndex.get(newPending[0].time)
            const bi = timeToIndex.get(newPending[1].time)
            if (ai != null && bi != null && bars[ai] && bars[bi]) {
              const mv = computeAdvanceMove(bars[ai], bars[bi])
              if (mv) { drawingData.advPct = mv.pct; drawingData.advDelta = mv.delta }
              drawingData.advHigh = bars[bi].h
              drawingData.advLow = bars[bi].l   // decline labels anchor below this
            }
          }
        }
        const newId = addDrawing(drawingData)
        setPendingPoints([])
        // A completed placement is the proof the tap-tap model landed —
        // retire the touch coach chip for good. (Event context, not an effect.)
        markTapHintSeen()
        if (!repeatMode) {
          setActiveTool(null)
          // TradingView's post-draw beat on touch: the finished drawing comes up
          // SELECTED, so the quick-action bar appears at the exact moment you
          // most want to restyle or delete what you just placed. Mouse users
          // keep the unselected finish (they have hover + right-click).
          if (coarsePointer && newId) setSelectedId(newId)
        }
      } else {
        setPendingPoints(newPending)
      }
    }
  // `toolDefaults` IS A REAL DEPENDENCY, not a lint appeasement: it is read when
  // a drawing is created, so a stale copy would mean "Save as default" did not
  // take effect until something unrelated happened to rebuild this callback.
  }, [activeTool, hoverActive, pendingPoints, color, lineWidth, lineStyle, toChart, snap, addDrawing, setSelectedId, timeToIndex, bars, lineData, drawings, hitTestAll, hitTestHandle, repeatMode, isDragging, removeDrawing, selectedId, markTapHintSeen, toolDefaults])

  const handlePointerMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    if (!pos) return
    const coords = toChart(pos.x, pos.y)

    // Movement cancels a pending long-press (it was a pan, not a press).
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }

    // ── DRAGGING ──
    // dragRef alone decides (NOT the isDragging closure): the ref is written
    // synchronously on pointerdown, while the state needs a render to reach
    // this callback's closure — a drag whose first moves land before that
    // render (busy phone main thread; the rig's synchronous dispatch) would
    // silently drop them. isDragging remains the RENDER signal only.
    if (dragRef.current && coords) {
      const drag = dragRef.current
      const d = drawings.find(d => d.id === drag.drawingId)
      if (!d || !drag.startCoords) return

      // ⛔ TOUCH SLOP — the gate between "I am selecting this" and "I am moving
      // this". Without it the first pointermove after a grab applied the delta,
      // and a finger always jitters a pixel or two: tapping a trendline to
      // select it moved it off its anchor, silently, with an undo the user has
      // to think of. Below the threshold this is still a TAP — geometry is not
      // touched and no history entry is created.
      // ⭐ Once armed it STAYS armed, and the delta is still measured from the
      // ORIGINAL grab point, so the object ends up exactly under the finger
      // rather than permanently lagging it by the slop distance.
      if (!drag.armed) {
        if (!CROSSED_SLOP(drag.startPixel, pos)) return
        drag.armed = true
      }

      // Compute delta in chart coordinates. In the empty right-pad, toChart clamps
      // `time` to the last candle and stashes the real offset in `futureBars`, so
      // the delta MUST add futureBars — otherwise it saturates at the last bar and
      // an endpoint can't be dragged past the current candle into the future.
      const effLogical = (c) => {
        // nearestIndex (NOT exact timeToIndex.get) — on a live intraday chart a
        // stored point time can drift off an exact bar key (bars get re-bucketed /
        // sanitized), and an exact miss `?? 0` would resolve to index 0 → the point
        // snaps horizontally to the far-left first bar. nearestIndex snaps to the
        // containing bar instead, matching how the line is RENDERED.
        const base = c?.time != null ? (nearestIndex(c.time) ?? 0) : 0
        return base + (Number.isFinite(c?.futureBars) ? c.futureBars : 0)
      }
      // ⭐ HOW FAR THE ANCHOR MOVES PER PIXEL OF POINTER. It is 1 for every tool
      // and for every whole-body move; the Circle's border handles are the one
      // case where the dot the user grabbed is a BLEND of both anchors, so moving
      // the anchor 1:1 would leave the dot trailing the mouse. See
      // `handleDragGain` — this is the only place the correction is applied, and
      // it multiplies the DELTA, so the drag still starts exactly where it was
      // grabbed and nothing jumps.
      const gain = handleDragGain(d.type, drag.handleIdx)
      const timeDelta = coords.time && drag.startCoords.time
        ? Math.round((effLogical(coords) - effLogical(drag.startCoords)) * gain)
        : 0
      const priceDelta = ((coords.price || 0) - (drag.startCoords.price || 0)) * gain
      // Vertical anchor handling. Price-pane points keep the existing (log-safe)
      // priceDelta move; volume-pane points move by a pixel-fraction so they stay
      // in the volume pane. A point dragged ACROSS the pane boundary re-anchors to
      // the side it lands on — so an old price-anchored volume label fixes itself
      // permanently once nudged. The boundary is the price pane's bottom edge.
      const H = sizeRef.current.h || 0
      const pixelDY = (drag.startPixel) ? (pos.y - drag.startPixel.y) * gain : 0
      const clamp01 = v => Math.max(0, Math.min(1, v))
      // The drawing keeps the pane it was created in for the whole gesture. A
      // drag can no longer convert an anchor - or worse, HALF a drawing - into
      // the other pane; that was only ever possible because ownership was
      // re-derived per point from the pixel it happened to land on.
      const dragRect = rectForDrawing(d)
      const moveY = (p) => {
        // Pane-fraction anchors (new `paneY`, and legacy `paneRelY` on its way to
        // becoming one) move by a fraction of THEIR OWN PANE, so the drawing keeps
        // its place among the volume bars when the divider moves.
        if (p.paneY != null || p.paneRelY != null) {
          const zoneH = dragRect ? (dragRect.y1 - dragRect.y0) : 0
          const cur = p.paneY != null
            ? p.paneY
            : (dragRect && H ? toPaneFraction(dragRect, p.paneRelY * H) : 0)
          const next = clamp01(cur + (zoneH > 0 ? pixelDY / zoneH : 0))
          // A legacy canvas-fraction point UPGRADES to a pane fraction the first
          // time it is moved - the one moment a rewrite is legitimate, because the
          // user is already changing the geometry. Nothing is migrated on load.
          return { paneY: next, paneRelY: null, price: p.price }
        }
        return { price: (p.price ?? 0) + priceDelta }
      }

      // Move a point by `timeDelta` bars along X, honoring FUTURE points (past the
      // last candle): a future point's origin index is lastIdx + its futureBars, and
      // dragging it further right keeps it in the right-pad; dragging it back into
      // the data drops futureBars (returns to a real bar time). In-data points behave
      // exactly as before.
      const _lastIdx = bars.length - 1
      const moveX = (p) => {
        // NO HORIZONTAL MOVEMENT MEANS NO HORIZONTAL WRITE.
        //
        // This guard is the whole of the "vertical drag moved my drawing
        // sideways" fix. Without it, a purely vertical nudge still ran the point
        // through `nearestIndex(p.time)` and wrote back `bars[thatIndex].t` - and
        // on any timeframe where the stored anchor is not an EXACT bar (a
        // daily-anchored drawing viewed weekly; an intraday chart whose buckets
        // were re-sanitised), `nearestIndex` returns the CONTAINING bar. So a 3px
        // vertical drag silently re-anchored the drawing to the start of the
        // containing week, permanently, and it had visibly moved the next time the
        // user looked at it on the daily.
        //
        // Time is data. It changes when the user drags along the time axis, and at
        // no other moment.
        if (timeDelta === 0) return { ...p, ...moveY(p) }
        const origIdx = (Number.isFinite(p.futureBars) && p.futureBars > 0)
          ? _lastIdx + p.futureBars
          : (nearestIndex(p.time) ?? 0)   // nearest, not exact - see effLogical note
        const rawIdx = origIdx + timeDelta
        if (rawIdx > _lastIdx) {
          return { ...p, time: bars[_lastIdx].t, futureBars: Math.min(FUTURE_BARS_CAP, rawIdx - _lastIdx), ...moveY(p) }
        }
        // `...p` FIRST so fields this function does not know about survive a drag.
        // The old version built a fresh {time, ...moveY(p)} object, so anything
        // else on a point was dropped by the first person who moved the drawing -
        // which is exactly how a new per-point property gets silently lost.
        const next = { ...p, time: bars[Math.max(0, rawIdx)]?.t || p.time, ...moveY(p) }
        if (!(Number.isFinite(p.futureBars) && p.futureBars > 0)) delete next.futureBars
        return next
      }
      // ⛔ DRAGGING A PRICE MOVE MOVES ITS LABEL, NOT ITS MEASUREMENT.
      //
      // ⚰️ THE BUG THIS FIXES. A body drag ran every anchor through `moveX`, so
      // nudging the label two candles to the right re-anchored the run to two
      // different candles and silently restated the number the label existed to
      // report. The user asked to move a caption and got a different
      // measurement. Anchors are DATA here; only `labelPoint` is geometry the
      // user is allowed to push around, and the anchors are edited deliberately,
      // through Adjust anchors.
      if (d.type === 'advance' && drag.handleIdx == null) {
        if (!drag.labelStart) return
        if (!drag.snapped) { snapshotHistory?.(); drag.snapped = true }
        updateDrawing(drag.drawingId, { labelPoint: moveX(drag.labelStart) }, { record: false })
        requestRedraw()
        return
      }

      let newPoints
      if (drag.handleIdx != null) {
        // Move single control point
        newPoints = drag.originalPoints.map((p, i) => (i !== drag.handleIdx ? p : moveX(p)))
      } else {
        // Move entire drawing
        newPoints = drag.originalPoints.map(moveX)
      }
      // The shape's own invariant, re-applied after every edit — a Bars & Time
      // ruler cannot be tilted by dragging one end of it. Identity for every
      // other tool.
      newPoints = constrainPoints(d.type, newPoints)

      // First move of a drag → snapshot the pre-drag state ONCE so the whole drag
      // collapses into a single undo step; per-move writes then skip history.
      if (!drag.snapped) { snapshotHistory?.(); drag.snapped = true }
      updateDrawing(drag.drawingId, { points: newPoints }, { record: false })
      requestRedraw()
      return
    }

    // ── CURSOR MODE: hover detection for cursor change ──
    if (activeTool === 'cursor') {
      const handle = hitTestHandle(pos.x, pos.y)
      if (handle) {
        setHoverDrawingId('__handle__')
      } else {
        const hitId = hitTestAll(pos.x, pos.y)
        setHoverDrawingId(hitId)
      }
    }

    // Standard preview for drawing tools — snap so the preview shows the magnet target
    setMouseCoords(snap(coords))
    requestRedraw()
  }, [activeTool, toChart, snap, requestRedraw, drawings, timeToIndex, nearestIndex, bars, updateDrawing, snapshotHistory, hitTestAll, hitTestHandle, rectForDrawing])

  const handlePointerUp = useCallback((e) => {
    if (e?.pointerId != null) activePointersRef.current.delete(e.pointerId)
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
    // Gate on dragRef, NOT the isDragging closure: a fast tap's down+up can both
    // land inside one render window (a busy phone main thread; the rig's
    // synchronous dispatch), where this callback still closes over the PRE-drag
    // isDragging=false — the drag armed by the down then sticks (cursor stuck
    // 'grabbing', selection UI suppressed) until the next tap. dragRef is
    // written synchronously on down, so it can never be stale here.
    if (dragRef.current) {
      dragRef.current = null
      setIsDragging(false)
    }
  }, [])

  // ── Touch / tablet direct manipulation ──
  // Touch has no hover, so the mouse pre-flip trick (hoverActive) can't work: the
  // first signal IS the touchstart, and the browser has already committed the touch
  // to whatever element was hit-tested before any JS runs — we can't retarget it.
  // So instead of flipping the overlay's pointerEvents (which would either swallow
  // ALL touches or none), the overlay stays pointer-transparent and a CAPTURE-phase
  // pointerdown listener on the wrapper (an ancestor of both the chart + overlay
  // canvases) decides per-touch: if it lands ON a drawing, we stopPropagation so the
  // chart never starts a pan, capture the pointer to the wrapper, and drive the SAME
  // drag / long-press path as the mouse (handlePointerDown/Move/Up). If it lands on
  // empty space — or a 2nd finger arrives — we do nothing, so the chart keeps its
  // native one-finger pan and two-finger pinch-zoom completely intact.
  const pointerDownRef = useRef(handlePointerDown); pointerDownRef.current = handlePointerDown
  const pointerMoveRef = useRef(handlePointerMove); pointerMoveRef.current = handlePointerMove
  const pointerUpRef = useRef(handlePointerUp); pointerUpRef.current = handlePointerUp
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!wrapper || !coarsePointer) return     // touch / coarse-pointer devices only
    let dragging = false
    const onDown = (e) => {
      if (e.pointerType === 'mouse') return
      if (ctxMenuOpenRef.current) return       // menu/sheet open → let taps reach it
      // The floating quick bar overlays the canvas — a tap on its buttons must
      // never hit-test the drawing beneath it into a drag (capture phase: the
      // bar's own stopPropagation runs too late to save it).
      if (e.target.closest?.('[data-uct-qbar]')) return
      const g = hoverGuardRef.current
      if (g.activeTool) return                 // a tool is armed → the canvas React handlers own it
      // A 2nd finger means the user wants to pinch/pan — bail out of any drag we
      // started and let the gesture through (don't stopPropagation).
      if (activePointersRef.current.size >= 1) {
        if (dragging) { dragging = false; pointerUpRef.current(e) }
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left, y = e.clientY - rect.top
      let hit = null
      if (g.selectedId) { const hh = hitTestHandleRef.current(x, y); if (hh) hit = hh.drawingId }
      if (!hit) hit = hitTestAllRef.current(x, y)
      if (!hit) return                         // empty space → let the chart pan / pinch
      // We own this touch. Stop it reaching the chart, then run the shared path.
      e.stopPropagation()
      dragging = true
      touchHitRef.current = true
      try { pointerDownRef.current(e) } finally { touchHitRef.current = false }
    }
    const onMove = (e) => {
      if (e.pointerType === 'mouse' || !dragging) return
      e.stopPropagation()
      pointerMoveRef.current(e)
    }
    const onUp = (e) => {
      if (e.pointerType === 'mouse' || !dragging) return
      dragging = false
      pointerUpRef.current(e)
    }
    // While WE are dragging a drawing, block the browser's default touch scrolling
    // (non-passive so preventDefault sticks). Chart pans (dragging=false) are untouched.
    const onTouchMove = (e) => { if (dragging) e.preventDefault() }
    const capT = { capture: true }
    wrapper.addEventListener('pointerdown', onDown, capT)
    wrapper.addEventListener('pointermove', onMove, capT)
    wrapper.addEventListener('pointerup', onUp, capT)
    wrapper.addEventListener('pointercancel', onUp, capT)
    wrapper.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    return () => {
      wrapper.removeEventListener('pointerdown', onDown, capT)
      wrapper.removeEventListener('pointermove', onMove, capT)
      wrapper.removeEventListener('pointerup', onUp, capT)
      wrapper.removeEventListener('pointercancel', onUp, capT)
      wrapper.removeEventListener('touchmove', onTouchMove, { capture: true })
    }
  }, [coarsePointer])

  // Deselect when clicking away. In no-tool mode the overlay canvas is
  // pointer-transparent over empty space, so an empty-space click lands on the
  // chart canvas (a sibling) and the overlay's own pointerdown never fires —
  // leaving the selection handles stuck. This document-level capture listener
  // clears the selection on any pointerdown that ISN'T on the overlay canvas
  // (a drawing/handle click keeps the selection; the overlay handles it).
  useEffect(() => {
    if (!selectedId) return
    const onDocDown = (e) => {
      if (e.target === canvasRef.current) return
      // Interacting with the selection's own UI is not a tap-away: the quick
      // bar's buttons act ON the selection, and while the style sheet is open
      // its taps (and the tap that dismisses it) must not strip the selection.
      // Both fire here first (this is a CAPTURE listener — the elements' own
      // stopPropagation can never beat it), so exempt them explicitly.
      if (ctxMenuOpenRef.current) return
      if (e.target.closest?.('[data-uct-qbar]')) return
      setSelectedId(null)
    }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
  }, [selectedId, setSelectedId])

  // ── Hit test all drawings ── (already defined above)

  // ── Keyboard nudge of the selected drawing ──
  // Held in a ref (reassigned every render) so the window keydown effect below can
  // keep MINIMAL deps — bars/timeToIndex/seriesRef change on every live tick, and we
  // must not re-subscribe the global listener that often. Mirrors the drag transform:
  // time shifts by whole bar-indices; price shifts by pixels→price (log-safe); volume-
  // pane (paneRelY) points shift by a pixel-fraction. One updateDrawing = one undo step.
  const nudgeRef = useRef(null)
  nudgeRef.current = (dBars, dPx) => {
    if (!selectedId) return
    const sel = drawingsRef.current.find(d => d.id === selectedId)
    if (!sel || sel.locked) return
    const ser = seriesRef?.current
    const H = sizeRef.current.h || 0
    const clamp01 = v => Math.max(0, Math.min(1, v))
    const newPoints = sel.points.map(p => {
      const np = { ...p }
      if (dBars && p.time != null) {
        // Mirror the drag's moveX: honor FUTURE points (past the last candle) so a
        // nudge can push an endpoint into the right-pad instead of clamping at it.
        const _lastIdx = bars.length - 1
        const origIdx = (Number.isFinite(p.futureBars) && p.futureBars > 0)
          ? _lastIdx + p.futureBars
          : nearestIndex(p.time)   // nearest, not exact — mirrors the drag's moveX
        if (origIdx != null) {
          const rawIdx = origIdx + dBars
          if (rawIdx > _lastIdx) {
            np.time = bars[_lastIdx].t
            np.futureBars = Math.min(FUTURE_BARS_CAP, rawIdx - _lastIdx)
          } else {
            np.time = bars[Math.max(0, rawIdx)]?.t ?? p.time
            delete np.futureBars
          }
        }
      }
      if (dPx) {
        if (p.paneY != null || p.paneRelY != null) {
          // Mirrors the drag's moveY: pane fractions move within their own pane,
          // and a legacy canvas fraction upgrades on the first deliberate move.
          const rect = rectForDrawing(sel)
          const zoneH = rect ? (rect.y1 - rect.y0) : 0
          const cur = p.paneY != null
            ? p.paneY
            : (rect && H ? toPaneFraction(rect, p.paneRelY * H) : 0)
          np.paneY = clamp01(cur + (zoneH > 0 ? dPx / zoneH : 0))
          delete np.paneRelY
        } else if (p.price != null) {
          let y = null; try { y = ser?.priceToCoordinate(p.price) } catch { /* disposed */ }
          if (y != null) {
            let npr = null; try { npr = ser?.coordinateToPrice(y + dPx) } catch { /* disposed */ }
            if (npr != null && npr > 0) np.price = npr
          }
        }
      }
      return np
    })
    updateDrawing(selectedId, { points: newPoints })
    requestRedraw()
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (readOnly) return undefined
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // ⭐ THE THIRD KEY HANDLER THAT IS NOT SCOPED TO THE CHART.
      //
      // This listener is on `window`, so it fires wherever focus is. The
      // input-only test above is the exact guard the 2026-08-10 B1 sweep called
      // wrong ("the guard has to be 'is a modal open', not 'did this come from an
      // input'") — and the fix that followed enumerated TWO sites, `StockChart`'s
      // document listener and `ChartPane`'s type-to-search, by hand. This one was
      // missed, so the leak survived in a narrower form for four days.
      //
      // ⚰️ MEASURED ON PRODUCTION 2026-08-14, WMT 1D: with the MACD settings
      // dialog open and focus on its panel (a DIV — none of INPUT/TEXTAREA),
      // typing `AAPL` armed the **Pitchfork** tool and typing `t` armed the
      // **Trendline**. The member then clicks the chart to carry on and starts
      // drawing instead. `e.target.isContentEditable` is here for the same reason
      // one level down: the builder's formula surfaces are not <input> either.
      if (isModalOpen(e.target)) return
      if (e.target.isContentEditable) return

      if (e.key === 'Escape') {
        if (isDragging) {
          dragRef.current = null
          setIsDragging(false)
        } else if (pendingPoints.length > 0) {
          setPendingPoints([])
        } else if (activeTool) {
          setActiveTool(null)
        } else if (selectedId) {
          setSelectedId(null)
        }
        setTextInput(null)
        e.preventDefault()
      }
      // Undo / redo (Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y). Window-level so it works
      // whether or not a tool is armed. No-op on overlays without history wired.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo?.(); return }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo?.(); return }
        // Copy the selected drawing to the module clipboard — but only if the user
        // isn't copying actual page text (let native Ctrl+C win then).
        if (k === 'c' && selectedId && !window.getSelection?.()?.toString()) {
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (sel) {
            const { id: _cid, ...rest } = sel
            _drawingClipboard = JSON.parse(JSON.stringify(rest))
            e.preventDefault()
          }
          return
        }
        // Paste an offset clone onto THIS chart (works across symbols/charts).
        if (k === 'v' && _drawingClipboard && (activeTool === 'cursor' || !activeTool)) {
          e.preventDefault()
          const nid = addDrawing({ ..._drawingClipboard, points: offsetPoints(_drawingClipboard.points), locked: false })
          setSelectedId(nid)
          return
        }
      }
      // Delete / Backspace → remove the selected drawing (locked ones are spared).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && (activeTool === 'cursor' || !activeTool)) {
          e.preventDefault()
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (!sel?.locked) { removeDrawing(selectedId); setSelectedId(null) }
        }
      }
      // Arrow keys nudge the selected drawing (←/→ = ±1 bar · ↑/↓ = ±1px · Shift = ×10).
      // Gated to THIS chart's focus — body, or focus inside the overlay's DOM subtree —
      // so a drawing selected here never hijacks Watchlists/other-widget arrow navigation.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedId && (activeTool === 'cursor' || !activeTool)) {
          const wrap = canvasRef.current?.parentElement
          const ownFocus = e.target === document.body || (wrap && wrap.contains(e.target))
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (ownFocus && !sel?.locked) {
            e.preventDefault()
            const step = e.shiftKey ? 10 : 1
            const dBars = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
            const dPx = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
            nudgeRef.current?.(dBars, dPx)
          }
        }
        return
      }
      // Arm a drawing tool. Alt+<letter> is the documented chord; bare letters
      // still work because a focused pane swallows ticker characters first.
      // ⛔ A SHIFTED LETTER ARMS NOTHING — Shift+F flags the ticker. The gate is
      // inside `matchOverlayTool`, which is also what the `?` sheet reads.
      const tool = matchOverlayTool(e)
      if (tool) {
        e.preventDefault()
        setActiveTool(tool)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTool, pendingPoints, selectedId, isDragging, setActiveTool, setSelectedId, removeDrawing, addDrawing, undo, redo, readOnly])

  // Reset pending on tool change
  useEffect(() => {
    setPendingPoints([])
    setMouseCoords(null)
    setTextInput(null)
    dragRef.current = null
    setIsDragging(false)
    setHoverDrawingId(null)
    setHoverActive(false)
  }, [activeTool])

  // ── Text input submit ──
  const handleTextSubmit = (text, boxWidth = null) => {
    if (!textInput) return
    // Editing an existing note (double-click): update its text; empty leaves it.
    if (textInput.editId) {
      if (text.trim()) updateDrawing(textInput.editId, { text: text.trim(), ...(boxWidth ? { boxWidth } : {}) })
      setTextInput(null)
      return
    }
    if (!text.trim()) { setTextInput(null); return }
    addDrawing({
      type: 'text',
      pane: textInput.pane || PRICE,
      points: [{ time: textInput.time, price: textInput.price, ...(textInput.paneY != null ? { paneY: textInput.paneY } : {}) }],
      color,
      lineWidth,
      text: text.trim(),
      fontSize: fontSize || 13,
      boxWidth: boxWidth || null,   // wrap width so the chart matches the edit box
    })
    setTextInput(null)
    if (!repeatMode) setActiveTool(null)
  }

  // ── Double-click a text annotation to edit it in place ──
  const handleDoubleClick = (e) => {
    if (activeTool && activeTool !== 'cursor') return   // not while placing new drawings
    const pos = getCanvasPos(e)
    if (!pos) return
    const d = drawings.find(dd => dd.id === hitTestAll(pos.x, pos.y))
    if (d?.type === 'text') {
      setSelectedId(d.id)
      setTextInput({ x: e.clientX, y: e.clientY, editId: d.id, initialValue: d.text || '' })
    }
  }

  // ── Determine cursor ──
  const isDrawingTool = activeTool && activeTool !== 'cursor'
  // Interactive when a tool is armed OR the mouse is hovering a drawing (no-tool
  // direct manipulation). Transparent otherwise so the chart keeps pan/zoom.
  const canvasPointerEvents = (activeTool || hoverActive) ? 'auto' : 'none'
  // When a tool is armed the overlay owns touch input (so taps/drags aren't
  // hijacked by browser scroll/zoom). When no tool is armed the overlay is
  // transparent (pointerEvents:none) and the chart keeps its native pinch/pan.
  const canvasTouchAction = activeTool ? 'none' : 'auto'
  let canvasCursor = 'default'
  if (isDrawingTool) canvasCursor = 'crosshair'
  else if (isDragging) canvasCursor = 'grabbing'
  else if (hoverDrawingId === '__handle__') canvasCursor = 'grab'
  else if (hoverDrawingId) canvasCursor = drawings.find(d => d.id === hoverDrawingId)?.locked ? 'not-allowed' : 'move'
  else if (activeTool === 'cursor') canvasCursor = 'default'

  // Close context menu on any click/tap (pointerdown covers touch + mouse)
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctxMenu])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: canvasPointerEvents,
          touchAction: canvasTouchAction,
          cursor: canvasCursor,
          zIndex: 4,
        }}
        onPointerDown={(e) => { setCtxMenu(null); handlePointerDown(e) }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onPointerLeave={() => {
          if (!isDragging) { setMouseCoords(null); setHoverDrawingId(null) }
          requestRedraw()
        }}
      />
      {/* Touch coach chip: multi-point tools place by TAP-TAP, not drag. Shown
          on coarse-pointer devices until the first completed placement (or ✕).
          Inline-styled like the overlay's other DOM chrome; palette matches the
          drawing context menu. */}
      {/* ⭐ MOB-11 + MOB-18 — ONE SURFACE, BECAUSE THEY ARE ONE MOMENT.
          The chip that lived here was a one-time COACH MARK: gated on
          `!tapHintSeen`, so the moment a user dismissed it or placed their first
          drawing, a half-finished placement had no narration and no way out. On
          a phone that is the worst state on this surface — a channel wants three
          taps, you have made one, and the only escapes are a keyboard key that
          does not exist and completing a drawing you no longer want so you can
          undo it.

          So the chip now has two lives. With NOTHING pending it is the coach mark
          it always was (still one-time, still dismissable). With a placement IN
          PROGRESS it is a live HUD that says which point you are on and offers
          Cancel — and that half is NOT gated on `tapHintSeen`, because it is not
          teaching anything, it is reporting state.

          ⛔ CANCEL REUSES ESCAPE'S PATH (`setPendingPoints([])`) rather than
          adding a second abort. Escape already meant exactly this, and two abort
          routines drift the first time one of them learns about a new tool. The
          tool stays ARMED: the user aborted a placement, not a decision to draw. */}
      {coarsePointer && activeTool && (POINT_COUNT[activeTool] || 2) >= 2 && !textInput
        && (pendingPoints.length > 0 || !tapHintSeen) && (
        <div
          data-testid="tap-tap-hint"
          style={{
            /* Bottom-center: the armed toolbar owns the chart's top rows, and
               the thumb is already down here. Clears the range bar + vol strip. */
            position: 'absolute', bottom: 118, left: '50%', transform: 'translateX(-50%)',
            zIndex: 6, display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(26, 28, 23, 0.94)', border: '1px solid rgba(201, 168, 76, 0.55)',
            borderRadius: 999, padding: '8px 8px 8px 14px', pointerEvents: 'auto',
            color: '#ece6d4', fontSize: 12.5, fontFamily: '"Instrument Sans", sans-serif',
            whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
          }}
        >
          {pendingPoints.length === 0
            ? `Tap ${(POINT_COUNT[activeTool] || 2) === 3 ? '3 points' : '2 points'} to place`
            /* MOB-11 · the count, not just "next". "Point 2 of 3" tells you how
               much is left; "Now tap the next point" did not, and on a
               three-point tool that is the whole question. */
            : `Point ${pendingPoints.length + 1} of ${POINT_COUNT[activeTool] || 2}`}
          {pendingPoints.length > 0 && (
            <button
              type="button"
              data-testid="cancel-placement"
              aria-label="Cancel placement"
              onClick={() => setPendingPoints([])}
              style={{
                minHeight: 28, padding: '0 10px', borderRadius: 999, border: 'none',
                background: 'rgba(239, 68, 68, 0.18)', color: '#f0a3a3',
                fontSize: 12.5, lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
                fontFamily: 'inherit',
              }}
            >Cancel</button>
          )}
          <button
            type="button"
            aria-label="Dismiss drawing hint"
            onClick={markTapHintSeen}
            /* Only the COACH half is dismissable. Hiding the live HUD would take
               Cancel with it, which is the affordance the user is reaching for. */
            hidden={pendingPoints.length > 0}
            style={{
              minWidth: 28, minHeight: 28, borderRadius: '50%', border: 'none',
              background: 'rgba(201, 168, 76, 0.16)', color: '#c9a84c',
              fontSize: 14, lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
            }}
          >×</button>
        </div>
      )}
      {textInput && (
        <TextInputOverlay
          x={textInput.x}
          y={textInput.y}
          color={color}
          fontSize={fontSize || 13}
          initialValue={textInput.initialValue || ''}
          onSubmit={handleTextSubmit}
          onCancel={() => setTextInput(null)}
        />
      )}
      {/* Touch selection quick actions — TradingView's floating bar. Tap-select
          (or finish a drawing) → a visible door to editing; long-press alone
          buried it. Style opens the SAME DrawingContextMenu sheet the long-press
          opens (one editing authority); the rest reuse its exact handlers. */}
      {coarsePointer && !readOnly && selectedId && !activeTool && !isDragging && !ctxMenu && !textInput && (() => {
        const d = drawings.find(dd => dd.id === selectedId)
        if (!d) return null
        return (
          <DrawingQuickBar
            drawing={d}
            bottomInset={quickBarInset}
            onStyle={() => {
              const rect = canvasRef.current?.getBoundingClientRect()
              setCtxMenu({
                x: rect ? rect.left + rect.width / 2 : 100,
                y: rect ? rect.top + 40 : 100,
                drawingId: d.id,
              })
            }}
            onDuplicate={() => {
              const { id: _id, ...rest } = d
              const nid = addDrawing({ ...rest, points: offsetPoints(d.points), locked: false })
              if (nid) setSelectedId(nid)
            }}
            onToggleLock={() => updateDrawing(d.id, { locked: !d.locked })}
            onToggleHide={() => { updateDrawing(d.id, { hidden: !d.hidden }); if (!d.hidden) setSelectedId(null) }}
            onDelete={() => { removeDrawing(d.id); setSelectedId(null) }}
          />
        )
      })()}
      {ctxMenu && (() => {
        const d = drawings.find(dd => dd.id === ctxMenu.drawingId)
        if (!d) return null
        // On-screen x of a point (later bar index = further right); futureBars
        // pushes a point into the empty right-pad, so it counts toward x.
        const effIdx = (p) => {
          let idx = timeToIndex.get(p.time)
          if (idx == null) idx = nearestIndex(p.time)
          if (idx == null) idx = 0
          return idx + (Number.isFinite(p.futureBars) ? p.futureBars : 0)
        }
        // Index of the left-most (starting) point — the anchor both "Make
        // horizontal" and the "Set level" prefill reference.
        const leftIndexOf = (pts) => {
          let li = 0, lx = Infinity
          pts.forEach((p, i) => { const x = effIdx(p); if (x < lx) { lx = x; li = i } })
          return li
        }
        const pts = d.points || []
        const leftLevel = pts.length ? pts[leftIndexOf(pts)]?.price ?? null : null
        return (
          <DrawingContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            sheet={coarsePointer}
            drawing={d}
            onSetAlert={onSetAlert ? ((direction, opts) => { onSetAlert(d, direction, opts); setCtxMenu(null) }) : null}
            currentLevel={leftLevel}
            onSetLevel={(price) => {
              // Flatten the whole line onto the typed price — a clean horizontal
              // level at exactly the value you want. Clear paneRelY so points
              // re-anchor to the price scale (not a below-pane fraction).
              if (!pts.length) return
              updateDrawing(ctxMenu.drawingId, { points: pts.map(p => ({ ...p, price, paneRelY: null })) })
              setCtxMenu(null)
            }}
            onMakeHorizontal={() => {
              // Snap every point to the left/starting point's current price.
              if (pts.length < 2 || leftLevel == null) return
              updateDrawing(ctxMenu.drawingId, { points: pts.map(p => ({ ...p, price: leftLevel, paneRelY: null })) })
              setCtxMenu(null)
            }}
            onSetColor={(c) => updateDrawing(ctxMenu.drawingId, d.type === 'advance' ? { labelColor: c } : { color: c })}
            onSetWidth={(w) => updateDrawing(ctxMenu.drawingId, { lineWidth: w })}
            onSetStyle={(s) => updateDrawing(ctxMenu.drawingId, { lineStyle: s })}
            onSetFontSize={(n) => updateDrawing(ctxMenu.drawingId, { fontSize: n })}
            // ⭐ ONE HANDLER FOR EVERY PER-DRAWING SETTING. A schema control that
            // edits a named property gets this; adding the next toggle or picker
            // needs a table entry and nothing here. It goes through the ordinary
            // `updateDrawing`, so every setting change is one undo step and is
            // persisted by the same writer as a geometry change.
            onSetProp={(name, value) => updateDrawing(ctxMenu.drawingId, { [name]: value })}
            // ⭐ A TOGGLE, NOT A MODE STACK. "Adjust anchors" reveals this one
            // drawing's measurement anchors and makes them grabbable; choosing
            // it again — or selecting anything else — puts them away. There is
            // no state to enter or leave beyond an id, which is why this needed
            // no mode system at all.
            adjusting={adjustingId === ctxMenu.drawingId}
            onAdjustAnchors={d.type === 'advance'
              ? (() => {
                setAdjustingId((cur) => (cur === ctxMenu.drawingId ? null : ctxMenu.drawingId))
                setSelectedId(ctxMenu.drawingId)
                setCtxMenu(null)
              })
              : null}
            onToggleLock={() => { updateDrawing(ctxMenu.drawingId, { locked: !d.locked }); setCtxMenu(null) }}
            onToggleHide={() => { updateDrawing(ctxMenu.drawingId, { hidden: !d.hidden }); if (!d.hidden) setSelectedId(null); setCtxMenu(null) }}
            onDuplicate={() => {
              const { id: _id, ...rest } = d
              const nid = addDrawing({ ...rest, points: offsetPoints(d.points), locked: false })
              setSelectedId(nid)
              setCtxMenu(null)
            }}
            onDelete={() => { removeDrawing(ctxMenu.drawingId); setSelectedId(null); setCtxMenu(null) }}
            onSaveDefaults={onSaveDefaults ? (style) => onSaveDefaults(style) : null}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            onClose={() => setCtxMenu(null)}
          />
        )
      })()}
    </>
  )
}

// ─── Inline text input ──────────────────────────────────────────────────────

// Horizontal padding of the textarea (2 × 8px). The content width available for
// text = clientWidth − this, and that's the width we wrap the on-chart text to so
// the rendered note reads exactly like the box.
const TEXTBOX_PAD_X = 16

function TextInputOverlay({ x, y, color, fontSize = 13, initialValue = '', onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue)
  const ref = useRef(null)
  const readyRef = useRef(false)

  useEffect(() => {
    // Focus after a tick to avoid immediate blur from the mousedown that spawned us
    const t = setTimeout(() => {
      ref.current?.focus()
      readyRef.current = true
    }, 50)
    return () => clearTimeout(t)
  }, [])

  const submit = () => {
    if (!readyRef.current) return // ignore blur before we're ready
    // Capture the CONTENT width (box width minus padding) so the chart wraps the
    // text to the exact width the user sized the box to → WYSIWYG.
    const boxWidth = ref.current ? Math.max(1, ref.current.clientWidth - TEXTBOX_PAD_X) : null
    onSubmit(value, boxWidth)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={submit}
      placeholder="Type note..."
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        minWidth: 160,
        minHeight: 32,
        maxWidth: 480,
        padding: '6px 8px',
        // Transparent so it blends with the canvas — the box just previews the note
        // over the chart. Border marks the editable bounds; text is the note colour.
        background: 'transparent',
        border: `1px dashed ${color}`,
        borderRadius: 4,
        color,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize,
        lineHeight: 1.4,
        resize: 'both',
        outline: 'none',
        overflowWrap: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
    />
  )
}

// ─── Right-click context menu ───────────────────────────────────────────────

// Drawings store lineStyle as a STRING; ColorPanel's `line` prop speaks the
// numeric code (0 solid / 2 dashed / 1 dotted).
//
// THIS PAIR IS WHY "DOTTED" APPEARED DEAD. `numToDrawStyle` was
// `(n) => (n === 0 ? 'solid' : 'dashed')`, so clicking Dotted (code 1) STORED
// 'dashed'; and `DRAW_STYLE_TO_NUM` had no 'dotted' key, so reopening the menu
// read the stored 'dashed' back and highlighted Dashed. The button was always
// clickable and always did something - it wrote the wrong value, twice, in a way
// that looked exactly like an inert control.
//
// BOTH DIRECTIONS ARE NOW TOTAL, AND DERIVED FROM ONE TABLE. `LINE_DASH` in
// drawingStyle.js is the authority for what styles exist; these two maps are its
// numeric spelling for the picker. A style added there and forgotten here is a
// test failure, not a silent fallback.
//
// The Chart Settings CROSSHAIR picker uses the same ColorPanel with the same
// codes and is deliberately untouched: those go to lightweight-charts' own
// LineStyle enum, where 1 has always meant dotted and always worked.
const DRAW_STYLE_TO_NUM = { solid: 0, dotted: 1, dashed: 2 }
const NUM_TO_DRAW_STYLE = { 0: 'solid', 1: 'dotted', 2: 'dashed' }
const numToDrawStyle = (n) => NUM_TO_DRAW_STYLE[n] || 'solid'

/**
 * The glyph for each schema control.
 *
 * ⛔ ICONS LIVE HERE, NOT IN THE SCHEMA. `drawingSettingsSchema.js` is a plain
 * data module with no JSX and no React import — that is what lets it be imported
 * by a test, by the save-defaults path, and (later) by anything that needs to ask
 * "what does this tool support?" without dragging the menu in with it. A `label`
 * is data; a `<path d="…">` is presentation.
 *
 * Two entries are FUNCTIONS because their glyph depends on the drawing's state
 * (a closed vs open padlock, an eye vs a struck-through eye) — the same pair
 * whose LABEL the schema also computes from the drawing.
 */
const CONTROL_ICONS = {
  setLevel: <><line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" /><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" /></>,
  makeHorizontal: <><line x1="2" y1="11" x2="14" y2="11" /><line x1="2.5" y1="5" x2="9.5" y2="5" opacity="0.45" strokeDasharray="2 2" transform="rotate(-14 2.5 5)" /></>,
  setAlert: <><path d="M4.4 7a3.6 3.6 0 0 1 7.2 0c0 2.9 1.1 3.8 1.1 3.8H3.3S4.4 9.9 4.4 7Z" /><path d="M6.7 12.6a1.4 1.4 0 0 0 2.6 0" /></>,
  duplicate: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="5.5" y="5.5" width="8" height="8" rx="1" /></>,
  lock: (d) => (d?.locked
    ? <><rect x="3" y="7.5" width="10" height="6.5" rx="1" /><path d="M5 7.5V5a3 3 0 0 1 5.7-1.2" /></>
    : <><rect x="3" y="7.5" width="10" height="6.5" rx="1" /><path d="M5 7.5V5a3 3 0 0 1 6 0v2.5" /></>),
  hide: (d) => (d?.hidden
    ? <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>
    : <><path d="M1.5 8S4 3.5 8 3.5c1 0 1.9.3 2.7.7M14.5 8s-1.2 2.2-3.4 3.4M8 12.5c-4 0-6.5-4.5-6.5-4.5" /><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" /></>),
  saveDefault: <path d="M8 2.3l1.72 3.49 3.85.56-2.79 2.72.66 3.84L8 11.37 4.56 13.19l.66-3.84L2.43 6.35l3.85-.56z" />,
  // Two anchor points with a span between them — the thing the row reveals.
  adjustAnchors: <><circle cx="3.5" cy="11" r="1.8" /><circle cx="12.5" cy="5" r="1.8" /><line x1="5" y1="10" x2="11" y2="6" strokeDasharray="2 1.5" /></>,
  remove: <><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>,
}

// A full-width action row (icon + label), used for Duplicate / Lock / Delete.
function MenuAction({ icon, label, onClick, danger = false, big = false }) {
  // Match the chart right-click menu (ChartsWorkspace .chartCtx*): GOLD icons,
  // white label text, gold-tinted hover that also golds the label. Destructive
  // rows stay red (icon + text) as the one deliberate exception.
  const GOLD = 'var(--menu-accent, var(--ut-gold, #c9a84c))'
  const textBase = danger ? 'var(--color-danger, #ef5350)' : 'var(--menu-text, #ededed)'
  const iconColor = danger ? 'var(--color-danger, #ef5350)' : GOLD
  const hoverBg = danger ? 'rgba(239,83,80,0.14)' : 'var(--menu-accent-bg, rgba(201,168,76,0.12))'
  const sz = big ? 18 : 14
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: big ? 12 : 10, width: '100%',
        padding: big ? '12px 18px' : '9px 11px', minHeight: big ? 44 : undefined, borderRadius: big ? 0 : 6,
        background: 'none', border: 'none', color: textBase,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: big ? 15 : 13, textAlign: 'left',
        transition: 'background 0.1s ease, color 0.1s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; if (!danger) e.currentTarget.style.color = GOLD }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = textBase }}
    >
      <svg viewBox="0 0 16 16" width={sz} height={sz} fill="none" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ color: iconColor, flexShrink: 0 }}>{icon}</svg>
      {label}
    </button>
  )
}

// ─── Touch selection quick actions ──────────────────────────────────────────
// The floating pill a tap-selected drawing gets on coarse-pointer devices —
// TradingView mobile's idiom. Four 44px actions: the current-color Style dot
// (opens the full DrawingContextMenu sheet), Duplicate, Lock, Delete. It owns
// no state and invents no behavior: every handler is the context menu's own.
function DrawingQuickBar({ drawing, bottomInset = 10, onStyle, onDuplicate, onToggleLock, onDelete }) {
  const locked = !!drawing.locked
  const curColor = (drawing.type === 'advance' ? drawing.labelColor : drawing.color) || '#c9a84c'
  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 44, minHeight: 44, border: 'none', background: 'none',
    color: 'var(--menu-text, #ededed)', cursor: 'pointer', borderRadius: 9,
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', padding: 0,
  }
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <div
      data-uct-qbar="1"
      role="toolbar"
      aria-label="Drawing actions"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        bottom: bottomInset, zIndex: 41,
        display: 'flex', alignItems: 'center', gap: 2, padding: '2px 5px',
        background: 'var(--menu-surface, var(--menu-bg, #0e0e10))',
        border: '1px solid var(--menu-border, #242426)', borderRadius: 13,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        fontFamily: "'Instrument Sans', sans-serif", userSelect: 'none',
      }}
    >
      <button type="button" style={btn} onClick={onStyle} aria-label="Style">
        <span style={{
          width: 20, height: 20, borderRadius: '50%', background: curColor,
          border: '1px solid var(--menu-border, #2c2c30)',
          boxShadow: '0 0 0 1px var(--menu-bg, #0e0e10)',
        }} />
      </button>
      <button type="button" style={btn} onClick={onDuplicate} aria-label="Duplicate">
        <svg width="18" height="18" viewBox="0 0 18 18" style={stroke} aria-hidden="true">
          <rect x="6" y="6" width="9" height="9" rx="1.5" />
          <path d="M12 3.5H4.5A1.5 1.5 0 0 0 3 5v7.5" />
        </svg>
      </button>
      <button
        type="button"
        style={{ ...btn, color: locked ? 'var(--ut-gold, #c9a84c)' : btn.color }}
        onClick={onToggleLock}
        aria-label={locked ? 'Unlock' : 'Lock'}
        aria-pressed={locked}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" style={stroke} aria-hidden="true">
          <rect x="4" y="8" width="10" height="7" rx="1.5" />
          {locked
            ? <path d="M6 8V6a3 3 0 0 1 6 0v2" />
            : <path d="M6 8V6a3 3 0 0 1 5.6-1.5" />}
        </svg>
      </button>
      <button type="button" style={{ ...btn, color: 'var(--loss, #ef4444)' }} onClick={onDelete} aria-label="Delete">
        <svg width="18" height="18" viewBox="0 0 18 18" style={stroke} aria-hidden="true">
          <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.2A1.5 1.5 0 0 0 7.2 15.5h3.6a1.5 1.5 0 0 0 1.5-1.3L13 5" />
          <path d="M7.5 8v4.5M10.5 8v4.5" />
        </svg>
      </button>
    </div>
  )
}

// Exported for its own rail: the alert-mode choice is a decision the overlay
// only PASSES ON, so testing it through canvas hit-testing in jsdom (which does
// no layout) would measure the harness, not the menu.
/**
 * ⛔ THE `*Supported` BOOLEANS ARE GONE, AND SO ARE THREE DEAD PROPS.
 *
 * `levelSupported` / `horizontalSupported` / `alertSupported` moved into
 * `drawingSettingsSchema.js`: a tool declares its controls, and a control that
 * needs a handler the caller did not pass simply is not rendered. The caller no
 * longer has to know that a Trend Line can be flattened and a Rectangle cannot.
 *
 * `canReorder` / `onBringFront` / `onSendBack` were passed by the overlay and
 * never read by this component — z-ordering has no row in this menu. They were
 * flagged as unused by eslint on every run; the migration is the moment to stop
 * threading them through.
 */
export function DrawingContextMenu({ x, y, sheet = false, drawing, onSetColor, onSetWidth, onSetStyle, onSetFontSize, onDuplicate, onToggleLock, onToggleHide,
  onDelete, onSaveDefaults, savedColors = [], onSaveColor, onDeleteColor, onClose, onSetAlert, currentLevel = null, onSetLevel, onMakeHorizontal,
  onSetProp, onAdjustAnchors, adjusting = false }) {
  const menuRef = useRef(null)
  // ⛔ WHICH COLOUR PANEL, NOT WHETHER ONE IS OPEN. A Rectangle has two colour
  // rows (Border and Fill) and they share one ColorPanel instance, so the state
  // has to name the control that opened it. Holding the schema ITEM rather than
  // its id means the panel reads its own title, target property and whether it
  // shows line controls straight off the table.
  const [colorPanel, setColorPanel] = useState(null)
  const [levelOpen, setLevelOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  /* ⭐ TWO ALERT SEMANTICS, AND THE CHOICE IS REMEMBERED (MOB-05). A trader
     picks one meaning and mostly stays there, so re-asking every time would be
     the kind of "configurable" that is really just repeated work. Default is
     BOUND: an alert set ON a line is, to almost everyone, an alert about THAT
     LINE — and the fixed-level intent already has its own zero-typing door in
     the price-context sheet, which is untouched. */
  const [alertBound, setAlertBound] = useState(() => {
    try { return localStorage.getItem(ALERT_BIND_KEY) !== 'fixed' } catch { return true }
  })
  const chooseBind = (bound) => {
    setAlertBound(bound)
    try { localStorage.setItem(ALERT_BIND_KEY, bound ? 'bound' : 'fixed') } catch { /* private mode */ }
  }
  const [levelVal, setLevelVal] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)  // brief "Saved ✓" confirmation
  const openLevel = () => { setLevelVal(fmtLevel(currentLevel)); setLevelOpen(o => !o) }
  const submitLevel = () => { const n = parseFloat(levelVal); if (Number.isFinite(n)) onSetLevel?.(n) }
  // Clamp to the viewport so the menu always lands right next to the cursor —
  // flips to the cursor's left/up edge when it would overflow (drawings near the
  // right edge of a full-width chart otherwise pushed it off-screen). Measured
  // post-render and kept hidden for the first paint so it never flashes far off.
  // (Anchored/desktop only — on touch we dock it to the bottom as a sheet.)
  const [pos, setPos] = useState({ left: x, top: y, ready: sheet })
  useLayoutEffect(() => {
    if (sheet) return
    const el = menuRef.current
    const w = el?.offsetWidth || 180
    const h = el?.offsetHeight || 180
    const M = 8
    let left = x + w > window.innerWidth - M ? x - w : x
    let top = y + h > window.innerHeight - M ? y - h : y
    left = Math.max(M, Math.min(left, window.innerWidth - w - M))
    top = Math.max(M, Math.min(top, window.innerHeight - h - M))
    setPos({ left, top, ready: true })
  }, [x, y, sheet])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const locked = !!drawing?.locked
  const curColor = (drawing?.type === 'advance' ? drawing?.labelColor : drawing?.color) || '#c9a84c'
  const curWidth = drawing?.lineWidth || 1
  const curStyle = drawing?.lineStyle || 'solid'
  const isText = drawing?.type === 'text'
  const curFontSize = Math.round(drawing?.fontSize || 13)
  const bumpFont = (delta) => onSetFontSize?.(Math.max(8, Math.min(64, curFontSize + delta)))
  // What a colour row shows, and what its panel edits. A property-backed row
  // (Fill) falls back to the drawing's colour when it has no value of its own —
  // which is exactly what it RENDERS as, so the swatch never lies.
  const swatchOf = (item) => (item?.prop ? (drawing?.[item.prop] || curColor) : curColor)
  // Place the ColorPanel popout beside the menu (to its right; flip left if it would
  // overflow). ~250px wide panel.
  const panelW = 258
  const menuW = sheet ? window.innerWidth : 210
  const panelLeft = sheet
    ? Math.max(8, (window.innerWidth - panelW) / 2)
    : (pos.left + menuW + panelW + 8 > window.innerWidth ? Math.max(8, pos.left - panelW - 6) : pos.left + menuW)
  const panelTop = sheet ? Math.max(8, window.innerHeight - 470) : Math.min(pos.top, Math.max(8, window.innerHeight - 440))

  // Touch bottom-sheet gets roomier rows + bigger tap targets than the anchored menu.
  const rowStyle = sheet
    ? { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', minHeight: 44 }
    : { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px' }
  // "Color" reads like the other item labels (white, 13px) instead of a tiny dim
  // section caption, matching the chart right-click menu.
  const labelStyle = { fontSize: sheet ? 15 : 13, color: 'var(--menu-text, #ededed)', fontWeight: 500 }
  const sw = sheet ? 26 : 15         // color swatch size
  const wBtn = sheet ? 34 : 24       // width-button size

  // Neutral-dark palette shared with the Chart Settings menu (--menu-* tokens).
  const shell = sheet
    ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 21,
        background: 'var(--menu-surface, var(--menu-bg, #0e0e10))', borderTop: '1px solid var(--menu-border, #242426)',
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        boxShadow: '0 -8px 28px rgba(0,0,0,0.55)',
        padding: '6px 0 max(14px, env(safe-area-inset-bottom))',
        color: 'var(--menu-text, #ededed)',
        fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, userSelect: 'none',
      }
    : {
        position: 'fixed', left: pos.left, top: pos.top,
        visibility: pos.ready ? 'visible' : 'hidden', zIndex: 21,
        minWidth: 210, background: 'var(--menu-surface, var(--menu-bg, #0e0e10))', border: '1px solid var(--menu-border, #242426)',
        borderRadius: 10, boxShadow: '0 12px 40px var(--menu-shadow, rgba(0,0,0,0.6))', padding: '5px',
        color: 'var(--menu-text, #ededed)',
        fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, userSelect: 'none',
      }

  // ── The rows, from the schema ──────────────────────────────────────────────
  //
  // ⛔ THE BOOLEAN LADDER IS GONE. This used to be a run of
  // `{levelSupported && …}` / `{horizontalSupported && …}` / `{alertSupported &&
  // …}` / `{isText && onSetFontSize && …}` blocks, with the conditions
  // themselves computed a thousand lines away at the call site. The tool now
  // DECLARES its controls in `drawingSettingsSchema.js` and this walks whatever
  // it finds — so adding a setting in Phase 4+ is a table entry plus (only if it
  // is a new widget) one renderer below, and never another branch here.
  const sections = sectionsFor({
    drawing,
    points: drawing?.points,
    handlers: {
      onSetFontSize, onSetLevel, onMakeHorizontal, onSetAlert, onSetProp,
      onAdjustAnchors,
      onDuplicate, onToggleLock, onToggleHide, onSaveDefaults, onDelete,
    },
    // Only `adjustAnchors` reads this — it is the one control whose LABEL
    // depends on something that is not the drawing (are we in that mode now).
    adjusting,
  })

  // Widgets that are not rows. Each body is the shipped JSX, unchanged — the
  // migration moved WHERE they are chosen, not what they look like.
  const WIDGETS = {
    // ⭐ ONE ROW SERVES "Color", "Border" AND "Fill". What differs is the LABEL,
    // the property it writes and whether a fill has a line preview — all three
    // declared in the schema. The body is the shipped row, unchanged.
    colorRow: (item) => {
      const open = colorPanel?.id === item.id
      const showLine = item.line !== false
      const val = swatchOf(item)
      return (
        <button
          key={item.id}
          onClick={() => setColorPanel(p => (p?.id === item.id ? null : item))}
          style={{
            ...rowStyle, width: '100%', border: 'none', cursor: 'pointer', borderRadius: 6,
            fontFamily: 'inherit', color: 'var(--menu-text, #ededed)', textAlign: 'left',
            background: open ? 'var(--menu-accent-bg, rgba(201,168,76,0.12))' : 'none',
          }}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--menu-accent-bg, rgba(201,168,76,0.12))' }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'none' }}
        >
          <span style={labelStyle}>{item.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span style={{ width: sw, height: sw, borderRadius: '50%', background: val, border: '1px solid var(--menu-border, #2c2c30)', boxShadow: '0 0 0 1px var(--menu-bg, #0e0e10)' }} />
            {/* ⛔ THE SPACER IS NOT DECORATION. The row is right-aligned, so without
                it the Fill swatch slides over into the gap where Border's line
                preview sits and the two swatches in one section sit at different
                x — which reads as a mistake long before anyone works out why. */}
            <span
              aria-hidden="true"
              style={showLine
                ? { display: 'block', width: 22, height: 0, borderTopWidth: Math.max(1, curWidth), borderTopStyle: curStyle === 'solid' ? 'solid' : curStyle, borderTopColor: val }
                : { display: 'block', width: 22 }}
            />
            <span style={{ color: 'var(--menu-text-dim, #8a8a8f)', fontSize: sheet ? 13 : 11 }} aria-hidden="true">{open ? '▾' : '▸'}</span>
          </span>
        </button>
      )
    },

    // ⭐ A GENERIC ON/OFF ROW. Every later "show the …" setting is a table entry
    // and reuses this — the widget knows a property name and nothing about which
    // tool it belongs to.
    toggle: (item) => {
      // ⭐ `resolve` WINS OVER THE FLAT DEFAULT WHERE A CONTROL DECLARES ONE.
      // The measurement toggles default per TYPE (a legacy Measure shows its
      // dollar figure; a legacy Price Move does not), so asking `drawingProp`
      // would make the switch say "off" while the canvas showed the number.
      const on = item.resolve ? !!item.resolve(drawing) : !!drawingProp(drawing, item.prop)
      // ⛔ AND THE LAST ONE CANNOT BE SWITCHED OFF where the schema says so —
      // a Price Move with neither figure showing is an invisible drawing.
      const locked = !!item.locked
      return (
        <button
          key={item.id}
          role="switch"
          aria-checked={on}
          aria-disabled={locked || undefined}
          title={locked ? item.lockedHint : undefined}
          onClick={() => { if (!locked) onSetProp?.(item.prop, !on) }}
          style={{
            ...rowStyle, width: '100%', border: 'none', cursor: locked ? 'default' : 'pointer', borderRadius: 6,
            fontFamily: 'inherit', color: 'var(--menu-text, #ededed)', textAlign: 'left', background: 'none',
            opacity: locked ? 0.55 : 1,
          }}
          onMouseEnter={(e) => { if (!locked) e.currentTarget.style.background = 'var(--menu-accent-bg, rgba(201,168,76,0.12))' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
        >
          <span style={labelStyle}>{item.label}</span>
          <span
            aria-hidden="true"
            style={{
              marginLeft: 'auto', width: sheet ? 40 : 30, height: sheet ? 22 : 17, borderRadius: 999,
              background: on ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-bg, #0e0e10)',
              border: `1px solid ${on ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-border, #2c2c30)'}`,
              position: 'relative', transition: 'background 120ms ease',
            }}
          >
            <span style={{
              position: 'absolute', top: 1, left: on ? (sheet ? 19 : 14) : 1,
              width: sheet ? 18 : 13, height: sheet ? 18 : 13, borderRadius: '50%',
              background: on ? '#0e0e10' : 'var(--menu-text-dim, #8a8a8f)',
              transition: 'left 120ms ease',
            }} />
          </span>
        </button>
      )
    },

    // ⭐ A SEGMENTED PICKER FOR A SHORT, NAMED SCALE. Small / Medium / Large,
    // never a number field — see the schema's note on why.
    choice: (item) => {
      const cur = item.resolve ? item.resolve(drawing) : (drawingProp(drawing, item.prop) ?? item.fallback)
      return (
        <div key={item.id} style={{ ...rowStyle }}>
          <span style={labelStyle}>{item.label}</span>
          <span
            style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            role="radiogroup"
            aria-label={item.label}
          >
            {item.choices.map((c) => {
              const on = c.value === cur
              return (
                <button
                  key={c.label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={c.title}
                  onClick={() => onSetProp?.(item.prop, c.value)}
                  style={{
                    width: sheet ? 34 : 24, height: sheet ? 34 : 24,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${on ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-border, #2c2c30)'}`,
                    borderRadius: 6,
                    background: on ? 'var(--menu-accent-bg, rgba(240,178,58,0.14))' : 'var(--menu-bg, #0e0e10)',
                    color: on ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-text-dim, #8a8a8f)',
                    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, lineHeight: 1,
                    fontSize: sheet ? 13 : 11,
                  }}
                >{c.label}</button>
              )
            })}
          </span>
        </div>
      )
    },

    fontStepper: () => (
      <div key="fontSize" style={{ ...rowStyle }}>
        <span style={labelStyle}>Text size</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }} onPointerDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => bumpFont(-1)}
            title="Smaller"
            aria-label="Smaller text"
            style={{
              width: sheet ? 34 : 24, height: sheet ? 34 : 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--menu-border, #2c2c30)', borderRadius: 6, background: 'var(--menu-bg, #0e0e10)',
              color: 'var(--menu-text, #ededed)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, lineHeight: 1, fontSize: sheet ? 12 : 10,
            }}
          >A−</button>
          <span style={{ minWidth: 26, textAlign: 'center', color: 'var(--menu-text-dim, #8a8a8f)', fontSize: sheet ? 14 : 12, fontVariantNumeric: 'tabular-nums' }}>{curFontSize}</span>
          <button
            onClick={() => bumpFont(1)}
            title="Bigger"
            aria-label="Bigger text"
            style={{
              width: sheet ? 34 : 24, height: sheet ? 34 : 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--menu-border, #2c2c30)', borderRadius: 6, background: 'var(--menu-bg, #0e0e10)',
              color: 'var(--menu-text, #ededed)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, lineHeight: 1, fontSize: sheet ? 16 : 13,
            }}
          >A+</button>
        </span>
      </div>
    ),

    levelInput: (item) => (
      <React.Fragment key="setLevel">
        <MenuAction label={item.label} onClick={openLevel} big={sheet} icon={CONTROL_ICONS.setLevel} />
        {levelOpen && (
          <div style={{ display: 'flex', gap: 6, padding: sheet ? '2px 18px 12px' : '2px 12px 8px' }} onPointerDown={(e) => e.stopPropagation()}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              autoFocus
              value={levelVal}
              onChange={(e) => setLevelVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitLevel() }
                else if (e.key === 'Escape') { e.preventDefault(); setLevelOpen(false) }
                e.stopPropagation()
              }}
              placeholder="Price…"
              style={{
                flex: 1, minWidth: 0, padding: sheet ? '9px 10px' : '5px 8px',
                background: 'var(--menu-bg, #0e0e10)', border: '1px solid var(--menu-border, #2c2c30)',
                borderRadius: 6, color: 'var(--menu-text, #ededed)', fontFamily: 'inherit',
                fontSize: sheet ? 14 : 12, outline: 'none',
              }}
            />
            <button
              onClick={submitLevel}
              style={{
                padding: sheet ? '0 16px' : '0 11px', minHeight: sheet ? 40 : undefined,
                background: 'var(--menu-accent-bg, rgba(240,178,58,0.14))', border: '1px solid var(--menu-border, #2c2c30)',
                borderRadius: 6, color: 'var(--menu-text, #ededed)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: sheet ? 14 : 12, fontWeight: 600,
              }}
            >Set</button>
          </div>
        )}
      </React.Fragment>
    ),

    alertPicker: (item) => (
      <React.Fragment key="setAlert">
        <MenuAction label={item.label} onClick={() => setAlertOpen(o => !o)} big={sheet} icon={CONTROL_ICONS.setAlert} />
        {alertOpen && (
          <div
            style={{ display: 'flex', gap: 6, padding: sheet ? '2px 18px 6px' : '2px 12px 4px' }}
            onPointerDown={(e) => e.stopPropagation()}
            role="radiogroup"
            aria-label="Alert follows the drawing or stays at a fixed level"
          >
            {[
              { bound: true, label: 'Follows the line', hint: 'Move the line and the alert moves with it. Delete the line and the alert goes too.' },
              { bound: false, label: 'Fixed level', hint: 'Takes the price where the line is now, then stops caring about the line.' },
            ].map((m) => (
              <button
                key={m.label}
                type="button"
                role="radio"
                aria-checked={alertBound === m.bound}
                onClick={() => chooseBind(m.bound)}
                title={m.hint}
                style={{
                  flex: 1, padding: sheet ? '9px 8px' : '5px 8px',
                  background: alertBound === m.bound ? 'var(--menu-accent-bg, rgba(240,178,58,0.14))' : 'var(--menu-bg, #0e0e10)',
                  border: `1px solid ${alertBound === m.bound ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-border, #2c2c30)'}`,
                  borderRadius: 6,
                  color: alertBound === m.bound ? 'var(--menu-accent, #f0b23a)' : 'var(--menu-text-dim, #9a978f)',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: sheet ? 13 : 11,
                  fontWeight: alertBound === m.bound ? 700 : 500,
                }}
              >{m.label}</button>
            ))}
          </div>
        )}
        {alertOpen && (
          <div style={{ display: 'flex', gap: 6, padding: sheet ? '2px 18px 12px' : '2px 12px 8px' }} onPointerDown={(e) => e.stopPropagation()}>
            {/* Fixed bright green/red — the drawing menu is ALWAYS a dark --menu-*
                surface, so theme-variable colors (which flip dark on light) would
                be unreadable here. */}
            {[
              { dir: 'above', label: '▲ Above', col: '#3cb868' },
              { dir: 'below', label: '▼ Below', col: '#ff5b5b' },
            ].map(b => (
              <button
                key={b.dir}
                onClick={() => onSetAlert?.(b.dir, { bound: alertBound })}
                title={`Alert when price crosses ${b.dir} this ${drawing?.type === 'horizontal' || drawing?.type === 'hray' ? 'line' : 'trendline'}${alertBound ? ' — and it follows the line if you move it' : ' — at a fixed level'}`}
                style={{
                  flex: 1, padding: sheet ? '10px 8px' : '6px 8px',
                  background: 'var(--menu-bg, #0e0e10)', border: `1px solid ${b.col}`,
                  borderRadius: 6, color: b.col, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: sheet ? 14 : 12, fontWeight: 700,
                }}
              >{b.label}</button>
            ))}
          </div>
        )}
      </React.Fragment>
    ),
  }

  // Plain rows. `saveDefault` is the one action with transient state ("Saved ✓").
  const ACTION_HANDLERS = {
    adjustAnchors: onAdjustAnchors,
    duplicate: onDuplicate,
    lock: onToggleLock,
    hide: onToggleHide,
    remove: onDelete,
    saveDefault: () => {
      // ⛔ EVERY VALUE THE TOOL *COULD* PERSIST IS OFFERED; `defaultsPayloadFor`
      // decides which of them this tool actually owns. Booleans go through
      // `drawingProp` so "off" is a real, savable answer; the optional ones are
      // omitted when unset, because "no fill" is the absence of a choice rather
      // than a choice to save.
      const values = {
        color: curColor, lineWidth: curWidth, lineStyle: curStyle, fontSize: curFontSize,
        showPriceLabel: !!drawingProp(drawing, 'showPriceLabel'),
        showPercentChange: !!drawingProp(drawing, 'showPercentChange'),
      }
      // ⭐ THE MEASUREMENT TOGGLES GO THROUGH `fieldsFor`, for the same reason
      // the switches do: a legacy Measure's dollar field is ON without the
      // property being set, and "save as default" must save what the user is
      // looking at, not what happens to be stored.
      const f = fieldsFor(drawing)
      Object.assign(values, {
        showDollar: f.dollar, showPercent: f.percent, showBars: f.bars, showTime: f.time,
        labelPos: labelPosOf(drawing),
      })
      for (const p of ['fillColor', 'fillOpacity', 'arrowSize']) {
        if (drawing?.[p] !== undefined && drawing?.[p] !== null) values[p] = drawing[p]
      }
      onSaveDefaults(defaultsPayloadFor(drawing?.type, values))
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400)
    },
  }

  const renderItem = (item) => {
    if (item.kind === 'custom') return WIDGETS[item.widget]?.(item) ?? null
    const label = item.id === 'saveDefault' && savedFlash ? 'Saved as default ✓' : item.label
    return (
      <MenuAction
        key={item.id}
        label={label}
        onClick={ACTION_HANDLERS[item.id]}
        danger={item.danger}
        big={sheet}
        icon={typeof CONTROL_ICONS[item.id] === 'function' ? CONTROL_ICONS[item.id](drawing) : CONTROL_ICONS[item.id]}
      />
    )
  }

  const divider = (key) => <div key={key} style={{ height: 1, background: 'var(--menu-divider, #202022)', margin: '5px 0' }} />

  const inner = (
    <div
      ref={menuRef}
      onPointerDown={(e) => e.stopPropagation()}
      style={shell}
    >
      {sheet && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 8px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--menu-border, #2c2c30)' }} />
        </div>
      )}

      {sections.map((section, i) => (
        <React.Fragment key={section.id}>
          {i > 0 && divider(`sep-${section.id}`)}
          {section.title && (
            <div style={{ padding: sheet ? '8px 18px 3px' : '6px 11px 3px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--menu-text-faint, #6b6b6b)', fontWeight: 600 }}>
              {section.title}
            </div>
          )}
          {section.items.map(renderItem)}
        </React.Fragment>
      ))}

      {colorPanel && createPortal(
        <div
          data-color-panel
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: panelLeft, top: panelTop, zIndex: 22 }}
        >
          <ColorPanel
            title={colorPanel.prop ? colorPanel.label : 'Drawing'}
            value={swatchOf(colorPanel)}
            onChange={(hex) => (colorPanel.prop ? onSetProp?.(colorPanel.prop, hex) : onSetColor(hex))}
            onClose={() => setColorPanel(null)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            /* ⛔ A FILL HAS NO WIDTH AND NO DASH. Passing the line controls to it
               would show two sliders that belong to the outline under a heading
               that says Fill — the "confusing duplicate control" the brief warns
               about. `line: false` in the schema is what turns them off. */
            line={colorPanel.line === false ? null : {
              width: curWidth,
              style: DRAW_STYLE_TO_NUM[drawing?.lineStyle] ?? 0,
              onWidth: (w) => onSetWidth(w),
              onStyle: (n) => onSetStyle(numToDrawStyle(n)),
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  )

  // Anchored menu on desktop; on touch, dock as a bottom-sheet behind a dimming
  // backdrop (tap the backdrop to dismiss). The window-level pointerdown closer
  // still fires, but the backdrop makes the touch dismiss target obvious + big.
  if (!sheet) return inner
  return (
    <div
      onPointerDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.35)' }}
    >
      {inner}
    </div>
  )
}
