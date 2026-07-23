// app/src/pages/CalendarRender.jsx — headless, token-gated earnings-calendar export.
//
// Renders a compact "This Week's Earnings" panel (notable names per day, by market
// cap) for the Morning Wire → Substack newsletter, mirroring the dashboard Calendar
// feed. A headless browser navigates here, waits for window.__panelReady, and
// screenshots #panel-export.
//
// Public route (no AuthGuard). /api/calendar and /api/ticker-logo are already
// public — no token needed for data — but ?token= is still checked against
// VITE_CHART_RENDER_TOKEN to keep the page out of casual reach.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''
const PER_SESSION = 4  // notable names per BMO/AMC per day

const SESS = {
  bmo: { label: 'BMO', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  amc: { label: 'AMC', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  tbd: { label: 'TBD', color: '#9aa08f', bg: 'rgba(180,180,180,0.10)' },
}

const byCap = (a, b) => (Number(b.mc_b) || 0) - (Number(a.mc_b) || 0)

function Row({ e, sess }) {
  const sym = (e.sym || '').toUpperCase()
  const s = SESS[sess] || SESS.tbd
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <img src={`/api/ticker-logo/${sym}?v=2`} alt="" style={{ width: 26, height: 26, borderRadius: 6, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
      <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 14, minWidth: 56 }}>{sym}</span>
      <span style={{ color: '#b9b9b9', fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || ''}</span>
      {Number(e.mc_b) > 0 && <span style={{ color: '#6f6f6f', fontSize: 11.5, minWidth: 54, textAlign: 'right' }}>${Number(e.mc_b).toFixed(0)}B</span>}
      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: s.color, background: s.bg, minWidth: 34, textAlign: 'center' }}>{s.label}</span>
    </div>
  )
}

export default function CalendarRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch('/api/calendar')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr('data unavailable'))
  }, [token])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 2200)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const days = data.days || {}
  const dates = Object.keys(days).sort()
  const rendered = dates
    .map((ds) => {
      const d = days[ds] || {}
      const bmo = [...(d.bmo || [])].filter((e) => e.sym).sort(byCap).slice(0, PER_SESSION)
      const amc = [...(d.amc || [])].filter((e) => e.sym).sort(byCap).slice(0, PER_SESSION)
      return { ds, label: d.label || ds, is_today: d.is_today, bmo, amc }
    })
    .filter((d) => d.bmo.length || d.amc.length)

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>THIS WEEK'S EARNINGS</span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '10px 18px 8px' }}>
          {rendered.length === 0 && <div style={{ color: '#888', padding: 12 }}>No earnings scheduled.</div>}
          {rendered.map((d) => (
            <div key={d.ds} style={{ padding: '10px 0', borderBottom: '1px solid #1c1c1c' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: d.is_today ? '#c9a84c' : '#e8e8e8', fontWeight: 700, fontSize: 13, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{d.label}</span>
                {d.is_today && <span style={{ fontSize: 10, fontWeight: 700, color: '#0a0a0a', background: '#c9a84c', padding: '1px 7px', borderRadius: 999 }}>TODAY</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 26px' }}>
                <div>{d.bmo.map((e, i) => <Row key={`b${i}`} e={e} sess="bmo" />)}</div>
                <div>{d.amc.map((e, i) => <Row key={`a${i}`} e={e} sess="amc" />)}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Earnings Calendar · notable names by market cap</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
