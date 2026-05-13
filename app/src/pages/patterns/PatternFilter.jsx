import { useMemo } from 'react'
import useSWR from 'swr'
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
}

export default function PatternFilter({ filters, onChange }) {
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
  const toggleType = (pid) => {
    const has = filters.types.includes(pid)
    const next = has ? filters.types.filter(x => x !== pid) : [...filters.types, pid]
    onChange({ ...filters, types: next })
  }
  const reset = () => onChange(DEFAULT_FILTERS)

  return (
    <div className={styles.filterBar}>
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
    </div>
  )
}
