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
//   - GET /api/j2/accounts/{id}/coach/weekly-reviews
//     -> {reviews: [{id, body, summary, metadata, feedback, created_at}]},
//     NEWEST FIRST (coach.py::list_weekly_reviews ORDERs by created_at DESC),
//     and the week lives at `metadata.week_start` — verified by reading
//     api/routers/journal_two.py + api/services/journal_two/coach.py. There is
//     no top-level `week_start`; `CompassReview.jsx` reads
//     `review.week_start || review.metadata?.week_start` and this mirrors that
//     rather than inventing a second field path.
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
// ⭐ THE QUOTE'S FIRST-CLASS HOME (spec, Zone A): "It becomes a first-class
// element of the WEEKEND state, where there is room for it." Zone A demotes it
// to one line every day; here, on the only state with space, it gets a panel.
import useQuoteOfTheDay from '../../hooks/useQuoteOfTheDay'
// ⭐ THE ONLY PERSONAL PANEL ON THIS HERO. The other three read a firm-wide
// cache; this one is per-member, which is why it was dropped during planning
// rather than being a drop-in. It is bounded, not per-render:
//   * `useJ2SelectedAccount` -> `useJ2Accounts` -> SWR key `/api/j2/accounts`,
//     which `JournalSnapshotTile` (Zone C, mounted in EVERY session state)
//     already holds — SWR dedupes by key, so it costs ZERO new requests.
//   * ONE additional SWR key for the reviews, with NO `refreshInterval`: one
//     request per account id per page load, never one per render.
// (`useJ2Accounts` does poll, but `marketHoursOnly` scales its interval and
// this hero only ever renders on the WEEKEND — when the market is closed.)
import useJ2SelectedAccount from '../journal-2-0/hooks/useJ2SelectedAccount'
// ⛔ compassScope, not a raw `accountId`. Every other Compass surface passes
// this (null -> the '_all_' unified sentinel), and hand-rolling the mapping
// here would put a second authority on "which coach am I asking".
import { compassScope } from '../journal-2-0/hooks/compassScope'

// The Compass tab's own deep-link contract (`JournalTwoRoot.jsx` reads
// `?j2tab=`), same idiom as `JournalSnapshotTile`'s `/journal?j2tab=positions`.
// A free member who follows it lands on Positions rather than a blank pane —
// JournalTwoRoot already falls back for the paid-only Compass tab.
const COMPASS_LINK = '/journal?j2tab=compass'

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
  const { accountId } = useJ2SelectedAccount()
  const { data: coach } = useSWR(
    `/api/j2/accounts/${compassScope(accountId)}/coach/weekly-reviews`,
    fetcher,
  )
  const { quote } = useQuoteOfTheDay()

  const articles = desk?.articles ?? []
  const isScan = (a) => (a.slug || '').startsWith('sunday-scans-')
  const scan = articles.find(isScan)
  // ⛔ Exclude by KIND, not by object identity. `a !== scan` drops only the one
  // scan we picked, and the desk holds several posts that share the "Sunday
  // Scans" title — so production rendered the same headline four times under
  // "From the Desk", directly beneath the panel already showing it. A reading
  // list is what is NOT the scan, not everything-but-this-particular-scan.
  const reading = articles.filter(a => !isScan(a)).slice(0, 4)

  // Newest first out of the router, so [0] IS the latest week. ⛔ No client-side
  // sort: re-deriving an order the server already owns is how the two answers
  // drift. A non-ok response (or no account, or no review yet) leaves `coach`
  // undefined and this null — one absence, one omission, no empty frame.
  const review = coach?.reviews?.[0] ?? null
  const reviewWeek = review?.week_start || review?.metadata?.week_start || null
  // ⛔ THE SUMMARY, NOT THE BODY. `summary` is the review's own short form
  // (coach.py fills it from the model, falling back to
  // `_extract_first_paragraph(body)`), so an excerpt here is READ, never
  // re-derived by slicing the body on this side of the wire. When it is blank
  // the panel still stands on the week + the link — the review exists, and
  // truncating `body` ourselves would be a second authority on "the gist".
  const reviewExcerpt = (review?.summary || '').trim()

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
  // nothing. Zone B collapses around this null so no 440px void is left behind
  // either — via `.cockpit:has(.zoneB:empty) { --zone-b: 0px }`, which shrinks
  // the TRACK. (It used to say `.zoneB:empty { display: none }`; that rule was
  // deleted because hiding the item left its 440px track standing and slid Zone
  // C into it. A comment describing a rule that no longer exists is the same
  // defect one level up, so this line moves whenever that CSS does.)
  //
  // ⛔ THIS IS ALSO THE OUTAGE PATH. `jsonFetcher` throws on a non-ok
  // response, so a 402/500 leaves both `desk` and `cal` undefined and lands
  // here — degrading to absence rather than to a labelled empty box. SWR
  // still retries on the thrown error, so a transient failure heals into
  // content (rail: TheWeek.errors.test.jsx).
  // ⛔ THE QUOTE IS DELIBERATELY NOT PART OF THIS TEST. It is available almost
  // always (server pick, with a local rotation as the offline fallback), so
  // counting it would make this condition unreachable and quietly restore the
  // very defect the gate exists to remove: a "The Week" header over a card that
  // says nothing about the week. Nothing to say about the week is still said by
  // saying nothing — the quote rides along when there IS a week to show.
  //
  // ⭐ THE COMPASS REVIEW *IS* COUNTED, AND THE QUOTE STILL IS NOT — the two
  // are opposite cases, not an inconsistency. A weekly review is ABOUT this
  // week and is absent far more often than not (no account, Compass off, no
  // Sunday run yet), so counting it leaves this gate reachable; and NOT
  // counting it would be the worse bug in the other direction — a member's
  // only personal panel silently dropped because the desk published nothing.
  // The quote is available almost always, which is why counting THAT would
  // make the gate unreachable.
  if (!scan && onDeck.length === 0 && reading.length === 0 && !review) return null

  return (
    <TileCard title="The Week" icon="calendar">
      <div className={styles.grid}>
        {scan && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Latest Sunday Scan</h3>
            <ArticleLink article={scan} className={styles.lead} />
          </section>
        )}
        {review && (
          <section className={styles.panel}>
            <h3 className={styles.h}>Compass Weekly Review</h3>
            <Link to={COMPASS_LINK} className={styles.lead}>
              {reviewWeek ? `Week of ${reviewWeek}` : 'Your latest review'}
            </Link>
            {/* ⛔ CLAMPED IN CSS, NOT SLICED IN JS. A JS truncation bakes a
                character count into the component and hands screen readers a
                sentence that stops mid-word; `-webkit-line-clamp` keeps the
                whole summary in the DOM and shows the excerpt the 440px zone
                has room for. */}
            {reviewExcerpt && <p className={styles.excerpt}>{reviewExcerpt}</p>}
            <Link to={COMPASS_LINK} className={styles.panelLink}>Open in Compass →</Link>
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
        {quote && (
          <section className={`${styles.panel} ${styles.quotePanel}`}>
            <h3 className={styles.h}>Quote of the Day</h3>
            <blockquote className={styles.quoteText}>&#8220;{quote.t}&#8221;</blockquote>
            <div className={styles.quoteAuthor}>
              &mdash; {quote.a}
              {quote.src && <span className={styles.quoteSrc}> · {quote.src}</span>}
            </div>
          </section>
        )}
      </div>
    </TileCard>
  )
}
