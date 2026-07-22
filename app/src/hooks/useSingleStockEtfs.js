// app/src/hooks/useSingleStockEtfs.js
// Family lookup for the Leverage/Inverse chart control. Data changes nightly,
// so cache generously; keyed on ChartWidget's already-debounced sym.
//
// Unlike useTickerMeta (which THROWS on failure so SWR retries), this fetcher
// deliberately resolves null on any failure: the consumer is a purely optional
// chart control — "no family" and "lookup failed" render identically (control
// hidden), so retry pressure buys nothing here.
import useSWR from 'swr'

const fetcher = (url) => fetch(url, { credentials: 'include' })
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null)

export default function useSingleStockEtfs(sym) {
  const skip = !sym || String(sym).startsWith('$IDX:')
  const { data } = useSWR(
    skip ? null : `/api/single-stock-etfs/${encodeURIComponent(String(sym).toUpperCase())}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 },
  )
  const family = data || null
  const hasFamily = !!(family && ((family.long && family.long.length) ||
    (family.short && family.short.length)))
  return { family, hasFamily }
}
