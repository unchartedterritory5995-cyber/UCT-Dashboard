import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { setupLine } from './setupLine'
import { livePriceOf } from './livePrice'
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
const ResultRow = memo(function ResultRow({ r, i, sel, price, chg, onRadar, onSelect, hubProps, showCompany, structures }) {
  const s = setupLine({ ...r, price }, structures)
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
        <span className={styles.setup} title={s.title || undefined}>{s.text}{s.detail ? ` · ${s.detail}` : ''}</span>
      </span>
      <span className={styles.rowNums}>
        <span>{fmtPrice(price)}</span>
        <span className={chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}>{fmtChg(chg)}</span>
      </span>
    </div>
  )
})

// The screen's structure library and the structures it was screened for (setupLine reads both).
const NO_STRUCTURES = {}
// Rows kept visible beyond the selection when it moves, so the next stock is always in view.
export const LOOKAHEAD_ROWS = 2

const ResultList = forwardRef(function ResultList(
  { rows, index, onSelect, onKeyDown, livePrices = {}, radar = new Set(), sortLabel, onSort, total, hasMore, onLoadMore, isLoading, itemProps, showCompany = false, sortMenu, pending = false, structures = NO_STRUCTURES, headExtra = null },
  ref,
) {
  const listRef = useRef(null)
  // Scroll only the list's own container, never an ancestor or the window. The selection
  // keeps LOOKAHEAD_ROWS rows in view on either side (fewer at the ends of the list); when
  // the list is too short for that, the selected row itself always stays in view.
  const scrollToIndex = useCallback(i => {
    const list = listRef.current
    const el = list?.querySelector(`[data-index="${i}"]`)
    if (!list || !el) return
    const rowAt = k => list.querySelector(`[data-index="${k}"]`)
    let above = el
    for (let k = Math.max(0, i - LOOKAHEAD_ROWS); k < i; k++) { const r = rowAt(k); if (r) { above = r; break } }
    let below = el
    for (let k = i + LOOKAHEAD_ROWS; k > i; k--) { const r = rowAt(k); if (r) { below = r; break } }
    const lr = list.getBoundingClientRect()
    const off = node => {
      const r = node.getBoundingClientRect()
      return { top: r.top - lr.top + list.scrollTop, bottom: r.bottom - lr.top + list.scrollTop }
    }
    const sel = off(el)
    const want = { top: off(above).top, bottom: off(below).bottom }
    let next = list.scrollTop
    if (want.top < next) next = want.top
    else if (want.bottom > next + list.clientHeight) next = want.bottom - list.clientHeight
    // Never let the lookahead push the selected row itself out of view.
    next = Math.min(Math.max(next, sel.bottom - list.clientHeight), sel.top)
    if (next !== list.scrollTop) list.scrollTop = next
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
        {/* B13: the flagged actions live here, in a row that is always this tall, so the first
            flag adds nothing above the list and nothing below it moves. */}
        <span className={styles.listHeadEnd}>
          {headExtra}
          <span>{rows.length ? `${index + 1} of ${total ?? rows.length}` : ''}</span>
        </span>
      </div>
      <div ref={listRef} role="listbox" aria-label="Screen results" tabIndex={0} aria-busy={pending}
        aria-activedescendant={rows[index] ? `focus-opt-${rows[index].ticker}` : undefined}
        className={styles.list} data-focus-list=""
        // Keyboard mode: while the member steps with the keys, hover paints nothing, so the
        // row under a resting pointer never looks more selected than the selection. Set on
        // the DOM directly: a state change here would re-render every row.
        onKeyDown={e => { e.currentTarget.setAttribute('data-kbd', ''); onKeyDown?.(e) }}
        onPointerMove={e => { if (e.currentTarget.hasAttribute('data-kbd')) e.currentTarget.removeAttribute('data-kbd') }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.removeAttribute('data-kbd') }}>
        {rows.map((r, i) => {
          const { price, chg } = livePriceOf(r, livePrices[r.ticker])
          // itemProps(i) returns one of two constant objects, so the row's prop stays stable.
          return (
            <ResultRow key={r.ticker} r={r} i={i} sel={i === index} price={price} chg={chg}
              onRadar={radar.has(r.ticker)} onSelect={onSelect} hubProps={itemProps ? itemProps(i) : undefined}
              showCompany={showCompany} structures={structures} />
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
