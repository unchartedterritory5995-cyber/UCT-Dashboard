// app/src/pages/CotRender.jsx — headless, token-gated COT Data export for Discord /cot.
//
// The SAME page members see under Breadth → COT Data (CotData.jsx, charts + the
// positioning panel), rendered in its `render` mode: fixed market and lookback, no
// picker or resize handles, no chart animation. chart-renderer screenshots
// #cot-export (api/services/cot_image.py).
//
// Public route (no AuthGuard). ?token= is checked against the bundled render token
// and forwarded to the /api/r/cot doors — every /api/cot/* read is paid and this page
// runs logged OUT, so a paid endpoint is unreachable from here by construction.
//
// Readiness: window.__cotReady is true once the charts are drawn AND the written read
// has settled (stored or not), 'error' when the market has no data. cot_image's probe
// counts the canvases and checks the width below, so a ready-but-blank page is
// discarded rather than posted.
//
// ⛔ The export geometry is INLINE, never in a CSS module: css-modules hashes `#id`
// selectors, which is how /buzz shipped a stretched board for two days.

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import CotData from './CotData'
import { renderTokenOk } from '../lib/renderToken'

export const COT_EXPORT_W = 1560
export const COT_CHART_H = 860
export const COT_LOOKBACKS = { '1Y': 52, '2Y': 104, '3Y': 156, '5Y': 260 }
const SYMBOL_RE = /^[A-Z0-9]{1,6}$/

if (typeof window !== 'undefined') window.__cotBoardW = COT_EXPORT_W

const EXPORT_STYLE = {
  width: `${COT_EXPORT_W}px`,
  boxSizing: 'border-box',
  background: 'var(--bg)',
}

export default function CotRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const symbol = (sp.get('symbol') || '').trim().toUpperCase()
  const weeks = COT_LOOKBACKS[(sp.get('lookback') || '1Y').toUpperCase()] || 52
  const ok = renderTokenOk(token) && SYMBOL_RE.test(symbol)

  useEffect(() => {
    window.__cotReady = ok ? false : 'error'
  }, [ok])

  const render = useMemo(() => ({
    symbol, weeks, token, height: COT_CHART_H,
    onState: (s) => { window.__cotReady = s === 'ready' ? true : 'error' },
  }), [symbol, weeks, token])

  if (!ok) return <div id="cot-export" style={EXPORT_STYLE}>unavailable</div>
  return (
    <div id="cot-export" data-cot-symbol={symbol} style={EXPORT_STYLE}>
      <CotData render={render} />
    </div>
  )
}
