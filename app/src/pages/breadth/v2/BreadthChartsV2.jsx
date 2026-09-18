/**
 * Data Charts V2 — the shell (V2-1) and, since DC-2 §3.3, the stacked panels (V2-2).
 *
 * ⛔ THE HONEST STATES COME FIRST AND ARE NOT OPTIONAL. Everything above the chart —
 * refused range, dropped keys, not-held keys, reconstructed sessions — is a claim about
 * what the reader is looking at. A chart drawn without them is more confident than the
 * data, which is the defect the whole C-lane and A-10 exist to fix.
 *
 * ⛔ V2-2 AND V2-3 ARE READ SEPARATELY. They are independent increments that the owner
 * flips and reverts separately, so this component asks for each one on its own and never
 * treats "V2 is on" as a single fact.
 */
import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import useBreadthSeries, { MAX_KEYS } from './useBreadthSeries'
import { useDcFlags } from './flag'
import { buildOption } from './chartOption'
import { panelsFor } from './panels'
import { todayET, shiftISO } from '../sessionDates'
import { defaultSelectionFor } from './defaults'
import { coverageModel } from './coverage'
import { shouldSample } from './lttb'
import { shortOf, CHART_GROUPS } from '../chartMetrics'

const DEFAULT_WINDOW_DAYS = 90

/**
 * V2-3 · extended history presets (DC-2's "extended days choices").
 *
 * ⛔ THIS IS A NAVIGATION CONTROL, NOT PART OF "COVERAGE". The owner's ruling reads
 * "coverage absent → hidden, render == V2-2" — grammatically a qualifier on the word
 * "coverage" that precedes it (the bands + era note), not a claim that every V2-3 feature
 * must vanish whenever the CURRENT window has nothing to disclose. A reader should be
 * able to reach five years of history whether or not today's 90-day view happens to
 * contain a reconstructed session. So this renders unconditionally under v23, and
 * `v23Identity.test.jsx` tests the coverage-chrome claim at the OPTION level rather than
 * the whole tree, precisely because this control is meant to differ from V2-2 always.
 *
 * ⭐ `Max` is 2008-01-02 — the documented start of stored history (`01-audit.md`'s A-11:
 * "History reaches 2008-01-02"). Raised and reachable as of L-A/L-B (2026-09-17, D-054):
 * `BREADTH_SERIES_MAX_SESSIONS` and `useBreadthSeries.MAX_SESSIONS` both cover it now. A
 * preset the backend genuinely cannot serve is still not a dead end — it lands on the
 * EXISTING `s.tooWide` honest refusal below, which already says so in plain words.
 */
const MAX_HISTORY_FROM = '2008-01-02'
const EXTENDED_DAYS_PRESETS = [
  { label: '90d', days: DEFAULT_WINDOW_DAYS },   // V1's own default window
  { label: '1y', days: 365 },
  { label: '5y', days: 1825 },
  { label: 'Max', days: null },                  // MAX_HISTORY_FROM
]

export default function BreadthChartsV2({ keys, from, to }) {
  // Eastern, like every other session date in this programme (A-35).
  const today = todayET()
  const { v22, v23 } = useDcFlags()
  // ⛔ THE DEFAULT DEPENDS ON THE FLAG (D-052). V1's two percentage metrics are ONE unit
  // family, so V2-2's split produced a single panel on first load and the feature was
  // invisible to a member and to a reviewer. With V2-2 on, the default adds the most-used
  // non-percentage metric so the stack is visible immediately. ⛔ With it OFF the default
  // is V1's exactly — the flag-off path must not diverge by even one key.
  //
  // ⛔⛔ CONTROLLED VS UNCONTROLLED. A `keys` prop — every existing test, and any future
  // embedder that wants a fixed view — takes over the selection completely and hides the
  // picker below: nobody who explicitly asked for a set of keys wants a checkbox list
  // second-guessing them. The live, unwrapped mount (`BreadthCharts.jsx` renders
  // `<BreadthChartsV2 />` with no props at all) is the ONLY uncontrolled case, and it is
  // exactly the one that had no way to change the metrics at all — V1 ships a full
  // 6-group picker; V2 shipped none.
  const isControlled = keys !== undefined
  const [pickedKeys, setPickedKeys] = useState(() => defaultSelectionFor({ v22 }))
  const baseSelection = isControlled ? keys : pickedKeys
  // ⛔ THE ERA NOTE'S ONE-TAP SWAP (A-11) — kept as a layer OVER `baseSelection`, never
  // folded into it, so a day-range change (which does not touch `baseSelection`) keeps
  // the reader's swap, while a genuinely new `keys` prop (a different question) simply
  // stops matching `swap.from` and the layer becomes a no-op on its own.
  const [swap, setSwap] = useState(null) // { from, to } | null
  const selection = useMemo(
    () => (swap ? baseSelection.map(k => (k === swap.from ? swap.to : k)) : baseSelection),
    [baseSelection, swap],
  )
  // ⛔ `daysChoice` is IGNORED whenever a `from` prop is given — the same override
  // pattern `selection` uses above, so every existing test that pins an explicit window
  // keeps behaving exactly as it did before this control existed.
  const [daysChoice, setDaysChoice] = useState(DEFAULT_WINDOW_DAYS)
  const effectiveFrom = from ?? (daysChoice === null ? MAX_HISTORY_FROM
                                                      : shiftISO(today, -daysChoice))

  // ⛔ PANELS ARE DERIVED FROM `selection` — WHAT THE MEMBER PICKED — NEVER FROM THE
  // REQUEST. `universe_count` is injected into the WIRE REQUEST below (Q3/DC5: the era
  // note needs it in the ≤8 requested keys), and it must never leak into what gets
  // rendered: computing panels from the post-request key list would draw an uninvited
  // "Universe Count" panel the member never asked for the moment it rode along.
  const panels = useMemo(() => panelsFor(selection), [selection])

  // ⛔⛔ A-11 ERA NOTE WIRING (Q3/DC5, L-A "wire fields") — `universe_count` is a HELPER
  // FIELD for `coverageModel`'s era-note computation, not a chart series. It rides along
  // in the REQUEST only when v23 is on and the member's own selection already contains a
  // count-family panel (`unitOf(key) === UNIT.COUNT`, read here via `panels`, the same
  // test `coverageModel`'s own `countKeys` uses) — never added to `selection` itself,
  // and never counted against the member's own panel choices.
  //
  // ⛔ ONLY WHEN THERE IS ROOM. `/series` caps at `MAX_KEYS` (8); `seriesRequest` dedupes,
  // SORTS, then slices at 8 — so appending a 9th key does not necessarily drop ITSELF, it
  // can just as easily bump a member-selected metric that happens to sort after
  // "universe_count" alphabetically. That would silently swap a chosen panel for an
  // invisible helper field and mislabel the honest "not requested" state as the member's
  // own overreach. A full 8-panel selection simply does not get the era note — an honest
  // degradation, never a displaced panel.
  const hasCountPanel = panels.some(p => p.unit === 'count')
  const requestedKeys = (v23 && hasCountPanel && selection.length < MAX_KEYS
                          && !selection.includes('universe_count'))
    ? [...selection, 'universe_count']
    : selection
  const s = useBreadthSeries(requestedKeys, effectiveFrom, to ?? today)

  // Which unit families the reader has asked to see on a log scale.
  const [logPanels, setLogPanels] = useState(() => new Set())

  // ⚰️ LTTB USED TO PRE-PROCESS `s.dates`/`s.series` HERE, BEFORE COVERAGE AND THE OPTION
  // BOTH CONSUMED ITS OUTPUT. That is gone (D-053, see `lttb.js`'s module doc): ECharts'
  // OWN native `sampling` option downsamples each series' internal render data without
  // ever touching the shared category axis, so `chartOption.js` decides per-series
  // whether to ask for it — `coverage` and `option` below go straight back to reading
  // `s.dates`/`s.series` unchanged, exactly as they did before LTTB existed.
  // ⛔ Whether ANY series in this view is long enough to be sampled, purely for the
  // honest note below — gated on v23 (a V2-3 capability). ⭐ As of the 2026-09-17 cap
  // raise (L-A/L-B) this is REACHABLE, not structurally inert: MAX_SESSIONS is well past
  // `THRESHOLD_POINTS` (1,500), so the "5y" and "Max" presets actually cross it now.
  const isSampled = v23 && shouldSample(s.dates?.length)

  // ⛔⛔ V2-3's MODEL IS NULL WHENEVER IT HAS NOTHING HONEST TO SAY, and the option then
  // receives `coverage: null` and contributes no keys — so with coverage absent the
  // OPTION V2-3 builds is IDENTICAL to V2-2's. That equality is the owner's rail (scoped
  // to "coverage": bands + the era note — the extended-days picker below is a separate,
  // always-visible-under-v23 navigation control and is not part of this claim), and it
  // is structural here rather than a promise: there is no branch that draws empty chrome.
  const coverage = useMemo(() => {
    if (!v23 || !s.series || !s.dates?.length) return null
    return coverageModel({
      dates: s.dates,
      valuesByKey: s.series,
      // ⛔ `selection`, NOT `s.keys` — coverage bands are drawn per RENDERED panel; a
      // band for the injected `universe_count` helper key would shade a panel nobody
      // selected. `eraNote` still sees `universe_count` fine, via `valuesByKey` above.
      keys: selection,
      reconstructed: s.reconstructed,
      panels,
    })
  }, [v23, s.series, s.dates, selection, s.reconstructed, panels])

  const option = useMemo(() => {
    if (!v22 || !s.series || !s.dates?.length) return null
    return buildOption(s.dates, s.series, selection, { logPanels, coverage, allowSampling: v23 })
  }, [v22, v23, s.series, s.dates, selection, logPanels, coverage])

  // ⛔⛔ THE CANVAS IS INVISIBLE TO ASSISTIVE TECH — ECharts' canvas renderer
  // carries no series names, no values, and no legend (`chartOption.js` turns
  // the real legend off on purpose; identity is carried by end-labels drawn
  // INTO the canvas, which a screen reader cannot read either). A member using
  // one gets nothing at all from this chart today. This gives them two things:
  // a one-line summary always present as the chart's own accessible name, and
  // a real `<table>` alternative — the `dataviz` skill's own non-negotiable —
  // behind a toggle so it never dumps years of rows into the page by default.
  const chartSummary = useMemo(() => {
    if (!panels.length || !s.dates?.length) return ''
    const seriesLabels = selection.map(shortOf).join(', ')
    return `Line chart with ${panels.length} panel${panels.length === 1 ? '' : 's'}: `
      + `${seriesLabels}. ${s.dates.length} sessions, `
      + `${s.dates[0]} to ${s.dates[s.dates.length - 1]}. `
      + 'A data table with the same values is available via the "View as table" button.'
  }, [panels.length, selection, s.dates])
  const [showTable, setShowTable] = useState(false)

  // ⛔ Metric picker (uncontrolled mode only — see `isControlled` above).
  const [expandedGroups, setExpandedGroups] = useState({})
  function toggleMetricGroup(group) {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }
  function togglePickedKey(key) {
    setPickedKeys(prev => {
      if (prev.includes(key)) {
        const next = prev.filter(k => k !== key)
        // ⛔ Never drop to zero — an empty selection has nothing to draw, and
        // "the chart just vanished" is a worse reading than a disabled checkbox.
        return next.length ? next : prev
      }
      // ⛔ `/series` caps at MAX_KEYS. Silently bumping an existing pick to
      // make room would be a surprise; refusing the ADD and saying so (via
      // `v2-picker-full` below) is the honest version of the same limit
      // `chartOption.js`'s own log-refusal and A-11's universe_count-room
      // check already apply elsewhere in this file.
      if (prev.length >= MAX_KEYS) return prev
      return [...prev, key]
    })
  }

  function toggleLog(unit) {
    setLogPanels(prev => {
      const next = new Set(prev)
      if (next.has(unit)) next.delete(unit)
      else next.add(unit)
      return next
    })
  }

  return (
    <section data-testid="breadth-charts-v2" aria-label="Data Charts V2">
      <h2>Data Charts V2</h2>

      {/* ⛔⛔ THE METRIC PICKER — uncontrolled mount only (see `isControlled`).
          V1 ships a full 6-group picker; the live V2 mount shipped with none
          at all, so a member could see only the 3-metric default forever. */}
      {!isControlled && (
        <div data-testid="v2-metric-picker">
          <div data-testid="v2-metric-group-buttons">
            {CHART_GROUPS.map(g => {
              const selectedInGroup = g.metrics.filter(m => baseSelection.includes(m.key)).length
              return (
                <button
                  key={g.group}
                  type="button"
                  aria-expanded={Boolean(expandedGroups[g.group])}
                  aria-controls={`v2-metric-group-${g.group.replace(/[^a-z0-9]+/gi, '-')}`}
                  data-testid={`v2-metric-group-toggle-${g.group}`}
                  onClick={() => toggleMetricGroup(g.group)}
                >
                  {g.group}{selectedInGroup > 0 ? ` (${selectedInGroup})` : ''}
                </button>
              )
            })}
          </div>
          {baseSelection.length >= MAX_KEYS && (
            <p role="status" data-testid="v2-picker-full">
              Up to {MAX_KEYS} metrics at a time — remove one to add another.
            </p>
          )}
          {CHART_GROUPS.map(g => expandedGroups[g.group] && (
            <div
              key={g.group}
              id={`v2-metric-group-${g.group.replace(/[^a-z0-9]+/gi, '-')}`}
              data-testid={`v2-metric-group-${g.group}`}
            >
              {g.metrics.map(m => {
                const checked = baseSelection.includes(m.key)
                return (
                  <label key={m.key}>
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

      {v23 && (
        // ⭐ Unconditional under v23 — see the note on EXTENDED_DAYS_PRESETS. A member
        // reaches five years of history whether or not TODAY'S view has anything to
        // disclose; hiding it behind "is there something to disclose right now" would
        // make the control impossible to discover on a quiet window.
        <div data-testid="v2-extended-days">
          {EXTENDED_DAYS_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              aria-pressed={daysChoice === p.days}
              data-testid={`v2-days-${p.label}`}
              onClick={() => setDaysChoice(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {s.tooWide && (
        // ⭐ NOT an error. The app knows this range cannot be served yet — the reader
        // behind it costs ~55 s cold (D-042) — so it says so in those words rather than
        // asking and rendering a 400.
        <p role="status" data-testid="v2-range-refused">
          Range not yet available — up to {s.maxSessions} sessions for now.
        </p>
      )}

      {s.dropped.length > 0 && (
        <p role="status" data-testid="v2-keys-dropped">
          Showing the first {s.keys.length} metrics; {s.dropped.length} not requested.
        </p>
      )}

      {!s.tooWide && s.isLoading && <p role="status">Loading…</p>}

      {!s.tooWide && s.error && (
        <p role="alert" data-testid="v2-error">
          Series unavailable ({s.error.status || 'error'}).
        </p>
      )}

      {s.missing.length > 0 && (
        // ⛔ A requested key the row schema does not hold is REPORTED, never dropped.
        // Silently omitting it renders "we do not store this" as "this was flat".
        <p role="status" data-testid="v2-missing">
          Not held: {s.missing.join(', ')}
        </p>
      )}

      {s.reconstructed.length > 0 && (
        <p data-testid="v2-reconstructed">
          {s.reconstructed.length} reconstructed session(s) in this range.
        </p>
      )}

      {option && (
        <>
          {/* ⛔ A LOG CONTROL THAT DID NOTHING MUST SAY WHY. ECharts drops non-positive
              points from a log axis and draws a confident line through the rest, so a
              silent refusal is silent data loss. */}
          {panels.length > 0 && (
            <div data-testid="v2-log-toggles">
              {panels.map(p => (
                <button
                  key={p.unit}
                  type="button"
                  aria-pressed={logPanels.has(p.unit)}
                  data-testid={`v2-log-${p.unit}`}
                  onClick={() => toggleLog(p.unit)}
                >
                  {p.label} · log
                </button>
              ))}
            </div>
          )}
          {option.__refusals.map(r => (
            <p key={r.unit} role="status" data-testid={`v2-log-refused-${r.unit}`}>
              {r.reason}
            </p>
          ))}
          {isSampled && (
            // ⛔ HONEST ABOUT THE DOWNSAMPLE, EVEN THOUGH IT SHOWS ONLY REAL POINTS.
            // A-10's whole point is that a reader must know what they are looking at.
            // ⚰️ This used to state an exact "N of M points" — possible when the client
            // did its own re-slicing, impossible now that ECharts decides the actual
            // count internally, dynamically, per zoom level. The claim is scoped to what
            // is actually knowable from here.
            <p role="status" data-testid="v2-sampled">
              Some points are combined for readability on this range — zoom in to see
              every session; every point drawn is a real reading.
            </p>
          )}
          {coverage?.era && (
            // A-11 "Era comparability" (01-audit.md:309-311). ⛔ The numbers are the
            // WINDOW'S OWN — the audit's 1,521 → 2,648 is illustrative, and pasting it
            // would be a second authority over a value the data already holds.
            <p role="status" data-testid="v2-era-note">
              {coverage.era.text}
              {coverage.era.swap && (
                // ⛔⛔ WAS UNWIRED — `eraNote()` computed the right {from,to} pair
                // (coverage.test.js proved that) and the click handler was never added,
                // so the button did nothing. `setSwap` is the layer above; once applied,
                // `hi_ratio`'s own unit (PCT) moves it out of the count panel, so this
                // very note's own precondition (a count panel present) stops holding and
                // the note honestly disappears on its own next render — no second control
                // needed to "undo" it.
                <button
                  type="button"
                  data-testid="v2-era-swap"
                  onClick={() => setSwap(coverage.era.swap)}
                >
                  Use %
                </button>
              )}
            </p>
          )}
          <button
            type="button"
            data-testid="v2-table-toggle"
            aria-expanded={showTable}
            aria-controls="v2-data-table"
            onClick={() => setShowTable(v => !v)}
          >
            {showTable ? 'Hide data table' : 'View as table'}
          </button>

          {/* ⛔ `role="img"` deliberately flattens the interactive canvas subtree
              for assistive tech — there is nothing accessible inside it to walk
              into, and the real content is the table above/below this toggle. */}
          <div role="img" aria-label={chartSummary}>
            <ReactECharts
              option={option}
              style={{ height: Math.max(320, panels.length * 190), width: '100%' }}
              notMerge
              lazyUpdate
            />
          </div>

          {showTable && (
            <div data-testid="v2-data-table-wrap" style={{ overflowX: 'auto' }}>
              <table id="v2-data-table" data-testid="v2-data-table">
                <caption>{chartSummary}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {selection.map(key => <th scope="col" key={key}>{shortOf(key)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {s.dates.map((date, i) => (
                    <tr key={date}>
                      <th scope="row">{date}</th>
                      {selection.map(key => (
                        <td key={key}>{formatTableValue(s.series[key]?.[i])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!option && s.series && (
        // The V2-1 diagnostic list, still the view when V2-2 is off — it is what proved
        // the read path end to end and it stays reachable until V2-2 is everyone's.
        <ul data-testid="v2-series">
          {Object.entries(s.series).map(([key, values]) => (
            <li key={key} data-testid={`v2-series-${key}`}>
              {key}: {values.length} points,{' '}
              {/* ⭐ a null is an ABSENT reading, never a zero — counted, so the shell can
                  prove the hook passed them through rather than coercing them. */}
              {values.filter(v => v === null).length} absent
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The table's own honest-absence convention: a null reading is an em dash,
 *  never a zero — the same rule the V2-1 diagnostic list above already keeps. */
function formatTableValue(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
