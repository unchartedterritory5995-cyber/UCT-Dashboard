// app/src/pages/EarnCardsRender.jsx — headless, token-gated "Set to Report" export.
//
// One FULL-WIDTH row per company (owner call 7/26: the 2-col grid shrank the
// type; clarity beats density). Each row: logo · ticker · company · report
// date with a spelled-out session pill, then three plain-English stat columns —
// LAST QUARTER · WALL ST EXPECTS · GROWTH vs LAST YEAR. All the same data,
// zero decoding required.
//
// Data arrives in the URL (?data= base64url JSON) — the estimates set only
// exists wire-side at build time; the wire stays the single source of truth.
// Public route (no AuthGuard); ?token= checked against VITE_CHART_RENDER_TOKEN.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

const SESS = {
  AMC: { label: 'AFTER CLOSE', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  BMO: { label: 'BEFORE OPEN', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  TBD: { label: 'TIME TBD', color: '#9aa08f', bg: 'rgba(180,180,180,0.10)' },
}

const revB = (m) => {
  const v = Number(m)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`
}
const eps = (v) => (Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—')
const pct = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n > 0 ? '+' : ''}${Math.round(n)}%`
}

function StatCol({ label, labelColor, children, minWidth = 0 }) {
  return (
    <div style={{ minWidth, flex: 1 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.8px', color: labelColor, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Growth({ label, v }) {
  const p = pct(v)
  if (p == null) return null
  const up = Number(v) >= 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 14,
                   fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                   color: up ? '#22c55e' : '#ef4444' }}>
      <span style={{ fontSize: 12, color: '#9aa08f', fontWeight: 700 }}>{label}</span>
      {up ? '▲' : '▼'} {p}
    </span>
  )
}

function Row({ e }) {
  const s = SESS[(e.session || 'TBD').toUpperCase()] || SESS.TBD
  const lq = e.last_q || {}
  return (
    <div style={{ background: '#121212', border: '1px solid #232323', borderRadius: 12, padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={`/api/ticker-logo/${e.sym}?v=2`} alt=""
             style={{ width: 40, height: 40, borderRadius: 9, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 21, letterSpacing: '0.4px' }}>{e.sym}</span>
            <span style={{ color: '#9aa08f', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || ''}</span>
            {e.on_board && (
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', color: '#c9a84c',
                             border: '1px solid rgba(201,168,76,0.45)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>ON OUR BOARD</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#e8e8e8', fontSize: 15.5, fontWeight: 800 }}>{e.label || ''}</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', padding: '4px 10px',
                         borderRadius: 999, color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>{s.label}</span>
          {Number.isFinite(e.move_pct) && (
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.4px', padding: '4px 10px',
                           borderRadius: 999, color: '#c9a84c', border: '1px solid rgba(201,168,76,0.45)',
                           whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              ±{e.move_pct.toFixed(1)}% PRICED
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 14, alignItems: 'flex-start' }}>
        <StatCol label={`LAST QUARTER${lq.label ? ` · ${lq.label}` : ''}`} labelColor="#8b8f84">
          <div style={{ fontSize: 16.5, color: '#cfcfcf', fontVariantNumeric: 'tabular-nums' }}>
            EPS <span style={{ fontWeight: 700 }}>{eps(lq.eps)}</span>
            <span style={{ color: '#5c5f56', margin: '0 8px' }}>·</span>
            Revenue <span style={{ fontWeight: 700 }}>{revB(lq.rev_m)}</span>
          </div>
        </StatCol>
        <StatCol label={`WALL ST EXPECTS${e.up_label ? ` · ${e.up_label}` : ''}`} labelColor="#c9a84c">
          <div style={{ fontSize: 16.5, color: '#f0ead8', fontVariantNumeric: 'tabular-nums' }}>
            EPS <span style={{ fontWeight: 800, color: '#c9a84c' }}>{eps(e.eps_est)}</span>
            <span style={{ color: '#5c5f56', margin: '0 8px' }}>·</span>
            Revenue <span style={{ fontWeight: 800, color: '#c9a84c' }}>{revB(e.rev_est)}</span>
          </div>
        </StatCol>
        <StatCol label="GROWTH vs LAST YEAR" labelColor="#8b8f84" minWidth={220}>
          <div>
            <Growth label="EPS" v={e.proj_eps_yoy} />
            <Growth label="REV" v={e.proj_rev_yoy} />
          </div>
        </StatCol>
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
    // The priced move arrives IN the payload (exp_move_pct, computed wire-side
    // for just the shown names) — the full-day enrichment endpoint recomputes
    // 78-120 names and can take minutes cold, which shot chip-less panels.
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
        <div style={{ padding: '14px 18px 8px' }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No marquee reporters ahead.</div>}
          {rows.map((e, i) => <Row key={e.sym || i} e={{ ...e, move_pct: Number(e.exp_move_pct) }} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Last quarter vs Wall St&apos;s estimate · growth vs last year · ±% = the move options are pricing</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
