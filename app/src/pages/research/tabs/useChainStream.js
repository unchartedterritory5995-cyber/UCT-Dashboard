import { useEffect, useRef, useState } from 'react'

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

export const chainQuotesUrl = (sym, exp) => `/api/live/massive/chain-quotes/${encodeURIComponent(sym)}?expiration=${encodeURIComponent(exp)}`
export const chainStreamUrl = (sym, exp) => `/api/live/massive/chain-stream/${encodeURIComponent(sym)}?expiration=${encodeURIComponent(exp)}`

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
  const [state, setState] = useState({ on: false, quotes: {}, coverage: null })
  const esRef = useRef(null)
  useEffect(() => {
    setState({ on: false, quotes: {}, coverage: null })
    if (!sym || !expiration) return undefined
    let dead = false
    fetch(chainQuotesUrl(sym, expiration), { credentials: 'same-origin' })
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((body) => {
        if (dead || !body || typeof body.quotes !== 'object') return
        setState({ on: true, quotes: body.quotes || {}, coverage: body.coverage || null })
        if (typeof EventSource === 'undefined') return
        const es = new EventSource(chainStreamUrl(sym, expiration))
        esRef.current = es
        es.onmessage = (ev) => {
          let msg
          try { msg = JSON.parse(ev.data) } catch { return }
          if (!msg || typeof msg.quotes !== 'object') return
          setState((prev) => {
            const next = { ...prev.quotes }
            for (const [c, v] of Object.entries(msg.quotes)) next[c] = { ...(next[c] || {}), ...v }
            return { ...prev, quotes: next }
          })
        }
      })
      .catch(() => {})
    return () => {
      dead = true
      if (esRef.current) { esRef.current.close(); esRef.current = null }
    }
  }, [sym, expiration])
  return state
}
