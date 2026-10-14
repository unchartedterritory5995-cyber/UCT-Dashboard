import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { setupLine } from './setupLine'
import styles from './FocusScreener.module.css'

const fmtPrice = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const fmtChg = v => {
  if (!Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`
}

const ResultList = forwardRef(function ResultList(
  { rows, index, onSelect, onKeyDown, livePrices = {}, radar = new Set(), sortLabel, onSort, total, hasMore, onLoadMore, isLoading, itemProps },
  ref,
) {
  const listRef = useRef(null)
  const scrollToIndex = i => {
    const el = listRef.current?.querySelector(`[data-index="${i}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }
  useImperativeHandle(ref, () => ({ scrollToIndex }), [])
  useEffect(() => { scrollToIndex(index) }, [index])

  // auto-load when the last row scrolls into view
  const endRef = useRef(null)
  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined' || !endRef.current) return undefined
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !isLoading) onLoadMore?.() })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [hasMore, isLoading, onLoadMore, rows.length])

  return (
    <div className={styles.listWrap}>
      <div className={styles.listHead}>
        <button type="button" className={styles.linkBtn} onClick={onSort}>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></button>
        <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
      </div>
      <div ref={listRef} role="listbox" aria-label="Screen results" tabIndex={0}
        aria-activedescendant={rows[index] ? `focus-opt-${rows[index].ticker}` : undefined}
        className={styles.list} onKeyDown={onKeyDown} data-focus-list="">
        {rows.map((r, i) => {
          const live = livePrices[r.ticker]
          const zeroVol = r.vol_ratio === 0
          const price = Number.isFinite(live?.price) ? live.price : r.price
          const chg = zeroVol ? null : (Number.isFinite(live?.change_pct) ? live.change_pct : r.chg_pct_1d)
          const s = setupLine({ ...r, price })
          const sel = i === index
          return (
            <div key={r.ticker} id={`focus-opt-${r.ticker}`} role="option" aria-selected={sel}
              data-index={i} data-testid={`focus-row-${r.ticker}`}
              className={`${styles.row} ${sel ? styles.rowSel : ''} ${s.quiet ? styles.rowQuiet : ''}`}
              onClick={() => onSelect(i)} {...(itemProps ? itemProps(i) : {})}>
              <span className={radar.has(r.ticker) ? styles.dotOn : styles.dotOff}
                {...(radar.has(r.ticker) ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
              <span className={styles.rowMain}>
                <span className={styles.ticker}>{r.ticker}</span>
                <span className={styles.setup}>{s.text}{s.detail ? ` · ${s.detail}` : ''}</span>
              </span>
              <span className={styles.rowNums}>
                <span>{fmtPrice(price)}</span>
                <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{fmtChg(chg)}</span>
              </span>
            </div>
          )
        })}
        {hasMore && <div ref={endRef} className={styles.moreSentinel} aria-hidden="true" />}
      </div>
      <div className={styles.keyHints} aria-hidden="true">
        <span><b>↑↓</b> move</span><span><b>⇧F</b> flag</span><span><b>W</b> watchlist</span><span><b>↵</b> full chart</span>
      </div>
    </div>
  )
})
export default ResultList
