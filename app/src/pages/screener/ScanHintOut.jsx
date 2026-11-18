// app/src/pages/screener/ScanHintOut.jsx
//
// THE `?scan=` HINT LEAVES THE ADDRESS THROUGH THE ROUTER (review of #1566, 2026-11-17).
//
// `window.history.replaceState` changes the address bar and React Router does not see it: the
// router's own location would keep `?scan=<id>` until the next navigation, and the first
// `setSearchParams` or `navigate` built from that location would put the hint back, so a refresh
// would reopen the detail. This renders nothing and replaces the entry through the router instead.
//
// Mounted by `ScreensManager` only under a router and only after the hint has been read.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { withoutScanParam } from './scanLink'

export default function ScanHintOut() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const search = withoutScanParam(location.search)
    if (search === location.search) return
    navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true, state: location.state })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the hint has been read
  }, [])
  return null
}
