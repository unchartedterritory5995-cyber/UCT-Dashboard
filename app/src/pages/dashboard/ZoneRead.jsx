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
// on why only % above the 50-day goes live), so this asks for very little.
//
// ⚠️ BUT 300s IS NOT THE PAGE'S EFFECTIVE CADENCE, and an earlier version of
// this comment claimed it was. `MarketBreadth.jsx` polls the SAME `/api/breadth`
// SWR key at 60s and is mounted by the dashboard's mobile branch, which is
// hidden by CSS rather than unmounted — SWR dedupes by key, so the shorter
// interval wins and Zone A actually refreshes every 60s. That is harmless
// (one request either way, and fresher than needed), but the number written
// here is not the number the page runs at.
//
// ⭐ ONE SOURCE FOR THE EXPOSURE NUMBER. This reads `/api/breadth` →
// `exposure.score`, which is the same field MarketBreadth's ExposureBar reads
// and the same field `api/routers/dashboard_signposts.py` puts on the Breadth
// door. Three surfaces, one field path — a derived read, never a restatement.
import useMobileSWR from '../../hooks/useMobileSWR'
import jsonFetcher from '../../utils/jsonFetcher'
import useQuoteOfTheDay from '../../hooks/useQuoteOfTheDay'
import UIcon from '../../components/ui/UIcon'
import FuturesStrip from '../../components/tiles/FuturesStrip'
import styles from './ZoneRead.module.css'

const LABEL = { PREMARKET: 'Pre-market', LIVE: 'Open', CLOSED: 'Closed', WEEKEND: 'Weekend' }

/**
 * 🔴 THE PILL AND THE COUNTDOWN MUST AGREE, AND FOR ONE DAY THEY DID NOT.
 * At 11:00 ET on Thanksgiving the served calendar is loaded and inside its
 * horizon, so the countdown correctly reads "Opens in 22h 30m" — beside a pill
 * reading "Open", because `resolveSession` is still holiday-blind. Zone A went
 * from consistently wrong to visibly incoherent, on the exact day the holiday
 * work exists for. The justification for leaving `resolveSession` alone was
 * "the pill beside it still names the session, which is the load-bearing
 * half"; on a holiday that half is the wrong one, and it is the half that
 * stays.
 *
 * ⛔ RECONCILED HERE, NOT IN `resolveSession`. That function is PURE and
 * SYNCHRONOUS, read at first render, and its four states are branched on
 * across the codebase and mocked by `Dashboard.session.test.jsx`; the calendar
 * arrives asynchronously, so teaching it holidays means making the session
 * state async. This is a label on one component, touching no shared contract:
 * the four states are untouched and Zone B still branches on them.
 *
 * ⛔ `=== true`, NOT TRUTHINESS. `holidayToday` is `null` when the calendar is
 * unknown — "we cannot tell" is not "it is a normal day" — and a null must
 * fall through to the session label rather than assert either way. WEEKEND
 * already says the true thing, so a Saturday closure is not relabelled.
 */
function pillFor(session, holidayToday) {
  if (holidayToday === true && session !== 'WEEKEND') {
    return { label: 'Holiday', tone: 'holiday' }
  }
  return { label: LABEL[session], tone: session.toLowerCase() }
}

/**
 * ⭐ THE SESSION AND THE BOUNDARY ARE PROPS, NOT HOOKS — THIS ZONE OWNS NO
 * CLOCK. `Dashboard.jsx` calls `useSessionState()` and `useNextBoundary()`
 * once and hands both answers down, so the pill here and the hero in Zone B
 * are the same read of the same tick.
 *
 * 🔴 IT USED TO CALL BOTH ITSELF, AND THE COMMENT ONE FILE OVER SAID
 * OTHERWISE. Dashboard.jsx warned against "a second `new Date()`" that could
 * "straddle a midnight tick and disagree about the same day" — and there were
 * two of each, here and there. SWR dedupes the `/api/market-calendar` FETCH by
 * key, so the closure table was genuinely shared; the CLOCK was not. Each
 * `useNextBoundary` instance held its own `now` state and its own 60s
 * interval, and a Dashboard re-render does not refresh this component's state,
 * so across an ET midnight the pill and the hero could disagree for up to a
 * minute. Rail: `Dashboard.oneClock.test.jsx`.
 *
 * ⛔ REQUIRED PROPS, NOT OPTIONAL ONES WITH A HOOK FALLBACK. A "call the hook
 * when the prop is absent" default cannot be written — React forbids the
 * conditional hook — and calling it unconditionally would restore the second
 * clock while looking like a fallback. A test that renders this component
 * directly passes both (see `ZoneRead.test.jsx`), which is also simpler than
 * the module mock it replaced.
 *
 * @param {object} props
 * @param {'PREMARKET'|'LIVE'|'CLOSED'|'WEEKEND'} props.session the resolved
 *   session state, from `Dashboard`'s single `useSessionState()`.
 * @param {{kind: string|null, ms: number|null, label: string|null,
 *          verified: boolean, holidayToday: boolean|null}} props.boundary
 *   `Dashboard`'s single `useNextBoundary()` return.
 * @param {boolean} [props.showQuote] render the Quote of the Day as a single
 *   line. ⭐ THE SPEC'S ONE FLAG ON THE ZONE A COMPONENT ("Reversible: it is
 *   one flag on the Zone A component"). Default ON: the spec DEMOTES the quote
 *   from half the top row to one line — it does not remove it. The full panel
 *   treatment lives in the WEEKEND state, inside `TheWeek`.
 */
export default function ZoneRead({ session, boundary, showQuote = true }) {
  const pill = pillFor(session, boundary.holidayToday)
  const { quote } = useQuoteOfTheDay()
  const { data: breadth } = useMobileSWR('/api/breadth', jsonFetcher, {
    refreshInterval: 300_000,
    marketHoursOnly: true,
  })
  const score = breadth?.exposure?.score
  const note = breadth?.exposure?.note || ''
  // 🔴 THE STAMP THAT WAS MISSING — carried from MarketBreadth.jsx, which is the
  // only other surface that renders it. ⚠️ It is NOT unmounted on desktop, as
  // an earlier version of this comment claimed: the dashboard's mobile branch
  // is hidden with `display: none`, so MarketBreadth is live in the DOM and
  // fetching on every desktop load — it simply is not VISIBLE there. This is
  // therefore the only stamp a desktop member can SEE, which is what makes it
  // load-bearing here. On 2026-08-14 the 06:35 wire crashed before
  // pushing, the dashboard served the prior day's rating all day, and a stale
  // 55 was pixel-identical to a fresh 55. Zone A now LEADS with that number,
  // which makes the stamp more load-bearing here than it was there.
  // `wire_status` is re-judged server-side on every read, so the STAMP itself
  // cannot go stale the way the score behind it can.
  // ⚠️ BUT IT IS NOT HOLIDAY-AWARE, and this comment used to claim it was
  // ("judged against the trading calendar"). `engine.expected_wire_date()`
  // says so in its own docstring — "(Holiday-naive: a market holiday reads as
  // one calendar day of 'stale' — acceptable)" — so on Thanksgiving this line
  // reads `stale` for a run that was never due. The backend trade-off stands;
  // a comment asserting a mechanism that does not operate is how a false
  // premise never gets revisited, so the sentence goes rather than the code.
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
          <span className={`${styles.pill} ${styles[pill.tone]}`}>
            {pill.label}
          </span>
          {/* Countdown to the next bell — spec, Zone A.
              ⛔ ONLY WHEN IT IS VERIFIABLE. `useNextBoundary` (called once,
              in Dashboard.jsx, and handed here) returns a null label while the
              market calendar is unknown — in flight, endpoint down, or the
              boundary walked past the horizon the closure table is
              authoritative about. It used to know weekends and clock hours
              and nothing else, so on Thanksgiving this said "Opens in 16h 16m"
              — to the minute, on the paid home, about an open that would not
              happen. The pill beside it still names the session, which is the
              load-bearing half: a missing countdown is not wrong. */}
          {boundary.label && (
            <span className={styles.countdown}>{boundary.label}</span>
          )}
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
