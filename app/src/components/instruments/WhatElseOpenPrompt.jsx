import { useContext, useEffect, useRef, useState } from 'react'
import { AuthContext } from '../../context/AuthContext'

// TERM-093 — the "what else was open, NAMED" capture (item 14 WF-C13 / WF-C09).
//
// An instrument, not a feature: ONE prompt at ONE declared moment (the breadth
// drill opening, which a person clicked), shown to ADMINS only — the subject is
// the owner-desk. The server answers 404 while WHAT_ELSE_OPEN_CAPTURE_ENABLED is
// unset; this then renders nothing.
//
// ⛔ It never looks at the subject's other tabs. The answer is what the person
// names. The only network call is to our own /api/instruments/what-else-open.
// ⛔ Dismissing leaves the occasion UNANSWERED on the server — never "none".

const OPTIONS = [
  ['finviz', 'finviz.com'],
  ['tradingview', 'TradingView'],
  ['thinkorswim', 'thinkorswim'],
  ['other', 'Other'],
  ['none', 'Nothing else'],
]

const BASE = '/api/instruments/what-else-open/occasion'

// NOT crypto.randomUUID: it is secure-context-only and throws over plain http.
function newOccasionId() {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export default function WhatElseOpenPrompt({ occasion, context }) {
  const isAdmin = useContext(AuthContext)?.user?.role === 'admin'
  const idRef = useRef(null)
  const [phase, setPhase] = useState('idle') // idle | open | sent | hidden
  const [picked, setPicked] = useState([])
  const [other, setOther] = useState('')

  useEffect(() => {
    if (!isAdmin || idRef.current) return
    idRef.current = newOccasionId()   // once per open, survives a StrictMode remount
    fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occasion_id: idRef.current, occasion, context: context || null }),
    })
      .then(r => setPhase(r.ok ? 'open' : 'hidden'))
      .catch(() => setPhase('hidden'))
  }, [isAdmin, occasion, context])

  if (!isAdmin || phase === 'idle' || phase === 'hidden') return null
  if (phase === 'sent') {
    return <div data-what-else-open="sent" role="status" style={S.bar}>Noted. Thanks.</div>
  }

  const toggle = (key) => setPicked(prev => {
    if (key === 'none') return prev.includes('none') ? [] : ['none']
    const base = prev.filter(k => k !== 'none')
    return base.includes(key) ? base.filter(k => k !== key) : [...base, key]
  })

  const submit = () => {
    if (!picked.length) return
    fetch(`${BASE}/${idRef.current}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: picked, other_text: picked.includes('other') ? other : null }),
    })
      .then(() => setPhase('sent'))
      .catch(() => setPhase('hidden'))
  }

  return (
    <div data-what-else-open="open" role="group" aria-label="What else is open" style={S.bar}>
      <span style={S.q}>Admin instrument: what else do you have open for this right now?</span>
      {OPTIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={picked.includes(key)}
          onClick={() => toggle(key)}
          style={picked.includes(key) ? { ...S.chip, ...S.chipOn } : S.chip}
        >{label}</button>
      ))}
      {picked.includes('other') && (
        <input
          aria-label="Other tool"
          value={other}
          maxLength={80}
          onChange={e => setOther(e.target.value)}
          style={S.input}
        />
      )}
      <button type="button" onClick={submit} disabled={!picked.length} style={S.chip}>Send</button>
      <button type="button" aria-label="Dismiss" onClick={() => setPhase('hidden')} style={S.chip}>Skip</button>
    </div>
  )
}

const S = {
  bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 10px',
    fontSize: 12, borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))' },
  q: { opacity: 0.8, marginRight: 4 },
  chip: { fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
    background: 'transparent', color: 'inherit', border: '1px solid var(--color-border, rgba(255,255,255,0.2))' },
  chipOn: { borderColor: 'var(--color-accent, #c9a84c)', color: 'var(--color-accent, #c9a84c)' },
  input: { fontSize: 12, padding: '2px 6px', width: 140 },
}
