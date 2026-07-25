// app/src/pages/CatalystsRender.jsx — headless, token-gated Stock-Catalysts export.
//
// Renders the top-N prominent Stock Catalysts as branded cards for the Morning
// Wire → Substack newsletter. A headless browser navigates here, waits for
// window.__panelReady, and screenshots #panel-export.
//
// Public route (no AuthGuard). Data comes from /api/r/catalysts?token= (a
// token-gated public twin of the auth-gated /api/catalysts/today). Logos use the
// public /api/ticker-logo proxy. ?token= is checked against VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import HighlightThesis from '../utils/highlightThesis'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const TAG_STYLE = {
  Catalyst: { background: 'rgba(56,132,255,0.14)', color: '#60a5fa' },
  Earnings: { background: 'rgba(74,222,128,0.14)', color: '#4ade80' },
  Gapper: { background: 'rgba(251,191,36,0.14)', color: '#fbbf24' },
  News: { background: 'rgba(180,180,180,0.14)', color: '#cbd5e1' },
}

const fmtPrice = (v) => (Number.isFinite(v) && v > 0 ? `$${v.toFixed(2)}` : '—')
const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '')
const fmtVolX = (v) => {
  if (!Number.isFinite(v) || v <= 0) return ''
  const dp = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(dp)}×`
}

function CatalystCard({ row }) {
  const sym = (row.ticker || '').toUpperCase()
  const tag = row.catalyst_type && row.catalyst_type !== 'None' ? row.catalyst_type : (row.tag || 'Catalyst')
  const tagStyle = TAG_STYLE[row.tag] || TAG_STYLE.Catalyst
  const chg = Number(row.gap_pct)
  return (
    <div style={{ display: 'flex', gap: 14, padding: '16px 18px', background: '#121212', border: '1px solid #232323', borderRadius: 10, marginBottom: 12 }}>
      <img
        src={`/api/ticker-logo/${sym}?v=2`}
        alt=""
        style={{ width: 40, height: 40, borderRadius: 8, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 18, letterSpacing: '0.5px' }}>{sym}</span>
          <span style={{ color: '#fff', fontSize: 14 }}>{fmtPrice(Number(row.price))}</span>
          {Number.isFinite(chg) && (
            <span style={{ fontSize: 14, fontWeight: 600, color: chg >= 0 ? '#22c55e' : '#ef4444' }}>{fmtPct(chg)}</span>
          )}
          {fmtVolX(Number(row.vol_x)) && (
            <span style={{ fontSize: 13, color: '#9aa08f' }}>{fmtVolX(Number(row.vol_x))} vol</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, letterSpacing: '0.4px', ...tagStyle }}>
            {String(tag).toUpperCase()}
          </span>
        </div>
        <div style={{ marginTop: 8, color: '#d4d4d4', fontSize: 13.5, lineHeight: 1.55 }}>
          <HighlightThesis text={row.thesis_text || ''} />
        </div>
      </div>
    </div>
  )
}

export default function CatalystsRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const n = Math.min(6, Math.max(1, parseInt(sp.get('n') || '3', 10)))
  const w = Math.min(1400, Math.max(600, parseInt(sp.get('w') || '1000', 10)))
  const quality = sp.get('quality') || ''   // 1 = drop "no catalyst found" rows
  const compact = sp.get('compact') || ''   // 1 = clamp thesis to 2 sentences
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    const extra = `${quality ? `&quality=${quality}` : ''}${compact ? `&compact=${compact}` : ''}`
    fetch(`/api/r/catalysts?token=${encodeURIComponent(token)}&n=${n}${extra}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setErr('data unavailable'))
  }, [token, n, quality, compact])

  // Signal readiness once rows are in + logos have had time to resolve/paint.
  useEffect(() => {
    if (rows == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 2200)
    return () => clearTimeout(t)
  }, [rows])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (rows == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>TODAY'S TOP CATALYSTS</span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '16px 18px 8px' }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No catalysts.</div>}
          {rows.map((row, i) => <CatalystCard key={row.ticker || i} row={row} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Stock Catalysts</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
