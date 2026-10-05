import { useState } from 'react'
import useFilingWatch from '../../hooks/useFilingWatch'
import { formatETDate } from '../../utils/timeAgo'
import UIcon from '../ui/UIcon'
import styles from '../../pages/Settings.module.css'

// ── S7 Filing Watches — Stage 5 minimal management panel ────────────────
// "Notify me about new SEC filings for {sym}" — list + suspend/reactivate
// only. Shares useFilingWatch with the creation surfaces (TickerPopup,
// TickerHubSheet, Research header) so a change here is reflected there via
// the same SWR cache key, no separate state to keep in sync (E3).
//
// Extracted to its own file (rather than left inline in Settings.jsx, which
// has no dedicated test file and heavy unrelated dependencies) specifically
// so it's unit-testable in isolation.

// ── FT-035 alert expiry — a date, capped a year out, future-only ────────
// `PUT /api/alerts/predicates/{predicate_id}/expiry` (armed behind
// ALERT_LIFECYCLE_ENABLED; dark = the route 404s and this control's own PUT
// call fails like any other request, no separate flag needed here). Past its
// expiry the predicate is SUSPENDED, never deleted — same meaning as the
// Suspend button beside it.
//
// ⛔ THE LIST RESPONSE DOES NOT CARRY `expires_at` (predicates._row_to_dict
// omits it) — this control's own PUT response is therefore the only source
// for "what did I just set", kept in local state keyed by predicate id. A
// page reload shows no expiry pre-filled; that is the server's gap, not a
// bug in this control, and nothing here invents a value the server cannot
// confirm.
const MAX_HORIZON_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000

function maxDateISO() {
  return new Date(Date.now() + MAX_HORIZON_DAYS * DAY_MS).toISOString().slice(0, 10)
}

function minDateISO() {
  // Today, local — the browser's own date input already refuses yesterday
  // when `min` is today; this is belt-and-braces for the pre-submit check.
  return new Date().toISOString().slice(0, 10)
}

/** `expires_at` (unix seconds) -> the days-from-now phrase, or null past the
 *  valid window so the row can fall back to "No expiry". */
export function expiryPhrase(expiresAt, now = Date.now()) {
  if (!expiresAt) return null
  const ms = expiresAt * 1000
  const days = Math.ceil((ms - now) / DAY_MS)
  if (days <= 0) return null
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`
}

function ExpiryControl({ predicateId, expiresAt, onSet }) {
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!draft) return
    setMsg('')
    setBusy(true)
    try {
      const ts = new Date(`${draft}T23:59:59`).getTime() / 1000
      const r = await fetch(`/api/alerts/predicates/${predicateId}/expiry`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_at: ts }),
      })
      let body = null
      try { body = await r.json() } catch { /* empty body */ }
      if (!r.ok) {
        setMsg(body?.detail ? String(body.detail) : `Could not set an expiry (${r.status}).`)
        return
      }
      onSet(predicateId, body?.expires_at ?? ts)
      setDraft('')
    } catch {
      setMsg('Could not reach the server — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setMsg('')
    setBusy(true)
    try {
      const r = await fetch(`/api/alerts/predicates/${predicateId}/expiry`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_at: null }),
      })
      if (!r.ok) {
        let body = null
        try { body = await r.json() } catch { /* empty body */ }
        setMsg(body?.detail ? String(body.detail) : `Could not clear the expiry (${r.status}).`)
        return
      }
      onSet(predicateId, null)
    } catch {
      setMsg('Could not reach the server — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const phrase = expiryPhrase(expiresAt)

  return (
    <span className={styles.sessionMeta} data-testid={`expiry-control-${predicateId}`}>
      {' · '}
      {phrase ? (
        <>
          <span>{phrase}</span>{' '}
          <button type="button" className={styles.btnMuted} disabled={busy} onClick={clear}>
            Clear expiry
          </button>
        </>
      ) : (
        <span>No expiry</span>
      )}
      {' '}
      <input
        type="date"
        aria-label={`Set expiry for ${predicateId}`}
        value={draft}
        min={minDateISO()}
        max={maxDateISO()}
        disabled={busy}
        onChange={e => setDraft(e.target.value)}
      />
      {' '}
      <button type="button" className={styles.btnMuted} disabled={busy || !draft} onClick={submit}>
        Set expiry
      </button>
      {msg && <span role="status">{' '}{msg}</span>}
    </span>
  )
}

export default function FilingWatchesPanel() {
  const filingWatch = useFilingWatch()
  // FT-035: predicate id -> expires_at (unix seconds) | null, set from this
  // control's own PUT responses only (the list response carries none — see
  // ExpiryControl's comment above).
  const [expiryById, setExpiryById] = useState({})
  // Dark until S7_FILING_WATCH_ENABLED — the Settings card disappears
  // entirely rather than rendering an empty management surface.
  if (!filingWatch.enabled) return null
  const watches = [...filingWatch.predicates].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

  if (filingWatch.isLoading) {
    return <div className={styles.section}><span className={styles.hint}>Loading filing watches...</span></div>
  }

  return (
    <div className={styles.section}>
      <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
        Securities you've asked to be notified about when they file something new with the SEC.
      </p>
      {/* TERM-062: the published re-arm rule, composed server-side from the
          constants the sweep applies -- never restated here. */}
      {filingWatch.cooldown && (
        <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }} data-testid="filing-watch-cooldown">
          {filingWatch.cooldown.sentence}
        </p>
      )}
      {watches.length === 0 ? (
        <span className={styles.hint}>No filing watches yet — use the filing-watch action on a ticker's chart or Research page.</span>
      ) : (
        <div className={styles.sessionList}>
          {watches.map(w => {
            const sym = w.entity_scope?.symbol || w.entity_scope?.id || '—'
            const suspended = !!w.suspended_at
            const busy = filingWatch.watchState(sym) === 'CREATING' || filingWatch.watchState(sym) === 'SUSPENDING'
            return (
              <div key={w.id} className={styles.sessionRow}>
                <span className={styles.sessionIcon}><UIcon name="document" size={13} gold={!suspended} /></span>
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionLabel}>
                    {sym}
                    {suspended
                      ? <span className={styles.sessionCurrentPill} style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>Suspended</span>
                      : <span className={styles.sessionCurrentPill}>Active</span>}
                  </div>
                  <div className={styles.sessionMeta}>
                    Created {w.created_at ? formatETDate(w.created_at) : '—'}
                    {!suspended && (
                      <ExpiryControl
                        predicateId={w.id}
                        expiresAt={Object.prototype.hasOwnProperty.call(expiryById, w.id) ? expiryById[w.id] : w.expires_at}
                        onSet={(id, expiresAt) => setExpiryById(prev => ({ ...prev, [id]: expiresAt }))}
                      />
                    )}
                  </div>
                </div>
                <button
                  className={styles.btnMuted}
                  disabled={busy}
                  aria-label={suspended ? `Reactivate filing watch for ${sym}` : `Suspend filing watch for ${sym}`}
                  onClick={() => {
                    if (suspended) filingWatch.createOrReactivate(sym)
                    else filingWatch.suspend(w.id, sym)
                  }}
                >
                  {busy ? '…' : suspended ? 'Reactivate' : 'Suspend'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
