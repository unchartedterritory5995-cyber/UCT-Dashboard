// SigMenu — the small UCT Signature action menu the Breadth top bar ("⋯") and the
// Monitor's column headers open.
//
// ⛔ WHY NOT `screener/focus/Menu` (which this mirrors, behaviour for behaviour):
// importing it from Breadth split it out of the Screener chunk into a shared chunk,
// and every lazy route that reaches it then lists that chunk (and its CSS) in the
// main entry's preload map: +432 B on `bytes.notebook_first_open`, which sits a
// few hundred bytes under its budget. A Breadth-local copy keeps the Screener's
// menu inline in its own chunk and costs the notebook nothing. Colours come from
// the page's --br-* theme roles, so it follows the member's app theme too.
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import styles from './SigMenu.module.css'

const CloseCtx = createContext(() => {})

export function SigMenuItem({ onSelect, children, disabled = false }) {
  const close = useContext(CloseCtx)
  return (
    <button type="button" role="menuitem" className={styles.item} disabled={disabled}
      onClick={() => { close(); onSelect?.() }}>
      {children}
    </button>
  )
}

// `header`: optional content above the rows (the column header menu's name +
// description), set off by a hairline. `onOpenChange(open)`: told when the menu
// opens or closes (the header's hover card hides while the menu is open).
// `triggerProps`: extra props for the trigger button (focus/blur for the card).
export default function SigMenu({ label, trigger, children, align = 'left', triggerClassName, testId, width, header = null, onOpenChange, triggerProps = null }) {
  const [open, setOpen] = useState(false)
  const openSeen = useRef(false)
  useEffect(() => {
    if (!openSeen.current && !open) return   // not on mount
    openSeen.current = true
    onOpenChange?.(open)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- report changes of `open` only
  const btn = useRef(null), pop = useRef(null), wrap = useRef(null)
  const id = useId()
  const close = () => { setOpen(false); btn.current?.focus() }
  // Disabled rows are skipped by the arrow keys.
  const items = () => [...(pop.current?.querySelectorAll('[role=menuitem]:not(:disabled)') || [])]
  const rove = active => items().forEach(el => { el.tabIndex = el === active ? 0 : -1 })
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    const first = items()[0]
    rove(first)
    first?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- runs on open only; rove/items read refs
  const onBlur = e => {
    const to = e.relatedTarget
    if (to && !wrap.current?.contains(to)) setOpen(false)
  }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const list = items()
    const i = list.indexOf(document.activeElement)
    const n = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1)
      : e.key === 'ArrowUp' ? Math.max(0, i - 1)
        : e.key === 'Home' ? 0 : list.length - 1
    rove(list[n])
    list[n]?.focus()
  }
  return (
    <span ref={wrap} className={styles.wrap} data-testid={testId} onBlur={onBlur}>
      <button ref={btn} type="button" {...(triggerProps || {})} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={label} className={triggerClassName} onClick={() => setOpen(o => !o)}>{trigger}</button>
      {open && (
        <CloseCtx.Provider value={close}>
          <div ref={pop} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown}
            onFocus={e => { if (e.target.getAttribute('role') === 'menuitem') rove(e.target) }}
            className={`${styles.menu} ${align === 'right' ? styles.right : ''}`} style={width ? { width } : undefined}>
            {header && <div className={styles.header}>{header}</div>}
            {children}
          </div>
        </CloseCtx.Provider>
      )}
    </span>
  )
}
