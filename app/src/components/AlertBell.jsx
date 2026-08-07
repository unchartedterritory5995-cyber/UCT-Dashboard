// app/src/components/AlertBell.jsx — Notification bell with dropdown + sound + browser push
//
// ⚠️ THIS COMPONENT MAKES THE DEVICE CHIME AND RAISES AN OS NOTIFICATION. That
// is the user-visible face of the 2026-08-06 alert-feed leak: while /api/alerts
// was one unauthenticated global list, any member's alert could ding any other
// member's phone. Two things keep that impossible now:
//   1. the server scopes the feed (see api/services/alerts.py) — the payload
//      only ever holds the caller's own alerts plus market-wide broadcasts;
//   2. this component keys its "what's new" bookkeeping to the SIGNED-IN
//      IDENTITY, and does not poll at all when nobody is signed in. Without (2)
//      a sign-out → sign-in on the same tab would carry the previous member's
//      seen-id set into the next member's session and chime on their first poll.
import { useState, useRef, useEffect, useContext } from 'react'
import useSWR from 'swr'
import { playAlertSound, showBrowserNotification, requestNotificationPermission } from '../utils/alertSound'
import usePreferences from '../hooks/usePreferences'
import { timeAgoShort as timeAgo } from '../utils/timeAgo'
import { AuthContext } from '../context/AuthContext'
import UIcon from './ui/UIcon'
import styles from './AlertBell.module.css'

// `credentials: 'same-origin'` is the browser default, stated explicitly
// because the session cookie is now load-bearing: without it every request is
// a 401. A 401/403 resolves to an empty feed, never to a stale one.
const fetcher = url =>
  fetch(url, { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : []))

const TYPE_ICONS = {
  regime_change: 'refresh',
  stop_hit: 'warning',
  scanner_match: 'screener',
  ep_resolved: 'check',
  exposure_shift: 'breadth',
  price_alert: 'bell',
}

const SEV_CLASS = {
  critical: 'sevCritical',
  warning: 'sevWarning',
  info: 'sevInfo',
}

// timeAgo extracted to ../utils/timeAgo.js for reuse across MoversSidebar
// + EarningsModal. AlertBell keeps its original short form via timeAgoShort.

export default function AlertBell() {
  // Read the context directly rather than via useAuth() so an isolated render
  // with no AuthProvider (component tests) degrades to "signed out" instead of
  // throwing. Signed out = no poll = no feed = no sound.
  const auth = useContext(AuthContext)
  const userId = auth?.user?.id ?? null

  // The SWR key carries the identity. Two consequences, both deliberate:
  // a null key means SWR does not fetch at all while signed out, and a
  // different member gets a different cache entry rather than inheriting the
  // previous one's rows.
  const { data: alerts, mutate } = useSWR(
    userId ? ['/api/alerts?limit=20', userId] : null,
    ([url]) => fetcher(url),
    { refreshInterval: 60000 },
  )
  const { prefs } = usePreferences()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const prevIdsRef = useRef(new Set())
  const initialLoadRef = useRef(true)
  const identityRef = useRef(userId)
  const soundEnabled = prefs.alert_sound !== 'off'
  const soundKey = prefs.alert_sound_type || 'chime'

  const items = userId && Array.isArray(alerts) ? alerts : []
  const unreadCount = items.filter(a => !a.read).length

  // A change of signed-in identity resets the "already seen" bookkeeping, so
  // the next member's first poll is treated as a first load (silent) instead of
  // as a burst of brand-new alerts.
  //
  // ⛔ THIS IS THE ONLY MECHANISM — deliberately not belt-and-braces. An
  // earlier version also early-returned from the detector below while the
  // identities disagreed, and that second guard made deleting THIS one a
  // silent no-op: the component went permanently mute instead of chiming, so
  // the mutation "identity reset removed" survived its own test. One
  // mechanism, one gate, one thing a test can kill.
  //
  // React runs effects in declaration order, so this lands before the detector
  // on the render where the identity flips.
  useEffect(() => {
    if (identityRef.current !== userId) {
      identityRef.current = userId
      prevIdsRef.current = new Set()
      initialLoadRef.current = true
    }
  }, [userId])

  // Detect new alerts → play sound + browser notification
  useEffect(() => {
    if (!userId) return
    if (!items.length) return
    const currentIds = new Set(items.map(a => a.id))

    // Skip first load (don't ding on page refresh)
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      prevIdsRef.current = currentIds
      return
    }

    // Find alerts that are new (not in previous set) AND unread
    const newAlerts = items.filter(a => !prevIdsRef.current.has(a.id) && !a.read)
    prevIdsRef.current = currentIds

    if (newAlerts.length > 0) {
      // Play sound (if enabled)
      if (soundEnabled) playAlertSound(soundKey)

      // Show browser notification for each new alert (max 3)
      newAlerts.slice(0, 3).forEach(a => {
        showBrowserNotification(a.title, a.message)
      })
    }
  }, [items, userId])

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function markAllRead() {
    await fetch('/api/alerts/read-all', { method: 'POST', credentials: 'same-origin' })
    mutate()
  }

  async function markRead(id) {
    await fetch(`/api/alerts/${id}/read`, { method: 'POST', credentials: 'same-origin' })
    mutate()
  }

  function handleBellClick() {
    setOpen(o => !o)
    // Request notification permission on first bell click
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      requestNotificationPermission()
    }
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button className={styles.bell} onClick={handleBellClick} title="Alerts" aria-label="Notifications">
        <span className={styles.bellIcon}><UIcon name="bell" size={18} /></span>
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
                <span className={styles.itemIcon}><UIcon name={TYPE_ICONS[a.type] || 'bell'} size={16} /></span>
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
