import { useMemo, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './ScannerShell.module.css'

export default function ColumnPicker({ open, onClose, allColumns, visible, onChange, onReset }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? allColumns.filter(c => c.label.toLowerCase().includes(needle) || c.key.includes(needle))
      : allColumns
  }, [allColumns, q])
  if (!open) return null

  const isOn = key => visible.includes(key)
  const toggleCol = key => {
    if (key === 'ticker') return
    onChange(isOn(key) ? visible.filter(c => c !== key) : [...visible, key])
  }
  const move = (key, delta) => {
    const i = visible.indexOf(key)
    const j = i + delta
    if (i < 0 || j < 0 || j >= visible.length || (visible[j] === 'ticker' && j === 0 && delta < 0)) return
    if (visible[i] === 'ticker') return
    const next = [...visible]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className={styles.pickerPop} role="dialog" aria-label="Choose columns">
      <div className={styles.pickerHead}>
        <input className={styles.railSearch} placeholder="Find a column…" value={q}
          aria-label="Find a column" onChange={e => setQ(e.target.value)} />
        <button type="button" className={styles.pickerReset} onClick={onReset}>Reset to view</button>
        <button type="button" className={styles.pickerClose} aria-label="Close column picker" onClick={onClose}>
          <UIcon name="x" size={12} />
        </button>
      </div>
      <div className={styles.pickerList}>
        {shown.map(c => (
          <div key={c.key} className={styles.pickerRow}>
            <label className={styles.pickerLabel}>
              <input type="checkbox" checked={isOn(c.key)} disabled={c.key === 'ticker'}
                onChange={() => toggleCol(c.key)} />
              <span>{c.label}</span>
              <span className={styles.pickerKey}>{c.key}</span>
            </label>
            {isOn(c.key) && c.key !== 'ticker' && (
              <span className={styles.pickerMove}>
                <button type="button" aria-label={`Move ${c.label} up`} onClick={() => move(c.key, -1)}>
                  <UIcon name="chevronUp" size={11} />
                </button>
                <button type="button" aria-label={`Move ${c.label} down`} onClick={() => move(c.key, 1)}>
                  <UIcon name="chevronDown" size={11} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
