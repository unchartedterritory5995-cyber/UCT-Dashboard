// The Custom-Period Sort results table — every US common stock ranked by % change over
// [start, end]. Reuses the Watchlist widget's own row/header CSS classes (+ CompanyLogo +
// flag star) so it is visually IDENTICAL to a watchlist/scanner widget. Fed by
// /api/scans/period-change (SWR), virtualized for ~6,000 rows.
import { useState, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import useMobileSWR from '../../hooks/useMobileSWR'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { useFlagged } from '../../hooks/useFlagged'
import wl from '../Watchlists.module.css'
import styles from './PeriodSortPanel.module.css'

// [flag, symbol (flex), price, volume, % change, net] — mirrors the watchlist grid shape.
const GRID = '26px minmax(56px, 1fr) 64px 58px 88px 62px'
const ROW_H = 28

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
  const { isFlagged, toggle: toggleFlag } = useFlagged()

  const rows = useMemo(() => {
    const r = [...(data?.results || [])]
    r.sort((a, b) => (sortDir === 'desc' ? b.period_change - a.period_change : a.period_change - b.period_change))
    return r
  }, [data, sortDir])

  const scrollRef = useRef(null)
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
  })

  const status = !data ? 'Loading…' : data.status === 'computing' ? 'Building the market snapshot…' : rows.length === 0 ? 'No results.' : ''

  return (
    <div className={styles.tableWrap}>
      <div className={styles.body} ref={scrollRef} style={{ '--wl-grid': GRID }}>
        <div className={wl.gridHead}>
          <span className={wl.hFlag} />
          <span className={wl.hSym}>Symbol</span>
          <span className={wl.hCol}>Price</span>
          <span className={wl.hCol}>Volume</span>
          <span
            className={`${wl.hCol} ${wl.hSortActive}`}
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            title="Flip the sort (gainers ⇄ losers)"
          >% Change {sortDir === 'desc' ? '▼' : '▲'}</span>
          <span className={wl.hCol}>Net</span>
        </div>

        {status ? (
          <div className={styles.msg}>{status}</div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
            {virt.getVirtualItems().map((vi) => {
              const r = rows[vi.index]
              const flagged = isFlagged(r.sym)
              const up = r.period_change >= 0
              const nUp = r.net_change >= 0
              return (
                <div
                  key={r.sym}
                  className={`${wl.listRow} ${wl.wlRow}`}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, height: vi.size }}
                  onClick={() => onPickSym?.(r.sym)}
                >
                  <button
                    className={`${wl.flagStar}${flagged ? ' ' + wl.flagStarActive : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleFlag(r.sym) }}
                    title={flagged ? 'Remove from Flagged' : 'Add to Flagged'}
                  >{flagged ? <UIcon name="star-fill" size={13} /> : <UIcon name="star" size={13} />}</button>
                  <span className={wl.symCell}>
                    <span className={wl.rowLogo}><CompanyLogo sym={r.sym} name={r.sym} size={16} round /></span>
                    <span className={wl.rowSym}>{r.sym}</span>
                  </span>
                  <span className={wl.priceCell}>{r.price != null ? r.price.toFixed(2) : '—'}</span>
                  <span className={wl.volCell}>{fmtVol(r.volume)}</span>
                  <span className={`${wl.changeCell} ${up ? wl.gain : wl.loss}`}>{up ? '+' : ''}{r.period_change.toFixed(2)}%</span>
                  <span className={`${wl.changeCell} ${nUp ? wl.gain : wl.loss}`}>{nUp ? '+' : ''}{r.net_change.toFixed(2)}</span>
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
