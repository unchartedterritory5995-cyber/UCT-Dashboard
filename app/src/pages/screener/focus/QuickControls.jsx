// The quick controls row under the Focus top bar (RS screens, unit U5; plan v2 section 4): at
// most three segmented controls a starter declares in `controls`. Rendered only for a starter
// that has them.
//
// ⛔ NO STATE OF ITS OWN ABOUT THE CHOICE. Which option is on, and whether a control is off its
// default, are read from the working spec on every render (rsScreens.activeOption): a choice
// is an ordinary filter edit, made by the caller through the Filters drawer's own editor.
//
// Phones (<= 640 px): the first control stays in the row and "Adjust" opens the rest in the
// app's bottom sheet. Which of the two a member sees is decided in CSS (RsScreens.module.css),
// never from a hook seeded at mount, which is stale at first paint on a phone.
import { useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import { MQ } from '../../../styles/breakpoints'
import { activeOption, defaultOption } from './rsScreens'
import focus from './FocusScreener.module.css'
import styles from './RsScreens.module.css'

const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

// The gold dot: this control is off its default. Said in words for a screen reader.
const ChangedDot = () => <><span className={styles.dot} aria-hidden="true" data-testid="rs-dot" /><span className="sr-only"> (changed)</span></>

// One segmented control, with radio semantics: the arrow keys move and choose, Home and End
// jump, and one option is in the tab order (the active one, or the first while it reads Custom).
function Control({ control, active, changed, onChoose, className = '' }) {
  const labelId = useId()
  const btns = useRef([])
  const options = control.options
  const at = options.findIndex(o => o.id === active?.id)
  const onKeyDown = (e, i) => {
    let n
    if (STEP[e.key]) n = (i + STEP[e.key] + options.length) % options.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = options.length - 1
    else return
    e.preventDefault()
    e.stopPropagation()
    btns.current[n]?.focus()
    if (n !== at) onChoose(control, options[n])
  }
  return (
    <span className={`${styles.control} ${className}`} data-control={control.id} data-changed={changed ? '' : undefined}>
      <span className={styles.label} id={labelId}>{control.label}{changed && <ChangedDot />}</span>
      <span className={styles.scroll}>
        <span role="radiogroup" aria-labelledby={labelId} className={focus.seg}>
          {options.map((o, i) => (
            <button key={o.id} ref={el => { btns.current[i] = el }} type="button" role="radio" aria-checked={i === at}
              tabIndex={i === (at >= 0 ? at : 0) ? 0 : -1} className={`${i === at ? focus.segOn : focus.segOff} ${styles.opt}`}
              onClick={() => { if (i !== at) onChoose(control, o) }} onKeyDown={e => onKeyDown(e, i)}>{o.label}</button>
          ))}
          {/* No option matches the working spec (the member edited these filters in the drawer,
              or re-sorted): said, never selectable. */}
          {at < 0 && <span role="radio" aria-checked="true" aria-disabled="true" className={`${focus.segOn} ${styles.custom}`}>Custom</span>}
        </span>
      </span>
    </span>
  )
}

// `filters`, `sort`, `rank`: the WORKING spec (useScreenSpec's keyed filters).
// `onChoose(control, option)` edits it; `onReset()` restores the starter's own spec.
export default function QuickControls({ controls, filters, sort, rank = null, onChoose, onReset }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const adjustBtn = useRef(null)
  // A phone rotated past the phone width with the sheet open: the row shows every control
  // again, so the sheet closes (a `change` only; the open itself is the member's tap).
  useEffect(() => {
    if (!sheetOpen) return undefined
    const mq = window.matchMedia?.(MQ.phone)
    if (!mq?.addEventListener) return undefined
    const onChange = () => { if (!mq.matches) setSheetOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [sheetOpen])
  if (!controls?.length) return null
  const spec = { filters, sort, rank }
  const state = controls.map(control => {
    const active = activeOption(control, spec)
    return { control, active, changed: (active?.id ?? null) !== (defaultOption(control)?.id ?? null) }
  })
  const anyChanged = state.some(s => s.changed)
  const rest = state.slice(1)
  const hasSheet = rest.length > 0
  return (
    <div className={styles.controls} role="group" aria-label="Quick controls" data-testid="rs-controls">
      {state.map((s, i) => <Control key={s.control.id} {...s} onChoose={onChoose} className={i > 0 ? styles.rest : styles.first} />)}
      {hasSheet && (
        <button ref={adjustBtn} type="button" className={`${focus.btn} ${styles.adjust}`} aria-haspopup="dialog" aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}>Adjust{anyChanged && <ChangedDot />}</button>
      )}
      {/* One Reset for the row. On a phone it lives in the sheet when there is one. */}
      {anyChanged && <button type="button" className={`${focus.linkBtn} ${styles.reset} ${hasSheet ? styles.resetInRow : ''}`} onClick={onReset}>Reset</button>}
      {hasSheet && (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} variant="bottom-sheet" title="Adjust" ariaLabel="Adjust this screen" returnFocusTo={adjustBtn}>
          {sheetOpen && (
            <div className={styles.sheet} data-testid="rs-controls-sheet">
              {rest.map(s => <Control key={s.control.id} {...s} onChoose={onChoose} className={styles.stacked} />)}
              {anyChanged && <button type="button" className={`${focus.btn} ${styles.sheetReset}`} onClick={() => { onReset(); setSheetOpen(false) }}>Reset</button>}
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
