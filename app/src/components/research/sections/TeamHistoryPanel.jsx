// app/src/components/research/sections/TeamHistoryPanel.jsx
//
// "Team history": every time the UCT team mentioned or called this ticker in the TSDR archive,
// newest first, with the setup, the action and what happened next. Mounted on the chart's
// Company Panel (Overview tab) and the Research History tab. Reads
// GET /api/wisdom/archive/ticker/{sym}/team-history (api/services/wisdom/archive/team_history.py).
//
// ⛔ THE SERVER IS THE ONE AUTHORITY on which calls carry an outcome. A call 20 sessions old or
// younger arrives with `outcome: null` and `outcome_status: "pending"` (the archive's own aging
// rule, provider.is_aged); this panel never computes an age and never shows a number the server
// withheld. No price level ever reaches it.
// ⛔ DARK: nothing is fetched unless the auth payload carries wisdom_ticker_history_enabled and the
// viewer is paid. It reads AuthContext with useContext (not useAuth) so a surface rendered without
// an AuthProvider (a chart in a test, an embed) renders nothing instead of throwing.
// ⛔ A failed read renders nothing: "the team never mentioned it" is only said from a real, empty
// answer.
import { useContext, useState } from 'react'
import useSWR from 'swr'

import { AuthContext } from '../../../context/AuthContext'
import { ARCHIVE_API, dayOf, fmtR, rTone } from '../../../utils/traderArchive'
import { sectionFetcher } from './sectionFetch'
import styles from './TeamHistoryPanel.module.css'

/** Rows shown before "Show all". */
export const FIRST_ROWS = 12

export const teamHistoryKey = (sym) => {
  const s = (sym || '').toUpperCase().trim()
  return s ? `${ARCHIVE_API}/ticker/${encodeURIComponent(s)}/team-history` : null
}

const SWR_OPTS = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })

/** 'flag_htf' -> 'Flag htf' when the server sent no display name. */
function setupLabel(row) {
  const raw = row?.setup_name || row?.setup
  if (!raw) return null
  const s = String(raw).replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null
}

/** The outcome line for one row, as text plus tones. Exported for tests. */
export function outcomeParts(row) {
  if (row?.kind !== 'call') return null
  if (row.outcome_status === 'pending' || !row.outcome_status) {
    return { pending: true, text: 'Outcome pending: under 20 sessions old' }
  }
  if (row.outcome_status === 'unscored' || !row.outcome) return { pending: true, text: 'Not scored' }
  const parts = []
  if (row.outcome.r5 !== undefined && row.outcome.r5 !== null) parts.push({ label: '5d', value: row.outcome.r5 })
  if (row.outcome.r20 !== undefined && row.outcome.r20 !== null) parts.push({ label: '20d', value: row.outcome.r20 })
  return parts.length ? { pending: false, parts } : { pending: true, text: 'Not scored' }
}

function Outcome({ row }) {
  const o = outcomeParts(row)
  if (!o) return null
  if (o.pending) return <span className={styles.pending} data-testid="team-history-pending">{o.text}</span>
  return (
    <span className={styles.outcome} data-testid="team-history-outcome">
      {o.parts.map((p) => {
        const tone = rTone(p.value)
        return (
          <span key={p.label} className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>
            {p.label} {fmtR(p.value)}
          </span>
        )
      })}
    </span>
  )
}

function Row({ row }) {
  const setup = setupLabel(row)
  const what = row.kind === 'call'
    ? [setup, row.action, row.direction].filter(Boolean).join(' · ') || 'Call'
    : `Mentioned${row.record_type ? ` (${String(row.record_type).toLowerCase()} post)` : ''}`
  return (
    <li className={styles.item} data-testid="team-history-row">
      <div className={styles.meta}>
        <span className={styles.date}>{dayOf(row.date) || '—'}</span>
        <span className={styles.trader}>{row.trader || 'Unknown'}</span>
        <span className={`${styles.kind} ${row.kind === 'call' ? styles.kindCall : ''}`}>
          {row.kind === 'call' ? 'Call' : 'Mention'}
        </span>
      </div>
      <div className={styles.line}>
        <span className={styles.what}>{what}</span>
        <Outcome row={row} />
        {row.moment?.url && (
          <a className={styles.link} href={row.moment.url} title={row.moment.label || undefined}
             data-testid="team-history-moment">Watch the moment</a>
        )}
      </div>
    </li>
  )
}

export default function TeamHistoryPanel({ sym }) {
  const auth = useContext(AuthContext)
  const armed = auth?.wisdomTickerHistoryEnabled === true && auth?.isPaid === true
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(armed ? teamHistoryKey(s) : null, sectionFetcher, SWR_OPTS)
  const [all, setAll] = useState(false)
  // sectionFetcher turns a 402 into {paywalled: true}, and a body without a rows list is not an
  // answer: neither may read as "the team has no posts".
  if (!armed || !s || error || !data || data.paywalled || !Array.isArray(data.rows)) return null
  const rows = data.rows
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)

  return (
    <section className={styles.wrap} data-testid="team-history" aria-labelledby="team-history-h">
      <h3 id="team-history-h" className={styles.heading}>Team history</h3>
      {rows.length === 0 ? (
        <p className={styles.summary} data-testid="team-history-empty">
          The team has no archived posts about {data.ticker || s}.
        </p>
      ) : (
        <>
          <p className={styles.summary} data-testid="team-history-summary">
            {data.n_calls} {data.n_calls === 1 ? 'call' : 'calls'} · {data.n_mentions}{' '}
            {data.n_mentions === 1 ? 'mention' : 'mentions'}
            {data.n_scored ? ` · ${data.n_scored} scored` : ''}
          </p>
          <ul className={styles.list}>
            {shown.map((r) => <Row key={`${r.kind}:${r.id}`} row={r} />)}
          </ul>
          {rows.length > FIRST_ROWS && (
            <button type="button" className={styles.more} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
      <p className={styles.footer}>
        Historical posts by the UCT team. Outcomes are the 5- and 20-session move after the call, shown only
        once a call is more than {data.age_sessions || 20} sessions old. Not advice.
      </p>
    </section>
  )
}
