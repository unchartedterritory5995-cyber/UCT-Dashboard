// app/src/components/DesktopStaleBanner.jsx
//
// The desktop app's one stale-data banner. A leaf rendered by DesktopBridgeSync, so only the
// desktop app ever mounts it, and its state cannot reach Layout.
//
// Driven by lib/recovery.js (desktop plan 6.4): 'offline' while the network is down, and
// "Reconnecting" from a wake or a network return until sign-in has been re-checked and every live
// stream reports connected (capped at recovery's CAP_MS). It used to clear on a blind 20 s timer.
import { useSyncExternalStore } from 'react'
import { appRecovery } from '../lib/recovery'
import styles from './DesktopStaleBanner.module.css'

const MESSAGES = {
  offline: 'You are offline. Prices and charts on screen are not updating.',
  catchingUp: 'Reconnecting. Data on screen may be a moment behind.',
}

const KIND = { offline: 'offline', recovering: 'catchingUp', idle: null }

export default function DesktopStaleBanner({ recovery = appRecovery() } = {}) {
  const state = useSyncExternalStore(recovery.subscribe, recovery.getState)
  const kind = KIND[state] ?? null
  if (!kind) return null
  return <div className={styles.banner} role="status">{MESSAGES[kind]}</div>
}
