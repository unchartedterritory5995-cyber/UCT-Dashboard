// app/src/pages/dashboard/ZoneDoors.jsx
//
// Zone D — eight signpost cards: a link carrying one live number, at ~90px
// instead of the ~4,000px the old preview tiles cost. Manifest: `./doors.js`.
// Data: `GET /api/dashboard/signposts` (api/routers/dashboard_signposts.py).
//
// ⛔ RULING — polls via `useMobileSWR`, NOT a bare `useSWR(..., {refreshInterval})`.
// `app/src/hooks/pollingSites.rail.test.js` fails the FULL suite on any new bare
// polling site with no census row ("Pick one... Do NOT add a row to silence
// this"). This is brand-new code, so there is no reason to be exempted, and
// the helper's real measured win — halving the interval on a touch client —
// is exactly what an 8-number signpost strip wants.
//
// ⛔ `marketHoursOnly: true` — every card here is backed by data that is at
// most daily (breadth exposure score from the morning wire, UCT20 entry-date
// rollup, scanner candidate count) or only meaningfully moves during the
// session (live Top Flow picks, tonight's AMC count). None of it benefits
// from a 60s cadence once the market is fully closed, so slowing to 10x
// (10 min) on evenings/weekends costs zero real freshness and saves the poll.
//
// ⛔ REAL fetcher, not the brief's assumed `fetch(u).then(r => r.ok ? r.json() : {}).catch(() => ({}))`
// — a non-2xx answers JSON too (see utils/jsonFetcher.js's header), so that
// shape would let a refusal/outage body masquerade as card data instead of
// leaving the doors as plain links. `jsonFetcher` throws instead; `data`
// simply stays undefined and every door below already renders label-only.
//
// ⭐ Three of the eight cards (`desk`, `journal`, `community`) are permanently
// `null` today — see the backend's own docstring for why. A card with a null
// value renders as a plain link with no number: a normal state, not an error.
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'
import jsonFetcher from '../../utils/jsonFetcher'
import UIcon from '../../components/ui/UIcon'
import { DOORS } from './doors'
import styles from './ZoneDoors.module.css'

export default function ZoneDoors() {
  const { data } = useMobileSWR('/api/dashboard/signposts', jsonFetcher, {
    refreshInterval: 60_000,
    marketHoursOnly: true,
  })
  // ⛔ THE COMMUNITY DARK LAUNCH, HONOURED HERE TOO. `NavBar.jsx` and
  // `MoreSheet.jsx` both hide The Floor until `/api/community/status` reports
  // enabled; this surface shipped it unconditionally, so Zone D was the ONE
  // place advertising a door whose endpoints 503 the moment the flag is rolled
  // back. The flag is armed today, which is exactly why the gap was invisible.
  //
  // ⛔ NOT `useMobileSWR`: a bare `useSWR` with no `refreshInterval` is not a
  // polling site (`hooks/pollingSites.rail.test.js` only counts a third-argument
  // `refreshInterval`), and this key is already polled at 120s by NavBar — SWR
  // dedupes it, so this adds a cache read rather than a request.
  const { data: communityStatus } = useSWR('/api/community/status', jsonFetcher)
  const doors = DOORS.filter(
    (d) => d.key !== 'community' || communityStatus?.enabled,
  )

  return (
    <nav className={styles.doors} aria-label="Sections">
      {doors.map((d) => {
        const card = data?.[d.key]
        return (
          <Link key={d.key} to={d.to} className={styles.door}>
            <UIcon name={d.icon} size={14} className={styles.icon} />
            <span className={styles.label}>{d.label}</span>
            {/* A door with no number is still a door. */}
            {card?.value != null && (
              <span className={styles.value}>{card.value}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
