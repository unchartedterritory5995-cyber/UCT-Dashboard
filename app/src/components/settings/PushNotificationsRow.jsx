import { useEffect, useState } from 'react'
import styles from '../../pages/Settings.module.css'
import {
  fetchPushConfig, pushSupport, currentSubscription, enablePush, disablePush,
} from '../../utils/webPush'

// ── BRK-04 — "Push notifications to this device" ───────────────────────
// Dark until WEB_PUSH_ENABLED: /api/push/config 404s and this row renders
// nothing. Also nothing when the VAPID keys are unset (configured=false) or
// the member is not on a paid plan (402).
//
// ⛔ Browser permission is requested ONLY inside the click handler below
// (via `enablePush`) — never on mount, never on render.

const REASON_TEXT = {
  insecure: 'Push needs a secure (https) connection.',
  'no-service-worker': 'This browser does not support push notifications.',
  'no-push': 'This browser does not support push notifications. On iPhone or iPad, add UCT to your Home Screen first.',
  'no-notification': 'This browser does not support notifications.',
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  dismissed: 'Permission was not granted.',
  server: 'Could not save this device. Try again.',
  'subscribe-failed': 'Could not subscribe this device. Try again.',
}

export default function PushNotificationsRow() {
  const [config, setConfig] = useState(undefined) // undefined = loading, null = unavailable
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const cfg = await fetchPushConfig()
      if (!live) return
      setConfig(cfg)
      if (cfg) {
        const sub = await currentSubscription()
        if (live) setOn(!!sub)
      }
    })()
    return () => { live = false }
  }, [])

  if (!config) return null
  const support = pushSupport()

  const onToggle = async () => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        const res = await enablePush(config.public_key)
        if (res.ok) setOn(true)
        else setMsg(REASON_TEXT[res.reason] || 'Could not turn on push notifications.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.prefRow} data-testid="push-notifications-row">
      <div className={styles.prefLabelGroup}>
        <span className={styles.prefLabel}>Push notifications to this device</span>
        <span className={styles.prefDesc}>
          Your alerts arrive as notifications on this device, even when UCT is closed.
          {' '}iPhone and iPad: works only after you add UCT to your Home Screen
          (Share, then Add to Home Screen) and open it from there, on iOS 16.4 or later.
        </span>
        {!support.ok && (
          <span className={styles.prefDesc} data-testid="push-unsupported">{REASON_TEXT[support.reason]}</span>
        )}
        {msg && <span className={styles.prefDesc} role="status">{msg}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Push notifications to this device"
        className={styles.btn}
        disabled={busy || !support.ok}
        onClick={onToggle}
      >
        {busy ? '…' : on ? 'On' : 'Off'}
      </button>
    </div>
  )
}
