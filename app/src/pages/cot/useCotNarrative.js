// app/src/pages/cot/useCotNarrative.js
//
// Fetches the grounded, server-cached "weekly read" for ONE report week.
// The caller decides when it is worth a request (only the latest report by
// default); this hook dedupes by (symbol, reportDate, facts) so hover churn
// and re-renders never re-post. A non-ok service status or a failed request
// resolves to 'unavailable' — the templated read is always the fallback.
import { useEffect, useState } from 'react'

export function useCotNarrative({ symbol, name, reportDate, facts, enabled }) {
  const [state, setState] = useState({ status: 'idle', text: null, key: null })

  const key = enabled && symbol && reportDate && facts
    ? `${symbol}|${reportDate}|${JSON.stringify(facts)}`
    : null

  // Dedupe is the dependency itself: the effect re-runs only when `key`
  // changes. (A ref-based "already requested" guard here would swallow the
  // response under StrictMode's mount → cleanup → re-run, leaving the hook on
  // 'loading' forever — that shipped once in dev and was caught on screen.)
  useEffect(() => {
    if (!key) {
      setState({ status: 'idle', text: null, key: null })
      return
    }

    let cancelled = false
    setState({ status: 'loading', text: null, key })
    fetch(`/api/cot/${encodeURIComponent(symbol)}/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_date: reportDate, name: name || '', facts }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        if (d && d.status === 'ok' && d.text) setState({ status: 'ok', text: d.text, key })
        else setState({ status: 'unavailable', text: null, key })
      })
      .catch(() => { if (!cancelled) setState({ status: 'unavailable', text: null, key }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Never hand back a stale week's text under a new key.
  if (state.key !== key && key) return { status: 'loading', text: null }
  return { status: state.status, text: state.text }
}
