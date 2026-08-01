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

import { useEffect, useMemo, useState } from 'react'
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

  // The owner's saved chart settings.
  //
  // This page runs LOGGED OUT, so it has no session and never saw his
  // `chart_settings` — it silently rendered the schema defaults. He runs a light
  // theme; every Sunday Scans chart came out near-black (rgb(14,15,13)), which
  // is why the newsletter charts never looked like the ones he exports from the
  // app himself. Same shape as the extendedHoursShading bug this route already
  // had: a headless page inherits `?? default` for everything nobody passes it.
  //
  // Fetched (not a URL param) so the caller needs to know nothing about chart
  // settings — the Friday job's URL is unchanged and every future theme edit
  // reaches the newsletter with no pipeline change.
  const [ownerSettings, setOwnerSettings] = useState(null)
  const [settingsSettled, setSettingsSettled] = useState(false)
  useEffect(() => {
    let alive = true
    const done = (v) => { if (alive) { setOwnerSettings(v); setSettingsSettled(true) } }
    fetch(`/api/r/chart-settings?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => done(j?.chart_settings || null))
      // Fails OPEN to today's defaults: a settings lookup must never cost him
      // the chart itself.
      .catch(() => done(null))
    return () => { alive = false }
  }, [token])

  // Identity-stable: settingsOverride is a memo dep on StockChart.
  const csOverride = useMemo(() => ownerSettings || null, [ownerSettings])

  // Company / price / change, when the caller did not supply them.
  //
  // The manual export's header reads "SPY (State Street SPDR S&P 500 ETF Trust)
  // D $747.03 +0.72%" because composeScreenshot has the live chart's own state
  // to hand. The Sunday Scan pipeline passes only sym+tf, so the same header
  // rendered as a bare "SPY Daily" - the two charts sat side by side in one
  // issue with different headers.
  //
  // Fetched HERE rather than threaded through the pipeline: render_many's specs
  // are (sym, tf) tuples, and widening that plumbing to carry presentation data
  // would put newsletter-formatting concerns inside the renderer's call
  // signature. The page already knows how to ask for its own facts.
  const [meta, setMeta] = useState({ company: '', price: null, chg: null })
  useEffect(() => {
    if (!sym) return undefined
    let alive = true
    const want = { company: company || '', price: price > 0 ? price : null, chg: Number.isFinite(chg) ? chg : null }
    if (want.company && want.price != null && want.chg != null) { setMeta(want); return undefined }
    Promise.allSettled([
      want.company ? Promise.resolve(null) : fetch(`/api/ticker-meta/${encodeURIComponent(sym)}`).then((r) => (r.ok ? r.json() : null)),
      (want.price != null && want.chg != null)
        ? Promise.resolve(null)
        : fetch(`/api/bars/${encodeURIComponent(sym)}?tf=D&bars=2`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([m, b]) => {
      if (!alive) return
      const bars = b?.value?.bars || b?.value || []
      const last = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null
      const prev = Array.isArray(bars) && bars.length > 1 ? bars[bars.length - 2] : null
      const c = last?.c ?? last?.close
      const pc = prev?.c ?? prev?.close
      setMeta({
        company: want.company || m?.value?.name || m?.value?.company || '',
        price: want.price != null ? want.price : (Number.isFinite(c) ? c : null),
        chg: want.chg != null ? want.chg
          : (Number.isFinite(c) && Number.isFinite(pc) && pc ? ((c - pc) / pc) * 100 : null),
      })
    })
    return () => { alive = false }
  }, [sym, company, price, chg])

  // Signal readiness once the chart has had time to fetch bars + paint. No
  // onReady hook on StockChart, so a paint-settle delay is the pragmatic guard.
  //
  // Gated on the settings landing first — otherwise the screenshot can be taken
  // while the chart is still wearing the default theme, and the fix would land
  // intermittently (the worst kind of "it works on my machine").
  useEffect(() => {
    window.__chartReady = false
    if (!settingsSettled) return undefined
    const t = setTimeout(() => { window.__chartReady = true }, 3500)
    return () => clearTimeout(t)
  }, [sym, tf, settingsSettled])

  if (TOKEN && token !== TOKEN) return <div style={{ color: '#e74c3c', padding: 20 }}>unauthorized</div>
  if (!sym) return <div style={{ color: '#888', padding: 20 }}>no symbol</div>

  const chartH = h - 60  // 40px header + 20px footer

  // Chrome follows the chart's own canvas colour, exactly as composeScreenshot
  // does ("fill EVERYTHING with the chart's own background... so the header/
  // footer blend seamlessly"). Hardcoding #0a0a0a/#161616 was invisible while
  // the export was always dark; the moment the owner's light theme arrives, a
  // near-black header strip over a cream chart reads as a broken image.
  const pageBg = ownerSettings?.background || '#0a0a0a'
  const chromeBg = ownerSettings?.background || '#161616'
  const chromeText = ownerSettings?.textColor || '#888'

  return (
    <div style={{ background: pageBg, minHeight: '100vh' }}>
      {/* Hide the floating drawing toolbar overlay in the export (it's not part
          of the real composeScreenshot canvas capture). */}
      <style>{`#chart-export [class*="toolbar" i],
        #chart-export [class*="scaleToggle" i],
        #chart-export [class*="resetView" i],
        #chart-export [class*="homeBtn" i]{display:none !important}
        #chart-export{font-family:'Instrument Sans',-apple-system,Segoe UI,sans-serif}`}</style>
      <div id="chart-export" style={{ width: w, background: pageBg }}>
        <div style={{ height: 40, background: chromeBg, display: 'flex', alignItems: 'center', padding: '0 16px', color: chromeText, fontSize: 14, position: 'relative' }}>
          <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 18 }}>{sym}</span>
          {meta.company && <span style={{ marginLeft: 8, color: '#9aa08f', fontSize: 13 }}>({meta.company})</span>}
          {/* RAW code ('D'), not 'Daily' - composeScreenshot draws opts.tf
              verbatim, and these two headers sit in the same issue. */}
          <span style={{ marginLeft: 12 }}>{tf}</span>
          {/* NOT hardcoded #fff — white on a cream canvas is an invisible price. */}
          {meta.price != null && <span style={{ marginLeft: 12, color: chromeText, fontWeight: 600 }}>${meta.price.toFixed(2)}</span>}
          {meta.chg != null && <span style={{ marginLeft: 8, color: meta.chg >= 0 ? '#22c55e' : '#ef4444' }}>{meta.chg >= 0 ? '+' : ''}{meta.chg.toFixed(2)}%</span>}
          <span style={{ position: 'absolute', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 13, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        {/* volInSeparatePane = volumeSeparatePane || cs.volume.separatePane.
            His SAVED separatePane is false, but the workspace widget passes the
            PROP, so his live chart — and every chart he exports by hand — puts
            volume in its own pane. This page passed neither and drew it overlaid
            on the price grid. The prop also gates showVolLegend, which is why
            the "$ Vol / Avg 50D" strip was missing from newsletter charts. */}
        <div style={{ width: w, height: chartH }}>
          <StockChart
            sym={sym}
            tf={tf}
            height={`${chartH}px`}
            priceLines={priceLines}
            visibleBarsOverride={barsOverride}
            forceExtendedHours={forceExt}
            settingsOverride={csOverride}
            volumeSeparatePane
            liveUpdates={false}
          />
        </div>
        <div style={{ height: 20, background: chromeBg, display: 'flex', alignItems: 'center', padding: '0 16px', color: chromeText, fontSize: 10 }}>
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
