/**
 * Data Charts V2 — the SHELL (V2-1). Dark behind `VITE_BREADTH_CHARTS_V2_ENABLED`.
 *
 * What this is: the read path and its honest states, wired end to end. What it is NOT,
 * yet: a chart. V2-1 exists so the next increment draws against a data path that has
 * already been proved — the repo's recurring defect is the opposite order (eight features
 * built, tested, green, and connected to nothing).
 *
 * ⛔ NO STYLING ON PURPOSE. A dark shell that nobody can reach does not need a theme, and
 * adding tokens now would put `--v2-*` custom properties into every theme island before a
 * single pixel is designed. Markup first, styling with the chart.
 */
import useBreadthSeries from './useBreadthSeries'
import { todayET, shiftISO } from '../sessionDates'

/** V1's own default selection and window, so the two shells open on the same view. */
const DEFAULT_KEYS = ['breadth_score', 'pct_above_50sma']
const DEFAULT_WINDOW_DAYS = 90

export default function BreadthChartsV2({ keys = DEFAULT_KEYS, from, to }) {
  // Eastern, like every other session date in this programme (A-35).
  const today = todayET()
  const s = useBreadthSeries(keys, from ?? shiftISO(today, -DEFAULT_WINDOW_DAYS), to ?? today)

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

      {s.series && (
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

      {s.reconstructed.length > 0 && (
        <p data-testid="v2-reconstructed">
          {s.reconstructed.length} reconstructed session(s) in this range.
        </p>
      )}
    </section>
  )
}
