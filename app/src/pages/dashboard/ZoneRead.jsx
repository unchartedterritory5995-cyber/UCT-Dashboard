// app/src/pages/dashboard/ZoneRead.jsx
//
// Zone A — THE READ, in 120px: what kind of session this is, the one number
// that says how much risk the firm is taking, and a compact index strip.
//
// ⛔ REAL FETCHER, not the brief's `fetch(u).then(r => r.ok ? r.json() : null)`
// `.catch(() => null)`. That shape collapses a 402/500/network error into the
// same `null` as "no exposure published yet", so an outage renders as a
// missing number rather than as an outage — the exact misclassification
// TheWeek's carried fix removed one file over. `jsonFetcher` throws; `data`
// stays undefined; the exposure element already omits itself when the score is
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
import useSessionState from './useSessionState'
import FuturesStrip from '../../components/tiles/FuturesStrip'
import styles from './ZoneRead.module.css'

const LABEL = { PREMARKET: 'Pre-market', LIVE: 'Open', CLOSED: 'Closed', WEEKEND: 'Weekend' }

export default function ZoneRead() {
  const session = useSessionState()
  const { data: breadth } = useMobileSWR('/api/breadth', jsonFetcher, {
    refreshInterval: 300_000,
    marketHoursOnly: true,
  })
  const score = breadth?.exposure?.score

  return (
    <div className={styles.read}>
      <div className={styles.state}>
        <span className={`${styles.pill} ${styles[session.toLowerCase()]}`}>
          {LABEL[session]}
        </span>
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
      <FuturesStrip compact hideQuote />
    </div>
  )
}
