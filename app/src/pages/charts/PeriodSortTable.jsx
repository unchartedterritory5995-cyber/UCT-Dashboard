// The Custom-Period Sort results table — every US common stock ranked by % change over
// [start, end]. Shared by the floating PeriodSortPanel and the docked Period-Sort widget
// so both look identical. Fed by /api/scans/period-change (SWR), virtualized for ~6,000 rows.
import { useState, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import useMobileSWR from '../../hooks/useMobileSWR'
import styles from './PeriodSortPanel.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const fmtYmd = (ymd) => { const s = String(ymd); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}/${s.slice(0, 4)}` }
const fmtVol = (v) => {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(v)
}

export default function PeriodSortTable({ start, end, onPickSym }) {
  const url = start && end ? `/api/scans/period-change?start=${start}&end=${end}` : null
  const { data } = useMobileSWR(url, fetcher, { refreshInterval: 30000, dedupingInterval: 15000, revalidateOnFocus: false })
  const [sortDir, setSortDir] = useState('desc')   // period-change sort (▼ = biggest gainers first)

  const rows = useMemo(() => {
    const r = [...(data?.results || [])]
    r.sort((a, b) => (sortDir === 'desc' ? b.period_change - a.period_change : a.period_change - b.period_change))
    return r
  }, [data, sortDir])

  const scrollRef = useRef(null)
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 14,
  })

  const status = !data ? 'Loading…' : data.status === 'computing' ? 'Building the market snapshot…' : rows.length === 0 ? 'No results.' : ''

  return (
    <div className={styles.tableWrap}>
      <div className={styles.colHead}>
        <span className={styles.cSym}>Sym</span>
        <span className={styles.cNum}>Price</span>
        <span className={styles.cNum}>Volume</span>
        <button
          type="button"
          className={`${styles.cNum} ${styles.sortBtn}`}
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          title="Flip the sort (gainers ⇄ losers)"
        >% Change <span className={styles.caret}>{sortDir === 'desc' ? '▼' : '▲'}</span></button>
        <span className={styles.cNum}>Net</span>
      </div>

      <div className={styles.body} ref={scrollRef}>
        {status ? (
          <div className={styles.msg}>{status}</div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
            {virt.getVirtualItems().map((vi) => {
              const r = rows[vi.index]
              const up = r.period_change >= 0
              const nUp = r.net_change >= 0
              return (
                <div
                  key={r.sym}
                  className={styles.row}
                  style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
                  onClick={() => onPickSym?.(r.sym)}
                >
                  <span className={styles.cSym}>{r.sym}</span>
                  <span className={styles.cNum}>{r.price != null ? r.price.toFixed(2) : '—'}</span>
                  <span className={styles.cNum}>{fmtVol(r.volume)}</span>
                  <span className={`${styles.cNum} ${up ? styles.up : styles.down}`}>{up ? '+' : ''}{r.period_change.toFixed(2)}%</span>
                  <span className={`${styles.cNum} ${nUp ? styles.up : styles.down}`}>{nUp ? '+' : ''}{r.net_change.toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {data?.count != null ? `${data.count.toLocaleString()} stocks` : ''}
        {data?.start ? <span className={styles.footRange}>{fmtYmd(data.start)} – {fmtYmd(data.end)}</span> : null}
      </div>
    </div>
  )
}
