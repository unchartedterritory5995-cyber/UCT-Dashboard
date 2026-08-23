import { useEffect, useState } from 'react'
import ColumnDesc from './ColumnDesc'
import styles from './ScannerShell.module.css'

const currentLabel = (filter, value, customOpen) => {
  if (customOpen) return 'Custom…'
  if (!value) return 'Any'
  const match = (filter.presets || []).find(o =>
    o.op === value.op && o.value === value.value && o.min === value.min && o.max === value.max)
  return match ? match.label : 'Custom…'
}

export default function FilterControl({ filter, value, onChange }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [minV, setMinV] = useState(value?.min ?? '')
  const [maxV, setMaxV] = useState(value?.max ?? '')

  // A spec applied from outside (saved screen, URL) re-seeds the inputs.
  useEffect(() => { setMinV(value?.min ?? ''); setMaxV(value?.max ?? '') }, [value])

  const commit = (lo = minV, hi = maxV) => {
    const hasMin = lo !== '' && lo != null
    const hasMax = hi !== '' && hi != null
    if (!hasMin && !hasMax) { setCustomOpen(false); onChange(null); return }
    if (hasMin && hasMax) onChange({ op: 'between', min: +lo, max: +hi })
    else if (hasMin) onChange({ op: 'gte', min: +lo })
    else onChange({ op: 'lte', max: +hi })
  }

  const onSelect = label => {
    if (label === 'Custom…') { setCustomOpen(true); return }
    setCustomOpen(false)
    const p = (filter.presets || []).find(o => o.label === label)
    if (!p || label === 'Any') { onChange(null); return }
    const spec = { op: p.op }
    if (p.value !== undefined) spec.value = p.value
    if (p.min !== undefined) spec.min = p.min
    if (p.max !== undefined) spec.max = p.max
    // The label rides into saved/shared specs; K9 — preset re-find above
    // compares only op/value/min/max, so this extra field is invisible to
    // currentLabel and can never cause a preset to mismatch itself.
    if (filter.key === 'scan' && p.label && p.label !== 'Any') spec.label = p.label
    onChange(spec)
  }

  const options = (filter.presets || []).map(p => p.label)
  if (filter.allow_custom && !options.includes('Custom…')) options.push('Custom…')
  const onKey = e => { if (e.key === 'Enter') commit() }

  return (
    <div className={styles.filterRow}>
      {/* The honesty text belongs HERE as much as on the results header: the
          misreading that matters happens when a member picks a threshold, not
          when they read a cell back. `meta()` ships no description of its own,
          so the join is filter.key → COLUMN_DEFS[key] — the registry keys the
          snapshot column of the same name for every filter but one (`pattern`,
          whose column is `patterns` and which carries no `desc`). `ColumnDesc`
          renders nothing when the column has none, so most rows are unchanged. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <label className={styles.filterLabel} htmlFor={`fc_${filter.key}`}>{filter.label}</label>
        <ColumnDesc colKey={filter.key} name={filter.label} />
      </span>
      <select id={`fc_${filter.key}`} aria-label={filter.label}
        className={`${styles.filterSelect} ${value ? styles.filterSelectActive : ''}`}
        value={currentLabel(filter, value, customOpen)}
        onChange={e => onSelect(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
      {customOpen && (
        <div className={styles.customRange}>
          <input type="number" placeholder="min" aria-label={`${filter.label} min`}
            value={minV} onChange={e => setMinV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
          <input type="number" placeholder="max" aria-label={`${filter.label} max`}
            value={maxV} onChange={e => setMaxV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
        </div>
      )}
    </div>
  )
}
