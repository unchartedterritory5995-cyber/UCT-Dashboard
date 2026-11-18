// UCT Terminal — the ONE source of the member's watchlist names for every list in the shell
// (owner request 2026-11-17). Mounted once around the shell (pages/terminal/TerminalRoutes.jsx);
// every symbol cell reads the result through `WatchMarksContext` and none of them fetches.
//
// ⭐ NO NEW REQUEST, NO NEW ROUTE, NO NEW PREFERENCE.
//   • Watchlists: `GET /api/watchlists?include_prebuilt=0`, the key the app shell already keeps
//     warm (hooks/useUserTickerSet, mounted by LogoPrewarm at the app root, 60 s). This hook
//     subscribes to that cache entry and sets NO timer of its own, so an open Terminal adds no
//     poll; opening it revalidates once (SWR's stale-on-mount), and anything that mutates an
//     `/api/watchlists…` key (the screener's "add to watchlist") refreshes the marks with it.
//   • Flagged: the browser's Flagged set (hooks/useFlagged), which every star writes at once, so
//     flagging a name marks it in every list immediately.
//
// "On your watchlist" therefore means: on one of YOUR OWN watchlists, or flagged. Not the
// prebuilt index lists, not broker positions, not the UCT 20 (a member with no watchlist and no
// flag sees no mark at all).
//
// ⛔ A read that fails or answers a shape nobody expected yields NO watchlist marks and never
// throws: this sits above every panel, outside their error boundaries.
// ⛔ Signed out reads nothing (the route is members-only).
import { useContext, useMemo } from 'react'
import useSWR from 'swr'
import { AuthContext } from '../../context/AuthContext'
import { useFlagged } from '../../hooks/useFlagged'
import { USER_LISTS_URL, userListRows, userListsFetcher } from '../../hooks/useUserTickerSet'
import { WatchMarksContext, buildWatchMarks, watchMarksSignature } from './watchMarks'

const NONE = new Map()

/** The marks as one Map, rebuilt only when the names (or which lists hold them) change. */
function useWatchMarksSource({ enabled = true } = {}) {
  const { flagged } = useFlagged()
  // No `refreshInterval` on purpose (see the header). `shouldRetryOnError: false`: SWR's retry
  // timer does not consult the app's visibility rule, and the shell's own poll already retries.
  const { data } = useSWR(enabled ? USER_LISTS_URL : null, userListsFetcher, {
    revalidateOnFocus: false, shouldRetryOnError: false,
  })
  const built = useMemo(
    () => (enabled ? buildWatchMarks(userListRows(data), flagged) : NONE),
    [enabled, data, flagged],
  )
  const signature = watchMarksSignature(built)
  // Identity follows CONTENT: a refresh that brings the same names back (or the MON panel
  // re-stamping the shared cache entry every minute) hands the lists the Map they already hold.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (built.size ? built : NONE), [signature])
}

export default function WatchMarksProvider({ children }) {
  // useContext, not useAuth(): renders (reading nothing) outside an AuthProvider.
  const auth = useContext(AuthContext)
  const marks = useWatchMarksSource({ enabled: !auth?.loading && !!auth?.user })
  return <WatchMarksContext.Provider value={marks}>{children}</WatchMarksContext.Provider>
}
