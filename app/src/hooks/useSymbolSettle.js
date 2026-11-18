// The symbol a chart widget should request, given the group symbol it follows.
//
// ⛔ THE COST THIS REPLACES. ChartWidget debounced EVERY group-symbol change by 90 ms so a
// fast arrow-scan would not run the full chart pipeline per intermediate ticker. It paid
// that wait on a single deliberate switch too: measured 2026-11-10 on production it was
// the largest single stage of a symbol switch (~100 of the 147 ms to drawn candles for a
// symbol seen moments ago), and the only one that was nothing but waiting.
//
// A change that follows a quiet stretch applies in the same commit (a layout effect, so
// the state update lands before the browser paints). Inside a burst the latest request
// waits BURST_SETTLE_MS, longer than the 100 ms key cadence, so a run of keypresses
// resolves to the last one; only a symbol already warm in memory, and only if the last
// apply was at least that long ago, is applied mid-burst, so a scan through warm names
// never falls behind.
//
// One authority, unchanged: the colour group remains the only writable symbol; this is a
// render lag derived from it, it always converges on the latest request, and a superseded
// wait is cancelled, so it can never deliver an earlier symbol over a later one.
import { useLayoutEffect, useRef, useState } from 'react'

export const QUIET_MS = 220
export const BURST_SETTLE_MS = 120

/** Pure decision for one requested change: 'apply' now, or 'defer' to the burst timer. */
export function settleAction({ now, lastRequestAt, lastAppliedAt, warm }) {
  if (now - lastRequestAt > QUIET_MS) return 'apply'
  return warm && now - lastAppliedAt >= BURST_SETTLE_MS ? 'apply' : 'defer'
}

/**
 * @param requested the symbol asked for this render
 * @param debounceMs 0 or less: pass the request straight through (a host that warms its rows)
 * @param isWarm (sym) => bars for it are already in the synchronous memory cache
 */
export default function useSymbolSettle(requested, { debounceMs = 90, isWarm } = {}) {
  const [settled, setSettled] = useState(requested)
  const lastRequestAt = useRef(-Infinity)
  const lastAppliedAt = useRef(-Infinity)
  const timer = useRef(null)
  const isWarmRef = useRef(isWarm)
  isWarmRef.current = isWarm

  useLayoutEffect(() => {
    if (debounceMs <= 0) return undefined
    const now = Date.now()
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    // The request came back to what is already applied: nothing to wait for.
    if (requested === settled) return undefined
    const action = settleAction({
      now, lastRequestAt: lastRequestAt.current, lastAppliedAt: lastAppliedAt.current,
      warm: !!isWarmRef.current?.(requested),
    })
    lastRequestAt.current = now
    if (action === 'apply') {
      lastAppliedAt.current = now
      setSettled(requested)
      return undefined
    }
    timer.current = setTimeout(() => {
      timer.current = null
      lastAppliedAt.current = Date.now()
      setSettled(requested)
    }, BURST_SETTLE_MS)
    return undefined
    // `settled` is read once per request: the only effect of a settle is that the next
    // change compares against the new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, debounceMs])

  useLayoutEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return debounceMs <= 0 ? requested : settled
}
