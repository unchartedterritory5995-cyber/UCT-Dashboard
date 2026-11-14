import { useEffect, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

export const MAX_NAMED = 12

// "3 new · 2 dropped" above the list (spec 2026-10-16 §1). "new" toggles New only;
// "dropped" names who left. Only an `ok` answer draws counts; a live screen gets one
// sentence; everything else (no_history, unsaved, too_wide, no answer) is silent.
//
// `reasonsFor` (RS screens, unit U12): `async names => ({ TICKER: reason })`. When given, the
// popover asks it ONCE for the names it shows, the first time it opens on them, and each name
// that has a reason carries it.
// ⭐ AS THE NAME'S `title` (AND A SCREEN-READER LINE), NOT A SECOND VISIBLE LINE. The popover is
// a 260px wrap of ticker chips; a sentence beside each chip ("RS Rating at least 80: 74") would
// turn it into a list of rows and move the layout for every screen that never has a reason. So
// the chip keeps its place, shows the reason on hover or long-press, says it to a screen reader,
// and is underlined with dots so a member can tell there is one. No answer, or a failed read,
// leaves the chips exactly as they were.
export default function NewTodayLine({ nt, newOnly, onToggleNewOnly, reasonsFor = null }) {
  const [open, setOpen] = useState(false)
  // The reasons last asked for, filed under the names they were asked about.
  const [reasons, setReasons] = useState({ key: '', map: {} })
  const ask = useRef(reasonsFor)
  ask.current = reasonsFor
  const named = nt?.state === 'ok' ? (nt.exited || []).slice(0, MAX_NAMED) : []
  const namedKey = named.join(',')
  const canAsk = typeof reasonsFor === 'function'
  useEffect(() => {
    if (!open || !canAsk || !namedKey) return undefined
    let live = true
    Promise.resolve().then(() => ask.current(namedKey.split(','))).then(
      map => { if (live) setReasons({ key: namedKey, map: map && typeof map === 'object' ? map : {} }) },
      () => {})
    return () => { live = false }
  }, [open, canAsk, namedKey])
  const reasonOf = t => (reasons.key === namedKey && typeof reasons.map[t] === 'string' ? reasons.map[t] : '')
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
          {exited.slice(0, MAX_NAMED).map(t => {
            const why = reasonOf(t)
            return why
              ? <span key={t} role="listitem" title={why} className={styles.ntWhy} data-testid={`nt-dropped-${t}`}>{t}<span className="sr-only">: {why}</span></span>
              : <span key={t} role="listitem" data-testid={`nt-dropped-${t}`}>{t}</span>
          })}
          {exited.length > MAX_NAMED && <span role="listitem">+{exited.length - MAX_NAMED} more</span>}
        </span>
      )}
    </span>
  )
}
