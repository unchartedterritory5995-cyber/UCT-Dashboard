// ChoiceMenu (owner 11-15) — the one "pick one" control in Chart Settings: a soft button showing the
// current value (and its icon, when the choice has one) with a ⌄, opening the board's dark menu with
// a ✓ on the current option. Replaces the segmented buttons, the type/mode tiles and the browser's
// own <select> lists, so every choice in the window looks and behaves the same.
// Keyboard: Enter / Space / ↓ opens; ↑ ↓ move; Enter picks; Escape closes and returns focus.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ChoiceMenu.module.css'

// `ariaNote` (optional) is appended to the accessible name, e.g. "(coming soon)" on a disabled preview.
export default function ChoiceMenu({ value, options = [], onChange, ariaLabel, ariaNote, title, disabled = false, guide }) {
  const cur = options.find((o) => String(o.value) === String(value)) || options[0] || { label: '' }
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [hi, setHi] = useState(0)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const r = btnRef.current.getBoundingClientRect()
    const doc = btnRef.current.ownerDocument
    const win = doc.defaultView || window
    const W = Math.max(160, Math.round(r.width))
    const H = Math.min(320, options.length * 32 + 12)
    const left = Math.max(6, Math.min(r.right - W, win.innerWidth - W - 6))
    const top = r.bottom + 4 + H > win.innerHeight - 6 ? Math.max(6, r.top - 4 - H) : r.bottom + 4
    setPos({ left: Math.round(left), top: Math.round(top), width: W, target: doc.body })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return undefined
    const doc = btnRef.current?.ownerDocument || document
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    doc.addEventListener('mousedown', onDown, true)
    return () => doc.removeEventListener('mousedown', onDown, true)
  }, [open])

  const openMenu = () => {
    if (disabled) return
    setHi(Math.max(0, options.findIndex((o) => String(o.value) === String(value))))
    setOpen(true)
  }
  const pick = (o) => {
    setOpen(false)
    btnRef.current?.focus?.()
    if (o && !o.disabled && String(o.value) !== String(value)) onChange?.(o.value)
  }
  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus?.() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[hi]) }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.btnOn : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${cur.label}${ariaNote ? ` ${ariaNote}` : ''}` : undefined}
        title={title}
        disabled={disabled}
        aria-disabled={disabled ? 'true' : undefined}
        data-guide={guide}
      >
        {cur.icon && <span className={styles.icon} aria-hidden="true">{cur.icon}</span>}
        <span className={styles.value}>{cur.label}</span>
        <svg className={styles.caret} width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"><path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
          role="listbox"
          aria-label={ariaLabel}
          data-choice-menu=""
          // ColorPicker's PORTAL_POPUP_ATTR, spelled out (no import): the list portals to <body>, and a
          // host that closes on an outside mousedown (the chart toolbar's panel under the formula
          // builder) treats a node carrying it as logically inside whatever opened it.
          data-chart-portal-popup="choice-menu"
          onKeyDown={onKeyDown}
        >
          {options.map((o, i) => {
            const on = String(o.value) === String(value)
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={on}
                disabled={o.disabled}
                title={o.hint || undefined}
                className={`${styles.item}${on ? ' ' + styles.itemOn : ''}${i === hi ? ' ' + styles.itemHi : ''}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o)}
              >
                {o.icon && <span className={styles.icon} aria-hidden="true">{o.icon}</span>}
                <span className={styles.label}>{o.label}</span>
                {on && <span className={styles.check} aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>,
        pos.target,
      )}
    </>
  )
}
