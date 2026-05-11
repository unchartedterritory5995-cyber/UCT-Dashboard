/**
 * Shared session-discipline lock banner.
 *
 * Driven by the state object from useJ2DisciplineState. Renders one line
 * per active reason (daily_loss / cooling_off / no_trade_window) with a
 * mm:ss countdown when the reason has an `unlockAt` timestamp. Mirrors the
 * Phase A risk-cap banner styling so the two feel like the same family of
 * guard.
 *
 * Props:
 *   state: discipline state object from useJ2DisciplineState (may be null/undefined)
 *   overrideArmed: boolean
 *   onArmOverride: () => void
 */

import { useEffect, useState } from 'react'
import styles from './AlertBanner.module.css'

const ICON_BY_TYPE = {
  daily_loss: '🛑',
  cooling_off: '⏳',
  no_trade_window: '🕒',
}

function fmtCountdown(unlockAt) {
  if (!unlockAt) return null
  const ms = new Date(unlockAt).getTime() - Date.now()
  if (ms <= 0) return null
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export default function DisciplineLockBanner({ state, overrideArmed, onArmOverride }) {
  const isLocked = !!(state && state.locked && state.reasons && state.reasons.length > 0)

  // Tick once per second while locked so countdowns re-render smoothly
  // between the parent's 5s SWR polls. Cleared on unmount or when unlocked.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isLocked) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [isLocked])

  if (!isLocked) return null

  return (
    <div
      role="alert"
      className={styles.alert}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🚫 Trade entry locked
      </div>
      <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
        {state.reasons.map((r, i) => {
          const countdown = fmtCountdown(r.unlockAt)
          return (
            <li key={`${r.type}-${i}`} style={{ marginBottom: 2 }}>
              {ICON_BY_TYPE[r.type] || '⚠️'} {r.message}
              {countdown && (
                <span style={{ opacity: 0.85 }}>{' '}— unlocks in {countdown}</span>
              )}
            </li>
          )
        })}
      </ul>
      {overrideArmed
        ? <span>Override armed — Save will commit anyway.</span>
        : (
          <button
            type="button"
            onClick={onArmOverride}
            className={styles.alertOverrideBtn}
          >
            Override
          </button>
        )}
    </div>
  )
}
