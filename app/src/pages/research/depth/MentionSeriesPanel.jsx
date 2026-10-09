import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading, DepthBadRequest } from './depthChrome'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'
import PanelCommand from '../../../components/terminal/PanelCommand'
import { formatPercentAsSent } from '../../../lib/presentation/presentationPrimitives'

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
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/mention-series/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header when it is the
  // whole panel (a DPTH stack names "several" itself); a no-op outside the terminal.
  usePanelFreshness(chrome.alone && data && !data.paywalled && !data.badRequest && !error
    ? { source: memberText(data.source) || null, age: { dataClass: 'end_of_day', asOfDate: data.window?.through || data.points?.[data.points.length - 1]?.date || null } }
    : null)

  let body
  if (error) body = <div className={styles.error} data-testid="mentions-unavailable">Room attention is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading room attention" />
  else if (data.paywalled) body = <div className={styles.note}>Room attention requires a paid plan.</div>
  else if (data.badRequest) body = <DepthBadRequest sentence={memberSentence(data.badRequest)} />
  else if (data.state !== 'ok') body = <div className={styles.note} data-testid="mentions-state">{memberSentence(data.reason) || `Room attention for ${s} is not available right now.`}</div>
  else if (!data.summary?.days_measured) {
    // state ok with nothing measured rendered "Last 0 measured days: — mentions a day"
    body = <div className={styles.note} data-testid="mentions-none-measured">No days of #main-chat have been measured for {s} in this window yet.</div>
  } else {
    const sm = data.summary || {}
    const recent = [...(data.points || [])].reverse().slice(0, 14)
    body = (
      <div data-testid="mentions">
        <p className={styles.lede} data-testid="mentions-summary">
          Last {sm.last7_days} measured {sm.last7_days === 1 ? 'day' : 'days'}: {num(sm.last7_avg_mentions)} mentions a day ({formatPercentAsSent(sm.last7_avg_share_pct)} of the room)
          {/* No earlier measured day: say so, not "the 0 before: — a day (—)" (audit 2026-10-08). */}
          {sm.prior30_days
            ? <>; the {sm.prior30_days} before: {num(sm.prior30_avg_mentions)} a day ({formatPercentAsSent(sm.prior30_avg_share_pct)}).</>
            : '; no earlier measured day to compare with yet.'}
          {' '}{sm.mentions_total} mentions over {sm.days_measured} measured days since {data.window.from > data.window.store_from ? data.window.from : data.window.store_from} (ET).
        </p>
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label="Room attention (#main-chat)">
            <thead><tr><th scope="col">Day (ET)</th><th scope="col">Mentions</th><th scope="col">People</th><th scope="col">Share of room</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.date} data-testid="mentions-row">
                  {/* Wave 3 (#3): in a terminal panel a day opens this name's news (CN) beside it. */}
                  <th scope="row">
                    {p.state === 'ok' && p.mentions > 0
                      ? <PanelCommand cmd={`${s} CN`} label={`Open ${s} company news for the ${p.date} spike`}>{p.date}</PanelCommand>
                      : p.date}
                  </th>
                  {p.state === 'ok'
                    ? <><td>{p.mentions}</td><td>{p.people}</td><td>{formatPercentAsSent(p.share_pct)}</td></>
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
    <section className={chrome.panelClass} data-testid="mentions-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Room attention (#main-chat)</h3>}
      {body}
    </section>
  )
}
