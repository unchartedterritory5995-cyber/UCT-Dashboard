import { useState, useMemo } from 'react'
import useSWR from 'swr'
import PatternFilter from './patterns/PatternFilter'
import PatternResultCard from './patterns/PatternResultCard'
import styles from './Patterns.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json())

export default function Patterns() {
  const [filters, setFilters] = useState({
    types: [],          // empty = all
    tf: 'D',
    min_conf: 70,
    category: '',       // empty = all
    leaders_only: true, // default ON — user's focus is liquid thematic leaders
  })

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.types?.length) params.set('types', filters.types.join(','))
    params.set('tf', filters.tf)
    params.set('min_conf', filters.min_conf)
    if (filters.category) params.set('category', filters.category)
    if (filters.leaders_only) params.set('leaders_only', 'true')
    params.set('limit', 100)
    return params.toString()
  }, [filters])

  const { data, error, isLoading } = useSWR(
    `/api/patterns/scan?${queryString}`,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: true }
  )

  const count = data?.count

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Pattern Scanner</h1>
        <div className={styles.subtitle}>
          {count != null ? `${count} active pattern${count === 1 ? '' : 's'}` : 'Loading...'}
          {' · '}
          {filters.tf} timeframe
          {' · '}
          min confidence {filters.min_conf}
        </div>
      </div>

      <PatternFilter filters={filters} onChange={setFilters} />

      {error && (
        <div className={styles.error}>Failed to load: {error.message || 'unknown error'}</div>
      )}
      {isLoading && !data && (
        <div className={styles.loading}>Scanning universe...</div>
      )}
      {!isLoading && data && (data.detections || []).length === 0 && (
        <div className={styles.empty}>
          No active patterns match the current filters.
          <div className={styles.emptyHint}>
            Try lowering the confidence threshold, switching timeframe, or clearing pattern filters.
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {(data?.detections || []).map(d => (
          <PatternResultCard key={d.id} detection={d} />
        ))}
      </div>
    </div>
  )
}
