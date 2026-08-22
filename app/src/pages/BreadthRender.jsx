// app/src/pages/BreadthRender.jsx — headless, token-gated 10-day Breadth Monitor export.
//
// Renders the real Breadth Monitor table (last 10 sessions) with the exact columns +
// 8-tier heat coloring the dashboard uses (reuses COLS from Breadth.jsx, so it never
// drifts). Screenshotted into the Morning Wire → Substack "Market Internals" section.
//
// Public route (no AuthGuard). ?token= checked vs VITE_CHART_RENDER_TOKEN, and the
// SAME token is forwarded to the API.
//
// ⛔ Data comes from /api/r/breadth-monitor, NOT /api/breadth-monitor. The plain
// endpoint went behind `require_paid` in 9ff74f69 (2026-08-09) and this page renders
// logged-OUT, so it fetched a 401 and shipped a blank panel for a week with nothing
// reporting it. Any endpoint this page reads must be one of the token-gated /api/r/*
// doors — a paid endpoint is unreachable from here by construction.

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

// A 19-column table is illegible scaled to a newsletter column, so it's split into
// two readable images: part 1 = Primary Breadth, part 2 = MA + Regime + Highs/Lows.
// ?part=1|2 selects; anything else renders all columns (backward compatible).
const PART_KEYS = {
  1: ['up_4pct_today', 'down_4pct_today', 'ratio_5day', 'up_20pct_5d', 'down_20pct_5d',
      'up_25pct_quarter', 'down_25pct_quarter', 'up_25pct_month', 'down_25pct_month'],
  2: ['pct_above_5sma', 'pct_above_20ema', 'pct_above_40sma', 'pct_above_50sma', 'pct_above_200sma',
      'sp500_close', 'qqq_close', 'vix', 'hvc_52w', 'atr_ext_7'],
}
const ALL_KEYS = [...PART_KEYS[1], ...PART_KEYS[2]]
const PART_TITLE = { 1: 'PRIMARY BREADTH', 2: 'MA · REGIME · HIGHS/LOWS' }
const BY_KEY = Object.fromEntries(COLS.map((c) => [c.key, c]))

function columnsFor(part) {
  const keys = PART_KEYS[part] || ALL_KEYS
  return keys.map((k) => BY_KEY[k]).filter(Boolean)
}
function groupsFor(columns) {
  const g = []
  columns.forEach((c) => {
    const last = g[g.length - 1]
    if (last && last.name === c.group) last.span += 1
    else g.push({ name: c.group, span: 1 })
  })
  return g
}

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
  const part = sp.get('part') || ''
  const COLUMNS = columnsFor(part)
  const GROUPS = groupsFor(COLUMNS)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    fetch(`/api/r/breadth-monitor?days=${days + 4}&token=${encodeURIComponent(token)}`)
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

  // bigger type when split (fewer columns → room to breathe → readable when scaled)
  const big = !!PART_KEYS[part]
  const th = { padding: big ? '8px 12px' : '5px 8px', fontSize: big ? 14 : 10.5, fontWeight: 700, color: '#8b96a3', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #262626' }
  const grpTh = { ...th, color: '#c9a84c', letterSpacing: '0.5px', textTransform: 'uppercase', fontSize: big ? 13 : 10, borderBottom: '1px solid #333' }
  const td = { padding: big ? '10px 12px' : '6px 8px', fontSize: big ? 17 : 12, textAlign: 'center', fontFamily: "'IBM Plex Mono',monospace", whiteSpace: 'nowrap' }
  const title = PART_TITLE[part] ? `BREADTH — ${PART_TITLE[part]}` : 'BREADTH MONITOR'

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ background: '#0a0a0a', color: '#e8e8e8', display: 'inline-block', minWidth: 700 }}>
        <div style={{ height: 46, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 16, letterSpacing: '0.6px' }}>{title} · LAST {days} SESSIONS</span>
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
