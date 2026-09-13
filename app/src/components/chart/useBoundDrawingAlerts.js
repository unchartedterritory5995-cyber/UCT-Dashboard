/* "Follow this line" — keeps an object-bound alert glued to its drawing.
 *
 * ⭐ WHAT BINDING ACTUALLY COSTS, and why it is this small. The server already
 * knows how to evaluate a sloped line: `_alert_level_now` interpolates between
 * two anchors at check time. So a bound alert needs NO new evaluation semantics
 * — it needs its anchors to stay TRUE. Binding is therefore a sync problem, not
 * a maths problem, and this hook is the whole of it.
 *
 * ⛔ THE DELETE RULE IS DELIBERATELY TIMID, because the failure is destructive.
 * A chart only knows the drawings for ITS symbol, `useChartDrawings` hydrates
 * from localStorage asynchronously, and a bound alert may have been created in
 * another browser whose drawings have not synced here yet. "The drawing isn't in
 * my list" is therefore NOT evidence it was deleted — on a cold mount it is the
 * normal state, and acting on it would delete the user's alerts on page load.
 * So a bound alert is removed ONLY on a seen→absent TRANSITION: this session
 * must have positively observed the drawing before it may conclude it is gone.
 * A drawing this browser has never seen is left strictly alone.
 *
 * ⛔ AND A PAGE LOAD MUST NOT WRITE. The alert row carries the same field names
 * the geometry does, so the server's own anchors go through `geometrySignature`
 * unchanged: if they already agree with the drawing, the baseline is adopted
 * silently and nothing is sent. Only a real MOVE reaches the network.
 */
import { useEffect, useMemo } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { anchorsForDrawing, alertKindFor, geometrySignature, parseBoundId } from './drawingAlertAnchors'

// ⛔ MODULE-LEVEL ON PURPOSE. N charts on one symbol mount N copies of this hook
// and see the SAME store snapshot, so per-instance state would send N identical
// PATCHes for one drag. This is the same fan-out these surfaces already guard
// against in `drawingsStore` (`_addGuard`, `_gestureGuard`).
const _lastPushed = new Map()   // drawing_id -> the geometry signature the server holds
const _seen = new Set()         // drawing_ids this session has positively observed
const _inflight = new Set()     // drawing_ids with a request in the air

export function _resetBoundAlertSync() {
  _lastPushed.clear(); _seen.clear(); _inflight.clear()
}

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))
const revalidateAlerts = () =>
  globalMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))

export default function useBoundDrawingAlerts({ sym, drawings, getBars, tf, etOffset = 0 }) {
  const symU = String(sym || '').toUpperCase()

  // ⭐ THE PRECONDITION KEEPS THIS DORMANT ALMOST EVERYWHERE. Without a line-ish
  // drawing on the chart there is nothing a bound alert could be attached to, so
  // no list is fetched at all — a logged-out visitor, a journal thumbnail and a
  // grid of 16 plain candlestick cells make zero extra requests.
  const hasLineDrawing = useMemo(
    () => (drawings || []).some((d) => alertKindFor(d?.type)),
    [drawings],
  )

  const { data } = useSWR(symU && hasLineDrawing ? '/api/watchlist-alerts' : null, fetcher, {
    refreshInterval: 60000,
    dedupingInterval: 30000,
  })
  const alerts = Array.isArray(data) ? data : []

  useEffect(() => {
    if (!symU || !alerts.length) return
    const byId = new Map((drawings || []).map((d) => [d.id, d]))
    const bars = (typeof getBars === 'function' && getBars()) || []

    for (const a of alerts) {
      const did = a && a.drawing_id
      if (!did || !a.is_active) continue
      if (String(a.sym || '').toUpperCase() !== symU) continue
      if (_inflight.has(did)) continue

      // ⭐ A FIB LEVEL ALERT'S BOUND ID IS `<drawingId>#<level>`. Splitting it
      // here is the whole of the Fib integration on this side: the drawing is
      // found the same way, the geometry is recomputed for THAT level, and the
      // existing signature/PATCH/DELETE machinery is untouched.
      const { drawingId, level } = parseBoundId(did)
      const d = byId.get(drawingId)

      if (!d) {
        // Only a seen→absent transition counts as a delete (see the header).
        if (!_seen.has(did)) continue
        _inflight.add(did)
        fetch(`/api/watchlist-alerts/bound/${encodeURIComponent(did)}`, { method: 'DELETE' })
          .then(() => { _seen.delete(did); _lastPushed.delete(did); revalidateAlerts() })
          .catch(() => { /* non-fatal — retried on the next snapshot */ })
          .finally(() => { _inflight.delete(did) })
        continue
      }

      _seen.add(did)
      const geom = anchorsForDrawing(d, { bars, tf, etOffset, level })
      if (!geom) continue
      const sig = geometrySignature(geom)
      if (_lastPushed.get(did) === sig) continue
      // The server's row speaks the same shape — if it already agrees, adopt the
      // baseline instead of writing. This is what makes a page load silent.
      if (geometrySignature(a) === sig) { _lastPushed.set(did, sig); continue }

      _inflight.add(did)
      fetch(`/api/watchlist-alerts/bound/${encodeURIComponent(did)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geom),
      })
        .then((r) => { if (r && r.ok) { _lastPushed.set(did, sig); revalidateAlerts() } })
        .catch(() => { /* non-fatal — retried on the next snapshot */ })
        .finally(() => { _inflight.delete(did) })
    }
  }, [symU, drawings, alerts, getBars, tf, etOffset])

  return alerts
}
