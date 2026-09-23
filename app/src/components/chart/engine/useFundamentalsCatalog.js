// app/src/components/chart/engine/useFundamentalsCatalog.js
//
// The Fundamentals library's catalogue, for the Indicators panel. Fetched ONCE
// per session (`fundamentalSeries.fundamentalsCatalog`) and only once something
// actually asks -- a panel that is never opened costs no request.
import { useEffect, useState } from 'react'
import { fundamentalsCatalog, subscribe } from './fundamentalSeries'

/** @returns {{status: string, list: object[]}} */
export function useFundamentalsCatalog(active = true) {
  const [cat, setCat] = useState(() => (active ? fundamentalsCatalog() : null))
  useEffect(() => {
    if (!active) return undefined
    const read = () => setCat((prev) => {
      const next = fundamentalsCatalog()
      return prev && prev.status === next.status && prev.list === next.list ? prev : next
    })
    read()
    return subscribe(read)
  }, [active])
  return cat ? { status: cat.status, list: cat.list } : { status: 'idle', list: [] }
}

export default useFundamentalsCatalog
