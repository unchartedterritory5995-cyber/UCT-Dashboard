import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from '../ResearchPage.module.css'

// TERM-073 (FB-A4-01) — what changed in the nightly analyst pass, per ticker.
//
// ⛔ DARK: the endpoint answers 404 until ANALYST_REVISIONS_ENABLED is set, and a
// 404 renders NOTHING here — the tab looks exactly as it did.
// ⛔ AN UNCHANGED RUN IS "NO REVISION", never a flat line implying coverage.
// ⛔ THE METHOD SHIPS WITH THE NUMBER: window, snapshot count, source, and the
// contributor note (the pass does not retain an analyst count, and says so).

function fmtValue(field, v) {
  if (v == null || v === '') return '—'
  if (field === 'pt_target') return `$${Number(v).toFixed(2)}`
  if (field === 'eps_next_y_growth') return `${(Number(v) * 100).toFixed(1)}%`
  return String(v)
}

export default function AnalystRevisions({ sym }) {
  const key = sym ? `/api/research/analyst-revisions/${encodeURIComponent(sym)}` : null
  const { data, error } = useSWR(key, sectionFetcher, { revalidateOnFocus: false })

  if (!key || error?.status === 404 || data?.paywalled) return null
  if (error) {
    return (
      <section className={styles.card} data-testid="analyst-revisions">
        <div className={styles.fnote}>Couldn&rsquo;t load the analyst revision history.</div>
      </section>
    )
  }
  if (!data) return null

  const { status, window, observations, revisions, fields, source, contributors_note } = data
  const span = window ? `${window.first} – ${window.last}` : null

  return (
    <section className={styles.card} data-testid="analyst-revisions">
      <div className={styles.muted} style={{ marginBottom: 6 }}>Analyst revisions</div>
      {status === 'no_history' && (
        <div data-testid="revisions-status">
          Not enough history yet — {observations} nightly snapshot{observations === 1 ? '' : 's'} retained
          {span ? ` (${span})` : ''}; a revision needs two.
        </div>
      )}
      {status === 'no_revision' && (
        <div data-testid="revisions-status">
          No revision across {observations} nightly snapshots ({span}).
        </div>
      )}
      {status === 'revised' && (
        <ul data-testid="revisions-list" style={{ margin: 0, paddingLeft: 16 }}>
          {revisions.slice().reverse().map((r) => (
            <li key={`${r.from_date}-${r.to_date}`}>
              <span className={styles.muted}>{r.from_date} → {r.to_date}: </span>
              {Object.entries(r.changes).map(([f, c], i) => (
                <span key={f}>
                  {i > 0 ? '; ' : ''}{fields?.[f] || f} {fmtValue(f, c.from)} → {fmtValue(f, c.to)}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.muted} data-testid="revisions-method" style={{ marginTop: 6 }}>
        {span ? `Window ${span}, ${observations} snapshots. ` : ''}Source: {source}. {contributors_note}
      </div>
    </section>
  )
}
