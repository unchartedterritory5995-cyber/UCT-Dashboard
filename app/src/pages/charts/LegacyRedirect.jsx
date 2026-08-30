import { Navigate, useLocation } from 'react-router-dom'

/**
 * V2: /charts has no sub-tabs. Legacy URLs (/theme-tracker, /watchlists,
 * /multi-chart) redirect to bare /charts, dropping any ?tab= param and
 * preserving all other query params.
 *
 * Theme Tracker and Watchlists are reachable ONLY as a widget inside /charts
 * (the `themes` / `watchlist` widget types) — but a member's saved
 * `charts_workspace_layout` may not contain either one, so bare /charts can
 * silently land on a workspace that doesn't have the thing the door promised.
 * ⛔ /theme-tracker and /watchlists must not land on a bare workspace: the
 * door names which room it wants via `?ensure=<type>`, and ChartsWorkspace
 * seeds that widget when the saved layout lacks it (idempotent — see there).
 */
export default function LegacyRedirect() {
  const { pathname, search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')
  if (pathname.startsWith('/theme-tracker')) params.set('ensure', 'themes')
  if (pathname.startsWith('/watchlists')) params.set('ensure', 'watchlist')
  const qs = params.toString()
  return <Navigate to={qs ? `/charts?${qs}` : '/charts'} replace />
}
