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
import useBreadthSeries from './useBreadthSeries'
import { useDcFlags } from './flag'
import { buildOption } from './chartOption'
import { panelsFor } from './panels'
import { todayET, shiftISO } from '../sessionDates'
import { defaultSelectionFor } from './defaults'
import { coverageModel } from './coverage'

const DEFAULT_WINDOW_DAYS = 90

export default function BreadthChartsV2({ keys, from, to }) {
  // Eastern, like every other session date in this programme (A-35).
  const today = todayET()
  const { v22, v23 } = useDcFlags()
  // ⛔ THE DEFAULT DEPENDS ON THE FLAG (D-052). V1's two percentage metrics are ONE unit
  // family, so V2-2's split produced a single panel on first load and the feature was
  // invisible to a member and to a reviewer. With V2-2 on, the default adds the most-used
  // non-percentage metric so the stack is visible immediately. ⛔ With it OFF the default
  // is V1's exactly — the flag-off path must not diverge by even one key.
  const selection = keys ?? defaultSelectionFor({ v22 })
  const s = useBreadthSeries(selection, from ?? shiftISO(today, -DEFAULT_WINDOW_DAYS), to ?? today)

  // Which unit families the reader has asked to see on a log scale.
  const [logPanels, setLogPanels] = useState(() => new Set())
  const panels = useMemo(() => panelsFor(s.keys ?? []), [s.keys])

  // ⛔⛔ V2-3's MODEL IS NULL WHENEVER IT HAS NOTHING HONEST TO SAY, and the option then
  // receives `coverage: null` and contributes no keys — so with coverage absent the
  // rendered tree is IDENTICAL to V2-2's. That equality is the owner's rail, and it is
  // structural here rather than a promise: there is no branch that draws empty chrome.
  const coverage = useMemo(() => {
    if (!v23 || !s.series || !s.dates?.length) return null
    return coverageModel({
      dates: s.dates,
      valuesByKey: s.series,
      keys: s.keys,
      reconstructed: s.reconstructed,
      panels,
    })
  }, [v23, s.series, s.dates, s.keys, s.reconstructed, panels])

  const option = useMemo(() => {
    if (!v22 || !s.series || !s.dates?.length) return null
    return buildOption(s.dates, s.series, s.keys, { logPanels, coverage })
  }, [v22, s.series, s.dates, s.keys, logPanels, coverage])

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
          {coverage?.era && (
            // A-11 "Era comparability" (01-audit.md:309-311). ⛔ The numbers are the
            // WINDOW'S OWN — the audit's 1,521 → 2,648 is illustrative, and pasting it
            // would be a second authority over a value the data already holds.
            <p role="status" data-testid="v2-era-note">
              {coverage.era.text}
              {coverage.era.swap && (
                <button type="button" data-testid="v2-era-swap">Use %</button>
              )}
            </p>
          )}
          <ReactECharts
            option={option}
            style={{ height: Math.max(320, panels.length * 190), width: '100%' }}
            notMerge
            lazyUpdate
          />
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
