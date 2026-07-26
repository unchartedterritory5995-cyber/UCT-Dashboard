// app/src/pages/MoversRender.jsx — headless, token-gated Pre-Market Movers export.
//
// Renders the wire's cap×direction mover buckets (Top Small-Cap Positive /
// Top Big-Cap Positive / Top Big-Cap Negative) as a branded panel: logo ·
// ticker · the grounded "why" · a big colored % — replacing the typed bullet
// lists in the newsletter. Single full-width rows (the earncards lesson:
// clarity beats density at email width).
//
// Data arrives in the URL (?data= base64url JSON of the RESOLVED buckets) —
// blurb resolution (catalyst → analyst → earnings → headline → company) lives
// wire-side; this page is presentation only. ?token= checked against
// VITE_CHART_RENDER_TOKEN.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const BUCKET_STYLE = {
  small_up: { color: '#22c55e' },
  big_up: { color: '#22c55e' },
  big_dn: { color: '#ef4444' },
}

function Row({ it, up }) {
  const dim = !it.has_why
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid #1b1b1b' }}>
      <img src={`/api/ticker-logo/${it.sym}?v=2`} alt=""
           style={{ width: 32, height: 32, borderRadius: 8, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
      <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 17, letterSpacing: '0.4px', width: 78, flex: '0 0 auto' }}>{it.sym}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 1.35,
                     color: dim ? '#8b8f84' : '#e4e4e4',
                     overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {it.news || ''}
      </span>
      <span style={{ flex: '0 0 auto', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                     color: up ? '#22c55e' : '#ef4444', minWidth: 74, textAlign: 'right' }}>
        {it.pct}
      </span>
    </div>
  )
}

function Bucket({ b }) {
  const up = b.key !== 'big_dn'
  const c = (BUCKET_STYLE[b.key] || {}).color || '#e8e8e8'
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px 4px' }}>
        <span style={{ color: c, fontSize: 15 }}>{b.marker}</span>
        <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 14, letterSpacing: '0.7px', textTransform: 'uppercase' }}>{b.title}</span>
      </div>
      {(b.items || []).map((it, i) => <Row key={it.sym || i} it={it} up={up} />)}
    </div>
  )
}

function decodeData(b64) {
  try {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/')
    const pad = std + '='.repeat((4 - (std.length % 4)) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(pad))))
  } catch {
    return null
  }
}

export default function MoversRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const w = Math.min(1200, Math.max(700, parseInt(sp.get('w') || '1000', 10)))
  const payload = useMemo(() => decodeData(sp.get('data') || ''), [sp])
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    const t = setTimeout(() => { window.__panelReady = true }, 2400) // logos settle
    return () => clearTimeout(t)
  }, [token, payload])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  const buckets = (payload && payload.buckets) || []

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            PRE-MARKET MOVERS <span style={{ color: '#8b8f84', fontWeight: 700 }}>· WITH THE WHY</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '12px 18px 6px' }}>
          {buckets.length === 0 && <div style={{ color: '#888', padding: 12 }}>No qualifying movers.</div>}
          {buckets.map((b) => <Bucket key={b.key} b={b} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Catalyst-first: names with a real story ride the top of each list</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
