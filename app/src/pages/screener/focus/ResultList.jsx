import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { setupLine } from './setupLine'
import styles from './FocusScreener.module.css'

const fmtPrice = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const fmtChg = v => {
  if (!Number.isFinite(v)) return '—'
  const r = Number(Math.abs(v).toFixed(1))
  const s = r.toFixed(1)
  return r === 0 ? `${s}%` : v > 0 ? `+${s}%` : `−${s}%`
}

// One row, memoised. Live prices arrive as a fresh object per ticker on every stream message,
// so the list hands each row PRIMITIVES (its live price and change) plus stable references (the
// row object, `onSelect`, the hub cursor's constant prop objects). A tick for one ticker then
// re-renders that ticker's row only, not every loaded row.
const ResultRow = memo(function ResultRow({ r, i, sel, price, chg, onRadar, onSelect, hubProps, showCompany }) {
  const s = setupLine({ ...r, price })
  return (
    <div id={`focus-opt-${r.ticker}`} role="option" aria-selected={sel}
      data-index={i} data-testid={`focus-row-${r.ticker}`}
      className={`${styles.row} ${sel ? styles.rowSel : ''} ${s.quiet ? styles.rowQuiet : ''}`}
      onClick={() => onSelect(i)} {...(hubProps || {})}>
      <span className={onRadar ? styles.dotOn : styles.dotOff}
        {...(onRadar ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
      <span className={styles.rowMain}>
        <span className={styles.ticker}>{r.ticker}</span>
        {showCompany && r.company && <span className={styles.rowCompany}>{r.company}</span>}
        <span className={styles.setup}>{s.text}{s.detail ? ` · ${s.detail}` : ''}</span>
      </span>
      <span className={styles.rowNums}>
        <span>{fmtPrice(price)}</span>
        <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{fmtChg(chg)}</span>
      </span>
    </div>
  )
})

const ResultList = forwardRef(function ResultList(
  { rows, index, onSelect, onKeyDown, livePrices = {}, radar = new Set(), sortLabel, onSort, total, hasMore, onLoadMore, isLoading, itemProps, showCompany = false, sortMenu, pending = false },
  ref,
) {
  const listRef = useRef(null)
  // Scroll only the list's own container, never an ancestor or the window.
  const scrollToIndex = useCallback(i => {
    const list = listRef.current
    const el = list?.querySelector(`[data-index="${i}"]`)
    if (!list || !el) return
    const lr = list.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const top = er.top - lr.top + list.scrollTop
    const bottom = er.bottom - lr.top + list.scrollTop
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [])
  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex])
  useEffect(() => { scrollToIndex(index) }, [index, scrollToIndex])

  // Auto-load when the last row nears the edge. Callbacks live in refs so the
  // observer is rebuilt only when the result set changes. The latch allows one
  // load per rows.length; it re-arms when a load settles (isLoading true to
  // false) without the list growing, because an observer does not re-report a
  // sentinel that never left the viewport.
  const endRef = useRef(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const isLoadingRef = useRef(isLoading)
  const intersectingRef = useRef(false)
  const firedAtRef = useRef(null)
  const prevLoadingRef = useRef(!!isLoading)
  onLoadMoreRef.current = onLoadMore
  isLoadingRef.current = isLoading
  const rowCount = rows.length
  useEffect(() => {
    firedAtRef.current = null
    intersectingRef.current = false
    if (!hasMore || typeof IntersectionObserver === 'undefined' || !endRef.current) return undefined
    const io = new IntersectionObserver(es => {
      if (es.length) intersectingRef.current = es[es.length - 1].isIntersecting
      if (firedAtRef.current !== null || isLoadingRef.current) return
      if (es.some(e => e.isIntersecting)) {
        firedAtRef.current = rowCount
        onLoadMoreRef.current?.()
      }
    }, { rootMargin: '200px' })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [hasMore, rowCount])
  useEffect(() => {
    const was = prevLoadingRef.current
    prevLoadingRef.current = !!isLoading
    if (!was || isLoading) return
    // A load just settled. If the list did not grow and the sentinel is still
    // in view, nothing will report it again: ask once more.
    if (hasMore && firedAtRef.current === rowCount && intersectingRef.current) {
      onLoadMoreRef.current?.()
    }
  }, [isLoading, hasMore, rowCount])

  return (
    // `pending`: these rows answer the previous screen while the new one is on its way.
    <div className={`${styles.listWrap} ${pending ? styles.listPending : ''}`} data-pending={pending ? '' : undefined}>
      <div className={styles.listHead}>
        {sortMenu || <button type="button" className={styles.linkBtn} onClick={onSort}>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></button>}
        <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
      </div>
      <div ref={listRef} role="listbox" aria-label="Screen results" tabIndex={0} aria-busy={pending}
        aria-activedescendant={rows[index] ? `focus-opt-${rows[index].ticker}` : undefined}
        className={styles.list} onKeyDown={onKeyDown} data-focus-list="">
        {rows.map((r, i) => {
          const live = livePrices[r.ticker]
          const zeroVol = r.vol_ratio === 0
          const hasLivePrice = Number.isFinite(live?.price)
          const price = hasLivePrice ? live.price : r.price
          const chg = zeroVol ? null : hasLivePrice ? (Number.isFinite(live?.change_pct) ? live.change_pct : null)
            : (Number.isFinite(live?.change_pct) ? live.change_pct : r.chg_pct_1d)
          // itemProps(i) returns one of two constant objects, so the row's prop stays stable.
          return (
            <ResultRow key={r.ticker} r={r} i={i} sel={i === index} price={price} chg={chg}
              onRadar={radar.has(r.ticker)} onSelect={onSelect} hubProps={itemProps ? itemProps(i) : undefined}
              showCompany={showCompany} />
          )
        })}
        {hasMore && <div ref={endRef} className={styles.moreSentinel} aria-hidden="true" />}
      </div>
      <div className={styles.keyHints}>
        <span><b>↑↓</b> move</span><span><b>⇧F</b> flag</span><span><b>W</b> watchlist</span><span><b>↵</b> full chart</span>
      </div>
    </div>
  )
})
export default ResultList
