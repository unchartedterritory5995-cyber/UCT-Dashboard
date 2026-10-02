import { useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NotesTableView.module.css'

const OPS = [
  { value: 'gt', label: 'is above' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is below' },
  { value: 'lte', label: 'is at most' },
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'is not' },
  { value: 'is_not_empty', label: 'has a value' },
  { value: 'is_empty', label: 'is empty' },
]
const NEEDS_NUMBER = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'])

/** The words a filter condition reads as, e.g. "R is above 1". */
export function describeComputedFilter(name, cond) {
  if (!cond) return ''
  const op = OPS.find((o) => o.value === cond.op)?.label || cond.op
  return NEEDS_NUMBER.has(cond.op) ? `${name} ${op} ${cond.value}` : `${name} ${op}`
}

/**
 * Wave 11 (lane 11B): filter the table by a formula or rollup value. A small
 * dialog off the column header: a condition, a number, Apply / Clear. Native
 * controls, Escape closes and focus returns to the button that opened it.
 * `cond` is the active condition for this column (or null); `onChange(cond|null)`.
 */
export default function ComputedFilterControl({ name, cond, onChange }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [op, setOp] = useState(cond?.op || 'gt')
  const [num, setNum] = useState(cond?.value ?? '')
  const [error, setError] = useState(null)
  const btnRef = useRef(null)
  const firstRef = useRef(null)

  useEffect(() => {
    if (open) {
      setOp(cond?.op || 'gt')
      setNum(cond?.value ?? '')
      setError(null)
      requestAnimationFrame(() => firstRef.current?.focus())
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => btnRef.current?.focus())
  }
  const apply = () => {
    if (NEEDS_NUMBER.has(op)) {
      const n = Number(num)
      if (num === '' || !Number.isFinite(n)) { setError('Type a number to compare with'); return }
      onChange({ op, value: n })
    } else {
      onChange({ op })
    }
    close()
  }
  const clear = () => { onChange(null); close() }

  return (
    <span className={styles.filterWrap} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.filterBtn} ${cond ? styles.filterBtnOn : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={cond ? `Filter ${name}: ${describeComputedFilter(name, cond)}` : `Filter ${name}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <UIcon name="sliders" size={11} gold={false} />
      </button>
      {open && (
        <div
          className={styles.filterPop}
          role="dialog"
          aria-label={`Filter ${name}`}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
        >
          <label className={styles.filterLabel} htmlFor={`${id}-op`}>{`Show notes where ${name}`}</label>
          <select id={`${id}-op`} ref={firstRef} className={styles.filterInput} value={op} onChange={(e) => setOp(e.target.value)}>
            {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {NEEDS_NUMBER.has(op) && (
            <>
              <label className={styles.filterLabel} htmlFor={`${id}-num`}>Number</label>
              <input id={`${id}-num`} className={styles.filterInput} type="number" inputMode="decimal" value={num}
                onChange={(e) => { setNum(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') apply() }} />
            </>
          )}
          {error && <div className={styles.filterError} role="alert">{error}</div>}
          <div className={styles.filterActions}>
            <button type="button" className={styles.filterApply} onClick={apply}>Apply</button>
            {cond && <button type="button" className={styles.filterClear} onClick={clear}>Clear</button>}
            <button type="button" className={styles.filterClear} onClick={close}>Cancel</button>
          </div>
        </div>
      )}
    </span>
  )
}
