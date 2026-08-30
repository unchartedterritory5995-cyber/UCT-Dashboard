// app/src/pages/dashboard/TheWeek.jsx
//
// Zone B's WEEKEND hero. The dashboard used to render its weekday
// composition on a Saturday, so the hero showed "Markets are closed" beside
// an 849px dead column. Every panel here reads an endpoint that already
// exists; a panel with no data is omitted so the zone is never an empty frame.
//
// ⛔ REAL SHAPE, not the brief's assumed one:
//   - GET /api/desk/articles  → {articles: [...]}  (matches the brief)
//   - GET /api/calendar       → {week_start, week_end, days: {DATE: {label,
//     day, is_today, bmo:[], amc:[], tbd:[], econ:[], fed:[]}}, source,
//     is_current_week}. There is NO top-level `events` array — verified
//     against api/routers/calendar.py's `_get_calendar_payload`/`_empty_day`.
//     Earnings chips live under each day's bmo/amc/tbd buckets and carry a
//     `sym` field (api/routers/calendar.py::_chip), never `symbol`/`title`.
//   - No `?week=` param is needed: `_current_week_monday` already rolls a
//     weekend date forward to the UPCOMING week's Monday (calendar.py,
//     "a member who opens the calendar on a Saturday sees the UPCOMING
//     week"), so the bare /api/calendar call already IS "next week on deck"
//     when this component is on screen (WEEKEND state only).
//   - Article link routing mirrors the existing convention in
//     ArticlesSection.jsx: an internal `/desk/article/{slug}` reader link
//     only when `has_body && slug`; otherwise the external `url`.
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../../components/TileCard'
import styles from './TheWeek.module.css'
// ⛔ CARRIED FIX (was `fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)`):
// that shape collapses a 402/500/network error into the same `null` as "no
// content published this week" — a desk outage would render as a quiet
// week, indistinguishable from the genuine empty state. jsonFetcher throws
// on any non-ok response instead; this component doesn't read the SWR
// `error` it produces, so both a real outage and a real empty week land on
// `data === undefined` and every panel below already omits itself when its
// slice of `data` is missing — same degrade-to-absence behaviour, minus the
// silent misclassification. See utils/jsonFetcher.js for the error contract.
import fetcher from '../../utils/jsonFetcher'

function ArticleLink({ article, className }) {
  const { title, slug, has_body, url } = article
  if (has_body && slug) {
    return <Link to={`/desk/article/${slug}`} className={className}>{title}</Link>
  }
  return <a href={url || '#'} target="_blank" rel="noreferrer" className={className}>{title}</a>
}

export default function TheWeek() {
  const { data: desk } = useSWR('/api/desk/articles?limit=12', fetcher)
  const { data: cal } = useSWR('/api/calendar', fetcher)

  const articles = desk?.articles ?? []
  const scan = articles.find(a => (a.slug || '').startsWith('sunday-scans-'))
  const reading = articles.filter(a => a !== scan).slice(0, 4)

  const days = cal?.days ?? {}
  const onDeck = Object.keys(days)
    .sort()
    .flatMap(ds => {
      const d = days[ds] || {}
      return [...(d.bmo || []), ...(d.amc || []), ...(d.tbd || [])]
    })
    .filter(e => e && e.sym)
    .slice(0, 6)

  // 🔴 CARRIED FIX — AN EMPTY LABELLED FRAME IS THE DEFECT, NOT THE FIX FOR IT.
  // Every panel below already omits itself when its slice of data is missing,
  // but with all three missing this still rendered a "The Week" TileCard
  // header over an empty grid: the whole-component version of the 849px dead
  // column this hero exists to replace. Nothing to say is said by saying
  // nothing. Zone B's `.zoneB:empty { display: none }` collapses the zone
  // around this null so no 440px void is left behind either.
  //
  // ⛔ THIS IS ALSO THE OUTAGE PATH. `jsonFetcher` throws on a non-ok
  // response, so a 402/500 leaves both `desk` and `cal` undefined and lands
  // here — degrading to absence rather than to a labelled empty box. SWR
  // still retries on the thrown error, so a transient failure heals into
  // content (rail: TheWeek.errors.test.jsx).
  if (!scan && onDeck.length === 0 && reading.length === 0) return null

  return (
    <TileCard title="The Week" icon="calendar">
      <div className={styles.grid}>
        {scan && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Latest Sunday Scan</h3>
            <ArticleLink article={scan} className={styles.lead} />
          </section>
        )}
        {onDeck.length > 0 && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Next week on deck</h3>
            <ul className={styles.list}>
              {onDeck.map((e, i) => <li key={`${e.sym}-${i}`}>{e.sym}</li>)}
            </ul>
          </section>
        )}
        {reading.length > 0 && (
          <section className={styles.panel}>
            <h3 className={styles.h}>From the Desk</h3>
            <ul className={styles.list}>
              {reading.map(a => (
                <li key={a.slug || a.id}><ArticleLink article={a} /></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </TileCard>
  )
}
