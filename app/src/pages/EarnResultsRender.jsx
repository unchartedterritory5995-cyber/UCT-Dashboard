// app/src/pages/EarnResultsRender.jsx — headless, token-gated "Earnings Results" export.
//
// The RESULTS twin of EarnCardsRender ("Set to Report"). SAME full-width card
// chrome — logo · ticker · company · session pill — so the two panels read as a
// matched pair in the newsletter, but this one shows what was actually REPORTED:
//   REPORTED        — actual EPS + revenue, each with its surprise vs estimate
//   VS ESTIMATE     — the Wall St estimate it was measured against
//   GROWTH vs LAST YEAR — YoY on the reported quarter
// plus a BEAT / MISS badge where Set-to-Report shows its priced-move chip.
//
// Data arrives in the URL (?data= base64url JSON), computed wire-side at build
// time from the wire's reported earnings — the wire stays the single source of
// truth. Public route (no AuthGuard); ?token= checked against VITE_CHART_RENDER_TOKEN.

import { formatCompact } from '../lib/presentation/presentationPrimitives'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'


import { renderTokenOk } from '../lib/renderToken'
const SESS = {
  AMC: { label: 'AFTER CLOSE', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  BMO: { label: 'BEFORE OPEN', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  TBD: { label: 'REPORTED', color: '#9aa08f', bg: 'rgba(180,180,180,0.10)' },
}

// TERM-066: revenue arrives in MILLIONS, so the B tier sits at 1,000 (one decimal);
// below it the value prints as whole millions, as it always has.
const REV_B_TIERS = Object.freeze([Object.freeze({ at: 1000, suffix: 'B', decimals: 1 })])
const revB = (m) => {
  const v = Number(m)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v >= 1000 ? formatCompact(v, { tiers: REV_B_TIERS, prefix: '$' }) : `$${v.toFixed(0)}M`
}
// Sign BEFORE the dollar: "-$5.34", never "$-5.34" (owner ruling 2026-09-29) —
// used for the reported figure AND the "est" line under it.
// null/'' are "no figure" (Number(null) is 0 and would print "$0.00").
const eps = (v) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const s = Math.abs(n).toFixed(2)
  return n < 0 && s !== '0.00' ? `-$${s}` : `$${s}`
}
// Signed from the ROUNDED figure, so 0.3 reads "0%" (not "+0%").
const pct = (v) => {
  if (v == null || v === '') return null  // null/undefined YoY or surprise -> omit (Number(null) is 0)
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const r = Math.round(n) || 0
  return `${r > 0 ? '+' : ''}${r}%`
}

// Same pill contract as EarnCardsRender: a wire-chosen `badge` string wins
// verbatim; without it the old on_board -> "ON OUR BOARD" behaviour is unchanged.
const badgeText = (e) => {
  const b = typeof e?.badge === 'string' ? e.badge.trim() : ''
  if (b) return b
  return e?.on_board ? 'ON OUR BOARD' : ''
}

function StatCol({ label, labelColor, children, minWidth = 0 }) {
  return (
    <div style={{ minWidth, flex: 1 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.8px', color: labelColor, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

// One metric stacked: the reported actual (with its surprise vs estimate) sits
// directly ABOVE the estimate, so actual-vs-estimate reads at a glance. A
// surprise that rounds to 0% shows no arrow (reads "in line", not "▼0%").
function Metric({ act, est, surp, fmt }) {
  const s = pct(surp)
  const showChip = s != null && Math.round(Number(surp)) !== 0
  const up = Number(surp) >= 0
  return (
    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: '#f0ead8' }}>{fmt(act)}</span>
        {showChip && (
          <span style={{ fontSize: 13.5, fontWeight: 800, color: up ? '#22c55e' : '#ef4444' }}>
            {up ? '▲' : '▼'}{s}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: '#8b8f84', marginTop: 3 }}>est {fmt(est)}</div>
    </div>
  )
}

// A change that ROUNDS to 0% is flat: no arrow, neutral grey — never the green
// "EPS ▲ 0%" the 2026-09-29 letter printed.
function Growth({ label, v }) {
  const p = pct(v)
  if (p == null) return null
  const r = Math.round(Number(v)) || 0
  const color = r > 0 ? '#22c55e' : r < 0 ? '#ef4444' : '#9aa08f'
  return (
    <span data-growth={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 14,
                   fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                   color }}>
      <span style={{ fontSize: 12, color: '#9aa08f', fontWeight: 700 }}>{label}</span>
      {r > 0 ? '▲ ' : r < 0 ? '▼ ' : ''}{p}
    </span>
  )
}

function Row({ e }) {
  const s = SESS[(e.session || 'TBD').toUpperCase()] || SESS.TBD
  const beat = !!e.is_beat
  const badge = badgeText(e)
  return (
    <div style={{ background: '#121212', border: '1px solid #232323', borderRadius: 12, padding: '16px 20px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={`/api/ticker-logo/${e.sym}?v=2`} alt=""
             style={{ width: 40, height: 40, borderRadius: 9, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Name WRAPS (two lines max) rather than ellipsing at the 728px column;
              the badge drops to its own line when it cannot fit beside it. */}
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 4 }}>
            <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 21, letterSpacing: '0.4px', flex: '0 0 auto' }}>{e.sym}</span>
            {e.name ? (
              <span data-testid="company-name" style={{ color: '#9aa08f', fontSize: 13.5, lineHeight: 1.25, minWidth: 0,
                             whiteSpace: 'normal', overflowWrap: 'anywhere', display: '-webkit-box',
                             WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.name}</span>
            ) : null}
            {badge && (
              <span data-testid="row-badge" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', color: '#c9a84c',
                             border: '1px solid rgba(201,168,76,0.45)', borderRadius: 999, padding: '2px 8px',
                             whiteSpace: 'nowrap', flex: '0 0 auto' }}>{badge}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', padding: '4px 10px',
                         borderRadius: 999, color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>{s.label}</span>
          <span style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '0.6px', padding: '4px 12px',
                         borderRadius: 999, whiteSpace: 'nowrap',
                         color: beat ? '#22c55e' : '#ef4444',
                         background: beat ? 'rgba(34,197,94,0.13)' : 'rgba(239,68,68,0.13)',
                         border: `1px solid ${beat ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'}` }}>
            {beat ? '▲ BEAT' : '▼ MISS'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 14, alignItems: 'flex-start' }}>
        <StatCol label="EPS" labelColor="#c9a84c" minWidth={140}>
          <Metric act={e.eps_act} est={e.eps_est} surp={e.eps_surp} fmt={eps} />
        </StatCol>
        <StatCol label="REVENUE" labelColor="#c9a84c" minWidth={150}>
          <Metric act={e.rev_act} est={e.rev_est} surp={e.rev_surp} fmt={revB} />
        </StatCol>
        <StatCol label="GROWTH vs LAST YEAR" labelColor="#8b8f84" minWidth={180}>
          <div>
            <Growth label="EPS" v={e.eps_yoy} />
            <Growth label="REV" v={e.rev_yoy} />
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

export default function EarnResultsRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const w = Math.min(1200, Math.max(700, parseInt(sp.get('w') || '1000', 10)))
  const payload = useMemo(() => decodeData(sp.get('data') || ''), [sp])
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (!renderTokenOk(token)) { setErr('unauthorized'); return }
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
            EARNINGS RESULTS <span style={{ color: '#8b8f84', fontWeight: 700 }}>· WHO BEAT, WHO MISSED</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '14px 18px 8px' }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No reported earnings this session.</div>}
          {rows.map((e, i) => <Row key={e.sym || i} e={e} />)}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Actual vs Wall St&apos;s estimate · ▲/▼ = surprise · growth vs the same quarter last year</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
