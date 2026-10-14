import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

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

export default function Menu({ label, trigger, children, align = 'left', triggerClassName, testId, width }) {
  const [open, setOpen] = useState(false)
  const btn = useRef(null), pop = useRef(null)
  const id = useId()
  const close = () => { setOpen(false); btn.current?.focus() }
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    pop.current?.querySelector('[role=menuitem]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(pop.current?.querySelectorAll('[role=menuitem]') || [])]
    const i = items.indexOf(document.activeElement)
    const n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[n]?.focus()
  }
  return (
    <span className={styles.menuWrap} data-testid={testId}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={label} className={triggerClassName || styles.btn} onClick={() => setOpen(o => !o)}>{trigger}</button>
      {open && (
        <CloseCtx.Provider value={close}>
          <div ref={pop} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown}
            className={`${styles.menu} ${align === 'right' ? styles.menuRight : ''}`} style={width ? { width } : undefined}>
            {children}
          </div>
        </CloseCtx.Provider>
      )}
    </span>
  )
}
