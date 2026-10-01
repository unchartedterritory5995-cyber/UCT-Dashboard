// app/src/components/LogoPrewarm.jsx
//
// Mounted once at app root (App.jsx). Warms the browser's logo cache for the
// symbols the user is most likely to open — their flagged list + every watchlist
// item — so the FIRST time they open a watchlist the real logos are already on
// disk and paint with no monogram flash. Renders nothing.
//
// Uses useUserTickerSet() (flagged + /api/watchlists, already used by the dashboard
// CatalystTable, SWR-shared + 60s), so it adds no new endpoint. Logged out => the
// set is empty and this is a no-op. Deduped across the session inside prefetchLogos,
// so the 60s SWR refresh never re-fires already-warmed symbols.
//
// ⛔ Mounted at the app root for EVERY visitor, signed in or not — including the
// public /share/n/:token and /p/:slug pages and the marketing/login/signup pages.
// `/api/watchlists` is authed-only (401 for a stranger), so the underlying fetch
// waits for a resolved, signed-in user via useUserTickerSet's `enabled` param —
// "logged out => the set is empty" used to describe the COMPUTED set, not the
// network call that produced it.
import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import useUserTickerSet from '../hooks/useUserTickerSet'
import { prefetchLogos } from '../utils/prefetchLogos'

export default function LogoPrewarm() {
  const { user, loading } = useAuth()
  const userSet = useUserTickerSet(!loading && !!user)
  useEffect(() => {
    if (userSet && userSet.size) prefetchLogos(userSet)
  }, [userSet])
  return null
}
