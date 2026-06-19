import { useState } from 'react'
import styles from './ScannerPro.module.css'

// Category-tabbed filter grid. Each filter is a preset <select>; numeric filters
// with allow_custom expose a "Custom…" option that reveals min/max inputs.
// activeFilters shape: { [key]: { op, value|min|max } }.
export default function FilterPanel({ meta, activeFilters, onChange, activeTab, setActiveTab }) {
  const [customOpen, setCustomOpen] = useState({})
  if (!meta) return null

  const cats = [...(meta.categories || []), { key: 'all', label: 'All' }]
  const visible = activeTab === 'all'
    ? meta.filters
    : meta.filters.filter(f => f.category === activeTab)

  const countFor = catKey => meta.filters.filter(f =>
    (catKey === 'all' || f.category === catKey) && activeFilters[f.key]).length

  const handleSelect = (f, label) => {
    if (label === 'Custom…') { setCustomOpen(s => ({ ...s, [f.key]: true })); return }
    setCustomOpen(s => ({ ...s, [f.key]: false }))
    const p = (f.presets || []).find(o => o.label === label)
    if (!p || label === 'Any') { onChange(f.key, null); return }
    const spec = { op: p.op }
    if (p.value !== undefined) spec.value = p.value
    if (p.min !== undefined) spec.min = p.min
    if (p.max !== undefined) spec.max = p.max
    onChange(f.key, spec)
  }

  const applyCustom = (f, minV, maxV) => {
    const hasMin = minV !== '' && minV != null
    const hasMax = maxV !== '' && maxV != null
    if (!hasMin && !hasMax) { onChange(f.key, null); return }
    if (hasMin && hasMax) onChange(f.key, { op: 'between', min: +minV, max: +maxV })
    else if (hasMin) onChange(f.key, { op: 'gte', min: +minV })
    else onChange(f.key, { op: 'lte', max: +maxV })
  }

  const currentLabel = f => {
    if (customOpen[f.key]) return 'Custom…'
    const af = activeFilters[f.key]
    if (!af) return 'Any'
    const match = (f.presets || []).find(o =>
      o.op === af.op && o.value === af.value && o.min === af.min && o.max === af.max)
    return match ? match.label : 'Custom…'
  }

  return (
    <div className={styles.filterPanel}>
      <div className={styles.catTabs}>
        {cats.map(c => (
          <button key={c.key} type="button"
            className={`${styles.catTab} ${activeTab === c.key ? styles.catTabOn : ''}`}
            onClick={() => setActiveTab(c.key)}>
            {c.label}
            {countFor(c.key) > 0 && <span className={styles.catBadge}>{countFor(c.key)}</span>}
          </button>
        ))}
      </div>
      <div className={styles.filterGrid}>
        {visible.map(f => {
          const options = [...(f.presets || []).map(p => p.label)]
          if (f.allow_custom && !options.includes('Custom…')) options.push('Custom…')
          const af = activeFilters[f.key]
          return (
            <div key={f.key} className={styles.filterCell}>
              <label className={styles.filterLabel} htmlFor={`f_${f.key}`}>{f.label}</label>
              <select id={`f_${f.key}`} aria-label={f.label}
                className={`${styles.filterSelect} ${af ? styles.filterSelectActive : ''}`}
                value={currentLabel(f)}
                onChange={e => handleSelect(f, e.target.value)}>
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
              {customOpen[f.key] && (
                <div className={styles.customRange}>
                  <input id={`min_${f.key}`} type="number" placeholder="min"
                    defaultValue={af?.min ?? ''}
                    onBlur={e => applyCustom(f, e.target.value,
                      document.getElementById(`max_${f.key}`)?.value)} />
                  <input id={`max_${f.key}`} type="number" placeholder="max"
                    defaultValue={af?.max ?? ''}
                    onBlur={e => applyCustom(f,
                      document.getElementById(`min_${f.key}`)?.value, e.target.value)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
