import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import styles from './PatternFilter.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json())

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'classical', label: 'Classical' },
  { value: 'candlestick', label: 'Candlestick' },
  { value: 'uct', label: 'UCT' },
  { value: 'structure', label: 'Structure' },
]

const TIMEFRAMES = [
  { value: '5', label: '5min' },
  { value: '30', label: '30min' },
  { value: '60', label: '1hr' },
  { value: 'D', label: 'Daily' },
  { value: 'W', label: 'Weekly' },
  { value: 'M', label: 'Monthly' },
]

const DEFAULT_FILTERS = {
  types: [],
  tf: 'D',
  min_conf: 70,
  category: '',
  leaders_only: true,
}

export default function PatternFilter({ filters, onChange }) {
  const isPhone = useIsPhone()
  const [sheetOpen, setSheetOpen] = useState(false)
  const { data } = useSWR('/api/patterns/types', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  const allPatterns = data?.patterns || []
  const visiblePatterns = useMemo(() => {
    if (!filters.category) return allPatterns
    return allPatterns.filter(p => p.category === filters.category)
  }, [allPatterns, filters.category])

  const setCategory = (c) => onChange({ ...filters, category: c, types: [] })
  const setTF = (tf) => onChange({ ...filters, tf })
  const setMinConf = (v) => onChange({ ...filters, min_conf: Number(v) })
  const setLeadersOnly = (v) => onChange({ ...filters, leaders_only: v })
  const toggleType = (pid) => {
    const has = filters.types.includes(pid)
    const next = has ? filters.types.filter(x => x !== pid) : [...filters.types, pid]
    onChange({ ...filters, types: next })
  }
  const reset = () => onChange(DEFAULT_FILTERS)

  // Non-default selections — drives the phone "Filters · N" badge.
  const activeCount =
    (filters.types?.length || 0) +
    (filters.category ? 1 : 0) +
    (filters.tf !== DEFAULT_FILTERS.tf ? 1 : 0) +
    (filters.min_conf !== DEFAULT_FILTERS.min_conf ? 1 : 0) +
    (filters.leaders_only !== DEFAULT_FILTERS.leaders_only ? 1 : 0)

  const body = (
    <>
      {/* Row 1: category + tf + slider + reset */}
      <div className={styles.row}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Category</span>
          <div className={styles.chipRow}>
            {CATEGORIES.map(c => (
              <button
                key={c.value || 'all'}
                type="button"
                className={`${styles.chip} ${filters.category === c.value ? styles.chipActive : ''}`}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>Timeframe</span>
          <select
            className={styles.select}
            value={filters.tf}
            onChange={e => setTF(e.target.value)}
          >
            {TIMEFRAMES.map(tf => (
              <option key={tf.value} value={tf.value}>{tf.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>Min Confidence: {filters.min_conf}</span>
          <input
            type="range"
            min={50}
            max={95}
            step={1}
            value={filters.min_conf}
            onChange={e => setMinConf(e.target.value)}
            className={styles.slider}
          />
        </div>

        <label
          className={`${styles.toggleField} ${filters.leaders_only ? styles.toggleActive : ''}`}
          title="Restrict to curated liquid thematic leaders"
        >
          <input
            type="checkbox"
            checked={!!filters.leaders_only}
            onChange={e => setLeadersOnly(e.target.checked)}
          />
          Leaders only
        </label>

        <button type="button" className={styles.resetBtn} onClick={reset}>
          Reset
        </button>
      </div>

      {/* Row 2: pattern type chips */}
      {visiblePatterns.length > 0 && (
        <div className={styles.typesGroup}>
          <span className={styles.groupLabel}>
            Patterns {filters.types.length > 0 && `(${filters.types.length} selected)`}
          </span>
          <div className={styles.typeChipRow}>
            {visiblePatterns.map(p => {
              const active = filters.types.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.typeChip} ${active ? styles.typeChipActive : ''} ${styles[`dir_${p.direction}`] || ''}`}
                  onClick={() => toggleType(p.id)}
                  title={p.description || ''}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )

  // Phone: collapse the whole bar into a "Filters" button → bottom-sheet so the
  // results grid owns the viewport. Desktop keeps the inline filter bar.
  if (isPhone) {
    const tfLabel = TIMEFRAMES.find(t => t.value === filters.tf)?.label || filters.tf
    return (
      <>
        <div className={styles.mobileBar}>
          <button
            type="button"
            className={`${styles.mobileFiltersBtn} ${activeCount > 0 ? styles.mobileFiltersBtnActive : ''}`}
            onClick={() => setSheetOpen(true)}
          >
            ⚙ Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
          </button>
          <span className={styles.mobileSummary}>{tfLabel} · conf {filters.min_conf}{filters.leaders_only ? ' · leaders' : ''}</span>
        </div>
        <FiltersSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onClear={reset}
          onApply={() => setSheetOpen(false)}
          title="Pattern Filters"
          activeCount={activeCount}
          applyLabel="Show patterns"
        >
          {body}
        </FiltersSheet>
      </>
    )
  }

  return <div className={styles.filterBar}>{body}</div>
}
