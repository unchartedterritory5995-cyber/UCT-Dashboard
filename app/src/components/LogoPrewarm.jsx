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
import { useEffect } from 'react'
import useUserTickerSet from '../hooks/useUserTickerSet'
import { prefetchLogos } from '../utils/prefetchLogos'

export default function LogoPrewarm() {
  const userSet = useUserTickerSet()
  useEffect(() => {
    if (userSet && userSet.size) prefetchLogos(userSet)
  }, [userSet])
  return null
}
