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

// 🔴 THE ALERT THAT REACHED NOBODY. `GET /api/indicator-alerts/delivery-health`
// serves the fires whose delivery failed on at least one channel — the read that
// existed in `alert_fired_log` for a whole phase with no route and then no
// consumer. It is rendered HERE, in the bell, because the bell is where a member
// looks for what they were told, and a missing alert is a fact about that list.
//
// ⚠️ A FAILED FETCH RESOLVES TO "NOTHING TO REPORT", NOT TO AN ERROR. The bell's
// job is the feed; a 500 on this secondary read may not take the notification
// list down with it. The cost of that choice is that "no failures" and "could not
// ask" render identically — acceptable only because the SERVER-side record is
// durable and the route can be read again.
const deliveryFetcher = url =>
  fetch(url, { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(b => (b && typeof b === 'object' ? b : null))
    .catch(() => null)

/** Which channels a fire FAILED on — from the server's own per-channel map.
 *
 *  ⛔ THE STATUS STRINGS ARE THE SERVER'S (`api/services/alerts.py`), and this
 *  reads them rather than re-deriving a verdict. 'skipped' is NOT a failure:
 *  an unset Discord webhook and a member with no address on file are both
 *  skipped, and painting them red would send somebody hunting an outage that
 *  does not exist. */
export function failedChannelsOf(fire) {
  const map = fire && fire.delivery_channels
  if (!map || typeof map !== 'object') return []
  return Object.keys(map).filter(k => map[k] === 'failed').sort()
}

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
  // Same identity key discipline as the feed above: no poll while signed out,
  // and one member's delivery failures never sit in another's cache entry.
  const { data: delivery } = useSWR(
    userId ? ['/api/indicator-alerts/delivery-health?limit=10', userId] : null,
    ([url]) => deliveryFetcher(url),
    { refreshInterval: 120000 },
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

  // ⛔ THE LIST IS THE AUTHORITY, NOT THE COUNT. The server serves both a
  // `health.trouble` total and the failing rows; rendering the total beside a
  // list built from the rows would be two answers to one question, and the
  // header would say "2" over one row the first time the limit clipped it.
  const failures = userId && Array.isArray(delivery?.failures) ? delivery.failures : []

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
      <button
        className={styles.bell}
        onClick={handleBellClick}
        title={failures.length > 0 ? 'Alerts — one or more could not be delivered' : 'Alerts'}
        aria-label="Notifications"
      >
        <span className={styles.bellIcon}><UIcon name="bell" size={18} /></span>
        {unreadCount > 0 && <span className={styles.badge} aria-live="polite">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        {failures.length > 0 && <span className={styles.troubleDot} aria-hidden="true" />}
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Alerts</span>
            {unreadCount > 0 && (
              <button className={styles.markAll} onClick={markAllRead}>Mark all read</button>
            )}
          </div>

          {/* 🔴 THE ALERTS THAT DID NOT REACH YOU. Rendered ABOVE the feed on
              purpose: it is a statement about what is MISSING from the list
              below, and underneath it would be read as one more notification. */}
          {failures.length > 0 && (
            <div className={styles.trouble} role="status">
              <div className={styles.troubleHead}>
                <UIcon name="warning" size={13} gold={false} />
                <span>Not delivered everywhere</span>
              </div>
              {failures.map(f => {
                const bad = failedChannelsOf(f)
                return (
                  <div key={f.id} className={styles.troubleRow}>
                    <span className={styles.troubleSym}>{f.sym}</span>
                    <span className={styles.troubleWhat}>
                      {bad.length > 0
                        ? `failed on ${bad.join(', ')}`
                        : 'was not delivered'}
                    </span>
                    <span className={styles.itemTime}>{timeAgo(f.fired_at)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {items.length === 0 && failures.length === 0 && (
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
