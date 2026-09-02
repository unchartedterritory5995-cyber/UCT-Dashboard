// app/src/pages/BuzzRender.jsx — headless, token-gated /buzz board export.
//
// Renders the Discord `/buzz` board image: a prose lead, the top tickers with
// full treatment (bar/count/sparkline/people/heat), and the receding tail
// (2+ mentions as plain text, once-mentioned names as one dim comma line).
// A headless browser (chart-renderer) navigates to /r/buzz, waits for
// window.__buzzReady, and screenshots #buzz-export.
//
// Design is LOCKED to the owner-reviewed v4 reference —
// docs/superpowers/design/2026-09-01-buzz-board-v4-reference.html — not
// reinvented here. See task-8-report.md for the handful of places that file
// and the task brief's own prose disagree (this component follows the
// rendered reference).
//
// Public route (no AuthGuard). Data comes from /api/r/buzz?token= (a
// token-gated public read over the buzz store — aggregate counts/tickers
// only, never author_id/message_id/jump links). ?token= is checked against
// VITE_CHART_RENDER_TOKEN, same pattern as ChartRender/CatalystsRender.
//
// window.__buzzReady is set from ROWS THAT HAVE LAID OUT (measured height >
// 0), never from mount. A sized container is not a drawn board -- that
// mistake shipped blank chart images twice in this repo.

import { useEffect, useRef, useState } from 'react'
import uctLogo from '../components/intro/assets/compass-mark.png'
import styles from './BuzzRender.module.css'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

// The sparkline's floor keeps a near-silent bucket visibly present (a literal
// 0% bar is invisible and unmeasurable) — a quiet stretch should still read
// as a flat line, not a gap.
const SPARK_FLOOR_PCT = 6

function Spark({ values, hot }) {
  const vals = values || []
  const max = Math.max(1, ...vals) // always >= 1, so a bucket's % is always well-defined
  return (
    <span className={styles.sp}>
      {vals.map((v, i) => (
        <i
          key={i}
          className={hot ? `${styles.s} ${styles.hot}` : styles.s}
          style={{ height: `${Math.max(SPARK_FLOOR_PCT, Math.round((100 * v) / max))}%` }}
        />
      ))}
    </span>
  )
}

// Two sentences, derived deterministically from the rows — no LLM, nothing
// to hallucinate. Sentence 1 is the top ticker by mentions; sentence 2 is the
// best available heat pick that isn't already sentence 1's ticker (a name
// can't simultaneously "own the room" and have "woken up" against its own
// baseline in the same breath).
function buildLead(data) {
  const rows = data.rows || []
  const heat = data.heat || []
  const totals = data.totals || {}
  if (!rows.length) return null
  const top = rows[0]
  const pick = heat.find((h) => h.ticker !== top.ticker) || null
  return { top, members: totals.members, pick }
}

export default function BuzzRender() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const exportRef = useRef(null)

  useEffect(() => {
    // Deliberately does NOT reset window.__buzzReady = false here: the flag
    // must stay untouched (undefined on a fresh load) until it is genuinely
    // measured true — an eager reset would still be "not yet drawn", but a
    // caller watching for the transition to `true` cares only that this page
    // never asserts readiness before it is real.
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') || ''
    if (TOKEN && token !== TOKEN) { setFailed(true); return }
    const qs = new URLSearchParams({ token, window: params.get('window') || 'open' })
    fetch(`/api/r/buzz?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Readiness: every head row AND every tail chip must have LAID OUT
  // (measured height > 0) before the flag flips — never on mount, and never
  // before the DOM has caught up to this data (rowEls/chipEls counts must
  // match what this payload says should be there).
  useEffect(() => {
    if (!data) return
    const el = exportRef.current
    if (!el) return
    const rows = data.rows || []
    const tail = data.tail || []
    const rowEls = el.querySelectorAll('[data-buzz-row]')
    const chipEls = el.querySelectorAll('[data-buzz-chip]')
    if (rowEls.length !== rows.length || chipEls.length !== tail.length) return
    const nothingToMeasure = rows.length === 0 && tail.length === 0
    const laidOut = [...rowEls, ...chipEls].every((n) => n.getBoundingClientRect().height > 0)
    if (nothingToMeasure || laidOut) window.__buzzReady = true
  }, [data])

  if (failed) {
    return (
      <div className={styles.fallback} id="buzz-export">Unavailable</div>
    )
  }
  if (!data) {
    return <div className={styles.fallback} id="buzz-export" />
  }

  const tail = data.tail || []
  const singles = data.singles || []
  const totals = data.totals || {}
  const lead = buildLead(data)

  return (
    <div className={styles.wrap}>
      <div id="buzz-export" ref={exportRef}>
        <div className={styles.chrome}>
          <span className={styles.subject}>THE ROOM</span>
          <span className={styles.where}>(#main-chat)</span>
          <span className={styles.win}>{data.label}</span>
          <span className={styles.lockup}>
            <img src={uctLogo} alt="" />
            <span>UCT INTELLIGENCE</span>
          </span>
        </div>

        <div className={styles.body}>
          {lead && (
            <div className={styles.lead}>
              <p>
                <b>{lead.top.ticker}</b> owned the room — {lead.top.people} of{' '}
                {lead.members ?? '—'} people talking.
              </p>
              {lead.pick && (
                <p>
                  <b>{lead.pick.ticker}</b> was quiet all morning, then woke up after lunch —{' '}
                  <b>{lead.pick.ratio}×</b> its normal chatter.
                </p>
              )}
            </div>
          )}
          <div className={styles.meta}>
            {totals.messages} messages with tickers · {totals.members} members · {totals.tickers} tickers
          </div>

          {(data.rows || []).map((r) => (
            <div key={r.ticker} className={styles.r} data-buzz-row>
              <span className={styles.sym}>{r.ticker}</span>
              <span className={styles.n}>{r.mentions}</span>
              <Spark values={r.spark} hot={r.hot != null} />
              <span />
              <span className={styles.ppl}>{r.people} people</span>
              <span className={styles.hot}>{r.hot != null ? `▲ ${r.hot}×` : ''}</span>
            </div>
          ))}

          {tail.length > 0 && (
            <>
              <div className={styles.lbl}>ALSO MENTIONED</div>
              <div className={styles.multi}>
                {tail.map((t) => (
                  <span key={t.ticker} className={styles.m} data-buzz-chip>
                    <b>{t.ticker}</b>{t.mentions}
                  </span>
                ))}
              </div>
            </>
          )}

          {singles.length > 0 && (
            <>
              <div className={styles.lbl}>ONCE EACH</div>
              <div className={styles.once}>{singles.join(' · ')}</div>
            </>
          )}
        </div>

        <div className={styles.foot}>
          <span>{data.coverage}</span>
          <span>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
