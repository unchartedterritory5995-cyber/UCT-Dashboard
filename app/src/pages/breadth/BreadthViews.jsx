/**
 * Breadth Views container — owns the date cursor, forward-fill, percentile
 * computation, the useBreadthViews preset hook, and dispatch to the active
 * visualization style. Spec: docs/superpowers/specs/2026-06-01-breadth-views-multi-style-design.md
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { HM_METRICS, PCTILE_KEYS, FFILL_KEYS } from './heatmapMetrics'
import useBreadthViews from './useBreadthViews'
import { LAYOUTS } from './compareQuad'
import { drillTarget } from './liveDrill'
import { normalizeMetric, pickSignals, SEEK_OUT_OF_WINDOW } from './views/breadthViewShared'
import { buildDateIndex, resolveSeekIndex } from './views/seek'
import BreadthSignalStrip from './views/BreadthSignalStrip'
import TheReadStrip from './views/TheReadStrip'
import BreadthScrubber from './BreadthScrubber'
import CompareGrid from './CompareGrid'
import BreadthViewSwitcher from './BreadthViewSwitcher'
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'
import { anchorProps } from './customizeAnchor'
import QuickPresetSwitcher from './QuickPresetSwitcher'
import { DEFAULT_PRESET } from './useBreadthViews'
import { VIEW_CONFIG, optionsSchema } from './views/viewMetricConfig'
import { VIEW_COMPONENTS } from './views/viewRegistry'
import customizeStyles from './CustomizePanel.module.css'
import layoutStyles from './BreadthLayout.module.css'
import signalStyles from './views/signals.module.css'
import UIcon from '../../components/ui/UIcon'

// Keys from `LAYOUTS` (one author), copy here. A third layout would appear in
// the toggle with an undefined label rather than silently not appear at all.
const LAYOUT_COPY = {
  single: { label: 'Single', title: 'One visualization at a time' },
  compare: { label: 'Compare', title: 'Four visualizations at once, sharing this cursor, window and scrubber' },
}
const LAYOUT_CHOICES = LAYOUTS.map(k => ({ key: k, label: LAYOUT_COPY[k]?.label ?? k, title: LAYOUT_COPY[k]?.title }))

export default function BreadthViews({
  rows, onDrill, live = null, liveStamp = null,
  // Spec §5. BOTH default to today's behaviour exactly: no URL state read, none
  // written. The page (`Breadth.jsx`) owns the router; this container only says
  // what its state IS and is told what the link asked for.
  urlState = null, onUrlChange = null,
}) {
  // Computed inside the component (not module top-level) to dodge the
  // Breadth.jsx ⇆ BreadthViews circular-import TDZ: HM_METRICS is only
  // initialized by render time, not during module evaluation.
  const ALL_METRICS = useMemo(() => HM_METRICS.filter(m => !m.isHeader), [])
  // The link's opening position, handed to the preference hook so it can beat
  // the server blob at hydration time rather than be stomped by it.
  const urlOverrides = useMemo(() => (urlState ? {
    viewStyle: urlState.view ?? null,
    layout: urlState.compare ? 'compare' : null,
    compareQuad: urlState.compare ?? null,
  } : null), [urlState])
  const views = useBreadthViews(ALL_METRICS, undefined, urlOverrides)
  // Pulled out so the memos below depend on the resolvers themselves rather
  // than on the whole hook object, which is a fresh literal every render.
  const { visibleKeysFor, optionsFor } = views
  const [rowIdx, setRowIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const viewLabel = VIEW_CONFIG[views.viewStyle]?.label ?? views.viewStyle
  const panelMetrics = useMemo(() => views.eligibleMetrics(), [views])

  /**
   * ⭐ ONE LATCH, EVERY DOOR THE READER MOVES THE CURSOR THROUGH.
   *
   * "The reader has taken the cursor" is ONE fact, and two behaviours hang off
   * it: a refused `?date=` stops asserting itself, and the link stops retrying
   * on a window change. Both were previously derived from nothing — the banner
   * kept naming a session the reader had long since scrubbed away from, and a
   * widen would have yanked them back to the link's date from wherever they
   * were. Deriving both from one latch is what keeps them from disagreeing.
   *
   * ⛔ IT IS NOT `rowIdx !== 0`. That reads "is the cursor off the newest row",
   * which is a different question: scrub away and back and the refusal would
   * return, re-asserting a link the reader has already answered.
   *
   * The RENDER-TIME landing below deliberately does NOT go through here — that
   * is the link moving the cursor, not the reader.
   */
  const [readerMoved, setReaderMoved] = useState(false)
  const takeCursor = useCallback((next) => { setReaderMoved(true); setRowIdx(next) }, [])

  /**
   * ⭐ ONE keydown binding, and it CLAIMS the arrow keys it acts on.
   *
   * Two things were wrong with letting the event through. It reached the
   * browser, which scrolls the page on an arrow press — so a reader scrubbing
   * with the keyboard also walked the page sideways. And in compare mode a
   * pane's style `<select>` sat in the tab order: an arrow with that focused
   * moved the cursor AND silently walked the pane to a different lens, two
   * unrelated things from one press, neither of which the reader asked for.
   *
   * ⛔ SO `<select>` JOINS INPUT/TEXTAREA/contentEditable IN THE EXEMPTION, and
   * everything else gets `preventDefault()`. A control that natively owns the
   * arrow keys keeps them (the speed picker, the scrubber's own slider, a pane
   * picker); everywhere else the cursor takes them and nothing downstream —
   * page scroll, an ancestor handler, the tab strip — sees the same press. The
   * two behaviours are now identical in Single and in Compare, which is the
   * property that was actually broken.
   *
   * Arrow navigation PAUSES playback: a reader reaching for the arrows while
   * the scrubber runs is taking the cursor back, and leaving the interval alive
   * would have them fighting it a tick later.
   */
  useEffect(() => {
    const handler = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
                || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      setPlaying(false)
      takeCursor(e.key === 'ArrowLeft'
        ? p => Math.min(p + 1, rows.length - 1)
        : p => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows.length, takeCursor])

  const filledRows = useMemo(() => {
    const asc = [...rows].reverse()
    const carry = {}
    const result = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      result.push(filled)
    }
    return result.reverse()
  }, [rows])

  /**
   * 🔴 THE WINDOW CAN SHRINK UNDER THE CURSOR, AND NOTHING RECONCILED IT.
   *
   * Scrub to session 300 of the 365-day window, then press the 90d pill: the
   * loaded rows drop to ~90 and `rowIdx` is still 300. Nothing crashed — the
   * `filledRows[rowIdx] ?? filledRows[0]` fallback below kept the DISPLAYED row
   * valid — which is exactly why it survived review: the state was out of
   * bounds and the page looked fine. Wave A gave it a visible symptom (the
   * scrubber's "n of N" printed an impossible negative position) and Wave B's
   * `?days=` deep link gives it a second door.
   *
   * ⛔ Clamping only the readout would have been the WORSE fix: the number goes
   * honest while the cursor stays wrong. Both halves are fixed — the text in
   * `BreadthScrubber`, the state here.
   *
   * ⭐ AND IT IS `setRowIdx`, NOT `onSeek`. This is a bounds reconciliation, not
   * a seek: it must not pause playback and must not go through
   * `resolveSeekIndex`, whose numeric branch would clamp to the same answer
   * anyway. Because the scrubber re-syncs its `idxRef` from the `rowIdx` prop on
   * every render, this ALSO drags an in-flight playback tick back into range —
   * `stepTo` is deliberately a non-validating door, so the container is the only
   * place that can.
   *
   * It runs DURING RENDER (React's documented "adjusting state when props
   * change") rather than in an effect, so no frame is ever painted from an
   * out-of-bounds cursor — an effect would let the impossible readout show once.
   *
   * Note this is only reachable because the Views tab recently gained
   * 90/180/365 window pills. Before those, the window never shrank.
   */
  const lastIdx = Math.max(0, filledRows.length - 1)
  if (rowIdx > lastIdx) setRowIdx(lastIdx)

  // ── the seekable cursor ────────────────────────────────────────────────────
  //
  // ⭐ `onSeek` and `canSeek` are ONE decision asked twice. Both resolve through
  // `resolveSeekIndex`, so a view can render an affordance disabled (canSeek
  // said no) in the certain knowledge that clicking it would have been refused
  // for the same reason. Two independent copies of "is this date reachable?" is
  // how a dead link ships looking live.
  const dateIndex = useMemo(() => buildDateIndex(filledRows), [filledRows])

  const canSeek = useCallback(
    (target) => resolveSeekIndex(target, dateIndex, filledRows.length) != null,
    [dateIndex, filledRows.length],
  )

  // Returns TRUE when the cursor moved, FALSE when the target is unreachable —
  // so a caller that did not ask first still gets an answer instead of a
  // silent no-op. Any manual seek pauses playback.
  const onSeek = useCallback((target) => {
    const idx = resolveSeekIndex(target, dateIndex, filledRows.length)
    if (idx == null) return false
    setPlaying(false)
    takeCursor(idx)
    return true
  }, [dateIndex, filledRows.length, takeCursor])

  // The playback advance — deliberately NOT `onSeek`, which pauses. The
  // scrubber owns the interval; this is the only door that moves the cursor
  // without stopping the run. It IS a reader move (they pressed play), so it
  // goes through the same latch; `setReaderMoved(true)` on an already-true
  // state is a React bail-out, so a 16/s run costs no extra render.
  const stepTo = takeCursor

  const currentRow = filledRows[rowIdx] ?? filledRows[0]

  /**
   * `?date=` — resolved through Wave A's EXISTING refusal path, not a second
   * one. `resolveSeekIndex` already answers "is this session reachable?", so a
   * date outside the loaded window is refused here for the same reason and with
   * the same sentence (`SEEK_OUT_OF_WINDOW`) a dead Analogue Deck card carries.
   * The link does not silently land on the newest row pretending to be the date
   * it named.
   *
   * It RETRIES on a window change: `urlSeekIdx` is a function of the loaded
   * rows, so widening the window with the day pills makes it resolve and the
   * link lands — the same "widen and the same card becomes live" promise. Once
   * it lands, `landedDate` stops it, so the user's own scrubbing is never
   * yanked back. (Across a tab switch the whole component unmounts; the link's
   * "already spent" memory is `pages/Breadth.jsx`'s, not this one's.)
   *
   * ⭐ THE REFUSAL IS DERIVED, NOT STORED. "Is the link's date reachable in the
   * loaded window?" is a pure question about two values already on hand, and
   * `resolveSeekIndex` is the one thing that answers it — the same resolver
   * `onSeek` and `canSeek` use. A second copy in state could disagree with the
   * guard that produced it, which is exactly the shape Wave A built
   * `canSeek`/`onSeek` to avoid.
   *
   * ⛔ IT RECONCILES DURING RENDER, NOT IN AN EFFECT — the same "adjusting state
   * when props change" shape as the window clamp above, and for the same
   * reason. As an effect it tripped `react-hooks/set-state-in-effect`, and the
   * rule was right about the mechanism even where the intent was legitimate: an
   * effect paints one frame from the pre-seek cursor and then re-renders, so a
   * deep-linked session flickered through the newest row on the way in. It is
   * NOT suppressed with a disable comment; the pattern the rule names is gone.
   *
   * ⭐ `landedDate` IS STATE, NOT A REF, because React's documented form of this
   * pattern compares against state — a ref written during render is a mutation
   * the reconciler cannot see, and would be re-read as "already landed" by a
   * render React chose to throw away.
   */
  /**
   * 🔴 AND THE REFUSAL IS A CLAIM ABOUT NOW, NOT A CLAIM THAT KEEPS STANDING.
   *
   * "2026-07-13 — that session is outside the loaded window" is true the moment
   * a link opens on a window that does not hold it. It stops being the reader's
   * situation the moment they scrub somewhere reachable — the cursor is now
   * where THEY put it, and a banner still naming the link's date reads as a
   * live condition rather than as what happened on the way in. Same latch
   * retires the retry, so a later widen cannot yank the reader back either.
   */
  const urlDate = urlState?.date ?? null
  const urlSeekIdx = urlDate ? resolveSeekIndex(urlDate, dateIndex, filledRows.length) : null
  const urlDateRefused = urlDate && urlSeekIdx == null && !readerMoved ? urlDate : null
  const [landedDate, setLandedDate] = useState(null)
  if (!readerMoved && urlDate !== landedDate && urlSeekIdx != null) {
    setLandedDate(urlDate)
    // Already sitting on it (including our own write-back arriving as input):
    // claim it without moving the cursor.
    if (currentRow?.date !== urlDate) setRowIdx(urlSeekIdx)
  }

  /**
   * What this container's state IS, reported upward so the page can put it in
   * the query (spec §5). One direction only: the page owns the router and the
   * debounce, this owns the state.
   *
   * ⛔ `date` is reported ONLY once the cursor has left the newest row. Writing
   * today's date into every link would pin a share to a session that stops
   * being "the latest read" the next morning — a different claim than the one
   * the sharer made.
   *
   * ⛔ AND A RUN IN FLIGHT REPORTS NOTHING. Playback steps the cursor up to
   * sixteen times a second and every step used to be reported upward, so the
   * page re-rendered on each tick to hand a debounced writer a value that was
   * already stale before it could be written. The debounce was doing its job —
   * it collapsed those to one URL write — but the REPORT above it was the
   * churn, and the tab's showpiece is the one thing that should not thrash the
   * page.
   *
   * ⭐ The effect still re-runs per tick (`rowIdx` is a dependency and must
   * stay one); it returns before touching the parent. `playing` is a dependency
   * too, so the moment a run stops this fires once with the session it stopped
   * on — the link ends up describing exactly where the reader is, which is the
   * only position during a run that a share was ever going to mean.
   */
  useEffect(() => {
    if (!onUrlChange || playing) return
    onUrlChange({
      view: views.viewStyle,
      date: rowIdx > 0 ? (currentRow?.date ?? null) : null,
      compare: views.compareQuad,
      layout: views.layout,
    })
  }, [onUrlChange, views.viewStyle, views.compareQuad, views.layout, playing, rowIdx, currentRow?.date])
  const isLiveRow = !!currentRow?._live
  const prevRow = filledRows[rowIdx + 3]
  // Newest-first window up to the current cursor, for time-series styles
  // (Timeline grid, Scoreboard sparklines).
  const recentRows = useMemo(() => filledRows.slice(rowIdx, rowIdx + 30), [filledRows, rowIdx])

  // ⚠️ DELIBERATELY OVER ALL LOADED ROWS, NOT `rows.slice(rowIdx)` — and that is
  // the one place on this tab where the cursor is ignored on purpose.
  //
  // This is the BOARD-level normalizer: `normalizeMetric` uses it to put a
  // dozen metrics with different units onto one 0..100 scale so Rings, Radar,
  // Meters and Levels can be read side by side, and `pickSignals` compares them
  // against each other. That scale has to be the same object whichever session
  // the cursor sits on, or scrubbing back a day silently re-scales every board
  // and a metric's ring appears to move when only its yardstick did.
  //
  // `PercentileLadderView` asks a DIFFERENT question — "where does today sit in
  // its own history?" — which is a claim about the past, so it slices at the
  // cursor (`rows.slice(rowIdx)`) and would be reading the future if it did
  // not. Both are right; the difference is not an oversight, and the ladder is
  // not the one to "fix".
  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  // The live row's lists now exist — `/live/drill` serves them from the same
  // masks that produced the counts. What is still NOT drillable live is a
  // CARRIED metric with no session to attribute its names to, so `drillTarget`
  // decides per metric and `drillKey` is dropped only where it says no. Same
  // decision the monitor table makes, from the same module, so the two surfaces
  // cannot disagree about a cell.
  /**
   * ⭐ PER STYLE, ONE DERIVATION. Compare mode needs "what metrics does style X
   * show right now" for up to four styles per render, and the answer is exactly
   * what the single view always computed — that style's own visible set, with a
   * carried metric's `drillKey` stripped on a live row.
   *
   * It is resolved ONCE PER RENDER for the styles actually on screen (the
   * active one plus the quad) so a pane's `metrics` keeps a stable identity
   * while nothing has moved.
   */
  const buildMetrics = useCallback((style) => {
    const keys = visibleKeysFor(style)
    const shown = ALL_METRICS.filter(m => keys.has(m.key))
    if (!isLiveRow) return shown
    return shown.map(m => {
      if (drillTarget(currentRow, m, live)) return m
      const stripped = { ...m }
      delete stripped.drillKey
      return stripped
    })
  }, [visibleKeysFor, ALL_METRICS, isLiveRow, currentRow, live])

  const metricsByStyle = useMemo(() => {
    const out = {}
    for (const s of new Set([views.viewStyle, ...(views.compareQuad ?? [])])) out[s] = buildMetrics(s)
    return out
  }, [buildMetrics, views.viewStyle, views.compareQuad])

  const metricsFor = useCallback(
    (style) => metricsByStyle[style] ?? buildMetrics(style),
    [metricsByStyle, buildMetrics],
  )

  const visibleMetrics = metricsFor(views.viewStyle)

  // The metric set The Read's percentile clause ranks: the Percentile Ladder's
  // OWN visible set, whichever style is on screen. The Read is style-independent
  // — it reads the instruments, not the one that happens to be showing — and the
  // ladder is the lens that owns "where does this sit in its own history", so
  // its preset is the single authority for which metrics get ranked. (No live
  // `drillKey` stripping: The Read never drills.)
  const ladderMetrics = useMemo(
    () => ALL_METRICS.filter(m => visibleKeysFor('ladder').has(m.key)),
    [ALL_METRICS, visibleKeysFor],
  )
  const normalize = useMemo(
    () => (metric, row) => normalizeMetric(metric, row, pctileByKey),
    [pctileByKey],
  )

  // Signal of the Day + auto-notable divergence. The STRIP reads the active
  // style's set; each pane gets its own (below) so a pane never highlights a
  // metric it does not draw.
  const signals = useMemo(
    () => pickSignals(visibleMetrics, currentRow, prevRow, pctileByKey),
    [visibleMetrics, currentRow, prevRow, pctileByKey],
  )
  const signalMetric  = useMemo(() => visibleMetrics.find(m => m.key === signals.signalKey) ?? null, [visibleMetrics, signals.signalKey])
  const notableMetric = useMemo(() => visibleMetrics.find(m => m.key === signals.notableKey) ?? null, [visibleMetrics, signals.notableKey])

  // Views call onDrill(metric); Breadth's openDrill expects (row, metric, live).
  // Bridge here so view components stay row-agnostic.
  //
  // The refusal below is deliberately NOT `if (!isLiveRow)` any more, but it is
  // still a refusal: a view that ignores `drillKey` and drills anything it can
  // click would otherwise open a carried metric's list with no date to caption
  // it. `drillTarget` returning null is the same answer, checked twice.
  const drill = useMemo(
    () => (metric) => {
      if (drillTarget(currentRow, metric, live)) onDrill(currentRow, metric, live)
    },
    [onDrill, currentRow, live],
  )

  if (!currentRow) return null

  /**
   * ⭐ ONE ASSEMBLY, ANY STYLE — the whole of compare mode's cost.
   *
   * Single mode calls this for the active style; each of the four panes calls
   * it for its own. The ONLY thing that varies is the style key, because
   * everything a view needs is either shared (the cursor, the window, the
   * percentile spine, the drill bridge) or resolved from the registry + that
   * style's own preset. There is no `switch (style)` here and there must never
   * be one: `kind` is the contract, and a pane that needed a bespoke branch
   * would mean the abstraction is wrong, not the pane.
   */
  const bundleFor = (style) => {
    const kind = VIEW_CONFIG[style]?.kind ?? 'board'
    const options = optionsFor(style)
    const metrics = metricsFor(style)
    const sig = style === views.viewStyle
      ? signals
      : pickSignals(metrics, currentRow, prevRow, pctileByKey)
    // ⚠️ `viewRegistry.test.jsx` reads THIS declarator out of the file by AST
    // and pins its key set against the copy it renders with. Keep it a `kind`
    // ternary of two object literals.
    const viewProps = kind === 'lens'
      ? { rows: filledRows, currentRow, prevRow, rowIdx, onDrill: drill,
          onSeek, canSeek, options }
      : {
          currentRow, prevRow, recentRows, rows: filledRows, rowIdx,
          metrics, normalize, onDrill: drill, onSeek, canSeek,
          signalKey: sig.signalKey, notableKey: sig.notableKey,
          options, pctileByKey, visibleKeys: new Set(metrics.map(m => m.key)),
        }
    return viewProps
  }

  /**
   * ⭐ ONE PANEL, ANY STYLE — the same trick `bundleFor` plays for the views.
   *
   * Compare mode hid Customize entirely because every mutator on the hook
   * targeted `state.viewStyle`, so a panel in a pane would have edited whatever
   * style Single mode happened to be on. The writes take a style now, beside the
   * reads that always did, and this resolves one style's whole panel — label,
   * eligible metrics, schema, preset roster and every handler — so a pane's gear
   * gets the identical component the header renders, bound to its own style.
   *
   * ⛔ NOT a second Customize implementation, and not a reduced one: the same
   * `BreadthViewsCustomizePanel`, including presets and Save-as. A pane offering
   * a subset of the real panel would be a third answer to "what can I change
   * about a view", after Single and the /charts widget.
   */
  const customizeFor = (style) => {
    const preset = views.activePresetFor(style)
    return {
      viewLabel: VIEW_CONFIG[style]?.label ?? style,
      metrics: views.eligibleMetricsFor(style),
      optionsSchema: optionsSchema(style),
      options: optionsFor(style),
      activePreset: preset,
      visibleKeys: visibleKeysFor(style),
      presetNames: views.presetNamesFor(style),
      isDefaultActive: preset === DEFAULT_PRESET,
      onToggleVisible: (key) => views.toggleVisible(key, style),
      onSetOption: (name, value) => views.setOption(name, value, style),
      onSavePreset: (name) => views.savePreset(name, style),
      onRenamePreset: (from, to) => views.renamePreset(from, to, style),
      onDeletePreset: (name) => views.deletePreset(name, style),
      onSwitchPreset: (name) => views.switchPreset(name, style),
      onResetActive: () => views.resetActive(style),
    }
  }

  const ActiveView = VIEW_COMPONENTS[views.viewStyle]
  const isCompare = views.layout === 'compare'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', flexWrap: 'wrap' }}>
        {/* Single | Compare. In compare mode the style switcher is REPLACED by
            the four pane pickers rather than left on screen doing nothing — an
            inert control that offers choices and moves nothing is the shape of
            defect this tab has already paid for once. */}
        <div className={layoutStyles.toggle} role="group" aria-label="Layout">
          {LAYOUT_CHOICES.map(l => (
            <button key={l.key} type="button" data-testid={`layout-${l.key}`}
                    className={`${layoutStyles.btn} ${views.layout === l.key ? layoutStyles.btnActive : ''}`}
                    aria-pressed={views.layout === l.key} title={l.title}
                    onClick={() => views.setLayout(l.key)}>{l.label}</button>
          ))}
        </div>
        {!isCompare && <BreadthViewSwitcher viewStyle={views.viewStyle} onSelect={views.setViewStyle} />}
        {/* ⭐ THE ONE PLACE THIS TAB NAMES ITS SESSION.
            The date used to be printed here AND in the scrubber's readout a row
            below, in bolder type — two copies of the tab's single most important
            value, thirty pixels apart. This is the canonical one: it sits inside
            the stepper that moves it, and it is the slot the LIVE badge takes
            over, so "which session" is answered in exactly one place whether
            that session is a finished day or a provisional one. The scrubber
            states its position instead, and carries the date on the slider for
            hover and for screen readers. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}
             title="The session every view on this tab is drawn as of">
          <button className={layoutStyles.step} onClick={() => onSeek(rowIdx + 1)}
                  disabled={rowIdx >= rows.length - 1} aria-label="Previous day">←</button>
          {currentRow._live ? (
            <span
              data-testid="cursor-live"
              className={signalStyles.liveTag}
              title={`Provisional — computed ${liveStamp ?? 'now'} ET. The 4:15 PM `
                + `collector writes the day's authoritative reading.`}
            >
              <span className={signalStyles.livePulse} aria-hidden="true" />
              LIVE · {liveStamp ?? 'now'}
            </span>
          ) : (
            <span data-testid="cursor-date"
                  style={{ font: '700 13px Instrument Sans, sans-serif', color: '#e2e8f0',
                           letterSpacing: '.2px', fontVariantNumeric: 'tabular-nums',
                           minWidth: 88, textAlign: 'center' }}>{currentRow.date}</span>
          )}
          <button className={layoutStyles.step} onClick={() => onSeek(rowIdx - 1)}
                  disabled={rowIdx === 0} aria-label="Next day">→</button>
          {rowIdx > 0 && (
            <button className={layoutStyles.latest} onClick={() => onSeek(0)}>LATEST</button>
          )}
        </div>
        {/* The link named a session this window does not hold. Wave A's guard
            AND Wave A's sentence — the date stays legible, and the reader is
            told what to do about it, rather than being silently parked on the
            newest row. */}
        {urlDateRefused && (
          <span data-testid="url-date-refusal" className={layoutStyles.refusal}>
            {urlDateRefused} — {SEEK_OUT_OF_WINDOW}
          </span>
        )}
        {isCompare ? (
          // The panel is not hidden any more, so this is a pointer rather than
          // an apology: it says where the control moved to and what its scope is.
          <span className={layoutStyles.note} style={{ marginLeft: 'auto' }}>
            Options are per style — the gear in a pane’s header edits that style everywhere.
          </span>
        ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <QuickPresetSwitcher presetNames={views.presetNames}
                               activePreset={views.activePreset} onSwitch={views.switchPreset} />
          <div className={customizeStyles.anchor} {...anchorProps()}>
            <button className={`${customizeStyles.triggerBtn} ${customizeOpen ? customizeStyles.triggerBtnActive : ''}`}
                    onClick={() => setCustomizeOpen(o => !o)} title="Customize this view">
              <span className={customizeStyles.triggerIcon}><UIcon name="gear" size={13} /></span> {viewLabel}
              {!views.isDefaultActive ? ` · ${views.activePreset}` : ''}
            </button>
            {customizeOpen && (
              <BreadthViewsCustomizePanel
                viewLabel={viewLabel}
                metrics={panelMetrics}
                optionsSchema={optionsSchema(views.viewStyle)}
                options={views.options}
                activePreset={views.activePreset}
                visibleKeys={views.visibleKeys}
                presetNames={views.presetNames}
                isDefaultActive={views.isDefaultActive}
                onToggleVisible={views.toggleVisible}
                onSetOption={views.setOption}
                onSavePreset={views.savePreset}
                onRenamePreset={views.renamePreset}
                onDeletePreset={views.deletePreset}
                onSwitchPreset={views.switchPreset}
                onResetActive={views.resetActive}
                onClose={() => setCustomizeOpen(false)}
              />
            )}
          </div>
        </div>
        )}
      </div>

      <BreadthScrubber
        rows={filledRows} rowIdx={rowIdx} playing={playing}
        onSeek={onSeek} onStep={stepTo} onPlayingChange={setPlaying}
      />

      <BreadthSignalStrip
        signalMetric={signalMetric} signalReason={signals.signalReason}
        notableMetric={notableMetric} notableReason={signals.notableReason}
        currentRow={currentRow} onDrill={drill}
      />

      {/* ⭐ ALWAYS VISIBLE, AND STYLE-INDEPENDENT — it reads the instruments,
          so it says the same thing whichever one is on screen, in Single and in
          Compare alike. It is handed `optionsFor` rather than a bag of resolved
          options so a clause reads its lens's CONFIGURED series and window, and
          it fetches nothing (see the header of `TheReadStrip.jsx`). */}
      <TheReadStrip rows={filledRows} rowIdx={rowIdx}
                    optionsFor={optionsFor} ladderMetrics={ladderMetrics} />

      {/* ONE scrubber and ONE date header, both above — the grid below shares
          them. Four panes, four styles, one cursor. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {isCompare
          ? <CompareGrid quad={views.compareQuad} propsForStyle={bundleFor}
                         customizeForStyle={customizeFor}
                         onPick={views.setComparePane} />
          : (ActiveView && <ActiveView {...bundleFor(views.viewStyle)} />)}
      </div>
    </div>
  )
}
