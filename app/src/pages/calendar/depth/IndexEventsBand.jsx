import useSWR from 'swr'
import { depthFetcher } from '../../research/depth/depthFetch'
import styles from './CalendarDepth.module.css'

// D-3 (Lane R): index-rebalance dates on the calendar. DARK behind
// INDEX_REBALANCE_EVENTS_ENABLED.
//
// ⛔ No provider we pay for returns these dates, so every row is RULE-DERIVED and
//    says so in words ("from the index's published rule, not an announced date"),
//    with the rule and its citation one tap away. A rule date that falls on an
//    exchange holiday says the real date will differ.
// ⛔ The indexes we do NOT derive are named, with why, so their absence is never
//    read as "no Russell event coming".

export const LOOKAHEAD_DAYS = 120

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtDay(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function Row({ e }) {
  return (
    <li data-testid="index-event-row" title={`Rule: ${e.rule}. ${e.notice}. Source: ${e.citation}`}>
      <strong>{fmtDay(e.date)}</strong> · {e.index} {e.event.toLowerCase()}{' '}
      <span className={styles.chip}>(from the index&apos;s published rule, not an announced date)</span>
      {e.calendar_note && <span className={styles.error}> {e.calendar_note}</span>}
    </li>
  )
}

export default function IndexEventsBand({ weekStart, weekEnd }) {
  const end = weekStart ? addDays(weekStart, LOOKAHEAD_DAYS) : null
  const key = weekStart ? `/api/calendar/index-events?start=${weekStart}&end=${end}` : null
  const { data, error } = useSWR(key, depthFetcher, { revalidateOnFocus: false })

  let body
  if (!weekStart) return null
  if (error) body = <span className={styles.error} data-testid="index-events-unavailable">Index dates could not be read right now.</span>
  else if (!data) body = <span className={styles.chip}>Reading index dates…</span>
  else if (data.paywalled) body = <span className={styles.chip}>Index dates require a paid plan.</span>
  else {
    const evs = data.events || []
    const lastDay = weekEnd || addDays(weekStart, 6)
    const thisWeek = evs.filter(e => e.date >= weekStart && e.date <= lastDay)
    const next = evs.find(e => e.date > lastDay)
    body = (
      <>
        {thisWeek.length > 0
          ? <ul className={styles.list} data-testid="index-events-this-week">{thisWeek.map(e => <Row key={`${e.date}-${e.index}`} e={e} />)}</ul>
          : (
            <span className={styles.chip} data-testid="index-events-none-this-week">
              None this week{next ? '. Next:' : ` or in the next ${LOOKAHEAD_DAYS} days.`}
            </span>
          )}
        {thisWeek.length === 0 && next && (
          <ul className={styles.list} data-testid="index-events-next"><Row e={next} /></ul>
        )}
        {(data.not_covered || []).length > 0 && (
          <p className={styles.muted} data-testid="index-events-not-covered">
            Not shown: {data.not_covered.map(n => `${n.index} (${n.reason})`).join(' ')}
          </p>
        )}
      </>
    )
  }
  return (
    <div className={styles.strip} data-testid="index-events-band">
      <span className={styles.title}>Index rebalances</span> {body}
    </div>
  )
}
