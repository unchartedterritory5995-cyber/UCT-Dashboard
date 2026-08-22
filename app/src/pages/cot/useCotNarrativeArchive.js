// app/src/pages/cot/useCotNarrativeArchive.js
//
// The written reads already stored for a symbol, keyed by report date — what
// the rail shows when you scrub back to a week whose read was generated at the
// time (by the Friday pre-warm or by someone opening the symbol that week).
// Always an object; {} before load, on failure, or without a symbol, so the
// rail can index it without guards.
import { useEffect, useState } from 'react'

export function useCotNarrativeArchive(symbol) {
  const [state, setState] = useState({ symbol: null, map: {} })

  useEffect(() => {
    if (!symbol) return undefined
    let cancelled = false
    fetch(`/api/cot/${encodeURIComponent(symbol)}/narratives?limit=260`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        const map = {}
        for (const row of (d?.rows || [])) {
          if (row?.report_date && row.text && !map[row.report_date]) map[row.report_date] = row.text
        }
        setState({ symbol, map })
      })
      .catch(() => { if (!cancelled) setState({ symbol, map: {} }) })
    return () => { cancelled = true }
  }, [symbol])

  return state.symbol === symbol ? state.map : EMPTY
}

const EMPTY = Object.freeze({})
