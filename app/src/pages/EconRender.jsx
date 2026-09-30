// app/src/pages/EconRender.jsx — headless, token-gated Today's Calendar export.
//
// Renders today's econ prints + Fed speakers (+ tonight's AMC reporters) as a
// branded timeline panel for the Morning Wire → Substack newsletter, replacing
// the typed TODAY'S CALENDAR list. A headless browser waits for
// window.__panelReady and screenshots #panel-export.
//
// Public route (no AuthGuard). Data: /api/r/econ (token-gated public twin of
// the wire's risk_calendar payload). Rows arrive chronological.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import uctLogo from '../components/intro/assets/compass-mark.png'


import { renderTokenOk } from '../lib/renderToken'

// "15:00" -> "3:00 PM", "08:30" -> "8:30 AM" (owner ruling 2026-09-29: the letter
// reads 12-hour ET). Anything that is not HH:MM (e.g. "All Day", "Tentative")
// passes through untouched rather than being guessed at.
export function to12h(t) {
  const s = String(t ?? '').trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (!m) return s
  const h = Number(m[1])
  if (h > 23) return s
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${ap}`
}

// A Fed row whose event is the bare generic "Fed Speaker" names nobody. The
// ruling is "name it or drop it": if the payload carries a name anywhere
// (speaker / title / note, or an "X speaks" phrasing), print
// "Fed Speaker: <Name>"; otherwise the row is not shown at all.
const GENERIC_FED = /^fed(eral reserve)?\s+speakers?$/i
// A person, optionally with a Fed title: "Waller", "Governor Waller",
// "Chair Powell", "Mary Daly". Lower-case words ("voting member") are not names.
const NAME_RE = /^(?:(?:Fed\s+)?(?:Chair(?:man)?|Vice\s+Chair(?:man)?|Governor|Gov\.|President|Pres\.)\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}$/
function extractName(v) {
  let s = String(v ?? '').trim()
  if (!s) return ''
  s = s.replace(/^fed(eral reserve)?\s+speakers?\s*[:\-·]\s*/i, '')   // "Fed Speaker: Waller"
  s = s.replace(/\s+(speaks|speech|remarks|testifies|testimony)\b.*$/i, '') // "Waller speaks …"
  s = s.replace(/[.,;:]+$/, '').trim()
  if (!s || GENERIC_FED.test(s)) return ''
  return NAME_RE.test(s) ? s : ''
}
export function isGenericFed(r) {
  return r?.kind === 'fed' && GENERIC_FED.test(String(r.event ?? '').trim())
}
export function fedSpeakerName(r) {
  for (const k of ['speaker', 'title', 'note']) {
    const n = extractName(r?.[k])
    if (n) return { name: n, from: k }
  }
  return null
}
// Rows as the panel shows them: bare generic Fed rows are named or dropped.
export function presentRows(rows) {
  const out = []
  for (const r of rows || []) {
    if (!isGenericFed(r)) { out.push(r); continue }
    const found = fedSpeakerName(r)
    if (!found) continue
    out.push({ ...r, event: `Fed Speaker: ${found.name}`, note: found.from === 'note' ? '' : r.note })
  }
  return out
}

function Row({ r }) {
  const fed = r.kind === 'fed'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '11px 4px', borderBottom: '1px solid #1b1b1b' }}>
      <span data-testid="econ-time" style={{ width: 82, flex: '0 0 auto', color: '#c9a84c', fontWeight: 800, fontSize: 16, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.2px', whiteSpace: 'nowrap' }}>
        {to12h(r.time) || '—'}
      </span>
      {r.is_key && !fed && <span style={{ color: '#c9a84c', fontSize: 13, flex: '0 0 auto' }}>★</span>}
      {fed && (
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', color: '#60a5fa', background: 'rgba(56,132,255,0.12)', border: '1px solid rgba(56,132,255,0.35)', borderRadius: 999, padding: '2px 8px', flex: '0 0 auto' }}>FED</span>
      )}
      <span style={{ color: '#e4e4e4', fontSize: 14.5, fontWeight: fed || r.is_key ? 700 : 500 }}>
        {r.event}
        {r.note ? <span style={{ color: '#8b8f84', fontWeight: 500 }}> · {r.note}</span> : null}
      </span>
      {r.estimate && (
        <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: 12, color: '#9aa08f', border: '1px solid #2a2a26', borderRadius: 999, padding: '3px 10px', fontVariantNumeric: 'tabular-nums' }}>
          est {r.estimate}
        </span>
      )}
    </div>
  )
}

export default function EconRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (!renderTokenOk(token)) { setErr('unauthorized'); return }
    fetch(`/api/r/econ?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr('data unavailable'))
  }, [token])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 1200)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const rows = presentRows(data.rows)
  const amc = data.amc || []
  const more = Math.max(0, (data.amc_count || amc.length) - amc.length)
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            TODAY'S CALENDAR <span style={{ color: '#8b8f84', fontWeight: 700 }}>· ALL TIMES ET</span>
          </span>
          <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
            <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
          </span>
        </div>
        <div style={{ padding: '4px 18px 10px' }}>
          {rows.length === 0 && <div style={{ color: '#888', padding: 12 }}>No scheduled prints today.</div>}
          {rows.map((r, i) => <Row key={i} r={r} />)}
          {amc.length > 0 && (
            <div style={{ padding: '12px 4px 4px', fontSize: 13.5, color: '#b9b9b9' }}>
              <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: 11, letterSpacing: '0.5px' }}>REPORTING TONIGHT (AMC)</span>
              <span style={{ marginLeft: 10, color: '#e4e4e4', fontWeight: 600 }}>{amc.join(' · ')}</span>
              {more > 0 && <span style={{ color: '#8b8f84' }}> +{more} more</span>}
            </div>
          )}
        </div>
        <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
          <span>Econ prints · Fed speakers · tonight&apos;s reporters</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
