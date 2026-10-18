/**
 * The discipline-lock notice on its own (P4a, ruling P4a-T9-R2).
 *
 * The coach strip carries the lock rows first. A member can hide the coach strip on Today (page layouts), and a
 * hidden strip must not hide an active lock, so Today renders THIS in the strip's absence: the same rows
 * (coachLock.lockItems, drawn by CoachRows), in the same strip styling, and nothing else from the strip.
 * Renders null when the account is not locked, so an unlocked Today shows nothing extra.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useJ2DisciplineState from '../hooks/useJ2DisciplineState'
import CoachRows from './CoachRows'
import { lockItems } from './coachLock'
import styles from './CoachStrip.module.css'

export default function DisciplineLockStrip({ accountId }) {
  const navigate = useNavigate()
  const { state } = useJ2DisciplineState(accountId)
  const items = useMemo(() => lockItems(state), [state])
  if (items.length === 0) return null
  return (
    <div className={styles.strip} data-testid="discipline-lock-strip" role="region" aria-label="Trade entry locked">
      <CoachRows items={items} onOpen={(to) => navigate(to)} />
    </div>
  )
}
