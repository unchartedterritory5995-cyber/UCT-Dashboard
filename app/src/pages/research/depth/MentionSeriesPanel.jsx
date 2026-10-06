import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'

// FT-080 — room attention per ticker, from the /buzz mention store. A research
// panel, not a chart overlay. DARK behind MENTION_SERIES_ENABLED.
//
// ⛔ A day before the store existed, or a day the whole room was silent, is "—",
//    never 0.
// ⛔ Polarity (positive/negative) is unavailable and the panel says why: the
//    store keeps no message text by design.

const num = (v) => (v == null ? '—' : String(v))
const LABEL = { before_store: 'before the store', room_silent: 'room silent' }

export default function MentionSeriesPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `/api/research/mention-series/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })

  let body
  if (error) body = <div className={styles.error} data-testid="mentions-unavailable">Room attention is unavailable right now. That is a gap in what we could read, not a finding about {s}.</div>
  else if (!data) body = <div className={styles.note}>Loading room attention…</div>
  else if (data.paywalled) body = <div className={styles.note}>Room attention requires a paid plan.</div>
  else if (data.state !== 'ok') body = <div className={styles.note} data-testid="mentions-state">{memberSentence(data.reason)}</div>
  else {
    const sm = data.summary || {}
    const recent = [...(data.points || [])].reverse().slice(0, 14)
    body = (
      <div data-testid="mentions">
        <p className={styles.lede} data-testid="mentions-summary">
          Last {sm.last7_days} measured days: {num(sm.last7_avg_mentions)} mentions a day ({num(sm.last7_avg_share_pct)}% of the room);
          {' '}the {sm.prior30_days} before: {num(sm.prior30_avg_mentions)} a day ({num(sm.prior30_avg_share_pct)}%).
          {' '}{sm.mentions_total} mentions over {sm.days_measured} measured days since {data.window.from > data.window.store_from ? data.window.from : data.window.store_from} (ET).
        </p>
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead><tr><th scope="col">Day (ET)</th><th scope="col">Mentions</th><th scope="col">People</th><th scope="col">Share of room</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.date} data-testid="mentions-row">
                  <th scope="row">{p.date}</th>
                  {p.state === 'ok'
                    ? <><td>{p.mentions}</td><td>{p.people}</td><td>{p.share_pct}%</td></>
                    : <td colSpan={3}>— ({LABEL[p.state] || p.state})</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted} data-testid="mentions-polarity">Positive/negative sentiment: unavailable, because {memberText(data.polarity?.reason)}.</p>
        <p className={styles.muted}>Source: {memberText(data.source)}.</p>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="mentions-panel">
      <h3 className={styles.panelTitle}>Room attention (#main-chat)</h3>
      {body}
    </section>
  )
}
