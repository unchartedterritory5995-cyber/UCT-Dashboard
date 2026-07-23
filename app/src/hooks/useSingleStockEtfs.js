// app/src/hooks/useSingleStockEtfs.js
// Family lookup for the Leverage/Inverse chart control. Data changes nightly,
// so cache generously; keyed on ChartWidget's already-debounced sym.
//
// The fetcher THROWS on a non-2xx / network failure (it does NOT resolve null).
// This matters: a "no family" answer is a 200 with the empty shape (which we
// cache), whereas a FAILURE is transient — and if we resolved null on failure,
// SWR would OVERWRITE a previously-good family with null and, with
// revalidateOnFocus off and no refresh interval, keep the pill hidden until the
// symbol changed. That is exactly what a routine deploy's ~1-min /api blip did
// on 2026-07-22 (a teammate's redeploy made the pill "disappear"). By throwing,
// SWR instead RETAINS the last-good data through the blip and retries with
// backoff (+ revalidateOnReconnect), so the pill rides out a deploy untouched.
import useSWR from 'swr'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => {
  if (!r.ok) throw new Error(`single-stock-etfs ${r.status}`)  // transient -> SWR keeps last-good + retries
  return r.json()
})

export default function useSingleStockEtfs(sym) {
  const skip = !sym || String(sym).startsWith('$IDX:')
  // keepPreviousData is deliberately OFF: the pill is symbol-specific, so on a
  // symbol change we must NOT show the prior symbol's family; undefined-until-
  // resolved (control hidden) is correct. Retention-through-failure above is a
  // different mechanism (SWR keeps data for the SAME key on error).
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
