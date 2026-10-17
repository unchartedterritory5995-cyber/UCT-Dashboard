import useSWR from 'swr'

// The New-today answer for the screen on display (spec 2026-10-16 §1). Keyed by its
// criteria only, so a re-sort does not ask again. `enabled` is the payload flag; off asks
// nothing. A 404 (flag off server-side) or any failure answers null: no markers, no line.
//
// ⛔ `filters` is the screen's filter LIST (`baseSpec.filters`), never the keyed object
// useScreenSpec holds: the server hashes the criteria as given, and the nightly record was
// written from saved and starter specs, whose filters are a list.
const post = ([, body]) => fetch('/api/screener/membership-diff', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
}).then(r => (r.ok ? r.json() : null))

export default function useNewToday({ filters, logic, rank }, enabled) {
  const body = JSON.stringify({ spec: { filters: filters || [], logic: logic || null, rank: rank || null } })
  const { data } = useSWR(enabled ? ['new-today', body] : null, post, { revalidateOnFocus: false, dedupingInterval: 60000 })
  return data || null
}
