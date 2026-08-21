import { useEffect, useState } from 'react'
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
    onChange(spec)
  }

  const options = (filter.presets || []).map(p => p.label)
  if (filter.allow_custom && !options.includes('Custom…')) options.push('Custom…')
  const onKey = e => { if (e.key === 'Enter') commit() }

  return (
    <div className={styles.filterRow}>
      <label className={styles.filterLabel} htmlFor={`fc_${filter.key}`}>{filter.label}</label>
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
