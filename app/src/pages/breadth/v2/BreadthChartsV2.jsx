/**
 * Data Charts V2 — the shell (V2-1), the stacked panels (V2-2) and honest coverage with
 * long history (V2-3), dressed as a product.
 *
 * ⚰️ UNTIL 2026-09-19 THIS FILE HAD NO PRESENTATION LAYER AT ALL — not one className, no
 * stylesheet, an `<h2>Data Charts V2</h2>` heading — and it was flipped to every member in
 * that state (D-055). The flip was verified by health checks, `/series` latency and
 * test-ids present in the DOM; nobody looked at the page. The owner found it. The design
 * it was supposed to implement (`docs/breadth/02-design.md`) had been written in Phase 2
 * and never built. ⛔ A member-facing flip of this surface needs a SCREENSHOT a human
 * would accept, next to the surface it replaces — ids and 200s prove plumbing only.
 *
 * ⛔ THE HONEST STATES COME FIRST AND ARE NOT OPTIONAL. Everything above the chart —
 * refused range, dropped keys, not-held keys, reconstructed sessions — is a claim about
 * what the reader is looking at. A chart drawn without them is more confident than the
 * data, which is the defect the whole C-lane and A-10 exist to fix.
 *
 * ⛔ V2-2 AND V2-3 ARE READ SEPARATELY. They are independent increments that the owner
 * flips and reverts separately, so this component asks for each one on its own and never
 * treats "V2 is on" as a single fact.
 *
 * ⭐ IT REUSES V1'S MEMBER-FACING PIECES RATHER THAN REINVENTING THEM: the preset row, the
 * readout (the legend with latest value and percentile), the group picker's look, the
 * load-error sentences, and the same saved-preferences key — so a member's saved V1 view
 * opens as the same view here.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import UIcon from '../../../components/ui/UIcon'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { useLiveBreadth } from '../../../hooks/useLiveBreadth'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import useBreadthSeries, { MAX_KEYS } from './useBreadthSeries'
import { useDcFlags } from './flag'
import { buildOption, DEFAULT_CHROME, LIGHT_CHROME, LOG_UNITS, formatValue } from './chartOption'
import { panelsFor } from './panels'
import { todayET, shiftISO } from '../sessionDates'
import { defaultSelectionFor } from './defaults'
import { coverageModel } from './coverage'
import { shouldSample } from './lttb'
import { assignColours } from './stickyColours'
import {
  shortOf, unitOf, CHART_GROUPS, LABEL_MAP, CHART_PRESETS, PRESET_GROUP_ORDER,
  matchPreset, resolveLines,
} from '../chartMetrics'
import { formatSessionTick } from '../chartTicks'
import { describeLoadError } from '../chartLoadError'
import PresetRow from '../PresetRow'
import MetricReadout from '../MetricReadout'
import styles from './BreadthChartsV2.module.css'

/** Shared with V1 on purpose: a member's saved selection opens as the same view. */
const PREF_KEY = 'breadth_charts_state'
const DEFAULT_RANGE = '90d'

/**
 * The range control (02-design §3). `id` is the test/persistence handle and never
 * changes; `label` is what a member reads.
 *
 * ⭐ `Max` is 2008-01-02 — the documented start of stored history (`01-audit.md`'s A-11:
 * "History reaches 2008-01-02"). Raised and reachable as of L-A/L-B (2026-09-17, D-054):
 * `BREADTH_SERIES_MAX_SESSIONS` and `useBreadthSeries.MAX_SESSIONS` both cover it now. A
 * preset the backend genuinely cannot serve is still not a dead end — it lands on the
 * EXISTING `s.tooWide` honest refusal below, which already says so in plain words.
 *
 * ⛔ Past one year is V2-3's long history, so those choices appear only under v23 (the
 * owner reverts the increments separately; with v23 off the endpoint was never asked
 * for more than a year by this surface).
 */
const MAX_HISTORY_FROM = '2008-01-02'
const RANGES = [
  { id: '90d', label: '90D', days: 90 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: '2y', label: '2Y', days: 730, long: true },
  { id: '5y', label: '5Y', days: 1825, long: true },
  { id: 'Max', label: 'Max', days: null, long: true },
]
const RANGE_BY_ID = Object.fromEntries(RANGES.map(r => [r.id, r]))

const EMPTY_SET = new Set()
const finiteOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Canvas cannot read `var(--…)`. The app writes the theme family onto <html>; follow it. */
function useDocTheme() {
  const read = () => (typeof document === 'undefined' ? '' : document.documentElement.dataset.theme || '')
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const el = document.documentElement
    const mo = new MutationObserver(() => setTheme(el.dataset.theme || ''))
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return theme
}

/** The chart box's measured height — margins are derived from it in pixels. */
function useHeight(ref) {
  const [h, setH] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect?.height ?? 0)
      if (next > 0) setH(prev => (prev === next ? prev : next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return h
}

/** "Jun 22 to Sep 18, 2026" — the year once when both ends share it. */
function spanText(first, last) {
  if (!first || !last) return ''
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  const a = sameYear ? formatSessionTick(first, 0, false) : formatSessionTick(first, 0, true)
  return `from ${a} to ${formatSessionTick(last, 0, true)}`
}

function listText(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function BreadthChartsV2({ keys, from, to }) {
  // Eastern, like every other session date in this programme (A-35).
  const today = todayET()
  const { v22, v23 } = useDcFlags()
  const { prefs, setPref } = usePreferences()
  const isPhone = useIsPhone()
  const docTheme = useDocTheme()
  const pickerId = useId()

  // ⛔⛔ CONTROLLED VS UNCONTROLLED. A `keys` prop — every existing test, and any future
  // embedder that wants a fixed view — takes over the selection completely and hides the
  // picker below: nobody who explicitly asked for a set of keys wants a checkbox list
  // second-guessing them. The live, unwrapped mount (`BreadthCharts.jsx` renders
  // `<BreadthChartsV2 />` with no props at all) is the uncontrolled case.
  const isControlled = keys !== undefined

  // The saved view, DERIVED from prefs (no copy-into-state effect: prefs resolve after
  // mount, and an effect would paint the default and then swap). Unknown keys are dropped
  // so a renamed metric cannot blank the chart; `/series` answers at most MAX_KEYS.
  const storedRaw = prefs[PREF_KEY]
  const stored = useMemo(() => {
    const saved = parsePref(storedRaw, null)
    if (!saved || typeof saved !== 'object') return null
    const picked = Array.isArray(saved.selected)
      ? saved.selected.filter(k => k in LABEL_MAP).slice(0, MAX_KEYS)
      : []
    return {
      raw: saved,
      selected: picked.length ? picked : null,
      extremes: Boolean(saved.extremes?.['MA Breadth']),
      range: typeof saved.range === 'string' && RANGE_BY_ID[saved.range] ? saved.range : null,
    }
  }, [storedRaw])

  // ⛔ THE DEFAULT DEPENDS ON THE FLAG (D-052). With V2-2 on, the default adds the
  // most-used non-percentage metric so the stack is visible immediately.
  const defaultSelection = useMemo(() => defaultSelectionFor({ v22 }), [v22])
  const [pickedOverride, setPickedOverride] = useState(null)
  const baseSelection = isControlled
    ? keys
    : (pickedOverride ?? stored?.selected ?? defaultSelection)

  // ⛔ THE ERA NOTE'S ONE-TAP SWAP (A-11) — kept as a layer OVER `baseSelection`, never
  // folded into it, so a range change keeps the reader's swap, while a genuinely new
  // selection simply stops matching `swap.from` and the layer becomes a no-op on its own.
  const [swap, setSwap] = useState(null) // { from, to } | null
  const selection = useMemo(
    () => (swap ? baseSelection.map(k => (k === swap.from ? swap.to : k)) : baseSelection),
    [baseSelection, swap],
  )

  const [extremesOverride, setExtremesOverride] = useState(null)
  const showExtremes = extremesOverride ?? stored?.extremes ?? false

  // ⛔ The range is IGNORED whenever a `from` prop is given — the same override pattern
  // `selection` uses above, so every caller that pins a window keeps behaving the same.
  const [rangeOverride, setRangeOverride] = useState(null)
  const allowedRange = id => Boolean(RANGE_BY_ID[id]) && (v23 || !RANGE_BY_ID[id].long)
  const rangeId = rangeOverride === 'custom'
    ? 'custom'
    : [rangeOverride, stored?.range, DEFAULT_RANGE].find(id => id && allowedRange(id)) ?? DEFAULT_RANGE
  const range = RANGE_BY_ID[rangeId]
  const [customFrom, setCustomFrom] = useState(() => shiftISO(today, -90))
  const [customTo, setCustomTo] = useState(today)
  const effectiveFrom = from ?? (rangeId === 'custom'
    ? customFrom
    : range.days === null ? MAX_HISTORY_FROM : shiftISO(today, -range.days))
  const effectiveTo = to ?? (rangeId === 'custom' ? customTo : today)

  // Persist what the MEMBER changed — a page load never writes its own restored state
  // back. V1's own fields in the same document (`ftd`, other groups' extremes) are
  // carried through untouched, so reverting the flag loses nothing.
  const saveTimer = useRef(null)
  useEffect(() => {
    if (isControlled) return undefined
    if (pickedOverride === null && extremesOverride === null && rangeOverride === null) return undefined
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const raw = stored?.raw ?? {}
      setPref(PREF_KEY, {
        ...raw,
        selected: baseSelection,
        extremes: { ...(raw.extremes ?? {}), 'MA Breadth': showExtremes },
        range: rangeId === 'custom' ? (raw.range ?? DEFAULT_RANGE) : rangeId,
      })
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [isControlled, pickedOverride, extremesOverride, rangeOverride, baseSelection,
      showExtremes, rangeId, stored, setPref])

  // ⛔ PANELS ARE DERIVED FROM `selection` — WHAT THE MEMBER PICKED — NEVER FROM THE
  // REQUEST. `universe_count` is injected into the WIRE REQUEST below and must never leak
  // into what gets rendered as an uninvited panel.
  const panels = useMemo(() => panelsFor(selection), [selection])

  // ⛔⛔ A-11 ERA NOTE WIRING (Q3/DC5, L-A "wire fields") — `universe_count` is a HELPER
  // FIELD for `coverageModel`'s era-note computation, not a chart series. It rides along
  // in the REQUEST only when v23 is on and the member's own selection already contains a
  // count-family panel — never added to `selection`, never counted against the member's
  // own panel choices.
  //
  // ⛔ ONLY WHEN THERE IS ROOM. `/series` caps at `MAX_KEYS` (8); `seriesRequest` dedupes,
  // SORTS, then slices at 8 — so a 9th key could bump a member-selected metric that sorts
  // after "universe_count". A full 8-panel selection simply does not get the era note —
  // an honest degradation, never a displaced panel.
  const hasCountPanel = panels.some(p => p.unit === 'count')
  const requestedKeys = (v23 && hasCountPanel && selection.length < MAX_KEYS
                          && !selection.includes('universe_count'))
    ? [...selection, 'universe_count']
    : selection
  const s = useBreadthSeries(requestedKeys, effectiveFrom, effectiveTo)

  // The provisional intraday row extends every line to NOW — appended, never substituted:
  // the backend withholds it the moment the 4:15 collector writes the day, so a recorded
  // point and an estimate of that same point cannot both appear. Only on a window that
  // ends today, and only on the live (uncontrolled) mount.
  const liveEnabled = !isControlled && from === undefined && to === undefined && rangeId !== 'custom'
  const live = useLiveBreadth({ enabled: liveEnabled })
  const liveRow = liveEnabled ? live.row : null
  const merged = useMemo(() => {
    const base = { dates: s.dates, series: s.series, liveIndex: -1 }
    if (!s.series || !s.dates?.length || !liveRow?.date) return base
    const last = s.dates[s.dates.length - 1]
    if (liveRow.date <= last || liveRow.date > effectiveTo) return base
    const dates = [...s.dates, liveRow.date]
    const series = Object.fromEntries(
      Object.entries(s.series).map(([k, v]) => [k, [...v, finiteOrNull(liveRow[k])]]),
    )
    return { dates, series, liveIndex: dates.length - 1 }
  }, [s.dates, s.series, liveRow, effectiveTo])

  // Which unit families the reader has asked to see on a log scale.
  const [logPanels, setLogPanels] = useState(() => new Set())

  // Series the reader hid from the readout. Keyed to the selection it was made in: a new
  // selection starts with everything visible, so the readout never dims a row for a line
  // the chart is drawing.
  const selectionKey = selection.join(',')
  const [hiddenState, setHiddenState] = useState({ key: '', set: EMPTY_SET })
  const hidden = hiddenState.key === selectionKey ? hiddenState.set : EMPTY_SET
  function toggleHidden(key) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setHiddenState({ key: selectionKey, set: next })
  }

  // ⚰️ LTTB USED TO PRE-PROCESS `s.dates`/`s.series` HERE (D-053, see `lttb.js`): ECharts'
  // OWN `sampling` downsamples each series' render data without touching the shared
  // category axis, so `chartOption.js` decides per series whether to ask for it. This is
  // only whether ANY series is long enough to be sampled, for the honest note below.
  const isSampled = v23 && shouldSample(merged.dates?.length)

  // ⛔⛔ V2-3's MODEL IS NULL WHENEVER IT HAS NOTHING HONEST TO SAY, and the option then
  // receives `coverage: null` and contributes no keys — so with coverage absent the
  // OPTION V2-3 builds is IDENTICAL to V2-2's. That equality is the owner's rail (scoped
  // to "coverage": bands + the era note — the range control is a separate navigation
  // control and is not part of this claim).
  const coverage = useMemo(() => {
    if (!v23 || !merged.series || !merged.dates?.length) return null
    return coverageModel({
      dates: merged.dates,
      valuesByKey: merged.series,
      // ⛔ `selection`, NOT `s.keys` — bands are drawn per RENDERED panel; a band for the
      // injected `universe_count` helper would shade a panel nobody selected.
      keys: selection,
      reconstructed: s.reconstructed,
      panels,
    })
  }, [v23, merged.series, merged.dates, selection, s.reconstructed, panels])

  // Metric-attached reference levels (D-009), suppressed when they would stretch a
  // self-framed axis past what is on screen.
  const refLines = useMemo(() => {
    if (!merged.series) return []
    const extentOf = unit => {
      const values = selection
        .filter(k => unitOf(k) === unit)
        .flatMap(k => merged.series[k] ?? [])
        .filter(v => typeof v === 'number' && Number.isFinite(v))
      if (!values.length) return null
      let lo = Infinity
      let hi = -Infinity
      for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v }
      return [lo, hi]
    }
    return resolveLines(selection, extentOf)
  }, [selection, merged.series])

  const chrome = docTheme === 'light' ? LIGHT_CHROME : DEFAULT_CHROME
  const boxRef = useRef(null)
  const heightPx = useHeight(boxRef)

  // One colour map for the lines AND the readout's swatches. Sticky while selected: the
  // last assignment is the input to the next, so a survivor is never repainted. Held as
  // state from the previous render (React's documented pattern), not a ref read in render.
  const [colourState, setColourState] = useState(() => ({ key: selectionKey, map: assignColours(selection) }))
  let colours = colourState.map
  if (colourState.key !== selectionKey) {
    colours = assignColours(selection, colourState.map)
    setColourState({ key: selectionKey, map: colours })
  }

  const option = useMemo(() => {
    if (!v22 || !merged.series || !merged.dates?.length) return null
    return buildOption(merged.dates, merged.series, selection, {
      colours, logPanels, coverage, allowSampling: v23, chrome, hidden, refLines,
      extremes: showExtremes,
      live: merged.liveIndex >= 0 ? { index: merged.liveIndex, clock: live.clock } : null,
      endLabels: !isPhone,
      slider: !isPhone,
      heightPx,
    })
  }, [v22, v23, merged, selection, colours, logPanels, coverage, chrome, hidden, refLines,
      showExtremes, live.clock, isPhone, heightPx])

  // The readout's rows — the legend, with each series' latest value and its percentile
  // within the window shown.
  const readoutRows = useMemo(() => {
    if (!merged.series) return []
    return merged.dates.map((date, i) => {
      const row = { date }
      for (const k of selection) row[k] = merged.series[k]?.[i] ?? null
      return row
    })
  }, [merged, selection])

  // ⛔⛔ THE CANVAS IS INVISIBLE TO ASSISTIVE TECH — a one-line summary as the chart's
  // accessible name, plus a real `<table>` alternative behind a toggle.
  const chartSummary = useMemo(() => {
    if (!panels.length || !merged.dates?.length) return ''
    const seriesLabels = selection.map(shortOf).join(', ')
    return `Line chart with ${panels.length} panel${panels.length === 1 ? '' : 's'}: `
      + `${seriesLabels}. ${merged.dates.length} sessions, `
      + `${merged.dates[0]} to ${merged.dates[merged.dates.length - 1]}. `
      + 'A data table with the same values is available via the "View as table" button.'
  }, [panels.length, selection, merged.dates])
  const [showTable, setShowTable] = useState(false)

  // The chart states itself (02-design principle 1): what is plotted, over what, how fresh.
  const readingLine = useMemo(() => {
    if (!s.dates?.length) return ''
    const n = s.dates.length
    const base = `${listText(selection.map(shortOf))}, ${spanText(s.dates[0], s.dates[n - 1])}. `
      + `${n.toLocaleString('en-US')} session${n === 1 ? '' : 's'}.`
    return merged.liveIndex >= 0
      ? `${base} Live at ${live.clock} ET, provisional until the 4:15 PM close is recorded.`
      : base
  }, [s.dates, selection, merged.liveIndex, live.clock])

  // ── Controls ────────────────────────────────────────────────────────────────
  const [expandedGroups, setExpandedGroups] = useState({})
  const groupListId = group => `${pickerId}-${group.replace(/[^a-z0-9]+/gi, '-')}`
  function toggleMetricGroup(group) {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }
  function togglePickedKey(key) {
    const prev = baseSelection
    if (prev.includes(key)) {
      const next = prev.filter(k => k !== key)
      // ⛔ Never drop to zero — "the chart just vanished" is a worse reading than a
      // checkbox that will not uncheck.
      if (next.length) setPickedOverride(next)
      return
    }
    // ⛔ `/series` caps at MAX_KEYS. Refusing the ADD and saying so (`v2-picker-full`)
    // is the honest version of the limit; silently bumping a pick would be a surprise.
    if (prev.length >= MAX_KEYS) return
    setPickedOverride([...prev, key])
  }
  function applyPreset(preset) {
    setSwap(null)
    setPickedOverride(preset.metrics.slice(0, MAX_KEYS))
    setExtremesOverride((preset.extremes ?? []).includes('MA Breadth'))
    // Only ever widens: A/D Line needs a year before its trough is on screen.
    if (preset.minWindowDays && rangeId !== 'custom' && range.days !== null && range.days < preset.minWindowDays) {
      const wider = RANGES.find(r => r.days !== null && r.days >= preset.minWindowDays && allowedRange(r.id))
      if (wider) setRangeOverride(wider.id)
    }
  }
  function toggleLog(unit) {
    setLogPanels(prev => {
      const next = new Set(prev)
      if (next.has(unit)) next.delete(unit)
      else next.add(unit)
      return next
    })
  }
  function chooseCustom() {
    setCustomFrom(effectiveFrom)
    setCustomTo(effectiveTo)
    setRangeOverride('custom')
  }

  const activePreset = useMemo(() => matchPreset(baseSelection), [baseSelection])
  const logCandidates = panels.filter(p => LOG_UNITS.has(p.unit))
  const minBoxPx = isPhone
    ? Math.max(360, panels.length * 130 + 40)
    : Math.max(420, panels.length * 150 + 90)
  const loadError = !s.tooWide && s.error ? describeLoadError(s.error) : null

  return (
    <section className={styles.root} data-testid="breadth-charts-v2" aria-label="Data Charts">
      <div className={styles.controls}>
        {!isControlled && (
          <PresetRow
            presets={CHART_PRESETS}
            groupOrder={PRESET_GROUP_ORDER}
            activePreset={activePreset}
            onApply={applyPreset}
          />
        )}

        {/* ⛔⛔ THE METRIC PICKER — uncontrolled mount only (see `isControlled`). */}
        {!isControlled && (
          <div className={styles.picker} data-testid="v2-metric-picker">
            <div className={styles.groupRow} data-testid="v2-metric-group-buttons">
              {CHART_GROUPS.map(g => {
                const selectedInGroup = g.metrics.filter(m => baseSelection.includes(m.key)).length
                const open = Boolean(expandedGroups[g.group])
                return (
                  <button
                    key={g.group}
                    type="button"
                    aria-expanded={open}
                    aria-controls={groupListId(g.group)}
                    data-testid={`v2-metric-group-toggle-${g.group}`}
                    className={`${styles.groupBtn} ${open ? styles.groupBtnOpen : ''}`}
                    onClick={() => toggleMetricGroup(g.group)}
                  >
                    {g.group}
                    {selectedInGroup > 0 && <span className={styles.badge}>{selectedInGroup}</span>}
                    <UIcon name={open ? 'chevronUp' : 'chevronDown'} size={12} gold={false} />
                  </button>
                )
              })}
            </div>
            {baseSelection.length >= MAX_KEYS && (
              <p role="status" className={styles.pickerFull} data-testid="v2-picker-full">
                Up to {MAX_KEYS} metrics at a time — remove one to add another.
              </p>
            )}
            {CHART_GROUPS.map(g => expandedGroups[g.group] && (
              <div
                key={g.group}
                id={groupListId(g.group)}
                className={styles.metricList}
                data-testid={`v2-metric-group-${g.group}`}
              >
                {/* A-22: the extremes draw only on the percentage panel, so the toggle
                    lives with the metrics that put one there. */}
                {g.group === 'MA Breadth' && (
                  <div className={styles.extremesRow}>
                    <button
                      type="button"
                      aria-pressed={showExtremes}
                      data-testid="v2-extremes"
                      className={`${styles.extremesBtn} ${showExtremes ? styles.extremesBtnOn : ''}`}
                      onClick={() => setExtremesOverride(!showExtremes)}
                    >
                      <UIcon name="bolt" size={13} />Notable Extremes
                    </button>
                  </div>
                )}
                {g.metrics.map(m => {
                  const checked = baseSelection.includes(m.key)
                  return (
                    <label key={m.key} className={styles.metricItem}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && baseSelection.length >= MAX_KEYS}
                        onChange={() => togglePickedKey(m.key)}
                      />
                      <span>{m.label}</span>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <div className={styles.toolbar}>
          {from === undefined && (
            <div className={styles.rangeGroup}>
              <div className={styles.segmented} role="group" aria-label="Date range" data-testid="v2-extended-days">
                {RANGES.filter(r => allowedRange(r.id)).map(r => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={rangeId === r.id}
                    data-testid={`v2-days-${r.id}`}
                    className={`${styles.segment} ${rangeId === r.id ? styles.segmentOn : ''}`}
                    onClick={() => setRangeOverride(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={rangeId === 'custom'}
                  data-testid="v2-days-custom"
                  className={`${styles.segment} ${rangeId === 'custom' ? styles.segmentOn : ''}`}
                  onClick={chooseCustom}
                >
                  Custom
                </button>
              </div>
              {rangeId === 'custom' && (
                <div className={styles.dates}>
                  <label className={styles.dateLabel}>
                    From
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={customFrom}
                      min={MAX_HISTORY_FROM}
                      max={customTo}
                      onChange={e => e.target.value && setCustomFrom(e.target.value)}
                    />
                  </label>
                  <label className={styles.dateLabel}>
                    To
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={customTo}
                      min={customFrom}
                      max={today}
                      onChange={e => e.target.value && setCustomTo(e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className={styles.toolbarEnd}>
            {/* ⛔ A LOG CONTROL THAT DID NOTHING MUST SAY WHY — see the refusal below. */}
            {option && logCandidates.length > 0 && (
              <div className={styles.logGroup} data-testid="v2-log-toggles">
                {logCandidates.map(p => (
                  <button
                    key={p.unit}
                    type="button"
                    aria-pressed={logPanels.has(p.unit)}
                    data-testid={`v2-log-${p.unit}`}
                    className={`${styles.chip} ${logPanels.has(p.unit) ? styles.chipOn : ''}`}
                    onClick={() => toggleLog(p.unit)}
                  >
                    Log scale · {p.label}
                  </button>
                ))}
              </div>
            )}
            {option && (
              <button
                type="button"
                data-testid="v2-table-toggle"
                aria-expanded={showTable}
                aria-controls="v2-data-table"
                className={`${styles.chip} ${showTable ? styles.chipOn : ''}`}
                onClick={() => setShowTable(v => !v)}
              >
                <UIcon name="rows" size={13} gold={false} />
                {showTable ? 'Hide data table' : 'View as table'}
              </button>
            )}
          </div>
        </div>
      </div>

      {readingLine && <p className={styles.reading}>{readingLine}</p>}

      <div className={styles.notes}>
        {s.tooWide && (
          // ⭐ NOT an error. The app knows this range cannot be served yet, so it says so
          // in those words rather than asking and rendering a 400.
          <p role="status" className={styles.note} data-testid="v2-range-refused">
            Range not yet available — up to {s.maxSessions} sessions for now.
          </p>
        )}
        {s.dropped.length > 0 && (
          <p role="status" className={styles.note} data-testid="v2-keys-dropped">
            Showing the first {s.keys.length} metrics; {s.dropped.length} not requested.
          </p>
        )}
        {s.missing.length > 0 && (
          // ⛔ A requested key the row schema does not hold is REPORTED, never dropped.
          // Silently omitting it renders "we do not store this" as "this was flat".
          <p role="status" className={styles.note} data-testid="v2-missing">
            Not held: {s.missing.join(', ')}
          </p>
        )}
        {s.reconstructed.length > 0 && (
          <p className={styles.note} data-testid="v2-reconstructed">
            {s.reconstructed.length === 1
              ? '1 session in this range is reconstructed from price history.'
              : `${s.reconstructed.length.toLocaleString('en-US')} sessions in this range are reconstructed from price history.`}
          </p>
        )}
        {option && option.__refusals.map(r => (
          <p key={r.unit} role="status" className={styles.note} data-testid={`v2-log-refused-${r.unit}`}>
            {r.reason}
          </p>
        ))}
        {option && isSampled && (
          // ⛔ HONEST ABOUT THE DOWNSAMPLE, EVEN THOUGH IT SHOWS ONLY REAL POINTS.
          // ⚰️ This used to state an exact "N of M points" — impossible now that ECharts
          // decides the actual count internally, per zoom level.
          <p role="status" className={styles.note} data-testid="v2-sampled">
            Some points are combined for readability on this range — zoom in to see
            every session; every point drawn is a real reading.
          </p>
        )}
        {option && coverage?.era && (
          // A-11 "Era comparability". ⛔ The numbers are the WINDOW'S OWN.
          <p role="status" className={`${styles.note} ${styles.noteEra}`} data-testid="v2-era-note">
            <span>{coverage.era.text}</span>
            {coverage.era.swap && (
              // ⛔⛔ WAS UNWIRED — the click handler was never added, so the button did
              // nothing. Once applied, `hi_ratio`'s own unit (PCT) moves it out of the count
              // panel, so this note's own precondition stops holding and it retires itself.
              <button
                type="button"
                className={styles.noteAction}
                data-testid="v2-era-swap"
                onClick={() => setSwap(coverage.era.swap)}
              >
                Use %
              </button>
            )}
          </p>
        )}
      </div>

      {!s.tooWide && (
        <div className={styles.frame}>
          {option && (
            <div className={styles.readout}>
              <MetricReadout
                rows={readoutRows}
                selected={selection}
                hidden={hidden}
                onToggle={toggleHidden}
                colors={colours}
              />
            </div>
          )}
          <div
            ref={boxRef}
            className={styles.chartBox}
            style={{ '--v2-min-h': `${minBoxPx}px` }}
          >
            {loadError && !merged.series && (
              <div className={styles.problem} role="alert" data-testid="v2-error">
                <UIcon name="warning" size={20} gold={false} />
                <div className={styles.problemText}>
                  <p className={styles.problemTitle}>{loadError.title}</p>
                  <p className={styles.problemBody}>
                    {loadError.body}{s.error?.status ? ` (${s.error.status})` : ''}
                  </p>
                </div>
                {loadError.action.retry
                  ? <button type="button" className={styles.problemAction} onClick={s.retry}>{loadError.action.label}</button>
                  : <a className={styles.problemAction} href={loadError.action.href}>{loadError.action.label}</a>}
              </div>
            )}
            {!loadError && s.isLoading && !merged.series && (
              <p role="status" className={styles.placeholder}>Loading breadth history…</p>
            )}
            {!loadError && !s.isLoading && merged.series && !merged.dates.length && (
              <p role="status" className={styles.placeholder}>
                No sessions {spanText(effectiveFrom, effectiveTo)}. Pick a range that includes past sessions.
              </p>
            )}
            {option && (
              // ⛔ `role="img"` deliberately flattens the canvas subtree for assistive tech;
              // the readout above and the table below are the accessible content.
              <div role="img" aria-label={chartSummary} className={styles.chartImg}>
                <ReactECharts
                  option={option}
                  style={{ height: '100%', width: '100%' }}
                  notMerge
                  lazyUpdate
                />
              </div>
            )}
            {!option && merged.series && merged.dates.length > 0 && (
              // The V2-1 diagnostic list, still the view when V2-2 is off — it is what proved
              // the read path end to end.
              <ul className={styles.diagnostic} data-testid="v2-series">
                {Object.entries(merged.series).map(([key, values]) => (
                  <li key={key} data-testid={`v2-series-${key}`}>
                    {key}: {values.length} points,{' '}
                    {/* ⭐ a null is an ABSENT reading, never a zero — counted. */}
                    {values.filter(v => v === null).length} absent
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {option && showTable && (
        <div className={styles.tableWrap} data-testid="v2-data-table-wrap">
          <table id="v2-data-table" className={styles.table} data-testid="v2-data-table">
            <caption className={styles.caption}>{chartSummary}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {selection.map(key => <th scope="col" key={key}>{shortOf(key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {/* Newest first — the session a reader usually wants is the latest. */}
              {merged.dates.map((_d, j) => merged.dates.length - 1 - j).map(i => (
                <tr key={merged.dates[i]}>
                  <th scope="row">{merged.dates[i]}</th>
                  {selection.map(key => (
                    // The table's honest-absence convention: a null reading is an em dash.
                    <td key={key}>{formatValue(merged.series[key]?.[i])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
