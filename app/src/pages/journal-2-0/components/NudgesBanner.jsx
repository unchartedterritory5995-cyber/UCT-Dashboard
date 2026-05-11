/**
 * Advisory nudges strip (Phase F).
 *
 * Renders 0-3 nudges based on the state from useJ2Nudges:
 *   - loss-streak: count >= threshold.loss
 *   - win-streak: count >= threshold.win
 *   - stale: count >= 1
 *
 * Each nudge has a "Snooze" button that stores a 1-hour expiry in
 * localStorage keyed by accountId + nudge-type. Snoozed nudges don't
 * render until expiry.
 */

import { useState, useEffect, useMemo } from 'react'

const SNOOZE_MS = 60 * 60 * 1000   // 1 hour
const STORAGE_KEY_PREFIX = 'uct.j2.nudges.dismissed.'

function readSnoozed(accountId) {
  if (!accountId) return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + accountId)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeSnoozed(accountId, map) {
  if (!accountId) return
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + accountId, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

export default function NudgesBanner({ accountId, state }) {
  const [snoozed, setSnoozed] = useState(() => readSnoozed(accountId))

  // Reload when accountId changes (e.g., user switches accounts).
  useEffect(() => {
    setSnoozed(readSnoozed(accountId))
  }, [accountId])

  const now = Date.now()

  const isSnoozed = (key) => {
    const expiry = snoozed[key]
    return typeof expiry === 'number' && expiry > now
  }

  const snooze = (key) => {
    const next = { ...snoozed, [key]: Date.now() + SNOOZE_MS }
    setSnoozed(next)
    writeSnoozed(accountId, next)
  }

  const visible = useMemo(() => {
    if (!state) return []
    const out = []
    const { lossStreakCount, winStreakCount, staleCount, thresholds } = state
    const T = thresholds || { loss: 3, win: 5, staleDays: 30 }
    if (lossStreakCount >= T.loss && !isSnoozed('loss')) {
      out.push({
        key: 'loss',
        icon: '🛑',
        message: `${lossStreakCount} down today. Take 15?`,
        tint: 'rgba(239,68,68,0.10)',
        border: 'rgba(239,68,68,0.5)',
      })
    }
    if (winStreakCount >= T.win && !isSnoozed('win')) {
      out.push({
        key: 'win',
        icon: '🏆',
        message: `${winStreakCount} in a row. Don't size up out of euphoria.`,
        tint: 'rgba(34,197,94,0.10)',
        border: 'rgba(34,197,94,0.5)',
      })
    }
    if (staleCount > 0 && !isSnoozed('stale')) {
      out.push({
        key: 'stale',
        icon: '⏳',
        message: `${staleCount} position${staleCount === 1 ? '' : 's'} held ${T.staleDays}+ days with no notes — review these.`,
        tint: 'rgba(201,168,76,0.10)',
        border: 'rgba(201,168,76,0.5)',
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, snoozed])

  if (visible.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 12px' }}>
      {visible.map((n) => (
        <div
          key={n.key}
          role="status"
          style={{
            padding: '8px 12px',
            background: n.tint,
            border: `1px solid ${n.border}`,
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text-bright)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14 }}>{n.icon}</span>
          <span style={{ flex: 1 }}>{n.message}</span>
          <button
            type="button"
            onClick={() => snooze(n.key)}
            aria-label={`Snooze ${n.key}-streak nudge`}
            style={{
              padding: '2px 10px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Snooze 1h
          </button>
        </div>
      ))}
    </div>
  )
}
