// Custom-Period Sort results — a draggable, virtualized floating panel listing every US
// common stock ranked by its % change over the selected [start, end] date range. Fed by
// /api/scans/period-change (SWR-refreshed). Virtualized so ~6,000 rows scroll smoothly.
import { useState, useRef, useMemo, useCallback } from 'react'
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

export default function PeriodSortPanel({ start, end, onClose, onPickSym, embedded = false }) {
  const url = start && end ? `/api/scans/period-change?start=${start}&end=${end}` : null
  const { data } = useMobileSWR(url, fetcher, { refreshInterval: 30000, dedupingInterval: 15000, revalidateOnFocus: false })
  const [sortDir, setSortDir] = useState('desc')   // period-change sort (▼ = biggest gainers first)

  const rows = useMemo(() => {
    const r = [...(data?.results || [])]
    r.sort((a, b) => (sortDir === 'desc' ? b.period_change - a.period_change : a.period_change - b.period_change))
    return r
  }, [data, sortDir])

  // Draggable window (pointer-drag on the header bar). Skipped when embedded in a
  // pop-out window, where the panel fills the OS window instead of floating.
  const [pos, setPos] = useState({ x: 140, y: 96 })
  const onHeaderPointerDown = useCallback((e) => {
    if (embedded || e.target.closest('[data-no-drag]')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    setPos((p) => {
      const ox = p.x, oy = p.y
      const move = (ev) => setPos({ x: Math.max(0, ox + (ev.clientX - sx)), y: Math.max(0, oy + (ev.clientY - sy)) })
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return p
    })
  }, [])

  const scrollRef = useRef(null)
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 14,
  })

  const status = !data ? 'Loading…' : data.status === 'computing' ? 'Building the market snapshot…' : rows.length === 0 ? 'No results.' : ''

  const panelStyle = embedded
    ? { position: 'static', width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, border: 'none', boxShadow: 'none' }
    : { left: pos.x, top: pos.y }

  return (
    <div className={styles.panel} style={panelStyle}>
      <div className={styles.header} onPointerDown={onHeaderPointerDown} style={embedded ? { cursor: 'default' } : undefined}>
        {!embedded && <span className={styles.grip} aria-hidden="true" />}
        <span className={styles.title}>US Common Stocks</span>
        {data?.start && <span className={styles.range}>{fmtYmd(data.start)} – {fmtYmd(data.end)}</span>}
        <button data-no-drag type="button" className={styles.close} onClick={onClose} title="Close" aria-label="Close">✕</button>
      </div>

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
      </div>
    </div>
  )
}
