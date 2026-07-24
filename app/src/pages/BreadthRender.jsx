// app/src/pages/BreadthRender.jsx — headless, token-gated 10-day Breadth Monitor export.
//
// Renders the real Breadth Monitor table (last 10 sessions) with the exact columns +
// 8-tier heat coloring the dashboard uses (reuses COLS from Breadth.jsx, so it never
// drifts). Screenshotted into the Morning Wire → Substack "Market Internals" section.
//
// Public route (no AuthGuard). Data from /api/breadth-monitor?days=10 (public).
// ?token= checked vs VITE_CHART_RENDER_TOKEN.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { COLS } from './Breadth'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

// tier → cell background (matches Breadth.module.css .bgG3..bgR3)
const TIER_BG = {
  g3: 'rgba(10,50,22,0.97)', g2: 'rgba(22,100,48,0.80)', g1: 'rgba(74,222,128,0.16)',
  a: 'rgba(180,130,20,0.32)', r1: 'rgba(248,113,113,0.16)', r2: 'rgba(160,25,25,0.80)',
  r3: 'rgba(55,6,6,0.97)', '': 'transparent',
}

// the exact columns + order in the Monitor screenshot, grouped
const KEYS = [
  'up_4pct_today', 'down_4pct_today', 'ratio_5day', 'up_20pct_5d', 'down_20pct_5d',
  'up_25pct_quarter', 'down_25pct_quarter', 'up_25pct_month', 'down_25pct_month',
  'pct_above_5sma', 'pct_above_20ema', 'pct_above_40sma', 'pct_above_50sma', 'pct_above_200sma',
  'sp500_close', 'qqq_close', 'vix', 'hvc_52w', 'atr_ext_7',
]
const BY_KEY = Object.fromEntries(COLS.map((c) => [c.key, c]))
const COLUMNS = KEYS.map((k) => BY_KEY[k]).filter(Boolean)

// group spans for the top header row, in column order
const GROUPS = []
COLUMNS.forEach((c) => {
  const last = GROUPS[GROUPS.length - 1]
  if (last && last.name === c.group) last.span += 1
  else GROUPS.push({ name: c.group, span: 1 })
})

function tierOf(col, row) {
  const t = col.rowColorFn ? col.rowColorFn(row) : col.colorFn ? col.colorFn(row[col.key]) : ''
  return t || ''
}
function valOf(col, row) {
  const v = row[col.key]
  if (col.fmt) return col.fmt(v)
  return v == null ? '—' : v
}

export default function BreadthRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const days = Math.min(20, Math.max(3, parseInt(sp.get('days') || '10', 10)))
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/breadth-monitor?days=${days + 4}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const rs = (Array.isArray(d.rows) ? d.rows : [])
          .slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, days)
        setRows(rs)
      })
      .catch(() => setErr('data unavailable'))
  }, [token, days])

  useEffect(() => {
    if (rows == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [rows])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (rows == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const th = { padding: '5px 8px', fontSize: 10.5, fontWeight: 700, color: '#8b96a3', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #262626' }
  const grpTh = { ...th, color: '#c9a84c', letterSpacing: '0.5px', textTransform: 'uppercase', fontSize: 10, borderBottom: '1px solid #333' }
  const td = { padding: '6px 8px', fontSize: 12, textAlign: 'center', fontFamily: "'IBM Plex Mono',monospace", whiteSpace: 'nowrap' }

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ background: '#0a0a0a', color: '#e8e8e8', display: 'inline-block', minWidth: 900 }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', justifyContent: 'space-between' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>BREADTH MONITOR — LAST {days} SESSIONS</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...grpTh, textAlign: 'left', paddingLeft: 14 }}></th>
              {GROUPS.map((g, i) => <th key={i} colSpan={g.span} style={grpTh}>{g.name}</th>)}
            </tr>
            <tr>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 14 }}>Date</th>
              {COLUMNS.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 14, color: '#9aa7b4', fontWeight: 600 }}>{row.date}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} style={{ ...td, background: TIER_BG[tierOf(c, row)] }}>{valOf(c, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ height: 20, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10, justifyContent: 'space-between' }}>
          <span>Market breadth · UCT Intelligence</span><span style={{ color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
