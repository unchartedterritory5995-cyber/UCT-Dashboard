// app/src/components/chart/engine/useEconomicCatalog.js
//
// The economic catalogue for a React surface — `useFundamentalsCatalog`'s twin.
//
// ⛔⛔ THIS IS THE ONE SWITCH EVERY ECONOMIC SURFACE READS, AND IT IS NOT A FLAG.
// `available` is true ONLY when `GET /api/econ/catalog` answered 200 with rows for
// THIS member — i.e. the server has `ECON_ENABLED=1` AND the member passes
// `require_bars_access`. 404 (dark) / 401 / 403 / offline are all "not available",
// and every economic chip, tab, row and behaviour is then simply absent. The client
// never reads `ECON_ENABLED` and has no second flag system.
//
// ⭐ One request per session, shared (`economicSeries.economicCatalog` caches it),
// and only once something actually asks: `active=false` costs nothing.
import { useEffect, useState } from 'react'
import { economicCatalog, subscribeEconomic, SOURCE_STATUS } from './economicSeries'

/** @returns {{status: string, list: object[], available: boolean}} */
export function useEconomicCatalog(active = true) {
  const [cat, setCat] = useState(() => (active ? economicCatalog() : null))
  useEffect(() => {
    if (!active) return undefined
    const read = () => setCat((prev) => {
      const next = economicCatalog()
      return prev && prev.status === next.status && prev.list === next.list ? prev : next
    })
    read()
    return subscribeEconomic(read)
  }, [active])
  if (!cat) return { status: 'idle', list: [], available: false }
  return { status: cat.status, list: cat.list, available: cat.status === SOURCE_STATUS.AVAILABLE }
}

export default useEconomicCatalog
