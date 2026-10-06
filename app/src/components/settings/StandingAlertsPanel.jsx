import { useEffect, useState } from 'react'
import styles from '../../pages/Settings.module.css'

// ── FT-027 — standing screener alerts, owner-scoped ──────────────────────
// A member's spec-alert subscriptions (`GET /api/screener/spec-alerts`),
// each row showing what it watches plus a remove action. Probed on mount,
// same idiom as AlertRoutingPanel: `SCREENER_SPEC_ALERTS_ENABLED` is read
// server-side only, so a 404 here means "render nothing" rather than a
// second client-side flag to keep in step with the real gate.
//
// ⛔ "Remove" is `POST .../suspend`, NEVER A DELETE — there is no delete
// route. The spec, its snapshots and its fire history all stay (the
// service module's own rule); the member can be told to come back to
// standing alerts another way if a true re-subscribe is ever wanted. This
// mirrors FilingWatchesPanel's suspend-only model for the same reason.

async function call(fetcher, method, url, body) {
  const init = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const r = await fetcher(url, init)
  let json = null
  try { json = await r.json() } catch { /* empty body */ }
  if (!r.ok) throw new Error(json?.detail ? String(json.detail) : `Request failed (${r.status})`)
  return json
}

/** How many filter criteria a subscription's spec carries — the basis of
 *  the row's "what it watches" summary. Pure + exported so it can be
 *  asserted without a DOM. */
export function criteriaCount(sub) {
  const filters = sub?.spec?.filters
  return Array.isArray(filters) ? filters.length : 0
}

const MODE_LABEL = { entry: 'enters', exit: 'leaves', both: 'enters or leaves' }

export default function StandingAlertsPanel({ fetcher = fetch }) {
  const [subs, setSubs] = useState(null)
  const [max, setMax] = useState(null)
  const [msg, setMsg] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = () => call(fetcher, 'GET', '/api/screener/spec-alerts').then(r => {
    setSubs(Array.isArray(r?.alerts) ? r.alerts : [])
    setMax(r?.max ?? null)
  })

  useEffect(() => { load().catch(() => {}) }, [fetcher]) // eslint-disable-line react-hooks/exhaustive-deps

  if (subs === null) return null
  if (subs.length === 0) {
    return (
      <div className={styles.prefRow} data-testid="standing-alerts-row">
        <div className={styles.prefLabelGroup}>
          <span className={styles.prefLabel}>Standing screen alerts</span>
          <span className={styles.prefDesc}>
            No standing screen alerts yet — save a screen as a standing alert from the Screener to be told, overnight, when a name enters or leaves it.
          </span>
        </div>
      </div>
    )
  }

  const remove = async (sub) => {
    setMsg('')
    setBusyId(sub.id)
    try {
      await call(fetcher, 'POST', `/api/screener/spec-alerts/${sub.id}/suspend`)
      await load()
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const active = subs.filter(s => !s.suspended)

  return (
    <div className={styles.prefRow} data-testid="standing-alerts-row">
      <div className={styles.prefLabelGroup}>
        <span className={styles.prefLabel}>Standing screen alerts</span>
        <span className={styles.prefDesc}>
          Checked nightly. You're told when a name enters or leaves the screen below.
          {max != null && ` Up to ${max} at a time.`}
        </span>
        <div className={styles.sessionList} style={{ marginTop: 8 }}>
          {subs.map(sub => {
            const n = criteriaCount(sub)
            const suspended = !!sub.suspended
            return (
              <div key={sub.id} className={styles.sessionRow} data-testid="standing-alert-row">
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionLabel}>
                    {sub.name}
                    {suspended
                      ? <span className={styles.sessionCurrentPill} style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>Removed</span>
                      : <span className={styles.sessionCurrentPill}>Active</span>}
                  </div>
                  <div className={styles.sessionMeta}>
                    {n > 0 ? `${n} ${n === 1 ? 'criterion' : 'criteria'}` : 'screen'} · alerts when a name {MODE_LABEL[sub.mode] || sub.mode}
                  </div>
                </div>
                {!suspended && (
                  <button
                    type="button"
                    className={styles.btnMuted}
                    disabled={busyId === sub.id}
                    aria-label={`Remove standing alert ${sub.name}`}
                    onClick={() => remove(sub)}
                  >
                    {busyId === sub.id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {active.length === 0 && (
          <span className={styles.hint}>All standing screen alerts are removed.</span>
        )}
        {msg && <span className={styles.prefDesc} role="status">{msg}</span>}
      </div>
    </div>
  )
}
