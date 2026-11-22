// The news wire for ONE stock, read once: the hook MOVE and CN share.
//
// ⭐ ONE REQUEST, NO STREAM. It calls the shared client's own day read
// (lib/tradeExchangeNewsStreamManager.js `fetchDay`) with the request `NVDA UCN` sends, asked for
// a few rows. It never subscribes to the pool, so MOVE and CN open no history load and no
// stream of their own: the tab's one stream stays the UCT News panel's and the NEWS strip's.
// There is no polling loop here either. The list is read when the panel opens (and on Retry);
// the section says so, and names the live panel.
//
// ⛔ IT NEVER REJECTS AND NEVER BLOCKS ITS HOST. The read runs beside the host panel's own read;
// a hung request becomes "could not check" after the house 30 seconds (utils/withDeadline.js),
// and every failure is a state of this section alone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DAY_URL, fetchDay as poolFetchDay } from '../../../lib/tradeExchangeNewsStreamManager'
import { SECTION_TIMEOUT_MS, withDeadline } from '../../../utils/withDeadline'
import { stockWireFailure, stockWireRequest, stockWireResult } from './wireInPanelsModel'

/** Read the newest `limit` wire headlines naming `sym`. Resolves to a section state, always. */
export async function readStockWire(sym, limit, { fetchDay = poolFetchDay, deadlineMs = SECTION_TIMEOUT_MS, now = Date.now } = {}) {
  try {
    const body = await withDeadline(Promise.resolve().then(() => fetchDay(stockWireRequest(sym, limit))), DAY_URL, deadlineMs)
    return stockWireResult(sym, body, limit, now())
  } catch (err) {
    return stockWireFailure(sym, err, deadlineMs)
  }
}

/**
 * `{ sym, phase, ...state, retry }` for one stock. `phase` is `idle` (no stock, or not enabled),
 * `loading`, `rows`, `none`, `failed` or `off` (wireInPanelsModel.js). A state that belongs to
 * an earlier stock is never shown for the next one.
 */
export default function useStockWire(rawSym, limit, { enabled = true } = {}) {
  const sym = String(rawSym || '').trim().toUpperCase()
  const on = !!sym && !!enabled
  const [state, setState] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!on) return undefined
    let live = true
    setState(null)
    readStockWire(sym, limit).then((res) => { if (live) setState(res) })
    return () => { live = false }
  }, [sym, limit, on, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = on && state && state.sym === sym ? state : null
  return useMemo(() => ({ ...(current || { sym, phase: on ? 'loading' : 'idle' }), retry }), [current, sym, on, retry])
}
