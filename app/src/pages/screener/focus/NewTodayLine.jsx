import { useState } from 'react'
import styles from './FocusScreener.module.css'

const MAX_NAMED = 12

// "3 new · 2 dropped" above the list (spec 2026-10-16 §1). "new" toggles New only;
// "dropped" names who left. Only an `ok` answer draws counts; a live screen gets one
// sentence; everything else (no_history, unsaved, too_wide, no answer) is silent.
export default function NewTodayLine({ nt, newOnly, onToggleNewOnly }) {
  const [open, setOpen] = useState(false)
  if (!nt) return null
  if (nt.state === 'live_screen') {
    return <span className={styles.ntNote}>New markers follow the overnight build; this screen is live</span>
  }
  if (nt.state !== 'ok') return null
  const entered = nt.entered || []
  const exited = nt.exited || []
  return (
    <span className={styles.ntLine}>
      <button type="button" className={styles.ntBtn} aria-pressed={newOnly} title={nt.new_since_label}
        onClick={onToggleNewOnly}>{entered.length} new</button>
      <span aria-hidden="true">·</span>
      <button type="button" className={styles.ntBtn} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {exited.length} dropped
      </button>
      {open && (
        <span className={styles.ntPop} role="list">
          {exited.slice(0, MAX_NAMED).map(t => <span key={t} role="listitem">{t}</span>)}
          {exited.length > MAX_NAMED && <span role="listitem">+{exited.length - MAX_NAMED} more</span>}
        </span>
      )}
    </span>
  )
}
