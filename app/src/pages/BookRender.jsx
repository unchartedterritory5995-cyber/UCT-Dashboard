// app/src/pages/BookRender.jsx — headless, token-gated Full Book export.
//
// Renders the 20 leadership names as a branded board image for the Morning
// Wire → Substack newsletter, replacing the old typed-out list. Split into two
// parts (?part=1 → ranks 1-10, ?part=2 → 11-20) so each image stays legible at
// newsletter width — same lesson as the Breadth Monitor split. A headless
// browser waits for window.__panelReady and screenshots #panel-export.
//
// Public route (no AuthGuard). Data: /api/r/book (token-gated public twin of
// the wire leadership the letter already publishes). Logos via /api/ticker-logo.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const fmt = (v) => {
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v >= 100 ? v.toFixed(v % 1 ? 2 : 0) : v.toFixed(2)
}

function Row({ r }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid #1b1b1b' }}>
      <span style={{ width: 34, textAlign: 'right', color: '#4c4c46', fontWeight: 800, fontSize: 20, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{r.rank}</span>
      <img src={`/api/ticker-logo/${r.sym}?v=2`} alt="" style={{ width: 34, height: 34, borderRadius: 8, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 18, letterSpacing: '0.4px' }}>{r.sym}</span>
          <span style={{ color: '#8b8f84', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.theme}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 3, fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: '#d4d4d4' }}>
          <span><span style={{ color: '#3cb868', fontWeight: 700 }}>E</span> {fmt(r.entry)}</span>
          <span><span style={{ color: '#e74c3c', fontWeight: 700 }}>S</span> {fmt(r.stop)}</span>
          <span><span style={{ color: '#c9a84c', fontWeight: 700 }}>T1</span> {fmt(r.t1)}</span>
          <span><span style={{ color: '#c9a84c', fontWeight: 700 }}>T2</span> {fmt(r.t2)}</span>
        </div>
      </div>
      <span style={{ fontSize: 11, color: '#9aa08f', border: '1px solid #2a2a26', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{r.setup}</span>
      <span style={{ width: 52, textAlign: 'center', flex: '0 0 auto', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 8, padding: '5px 0', color: '#c9a84c', fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
      {Number.isFinite(Number(r.score)) ? Number(r.score).toFixed(1) : '—'}</span>
    </div>
  )
}

export default function BookRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const part = parseInt(sp.get('part') || '0', 10)
  const w = Math.min(1200, Math.max(600, parseInt(sp.get('w') || '980', 10)))
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/book?token=${encodeURIComponent(token)}&part=${part}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setErr('data unavailable'))
  }, [token, part])

  useEffect(() => {
    if (rows == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 2400) // logos settle
    return () => clearTimeout(t)
  }, [rows])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (rows == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const sub = part === 1 ? 'RANKS 1–10' : part === 2 ? 'RANKS 11–20' : 'ALL 20'
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            THE FULL BOOK <span style={{ color: '#8b8f84', fontWeight: 700 }}>· {sub}</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '6px 18px 10px' }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No board today.</div>}
          {rows.map((r) => <Row key={r.sym} r={r} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Leadership 20 · entry / stop / targets · UCT score</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
