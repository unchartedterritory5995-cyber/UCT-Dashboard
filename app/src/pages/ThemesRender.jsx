// app/src/pages/ThemesRender.jsx — headless, token-gated "Themes" export.
//
// Theme leaders & laggards by period return, drawn in the SAME house card style
// as EarnResultsRender / MoversRender (owner ruling 2026-09-29): dark card,
// header bar with the UCT INTELLIGENCE mark, FULL theme names that wrap rather
// than truncate, one clean horizontal bar per row with the % at the end — top
// leaders first, then the laggards. It replaced a matplotlib-style bar chart
// (tick axes, "Semiconductor Equi…") that was hard to read on a phone.
//
// Public route (no AuthGuard). Data from /api/r/themes?token= (token-gated read of
// the engine's wire["themes"]). ?token= checked vs VITE_CHART_RENDER_TOKEN.
// Params: period (1D/1W/1M/3M/1Y/YTD, default 1W) · n rows per side (3-10,
// default 5) · holds tickers shown under each name (0-10, default 3; 0 hides
// them) · w width (560-1000, default 760).

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'

import { renderTokenOk } from '../lib/renderToken'

const GREEN = '#22c55e'
const RED = '#ef4444'
const FLAT = '#9aa08f'

// Signed, one decimal, from the value as sent. -0.0 reads "0.0%".
export function fmtRet(v) {
  if (v == null || v === '') return '—'   // Number(null) is 0: absent is not flat
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10 || 0
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}

// Color follows the SIGN of the return, not the group: in a down week a
// "leader" can be red, and a flat reading is neutral grey.
const colorOf = (v) => {
  const r = Math.round(Number(v) * 10) / 10 || 0
  return r > 0 ? GREEN : r < 0 ? RED : FLAT
}

function Row({ r, max, holds }) {
  const color = colorOf(r.ret)
  const mag = Math.abs(Number(r.ret)) || 0
  const pct = max > 0 ? Math.max(2, Math.round((mag / max) * 100)) : 2
  const tickers = (r.holdings || []).slice(0, holds)
  return (
    <div data-testid="theme-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 44%) minmax(0, 1fr) 74px',
                  alignItems: 'center', columnGap: 14, padding: '10px 4px', borderBottom: '1px solid #1b1b1b' }}>
      <div style={{ minWidth: 0 }}>
        <div data-testid="theme-name" style={{ color: '#ececec', fontWeight: 700, fontSize: 15, lineHeight: 1.3,
                      whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{r.name}</div>
        {tickers.length > 0 && (
          <div style={{ marginTop: 3, color: '#c9a84c', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.4px' }}>
            {tickers.join(' · ')}
          </div>
        )}
      </div>
      <div style={{ height: 12, background: '#1c1c1c', borderRadius: 999, overflow: 'hidden' }}>
        <div data-testid="theme-bar" style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, opacity: 0.9 }} />
      </div>
      <span style={{ textAlign: 'right', color, fontWeight: 800, fontSize: 16.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {fmtRet(r.ret)}
      </span>
    </div>
  )
}

function Section({ up, rows, max, holds }) {
  if (!rows || !rows.length) return null
  return (
    <div style={{ background: '#121212', border: '1px solid #232323', borderRadius: 12, padding: '10px 16px 4px', marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.8px', color: up ? GREEN : RED, padding: '2px 4px 4px' }}>
        {up ? 'LEADERS' : 'LAGGARDS'}
      </div>
      {rows.map((r, i) => <Row key={`${r.name}-${i}`} r={r} max={max} holds={holds} />)}
    </div>
  )
}

export default function ThemesRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const period = sp.get('period') || '1W'
  const nRaw = parseInt(sp.get('n') || '5', 10)
  const n = Math.min(10, Math.max(3, Number.isFinite(nRaw) ? nRaw : 5))
  const hRaw = parseInt(sp.get('holds') ?? '3', 10)
  const holds = Math.min(10, Math.max(0, Number.isFinite(hRaw) ? hRaw : 3))
  const w = Math.min(1000, Math.max(560, parseInt(sp.get('w') || '760', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (!renderTokenOk(token)) { setErr('unauthorized'); return }
    // The API clamps holds to >= 1; holds=0 hides them here instead.
    fetch(`/api/r/themes?token=${encodeURIComponent(token)}&period=${encodeURIComponent(period)}&n=${n}&holds=${Math.max(1, holds)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr('data unavailable'))
  }, [token, period, n, holds])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1000)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const leaders = (data.leaders || []).slice(0, n)
  const laggards = (data.laggards || []).slice(0, n)
  // Bars scale to the largest move SHOWN, so the longest bar is always full.
  const max = Math.max(0, ...[...leaders, ...laggards].map((r) => Math.abs(Number(r.ret)) || 0))
  const label = String(data.period || period).toUpperCase()

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            THEMES <span style={{ color: '#8b8f84', fontWeight: 700 }}>· {label} LEADERS &amp; LAGGARDS</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '14px 18px 2px' }}>
          {leaders.length === 0 && laggards.length === 0 && (
            <div style={{ color: '#888', padding: 12 }}>No theme returns for this period.</div>
          )}
          <Section up rows={leaders} max={max} holds={holds} />
          <Section up={false} rows={laggards} max={max} holds={holds} />
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>{label} return by theme · top holdings under each name · UCT theme taxonomy</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
