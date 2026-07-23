// app/src/pages/FlowRender.jsx — headless, token-gated "Notable Options Flow" export.
//
// Renders the prior session's most-notable directional bets as a branded panel for
// the Morning Wire → Substack newsletter: a one-line net read + one conviction-ranked
// list (ticker · skew% calls/puts · $net · contract). A headless browser navigates
// here, waits for window.__panelReady, and screenshots #panel-export.
//
// Public route (no AuthGuard). Data from /api/r/flow?token= (token-gated read of the
// engine's wire["options_flow"]). ?token= checked vs VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

function FlowRow({ r }) {
  const bull = String(r.dir || '').toUpperCase() === 'BULL'
  const color = bull ? '#3fb950' : '#e5534b'
  const skew = r.skew != null ? `${r.skew}% ` : ''
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 14px',
      background: '#121212', border: '1px solid #232323', borderRadius: 9, marginBottom: 7,
    }}>
      <span style={{ minWidth: 66, fontWeight: 800, fontSize: 15, color: '#f3f3f3', fontFamily: "'IBM Plex Mono',monospace" }}>
        {String(r.sym || '').toUpperCase()}
        {r.er && <span style={{ marginLeft: 5, fontSize: 8.5, fontWeight: 700, color: '#c9a84c', border: '1px solid rgba(201,168,76,0.5)', borderRadius: 3, padding: '0 3px', verticalAlign: 'middle' }}>ER</span>}
      </span>
      <span style={{ minWidth: 118, fontWeight: 700, fontSize: 13.5, color }}>
        {bull ? '▲' : '▼'} {skew}{r.cp_word || ''}
      </span>
      <span style={{ minWidth: 60, fontWeight: 700, fontSize: 13.5, color: '#e8e8e8' }}>{r.net_spoken || ''}</span>
      <span style={{ flex: 1, textAlign: 'right', fontSize: 13, color: '#9aa7b4', fontFamily: "'IBM Plex Mono',monospace" }}>{r.contract || ''}</span>
    </div>
  )
}

export default function FlowRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const n = Math.min(16, Math.max(1, parseInt(sp.get('n') || '10', 10)))
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/flow?token=${encodeURIComponent(token)}&n=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setData({ flow: Array.isArray(d.flow) ? d.flow : [], read: d.net_read || '' }))
      .catch(() => setErr('data unavailable'))
  }, [token, n])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>
  const { flow, read } = data

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>NOTABLE OPTIONS FLOW</span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '14px 18px 8px' }}>
          {read && (
            <div style={{ color: '#d0d0d0', fontSize: 13.5, lineHeight: 1.5, marginBottom: 6 }}>{read}</div>
          )}
          <div style={{ color: '#7f8ea3', fontSize: 11, marginBottom: 12 }}>
            Prior session · ranked by conviction (size × how one-sided) · skew = % of premium that way
          </div>
          {flow.length === 0 && <div style={{ color: '#888', padding: 12 }}>No notable flow.</div>}
          {flow.map((r, i) => <FlowRow key={i} r={r} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Sentiment, not signals</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
