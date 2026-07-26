// app/src/pages/EarnCardsRender.jsx — headless, token-gated "Set to Report" export.
//
// Renders the upcoming marquee reporters as a 2-column grid of company cards
// (logo · ticker · report pill · Last-Q vs Estimate rows with mini bars ·
// YoY growth chips) for the Morning Wire → Substack newsletter, replacing the
// typed 4-line blocks. The DATA ARRIVES IN THE URL (?data= base64url JSON) —
// the estimates set only exists wire-side at build time, so shipping it in the
// request keeps one source of truth and zero backend drift.
//
// Public route (no AuthGuard); ?token= checked against VITE_CHART_RENDER_TOKEN.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const SESS = {
  AMC: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  BMO: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  TBD: { color: '#9aa08f', bg: 'rgba(180,180,180,0.10)' },
}

const revB = (m) => {
  const v = Number(m)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`
}
const eps = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—')

function Chip({ label, pct }) {
  const v = Number(pct)
  if (!Number.isFinite(v)) return null
  const up = v >= 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 800,
                   color: up ? '#22c55e' : '#ef4444', background: up ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                   border: `1px solid ${up ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                   borderRadius: 999, padding: '3px 10px', fontVariantNumeric: 'tabular-nums' }}>
      {label} {up ? '▲' : '▼'} {v > 0 ? '+' : ''}{Math.round(v)}%
    </span>
  )
}

function Bars({ last, est }) {
  // Last-Q vs Estimate mini comparison — dim bar vs gold bar, scaled to the max.
  const a = Math.max(0, Number(last) || 0), b = Math.max(0, Number(est) || 0)
  const mx = Math.max(a, b, 1e-9)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, width: 74, flex: '0 0 auto' }}>
      <span style={{ height: 5, borderRadius: 3, width: `${Math.max(8, (a / mx) * 100)}%`, background: '#3f4038' }} />
      <span style={{ height: 5, borderRadius: 3, width: `${Math.max(8, (b / mx) * 100)}%`, background: '#c9a84c' }} />
    </span>
  )
}

function Card({ e }) {
  const s = SESS[(e.session || 'TBD').toUpperCase()] || SESS.TBD
  const lq = e.last_q || {}
  return (
    <div style={{ background: '#121212', border: '1px solid #232323', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={`/api/ticker-logo/${e.sym}?v=2`} alt=""
             style={{ width: 34, height: 34, borderRadius: 8, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 17, letterSpacing: '0.4px' }}>{e.sym}</span>
            {e.on_board && (
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.5px', color: '#c9a84c',
                             border: '1px solid rgba(201,168,76,0.45)', borderRadius: 999, padding: '2px 7px' }}>ON OUR BOARD</span>
            )}
          </div>
          <div style={{ color: '#8b8f84', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || ''}</div>
        </div>
        <span style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <span style={{ display: 'block', color: '#e4e4e4', fontSize: 12.5, fontWeight: 700 }}>{e.label || ''}</span>
          <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 800, padding: '2px 8px',
                         borderRadius: 999, color: s.color, background: s.bg }}>{(e.session || 'TBD').toUpperCase()}</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#9aa08f', padding: '2px 0' }}>
            <span>LAST Q{lq.label ? ` (${lq.label})` : ''}</span>
            <span>EPS {eps(lq.eps)} · {revB(lq.rev_m)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#e8e8e8', fontWeight: 700, padding: '2px 0' }}>
            <span style={{ color: '#c9a84c' }}>EST{e.up_label ? ` (${e.up_label})` : ''}</span>
            <span>EPS {eps(e.eps_est)} · {revB(e.rev_est)}</span>
          </div>
        </div>
        <Bars last={lq.eps} est={e.eps_est} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Chip label="EPS YoY" pct={e.proj_eps_yoy} />
        <Chip label="REV YoY" pct={e.proj_rev_yoy} />
      </div>
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

export default function EarnCardsRender() {
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
  const rows = (payload && payload.rows) || []

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            SET TO REPORT <span style={{ color: '#8b8f84', fontWeight: 700 }}>· THE SESSIONS AHEAD</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No marquee reporters ahead.</div>}
          {rows.map((e, i) => <Card key={e.sym || i} e={e} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Last quarter vs consensus estimate · projected YoY growth</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
