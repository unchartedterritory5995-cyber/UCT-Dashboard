/**
 * Wave 6 (lane E, item 2) — the lock glyph a LOCKED note carries on its card,
 * its table row and its board card. One component so the words a screen reader
 * hears ("Locked") and the hint a pointer sees are written once, not three
 * times. Not interactive: unlocking is the editor's (and the note menu's) job.
 */
import UIcon from '../../../../components/ui/UIcon'
import styles from './LockedGlyph.module.css'

export default function LockedGlyph({ note, className = '' }) {
  if (note?.locked !== true) return null
  return (
    <span
      className={`${styles.glyph} ${className}`}
      role="img"
      aria-label="Locked"
      title="Locked — editing is off until you unlock it"
    >
      <UIcon name="lock" size={12} gold={false} />
    </span>
  )
}
