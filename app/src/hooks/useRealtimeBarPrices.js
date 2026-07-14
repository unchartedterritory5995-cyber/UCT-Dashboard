import { useEffect, useRef, useState } from 'react'
import * as barsStreamManager from '../lib/barsStreamManager'

/**
 * Live tick-by-tick prices for a list of symbols, sourced from the Massive
 * bars WebSocket (T/A/AM channels) — the SAME reliable feed the chart's
 * developing candle rides. This exists because the Finnhub price SSE
 * (/api/stream/prices) drops/rotates symbols under its tier cap, so many
 * names (e.g. OKTA) go minutes without a tick; the Massive feed does not.
 *
 * Returns { SYM: { price, ts } } where price is the developing 1-min bar's
 * close (= the latest trade). Bounded to the caller's symbol set — subscribing
 * a large universe fans out the bars WS, so pass only what's on screen.
 *
 * Overlay this on top of useRealtimePrices: take `price` from here (fast) and
 * `prev_close` from the REST poll (which the bars feed does not carry).
 */
export default function useRealtimeBarPrices(symbols = [], maxSymbols = 50) {
  // Stable, sorted, deduped subscription key — capped so a user expanding many
  // themes can't fan the bars WS out past one connection's worth of pairs
  // (MAX_BARS_PAIRS). Symbols past the cap keep the REST/Finnhub fallback.
  const key = symbols.length
    ? [...new Set(symbols)].filter(Boolean).sort().slice(0, maxSymbols).join(',')
    : ''
  const [prices, setPrices] = useState({})
  const pricesRef = useRef({})

  useEffect(() => {
    if (!key) {
      pricesRef.current = {}
      setPrices({})
      return undefined
    }
    const syms = key.split(',')

    // Coalesce a burst of ticks (across many symbols) into one render per frame.
    let rafPending = false
    const flush = () => {
      rafPending = false
      setPrices(pricesRef.current)
    }
    const schedule = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(flush)
    }

    const unsubs = syms.map((sym) =>
      barsStreamManager.subscribe(sym, '1', {
        onBar: (data) => {
          // T ticks update the developing bar's close; A/AM refine it. Either way
          // bar.c is the freshest trade price. (A pure-trade payload, if it ever
          // arrives here, exposes it as trade.p.)
          const c = data?.bar?.c ?? data?.trade?.p
          if (c == null || !Number.isFinite(c)) return
          const prev = pricesRef.current[sym]
          if (prev && prev.price === c) return   // no change → skip a render
          pricesRef.current = { ...pricesRef.current, [sym]: { price: c, ts: Date.now() } }
          schedule()
        },
      }),
    )

    return () => {
      unsubs.forEach((u) => { try { u() } catch { /* already gone */ } })
    }
  }, [key])

  return prices
}
