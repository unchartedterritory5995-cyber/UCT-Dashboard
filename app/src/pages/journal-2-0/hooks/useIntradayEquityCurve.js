/**
 * Reconstructs a Robinhood-style 1D intraday portfolio-value curve for a broker
 * account. Fetches each equity holding's 5-minute bars for today's session (in
 * parallel), then sums cash + Σ(close × signedShares) + option market value at
 * each timestamp via the pure buildIntradayEquitySeries. Options are flat (no
 * intraday quote). Only runs when `enabled` (i.e. the 1D range is selected).
 */
import { useEffect, useMemo, useState } from 'react'
import { buildIntradayEquitySeries } from '../lib/intradayEquity'

const etDateOf = (epochSeconds) =>
  new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export default function useIntradayEquityCurve({
  positions = [],
  prices = {},
  optionMarketValue = 0,
  cash = 0,
  enabled = false,
}) {
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(false)

  const symbols = useMemo(
    () => positions.filter((p) => p && !p.isOption && Number.isFinite(p.shares)).map((p) => p.symbol),
    [positions],
  )
  const symKey = symbols.join(',')
  // Snapshot the price map into a stable string only for the fields we need
  // (prev_close / price / change_pct), so the effect doesn't re-run every tick.
  const prevKey = symbols
    .map((s) => `${s}:${prices?.[s]?.prev_close ?? ''}:${prices?.[s]?.price ?? ''}:${prices?.[s]?.change_pct ?? ''}`)
    .join('|')

  useEffect(() => {
    if (!enabled || !symbols.length) {
      setSeries(null)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    Promise.all(
      symbols.map((sym) =>
        fetch(`/api/bars/${encodeURIComponent(sym)}?tf=5&bars=160`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((d) => {
            const bars = (d?.bars || []).filter(
              (b) => typeof b?.t === 'number' && etDateOf(b.t) === todayET,
            )
            return [sym, bars]
          }),
      ),
    ).then((pairs) => {
      if (cancelled) return
      const barsBySymbol = Object.fromEntries(pairs)
      const prevCloseBySymbol = {}
      for (const sym of symbols) {
        const snap = prices?.[sym]
        let pc
        if (Number.isFinite(snap?.prev_close)) pc = snap.prev_close
        else if (Number.isFinite(snap?.price) && Number.isFinite(snap?.change_pct)) {
          pc = snap.price / (1 + snap.change_pct / 100)
        }
        if (Number.isFinite(pc)) prevCloseBySymbol[sym] = pc
      }
      setSeries(buildIntradayEquitySeries(barsBySymbol, positions, prevCloseBySymbol, optionMarketValue, cash))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symKey, prevKey, cash, optionMarketValue])

  return { series, loading }
}
