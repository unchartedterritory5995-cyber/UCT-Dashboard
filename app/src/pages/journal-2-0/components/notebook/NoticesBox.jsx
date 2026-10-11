// components/notebook/NoticesBox.jsx -- Research Home's Notices (owner decision 2, 2026-10-11): the
// desktop bell was removed by request, so resurfaced notes, task reminders and fill notices land
// here. Folded by default; renders nothing when there is nothing to show. A failed read THROWS
// (TERM-033: never `.catch(() => null)`), so SWR holds it as an error: a read that never answered
// shows nothing new, and a later failed poll keeps the rows the last good read returned rather
// than blanking them (a failed read is not a quiet day, and it is not worth a banner either).
//
// Two reads, both the ones the bell and the Settings inbox already make:
//   GET /api/alerts?limit=20    the member's bell rows (a bare list), filtered by lib/notices.js
//   GET /api/voice/insights     the resurfacing insights ({insights: [...]}); 403 for a member
//                               without voice access, which simply means no resurfaced notes here
// The SWR keys carry the signed-in identity, as AlertBell's do: no member id, no fetch, and a
// different member never inherits the previous one's rows from a shared cache entry.
import { useContext } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { AuthContext } from '../../../../context/AuthContext'
import { toNotices } from '../../lib/notices'
import styles from './NoticesBox.module.css'

const ALERTS_URL = '/api/alerts?limit=20'
const INSIGHTS_URL = '/api/voice/insights'
const POLL = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: 120000 })
// A failing read throws; SWR keeps it as `error` and `data` stays what the last good read returned.
async function get(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.json()
}

export default function NoticesBox() {
  const userId = useContext(AuthContext)?.user?.id ?? null
  const { data: alerts, mutate: reloadAlerts } = useSWR(userId ? [ALERTS_URL, userId] : null, ([url]) => get(url), POLL)
  const { data: insights, mutate: reloadInsights } = useSWR(userId ? [INSIGHTS_URL, userId] : null, ([url]) => get(url), POLL)
  const items = toNotices(alerts, insights)
  if (!items.length) return null

  // Mark it read (an alert) or dismiss it (an insight), then re-read: the row leaves because the
  // SERVER says it is gone. A POST that failed or never arrived leaves the row where it was: there
  // is nothing to re-read, and the next poll shows the server's answer either way.
  const done = async (n) => {
    const alertRow = n.source === 'alert'
    const url = alertRow ? `/api/alerts/${encodeURIComponent(n.id)}/read` : `/api/voice/insights/${encodeURIComponent(n.id)}/dismiss`
    let ok = false
    try {
      ok = (await fetch(url, { method: 'POST', credentials: 'include' })).ok
    } catch {
      ok = false // network failure: the row stays, as above
    }
    if (ok) await (alertRow ? reloadAlerts() : reloadInsights())
  }

  return (
    <details className={styles.box} data-tour="home-notices" data-export-exclude>
      <summary className={styles.summary}>Notices · {items.length}</summary>
      <ul className={styles.list}>
        {items.map((n) => (
          <li key={n.key} className={styles.row}>
            <div className={styles.main}>
              {n.href
                ? <Link to={n.href} className={styles.title} onClick={() => done(n)}>{n.title}</Link>
                : <span className={styles.title}>{n.title}</span>}
              {n.line && <span className={styles.line}>{n.line}</span>}
            </div>
            <button type="button" className={styles.dismiss} aria-label={`Dismiss ${n.title}`} onClick={() => done(n)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
