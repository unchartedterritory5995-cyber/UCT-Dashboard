// app/src/pages/FlowRender.jsx — headless, token-gated "Notable Options Flow" export.
//
// The prior session's biggest single-contract option orders. Each row leads with the
// contract (strike + call/put, the hero), plus: a quiet sentiment accent (stripe +
// size-bar color, classified bull/bear from the buy/sell side), a relative-size bar,
// the timeframe/urgency (near-dated vs LEAP), whether it was bought/sold, and a vol/OI
// "×N" tag when unusual. A headless browser waits for window.__panelReady and
// screenshots #panel-export.
//
// Public route (no AuthGuard). Data from /api/r/flow?token= (token-gated read of the
// engine's wire["options_flow"]). ?token= checked vs VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''
const MONO = "'IBM Plex Mono',monospace"
const GRID = { display: 'grid', gridTemplateColumns: '66px 140px 54px 40px 56px 78px 46px 1fr', gap: 9, alignItems: 'baseline' }
const URGC = { hot: '#e8a34d', near: '#9aa7b4', mid: '#8b96a3', leap: '#6b7480' }

// Vol/OI colour carries the confirmation read, because the number alone is easy
// to skim past. Volume clearing open interest cannot be a closing trade; volume
// UNDER open interest cannot be told apart from one — that ambiguity is the
// point, and it used to be invisible.
const OI_COLOR = {
  'NEW': '#c9a84c', 'NEW + GREW': '#c9a84c', 'GREW': '#9aa7b4',
  'LIKELY NEW': '#9aa7b4', 'UNCONFIRMED': '#8a6a3a', 'CLOSING': '#e5534b',
}

function HeaderRow() {
  const cell = { fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#6b7480' }
  return (
    <div style={{ ...GRID, padding: '9px 14px 9px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 6 }}>
      <span style={cell}>Stock</span><span style={cell}>Strike</span><span style={cell}>Exp</span>
      <span style={cell}>DTE</span><span style={cell}>Vol/OI</span><span style={cell}>Type</span>
      <span style={cell}>Side</span>
      <span style={{ ...cell, textAlign: 'right' }}>Premium</span>
    </div>
  )
}

function OrderRow({ o }) {
  const call = String(o.cp || '').toUpperCase() === 'C'
  const sentColor = o.sentiment === 'bull' ? '#3fb950' : '#e5534b'
  const z = { position: 'relative', zIndex: 1 }
  return (
    <div style={{
      ...GRID, position: 'relative', padding: '11px 14px 11px 18px', background: '#141414',
      border: '1px solid #202020', borderRadius: 9, marginBottom: 7, overflow: 'hidden',
    }}>
      <span style={{ position: 'absolute', inset: '0 auto 0 0', width: `${o.size_pct || 0}%`, zIndex: 0, opacity: 0.12, borderRadius: 9, background: `linear-gradient(90deg, ${sentColor}, transparent)` }} />
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 2, background: sentColor, borderRadius: '9px 0 0 9px' }} />
      <span style={{ ...z, fontWeight: 700, fontSize: 13, color: '#e8e8e8', fontFamily: MONO }}>
        {String(o.sym || '').toUpperCase()}
        {o.er && <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 700, color: '#c9a84c', border: '1px solid rgba(201,168,76,0.5)', borderRadius: 3, padding: '0 3px', verticalAlign: 'middle' }}>ER</span>}
        {o.streak >= 2 && <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 700, color: sentColor, border: `1px solid ${sentColor}66`, borderRadius: 3, padding: '0 3px', verticalAlign: 'middle' }}>{o.streak}D</span>}
      </span>
      <span style={{ ...z, fontWeight: 800, fontSize: 15, color: call ? '#3fb950' : '#e5534b', fontFamily: MONO, letterSpacing: '0.2px' }}>{o.strike_label} {o.call_put}</span>
      <span style={{ ...z, fontSize: 12, color: '#8b96a3' }}>{o.exp_label}</span>
      <span style={{ ...z, fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: URGC[o.urgency_cls] || '#8b96a3' }}>{o.urgency}</span>
      {/* Never render an empty cell here. An empty Vol/OI is what let "volume is
          a fifth of the open interest" read as "nothing to report". A dash means
          one specific thing — open interest was unavailable — and says so. */}
      <span style={{ ...z, fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: o.vol_oi_tag ? (OI_COLOR[o.oi_state] || '#c9a84c') : '#4a5058' }}>{o.vol_oi_tag || '—'}</span>
      {/* A sweep lifts offers across exchanges; a block is negotiated. Three rows
          came back from the desk marked "block trade not a sweep" because the
          panel had no way to say which was which. */}
      <span style={{ ...z, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.3px',
        color: String(o.trade_type || '').startsWith('SWEEP') ? '#7fb3d5' : '#6b7480' }}>{o.trade_type}</span>
      <span style={{ ...z, fontFamily: MONO, fontSize: 10.5, color: '#8b96a3' }}>{o.bought}</span>
      <span style={{ ...z, textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: '#e8e8e8' }}>{o.prem_spoken}</span>
    </div>
  )
}

export default function FlowRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const n = Math.min(16, Math.max(1, parseInt(sp.get('n') || '10', 10)))
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/flow?token=${encodeURIComponent(token)}&n=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setErr('data unavailable'))
  }, [token, n])

  useEffect(() => {
    if (orders == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [orders])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (orders == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

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
          <div style={{ color: '#7f8ea3', fontSize: 11.5, marginBottom: 12 }}>
            Prior session · ranked by aggression + open-interest confirmation · <span style={{ color: '#c9a84c' }}>×</span> = volume vs open interest (<span style={{ color: '#8a6a3a' }}>under 1× can&rsquo;t be told from a close</span>) · <span style={{ color: '#7fb3d5' }}>SWEEP</span> lifts offers, BLOCK is negotiated · <span style={{ color: '#c9a84c' }}>ER</span> = reports soon
          </div>
          {orders.length === 0 && <div style={{ color: '#888', padding: 12 }}>No notable flow.</div>}
          {orders.length > 0 && <HeaderRow />}
          {orders.map((o, i) => <OrderRow key={i} o={o} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Sentiment, not signals</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
