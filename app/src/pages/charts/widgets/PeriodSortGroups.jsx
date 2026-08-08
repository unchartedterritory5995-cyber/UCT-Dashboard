// Custom-Period Sort — THEME / SECTOR / INDUSTRY ranking (instead of stocks). Each row is a
// group ranked by its equal-weight mean % change over the period; clicking a row drills into
// that group's stocks (onPickGroup). Styled with the watchlist's own classes so it matches
// the stock table. Fed by /api/scans/period-change-groups.
import { useState, useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import wl from '../../Watchlists.module.css'
import styles from '../PeriodSortPanel.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const GRID = '26px minmax(110px, 1fr) 96px 64px'   // [flag-gap, name, % change, count]
const LABEL = { theme: 'Theme', sector: 'Sector', industry: 'Industry' }

export default function PeriodSortGroups({ start, end, group, onPickGroup }) {
  const url = start && end && group ? `/api/scans/period-change-groups?start=${start}&end=${end}&group=${group}` : null
  const { data } = useMobileSWR(url, fetcher, { refreshInterval: 60_000, dedupingInterval: 30_000, revalidateOnFocus: false })
  const [sortDir, setSortDir] = useState('desc')

  const rows = useMemo(() => {
    const r = [...(data?.results || [])]
    r.sort((a, b) => (sortDir === 'desc' ? b.period_change - a.period_change : a.period_change - b.period_change))
    return r
  }, [data, sortDir])

  const status = !data ? 'Loading…' : data.status === 'computing' ? 'Ranking the market…' : rows.length === 0 ? 'No results.' : ''

  return (
    <div className={styles.tableWrap}>
      <div className={styles.body} style={{ '--wl-grid': GRID }}>
        <div className={wl.gridHead}>
          <span className={wl.hFlag} />
          <span className={wl.hSym}>{LABEL[group] || 'Group'}</span>
          <span
            className={`${wl.hCol} ${wl.hSortActive}`}
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            style={{ cursor: 'pointer' }}
            title="Flip the sort"
          >% Change {sortDir === 'desc' ? '▼' : '▲'}</span>
          <span className={wl.hCol}>Stocks</span>
        </div>

        {status ? (
          <div className={styles.msg}>{status}</div>
        ) : rows.map((r) => {
          const up = r.period_change >= 0
          return (
            <div
              key={r.name}
              className={`${wl.listRow} ${wl.wlRow}`}
              onClick={() => onPickGroup?.(r.name, r.members || [])}
              title={`View the ${r.count} stocks in ${r.name}`}
            >
              <span className={wl.flagStar} style={{ pointerEvents: 'none' }} />
              <span className={wl.textCell} title={r.name} style={{ fontWeight: 600 }}>{r.name}</span>
              <span className={`${wl.changeCell} ${up ? wl.gain : wl.loss}`}>{up ? '+' : ''}{r.period_change.toFixed(2)}%</span>
              <span className={wl.metaCell}>{r.count}</span>
            </div>
          )
        })}
      </div>

      <div className={styles.footer}>
        {data?.count != null ? `${data.count} ${LABEL[group]?.toLowerCase() || 'group'}${data.count === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  )
}
