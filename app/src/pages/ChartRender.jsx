// app/src/pages/ChartRender.jsx — headless, token-gated chart export page.
//
// Renders the REAL StockChart widget full-bleed for a single ticker with the
// entry/stop/target price lines drawn, wrapped in the branded header/footer
// (matches chartScreenshot.js composeScreenshot). A headless browser (the
// Morning Wire → Substack renderer) navigates here, waits for window.__chartReady,
// and screenshots #chart-export → the newsletter's leader chart.
//
// Public route (no AuthGuard). /api/bars is public, so no session is needed.
// A ?token= (checked against VITE_CHART_RENDER_TOKEN) blocks casual abuse.

import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import StockChart from '../components/StockChart'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const TF_LABEL = { '1': '1 min', '5': '5 min', '15': '15 min', '30': '30 min', '60': '1 hr', D: 'Daily', W: 'Weekly', M: 'Monthly' }

export default function ChartRender() {
  const [sp] = useSearchParams()
  const sym = (sp.get('sym') || '').toUpperCase()
  const tf = sp.get('tf') || 'D'
  const company = sp.get('company') || ''
  const price = parseFloat(sp.get('price') || '0')
  const chg = parseFloat(sp.get('chg') || '')
  const w = Math.min(2000, Math.max(600, parseInt(sp.get('w') || '1200', 10)))
  const h = Math.min(1200, Math.max(400, parseInt(sp.get('h') || '620', 10)))
  const token = sp.get('token') || ''
  // Export-only view controls. Absent = today's behavior exactly.
  //   ?bars=N  widen the default zoom (hourly defaults to 65, which spans only
  //            ~4 days once pre/post-market candles are counted)
  //   ?ext=0   REGULAR HOURS ONLY - drops the pre/post shading bands AND the
  //            pre/post candles. The headless page has no saved chart settings,
  //            so it silently inherited `extendedHoursShading ?? true`.
  const barsOverride = (() => { const v = parseInt(sp.get('bars') || '', 10); return Number.isFinite(v) && v > 0 ? Math.min(1200, v) : null })()
  const extParam = sp.get('ext')
  const forceExt = extParam === null ? null : !(extParam === '0' || extParam === 'false')

  const lvl = (k) => { const v = parseFloat(sp.get(k) || ''); return Number.isFinite(v) && v > 0 ? v : null }
  const entry = lvl('entry'), stop = lvl('stop'), t1 = lvl('t1'), t2 = lvl('t2')

  const priceLines = useMemo(() => {
    const L = []
    if (entry) L.push({ price: entry, color: '#3cb868', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Entry' })
    if (stop) L.push({ price: stop, color: '#e74c3c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Stop' })
    if (t1) L.push({ price: t1, color: '#c9a84c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'T1' })
    if (t2) L.push({ price: t2, color: '#c9a84c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'T2' })
    return L
  }, [entry, stop, t1, t2])

  // Signal readiness once the chart has had time to fetch bars + paint. No
  // onReady hook on StockChart, so a paint-settle delay is the pragmatic guard.
  useEffect(() => {
    window.__chartReady = false
    const t = setTimeout(() => { window.__chartReady = true }, 3500)
    return () => clearTimeout(t)
  }, [sym, tf])

  if (TOKEN && token !== TOKEN) return <div style={{ color: '#e74c3c', padding: 20 }}>unauthorized</div>
  if (!sym) return <div style={{ color: '#888', padding: 20 }}>no symbol</div>

  const chartH = h - 60  // 40px header + 20px footer

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh' }}>
      {/* Hide the floating drawing toolbar overlay in the export (it's not part
          of the real composeScreenshot canvas capture). */}
      <style>{`#chart-export [class*="toolbar" i],
        #chart-export [class*="scaleToggle" i],
        #chart-export [class*="resetView" i],
        #chart-export [class*="homeBtn" i]{display:none !important}
        #chart-export{font-family:'Instrument Sans',-apple-system,Segoe UI,sans-serif}`}</style>
      <div id="chart-export" style={{ width: w, background: '#0a0a0a' }}>
        <div style={{ height: 40, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 16px', color: '#888', fontSize: 14, position: 'relative' }}>
          <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 18 }}>{sym}</span>
          {company && <span style={{ marginLeft: 8, color: '#9aa08f', fontSize: 13 }}>({company})</span>}
          <span style={{ marginLeft: 12 }}>{TF_LABEL[tf] || tf}</span>
          {price > 0 && <span style={{ marginLeft: 12, color: '#fff' }}>${price.toFixed(2)}</span>}
          {Number.isFinite(chg) && <span style={{ marginLeft: 8, color: chg >= 0 ? '#22c55e' : '#ef4444' }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
          <span style={{ position: 'absolute', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ width: w, height: chartH }}>
          <StockChart
            sym={sym}
            tf={tf}
            height={`${chartH}px`}
            priceLines={priceLines}
            visibleBarsOverride={barsOverride}
            forceExtendedHours={forceExt}
            liveUpdates={false}
          />
        </div>
        <div style={{ height: 20, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 16px', color: '#666', fontSize: 10 }}>
          {/* Traders read ET — a "03:20 UTC" stamp on a 7:35am letter reads broken. */}
          <span>
            {new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/New_York', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }).format(new Date())} ET
          </span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
