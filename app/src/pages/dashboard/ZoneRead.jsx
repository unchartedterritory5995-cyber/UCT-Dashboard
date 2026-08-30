// app/src/pages/dashboard/ZoneRead.jsx
//
// Zone A — THE READ, in 120px: what kind of session this is and how long is
// left of it, the one number that says how much risk the firm is taking (with
// its note and the stamp that says whether it is TODAY's number), a compact
// index strip, and the Quote of the Day demoted to a single line.
//
// ⛔ NOTHING IN THIS ZONE MAY WRAP. The 120px budget is the design, and a
// two-line exposure note or a long quote would silently spend Zone B's height.
// Every text element below is single-line-clamped in the CSS; that is what
// makes the budget an invariant rather than a hope.
//
// ⛔ REAL FETCHER, not the brief's `fetch(u).then(r => r.ok ? r.json() : null)`
// `.catch(() => null)`. That shape collapses a 402/500/network error into the
// same `null` as "no exposure published yet", so an outage renders as a
// missing number rather than as an outage — the exact misclassification
// TheWeek's carried fix removed one file over. `jsonFetcher` throws; `data`
// stays undefined; every element below already omits itself when its field is
// missing, so the degrade is identical MINUS the silent lie, and SWR retries a
// transient failure instead of treating it as a successful empty answer.
//
// ⛔ `useMobileSWR`, not a bare `useSWR(..., { refreshInterval })`.
// `hooks/pollingSites.rail.test.js` fails the FULL suite on any new bare
// polling site with no census row, and its instruction is explicit: "Pick one…
// Do NOT add a row to silence this." This is new code on a surface a phone
// renders, so the helper's measured win — halving the tick on a touch client —
// is the reason to pick it.
//
// ⛔ `marketHoursOnly: true`. The exposure score is pushed once a day by the
// morning wire and is NOT derivable intraday (see MarketBreadth.jsx's own note
// on why only % above the 50-day goes live). A 5-minute poll is already
// generous; slowing it 10× on evenings and weekends costs zero real freshness.
//
// ⭐ ONE SOURCE FOR THE EXPOSURE NUMBER. This reads `/api/breadth` →
// `exposure.score`, which is the same field MarketBreadth's ExposureBar reads
// and the same field `api/routers/dashboard_signposts.py` puts on the Breadth
// door. Three surfaces, one field path — a derived read, never a restatement.
import useMobileSWR from '../../hooks/useMobileSWR'
import jsonFetcher from '../../utils/jsonFetcher'
import useQuoteOfTheDay from '../../hooks/useQuoteOfTheDay'
import UIcon from '../../components/ui/UIcon'
import useSessionState, { useNextBoundary } from './useSessionState'
import FuturesStrip from '../../components/tiles/FuturesStrip'
import styles from './ZoneRead.module.css'

const LABEL = { PREMARKET: 'Pre-market', LIVE: 'Open', CLOSED: 'Closed', WEEKEND: 'Weekend' }

/**
 * @param {object} props
 * @param {boolean} [props.showQuote] render the Quote of the Day as a single
 *   line. ⭐ THE SPEC'S ONE FLAG ON THE ZONE A COMPONENT ("Reversible: it is
 *   one flag on the Zone A component"). Default ON: the spec DEMOTES the quote
 *   from half the top row to one line — it does not remove it. The full panel
 *   treatment lives in the WEEKEND state, inside `TheWeek`.
 */
export default function ZoneRead({ showQuote = true }) {
  const session = useSessionState()
  const boundary = useNextBoundary()
  const { quote } = useQuoteOfTheDay()
  const { data: breadth } = useMobileSWR('/api/breadth', jsonFetcher, {
    refreshInterval: 300_000,
    marketHoursOnly: true,
  })
  const score = breadth?.exposure?.score
  const note = breadth?.exposure?.note || ''
  // 🔴 THE STAMP THAT WAS MISSING — carried from MarketBreadth.jsx, which
  // desktop no longer renders at all, so this is the ONLY copy on the page
  // rather than a second one. On 2026-08-14 the 06:35 wire crashed before
  // pushing, the dashboard served the prior day's rating all day, and a stale
  // 55 was pixel-identical to a fresh 55. Zone A now LEADS with that number,
  // which makes the stamp more load-bearing here than it was there.
  // `wire_status` is judged server-side against the trading calendar and
  // re-judged on every read, so it cannot itself go stale.
  const wireDate = breadth?.wire_date ?? null
  const wireStale = breadth?.wire_status === 'stale'
  // ⛔ 'unknown' IS ITS OWN ANSWER, NOT A MISSING ONE. `engine.wire_freshness`
  // emits 'unknown' for an absent or unparseable date and its docstring is
  // explicit that this is "deliberately distinct from 'stale': an absent date
  // means we cannot tell, and claiming staleness we cannot support is the same
  // class of error as claiming freshness we cannot support." Branching only on
  // 'stale' left an unknown-vintage score rendering completely unlabelled —
  // the 2026-08-14 shape in milder form, on the number Zone A now LEADS with.
  // So we say we cannot tell, which is the true statement.
  //
  // ⛔ TWO EDGES, BOTH OF WHICH RENDERED SOMETHING FALSE:
  //   * `'unknown'` fires exactly when there is no wire — i.e. the cold-start
  //     and wire-outage shape, where there is usually no SCORE either. A
  //     warning-coloured "Wire date unknown" with no number to be about is a
  //     caption for an absent subject, so the stamp is gated on `score != null`.
  //     A missing number already says "nothing to read here"; it needs no badge.
  //   * `engine.wire_freshness` ALSO returns `'unknown'` for a date that is
  //     PRESENT but unparseable. Preferring `wire_date` then rendered
  //     "Wire <garbage>" with no explanation, so `unknown` now WINS over the
  //     date: if the server could not parse it, we do not print it as fact.
  const wireUnknown = breadth?.wire_status === 'unknown'
  const showUnknown = wireUnknown && score != null
  const showWireDate = !!wireDate && !wireUnknown
  const flagged = wireStale || showUnknown

  return (
    <div className={styles.read}>
      <div className={styles.state}>
        <div className={styles.stateTop}>
          <span className={`${styles.pill} ${styles[session.toLowerCase()]}`}>
            {LABEL[session]}
          </span>
          {/* Countdown to the next bell — spec, Zone A. */}
          <span className={styles.countdown}>{boundary.label}</span>
        </div>
        {score != null && (
          <span className={styles.exposure}>
            <b>{Math.round(score)}</b>
            <span className={styles.exposureLabel}>UCT exposure</span>
          </span>
        )}
      </div>

      {/* The quote is demoted out of the top row — see the spec, Zone A. It is
          brand, not data, and it held roughly half of the most valuable region
          on the paid home. `compact` is what makes six indices fit one row
          inside the declared 120px. */}
      <div className={styles.stripCell}><FuturesStrip compact hideQuote /></div>

      {/* One muted line under both columns: freshness stamp, then the note.
          Both are about the same reading, so they share a row rather than
          spending two of the zone's four available text lines. */}
      {(showWireDate || showUnknown || note) && (
        <p className={`${styles.meta} ${flagged ? styles.metaStale : ''}`}>
          {/* ⛔ gold={false}. UIcon's `gold` prop DEFAULTS TO TRUE and overrides
              `stroke` with the metallic gradient — without it this warning
              rendered as a decorative gold mark beside --warning-coloured text,
              on the one signal that says the number above may not be today's. */}
          {flagged && (
            <UIcon name="warning" size={11} gold={false} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          )}
          {showUnknown ? (
            <span className={styles.wire}>Wire date unknown — freshness unverified</span>
          ) : showWireDate ? (
            <span className={styles.wire}>
              Wire {wireDate}{wireStale ? ' — no run since; this is not today’s reading' : ''}
            </span>
          ) : null}
          {(showWireDate || showUnknown) && note && <span className={styles.dot}> · </span>}
          {note && <span className={styles.note}>{note}</span>}
        </p>
      )}

      {showQuote && quote && (
        <p className={styles.quote}>
          <span className={styles.quoteText}>&#8220;{quote.t}&#8221;</span>
          <span className={styles.quoteAuthor}> — {quote.a}</span>
        </p>
      )}
    </div>
  )
}
