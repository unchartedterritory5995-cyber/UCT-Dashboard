/**
 * 30-day daily-close sparkline data for the RH-style holdings list.
 * One /api/bars/{sym}?tf=D&bars=30 fetch per holding (parallel), re-run only
 * when the symbol SET changes — mirrors useIntradayEquityCurve's pattern.
 * Fan-out is capped; a failed symbol resolves to NO_SPARKLINE so one miss never
 * blanks the whole list.
 */
import { useEffect, useMemo, useState } from 'react'

const MAX_SYMBOLS = 60

// TERM-033: what a FAILED read draws, by name. A sparkline is decoration beside a row
// whose price and P&L come from elsewhere; an absent line claims nothing, and the next
// symbol-set change asks again.
const NO_SPARKLINE = Object.freeze([])

export default function useHoldingsSparklines(symbols) {
  const [closes, setCloses] = useState({})
  const [loading, setLoading] = useState(false)

  const capped = useMemo(
    () => [...new Set((symbols || []).filter(Boolean))].slice(0, MAX_SYMBOLS),
    [symbols],
  )
  const symKey = capped.join(',')

  useEffect(() => {
    if (!capped.length) {
      setCloses({})
      return undefined
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      capped.map((sym) =>
        fetch(`/api/bars/${encodeURIComponent(sym)}?tf=D&bars=30`, { credentials: 'include' })
          .then((r) => {
            if (!r.ok) throw new Error(`Request failed (${r.status})`)
            return r.json()
          })
          .then(
            (d) => [sym, (d?.bars || []).map((b) => b?.c).filter(Number.isFinite)],
            () => [sym, NO_SPARKLINE],
          ),
      ),
    ).then((pairs) => {
      if (cancelled) return
      setCloses(Object.fromEntries(pairs))
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symKey])

  return { closes, loading }
}
