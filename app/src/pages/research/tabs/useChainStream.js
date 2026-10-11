import { useEffect, useState } from 'react'
import { declareNeed, DELIVERY } from '../../../lib/panelContract'
import { EMPTY_CHAIN } from '../../../lib/chainStreamManager'

// FT-015 / BRK-01: the streamed option chain. flow-worker reads the OPRA feed it already holds and
// pushes, every 2 s, the contracts of one (underlying, expiration) whose Last / Bid / Ask moved
// (api/live_chain_stream.py, dark on OPTIONS_CHAIN_STREAM_ENABLED). Web forwards both routes
// through the flow proxy.
//
// ⛔ PROBE FIRST. EventSource cannot see a status code, so the hook asks the one-shot read
//    (`chain-quotes`) and opens the stream ONLY on a 200. A 404 (switched off), 402 (free) or any
//    failure leaves the chain on its 60 s poll and renders nothing new.
// ⛔ A STREAMED VALUE NEVER OVERWRITES A NEWER POLLED ONE. It replaces the chain's field only when
//    its own timestamp is later than the instant the server read the chain (`served_at`).

// TERM-024: the probe and the stream are owned by the shared pool (lib/chainStreamManager.js); this
// hook holds a handle. The URLs are re-exported from the pool, their one definition.
export { chainQuotesUrl, chainStreamUrl } from '../../../lib/chainStreamManager'
const CHAIN = declareNeed({ kind: 'chain', delivery: DELIVERY.EVERY_MESSAGE_MATTERS })

/** One side of a chain row with the streamed fields laid over it, when they are newer. */
export function overlayQuote(q, quotes, servedMs) {
  if (!q || !q.contract || !quotes) return q
  const s = quotes[q.contract]
  if (!s) return q
  const floor = Number.isFinite(servedMs) ? servedMs : 0
  let out = q
  if (Number.isFinite(s.last) && Number(s.last_ts) > floor) {
    out = { ...out, last: s.last, live_last: true }
  }
  if (Number.isFinite(s.bid) && Number.isFinite(s.ask) && Number(s.quote_ts) > floor) {
    out = { ...out, bid: s.bid, ask: s.ask, live_quote: true }
  }
  return out
}

export default function useChainStream(sym, expiration) {
  const [state, setState] = useState(EMPTY_CHAIN)
  useEffect(() => {
    setState(EMPTY_CHAIN)
    if (!sym || !expiration) return undefined
    return CHAIN.subscribe(sym, expiration, setState)
  }, [sym, expiration])
  return state
}
