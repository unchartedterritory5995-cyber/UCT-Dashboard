import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import styles from './TradeExchangeNewsWidget.module.css'

// UCT frame (owner 11-13): the News widget's watchlist filter as a check-mark menu like the other
// board menus (Theme sets, the Watchlist library), with a search once the list is long. Same value
// and handler as the <Select> it replaces on the board.
export default function TradeExchangeNewsListPicker({ value, options, onChange, menuVars, allLabel = 'All lists', menuLabel = 'Show headlines from',
  ariaLabel = 'Filter by watchlist', title = 'Only headlines naming a symbol on this watchlist', findLabel = 'Find a list…' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)
  const cur = options.find((o) => o.value === (value || '')) || options[0]
  const label = (o) => (o.value === '' ? allLabel : o.label)
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 250, window.innerWidth - 258)) })
  }, [open])
  const close = () => { setOpen(false); setQ('') }
  const ql = q.trim().toLowerCase()
  const shown = options.filter((o) => !ql || label(o).toLowerCase().includes(ql))
  return (
    <>
      <button ref={btnRef} type="button"
        className={`${styles.listBtn}${open ? ' ' + styles.listBtnOpen : ''}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel}
        title={title} onClick={() => setOpen((o) => !o)}>
        <span className={styles.listBtnText}>{cur ? label(cur) : allLabel}</span>
        <UIcon name="chevronDown" size={12} gold={false} />
      </button>
      {open && createPortal(
        <>
          <div className={styles.uMenuBackdrop} onClick={close} />
          <div className={styles.uMenu} role="menu" aria-label={ariaLabel}
            style={{ ...(menuVars || {}), top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 250 }}
            onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
            <div className={styles.uMenuLabel}>{menuLabel}</div>
            {options.length > 8 && (
              <input className={styles.uMenuSearch} autoFocus placeholder={findLabel} value={q}
                onChange={(e) => setQ(e.target.value)} aria-label={findLabel} />
            )}
            <div className={styles.uMenuScroll}>
              {shown.map((o) => (
                <button key={o.value || 'all'} type="button" role="menuitemradio" aria-checked={o.value === (value || '')}
                  className={styles.uMenuItem} onClick={() => { onChange(o.value || null); close() }}>
                  <span className={styles.uMenuCheck}>{o.value === (value || '') && <UIcon name="check" size={13} gold={false} />}</span>
                  <span className={styles.uMenuText}>{label(o)}</span>
                </button>
              ))}
              {!shown.length && <div className={styles.uMenuEmpty}>No lists match</div>}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
