import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'
import menuStyles from './FocusMenus.module.css'

const CloseCtx = createContext(() => {})

export function MenuItem({ onSelect, hint, children, danger = false }) {
  const close = useContext(CloseCtx)
  return (
    <button type="button" role="menuitem" className={`${styles.menuItem} ${danger ? styles.menuDanger : ''}`}
      onClick={() => { close(); onSelect?.() }}>
      <span>{children}</span>{hint && <span className={styles.menuHint}>{hint}</span>}
    </button>
  )
}
export function MenuDivider() { return <div className={styles.menuDivider} role="separator" /> }
export function MenuHeading({ children }) { return <div className={styles.menuHeading}>{children}</div> }

export default function Menu({ label, trigger, children, align = 'left', triggerClassName, testId, width, disabled = false, disabledTitle }) {
  const [open, setOpen] = useState(false)
  // ⛔ THE ONE GUARD for a disabled menu: open is forced false during render, so a click on the
  // aria-disabled trigger never commits an open menu, a menu that becomes disabled closes (never
  // aria-expanded=true while disabled), and it does not re-pop when enabled again.
  if (disabled && open) setOpen(false)
  const btn = useRef(null), pop = useRef(null), wrap = useRef(null)
  const id = useId()
  const close = () => { setOpen(false); btn.current?.focus() }
  const items = () => [...(pop.current?.querySelectorAll('[role=menuitem]') || [])]
  const rove = active => items().forEach(el => { el.tabIndex = el === active ? 0 : -1 })
  useEffect(() => {
    if (!open) return undefined
    // pointerdown, not mousedown: touch and pen fire pointer events first
    const onDown = e => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    const first = items()[0]
    rove(first)
    first?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- runs on open only; rove/items read refs, not state
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
    let n = i
    if (e.key === 'ArrowDown') n = Math.min(list.length - 1, i + 1)
    else if (e.key === 'ArrowUp') n = Math.max(0, i - 1)
    else if (e.key === 'Home') n = 0
    else n = list.length - 1
    rove(list[n])
    list[n]?.focus()
  }
  return (
    <span ref={wrap} className={styles.menuWrap} data-testid={testId} onBlur={onBlur}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={label} className={`${triggerClassName || styles.btn}${disabled ? ` ${menuStyles.triggerDisabled}` : ''}`}
        /* ⛔ aria-disabled, never `disabled`: a disabled trigger stays in the tab order and can
           take focus (a skip link may land on it, its title stays reachable); the click guard is
           is the ONE guard that keeps it shut: a click (or Enter/Space) on it is undone in that same render. */
        aria-disabled={disabled ? 'true' : undefined} title={disabled ? disabledTitle : undefined}
        onClick={() => setOpen(o => !o)}>{trigger}</button>
      {open && (
        <CloseCtx.Provider value={close}>
          <div ref={pop} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown} onFocus={e => { if (e.target.getAttribute('role') === 'menuitem') rove(e.target) }}
            className={`${styles.menu} ${align === 'right' ? styles.menuRight : ''}`} style={width ? { width } : undefined}>
            {children}
          </div>
        </CloseCtx.Provider>
      )}
    </span>
  )
}
