import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TF_MENU, tfLabel, makeTfCode, isValidTf } from '../../../components/chart/timeframes'
import ChoiceMenu from '../../../components/chart/ChoiceMenu'
import styles from './TimeframeMenu.module.css'

// The full timeframe picker: grouped presets + saved custom intervals + an
// "Add custom interval" creator. A star toggles a timeframe into the header's
// Favorites row. Opens as a portal popover anchored under the trigger.
//
// UCT Signature style (owner 11-15, docs/uct-signature-style.md): the graphite menu panel,
// sentence-case group labels, the chosen timeframe on the card shade with a white ✓, the star
// on the RIGHT — a favourite's filled star always shows, an empty one only on hover — and the
// custom-interval unit is the ChoiceMenu dropdown, not the browser's <select>. No gold.
//
// Props:
//   tf, onSelect(code)                     — current + pick
//   favorites:string[], onToggleFav(code)  — header favorites row
//   customCodes:string[], onAddCustom(code), onRemoveCustom(code)
//   anchor:DOMRect, onClose()

const UNITS = [
  ['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'],
]

const Star = ({ filled }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

function Row({ code, active, fav, onSelect, onToggleFav, onRemove }) {
  return (
    <div className={`${styles.row} ${active ? styles.rowActive : ''}`}>
      <button type="button" className={styles.rowLabel} onClick={() => onSelect(code)} aria-current={active || undefined}>
        {tfLabel(code)}
      </button>
      {active && <span className={styles.check} aria-hidden="true">✓</span>}
      {onRemove && (
        <button type="button" className={styles.remove} data-guide="timeframe.remove" title="Delete custom interval"
          aria-label={`Delete ${tfLabel(code)}`}
          onClick={(e) => { e.stopPropagation(); onRemove(code) }}>
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
      <button type="button" className={`${styles.star}${fav ? ' ' + styles.starOn : ''}`} data-guide="timeframe.star" aria-pressed={fav}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={fav ? `Remove ${tfLabel(code)} from favorites` : `Add ${tfLabel(code)} to favorites`}
        onClick={(e) => { e.stopPropagation(); onToggleFav(code) }}
      ><Star filled={fav} /></button>
    </div>
  )
}

export default function TimeframeMenu({ tf, onSelect, favorites = [], onToggleFav, customCodes = [], onAddCustom, onRemoveCustom, anchor, onClose, themeVars = null }) {
  const ref = useRef(null)
  const [unit, setUnit] = useState('minutes')
  const [count, setCount] = useState('')
  const favSet = new Set(favorites)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    // the unit dropdown's list is portalled to <body>: a click in it is still "inside" this menu
    const onDown = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return
      if (e.target.closest?.('[data-choice-menu]')) return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); clearTimeout(t) }
  }, [onClose])

  const submitCustom = () => {
    const n = parseInt(count, 10)
    if (!(n >= 1)) return
    const code = makeTfCode(unit, n)
    if (code && isValidTf(code)) { onAddCustom(code); setCount('') }
  }

  const W = 236
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)) : 40
  const top = anchor ? anchor.bottom + 4 : 60
  const canAdd = parseInt(count, 10) >= 1

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ left, top, ...(themeVars || {}) }} role="dialog" aria-label="Timeframes" data-guide="chart.timeframeMenu">
      <div className={styles.scroll}>
        {TF_MENU.map(g => (
          <div className={styles.group} key={g.group}>
            <div className={styles.groupLabel}>{g.group}</div>
            {g.codes.map(code => (
              <Row key={code} code={code} active={code === tf} fav={favSet.has(code)}
                onSelect={onSelect} onToggleFav={onToggleFav} />
            ))}
          </div>
        ))}
        {customCodes.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupLabel}>Custom</div>
            {customCodes.map(code => (
              <Row key={code} code={code} active={code === tf} fav={favSet.has(code)}
                onSelect={onSelect} onToggleFav={onToggleFav} onRemove={onRemoveCustom} />
            ))}
          </div>
        )}
      </div>
      <div className={styles.adder}>
        <div className={styles.adderTitle}>Add custom interval</div>
        <div className={styles.adderRow}>
          <input className={styles.countInput} type="number" min="1" placeholder="#" value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitCustom() }} aria-label="Interval count" />
          <ChoiceMenu ariaLabel="Interval unit" value={unit} onChange={setUnit}
            options={UNITS.map(([v, l]) => ({ value: v, label: l }))} />
          <span className={styles.sp} />
          <button type="button" className={styles.addBtn} disabled={!canAdd} onClick={submitCustom}>Add</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
