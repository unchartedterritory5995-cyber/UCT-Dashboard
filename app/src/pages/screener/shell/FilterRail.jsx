import { useMemo, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import FilterControl from './FilterControl'
import bandStyles from './FilterBand.module.css'
import styles from './ScannerShell.module.css'

const openKey = k => `uct.screener.rail.${k}`
const readOpen = k => { try { return localStorage.getItem(openKey(k)) !== '0' } catch { return true } }

export default function FilterRail({ meta, activeFilters, onChange, onClear, variant = 'rail' }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() =>
    Object.fromEntries((meta?.categories || []).map(c => [c.key, readOpen(c.key)])))

  const needle = q.trim().toLowerCase()
  // meta is optional-chained throughout so this hook stays stable even when
  // meta is momentarily null (before the initial fetch resolves) — the early
  // return below must come AFTER every hook, never between them.
  const byCat = useMemo(() => {
    const m = new Map((meta?.categories || []).map(c => [c.key, []]))
    for (const f of meta?.filters || []) {
      if (needle && !f.label.toLowerCase().includes(needle)) continue
      if (m.has(f.category)) m.get(f.category).push(f)
    }
    return m
  }, [meta, needle])

  if (!meta) return null

  const basisNote = meta.distribution_basis?.note || null
  const toggle = key => setOpen(prev => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(openKey(key), next[key] ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  const activeIn = key => (meta.filters || [])
    .filter(f => f.category === key && activeFilters[f.key]).length
  const activeTotal = Object.keys(activeFilters).length

  return (
    <div className={variant === 'sheet' ? styles.railSheet : styles.rail} data-testid="filter-rail">
      <div className={styles.railSearchRow}>
        <UIcon name="search" size={12} />
        <input className={styles.railSearch} placeholder="Find a filter…" value={q}
          aria-label="Find a filter" onChange={e => setQ(e.target.value)} />
        {activeTotal > 0 && (
          <button type="button" className={styles.railClear} onClick={onClear}>Clear {activeTotal}</button>
        )}
      </div>
      {/* ⛔ THE BASIS RIDES ONCE, AND IT IS THE SERVER'S SENTENCE VERBATIM.
          `distribution.py::BASIS_NOTE` is the ONE member-facing string that
          says what the bands under each control are and — the load-bearing
          half — what they are NOT ("not a threshold this firm recommends").
          Restating it here in nicer words would put a second authority on the
          only disclaimer in the feature; stamping it under all 107 range
          controls would be that same defect 107 times. It renders only when
          `meta()` actually shipped a basis, which is exactly when bands exist. */}
      {basisNote && <p className={bandStyles.basis}>{basisNote}</p>}
      {(meta.categories || []).map(cat => {
        const list = byCat.get(cat.key) || []
        if (needle && !list.length) return null
        const isOpen = needle ? true : open[cat.key]
        const n = activeIn(cat.key)
        return (
          <section key={cat.key} className={styles.railGroup}>
            <button type="button" className={styles.railHead} aria-expanded={isOpen}
              onClick={() => toggle(cat.key)}>
              <span>{cat.label}</span>
              {n > 0 && <span className={styles.railPip}>{n}</span>}
              <UIcon name={isOpen ? 'chevronDown' : 'chevronRight'} size={11} />
            </button>
            {isOpen && list.map(f => (
              <FilterControl key={f.key} filter={f}
                value={activeFilters[f.key] || null}
                basis={meta.distribution_basis || null}
                onChange={v => onChange(f.key, v)} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
