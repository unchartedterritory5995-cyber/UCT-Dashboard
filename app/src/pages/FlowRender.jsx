// app/src/pages/FlowRender.jsx — headless, token-gated "Notable Options Flow" export.
//
// Renders the prior session's conviction-ranked options-flow board as a branded
// panel for the Morning Wire → Substack newsletter. A headless browser navigates
// here, waits for window.__panelReady, and screenshots #panel-export.
//
// Public route (no AuthGuard). Data from /api/r/flow?token= (token-gated public
// read of the engine's wire["options_flow"]). ?token= checked vs VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

function contract(r) {
  const k = r.strike
  const ks = (typeof k === 'number') ? (Number.isInteger(k) ? String(k) : String(k)) : String(k ?? '')
  return `$${ks}${String(r.cp || '').toUpperCase()} ${r.exp || ''}`.trim()
}

function FlowRow({ r }) {
  const bull = String(r.dir || '').toUpperCase() === 'BULL'
  const gold = !!r.gold
  const dirColor = bull ? '#3fb950' : '#e5534b'
  const meta = [r.sector, r.cap_band].filter((x) => x && x !== 'Unknown').join(' · ')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
      background: gold ? 'rgba(201,168,76,0.09)' : '#121212',
      border: `1px solid ${gold ? 'rgba(201,168,76,0.45)' : '#232323'}`,
      borderRadius: 9, marginBottom: 7,
    }}>
      <span style={{ minWidth: 62, fontWeight: 800, fontSize: 15, color: '#fff', fontFamily: "'IBM Plex Mono',monospace" }}>
        {gold && <span style={{ color: '#c9a84c', marginRight: 3 }}>★</span>}
        {String(r.sym || '').toUpperCase()}
      </span>
      <span style={{ minWidth: 58, fontWeight: 700, fontSize: 12, color: dirColor }}>
        {bull ? '▲ BULL' : '▼ BEAR'}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: '#cfcfcf', fontFamily: "'IBM Plex Mono',monospace" }}>
        {contract(r)}
      </span>
      <span style={{ minWidth: 62, textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: '#e8e8e8' }}>
        {r.premium_spoken || ''}
      </span>
      <span style={{
        minWidth: 22, textAlign: 'center', fontWeight: 800, fontSize: 12.5, color: '#0a0a0a',
        background: '#c9a84c', borderRadius: 5, padding: '1px 0',
      }}>
        {r.grade || ''}
      </span>
      <span style={{ minWidth: 130, textAlign: 'right', fontSize: 11, color: '#7f8ea3' }}>{meta}</span>
    </div>
  )
}

function LeadRow({ i, bull }) {
  const color = bull ? '#3fb950' : '#e5534b'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
      <span style={{ minWidth: 58, fontWeight: 800, fontSize: 13.5, color: '#f0f0f0', fontFamily: "'IBM Plex Mono',monospace" }}>
        {String(i.sym || '').toUpperCase()}
        {i.er && <span style={{ marginLeft: 4, fontSize: 8.5, fontWeight: 700, color: '#c9a84c', border: '1px solid rgba(201,168,76,0.5)', borderRadius: 3, padding: '0 3px', verticalAlign: 'middle' }}>ER</span>}
      </span>
      <span style={{ minWidth: 58, fontWeight: 700, fontSize: 13, color }}>{i.net_spoken || ''}</span>
      <span style={{ minWidth: 34, fontSize: 12, color: '#9aa7b4' }}>{i.pct != null ? `${i.pct}%` : ''}</span>
      <span style={{ flex: 1, textAlign: 'right', fontSize: 11.5, color: '#7f8ea3', fontFamily: "'IBM Plex Mono',monospace" }}>{i.contract || ''}</span>
    </div>
  )
}

function LeaderCol({ title, items, bull }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.6px', color: bull ? '#3fb950' : '#e5534b', marginBottom: 5 }}>
        {bull ? '▲ TOP BULLISH' : '▼ TOP BEARISH'}
      </div>
      {(items || []).length === 0 && <div style={{ color: '#666', fontSize: 12, padding: '4px 0' }}>—</div>}
      {(items || []).map((i, k) => <LeadRow key={k} i={i} bull={bull} />)}
    </div>
  )
}

export default function FlowRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const n = Math.min(24, Math.max(1, parseInt(sp.get('n') || '12', 10)))
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/flow?token=${encodeURIComponent(token)}&n=${n}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setData({ rows: Array.isArray(d.rows) ? d.rows : [], lb: d.leaderboard || { bull: [], bear: [] } }))
      .catch(() => setErr('data unavailable'))
  }, [token, n])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>
  const { rows, lb } = data
  const hasLead = (lb.bull && lb.bull.length) || (lb.bear && lb.bear.length)

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
          <div style={{ color: '#7f8ea3', fontSize: 11.5, marginBottom: 10, letterSpacing: '0.3px' }}>
            Prior session · net premium leaderboard + graded prints · ★ = open-interest-confirmed
          </div>
          {hasLead && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: '#c9a84c', marginBottom: 8 }}>NET PREMIUM LEADERBOARD</div>
              <div style={{ display: 'flex', gap: 22 }}>
                <LeaderCol title="bull" items={lb.bull} bull />
                <LeaderCol title="bear" items={lb.bear} bull={false} />
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: '#c9a84c', margin: '4px 0 8px' }}>NOTABLE PRINTS</div>
          )}
          {rows.length === 0 && !hasLead && <div style={{ color: '#888', padding: 12 }}>No notable flow.</div>}
          {rows.map((r, i) => <FlowRow key={i} r={r} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Sentiment, not signals</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
