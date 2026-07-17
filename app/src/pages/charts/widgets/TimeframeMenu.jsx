import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TF_MENU, tfLabel, makeTfCode, isValidTf } from '../../../components/chart/timeframes'
import styles from './TimeframeMenu.module.css'

// The full timeframe picker: grouped presets + saved custom intervals + an
// "Add custom interval" creator. A star toggles a timeframe into the header's
// Favorites row. Opens as a portal popover anchored under the trigger.
//
// Props:
//   tf, onSelect(code)                     — current + pick
//   favorites:string[], onToggleFav(code)  — header favorites row
//   customCodes:string[], onAddCustom(code), onRemoveCustom(code)
//   anchor:DOMRect, onClose()

const UNITS = [
  ['minutes', 'minutes'], ['hours', 'hours'], ['days', 'days'], ['weeks', 'weeks'], ['months', 'months'],
]

function Row({ code, active, fav, onSelect, onToggleFav, onRemove }) {
  return (
    <div className={`${styles.row} ${active ? styles.rowActive : ''}`}>
      <button type="button" className={styles.star} aria-pressed={fav}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => { e.stopPropagation(); onToggleFav(code) }}
      >{fav ? '★' : '☆'}</button>
      <button type="button" className={styles.rowLabel} onClick={() => onSelect(code)}>{tfLabel(code)}</button>
      {onRemove && (
        <button type="button" className={styles.remove} title="Delete custom interval"
          onClick={(e) => { e.stopPropagation(); onRemove(code) }}>✕</button>
      )}
    </div>
  )
}

export default function TimeframeMenu({ tf, onSelect, favorites = [], onToggleFav, customCodes = [], onAddCustom, onRemoveCustom, anchor, onClose }) {
  const ref = useRef(null)
  const [unit, setUnit] = useState('minutes')
  const [count, setCount] = useState('')
  const favSet = new Set(favorites)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
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

  const W = 268
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)) : 40
  const top = anchor ? anchor.bottom + 4 : 60

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ left, top }} role="dialog" aria-label="Timeframes">
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
          <select className={styles.unitSel} value={unit} onChange={e => setUnit(e.target.value)} aria-label="Interval unit">
            {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className={styles.countInput} type="number" min="1" placeholder="#" value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitCustom() }} aria-label="Interval count" />
          <button type="button" className={styles.addBtn} disabled={!(parseInt(count, 10) >= 1)} onClick={submitCustom}>Add</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
