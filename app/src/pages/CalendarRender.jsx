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

import { renderTokenOk } from '../lib/renderToken'
const PER_SESSION = 4  // notable names per BMO/AMC per day

const SESS = {
  bmo: { label: 'BMO', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  amc: { label: 'AMC', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  tbd: { label: 'TBD', color: '#9aa08f', bg: 'rgba(180,180,180,0.10)' },
}

const byCap = (a, b) => (Number(b.mc_b) || 0) - (Number(a.mc_b) || 0)

// ── ONE DATE PER COMPANY (owner ruling 2026-09-29) ──────────────────────────
// This panel merges TWO /api/calendar weeks (this week + next). The API already
// keeps one placement per symbol WITHIN a week, but the two weeks are built
// separately and the providers disagree about dates — MKC printed on Thu Oct 1
// AND Mon Oct 5 on 2026-09-29. So the merged view keeps one date per symbol:
//   1. a placement from the EarningsWhispers schedule (`ew` > 0) — the only
//      editorially confirmed source — beats everything;
//   2. otherwise one the API did not mark as a projected date (`date_est`
//      falsy: a provider that carried a BMO/AMC session for it);
//   3. otherwise a projected date.
// Ties at the best tier go to the EARLIEST date. When the placements disagree
// and nothing outranks the rest (a tie at the top tier, or only projected
// dates), the kept row carries a small UNCONFIRMED tag — the panel says the
// date is in dispute instead of silently picking one.
const SESSIONS = ['bmo', 'amc']
const tierOf = (e) => ((Number(e.ew) || 0) > 0 ? 2 : e.date_est ? 0 : 1)

export function dedupeDays(days, dates) {
  const bySym = new Map()
  for (const ds of dates) {
    const d = days[ds] || {}
    for (const sess of SESSIONS) {
      for (const e of d[sess] || []) {
        const sym = String(e?.sym || '').toUpperCase()
        if (!sym) continue
        if (!bySym.has(sym)) bySym.set(sym, [])
        bySym.get(sym).push({ ds, sess, e, tier: tierOf(e) })
      }
    }
  }
  const keep = new Map()   // sym -> { ds, sess, disputed }
  for (const [sym, places] of bySym) {
    const top = Math.max(...places.map((p) => p.tier))
    const best = places.filter((p) => p.tier === top).sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0))
    const dates = new Set(places.map((p) => p.ds))
    const disputed = dates.size > 1 && (best.length > 1 || top === 0)
    keep.set(sym, { ds: best[0].ds, sess: best[0].sess, disputed })
  }
  const out = {}
  for (const ds of dates) {
    const d = days[ds] || {}
    const next = { ...d }
    for (const sess of SESSIONS) {
      const seen = new Set()
      next[sess] = (d[sess] || []).filter((e) => {
        const sym = String(e?.sym || '').toUpperCase()
        if (!sym) return false
        const k = keep.get(sym)
        if (!k || k.ds !== ds || k.sess !== sess || seen.has(sym)) return false
        seen.add(sym)
        return true
      }).map((e) => {
        const k = keep.get(String(e.sym).toUpperCase())
        return k.disputed ? { ...e, _unconfirmed: true } : e
      })
    }
    out[ds] = next
  }
  return out
}

// ET calendar date N days after `ymd` — pure date arithmetic on the string, so
// the renderer's local timezone cannot move it.
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
// `until` param: 'week' = the Sunday closing the current ET week; a
// YYYY-MM-DD caps the window at that date; anything else = no cap.
export function untilDate(until, today) {
  const u = String(until || '').trim().toLowerCase()
  if (!u) return null
  if (u === 'week') {
    const [y, m, d] = today.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0 Sun .. 6 Sat
    return addDays(today, (7 - dow) % 7)
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(u) ? u : null
}

function Row({ e, sess }) {
  const sym = (e.sym || '').toUpperCase()
  const s = SESS[sess] || SESS.tbd
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
      <img src={`/api/ticker-logo/${sym}?v=2`} alt="" style={{ width: 26, height: 26, borderRadius: 6, background: '#1c1c1c', objectFit: 'contain', flex: '0 0 auto' }} />
      <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 14, minWidth: 56 }}>{sym}</span>
      <span style={{ color: '#b9b9b9', fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || ''}</span>
      {e._unconfirmed && (
        <span data-testid="unconfirmed" title="Sources disagree on this date"
              style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', color: '#9aa08f', border: '1px solid #3a3a34', borderRadius: 999, padding: '1px 6px', flex: '0 0 auto' }}>UNCONFIRMED</span>
      )}
      {Number(e.mc_b) > 0 && <span style={{ color: '#6f6f6f', fontSize: 11.5, minWidth: 54, textAlign: 'right' }}>${Number(e.mc_b).toFixed(0)}B</span>}
      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: s.color, background: s.bg, minWidth: 34, textAlign: 'center' }}>{s.label}</span>
    </div>
  )
}

const etToday = () => {
  // ET calendar date, not the browser's — the renderer may run late evening.
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  return p // en-CA gives YYYY-MM-DD
}

export default function CalendarRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '900', 10)))
  // from=today (newsletter default): drop past days and extend into next week —
  // a Friday letter shows Fri + Mon + Tue, not the Wed/Thu that already reported.
  const fromToday = (sp.get('from') || 'today') === 'today'
  // days counts RENDERED (non-empty) days. Floor is 1 so the wire can ask for
  // "just today" (e.g. days=1 on a Friday); it was 2, which silently pulled in
  // next Monday. A non-numeric value keeps the old default of 5.
  const daysRaw = parseInt(sp.get('days') || '5', 10)
  const maxDays = Math.min(7, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 5))
  // Optional ?until=week (through this ET week's Sunday) or ?until=YYYY-MM-DD:
  // caps the window by DATE, so "the rest of this week" cannot spill into next
  // Monday when a remaining day happens to have no reporters. Absent = no cap.
  const untilParam = sp.get('until') || ''
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    window.__panelReady = false
    if (!renderTokenOk(token)) { setErr('unauthorized'); return }
    const jobs = [fetch('/api/calendar').then((r) => (r.ok ? r.json() : Promise.reject(r.status)))]
    if (fromToday) {
      const nextMon = new Date()
      nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7))
      jobs.push(
        fetch(`/api/calendar?week=${nextMon.toISOString().slice(0, 10)}`)
          .then((r) => (r.ok ? r.json() : { days: {} }))
          .catch(() => ({ days: {} })),
      )
    }
    Promise.all(jobs)
      .then(([cur, next]) => setData({ days: { ...(cur?.days || {}), ...((next && next.days) || {}) } }))
      .catch(() => setErr('data unavailable'))
  }, [token, fromToday])

  useEffect(() => {
    if (data == null) return
    const t = setTimeout(() => { window.__panelReady = true }, 2200)
    return () => clearTimeout(t)
  }, [data])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (data == null) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const today = etToday()
  const cap = untilDate(untilParam, today)
  const dates = Object.keys(data.days || {}).sort()
    .filter((ds) => !fromToday || ds >= today)
    .filter((ds) => !cap || ds <= cap)
  // Dedupe over the WHOLE fetched window (this week + next), before any
  // per-session slice, so a dropped duplicate frees its slot for another name.
  const days = dedupeDays(data.days || {}, Object.keys(data.days || {}).sort()
    .filter((ds) => !fromToday || ds >= today))
  const rendered = dates
    .map((ds) => {
      const d = days[ds] || {}
      const bmo = [...(d.bmo || [])].filter((e) => e.sym).sort(byCap).slice(0, PER_SESSION)
      const amc = [...(d.amc || [])].filter((e) => e.sym).sort(byCap).slice(0, PER_SESSION)
      return { ds, label: d.label || ds, is_today: d.is_today || ds === today, bmo, amc }
    })
    .filter((d) => d.bmo.length || d.amc.length)
    .slice(0, maxDays)

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff' }}>
        <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>
            {fromToday
              ? <>EARNINGS <span style={{ color: '#8b8f84', fontWeight: 700 }}>· THE SESSIONS AHEAD</span></>
              : "THIS WEEK'S EARNINGS"}
          </span>
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
          <span>UCT Terminal · notable earnings by market cap</span>
          <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
