// A small UCT-styled dropdown for the NH/NL toolbar — replaces the native <select>
// (whose open option-list can't be themed). Trigger button + portaled popover menu
// (portaled to body so the widget's overflow doesn't clip it), keyboard + outside-
// click close, scrollable with per-item counts. Options: [{value, label, count?}].
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './NhnlDropdown.module.css'

export default function NhnlDropdown({ value, options, onChange, title, minWidth = 108, maxWidth = 220 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const current = options.find(o => o.value === value) || options[0] || { label: '' }

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const place = () => {
      const r = btnRef.current.getBoundingClientRect()
      const w = Math.max(r.width, minWidth)
      let left = r.left
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w)
      const below = window.innerHeight - r.bottom
      const openUp = below < 200 && r.top > below
      setPos({ left: Math.round(left), top: openUp ? undefined : Math.round(r.bottom + 4),
               bottom: openUp ? Math.round(window.innerHeight - r.top + 4) : undefined,
               width: Math.round(w) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, minWidth])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        style={{ maxWidth }}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.triggerLabel}>{current.label}</span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          role="listbox"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width }}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`${styles.item} ${o.value === value ? styles.itemOn : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span className={styles.itemLabel}>{o.label}</span>
              {o.count != null && <span className={styles.itemCount}>{o.count}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
