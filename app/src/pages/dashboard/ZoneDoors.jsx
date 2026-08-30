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
// ── CLIENT-FILLED DOORS: journal, community ─────────────────────────────────
//
// The backend deliberately leaves these two permanently `null` — see
// dashboard_signposts.py's docstring: both are PER-USER, and the endpoint's
// payload sits behind ONE global 60s cache key shared by every logged-in
// member, so writing one member's count into it would leak that count to the
// next 60 seconds' worth of everyone else's requests. That refusal is correct
// and stays untouched here.
//
// ⚰️ `desk` USED TO BE A THIRD ONE AND HAS MOVED SERVER-SIDE. It never
// belonged beside these two: its refusal was about CACHE SHAPE (no TTLCache on
// `desk_store.list_posts`), not about per-user data — the number is identical
// for everybody, and the signposts endpoint already owns a 60s cache. The
// client stand-in was broken in two ways at once: blank Monday–Friday (it
// borrowed `TheWeek`'s key and that hero mounts only at the weekend), and
// structurally "0" whenever it did render, because `published_at` is a unix
// EPOCH INT and `Date.parse` of an integer is NaN. The server computes it now,
// seven days a week.
//
// What CAN happen on the client: `/dashboard` already mounts other tiles that
// fetch exactly this data for their own purposes —
//   • journal    — JournalSnapshotTile (Zone C), ALWAYS mounted, polls
//                  `/api/j2/positions` + `/api/j2/options?status=open` every 15s.
//   • community  — NavBar (global layout, every page), polls
//                  `/api/community/status` + `/api/community/unread`.
// SWR keys ARE the cache: re-using the exact same key string (and the exact
// same fetcher CONTRACT — see `nullOnErrorFetcher` below) means a second
// subscriber reads what the first already fetched, at zero extra requests.
// `READ_ONLY` goes one step further than a bare re-subscribe: it makes this
// component's own hook incapable of independently firing a request, so the
// guarantee holds even when the "someone else already fetches this" co-mount
// assumption doesn't.
//
// ⛔ THAT SENTENCE WAS FALSE UNTIL `isPaused` WAS ADDED, and it was asserted
// in three places while being false. The four `revalidateOn*` flags gate only
// SWR's automatic triggers; the Dashboard's own pull-to-refresh calls `mutate`
// explicitly, which reaches the revalidator past all four. See `READ_ONLY`
// below for the mechanism and `ZoneDoors.mutate.test.jsx` for the measurement.
//
// ⛔ journal is PER-USER DATA. Its value lives ONLY in this browser's
// client-side SWR cache (in-memory, this tab) — never written to
// `dashboard_signposts`'s shared 60s server cache, or to any other shared
// store. Nothing added here changes that.
//
// ⛔ SERVER WINS. If the backend ever starts answering non-null for one of
// these two, that answer must never be silently clobbered by a client guess —
// see the `value` computation in the render loop below and
// `ZoneDoors.clientFill.test.jsx`'s "server wins" case. `desk` moving
// server-side is that rule working as intended rather than an exception to it.
//
// ⭐ A card with a null value renders as a plain link with no number: a normal
// state, not an error — for `journal`/`community` in a signed-out edge case,
// or simply before the co-mounted tile's own first fetch resolves.
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'
import jsonFetcher from '../../utils/jsonFetcher'
import UIcon from '../../components/ui/UIcon'
import { DOORS } from './doors'
import styles from './ZoneDoors.module.css'

// Same contract as the local `fetcher` defined in JournalSnapshotTile.jsx and
// NavBar.jsx (the shape is duplicated in ~100 files across this codebase):
// resolve `null` on a non-ok response rather than throwing. MUST stay
// byte-identical to those two — a mismatched fetcher on a key another
// component already polls is a known trap in this project: whichever
// revalidation lands first seeds the shared SWR cache for every subscriber of
// that key, so a fetcher that throws where another resolves-null (or the
// reverse) can poison what the OTHER reader sees, not just this one.
const nullOnErrorFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

// A SWR call under these options is a PURE cache reader: it never fetches on
// its own. It only ever shows whatever some OTHER already-mounted hook on the
// exact same key already put in the shared SWR cache. Since no key here sets
// `refreshInterval`, it is not a polling site either
// (`pollingSites.rail.test.js` only counts that one key on a bare `useSWR`'s
// third argument).
//
// 🔴 `isPaused` IS THE ONE THAT MAKES THAT SENTENCE TRUE, and the four flags
// above it are not enough — this comment used to claim they were. Those four
// gate SWR's AUTOMATIC triggers only. An explicit `mutate` calls the hook's
// `revalidate` directly, and that function consults none of them; it
// short-circuits on `!key || !fetcher || unmounted || isPaused()`
// (`node_modules/swr/dist/index/index.mjs`). `Dashboard.jsx`'s `handleRefresh`
// is exactly such a call — `mutate(() => true, undefined, {revalidate: true})`,
// wired to `<PullToRefresh>` — so a pull-to-refresh made these reads fetch on
// their own. Measured with a fetch spy, not reasoned:
// `ZoneDoors.mutate.test.jsx`.
//
// ⛔ `isPaused` DOES NOT BLOCK CACHE READS OR RE-RENDERS. Verified in the
// installed SWR 2.4.0: it gates starting a revalidation and handling its
// error, nothing else. The doors still fill the instant a co-subscriber's own
// fetch lands, which is the entire mechanism here.
const READ_ONLY = {
  revalidateOnMount: false,
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  isPaused: () => true,
}

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

  // journal "Open" — same key + fetcher contract as JournalSnapshotTile.jsx
  // (Zone C, ALWAYS mounted on /dashboard, both the desktop and mobile
  // layouts). Each endpoint is treated as "known" only on an actual
  // successful answer (an object), never on `undefined` (not fetched yet) or
  // `null` (nullOnErrorFetcher's own failure marker) — so a not-yet-loaded or
  // failed read never masquerades as a confirmed zero. Either side resolving
  // is enough to show a (possibly partial, soon-corrected) count, mirroring
  // JournalSnapshotTile's own `totalCount`, which doesn't wait for both either.
  const { data: posData } = useSWR('/api/j2/positions', nullOnErrorFetcher, READ_ONLY)
  const { data: optData } = useSWR('/api/j2/options?status=open', nullOnErrorFetcher, READ_ONLY)
  const posKnown = posData !== undefined && posData !== null
  const optKnown = optData !== undefined && optData !== null
  const journalValue = (posKnown || optKnown)
    ? (posKnown ? (posData.positions?.length ?? 0) : 0)
      + (optKnown ? (optData.strategies?.length ?? 0) : 0)
    : null

  // community "Unread" — the SAME formula as NavBar's own `floorUnread` nav
  // badge (forum-board unread + unseen @-mentions). `mentions_unseen` rides
  // along on the `/status` call above (already fetched for the dark-launch
  // gate); `/api/community/unread` is the one extra key, gated behind the
  // SAME flag that gates the door's own visibility. Waits for a genuine
  // answer (not `undefined`/`null`) before showing anything, rather than
  // showing a transient "0 + mentions_unseen" before the unread total loads.
  const { data: communityUnread } = useSWR(
    communityStatus?.enabled ? '/api/community/unread' : null,
    nullOnErrorFetcher, READ_ONLY,
  )
  const communityUnreadKnown = communityUnread !== undefined && communityUnread !== null
  const communityValue = communityStatus?.enabled && communityUnreadKnown
    ? (communityUnread.total || 0) + (communityStatus.mentions_unseen || 0)
    : null

  const CLIENT_FILL = { journal: journalValue, community: communityValue }

  return (
    <nav className={styles.doors} aria-label="Sections">
      {doors.map((d) => {
        const card = data?.[d.key]
        // ⛔ SERVER WINS. A client fill applies ONLY when the server's own
        // slot for this key is null — it must never silently override a real
        // server answer. `desk` is the live proof this is not dead code: it
        // used to be client-filled and now comes from the server, and the
        // switchover needed no change here. journal/community stay null
        // server-side by design (see the module docstring).
        // See ZoneDoors.clientFill.test.jsx.
        const value = card?.value != null ? card.value : (CLIENT_FILL[d.key] ?? null)
        return (
          <Link key={d.key} to={d.to} className={styles.door}>
            <UIcon name={d.icon} size={14} className={styles.icon} />
            <span className={styles.label}>{d.label}</span>
            {/* A door with no number is still a door. */}
            {value != null && (
              <span className={styles.value}>{value}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
