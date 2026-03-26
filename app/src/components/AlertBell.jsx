// app/src/components/AlertBell.jsx — Notification bell with dropdown
import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import styles from './AlertBell.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const TYPE_ICONS = {
  regime_change: '🔄',
  stop_hit: '🛑',
  scanner_match: '⚡',
  ep_resolved: '✅',
  exposure_shift: '📊',
}

const SEV_CLASS = {
  critical: 'sevCritical',
  warning: 'sevWarning',
  info: 'sevInfo',
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export default function AlertBell() {
  const { data: alerts, mutate } = useSWR('/api/alerts?limit=20', fetcher, { refreshInterval: 60000 })
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const items = Array.isArray(alerts) ? alerts : []
  const unreadCount = items.filter(a => !a.read).length

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function markAllRead() {
    await fetch('/api/alerts/read-all', { method: 'POST' })
    mutate()
  }

  async function markRead(id) {
    await fetch(`/api/alerts/${id}/read`, { method: 'POST' })
    mutate()
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button className={styles.bell} onClick={() => setOpen(o => !o)} title="Alerts" aria-label="Notifications">
        <span className={styles.bellIcon}>🔔</span>
        {unreadCount > 0 && <span className={styles.badge} aria-live="polite">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Alerts</span>
            {unreadCount > 0 && (
              <button className={styles.markAll} onClick={markAllRead}>Mark all read</button>
            )}
          </div>

          {items.length === 0 && (
            <div className={styles.empty}>No alerts yet</div>
          )}

          <div className={styles.list}>
            {items.map(a => (
              <div
                key={a.id}
                className={`${styles.item} ${!a.read ? styles.unread : ''} ${styles[SEV_CLASS[a.severity]] || ''}`}
                onClick={() => !a.read && markRead(a.id)}
              >
                <span className={styles.itemIcon}>{TYPE_ICONS[a.type] || '📢'}</span>
                <div className={styles.itemBody}>
                  <div className={styles.itemTitle}>{a.title}</div>
                  <div className={styles.itemMsg}>{a.message}</div>
                </div>
                <span className={styles.itemTime}>{timeAgo(a.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
