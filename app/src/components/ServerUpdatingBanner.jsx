// The one message for the deploy gap (lib/serverGap.js): shown while the web pod is being replaced, gone
// the moment it answers again (and then every view on the page refreshes its data by itself).
import { useSyncExternalStore } from 'react'
import { appServerGap } from '../lib/serverGap'
import styles from './ServerUpdatingBanner.module.css'

export default function ServerUpdatingBanner({ gap = appServerGap() } = {}) {
  const state = useSyncExternalStore(gap.subscribe, gap.getState, gap.getState)
  if (state !== 'updating') return null
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      Updating UCT. Back in a few seconds; everything on screen refreshes by itself.
    </div>
  )
}
