/**
 * The discipline-lock rows (P4a, ruling P4a-T9-R2).
 *
 * ONE place builds a lock row, because two surfaces show them: the coach strip (CoachStrip.jsx), which carries
 * the lock rows first, and the lock notice Today shows on its own when the member has hidden the coach strip
 * (DisciplineLockStrip.jsx). A hidden coach strip must not hide an active discipline lock, and the two copies of
 * the notice must read the same. Both draw the rows with CoachRows.jsx.
 */

export const COMPASS_ROUTE = '/journal/compass'

export function fmtCountdown(unlockAt) {
  if (!unlockAt) return null
  const ms = new Date(unlockAt).getTime() - Date.now()
  if (ms <= 0) return null
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/** One row per active lock reason, most urgent first in any strip that shows them. Empty when not locked. */
export function lockItems(disciplineState) {
  if (!disciplineState?.locked || !Array.isArray(disciplineState.reasons)) return []
  return disciplineState.reasons.map((r, i) => {
    const countdown = fmtCountdown(r.unlockAt)
    return {
      key: `lock-${r.type || i}`,
      kind: 'lock',
      sev: 'danger',
      icon: 'noEntry',
      label: 'Trade entry locked',
      message: countdown ? `${r.message} — unlocks in ${countdown}` : r.message,
      to: COMPASS_ROUTE,
      openLabel: 'Open Compass',
    }
  })
}
