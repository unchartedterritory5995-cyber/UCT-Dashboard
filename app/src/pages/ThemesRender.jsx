// app/src/pages/ThemesRender.jsx — headless, token-gated "Theme Tracker" export.
//
// Renders theme leaders & laggards (by period return) with each theme's top holdings
// and a relative-size bar — the tradeable "where's the money" view. Screenshotted
// into the Morning Wire → Substack Market Internals section.
//
// Public route (no AuthGuard). Data from /api/r/themes?token= (token-gated read of
// the engine's wire["themes"]). ?token= checked vs VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

function Row({ r, max, up }) {
  const color = up ? '#3fb950' : '#e5534b'
  const w = Math.max(4, Math.round((Math.abs(r.ret) / (max || 1)) * 100))
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', inset: '0 auto 0 0', width: `${w}%`, zIndex: 0, opacity: 0.1, background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <span style={{ position: 'relative', zIndex: 1, minWidth: 190, fontWeight: 700, fontSize: 14.5, color: '#f0f0f0' }}>{r.name}</span>
      <span style={{ position: 'relative', zIndex: 1, minWidth: 64, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 800, fontSize: 15, color }}>
        {r.ret > 0 ? '+' : ''}{r.ret}%
      </span>
      <span style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(r.holdings || []).map((s) => (
          <span key={s} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: '#c9a84c', background: 'rgba(201,168,76,0.1)', padding: '1px 7px', borderRadius: 999 }}>{s}</span>
        ))}
      </span>
    </div>
  )
}

function Group({ title, rows, max, up }) {
  if (!rows || !rows.length) return null
  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 800, letterSpacing: '1px', color: up ? '#3fb950' : '#e5534b', padding: '12px 16px 4px' }}>
        {up ? '▲ LEADERS' : '▼ LAGGARDS'}
      </div>
      {rows.map((r, i) => <Row key={i} r={r} max={max} up={up} />)}
    </div>
  )
}

export default function ThemesRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const period = sp.get('period') || '1W'
  const n = Math.min(10, Math.max(3, parseInt(sp.get('n') || '6', 10)))
  const w = Math.min(1000, Math.max(560, parseInt(sp.get('w') || '760', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/themes?token=${encodeURIComponent(token)}&period=${encodeURIComponent(period)}&n=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr('data unavailable'))
  }, [token, period, n])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>
  const max = data.max_abs || 1

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#e8e8e8' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', justifyContent: 'space-between' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>THEMES — WHERE THE MONEY IS · {data.period}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '4px 0 6px' }}>
          <Group title="leaders" rows={data.leaders} max={max} up />
          <Group title="laggards" rows={data.laggards} max={max} up={false} />
        </div>
        <div style={{ height: 20, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10, justifyContent: 'space-between' }}>
          <span>Ticker = top holdings · UCT theme taxonomy</span><span style={{ color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
